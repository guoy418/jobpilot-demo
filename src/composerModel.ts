import type { ComposerSourceKind, ModuleComposer, ModuleComposerDraft, ModuleComposerSource, QaPair } from "./types";

export type InterviewReviewJsonParseResult =
  | {
      ok: true;
      review: {
        company: string;
        role: string;
        round: string;
        date: string;
        sourceText: string;
        note: string;
        qaPairs: Array<Omit<QaPair, "id">>;
      };
    }
  | { ok: false; error: string };

export const createModuleComposerSource = (sourceKind: ComposerSourceKind = "manual"): ModuleComposerSource => ({
  fileName: "",
  sourceKind,
  rawText: "",
  note: "",
  uploadStatus: "idle",
});

export const inferComposerSourceKind = (fileName: string, fallback: ModuleComposer): ComposerSourceKind => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.startsWith("http")) return "job-link";
  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(lowerName)) return "screenshot";
  if (/\.(m4a|mp3|wav|aac|ogg)$/i.test(lowerName)) return "audio";
  if (/\.(txt|md|json|docx)$/i.test(lowerName)) return fallback === "interview" ? "transcript" : "jd-text";
  if (/\.(pdf|docx)$/i.test(lowerName)) return fallback === "resume" ? "resume-file" : "jd-text";
  if (fallback === "resume") return "resume-file";
  if (fallback === "interview") return "transcript";
  if (fallback === "opportunity") return "jd-text";
  return "manual";
};

export const fileBaseName = (fileName: string) =>
  fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "";

export const detectCompany = (text: string) => {
  const knownCompanies = ["字节跳动", "腾讯", "阿里云", "阿里", "小红书", "美团", "百度", "快手", "京东", "网易", "拼多多"];
  return knownCompanies.find((company) => text.includes(company)) || "";
};

export const detectCity = (text: string) => {
  const knownCities = ["上海", "北京", "杭州", "深圳", "广州", "成都", "南京"];
  return knownCities.find((city) => text.includes(city)) || "上海";
};

export const detectRoleTitle = (text: string, fallback = "") => {
  const titleMatch = text.match(/([\u4e00-\u9fa5A-Za-z]*(?:前端|产品|数据|运营|算法|后端|全栈|增长)[\u4e00-\u9fa5A-Za-z]*(?:实习生|工程师|经理|岗位|开发)?)/);
  return titleMatch?.[1]?.slice(0, 18) || fallback || "待确认岗位";
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const textField = (value: unknown) => String(value ?? "").trim();

const numberField = (value: unknown, fallback: number) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.min(5, Math.max(1, Math.round(score))) : fallback;
};

const booleanField = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|1|weak|需要|薄弱)$/i.test(value.trim())) return true;
    if (/^(false|no|0|done|可复用|已处理)$/i.test(value.trim())) return false;
  }
  return fallback;
};

const normalizeInterviewReviewPair = (item: unknown): Omit<QaPair, "id"> | null => {
  const source = asRecord(item);
  if (!source) return null;
  const question = textField(source.question);
  if (!question) return null;
  return {
    question,
    originalAnswer: textField(source.originalAnswer) || "待补充原回答。",
    type: textField(source.questionType) || textField(source.type) || "BEHAVIORAL",
    score: numberField(source.score, textField(source.evaluation) || textField(source.critique) ? 3 : 2),
    critique: textField(source.evaluation) || textField(source.critique) || "建议补充更具体的例子、指标和复盘。",
    weak: booleanField(source.weak, true),
    framework: textField(source.improvedFramework) || textField(source.framework) || "情境 -> 任务 -> 行动 -> 结果 -> 复盘",
    optimizedAnswer: textField(source.polishedAnswer) || textField(source.optimizedAnswer) || "按推荐框架重写回答。",
  };
};

export const parseInterviewReviewJson = (input: string): InterviewReviewJsonParseResult => {
  const text = input.trim();
  if (!text.startsWith("{")) return { ok: false, error: "未检测到 InterviewReviewJSON v1：内容需要以 JSON 对象开头。" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON 无法解析：${error instanceof Error ? error.message : "请检查逗号、引号和括号"}` };
  }

  const root = asRecord(parsed);
  if (!root) return { ok: false, error: "JSON 根节点必须是对象。" };
  const version = textField(root.schemaVersion || root.version);
  if (version && version !== "InterviewReviewJSON v1" && version !== "v1" && version !== "1") {
    return { ok: false, error: `不支持的 schemaVersion：${version}。当前支持 InterviewReviewJSON v1。` };
  }

  const rawPairs = Array.isArray(root.qaPairs) ? root.qaPairs : Array.isArray(root.questions) ? root.questions : [];
  const qaPairs = rawPairs.map(normalizeInterviewReviewPair).filter((item): item is Omit<QaPair, "id"> => Boolean(item));
  if (!qaPairs.length) return { ok: false, error: "JSON 里没有有效 qaPairs。每题至少需要 question 字段。" };

  return {
    ok: true,
    review: {
      company: textField(root.company),
      role: textField(root.role),
      round: textField(root.round),
      date: textField(root.date) || "Today",
      sourceText: textField(root.sourceText) || text,
      note: textField(root.note) || "由 InterviewReviewJSON v1 导入，可继续编辑后再生成答案卡。",
      qaPairs,
    },
  };
};

export type ParsedTranscriptQa = Omit<QaPair, "id">;

const cleanTranscriptLine = (line: string) => line.replace(/^\s*[-*•]\s*/, "").trim();

const stripQuestionPrefix = (line: string) =>
  cleanTranscriptLine(line)
    .replace(/^(?:Q\d*|Question\s*\d*|问题\s*\d*|问|面试官(?:问)?|HR\s*问?|追问|又问|接着问|继续问)[:：.)、\s-]*/i, "")
    .trim();

const stripAnswerPrefix = (line: string) =>
  cleanTranscriptLine(line)
    .replace(/^(?:A\d*|Answer\s*\d*|回答\s*\d*|答|候选人|我(?:回答|说)?|本人)[:：.)、\s-]*/i, "")
    .trim();

const inferQaType = (question: string): string => {
  if (/为什么|动机|转岗|职业|选择|离职|优势|缺点/.test(question)) return "MOTIVATION";
  if (/React|TypeScript|性能|状态|架构|系统|算法|代码|技术|工程/i.test(question)) return "TECHNICAL";
  if (/项目|经历|案例|负责|推动|冲突|协作|结果|指标/.test(question)) return "PROJECT";
  return "BEHAVIORAL";
};

const frameworkForType = (type: string) => {
  if (type === "TECHNICAL") return "场景 -> 约束 -> 方案对比 -> 取舍 -> 结果";
  if (type === "MOTIVATION") return "过往能力 -> 转向原因 -> 岗位匹配 -> 未来贡献";
  if (type === "PROJECT") return "背景 -> 目标 -> 动作 -> 指标结果 -> 复盘限制";
  return "情境 -> 任务 -> 行动 -> 结果 -> 复盘";
};

const toParsedQa = (question: string, answer = ""): ParsedTranscriptQa | null => {
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

const parseParagraphQaPairs = (transcript: string): ParsedTranscriptQa[] => {
  const questionMatches = [...transcript.matchAll(/([^。！？\n]{4,160}[?？])/g)];
  return questionMatches
    .map((match, index) => {
      const question = match[0];
      const answerStart = (match.index ?? 0) + question.length;
      const nextStart = questionMatches[index + 1]?.index ?? transcript.length;
      const answer = transcript.slice(answerStart, nextStart).replace(/^[。！？\s，,：:；;、-]+/, "").trim();
      return toParsedQa(question, answer);
    })
    .filter((item): item is ParsedTranscriptQa => Boolean(item))
    .slice(0, 12);
};

export const parseTranscriptQaPairs = (transcript: string): ParsedTranscriptQa[] => {
  const lines = transcript
    .split(/\r?\n/)
    .map(cleanTranscriptLine)
    .filter(Boolean);
  if (!lines.length) return [];

  const parsed: ParsedTranscriptQa[] = [];
  let currentQuestion = "";
  let answerLines: string[] = [];

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

export const createModuleComposerDraft = (resumeId = "", opportunityId = ""): ModuleComposerDraft => ({
  company: "",
  title: "",
  city: "上海",
  deadline: "",
  dueDate: "",
  priority: "B",
  match: "HIGH",
  action: "P1",
  actionManual: false,
  resumeId,
  nextAction: "补齐信息后推进",
  sourceLabel: "模块内新增",
  sourceText: "",
  fileName: "",
  linkedOpportunityId: opportunityId,
  role: "",
  round: "一面",
  date: "Today",
  question: "",
  framework: "背景 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
  answer: "",
  relatedRoles: "",
  roles: "",
  points: "",
  summary: "",
});
