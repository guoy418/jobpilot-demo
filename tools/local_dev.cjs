const { spawn } = require("child_process");
const path = require("path");

const root = process.cwd();
const apiPort = Number(process.env.JOBPILOT_API_PORT || process.env.PORT || 8787);
const appPort = Number(process.env.JOBPILOT_APP_PORT || 5175);
const host = process.env.JOBPILOT_HOST || "127.0.0.1";
const apiUrl = `http://${host}:${apiPort}`;
const appUrl = `http://${host}:${appPort}/`;
const smokeOnly = process.argv.includes("--smoke");
const children = new Set();

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
};

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const start = async (label, command, args, env, readyUrl) => {
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
      // Wait for the process to bind its port.
    }
    await sleep(250);
  }

  throw new Error(`${label} did not become ready:\n${output}`);
};

(async () => {
  try {
    console.log("Starting JobPilot local MVP...");
    console.log(`API: ${apiUrl}`);
    console.log(`App: ${appUrl}`);

    await start("api", process.execPath, ["server/index.mjs"], {
      HOST: host,
      PORT: String(apiPort),
    }, `${apiUrl}/api/health`);

    const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
    await start("vite", process.execPath, [viteBin, "--host", host, "--port", String(appPort), "--strictPort"], {
      VITE_API_BASE_URL: apiUrl,
    }, appUrl);

    console.log("\nJobPilot local MVP is ready.");
    console.log(`Open ${appUrl}`);
    console.log("Press Ctrl+C to stop API and frontend.");

    if (smokeOnly) {
      await cleanup();
      return;
    }

    await new Promise(() => {});
  } catch (error) {
    console.error(`\nFailed to start local MVP: ${error.message}`);
    await cleanup();
    process.exit(1);
  }
})();
