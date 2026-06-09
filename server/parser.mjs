const knownCompanies = ["字节跳动", "腾讯", "阿里云", "阿里", "小红书", "美团", "百度", "快手", "京东", "网易", "拼多多"];
const knownCities = ["上海", "北京", "杭州", "深圳", "广州", "成都", "南京"];

const fileBaseName = (fileName = "") =>
  fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "";

const detectCompany = (text) => knownCompanies.find((company) => text.includes(company)) || "";
const detectCity = (text) => knownCities.find((city) => text.includes(city)) || "上海";
const detectRoleTitle = (text, fallback = "") => {
  const titleMatch = text.match(/([\u4e00-\u9fa5A-Za-z]*(?:前端|产品|数据|运营|算法|后端|全栈|增长)[\u4e00-\u9fa5A-Za-z]*(?:实习生|工程师|经理|岗位|开发)?)/);
  return titleMatch?.[1]?.slice(0, 18) || fallback || "待确认岗位";
};

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (days) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

const inferDueDateFromText = (deadline = "") => {
  const text = String(deadline).trim();
  if (!text || text === "待定") return "";
  if (/今晚|today|tonight/i.test(text)) return addDays(0);
  if (/明天|tomorrow/i.test(text)) return addDays(1);
  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  const cnDateMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
  if (cnDateMatch) return `${new Date().getFullYear()}-${cnDateMatch[1].padStart(2, "0")}-${cnDateMatch[2].padStart(2, "0")}`;
  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? "" : dateKey(parsedDate);
};

const sourceTextFrom = (payload) => {
  const rawText = payload.rawText?.trim() || "";
  const fileName = payload.fileName?.trim() || "";
  return {
    rawText,
    fileName,
    parseText: `${rawText} ${fileBaseName(fileName)}`.trim(),
  };
};

const cleanTranscriptLine = (line = "") => String(line).replace(/^\s*[-*•]\s*/, "").trim();

const stripQuestionPrefix = (line = "") =>
  cleanTranscriptLine(line)
    .replace(/^(?:Q\d*|Question\s*\d*|问题\s*\d*|问|面试官(?:问)?|HR\s*问?|追问|又问|接着问|继续问)[:：.)、\s-]*/i, "")
    .trim();

const stripAnswerPrefix = (line = "") =>
  cleanTranscriptLine(line)
    .replace(/^(?:A\d*|Answer\s*\d*|回答\s*\d*|答|候选人|我(?:回答|说)?|本人)[:：.)、\s-]*/i, "")
    .trim();

const inferQaType = (question = "") => {
  if (/为什么|动机|转岗|职业|选择|离职|优势|缺点/.test(question)) return "MOTIVATION";
  if (/React|TypeScript|性能|状态|架构|系统|算法|代码|技术|工程/i.test(question)) return "TECHNICAL";
  if (/项目|经历|案例|负责|推动|冲突|协作|结果|指标/.test(question)) return "PROJECT";
  return "BEHAVIORAL";
};

const frameworkForType = (type) => {
  if (type === "TECHNICAL") return "场景 -> 约束 -> 方案对比 -> 取舍 -> 结果";
  if (type === "MOTIVATION") return "过往能力 -> 转向原因 -> 岗位匹配 -> 未来贡献";
  if (type === "PROJECT") return "背景 -> 目标 -> 动作 -> 指标结果 -> 复盘限制";
  return "情境 -> 任务 -> 行动 -> 结果 -> 复盘";
};

const toParsedQa = (question, answer = "") => {
  const normalizedQuestion = stripQuestionPrefix(question).replace(/\s+/g, " ").trim();
  if (!normalizedQuestion || normalizedQuestion.length < 4) return null;
  const type = inferQaType(normalizedQuestion);
  const normalizedAnswer = stripAnswerPrefix(answer).replace(/\s+/g, " ").trim();
  return {
    question: normalizedQuestion,
    originalAnswer: normalizedAnswer || "待补充原回答。",
    type,
    score: normalizedAnswer ? 3 : 2,
    critique: normalizedAnswer ? "已从文字稿拆出原回答，建议补充指标、取舍和复盘。" : "已识别问题，但原回答需要补齐。",
    weak: true,
    framework: frameworkForType(type),
    optimizedAnswer: "按推荐框架重写：先给结论，再补背景、关键动作、结果指标和复盘。",
  };
};

const parseParagraphQaPairs = (transcript = "") => {
  const questionMatches = [...String(transcript).matchAll(/([^。！？\n]{4,160}[?？])/g)];
  return questionMatches
    .map((match, index) => {
      const question = match[0];
      const answerStart = (match.index ?? 0) + question.length;
      const nextStart = questionMatches[index + 1]?.index ?? String(transcript).length;
      const answer = String(transcript).slice(answerStart, nextStart).replace(/^[。！？\s，,：:；;、-]+/, "").trim();
      return toParsedQa(question, answer);
    })
    .filter(Boolean)
    .slice(0, 12);
};

export const parseTranscriptQaPairs = (transcript = "") => {
  const lines = String(transcript)
    .split(/\r?\n/)
    .map(cleanTranscriptLine)
    .filter(Boolean);
  if (!lines.length) return [];

  const parsed = [];
  let currentQuestion = "";
  let answerLines = [];

  const flush = () => {
    const nextPair = toParsedQa(currentQuestion, answerLines.join(" "));
    if (nextPair) parsed.push(nextPair);
    currentQuestion = "";
    answerLines = [];
  };

  for (const line of lines) {
    const isQuestion =
      /^(?:Q\d*|Question\s*\d*|问题\s*\d*|问|面试官(?:问)?|HR\s*问?|追问|又问|接着问|继续问)[:：.)、\s-]/i.test(line) ||
      (/^\d+[.)、]\s*/.test(line) && /[?？]/.test(line)) ||
      (/^[^。！？\n]{4,80}[?？]$/.test(line) && !/^(?:A\d*|Answer|回答|答|候选人)[:：.)、\s-]/i.test(line));
    const isAnswer = /^(?:A\d*|Answer\s*\d*|回答\s*\d*|答|候选人|我(?:回答|说)?|本人)[:：.)、\s-]/i.test(line);

    if (isQuestion) {
      flush();
      currentQuestion = stripQuestionPrefix(line);
      continue;
    }

    if (currentQuestion) {
      answerLines.push(isAnswer ? stripAnswerPrefix(line) : line);
    }
  }
  flush();

  if (parsed.length) return parsed.slice(0, 12);

  return parseParagraphQaPairs(transcript);
};

export const parseOpportunityDraft = (payload) => {
  const { rawText, fileName, parseText } = sourceTextFrom(payload);
  const sourceKind = payload.sourceKind || "jd-text";
  const deadline = parseText.includes("今晚") ? "Tonight" : parseText.includes("明天") ? "Tomorrow" : payload.deadline || "待定";
  const sourceText =
    rawText ||
    (sourceKind === "screenshot"
      ? `截图文件：${fileName}。本地解析 API 已建档，后续可替换为 OCR/AI 提取 JD 原文。`
      : `上传文件：${fileName}。本地解析 API 已建档，后续可替换为真实文件解析。`);

  return {
    company: detectCompany(parseText) || payload.company || "待填写公司",
    title: detectRoleTitle(parseText, payload.title),
    city: detectCity(parseText),
    deadline,
    dueDate: payload.dueDate || inferDueDateFromText(deadline),
    match: /React|前端|TypeScript|组件|性能/i.test(parseText) ? "HIGH" : payload.match || "HIGH",
    priority: parseText.includes("内推") || parseText.includes("急") ? "A" : payload.priority || "B",
    action: parseText.includes("今晚") || parseText.includes("明天") ? "P0" : payload.action || "P1",
    nextAction: payload.nextAction || "确认简历版本后投递",
    sourceLabel: fileName || (sourceKind === "job-link" ? "招聘链接" : "文字 JD"),
    sourceText,
    summary: payload.note || "由岗位管理内上传材料解析生成的岗位记录。",
    extractionStatus: payload.extractionStatus || "",
    extractionError: payload.extractionError || "",
  };
};

export const parseInterviewDraft = (payload) => {
  const { rawText, fileName, parseText } = sourceTextFrom(payload);
  const sourceKind = payload.sourceKind || "transcript";
  const isAudio = sourceKind === "audio" || /\.(m4a|mp3|wav|aac|ogg)$/i.test(fileName);
  const transcript =
    rawText ||
    (isAudio
      ? `录音文件：${fileName}。本地解析 API 已建档，后续可替换为转写服务。`
      : `文字稿文件：${fileName}。本地解析 API 已建档，后续可替换为 QA 拆分服务。`);

  return {
    company: detectCompany(parseText) || payload.company || "待填写公司",
    role: detectRoleTitle(parseText, payload.role),
    round: parseText.includes("二面") ? "二面" : parseText.includes("HR") ? "HR 面" : payload.round || "一面",
    date: payload.date || "Today",
    fileName: fileName || payload.fileName || "interview-transcript.md",
    sourceText: transcript,
    qaPairs: rawText ? parseTranscriptQaPairs(rawText) : [],
    note: payload.note || "",
    extractionStatus: payload.extractionStatus || "",
    extractionError: payload.extractionError || "",
  };
};

export const parseResumeDraft = (payload) => {
  const { rawText, fileName, parseText } = sourceTextFrom(payload);
  const baseName = fileBaseName(fileName) || "New Resume Version";
  return {
    title: payload.title || baseName,
    fileName,
    roles: /产品|策略|增长/.test(parseText) ? "产品 / 策略" : /数据|SQL|Python/i.test(parseText) ? "数据分析" : "前端 / 全栈",
    points: rawText || "系统会从简历文件里解析项目、技能、教育经历和可复用卖点。",
    summary: payload.note || "由上传简历自动解析，备注可后续补充。",
    extractionStatus: payload.extractionStatus || "",
    extractionError: payload.extractionError || "",
  };
};
