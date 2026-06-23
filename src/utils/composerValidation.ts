import type { ModuleComposer, ModuleComposerDraft, ModuleComposerSource } from "../types";

type AiProvider = "none" | "openai" | "anthropic" | "custom" | string;

export type ComposerAiSettings = {
  provider: AiProvider;
  apiKey: string;
  endpoint: string;
  parseMode: string;
  transcriptionMode: string;
};

export type ComposerValidationField = keyof ModuleComposerDraft | "source" | "upload" | "aiSettings";

export type ComposerValidationError = {
  field: ComposerValidationField;
  message: string;
  hint?: string;
};

export type ComposerValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: ComposerValidationError[] };

type InterviewValidationOptions = {
  inputMode: "review-json" | "raw-transcript";
  parsedQaPairCount: number;
};

type ResumeValidationOptions = {
  requireStoredFile: boolean;
};

const okResult: ComposerValidationResult = { ok: true, errors: [] };

const text = (value: string) => value.trim();

const isPlaceholderText = (value: string, placeholders: string[]) => {
  const normalized = text(value);
  return !normalized || placeholders.includes(normalized);
};

const invalid = (errors: ComposerValidationError[]): ComposerValidationResult => (errors.length ? { ok: false, errors } : okResult);

export const composerValidationMessage = (result: ComposerValidationResult) => {
  if (result.ok) return "";
  const [firstError] = result.errors;
  return [firstError.message, firstError.hint].filter(Boolean).join(" ");
};

export const validateOpportunityComposerDraft = (draft: ModuleComposerDraft, _source: ModuleComposerSource): ComposerValidationResult => {
  const errors: ComposerValidationError[] = [];
  if (isPlaceholderText(draft.company, ["待填写公司"])) {
    errors.push({
      field: "company",
      message: "请填写真实公司名称。",
      hint: "如果是从材料自动识别出的「待填写公司」，需要先手动确认后再创建岗位。",
    });
  }
  if (isPlaceholderText(draft.title, ["待确认岗位", "待填写岗位"])) {
    errors.push({
      field: "title",
      message: "请填写岗位名称。",
      hint: "可以用招聘页标题，或先写一个可识别的方向，例如「前端实习生」。",
    });
  }
  if (!text(draft.sourceText)) {
    errors.push({
      field: "sourceText",
      message: "请补充岗位描述。",
      hint: "回到材料步骤粘贴 JD，或在这里写入岗位职责、要求和投递入口信息。",
    });
  }
  return invalid(errors);
};

export const validateInterviewComposerDraft = (
  draft: ModuleComposerDraft,
  source: ModuleComposerSource,
  options: InterviewValidationOptions,
): ComposerValidationResult => {
  const errors: ComposerValidationError[] = [];
  if (isPlaceholderText(draft.company, ["待填写公司"])) {
    errors.push({
      field: "company",
      message: "请填写真实公司名称。",
      hint: "关联岗位后也可以自动带出公司，但创建前需要确认。",
    });
  }
  if (isPlaceholderText(draft.role, ["待填写岗位", "待确认岗位"])) {
    errors.push({
      field: "role",
      message: "请填写面试岗位。",
      hint: "例如「前端实习生」或「产品经理实习」。",
    });
  }
  if (!text(draft.round)) {
    errors.push({
      field: "round",
      message: "请填写面试轮次。",
      hint: "例如「一面」「二面」或「HR 面」。",
    });
  }
  if (options.inputMode === "review-json" && options.parsedQaPairCount === 0) {
    errors.push({
      field: "source",
      message: "请先导入有效的面试复盘。",
      hint: "复盘内容至少需要一条有效问题；如果只有原始转写稿，请切换到「帮我整理文字稿」。",
    });
  }
  if (options.inputMode === "raw-transcript" && options.parsedQaPairCount === 0) {
    errors.push({
      field: "source",
      message: "请先用智能整理生成复盘。",
      hint: "未整理的面试文稿需要先拆出问题和回答，才能创建正式记录。",
    });
  }
  if (source.uploadStatus === "reading" || source.uploadStatus === "uploading") {
    errors.push({
      field: "upload",
      message: "面试材料还在处理。",
      hint: "请等文件读取或保存完成后再创建。",
    });
  }
  return invalid(errors);
};

export const validateResumeComposerDraft = (
  draft: ModuleComposerDraft,
  source: ModuleComposerSource,
  options: ResumeValidationOptions,
): ComposerValidationResult => {
  const errors: ComposerValidationError[] = [];
  if (!text(draft.title)) {
    errors.push({
      field: "title",
      message: "请填写简历版本名称。",
      hint: "例如「前端实习投递版」或「产品方向 v2」。",
    });
  }
  if (!text(draft.fileName)) {
    errors.push({
      field: "fileName",
      message: "请先选择简历文件。",
      hint: "上传 PDF、DOCX 或可读取的文本文件后再创建版本。",
    });
  }
  if (source.uploadStatus === "reading" || source.uploadStatus === "uploading") {
    errors.push({
      field: "upload",
      message: "简历文件还在读取或保存。",
      hint: "请等状态变成「文件已准备好」后再创建。",
    });
  }
  if (source.uploadStatus === "failed") {
    errors.push({
      field: "upload",
      message: "简历文件读取或保存失败。",
      hint: "请重新选择文件；如果是文本编码问题，可以改用 UTF-8 重新导出。",
    });
  }
  if (options.requireStoredFile && text(draft.fileName) && source.uploadStatus !== "failed" && !source.storageUri) {
    errors.push({
      field: "upload",
      message: "简历文件还没有保存到本地数据库。",
      hint: "请重新选择文件，或确认本地 API 正在运行后再试。",
    });
  }
  return invalid(errors);
};

export const validateAnswerComposerDraft = (draft: ModuleComposerDraft): ComposerValidationResult => {
  if (text(draft.question)) return okResult;
  return {
    ok: false,
    errors: [
      {
        field: "question",
        message: "请填写要沉淀的问题。",
        hint: "例如「如何介绍项目中最难的技术点？」",
      },
    ],
  };
};

export const validateComposerDraft = ({
  composer,
  draft,
  source,
  interviewOptions,
  resumeOptions,
}: {
  composer: ModuleComposer;
  draft: ModuleComposerDraft;
  source: ModuleComposerSource;
  interviewOptions: InterviewValidationOptions;
  resumeOptions: ResumeValidationOptions;
}): ComposerValidationResult => {
  if (composer === "opportunity") return validateOpportunityComposerDraft(draft, source);
  if (composer === "interview") return validateInterviewComposerDraft(draft, source, interviewOptions);
  if (composer === "resume") return validateResumeComposerDraft(draft, source, resumeOptions);
  return validateAnswerComposerDraft(draft);
};

export const isComposerAiProviderConfigured = (settings: ComposerAiSettings) => settings.provider !== "none" && Boolean(settings.apiKey.trim());

export const getComposerAssistRequirement = (
  composer: ModuleComposer,
  sourceKind: ModuleComposerSource["sourceKind"],
  settings: ComposerAiSettings,
) => {
  if (composer === "interview" && sourceKind === "audio" && settings.transcriptionMode !== "assist") {
    return "录音材料需要先在设置里开启「录音转文字」，或直接粘贴转写稿。";
  }
  if (sourceKind === "screenshot" && settings.parseMode !== "assist") {
    return "截图需要先在设置里开启「智能整理」，或改为粘贴岗位描述文字。";
  }
  if ((sourceKind === "screenshot" || (composer === "interview" && sourceKind === "audio")) && !isComposerAiProviderConfigured(settings)) {
    return "请先在设置里选择 AI 服务商并填写 API Key，或改用可直接读取的文字材料。";
  }
  if (composer === "interview" && sourceKind === "audio" && settings.provider === "anthropic") {
    return "录音转文字目前不支持 Anthropic；请改用 OpenAI、兼容接口，或直接粘贴转写稿。";
  }
  if (sourceKind === "screenshot" && settings.provider === "custom" && /api\.example\.com/i.test(settings.endpoint)) {
    return "智能整理服务地址还是示例地址，请在设置里换成真实接口地址。";
  }
  if (sourceKind === "screenshot" && settings.provider === "custom" && settings.endpoint.includes("deepseek.com")) {
    return "当前服务不能直接识别截图；请改用支持图片识别的模型，或直接粘贴岗位描述文字。";
  }
  return "";
};

export const formatComposerApiError = (message: string) => {
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "无法连接本地 API（127.0.0.1:8787）。请确认 npm run dev:local 正在运行，文件保存和智能整理都依赖这个服务。";
  }
  return message || "请求没有返回具体错误信息，请稍后重试。";
};
