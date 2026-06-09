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
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const logs = [];
  const failures = [];

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));

  const closeBlockingDialogs = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const dialogs = page.locator('[role="dialog"]');
      if (!(await dialogs.count())) return;
      const dialog = dialogs.last();
      const closeButton = dialog.getByRole("button", { name: /取消|关闭预览/ }).first();
      if (await closeButton.count()) {
        await closeButton.click({ timeout: 2000 }).catch(() => page.keyboard.press("Escape"));
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(150);
    }
  };

  const check = async (name, fn) => {
    try {
      await closeBlockingDialogs();
      await fn();
      await closeBlockingDialogs();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.log(`FAIL ${name}: ${error.message}`);
      await closeBlockingDialogs();
    }
  };

  const nav = (name) => page.locator("nav.nav").getByRole("button", { name });
  const bodyText = () => page.locator("body").innerText();
  const activeMainText = () => page.locator("main").innerText();
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

  await page.goto(APP_URL);
  await page.waitForLoadState("networkidle");

  await check("navigation opens all active modules", async () => {
    const cases = [
      ["今日待办", "今天先处理这几件事"],
      ["岗位管理", "新增岗位 / 上传 JD"],
      ["面试复盘", "按场次管理每次面试"],
      ["答案库", "可复用回答和手动准备都在这里"],
      ["简历版本", "管理你上传的几份不同简历文件"],
      ["训练计划", "目标方向 + 泛任务训练"],
      ["设置导出", "本地数据的备份和导出"],
    ];

    for (const [buttonName, expectedText] of cases) {
      await nav(buttonName).click();
      const text = await activeMainText();
      if (!text.includes(expectedText)) throw new Error(`${buttonName} did not open expected module`);
    }

    const navText = await page.locator("nav.nav").innerText();
    if (navText.includes("材料收件箱")) throw new Error("Material Inbox is still exposed");
  });

  await check("today todo count equals visible action rows", async () => {
    await nav("今日待办").click();
    const visibleRows = await page.locator(".action-row").count();
    const heroNumber = Number((await page.locator(".hero-number.small").first().innerText()).trim());
    if (heroNumber !== visibleRows) throw new Error(`hero count ${heroNumber} != rows ${visibleRows}`);
  });

  await check("today todo rows jump to expected modules", async () => {
    await nav("今日待办").click();
    const rows = page.locator(".action-row-main");
    const count = Math.min(await rows.count(), 3);
    if (count < 3) throw new Error(`not enough todo rows to validate jumps: ${count}`);

    await rows.nth(0).click();
    if (!(await (await activeMainText()).includes("岗位进度"))) throw new Error("first todo did not open opportunity detail");

    await nav("今日待办").click();
    await rows.nth(1).click();
    const secondText = await activeMainText();
    if (!secondText.includes("岗位进度") && !secondText.includes("按场次管理每次面试") && !secondText.includes("训练与杂项动作")) {
      throw new Error("second todo opened an unexpected module");
    }
  });

  await check("weekly task open/done syncs back to today todo", async () => {
    await nav("训练计划").click();
    await page.getByRole("button", { name: /添加训练 \/ 杂项动作/ }).click();
    const newestTask = page.locator(".weekly-task").first();
    await newestTask.locator("input").fill("v0.7.2 验收专用动作");
    await newestTask.locator("textarea").fill("这条任务用于验证训练计划会进入今日待办。");

    await nav("今日待办").click();
    let text = await activeMainText();
    if (!text.includes("v0.7.2 验收专用动作")) throw new Error("new weekly task did not appear in today todo");

    await nav("训练计划").click();
    await page.locator(".weekly-task").first().getByRole("button", { name: /标记完成/ }).click();
    await nav("今日待办").click();
    text = await activeMainText();
    if (text.includes("v0.7.2 验收专用动作")) throw new Error("done weekly task still appears in today todo");
    await cleanupWeeklyTasks((task) => task.title === "v0.7.2 验收专用动作");
  });

  await check("new resume is selectable when creating an opportunity", async () => {
    await nav("简历版本").click();
    await page.getByRole("button", { name: /上传简历版本/ }).click();
    const tmp = path.join(os.tmpdir(), "jobpilot-v072-resume.txt");
    fs.writeFileSync(tmp, "mock resume for v0.7.2 acceptance");
    await page.locator('.upload-dropzone input[type="file"]').setInputFiles(tmp);
    await page.locator(".source-side input").fill("v0.7.2 验收简历");
    await page.getByRole("button", { name: /开始解析/ }).click();
    await page.locator(".composer-grid input").first().fill("V072 Resume");
    await page.getByRole("button", { name: /创建正式记录/ }).click();
    await page.getByText("V072 Resume").first().waitFor({ timeout: 5000 });

    await nav("岗位管理").click();
    await page.getByRole("button", { name: /新增岗位 \/ 上传 JD/ }).click();
    await page.locator(".source-text-input textarea").fill("字节跳动 前端开发实习生 上海 React TypeScript JD");
    await page.getByRole("button", { name: /开始解析/ }).click();
    const resumeSelectText = await page
      .locator(".composer-grid label")
      .filter({ hasText: "投递简历" })
      .locator("select")
      .innerText();
    if (!resumeSelectText.includes("V072 Resume")) throw new Error("new resume is not available in opportunity resume selector");
    await page.getByRole("button", { name: "取消" }).click();
    await cleanupResumes((resume) => resume.name === "V072 Resume");
  });

  await check("interview QA can generate and delete answer card", async () => {
    await nav("面试复盘").click();
    const before = await page.locator(".qa-card").first().innerText();
    await page.getByRole("button", { name: /生成答案卡/ }).click();
    await page.getByText("可复用回答和手动准备都在这里").waitFor({ timeout: 5000 });
    const answerText = await activeMainText();
    if (!answerText.includes(before.split("\n").find(Boolean))) throw new Error("generated answer card not visible in answer library");
    await page.getByRole("button", { name: /删除当前卡/ }).click();
    await page.getByRole("button", { name: /删除卡片/ }).click();
  });

  await check("manual answer creation works", async () => {
    await nav("答案库").click();
    await page.getByRole("button", { name: /新增答案卡/ }).click();
    await page.locator(".composer-grid input").first().fill("v0.7.2 手动答案问题");
    await page.getByRole("button", { name: /创建正式记录/ }).click();
    const text = await activeMainText();
    if (!text.includes("v0.7.2 手动答案问题")) throw new Error("manual answer card was not created");
    await page.getByRole("button", { name: /删除当前卡/ }).click();
    await page.getByRole("button", { name: /删除卡片/ }).click();
    const afterDeleteText = await activeMainText();
    if (afterDeleteText.includes("v0.7.2 手动答案问题")) throw new Error("manual answer card was not deleted after audit");
  });

  await check("source asset preview opens from opportunity detail", async () => {
    await nav("岗位管理").click();
    await page.locator(".table-row").first().click();
    await page.locator(".source-button").first().click();
    await page.locator(".asset-preview").waitFor({ timeout: 5000 });
    const text = await page.locator(".asset-preview").innerText();
    if (!text.includes("JD") && !text.includes("链接") && !text.includes("截图")) throw new Error("source preview content looks wrong");
    await page.getByRole("button", { name: /关闭预览/ }).click();
  });

  await check("no blocking console errors", async () => {
    const errors = logs.filter((line) => (line.startsWith("error") || line.startsWith("pageerror")) && !line.includes("Failed to load resource"));
    if (errors.length) throw new Error(errors.slice(0, 5).join(" | "));
  });

  const screenshot = path.join(os.tmpdir(), "jobpilot-v072-acceptance.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();

  console.log(JSON.stringify({ failures, consoleMessages: logs.slice(0, 10), screenshot }, null, 2));
  process.exit(failures.length ? 1 : 0);
})();
