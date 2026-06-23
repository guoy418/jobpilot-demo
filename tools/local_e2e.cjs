const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const root = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-local-e2e-"));
const dbPath = path.join(tmpRoot, "jobpilot-e2e.sqlite");
const fileDir = path.join(tmpRoot, "files");
const children = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a local test port"));
          return;
        }
        resolve(address.port);
      });
    });
  });

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
  if (!process.env.JOBPILOT_KEEP_LOCAL_E2E_DATA) {
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

const start = async (label, command, args, env, readyUrl, verifyReady) => {
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
      if (response.ok) {
        if (verifyReady) await verifyReady(response, child);
        return child;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("unexpected database")) {
        throw error;
      }
      // Keep waiting until the dev server/API has bound its port.
    }
    await sleep(250);
  }

  throw new Error(`${label} did not become ready:\n${output}`);
};

const runPlaywright = (env) =>
  new Promise((resolve, reject) => {
    console.log("\n==> Run local API Playwright E2E");
    const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
    const child = spawn(process.execPath, [playwrightCli, "test", "--config", "playwright.local.config.ts"], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Playwright local E2E failed with exit code ${code}`));
    });
  });

(async () => {
  const apiPort = Number(process.env.JOBPILOT_E2E_API_PORT || (await getFreePort()));
  const appPort = Number(process.env.JOBPILOT_E2E_APP_PORT || (await getFreePort()));
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const appUrl = `http://127.0.0.1:${appPort}`;
  const expectedDbPath = path.resolve(dbPath);

  if (apiPort === 8787 || appPort === 5175) {
    throw new Error("Local E2E must not use the default API/UI ports.");
  }

  try {
    console.log("Starting JobPilot local E2E stack...");
    console.log(`API: ${apiUrl}`);
    console.log(`App: ${appUrl}/`);
    console.log(`SQLite database: ${dbPath}`);
    console.log(`File directory: ${fileDir}`);

    await start(
      "api",
      process.execPath,
      ["server/index.mjs"],
      {
        PORT: String(apiPort),
        HOST: "127.0.0.1",
        JOBPILOT_DB_PATH: dbPath,
        JOBPILOT_FILE_DIR: fileDir,
      },
      `${apiUrl}/api/health`,
      async (response, child) => {
        const health = await response.json();
        if (path.resolve(health.dbPath) !== expectedDbPath) {
          child.kill();
          throw new Error(`API health responded from an unexpected database: ${health.dbPath}`);
        }
      },
    );

    const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
    await start(
      "vite",
      process.execPath,
      [viteBin, "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"],
      {
        VITE_API_BASE_URL: apiUrl,
      },
      `${appUrl}/`,
    );

    await runPlaywright({
      JOBPILOT_E2E_API_URL: apiUrl,
      JOBPILOT_E2E_APP_URL: appUrl,
      JOBPILOT_E2E_DB_PATH: dbPath,
      JOBPILOT_E2E_FILE_DIR: fileDir,
    });

    console.log("\nLocal E2E passed.");
  } finally {
    await cleanup();
  }
})().catch(async (error) => {
  console.error(`\nLocal E2E failed: ${error.message}`);
  await cleanup();
  process.exit(1);
});
