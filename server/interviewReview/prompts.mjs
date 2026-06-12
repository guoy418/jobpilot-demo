import { compact } from "./schema.mjs";

export const INTERVIEW_REVIEW_SYSTEM_PROMPT =
  "你是高质量中文面试复盘助手。你的回复必须是可被 JSON.parse 直接解析的 JSON 对象。第一个字符必须是 {，最后一个字符必须是 }。不要 markdown，不要代码块，不要解释用户要求，不要输出思考过程。";

export const buildChunkReviewPrompt = (payload = {}, fallback = {}, chunk, reviewRuntime = {}) => {
  const slowProvider = Boolean(reviewRuntime.maxTokens && reviewRuntime.maxTokens <= 4_800);
  const globalHints = [
    fallback.company ? `公司: ${fallback.company}` : "",
    fallback.role ? `岗位: ${fallback.role}` : "",
    fallback.round ? `轮次: ${fallback.round}` : "",
    payload.fileName ? `文件名: ${payload.fileName}` : "",
  ].filter(Boolean);

  return [
    "你是中文面试复盘教练。请只基于当前面试稿片段，识别真实问题，并直接生成每题复盘。",
    "输出 JSON: company, role, round, date, qaPairs。",
    "qaPairs 每项字段: question, originalAnswer, type, score, critique, weak, framework, optimizedAnswer, sourceChunkId, isPartial, boundaryNote。",
    "type 取值: PROJECT, TECHNICAL, MOTIVATION, BEHAVIORAL, PRODUCT, CASE, ENGLISH, OTHER。",
    "critique 要具体指出原回答缺失的背景、动作、指标、取舍或复盘。",
    "framework 要给 4-6 步回答组织方式。",
    slowProvider
      ? "optimizedAnswer 用中文第一人称写成可背版本，150-350 字即可，不要编造未出现的项目事实。"
      : "optimizedAnswer 要用中文第一人称写成可背版本，不要编造未出现的项目事实；缺少事实时说明可补充的占位信息。",
    slowProvider ? "每段最多返回 4 个问题，优先保留有实质回答的问题。" : "",
    "如果片段开头只有上一个问题的残留回答，不要编造问题；可用 boundaryNote 说明。",
    "如果片段结尾回答明显未完，仍可输出该问题，但 isPartial=true，并在 boundaryNote 说明需要与相邻块合并。",
    "overlap 造成重复问题没关系，本地会合并；不要为了去重而漏掉真实问题。",
    "如果当前片段没有可确认的问题，返回 qaPairs: []。",
    "JSON 示例:",
    '{"company":"","role":"","round":"","date":"Today","qaPairs":[{"question":"面试官的问题","originalAnswer":"候选人原回答","type":"PROJECT","score":3,"critique":"具体评价","weak":true,"framework":"回答框架","optimizedAnswer":"优化回答","sourceChunkId":"chunk-1","isPartial":false,"boundaryNote":""}]}',
    globalHints.length ? `面试元信息:\n${globalHints.join("\n")}` : "",
    `当前分块: ${chunk.index + 1}/${chunk.total} (${chunk.id})`,
    `面试稿片段:\n${compact(chunk.text)}`,
  ].filter(Boolean).join("\n\n");
};
