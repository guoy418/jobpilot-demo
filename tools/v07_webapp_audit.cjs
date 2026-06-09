const { chromium } = require("playwright-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_URL = process.env.APP_URL || "http://localhost:5175/";
const API_URL = process.env.API_URL || "http://127.0.0.1:8787";
const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePath =
  process.env.CHROME_PATH ||
  (fs.existsSync(macChromePath) ? macChromePath : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const logs = [];
  const failures = [];

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));

  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.log(`FAIL ${name}: ${error.message}`);
    }
  };

  const cleanupWeeklyTasks = async (predicate) => {
    try {
      const response = await fetch(`${API_URL}/api/weekly-plan/current`);
      if (!response.ok) return;
      const plan = await response.json();
      for (const task of plan.tasks.filter(predicate)) {
        await fetch(`${API_URL}/api/weekly-tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      }
    } catch {
      // The frontend audit can run without the local API; cleanup is best-effort.
    }
  };

  const cleanupResumes = async (predicate) => {
    try {
      const response = await fetch(`${API_URL}/api/resumes`);
      if (!response.ok) return;
      const resumes = await response.json();
      for (const resume of resumes.filter(predicate)) {
        await fetch(`${API_URL}/api/resumes/${encodeURIComponent(resume.id)}`, { method: "DELETE" });
      }
    } catch {
      // Cleanup is best-effort when the API is available.
    }
  };

  const cleanupInterviews = async (predicate) => {
    try {
      const response = await fetch(`${API_URL}/api/interviews`);
      if (!response.ok) return;
      const interviews = await response.json();
      for (const interview of interviews.filter(predicate)) {
        await fetch(`${API_URL}/api/interviews/${encodeURIComponent(interview.id)}`, { method: "DELETE" });
      }
    } catch {
      // Cleanup is best-effort when the API is available.
    }
  };

  const cleanupOpportunities = async (predicate) => {
    try {
      const response = await fetch(`${API_URL}/api/opportunities`);
      if (!response.ok) return;
      const opportunities = await response.json();
      for (const opportunity of opportunities.filter(predicate)) {
        await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(opportunity.id)}`, { method: "DELETE" });
      }
    } catch {
      // Cleanup is best-effort when the API is available.
    }
  };

  await page.goto(APP_URL);
  await page.waitForLoadState("networkidle");

  await check("app loads and main nav excludes inbox", async () => {
    await page.getByText("JobPilot").waitFor({ timeout: 5000 });
    const navText = await page.locator("nav.nav").innerText();
    if (!navText.includes("岗位管理") || !navText.includes("面试复盘") || !navText.includes("简历版本")) {
      throw new Error(`nav incomplete: ${navText}`);
    }
    if (navText.includes("材料收件箱")) throw new Error("main nav still exposes Material Inbox");
  });

  await check("opportunity two-step creation works", async () => {
    await page.locator("nav.nav").getByRole("button", { name: "岗位管理" }).click();
    await page.getByRole("button", { name: /新增岗位 \/ 上传 JD/ }).click();
    await page
      .locator(".source-text-input textarea")
      .fill("网易 前端开发实习生 上海 岗位职责：React TypeScript 组件库 性能优化。明天截止，适合 FE Intern v7。");
    await page.locator(".source-side input").fill("官网 JD，测试自动解析");
    await page.getByRole("button", { name: /开始解析/ }).click();
    await page.getByRole("button", { name: /创建正式记录/ }).click();
    await page.getByText("岗位进度", { exact: true }).waitFor({ timeout: 5000 });
    const body = await page.locator("body").innerText();
    if (!body.includes("岗位进度") || !body.includes("待投递")) {
      throw new Error("new opportunity did not land on detail/progress view");
    }
  });

  await check("manual applied status updates pipeline", async () => {
    await page.getByRole("button", { name: /标记已投递/ }).click();
    await page.getByText("已投递").first().waitFor({ timeout: 5000 });
    const body = await page.locator("body").innerText();
    if (!body.includes("三天后跟进投递结果")) throw new Error("applied next action missing");
    await cleanupWeeklyTasks((task) => task.source === "opportunity" && task.title.includes("网易") && /^OP-\d{5}-/.test(task.relatedEntityId ?? ""));
  });

  await check("linked interview creation advances opportunity", async () => {
    await page.getByRole("button", { name: /^添加面试$/ }).click();
    await page
      .locator(".source-text-input textarea")
      .fill("网易 一面 面试官问：你在低代码项目里如何衡量性能优化结果？我回答首屏优化、拆包和缓存，但没有说指标。");
    await page.locator(".source-side input").fill("一面文字稿");
    await page.getByRole("button", { name: /开始解析/ }).click();
    await page.getByRole("button", { name: /创建正式记录/ }).click();
    await page.getByText("按场次管理每次面试").waitFor({ timeout: 5000 });
    await page.locator("nav.nav").getByRole("button", { name: "岗位管理" }).click();
    await page.getByPlaceholder("搜索岗位、公司、下一步动作").fill("网易");
    await page.getByText("面试中").first().waitFor({ timeout: 5000 });
    await cleanupInterviews((interview) => interview.company === "网易" && /^INT-\d{5}-/.test(interview.id));
    await cleanupOpportunities((opportunity) => opportunity.company === "网易" && /^OP-\d{5}-/.test(opportunity.id));
  });

  await check("resume two-step upload works", async () => {
    await page.getByRole("button", { name: /简历版本/ }).click();
    await page.getByRole("button", { name: /上传简历版本/ }).click();
    const tmp = path.join(os.tmpdir(), "jobpilot-product-strategy-v8.txt");
    fs.writeFileSync(tmp, "mock resume content for JobPilot v0.7 audit");
    await page.locator('.upload-dropzone input[type="file"]').setInputFiles(tmp);
    await page.locator(".source-side input").fill("产品策略版简历");
    await page.getByRole("button", { name: /开始解析/ }).click();
    await page.getByRole("button", { name: /创建正式记录/ }).click();
    await page.getByRole("heading", { name: "jobpilot product strategy v8" }).waitFor({ timeout: 5000 });
    await cleanupResumes((resume) => resume.name === "jobpilot product strategy v8");
  });

  await check("no blocking console errors", async () => {
    const errors = logs.filter((line) => (line.startsWith("error") || line.startsWith("pageerror")) && !line.includes("Failed to load resource"));
    if (errors.length) throw new Error(errors.slice(0, 5).join(" | "));
  });

  const screenshot = path.join(os.tmpdir(), "jobpilot-v07-audit.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();

  console.log(JSON.stringify({ failures, consoleMessages: logs.slice(0, 10), screenshot }, null, 2));
  process.exit(failures.length ? 1 : 0);
})();
