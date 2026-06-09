import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-persistence-"));
const port = Number(process.env.PORT || 18817);
const apiUrl = `http://127.0.0.1:${port}`;
const dbPath = process.env.JOBPILOT_DB_PATH || path.join(tmpRoot, "jobpilot-persistence.sqlite");
const fileDir = process.env.JOBPILOT_FILE_DIR || path.join(tmpRoot, "files");

let runIndex = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startApi = async () => {
  runIndex += 1;
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      JOBPILOT_DB_PATH: dbPath,
      JOBPILOT_FILE_DIR: fileDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before ready:\n${output}`);
    }
    try {
      const response = await fetch(`${apiUrl}/api/health`);
      if (response.ok) return { child, output: () => output };
    } catch {
      // Retry until the server binds the port.
    }
    await sleep(250);
  }

  child.kill();
  throw new Error(`API did not become ready:\n${output}`);
};

const stopApi = async (api) => {
  if (api.child.exitCode !== null) return;
  await new Promise((resolve) => {
    api.child.once("exit", resolve);
    api.child.kill();
    setTimeout(resolve, 1500);
  });
};

const sendJson = async (route, method, body) => {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${route} returned ${response.status}`);
  }
  return response.json();
};

const getJson = async (route) => {
  const response = await fetch(`${apiUrl}${route}`);
  if (!response.ok) {
    throw new Error(`GET ${route} returned ${response.status}`);
  }
  return response.json();
};

const textFrom = async (route) => {
  const response = await fetch(`${apiUrl}${route}`);
  if (!response.ok) {
    throw new Error(`GET ${route} returned ${response.status}`);
  }
  return response.text();
};

const answerId = `AC-PERSIST-${Date.now()}`;
const taskId = `WT-PERSIST-${Date.now()}`;
const fileText = "JobPilot persistence check file";
let storageUri = "";
let api = null;

try {
  api = await startApi();

  await sendJson("/api/answers", "POST", {
    id: answerId,
    question: "Persistence check answer",
    type: "MANUAL",
    status: "DRAFT",
    source: "persistence-check",
    framework: "背景 -> 动作 -> 结果",
    answer: "temporary answer body",
    relatedRoles: "test",
    practiceStatus: "未练习",
  });

  await sendJson("/api/weekly-plan/current/tasks", "POST", {
    id: taskId,
    title: "Persistence check task",
    detail: "temporary task body",
    source: "answer",
    sourceLabel: "persistence-check",
    relatedEntityId: answerId,
    level: "P2",
    status: "open",
  });

  const uploaded = await sendJson("/api/files", "POST", {
    fileName: "persistence-check.txt",
    mimeType: "text/plain",
    dataBase64: Buffer.from(fileText, "utf8").toString("base64"),
  });
  storageUri = uploaded.storageUri;
  if (!storageUri) throw new Error("POST /api/files did not return storageUri");

  await stopApi(api);
  api = null;

  api = await startApi();
  const answers = await getJson("/api/answers");
  if (!answers.some((answer) => answer.id === answerId && answer.question === "Persistence check answer")) {
    throw new Error("Answer was not persisted across API restart");
  }

  const weeklyPlan = await getJson("/api/weekly-plan/current");
  if (!weeklyPlan.tasks.some((task) => task.id === taskId && task.relatedEntityId === answerId)) {
    throw new Error("Weekly task was not persisted across API restart");
  }

  const restoredFileText = await textFrom(storageUri);
  if (restoredFileText !== fileText) {
    throw new Error("Stored file was not readable after API restart");
  }

  console.log(`Persistence check passed: ${apiUrl}`);
  console.log(`SQLite database: ${dbPath}`);
} finally {
  if (api) await stopApi(api);
  if (!process.env.JOBPILOT_KEEP_PERSISTENCE_CHECK_DATA) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}
