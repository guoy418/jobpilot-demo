import { DEFAULT_CHUNK_OPTIONS } from "./chunker.mjs";

const compact = (value = "") => String(value ?? "").trim();

export const isSlowInterviewProvider = (config = {}) => {
  const hint = `${compact(config.endpoint)} ${compact(config.model)}`.toLowerCase();
  return /moonshot|kimi-k|kimi\//i.test(hint);
};

export const resolveInterviewReviewRuntime = (config = {}) => {
  const slowProvider = isSlowInterviewProvider(config);
  return {
    timeoutMs: slowProvider ? 240_000 : 120_000,
    repairTimeoutMs: slowProvider ? 180_000 : 120_000,
    concurrency: slowProvider ? 1 : 2,
    maxTokens: slowProvider ? 4_800 : 6_400,
    chunkOptions: slowProvider
      ? { charLimit: 4_500, overlap: 600, maxChunks: 10 }
      : DEFAULT_CHUNK_OPTIONS,
    retryOnTimeout: slowProvider,
  };
};
