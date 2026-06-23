import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a local API port"));
          return;
        }
        resolve(address.port);
      });
    });
  });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-persistence-"));
const port = await getFreePort();
const apiUrl = `http://127.0.0.1:${port}`;
const dbPath = path.join(tmpRoot, "jobpilot-persistence.sqlite");
const fileDir = path.join(tmpRoot, "files");
const expectedDbPath = path.resolve(dbPath);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startApi = async () => {
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
      if (response.ok) {
        const health = await response.json();
        if (path.resolve(health.dbPath) !== expectedDbPath) {
          child.kill();
          throw new Error(`API health responded from an unexpected database: ${health.dbPath}`);
        }
        return { child, output: () => output };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("unexpected database")) {
        throw error;
      }
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
    practiceStatus: "中等",
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
