const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-mvp-check-"));
const apiPort = Number(process.env.MVP_API_PORT || 18831);
const appPort = Number(process.env.MVP_APP_PORT || 5185);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const appUrl = `http://127.0.0.1:${appPort}/`;
const dbPath = path.join(tmpRoot, "jobpilot-mvp.sqlite");
const fileDir = path.join(tmpRoot, "files");
const children = new Set();

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 1500);
  });
};

const cleanup = async () => {
  await Promise.all([...children].map(stopChild));
  if (!process.env.JOBPILOT_KEEP_MVP_CHECK_DATA) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
};

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const run = (label, command, args, env = {}) =>
  new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });

const start = async (label, command, args, env, readyUrl) => {
  console.log(`\n==> Start ${label}`);
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  let output = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(`[${label}] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(`[${label}] ${text}`);
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before ready:\n${output}`);
    }
    try {
      const response = await fetch(readyUrl);
      if (response.ok) return child;
    } catch {
      // Keep waiting until the dev server/API has bound its port.
    }
    await sleep(250);
  }

  throw new Error(`${label} did not become ready:\n${output}`);
};

(async () => {
  try {
    await run("Build local app", npmCommand, ["run", "build"]);
    await run("Build and verify public demo", npmCommand, ["run", "demo:check"]);
    await run("Verify restart persistence", npmCommand, ["run", "api:check:persistence"]);

    await start("api", process.execPath, ["server/index.mjs"], {
      PORT: String(apiPort),
      HOST: "127.0.0.1",
      JOBPILOT_DB_PATH: dbPath,
      JOBPILOT_FILE_DIR: fileDir,
    }, `${apiUrl}/api/health`);

    await run("API smoke check", npmCommand, ["run", "api:check"], { API_URL: apiUrl });

    const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
    await start("vite", process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"], {
      VITE_API_BASE_URL: apiUrl,
    }, appUrl);

    await run("Frontend v0.7 audit", process.execPath, ["tools/v07_webapp_audit.cjs"], { APP_URL: appUrl, API_URL: apiUrl });
    await run("Frontend v0.7.2 audit", process.execPath, ["tools/v07_2_acceptance_audit.cjs"], { APP_URL: appUrl, API_URL: apiUrl });
    await run("Diff whitespace check", "git", ["diff", "--check"]);

    console.log("\nMVP check passed.");
    console.log(`App URL: ${appUrl}`);
    console.log(`API URL: ${apiUrl}`);
  } finally {
    await cleanup();
  }
})().catch(async (error) => {
  console.error(`\nMVP check failed: ${error.message}`);
  await cleanup();
  process.exit(1);
});
