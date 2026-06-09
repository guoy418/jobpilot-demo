import type { ComposerSourceKind, ModuleComposer, ModuleComposerDraft, ModuleComposerSource, QaPair } from "./types";

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
  if (/\.(txt|md|docx)$/i.test(lowerName)) return fallback === "interview" ? "transcript" : "jd-text";
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
  deadline: "待定",
  dueDate: "",
  priority: "B",
  match: "HIGH",
  action: "P1",
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
