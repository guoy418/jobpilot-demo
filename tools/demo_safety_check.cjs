const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const distDir = path.join(root, "dist");
const envDemoPath = path.join(root, ".env.demo");

const fail = (message) => {
  console.error(`Demo safety check failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(envDemoPath)) fail(".env.demo is missing");
const envDemo = fs.readFileSync(envDemoPath, "utf8");
if (!/^VITE_PUBLIC_DEMO=true$/m.test(envDemo)) {
  fail(".env.demo must set VITE_PUBLIC_DEMO=true");
}
if (/^VITE_API_BASE_URL=/m.test(envDemo)) {
  fail(".env.demo must not set VITE_API_BASE_URL");
}
if (process.env.VITE_API_BASE_URL) {
  fail("VITE_API_BASE_URL must not be present when building the public demo");
}

for (const envFile of [".env", ".env.demo.local"]) {
  const envPath = path.join(root, envFile);
  if (fs.existsSync(envPath) && /^VITE_API_BASE_URL=/m.test(fs.readFileSync(envPath, "utf8"))) {
    fail(`${envFile} must not set VITE_API_BASE_URL for public demo builds`);
  }
}

if (!fs.existsSync(distDir)) fail("dist is missing; run npm run build:demo first");

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else files.push(fullPath);
  }
};
walk(distDir);

const forbidden = [
  { pattern: /http:\/\/127\.0\.0\.1:8787/g, label: "default local API URL" },
  { pattern: /jobpilot\.local\.sqlite/g, label: "local SQLite filename" },
  { pattern: /server\/data/g, label: "local data directory" },
  { pattern: /JOBPILOT_DB_PATH/g, label: "local database env var" },
  { pattern: /JOBPILOT_FILE_DIR/g, label: "local file env var" },
  { pattern: /OPENAI_API_KEY/g, label: "OpenAI API key env var" },
  { pattern: /ANTHROPIC_API_KEY/g, label: "Anthropic API key env var" },
];

for (const file of files) {
  const relativePath = path.relative(root, file);
  const content = fs.readFileSync(file);
  const text = content.toString("utf8");
  for (const { pattern, label } of forbidden) {
    if (pattern.test(text)) fail(`${relativePath} contains ${label}`);
    pattern.lastIndex = 0;
  }
}

let trackedSensitive = "";
try {
  trackedSensitive = execFileSync("git", ["ls-files", "server/data", "*.sqlite", "*.sqlite-wal", "*.sqlite-shm", ".env", ".env.local", ".env.demo.local"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch (error) {
  fail(`could not inspect tracked files: ${error.message}`);
}

if (trackedSensitive) {
  fail(`sensitive local data is tracked by git:\n${trackedSensitive}`);
}

console.log("Demo safety check passed.");
