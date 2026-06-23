import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type AnswerCard = {
  question: string;
  answer: string;
  relatedRoles: string;
};

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Run npm run test:e2e:local.`);
  return value;
};

const apiUrl = requiredEnv("JOBPILOT_E2E_API_URL");
const appUrl = requiredEnv("JOBPILOT_E2E_APP_URL");
const expectedDbPath = requiredEnv("JOBPILOT_E2E_DB_PATH");
const expectedFileDir = requiredEnv("JOBPILOT_E2E_FILE_DIR");

const normalizePath = (value: string) => path.resolve(value);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getJson = async <T,>(request: APIRequestContext, route: string): Promise<T> => {
  const response = await request.get(`${apiUrl}${route}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
};

const postJson = async <T,>(request: APIRequestContext, route: string, data: unknown): Promise<T> => {
  const response = await request.post(`${apiUrl}${route}`, {
    headers: { "Content-Type": "application/json" },
    data,
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
};

const verifyIsolatedStack = async (page: Page, request: APIRequestContext) => {
  expect(new URL(apiUrl).port).not.toBe("8787");
  expect(new URL(appUrl).port).not.toBe("5175");

  const health = await getJson<{ dbPath?: string }>(request, "/api/health");
  expect(normalizePath(health.dbPath ?? "")).toBe(normalizePath(expectedDbPath));

  const apiBadge = page.locator(".api-mode-badge");
  await expect(apiBadge.getByText("已连接")).toBeVisible();
  await expect(apiBadge).toHaveAttribute("title", expectedDbPath);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("persists browser-created data through the local API temp SQLite stack", async ({ page, request }) => {
  const unique = Date.now();
  const question = `E2E 临时 SQLite 持久化 ${unique}`;
  const answer = `这张卡由本地 E2E 通过浏览器创建，并写入临时 SQLite。${unique}`;
  const relatedRoles = "本地 E2E / 临时数据库";

  await page.goto("/");
  await verifyIsolatedStack(page, request);

  await page.getByRole("button", { name: "答案库" }).click();
  await expect(page.getByRole("heading", { name: "沉淀可复用回答" })).toBeVisible();

  await page.getByRole("button", { name: "新增答案卡" }).click();
  const composer = page.getByRole("dialog", { name: "新增答案卡" });
  await expect(composer).toBeVisible();
  await composer.getByLabel(/^问题/).fill(question);
  await composer.getByLabel("具体回答").fill(answer);
  await composer.getByLabel("适用岗位").fill(relatedRoles);
  await composer.getByRole("button", { name: "创建正式记录" }).click();
  await expect(composer).toBeHidden();
  await expect(page.locator(".answer-editor").getByRole("heading", { name: question })).toBeVisible();

  await expect
    .poll(async () => {
      const answers = await getJson<AnswerCard[]>(request, "/api/answers");
      return answers.some((card) => card.question === question && card.answer === answer && card.relatedRoles === relatedRoles);
    })
    .toBe(true);

  const fileText = `local e2e temp file ${unique}`;
  const uploaded = await postJson<{ storageUri: string }>(request, "/api/files", {
    fileName: "local-e2e-note.txt",
    mimeType: "text/plain",
    dataBase64: Buffer.from(fileText, "utf8").toString("base64"),
  });
  expect(uploaded.storageUri).toMatch(/^\/api\/files\//);
  expect(fs.readdirSync(expectedFileDir).some((fileName) => fileName.endsWith("-local-e2e-note.txt"))).toBe(true);
  const restoredFile = await request.get(`${apiUrl}${uploaded.storageUri}`);
  expect(await restoredFile.text()).toBe(fileText);

  await page.reload();
  await verifyIsolatedStack(page, request);
  await page.getByRole("button", { name: "答案库" }).click();
  await expect(page.getByRole("heading", { name: "沉淀可复用回答" })).toBeVisible();
  await expect(page.getByText(question)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`打开答案卡：${escapeRegExp(question)}`) }).click();
  const persistedAnswerEditor = page.locator(".answer-editor");
  await expect(persistedAnswerEditor.getByRole("heading", { name: question })).toBeVisible();
  await expect(persistedAnswerEditor.locator("label").filter({ hasText: "适用岗位" }).locator("textarea")).toHaveValue(relatedRoles);
});
