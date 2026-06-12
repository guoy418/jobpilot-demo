import fs from "node:fs";
import { parseInterviewTranscriptWithAi } from "./interviewReview/pipeline.mjs";

const compact = (value = "") => String(value ?? "").trim();
const INTERVIEW_PROMPT_TEXT_LIMIT = 40_000;
const DEFAULT_PROMPT_TEXT_LIMIT = 50_000;
const AI_REQUEST_TIMEOUT_MS = 120_000;

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
  if (/^https:\/\/api\.moonshot\.cn$/i.test(normalized)) return `${normalized}/v1/chat/completions`;
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
  const sourceText = truncateForPrompt(rawSourceText, DEFAULT_PROMPT_TEXT_LIMIT);
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
  resume: ["title", "fileName", "roles", "points", "summary", "extractionStatus"],
};

const sanitizeAiResult = (kind, parsed, fallback) => {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return fallback;
  const result = { ...fallback };
  for (const key of allowedKeys[kind] ?? []) {
    if (parsed[key] === undefined || parsed[key] === null) continue;
    result[key] = typeof parsed[key] === "string" ? parsed[key].trim() : String(parsed[key]);
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
  if (kind === "interview" && fallback?.extractionStatus === "interview-json") return fallback;

  if (kind === "interview") {
    if (!isAiEnabled(config)) {
      return {
        ...fallback,
        qaPairs: [],
        extractionStatus: "ai-not-configured",
        aiStatus: "failed",
        aiError: "未整理的面试文稿需要先开启智能整理。整理好的复盘 JSON 可以直接导入，不需要 LLM。",
      };
    }
    return parseInterviewTranscriptWithAi(config, payload, fallback, {
      callChatModel,
      jsonFromText,
      previewAiContent,
    });
  }

  if (!isAiEnabled(config)) return fallback;

  const prompt = buildPrompt(kind, payload, fallback);
  if (!prompt) return fallback;

  try {
    const content = await callChatModel(config, prompt);
    const parsed = jsonFromText(content);
    const result = sanitizeAiResult(kind, parsed, fallback);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[AI PARSER FALLBACK] ${message}`);
    return fallback;
  }
};

