import fs from "node:fs";
import { parseTranscriptQaPairs } from "./parser.mjs";

const compact = (value = "") => String(value ?? "").trim();
const INTERVIEW_PROMPT_TEXT_LIMIT = 40_000;
const DEFAULT_PROMPT_TEXT_LIMIT = 50_000;
const AI_REQUEST_TIMEOUT_MS = 120_000;
const INTERVIEW_REVIEW_MAX_TOKENS = 5_600;
const INTERVIEW_PAIR_REVIEW_MAX_TOKENS = 2_400;
const INTERVIEW_PAIR_TIMEOUT_MS = 90_000;
const INTERVIEW_QA_EXTRACT_TIMEOUT_MS = 90_000;
const INTERVIEW_QA_EXTRACT_MAX_TOKENS = 5_200;
const INTERVIEW_PAIR_LIMIT = 16;
const INTERVIEW_JSON_SYSTEM_PROMPT =
  "你是高质量中文面试复盘助手。你的回复必须是可被 JSON.parse 直接解析的 JSON 对象。第一个字符必须是 {，最后一个字符必须是 }。不要 markdown，不要代码块，不要解释用户要求，不要输出思考过程。";

const truncateForPrompt = (text = "", limit = DEFAULT_PROMPT_TEXT_LIMIT) => {
  const value = compact(text);
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[TRUNCATED: original text had ${value.length} characters; only the first ${limit} were sent for this MVP parse.]`;
};

const compactFallbackForPrompt = (kind, fallback = {}) => {
  if (!fallback || typeof fallback !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(fallback)) {
    if (["sourceText", "jdText", "points"].includes(key)) {
      result[key] = compact(value).slice(0, 800);
      continue;
    }
    if (key === "qaPairs") {
      result.qaPairCount = Array.isArray(value) ? value.length : 0;
      continue;
    }
    result[key] = value;
  }
  result.kind = kind;
  return result;
};

const tryParseJson = (candidate) => {
  const value = compact(candidate);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const withoutTrailingComma = value.replace(/,\s*([}\]])/g, "$1");
    if (withoutTrailingComma !== value) {
      try {
        return JSON.parse(withoutTrailingComma);
      } catch {
        return null;
      }
    }
    return null;
  }
};

const extractBalancedJson = (text, openChar = "{", closeChar = "}") => {
  const start = text.indexOf(openChar);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return tryParseJson(text.slice(start, index + 1));
    }
  }
  return null;
};

const jsonFromText = (text) => {
  const trimmed = compact(text);
  if (!trimmed) return null;

  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  for (const block of fencedBlocks) {
    const parsed = tryParseJson(block) || extractBalancedJson(block);
    if (parsed) return parsed;
  }

  return extractBalancedJson(trimmed) || extractBalancedJson(trimmed, "[", "]");
};

const extractAssistantContent = (data) => {
  const message = data?.choices?.[0]?.message;
  if (!message) return "";
  const raw = message.content;
  if (typeof raw === "string" && compact(raw)) return compact(raw);
  if (Array.isArray(raw)) {
    const joined = raw.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
    if (compact(joined)) return compact(joined);
  }
  return compact(message.reasoning_content);
};

const previewAiContent = (text, limit = 180) => {
  const value = compact(text);
  if (!value) return "（空响应）";
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
};

export const normalizeProviderConfig = (payload = {}) => {
  const settings = payload.aiSettings && typeof payload.aiSettings === "object" ? payload.aiSettings : {};
  const provider = compact(settings.provider || process.env.JOBPILOT_AI_PROVIDER || "none").toLowerCase();
  const endpoint = compact(settings.endpoint || process.env.JOBPILOT_AI_ENDPOINT);
  const model = compact(settings.model || process.env.JOBPILOT_AI_MODEL) || (provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini");
  const apiKey =
    compact(settings.apiKey || process.env.JOBPILOT_AI_API_KEY) ||
    (provider === "anthropic" ? compact(process.env.ANTHROPIC_API_KEY) : compact(process.env.OPENAI_API_KEY));

  return { provider, endpoint, model, apiKey };
};

export const isAiEnabled = (config) => ["openai", "custom", "anthropic"].includes(config.provider) && Boolean(config.apiKey);

const providerResult = (text = "", status = "", error = "") => ({
  text: compact(text),
  status,
  error: compact(error),
});

const chatEndpointFrom = (config) => {
  const endpoint = compact(config.endpoint);
  if (!endpoint) return "https://api.openai.com/v1/chat/completions";
  if (/api\.example\.com/i.test(endpoint)) {
    throw new Error("Endpoint is still the placeholder https://api.example.com/v1. Replace it with your real provider base URL.");
  }
  const normalized = endpoint.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/audio\/transcriptions$/i.test(normalized)) return normalized.replace(/\/audio\/transcriptions$/i, "/chat/completions");
  if (/\/v1$/i.test(normalized)) return `${normalized}/chat/completions`;
  if (/^https:\/\/api\.(deepseek|openai)\.com$/i.test(normalized)) return `${normalized}/v1/chat/completions`;
  return `${normalized}/chat/completions`;
};

const kimiCompatible = (config) => {
  const hint = `${compact(config.endpoint)} ${compact(config.model)}`.toLowerCase();
  return /moonshot|kimi-k/i.test(hint);
};

const requestTemperature = (config, task = "chat") => {
  if (kimiCompatible(config)) return 1;
  return task === "vision" ? 0 : 0.2;
};

const responseError = async (response, label) => {
  const text = await response.text().catch(() => "");
  const detail = compact(text).slice(0, 240);
  return `${label} returned ${response.status}${detail ? `: ${detail}` : ""}`;
};

const fetchWithTimeout = async (endpoint, options, label, timeoutMs = AI_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(endpoint, { ...options, signal: controller.signal });
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || "";
    throw new Error(`${label} fetch failed for ${endpoint}: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ""}`);
  } finally {
    clearTimeout(timer);
  }
};

const buildPrompt = (kind, payload = {}, fallback = {}) => {
  const rawSourceText = compact(payload.rawText || payload.sourceText);
  const sourceText = truncateForPrompt(rawSourceText, kind === "interview" ? INTERVIEW_PROMPT_TEXT_LIMIT : DEFAULT_PROMPT_TEXT_LIMIT);
  const fallbackForPrompt = compactFallbackForPrompt(kind, fallback);
  const fileName = compact(payload.fileName);
  const common = [
    "Return JSON only. Do not include markdown.",
    "If a field is not present, return an empty string rather than inventing facts.",
    "The user will review and edit the result before creating a formal record.",
  ].join("\n");

  if (kind === "opportunity") {
    return [
      "You are parsing a job description for a local personal job-search operations tool.",
      common,
      "Return exactly these keys: company, title, city, deadline, dueDate, match, priority, action, nextAction, sourceLabel, sourceText, summary.",
      "Allowed values: match HIGH|MEDIUM|LOW, priority A|B|C, action P0|P1|P2|P3.",
      `File name: ${fileName}`,
      `Existing fallback JSON: ${JSON.stringify(fallbackForPrompt)}`,
      `JD text:\n${sourceText}`,
    ].join("\n\n");
  }

  if (kind === "interview") {
    const hints = [];
    if (fallbackForPrompt.company) hints.push(`公司线索: ${fallbackForPrompt.company}`);
    if (fallbackForPrompt.role) hints.push(`岗位线索: ${fallbackForPrompt.role}`);
    if (fallbackForPrompt.round) hints.push(`轮次线索: ${fallbackForPrompt.round}`);
    return [
      "你是一个中文面试复盘助手。请根据面试文字稿，按固定 JSON 结构输出复盘草稿。",
      "只返回 JSON。",
      "输出字段: company, role, round, date, qaPairs, note。",
      hints.length ? `已有线索:\n${hints.join("\n")}` : "",
      fileName ? `文件名: ${fileName}` : "",
      `面试文字稿:\n${sourceText}`,
    ].filter(Boolean).join("\n\n");
  }

  if (kind === "resume") {
    return [
      "You are summarizing a resume for a local personal job-search management tool.",
      common,
      "Return exactly these keys: title, fileName, roles, points, summary.",
      "Keep roles short, such as \"前端 / 全栈\", \"产品 / 策略\", or \"数据分析\".",
      `File name: ${fileName}`,
      `Existing fallback JSON: ${JSON.stringify(fallbackForPrompt)}`,
      `Resume text:\n${sourceText}`,
    ].join("\n\n");
  }

  return "";
};

const allowedKeys = {
  opportunity: ["company", "title", "city", "deadline", "dueDate", "match", "priority", "action", "nextAction", "sourceLabel", "sourceText", "summary", "extractionStatus"],
  interview: ["company", "role", "round", "date", "fileName", "sourceText", "qaPairs", "note", "extractionStatus", "aiStatus", "aiError"],
  resume: ["title", "fileName", "roles", "points", "summary", "extractionStatus"],
};

const cleanQuestionTitle = (value = "") =>
  compact(value)
    .replace(/^问题簇\s*[｜|:：-]?\s*/i, "")
    .replace(/^考察点\s*[：:]\s*/i, "")
    .trim();

const cleanReviewFramework = (value = "") =>
  compact(value)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:考察点|常见问法|回答框架|推荐案例\/?证据|推荐案例|证据|追问提醒)\s*[：:]\s*/i, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");

const sanitizeQaPair = (item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const question = cleanQuestionTitle(item.question);
  if (!question) return null;
  const score = Number(item.score);
  return {
    question,
    originalAnswer: compact(item.originalAnswer) || "待补充原回答。",
    type: compact(item.type) || "BEHAVIORAL",
    score: Number.isFinite(score) ? Math.min(5, Math.max(1, Math.round(score))) : 2,
    critique: compact(item.critique) || "建议补充更具体的例子、指标和复盘。",
    weak: typeof item.weak === "boolean" ? item.weak : true,
    framework: cleanReviewFramework(item.framework) || "先给结论，再补充具体场景、关键动作、结果指标和复盘。",
    optimizedAnswer: compact(item.optimizedAnswer) || "按推荐框架重写回答。",
  };
};

const sanitizeAiResult = (kind, parsed, fallback) => {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return fallback;
  const result = { ...fallback };
  for (const key of allowedKeys[kind] ?? []) {
    if (parsed[key] === undefined || parsed[key] === null) continue;
    if (key === "qaPairs") {
      result.qaPairs = Array.isArray(parsed.qaPairs) ? parsed.qaPairs.map(sanitizeQaPair).filter(Boolean).slice(0, 12) : fallback.qaPairs ?? [];
      continue;
    }
    if (kind === "interview" && key === "sourceText") continue;
    result[key] = typeof parsed[key] === "string" ? parsed[key].trim() : String(parsed[key]);
  }
  if (kind === "interview") {
    result.sourceText = fallback.sourceText || "";
    result.fileName = fallback.fileName || result.fileName || "";
  }
  return result;
};

const callOpenAiCompatible = async (config, prompt, options = {}) => {
  const endpoint = chatEndpointFrom(config);
  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: options.systemPrompt || "You extract structured JSON for JobPilot. Return JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: requestTemperature(config, "chat"),
    max_tokens: options.maxTokens ?? 3200,
  };
  if (options.jsonMode !== false) {
    requestBody.response_format = { type: "json_object" };
  }
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  }, "AI provider", options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error(await responseError(response, "AI provider"));
  const data = await response.json();
  return extractAssistantContent(data);
};

const callAnthropic = async (config, prompt, options = {}) => {
  const endpoint = config.endpoint || "https://api.anthropic.com/v1/messages";
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens ?? 1600,
      temperature: 0.2,
      messages: [{ role: "user", content: `${options.systemPrompt ? `${options.systemPrompt}\n\n` : ""}${prompt}` }],
    }),
  }, "AI provider", options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error(await responseError(response, "AI provider"));
  const data = await response.json();
  return data.content?.map((item) => item.text ?? "").join("\n") ?? "";
};

const callChatModel = async (config, prompt, options = {}) =>
  config.provider === "anthropic" ? callAnthropic(config, prompt, options) : callOpenAiCompatible(config, prompt, options);

const repairInterviewJson = async (config, originalPrompt, invalidContent) => {
  const repairPrompt = [
    "上一轮输出不是 JSON。现在重新完成同一个面试复盘任务。",
    "严格要求：只返回一个 JSON 对象。第一个字符必须是 {，最后一个字符必须是 }。",
    "禁止输出「用户要求我」「我需要」「分析如下」「下面是 JSON」等任何解释性文字。",
    "不要 markdown，不要代码块，不要 sourceText 字段。",
    "JSON schema:",
    '{"company":"","role":"","round":"","date":"Today","qaPairs":[{"question":"","originalAnswer":"","type":"BEHAVIORAL","score":3,"critique":"","weak":true,"framework":"","optimizedAnswer":""}],"note":""}',
    "如果你不确定 company/role/round，就填空字符串；qaPairs 至少返回 1 个有效问题。",
    `上一轮错误输出片段（不要模仿这个写法）：\n${previewAiContent(invalidContent, 1_000)}`,
    `原任务和面试文字稿：\n${truncateForPrompt(originalPrompt, 32_000)}`,
  ].join("\n\n");

  return callChatModel(config, repairPrompt, {
    maxTokens: INTERVIEW_REVIEW_MAX_TOKENS,
    systemPrompt: INTERVIEW_JSON_SYSTEM_PROMPT,
    timeoutMs: AI_REQUEST_TIMEOUT_MS,
  });
};

const buildInterviewQaExtractPrompt = (payload = {}, fallback = {}) => {
  const sourceText = truncateForPrompt(compact(payload.rawText || payload.sourceText || fallback.sourceText), INTERVIEW_PROMPT_TEXT_LIMIT);
  return [
    "你是一个中文面试复盘助手。请阅读语音转文字稿，抽取面试官问题和候选人原回答。",
    "请按 JSON 输出: company, role, round, date, qaPairs。",
    "qaPairs 每项包含: question, originalAnswer, type。",
    "尽量按出现顺序抽取所有真实面试问题；如果问题没有问号，请根据上下文还原。",
    "originalAnswer 保留候选人的回答要点和关键细节。",
    "type 取值: PROJECT, TECHNICAL, MOTIVATION, BEHAVIORAL, PRODUCT, CASE, ENGLISH, OTHER。",
    `最多返回 ${INTERVIEW_PAIR_LIMIT} 个问题；如果超过上限，优先保留有实质回答的问题。`,
    "JSON 示例:",
    '{"company":"","role":"","round":"","date":"Today","qaPairs":[{"question":"面试官的问题","originalAnswer":"候选人的原回答要点","type":"PROJECT"}]}',
    payload.fileName ? `文件名: ${payload.fileName}` : "",
    `面试逐字稿:\n${sourceText}`,
  ].filter(Boolean).join("\n\n");
};

const extractInterviewPairsWithAi = async (config, payload, fallback) => {
  const prompt = buildInterviewQaExtractPrompt(payload, fallback);
  const content = await callChatModel(config, prompt, {
    maxTokens: INTERVIEW_QA_EXTRACT_MAX_TOKENS,
    systemPrompt: INTERVIEW_JSON_SYSTEM_PROMPT,
    timeoutMs: INTERVIEW_QA_EXTRACT_TIMEOUT_MS,
  });
  let parsed = jsonFromText(content);
  if (!parsed) {
    const repairedContent = await callChatModel(config, [
      "上一轮 Q/A 抽取输出不是 JSON。请只返回可解析 JSON。",
      "字段: company, role, round, date, qaPairs。",
      "qaPairs 每项字段: question, originalAnswer, type。",
      `错误输出片段:\n${previewAiContent(content, 800)}`,
      `原任务:\n${prompt}`,
    ].join("\n\n"), {
      maxTokens: INTERVIEW_QA_EXTRACT_MAX_TOKENS,
      systemPrompt: INTERVIEW_JSON_SYSTEM_PROMPT,
      timeoutMs: INTERVIEW_QA_EXTRACT_TIMEOUT_MS,
    });
    parsed = jsonFromText(repairedContent);
  }
  if (!parsed || !Array.isArray(parsed.qaPairs)) return null;

  const qaPairs = parsed.qaPairs
    .map((pair) =>
      sanitizeQaPair({
        question: pair.question,
        originalAnswer: pair.originalAnswer,
        type: pair.type || "OTHER",
        score: 3,
        critique: "待由 AI 生成复盘评价。",
        weak: true,
        framework: "待由 AI 生成推荐回答框架。",
        optimizedAnswer: "待由 AI 生成可背版本。",
      }),
    )
    .filter(Boolean)
    .slice(0, INTERVIEW_PAIR_LIMIT);

  if (!qaPairs.length) return null;
  return {
    company: compact(parsed.company) || fallback.company,
    role: compact(parsed.role) || fallback.role,
    round: compact(parsed.round) || fallback.round,
    date: compact(parsed.date) || fallback.date,
    qaPairs,
  };
};

const buildInterviewPairPrompt = (payload = {}, fallback = {}, pair = {}, index = 0, total = 1) => {
  const globalHints = [
    fallback.company ? `公司: ${fallback.company}` : "",
    fallback.role ? `岗位: ${fallback.role}` : "",
    fallback.round ? `轮次: ${fallback.round}` : "",
    payload.fileName ? `文件名: ${payload.fileName}` : "",
  ].filter(Boolean);
  const transcriptContext = truncateForPrompt(compact(payload.rawText || payload.sourceText || fallback.sourceText), 1_200);
  return [
    "你是一个中文面试教练。请根据原问题和原回答，生成单题面试复盘。",
    "请按 JSON 输出: question, originalAnswer, type, score, critique, weak, framework, optimizedAnswer。",
    `这是第 ${index + 1}/${total} 个问题。`,
    globalHints.length ? `面试元信息:\n${globalHints.join("\n")}` : "",
    `原问题:\n${compact(pair.question)}`,
    `用户原回答:\n${compact(pair.originalAnswer) || "待补充原回答。"}`,
    "critique: 具体评价原回答的不足和改进方向，80-160 中文字。",
    "framework: 针对这个问题定制回答框架，写 4-6 个组织回答的步骤，120-240 中文字。",
    "optimizedAnswer: 中文第一人称可背版本，分 2-4 段，包含场景、动作、取舍、结果和反思，350-800 中文字。",
    "JSON 示例:",
    '{"question":"","originalAnswer":"","type":"BEHAVIORAL","score":3,"critique":"","weak":true,"framework":"","optimizedAnswer":""}',
    transcriptContext ? `文字稿上下文（仅用于理解，不要复述整段）:\n${transcriptContext}` : "",
  ].filter(Boolean).join("\n\n");
};

const reviewInterviewPair = async (config, payload, fallback, pair, index, total) => {
  const prompt = buildInterviewPairPrompt(payload, fallback, pair, index, total);
  const content = await callChatModel(config, prompt, {
    maxTokens: INTERVIEW_PAIR_REVIEW_MAX_TOKENS,
    systemPrompt: INTERVIEW_JSON_SYSTEM_PROMPT,
    timeoutMs: INTERVIEW_PAIR_TIMEOUT_MS,
  });
  let parsed = jsonFromText(content);
  if (!parsed) {
    const repairedContent = await callChatModel(config, [
      "上一轮单题复盘输出不是 JSON。请把同一个问题重新生成成 JSON 对象。",
      "只返回 JSON。第一个字符必须是 {，最后一个字符必须是 }。",
      "字段: question, originalAnswer, type, score, critique, weak, framework, optimizedAnswer。",
      `错误输出片段:\n${previewAiContent(content, 800)}`,
      `原任务:\n${prompt}`,
    ].join("\n\n"), {
      maxTokens: INTERVIEW_PAIR_REVIEW_MAX_TOKENS,
      systemPrompt: INTERVIEW_JSON_SYSTEM_PROMPT,
      timeoutMs: INTERVIEW_PAIR_TIMEOUT_MS,
    });
    parsed = jsonFromText(repairedContent);
  }
  if (!parsed || (!compact(parsed.critique) && !compact(parsed.framework) && !compact(parsed.optimizedAnswer))) {
    return null;
  }
  return sanitizeQaPair({ ...pair, ...parsed });
};

const runLimited = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const candidateInterviewPairs = (payload, fallback) => {
  const sourceText = compact(payload.rawText || payload.sourceText || fallback.sourceText);
  const parsed = Array.isArray(fallback.qaPairs) && fallback.qaPairs.length ? fallback.qaPairs : parseTranscriptQaPairs(sourceText);
  const pairs = parsed
    .filter((pair) => compact(pair.question))
    .sort((a, b) => {
      const aHasAnswer = compact(a.originalAnswer) && a.originalAnswer !== "待补充原回答。";
      const bHasAnswer = compact(b.originalAnswer) && b.originalAnswer !== "待补充原回答。";
      if (aHasAnswer !== bHasAnswer) return aHasAnswer ? -1 : 1;
      return compact(b.originalAnswer).length - compact(a.originalAnswer).length;
    })
    .slice(0, INTERVIEW_PAIR_LIMIT);
  if (pairs.length || !sourceText) return pairs;
  return [
    {
      question: "请根据这段面试文字稿，识别最值得复盘的一个核心问题",
      originalAnswer: sourceText.slice(0, 1_200),
      type: "BEHAVIORAL",
      score: 2,
      critique: "文字稿没有被本地规则稳定拆成问题和回答，需要 AI 先识别核心问题。",
      weak: true,
      framework: "先识别面试官真正想考察的能力，再结合原回答补充结构、例子、结果和复盘。",
      optimizedAnswer: "根据识别出的问题重写回答。",
    },
  ];
};

const parseInterviewWithFanoutAi = async (config, payload, fallback) => {
  let extracted = null;
  try {
    extracted = await extractInterviewPairsWithAi(config, payload, fallback);
  } catch (error) {
    console.warn(`[AI QA EXTRACT FALLBACK] ${error instanceof Error ? error.message : String(error)}`);
  }
  const pairs = extracted?.qaPairs?.length ? extracted.qaPairs : candidateInterviewPairs(payload, fallback);
  if (!pairs.length) return null;

  const failures = [];
  const reviewed = await runLimited(pairs, 2, async (pair, index) => {
    try {
      return await reviewInterviewPair(config, payload, fallback, pair, index, pairs.length);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  });

  const qaPairs = reviewed.filter(Boolean);
  if (!qaPairs.length) {
    return {
      ...fallback,
      qaPairs: [],
      extractionStatus: failures.length ? "ai-parser-failed" : "ai-review-empty",
      aiStatus: "failed",
      aiError: failures[0] || "模型没有返回有效的单题复盘，因此没有写入旧规则结果。请重试或换模型。",
    };
  }

  return {
    ...fallback,
    ...(extracted
      ? {
          company: extracted.company || fallback.company,
          role: extracted.role || fallback.role,
          round: extracted.round || fallback.round,
          date: extracted.date || fallback.date,
        }
      : {}),
    qaPairs,
    extractionStatus: "ai-review",
    aiStatus: failures.length ? "partial" : "used",
    aiError: failures.length ? `部分问题复盘失败，已保留 ${qaPairs.length}/${pairs.length} 个 AI 结果。首个错误：${failures[0]}` : "",
    note: compact(fallback.note) || "已按题拆分生成高质量面试复盘；建议补充真实指标后再练习。",
  };
};

const audioModelFrom = (config) => {
  const configured = compact(process.env.JOBPILOT_TRANSCRIPTION_MODEL);
  if (configured) return configured;
  if (/whisper|transcribe|gpt-4o-(mini-)?transcribe/i.test(config.model)) return config.model;
  return "whisper-1";
};

const transcriptionEndpointFrom = (config) => {
  if (!config.endpoint) return "https://api.openai.com/v1/audio/transcriptions";
  const normalized = config.endpoint.replace(/\/+$/, "");
  if (/\/audio\/transcriptions$/i.test(normalized)) return normalized;
  return `${normalized.replace(/\/chat\/completions$/i, "")}/audio/transcriptions`;
};

const openAiVisionContent = (prompt, mimeType, dataBase64) => [
  { type: "text", text: prompt },
  {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${dataBase64}`,
    },
  },
];

const callOpenAiCompatibleVision = async (config, prompt, mimeType, dataBase64) => {
  const endpoint = chatEndpointFrom(config);
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "You are OCR for JobPilot. Return only the extracted text." },
        { role: "user", content: openAiVisionContent(prompt, mimeType, dataBase64) },
      ],
      temperature: requestTemperature(config, "vision"),
    }),
  }, "AI vision provider");
  if (!response.ok) throw new Error(await responseError(response, "AI vision provider"));
  const data = await response.json();
  return compact(data.choices?.[0]?.message?.content);
};

const callAnthropicVision = async (config, prompt, mimeType, dataBase64) => {
  const endpoint = config.endpoint || "https://api.anthropic.com/v1/messages";
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2400,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: dataBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  }, "AI vision provider");
  if (!response.ok) throw new Error(await responseError(response, "AI vision provider"));
  const data = await response.json();
  return compact(data.content?.map((item) => item.text ?? "").join("\n"));
};

export const ocrImageWithOptionalAi = async (payload, file) => {
  const config = normalizeProviderConfig(payload);
  if (!isAiEnabled(config)) return providerResult("", "ai-not-configured");
  const dataBase64 = file.buffer.toString("base64");
  const prompt = [
    "Extract all readable text from this uploaded image for JobPilot.",
    "Preserve job description, resume, or interview transcript wording.",
    "Do not summarize and do not add commentary.",
  ].join("\n");

  try {
    const text = config.provider === "anthropic" ? await callAnthropicVision(config, prompt, file.mimeType, dataBase64) : await callOpenAiCompatibleVision(config, prompt, file.mimeType, dataBase64);
    return text ? providerResult(text, "ai-ocr") : providerResult("", "empty-ocr-text");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[AI OCR FALLBACK] ${message}`);
    return providerResult("", "ocr-provider-failed", message);
  }
};

export const transcribeAudioWithOptionalAi = async (payload, file) => {
  const config = normalizeProviderConfig(payload);
  if (!isAiEnabled(config)) return providerResult("", "ai-not-configured");
  if (!["openai", "custom"].includes(config.provider)) return providerResult("", "transcription-provider-unsupported");

  try {
    const formData = new FormData();
    formData.append("file", new Blob([fs.readFileSync(file.path)], { type: file.mimeType }), file.fileName);
    formData.append("model", audioModelFrom(config));
    formData.append("response_format", "json");
    const endpoint = transcriptionEndpointFrom(config);
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    }, "AI transcription provider", 90_000);
    if (!response.ok) throw new Error(await responseError(response, "AI transcription provider"));
    const data = await response.json();
    const text = compact(data.text);
    return text ? providerResult(text, "ai-transcription") : providerResult("", "empty-transcription-text");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[AI TRANSCRIPTION FALLBACK] ${message}`);
    return providerResult("", "transcription-provider-failed", message);
  }
};

export const parseWithOptionalAi = async (kind, payload, fallback) => {
  const config = normalizeProviderConfig(payload);
  if (!isAiEnabled(config)) return fallback;

  if (kind === "interview") {
    const fanoutResult = await parseInterviewWithFanoutAi(config, payload, fallback);
    return fanoutResult || {
      ...fallback,
      qaPairs: [],
      extractionStatus: "ai-review-empty",
      aiStatus: "failed",
      aiError: "模型没有从完整面试文字稿中抽取出有效问题和原回答，因此没有写入旧规则结果。请重试或换更快的文本模型。",
    };
  }

  const prompt = buildPrompt(kind, payload, fallback);
  if (!prompt) return fallback;

  try {
    let content = await callChatModel(
      config,
      prompt,
      kind === "interview"
        ? {
            maxTokens: INTERVIEW_REVIEW_MAX_TOKENS,
            systemPrompt: INTERVIEW_JSON_SYSTEM_PROMPT,
          }
        : {},
    );
    let parsed = jsonFromText(content);
    if (!parsed && kind === "interview") {
      const repairedContent = await repairInterviewJson(config, prompt, content);
      const repaired = jsonFromText(repairedContent);
      if (repaired) {
        content = repairedContent;
        parsed = repaired;
      }
    }
    const result = sanitizeAiResult(kind, parsed, fallback);
    if (kind === "interview") {
      if (!parsed) {
        return {
          ...fallback,
          qaPairs: [],
          extractionStatus: "ai-parser-invalid-json",
          aiStatus: "failed",
          aiError: `模型没有返回可解析的 JSON。原始响应片段：${previewAiContent(content)}`,
        };
      }
      if (!Array.isArray(result.qaPairs) || result.qaPairs.length === 0) {
        return {
          ...result,
          qaPairs: [],
          extractionStatus: "ai-review-empty",
          aiStatus: "failed",
          aiError: "模型没有返回有效 qaPairs，因此没有写入旧规则结果。请重试或换模型。",
        };
      }
      return {
        ...result,
        extractionStatus: result.extractionStatus || "ai-review",
        aiStatus: "used",
        aiError: "",
      };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[AI PARSER FALLBACK] ${message}`);
    if (kind === "interview") {
      return {
        ...fallback,
        qaPairs: [],
        extractionStatus: "ai-parser-failed",
        aiStatus: "failed",
        aiError: message,
      };
    }
    return fallback;
  }
};

