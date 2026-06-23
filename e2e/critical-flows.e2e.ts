import { expect, test, type Page } from "@playwright/test";
import { BACKUP_SCHEMA_VERSION } from "../src/utils/backup";

const openNav = async (page: Page, name: string) => {
  await page.getByRole("button", { name }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/");
});

test("loads the app shell and navigates critical pages", async ({ page }) => {
  await expect(page.getByText("JobPilot", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天先推进这几件事" })).toBeVisible();

  await openNav(page, "岗位推进");
  await expect(page.getByRole("heading", { name: "你正在跟进的岗位" })).toBeVisible();

  await openNav(page, "面试复盘");
  await expect(page.getByRole("heading", { name: "记录每一场面试" })).toBeVisible();

  await openNav(page, "答案库");
  await expect(page.getByRole("heading", { name: "沉淀可复用回答" })).toBeVisible();

  await openNav(page, "简历版本");
  await expect(page.getByRole("heading", { name: "简历档案库" })).toBeVisible();

  await openNav(page, "设置备份");
  await expect(page.getByRole("heading", { name: "管理数据和智能整理" })).toBeVisible();
});

test("creates an opportunity from pasted JD text", async ({ page }) => {
  await openNav(page, "岗位推进");
  await page.getByRole("button", { name: "新增岗位" }).click();

  const dialog = page.getByRole("dialog", { name: "新增岗位" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^岗位描述$/).fill("腾讯 上海 前端开发实习生，负责 React、TypeScript 组件和性能优化。明天截止，内推优先。");
  await dialog.getByRole("button", { name: "开始整理" }).click();

  await expect(dialog.getByText("确认内容", { exact: true })).toBeVisible();
  await dialog.getByLabel(/^公司/).fill("腾讯");
  await dialog.getByLabel(/^岗位名称/).fill("前端开发实习生");
  await dialog.getByLabel(/^岗位描述/).fill("岗位职责：参与 React 组件开发和性能优化。岗位要求：熟悉 TypeScript。");
  await dialog.getByRole("button", { name: "创建正式记录" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "前端开发实习生" })).toBeVisible();
  await expect(page.getByText("岗位已创建")).toBeVisible();
});

test("shows validation when answer and resume composers are incomplete", async ({ page }) => {
  await openNav(page, "答案库");
  await page.getByRole("button", { name: "新增答案卡" }).click();

  const answerDialog = page.getByRole("dialog", { name: "新增答案卡" });
  await answerDialog.getByRole("button", { name: "创建正式记录" }).click();
  await expect(answerDialog.getByText("请填写要沉淀的问题。")).toBeVisible();
  await answerDialog.getByRole("button", { name: "关闭" }).click();
  await expect(answerDialog).toBeHidden();

  await openNav(page, "简历版本");
  await page.getByRole("button", { name: "上传简历版本" }).click();

  const resumeDialog = page.getByRole("dialog", { name: "上传简历版本" });
  await resumeDialog.locator('input[type="file"]').setInputFiles({
    name: "resume-regression.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("前端实习投递版\nReact TypeScript 组件库 性能优化"),
  });
  await expect(resumeDialog.getByText("已读取文字，可以继续")).toBeVisible();
  await resumeDialog.getByRole("button", { name: "开始整理" }).click();
  await expect(resumeDialog.getByText("确认内容", { exact: true })).toBeVisible();
  await resumeDialog.getByLabel(/^版本名称/).fill("");
  await resumeDialog.getByRole("button", { name: "创建正式记录" }).click();
  await expect(resumeDialog.getByText("请填写简历版本名称。")).toBeVisible();
});

test("previews a backup restore file before applying it", async ({ page }) => {
  await openNav(page, "设置备份");
  await expect(page.getByRole("heading", { name: "管理数据和智能整理" })).toBeVisible();

  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: "2026-06-23T00:00:00.000Z",
    source: "playwright-regression",
    opportunities: [],
    resumeVersions: [],
    interviewSessions: [],
    answerCards: [],
    answerCategories: [],
    weeklyPlan: {
      weekStart: "2026-06-22",
      targetApplications: 0,
      tasks: [],
      focusDirections: [],
      focusCities: [],
      focusCompanies: [],
      practiceThemes: [],
    },
  };

  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: "jobpilot-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });

  await expect(page.getByRole("heading", { name: "确认要覆盖当前数据？" })).toBeVisible();
  await expect(page.getByText("jobpilot-backup.json")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认恢复" })).toBeVisible();
});
