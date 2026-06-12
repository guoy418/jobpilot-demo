import { splitInterviewTranscriptChunks } from "./chunker.mjs";
import { mergeInterviewReviewPairs } from "./merge.mjs";
import { buildChunkReviewPrompt, INTERVIEW_REVIEW_SYSTEM_PROMPT } from "./prompts.mjs";
import { resolveInterviewReviewRuntime } from "./runtime.mjs";
import { compact, normalizeInterviewReviewRoot } from "./schema.mjs";
import { isGarbledTextContent } from "../textEncoding.mjs";

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

const parseChunkReview = (parsed, chunk, fallback) => {
  const normalized = normalizeInterviewReviewRoot(
    {
      ...parsed,
      qaPairs: (parsed?.qaPairs ?? []).map((pair) => ({
        ...pair,
        sourceChunkId: pair.sourceChunkId || chunk.id,
      })),
    },
    { includeMetadata: true, requireReview: true, requirePairs: false },
  );
  if (!normalized) return null;
  return {
    company: normalized.company || fallback.company,
    role: normalized.role || fallback.role,
    round: normalized.round || fallback.round,
    date: normalized.date || fallback.date,
    qaPairs: normalized.qaPairs,
  };
};

const isTimeoutError = (error) => /timed out after/i.test(error instanceof Error ? error.message : String(error));

const reviewChunkWithAi = async (config, payload, fallback, chunk, runtime, reviewRuntime, attempt = 0) => {
  const prompt = buildChunkReviewPrompt(payload, fallback, chunk, reviewRuntime);
  try {
    const content = await runtime.callChatModel(config, prompt, {
      maxTokens: reviewRuntime.maxTokens,
      systemPrompt: INTERVIEW_REVIEW_SYSTEM_PROMPT,
      timeoutMs: reviewRuntime.timeoutMs,
    });
    let parsed = runtime.jsonFromText(content);
    if (!parsed) {
      const repairedContent = await runtime.callChatModel(config, [
        "上一轮分块复盘输出不是 JSON。请把同一片段重新整理成可解析 JSON。",
        "只返回 JSON。字段: company, role, round, date, qaPairs。",
        "qaPairs 字段: question, originalAnswer, type, score, critique, weak, framework, optimizedAnswer, sourceChunkId, isPartial, boundaryNote。",
        `错误输出片段:\n${runtime.previewAiContent(content, 900)}`,
        `原任务:\n${prompt}`,
      ].join("\n\n"), {
        maxTokens: reviewRuntime.maxTokens,
        systemPrompt: INTERVIEW_REVIEW_SYSTEM_PROMPT,
        timeoutMs: reviewRuntime.repairTimeoutMs,
      });
      parsed = runtime.jsonFromText(repairedContent);
    }
    return parseChunkReview(parsed, chunk, fallback);
  } catch (error) {
    if (reviewRuntime.retryOnTimeout && attempt === 0 && isTimeoutError(error)) {
      return reviewChunkWithAi(config, payload, fallback, chunk, runtime, reviewRuntime, attempt + 1);
    }
    throw error;
  }
};

export const parseInterviewTranscriptWithAi = async (config, payload, fallback, runtime) => {
  const sourceText = compact(payload.rawText || payload.sourceText || fallback.sourceText);
  if (!sourceText) {
    return {
      ...fallback,
      qaPairs: [],
      extractionStatus: "ai-review-empty",
      aiStatus: "failed",
      aiError: "没有可用于 AI 复盘的面试文字稿。",
    };
  }
  if (isGarbledTextContent(sourceText)) {
    return {
      ...fallback,
      qaPairs: [],
      extractionStatus: "text-encoding-failed",
      aiStatus: "failed",
      aiError: "面试文字稿看起来像乱码，通常是文件编码不对。请用 UTF-8 重新导出转写稿，或直接粘贴文字内容后重试。",
    };
  }

  const reviewRuntime = resolveInterviewReviewRuntime(config);
  const chunks = splitInterviewTranscriptChunks(sourceText, reviewRuntime.chunkOptions);
  const failures = [];
  const chunkResults = await runLimited(chunks, reviewRuntime.concurrency, async (chunk) => {
    try {
      return await reviewChunkWithAi(config, payload, fallback, chunk, runtime, reviewRuntime);
    } catch (error) {
      failures.push(`${chunk.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });

  const successfulChunks = chunkResults.filter(Boolean);
  const qaPairs = mergeInterviewReviewPairs(successfulChunks.flatMap((chunk) => chunk.qaPairs ?? []), { requireReview: true });
  if (!qaPairs.length) {
    return {
      ...fallback,
      qaPairs: [],
      extractionStatus: failures.length ? "ai-parser-failed" : "ai-review-empty",
      aiStatus: "failed",
      aiError: failures[0] || "模型没有从面试文字稿中生成有效复盘。请检查文稿内容、模型配置或重试。",
    };
  }

  const metadataSource = successfulChunks.find((item) => compact(item.company) || compact(item.role) || compact(item.round)) ?? {};
  return {
    ...fallback,
    company: metadataSource.company || fallback.company,
    role: metadataSource.role || fallback.role,
    round: metadataSource.round || fallback.round,
    date: metadataSource.date || fallback.date,
    qaPairs,
    extractionStatus: "ai-review",
    aiStatus: failures.length ? "partial" : "used",
    aiError: failures.length ? `部分文稿分块整理失败，已保留 ${qaPairs.length} 个问题。首个错误：${failures[0]}` : "",
    note: compact(fallback.note) || `已将文字稿分成 ${chunks.length} 段并行整理，合并后生成 ${qaPairs.length} 个问题。`,
  };
};
