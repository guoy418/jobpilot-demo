import {
  Archive,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileAudio,
  FileDown,
  FileText,
  Folder,
  FolderOpen,
  Home,
  KanbanSquare,
  Library,
  Moon,
  Pencil,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type CSSProperties, type DragEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { isGarbledTextContent, readTextFile } from "./textEncoding";
import {
  computeOpportunityAction,
  defaultOpportunityNextAction,
  resolveOpportunityAction,
  formatNow,
  getRestorableOpportunityStatus,
  getOpportunityDueDate,
  inferDueDateFromText,
  isOpportunityDueSoon,
  makeId,
  opportunityStatusFlow,
  opportunityStatusNextAction,
  shouldAdvanceLinkedOpportunityAfterInterview,
  sourceKindLabel,
  statusLabel,
  submittedStatuses,
} from "./domain";
import {
  createModuleComposerDraft,
  createModuleComposerSource,
  detectCity,
  detectCompany,
  detectRoleTitle,
  fileBaseName,
  inferComposerSourceKind,
  parseInterviewReviewJson,
  parseTranscriptQaPairs,
} from "./composerModel";
import {
  createAnswerCategoryApi,
  createAnswerCardApi,
  createAnswerCardFromQaPairApi,
  createInterviewSessionApi,
  createOpportunityApi,
  createQaPairApi,
  createResumeVersionApi,
  createWeeklyTaskApi,
  deleteAnswerCardApi,
  deleteAnswerCategoryApi,
  deleteInterviewSessionApi,
  deleteOpportunityApi,
  deleteQaPairApi,
  deleteResumeVersionApi,
  deleteWeeklyTaskApi,
  exportBackupApi,
  getApiHealthApi,
  getDashboardSummaryApi,
  getOpportunitiesApi,
  getTodayActionsApi,
  getWeeklyPlanApi,
  importBackupApi,
  loadInitialApiData,
  parseInterviewApi,
  parseOpportunityApi,
  parseResumeApi,
  progressOpportunityApi,
  type InitialApiData,
  type JobPilotBackup,
  updateAnswerCategoryApi,
  updateAnswerCardApi,
  updateInterviewSessionApi,
  updateOpportunityApi,
  updateQaPairApi,
  updateResumeVersionApi,
  updateWeeklyPlanApi,
  updateWeeklyTaskApi,
  uploadFileApi,
  type ApiHealth,
} from "./apiClient";
import { apiBaseUrl, isApiEnabled, isPublicDemo } from "./appConfig";
import { baseAnswerCards, baseAnswerCategories, baseWeeklyPlan, resumeVersions, seedInterviewSessions, seedOpportunities, uncategorizedAnswerCategoryId } from "./mockData";
import { selectDashboardSummary, selectResumeName, selectTodayActions, type DashboardSummary, type TodayAction } from "./selectors";
import type {
  AnswerCard,
  AnswerCategory,
  ComposerStep,
  InterviewSession,
  ModuleComposer,
  ModuleComposerDraft,
  ModuleComposerSource,
  Opportunity,
  OpportunityAction,
  OpportunityEndReason,
  OpportunityMatch,
  OpportunityPriority,
  OpportunityStatus,
  Page,
  QaPair,
  ResumeVersion,
  SessionFile,
  SourceAsset,
  TimelineEvent,
  ViewMode,
  WeeklyPlan,
  WeeklyTask,
} from "./types";

const navItems: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: "home", label: "今日行动", icon: Home },
  { id: "opportunities", label: "岗位推进", icon: BriefcaseBusiness },
  { id: "interviews", label: "面试复盘", icon: FileAudio },
  { id: "answers", label: "答案库", icon: Library },
  { id: "resumes", label: "简历版本", icon: FileText },
  { id: "weekly", label: "本周计划", icon: CalendarClock },
  { id: "exports", label: "设置备份", icon: FileDown },
];

const primaryNavItems = navItems.filter((item) => item.id === "home" || item.id === "opportunities" || item.id === "weekly");
const libraryNavItems = navItems.filter((item) => item.id === "interviews" || item.id === "answers" || item.id === "resumes");
const systemNavItems = navItems.filter((item) => item.id === "exports");

const reviewPriorityOptions: Array<{ value: OpportunityAction; label: string }> = [
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
];

const interviewReviewJsonPrompt = `你是一名中文面试复盘教练。请根据我提供的面试录音转写稿，整理成一份结构化面试复盘。

请严格遵守：
1. 只输出 JSON，不要 markdown，不要代码块，不要解释。
2. 不要编造没有出现过的问题；如果原回答很短，可以如实保留并在评价里指出不足。
3. 每个问题都要包含：原问题、我的原回答、评价、优化回答框架、可背诵的优化回答。
4. 如果有追问，请先按独立题目扁平输出；可在 question 里写清楚“追问：...”。
5. polishedAnswer 用第一人称中文书面口语，适合我复述，尽量包含背景、动作、结果、反思。

输出格式必须是这个 JSON 结构：
{
  "schemaVersion": "InterviewReviewJSON v1",
  "company": "",
  "role": "",
  "round": "",
  "date": "Today",
  "qaPairs": [
    {
      "question": "",
      "originalAnswer": "",
      "evaluation": "",
      "improvedFramework": "",
      "polishedAnswer": "",
      "questionType": "BEHAVIORAL"
    }
  ],
  "note": ""
}

字段说明：
- company / role / round / date：能从转写稿判断就填写，不确定就留空或写 Today。
- question：面试官原问题，尽量还原真实问法。
- originalAnswer：我的原回答，不要改写成更好的版本。
- evaluation：具体指出原回答哪里弱、缺什么信息、应该怎么补。
- improvedFramework：这题以后应该按什么结构回答。
- polishedAnswer：基于原回答和合理补充，写出优化后的可背诵版本。
- questionType：可选 BEHAVIORAL / PROJECT / TECHNICAL / MOTIVATION / PRODUCT。`;

type ApiDashboardSummary = Partial<DashboardSummary> & {
  weakQaCount?: number;
};

type ApiTodayAction = Partial<TodayAction> & {
  targetPage?: Page;
};

type ApiModeState = {
  status: "checking" | "online" | "offline" | "demo" | "mock";
  dbPath?: string;
  checkedAt?: string;
};

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  eyebrow?: string;
  confirmTone?: "danger" | "primary";
  cancelLabel?: string;
  contentKind?: "end-opportunity";
  onConfirm: () => void;
};

type OpportunityVisibilityFilter = "ACTIVE" | "ENDED" | "ALL";
type OpportunityPriorityFilter = "ALL" | OpportunityAction;
type OpportunityTagFilter = "HIGH_PRIORITY" | "HIGH_MATCH" | "DUE_SOON";

type EndOpportunityDraft = {
  reason: OpportunityEndReason;
  note: string;
};

type WeeklyTaskFormDraft = {
  title: string;
  detail: string;
  level: WeeklyTask["level"];
};

type AnswerCategoryEditorState =
  | {
      mode: "create";
      parentId: string;
      name: string;
    }
  | {
      mode: "rename";
      categoryId: string;
      name: string;
    };

const allAnswerCategoryId = "all";
const activeOpportunityBoardStatuses = opportunityStatusFlow.filter((status) => status !== "ENDED");

const endReasonLabel: Record<OpportunityEndReason, string> = {
  REJECTED: "被拒",
  CLOSED: "岗位关闭",
  WITHDRAWN: "不再考虑",
  OTHER: "其他",
};

const endReasonOptions: Array<{ value: OpportunityEndReason; label: string }> = [
  { value: "REJECTED", label: "被拒" },
  { value: "CLOSED", label: "岗位关闭" },
  { value: "WITHDRAWN", label: "不再考虑" },
  { value: "OTHER", label: "其他" },
];

const opportunityVisibilityOptions: Array<{ value: Extract<OpportunityVisibilityFilter, "ACTIVE" | "ALL">; label: string }> = [
  { value: "ACTIVE", label: "推进中" },
  { value: "ALL", label: "全部记录" },
];

const opportunityPriorityOptions: Array<{ value: OpportunityPriorityFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
];

const opportunityTagOptions: Array<{ value: OpportunityTagFilter; label: string }> = [
  { value: "HIGH_PRIORITY", label: "高意愿" },
  { value: "HIGH_MATCH", label: "高匹配" },
  { value: "DUE_SOON", label: "快截止" },
];

const emptyEndOpportunityDraft = (): EndOpportunityDraft => ({
  reason: "REJECTED",
  note: "",
});

const emptyWeeklyTaskForm = (): WeeklyTaskFormDraft => ({
  title: "",
  detail: "",
  level: "P2",
});

type AiSettings = {
  provider: "none" | "openai" | "anthropic" | "custom";
  model: string;
  apiKey: string;
  parseMode: "mock" | "assist";
  transcriptionMode: "mock" | "assist";
  endpoint: string;
  notes: string;
};
type InterviewInputMode = "review-json" | "raw-transcript";

type AppTheme = "dark" | "light";

const aiSettingsStorageKey = "jobpilot.aiSettings.v1";
const dismissedTodayStorageKey = "jobpilot.dismissedToday.v1";
const themeStorageKey = "jobpilot.theme.v1";
const defaultAiSettings: AiSettings = {
  provider: "none",
  model: "",
  apiKey: "",
  parseMode: "mock",
  transcriptionMode: "mock",
  endpoint: "",
  notes: "",
};

const todayDateKey = () => new Date().toISOString().slice(0, 10);

const todayActionKey = (action: Pick<TodayAction, "page" | "title" | "targetId"> & Partial<Pick<TodayAction, "source" | "taskId">>) =>
  `${action.source ?? action.page}:${action.taskId ?? action.targetId ?? action.title}`;

const todayActionSourceLabel = (action: TodayAction) => {
  if (action.source === "opportunity") return "岗位";
  if (action.source === "interview") return "面试";
  if (action.source === "weekly") return "训练";
  return "待办";
};

const todayActionSourceDetail = (action: TodayAction) => action.sourceLabel || todayActionSourceLabel(action);

const todayActionReason = (action: TodayAction) => {
  if (action.why) return action.why;
  if (action.source === "opportunity") return "岗位当前阶段还有下一步动作，优先级来自状态、截止时间和岗位权重。";
  if (action.source === "interview") return "面试复盘中仍有薄弱或待整理问题。";
  return "本周计划中有仍未完成的行动。";
};

const todayActionOutcome = (action: TodayAction) => {
  if (action.completionOutcome) return action.completionOutcome;
  if (action.source === "opportunity") return "完成后会推进岗位状态，并从今日行动移除。";
  if (action.source === "interview") return "完成后会标记复盘问题已处理；需要长期练习时请加入本周计划。";
  return "完成后会标记本周计划任务为 done。";
};

const historyTimelinePlaceholder = "10.1 投递岗位\n10.5 一面\n10.8 跟进 HR";

const isTimelineOccurredAtPrefix = (value = "") => /^(\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,2})?|\d{1,2}月\d{1,2}(?:日|号)?|Next)$/i.test(value);

const formatOpportunityHistory = (timeline: TimelineEvent[] = []) =>
  timeline
    .filter((event) => event.status === "done")
    .map((event) => [event.occurredAt && event.occurredAt !== "历史" ? event.occurredAt : "", event.title, event.detail ? `- ${event.detail}` : ""].filter(Boolean).join(" "))
    .join("\n");

const parseOpportunityHistory = (value: string, existingTimeline: TimelineEvent[] = []) => {
  const existingDone = existingTimeline.filter((event) => event.status === "done");
  const doneEvents: TimelineEvent[] = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\S+)\s+(.+)$/);
      const hasOccurredAtPrefix = Boolean(match && isTimelineOccurredAtPrefix(match[1]));
      const body = match ? match[2].trim() : line;
      const [title, ...detailParts] = (hasOccurredAtPrefix ? body : line).split(/\s+-\s+/);
      return {
        id: existingDone[index]?.id ?? `TL-HISTORY-${Date.now()}-${index}`,
        occurredAt: hasOccurredAtPrefix ? match![1] : "",
        title: title.trim(),
        detail: detailParts.join(" - ").trim(),
        status: "done" as const,
      };
    });
  return [...doneEvents, ...existingTimeline.filter((event) => event.status === "next")];
};

const pageShowsTopSearch = (currentPage: Page) => currentPage === "opportunities" || currentPage === "interviews" || currentPage === "answers";

const topSearchPlaceholder = (currentPage: Page) => {
  if (currentPage === "interviews") return "搜索公司、岗位、轮次";
  if (currentPage === "answers") return "搜索问题、回答、来源、适用岗位";
  return "搜索岗位、公司、备注";
};

const formatEndedDate = (value?: string | null) => {
  if (!value) return "未记录日期";
  const datePart = value.split("T")[0];
  const dateKeyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  const parsed = dateKeyMatch
    ? new Date(Number(dateKeyMatch[1]), Number(dateKeyMatch[2]) - 1, Number(dateKeyMatch[3]))
    : new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
  }
  return value;
};

const isActiveOpportunityStatus = (status: OpportunityStatus) => status !== "ENDED";

const completedOpportunityStatus = (status: OpportunityStatus): OpportunityStatus | null => {
  if (status === "TO APPLY") return "APPLIED";
  if (status === "APPLIED") return "WRITTEN TEST";
  if (status === "WRITTEN TEST") return "SCREENING";
  if (status === "INTERVIEWING") return "WAITING";
  if (status === "WAITING") return "OFFER";
  return null;
};

const getInterviewTranscriptText = (session: InterviewSession) => {
  const files = session.sourceFiles ?? [];
  const transcriptFile = files.find((file) => file.kind === "transcript" && file.content?.trim());
  if (transcriptFile?.content) return transcriptFile.content.trim();
  const fallbackFile = files.find((file) => file.content?.trim() && !/^(?:录音文件|文字稿文件)[：:]/.test(file.content.trim()));
  return fallbackFile?.content?.trim() ?? "";
};

const fetchErrorHint = (message: string) => {
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "无法连接本地 API（127.0.0.1:8787）。请确认终端里 npm run dev:local 正在运行，然后刷新页面重试。";
  }
  return message;
};

const failedExtractionStatuses = new Set([
  "stored-file-missing",
  "empty-pdf-text",
  "empty-docx-text",
  "ai-not-configured",
  "ocr-unavailable",
  "empty-ocr-text",
  "ocr-provider-failed",
  "transcription-unavailable",
  "empty-transcription-text",
  "transcription-provider-failed",
  "transcription-provider-unsupported",
  "ai-parser-failed",
  "ai-parser-invalid-json",
  "ai-review-empty",
  "unsupported-file-type",
  "file-extraction-failed",
  "text-encoding-failed",
]);

const extractionStatusLabel = (status?: string) => {
  if (!status) return "";
  const labels: Record<string, string> = {
    "local-text": "已读取文本文件",
    "local-pdf-text": "已读取 PDF 内容",
    "local-docx-text": "已读取文档内容",
    "ai-ocr": "已识别图片文字",
    "ai-transcription": "已完成录音转写",
    "interview-json": "已导入复盘内容",
    "ai-not-configured": "请先完成智能整理设置",
    "stored-file-missing": "找不到已上传文件，请重新上传",
    "empty-pdf-text": "PDF 里没有读到文字，请换文件或粘贴文字",
    "empty-docx-text": "文档里没有读到文字，请检查文件内容",
    "ocr-unavailable": "图片识别需要先开启智能整理",
    "empty-ocr-text": "没有识别出文字，请换更清晰的截图",
    "ocr-provider-failed": "图片识别失败，请检查设置后重试",
    "transcription-unavailable": "录音转文字需要先开启",
    "empty-transcription-text": "没有转写出文字，请检查录音内容",
    "transcription-provider-failed": "录音转文字失败，请检查设置或音频格式",
    "transcription-provider-unsupported": "当前服务商不支持录音转写，请用 OpenAI 或兼容接口",
    "ai-review": "已整理面试复盘",
    "ai-parser-failed": "面试复盘整理失败",
    "ai-parser-invalid-json": "整理结果格式不对，请重试",
    "ai-review-empty": "没有整理出有效问题",
    "unsupported-file-type": "当前文件类型不能自动读取",
    "file-extraction-failed": "文件提取失败，请换文件或粘贴文字",
    "text-encoding-failed": "文本编码无法识别，请用 UTF-8 重新导出或直接粘贴文字",
  };
  return labels[status] ?? status;
};

const isAiProviderConfigured = (settings: AiSettings) => settings.provider !== "none" && Boolean(settings.apiKey.trim());

const shouldSendAiSettings = (settings: AiSettings, sourceKind: ModuleComposerSource["sourceKind"], useAssist: boolean) => {
  if (!isAiProviderConfigured(settings)) return false;
  if (useAssist) return true;
  if (sourceKind === "screenshot") return settings.parseMode === "assist";
  if (sourceKind === "audio") return settings.transcriptionMode === "assist";
  return false;
};

const composerAssistRequirement = (composer: ModuleComposer, sourceKind: ModuleComposerSource["sourceKind"], settings: AiSettings) => {
  if (composer === "interview" && sourceKind === "audio" && settings.transcriptionMode !== "assist") {
    return "录音需要先在设置里开启「录音转文字」";
  }
  if (sourceKind === "screenshot" && settings.parseMode !== "assist") {
    return "截图识别需要先在设置里开启「智能整理」";
  }
  if ((sourceKind === "screenshot" || (composer === "interview" && sourceKind === "audio")) && !isAiProviderConfigured(settings)) {
    return "请先在设置里完成智能整理配置";
  }
  if (composer === "interview" && sourceKind === "audio" && settings.provider === "anthropic") {
    return "录音转写目前不支持 Anthropic，请改用 OpenAI 或自定义 OpenAI 兼容接口";
  }
  if (sourceKind === "screenshot" && settings.provider === "custom" && /api\.example\.com/i.test(settings.endpoint)) {
    return "服务地址还是示例地址，请换成真实地址";
  }
  if (sourceKind === "screenshot" && settings.provider === "custom" && settings.endpoint.includes("deepseek.com")) {
    return "当前服务不能直接识别截图，请改用支持图片识别的服务，或直接粘贴文字";
  }
  return "";
};

const uploadStatusLabel = (source: ModuleComposerSource) => {
  if (source.rawText.trim()) return "已读取文字，可以继续";
  if (source.uploadStatus === "reading") return "正在读取文本文件...";
  if (source.uploadStatus === "uploading") return "正在保存文件...";
  if (source.uploadStatus === "stored") return "文件已准备好";
  if (source.uploadStatus === "failed") return "文件保存失败，请重新选择或粘贴文字";
  if (source.uploadStatus === "local-only") return "文件已选择；如无法读取，请直接粘贴文字";
  if (source.fileName) return "文件已选择";
  return "未选择文件";
};

const canRunSourceParse = (source: ModuleComposerSource) => {
  if (source.rawText.trim()) return true;
  if (!source.fileName.trim()) return false;
  if (source.uploadStatus === "reading" || source.uploadStatus === "uploading") return false;
  return Boolean(isApiEnabled && source.storageUri);
};

const timelineWithSyncedNextEvent = (
  timeline: TimelineEvent[],
  status: OpportunityStatus,
  nextAction: string,
  detail = "由当前岗位进度生成下一步动作",
): TimelineEvent[] => [
  ...timeline.filter((event) => event.status !== "next"),
  ...(status !== "OFFER" && status !== "ENDED"
    ? [
        {
          id: makeId("TL"),
          occurredAt: "Next",
          title: nextAction,
          detail,
          status: "next" as const,
        },
      ]
    : []),
];

const normalizeParsedQaPairs = (items: unknown): Array<Omit<QaPair, "id">> => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Partial<QaPair> & {
        evaluation?: unknown;
        improvedFramework?: unknown;
        polishedAnswer?: unknown;
        questionType?: unknown;
      };
      const question = String(source.question ?? "").trim();
      if (!question) return null;
      const score = Number(source.score);
      return {
        question,
        originalAnswer: String(source.originalAnswer ?? "").trim() || "待补充原回答。",
        type: String(source.questionType ?? source.type ?? "").trim() || "BEHAVIORAL",
        score: Number.isFinite(score) ? Math.min(5, Math.max(1, Math.round(score))) : 2,
        critique: String(source.evaluation ?? source.critique ?? "").trim() || "建议补充更具体的例子、指标和复盘。",
        weak: typeof source.weak === "boolean" ? source.weak : true,
        framework: String(source.improvedFramework ?? source.framework ?? "").trim() || "情境 -> 任务 -> 行动 -> 结果 -> 复盘",
        optimizedAnswer: String(source.polishedAnswer ?? source.optimizedAnswer ?? "").trim() || "按推荐框架重写回答。",
      };
    })
    .filter((item): item is Omit<QaPair, "id"> => Boolean(item));
};

const loadDismissedTodayIds = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(dismissedTodayStorageKey) ?? "{}") as { date?: string; ids?: string[] };
    return saved.date === todayDateKey() && Array.isArray(saved.ids) ? new Set(saved.ids) : new Set<string>();
  } catch {
    return new Set<string>();
  }
};

const loadAiSettings = (): AiSettings => {
  try {
    const saved = window.localStorage.getItem(aiSettingsStorageKey);
    return saved ? { ...defaultAiSettings, ...JSON.parse(saved) } : defaultAiSettings;
  } catch {
    return defaultAiSettings;
  }
};

const loadThemePreference = (): AppTheme => {
  try {
    const saved = window.localStorage.getItem(themeStorageKey);
    return saved === "dark" || saved === "light" ? saved : "light";
  } catch {
    return "light";
  }
};

const numberWithFallback = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const normalizeDashboardSummary = (summary: ApiDashboardSummary | null, fallback: DashboardSummary): DashboardSummary => ({
  submittedApplications: numberWithFallback(summary?.submittedApplications, fallback.submittedApplications),
  urgentCount: numberWithFallback(summary?.urgentCount, fallback.urgentCount),
  pendingReviewCount: numberWithFallback(summary?.pendingReviewCount ?? summary?.weakQaCount, fallback.pendingReviewCount),
  toApplyCount: numberWithFallback(summary?.toApplyCount, fallback.toApplyCount),
  inProgressCount: numberWithFallback(summary?.inProgressCount, fallback.inProgressCount),
  p0Count: numberWithFallback(summary?.p0Count, fallback.p0Count),
  p1Count: numberWithFallback(summary?.p1Count, fallback.p1Count),
  weakInterviewCount: numberWithFallback(summary?.weakInterviewCount, fallback.weakInterviewCount),
  applicationGap: numberWithFallback(summary?.applicationGap, fallback.applicationGap),
});

const normalizeTodayActions = (actions: ApiTodayAction[] | null, fallback: TodayAction[]): TodayAction[] => {
  if (!actions?.length) return fallback;
  const validPages = new Set<Page>([...navItems.map((item) => item.id), "opportunityDetail"]);
  const normalizedActions = actions.reduce<TodayAction[]>((items, action) => {
    const page = action.page ?? action.targetPage;
    if (!page || !validPages.has(page) || !action.title) return items;
    items.push({
      level: action.level ?? "P2",
      title: action.title,
      detail: action.detail ?? "",
      page,
      filter: action.filter ?? "",
      source: action.source ?? (page === "opportunityDetail" ? "opportunity" : page === "interviews" ? "interview" : "weekly"),
      sourceLabel: action.sourceLabel,
      why: action.why,
      completionOutcome: action.completionOutcome,
      targetId: action.targetId,
      taskId: action.taskId,
    });
    return items;
  }, []);
  return normalizedActions.length ? normalizedActions : fallback;
};

const GRID_PAGE_SIZE = 6;
const WEEKLY_PRACTICE_FIRST_PAGE_TASKS = 5;
const OPPORTUNITY_TABLE_PAGE_SIZE = 6;
const OPPORTUNITY_BOARD_COLUMN_PAGE_SIZE = 3;

const listPageCount = (length: number, pageSize: number) => Math.max(1, Math.ceil(length / pageSize));

const clampListPage = (page: number, pageCount: number) => Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));

const paginateList = <T,>(items: T[], page: number, pageSize: number) => {
  const pageCount = listPageCount(items.length, pageSize);
  const safePage = clampListPage(page, pageCount);
  return {
    pageCount,
    safePage,
    visible: items.slice(safePage * pageSize, safePage * pageSize + pageSize),
  };
};

const paginateWeeklyGroupTasks = (tasks: WeeklyTask[], page: number, groupId: string) => {
  if (groupId === "practice") {
    const needsSecondPage = tasks.length > WEEKLY_PRACTICE_FIRST_PAGE_TASKS;
    const pageCount = needsSecondPage
      ? 1 + Math.ceil((tasks.length - WEEKLY_PRACTICE_FIRST_PAGE_TASKS) / GRID_PAGE_SIZE)
      : 1;
    const safePage = clampListPage(page, pageCount);
    if (safePage === 0) {
      return {
        pageCount,
        safePage,
        visible: tasks.slice(0, WEEKLY_PRACTICE_FIRST_PAGE_TASKS),
      };
    }
    const start = WEEKLY_PRACTICE_FIRST_PAGE_TASKS + (safePage - 1) * GRID_PAGE_SIZE;
    return {
      pageCount,
      safePage,
      visible: tasks.slice(start, start + GRID_PAGE_SIZE),
    };
  }
  return paginateList(tasks, page, GRID_PAGE_SIZE);
};

const isOpenWeeklyTask = (task: WeeklyTask) => task.status === "open";

const openNativeDatePicker = (input: HTMLInputElement | null) => {
  if (!input) return;
  input.focus();
  try {
    input.showPicker?.();
  } catch {
    // showPicker requires a direct user gesture in some browsers; focus keeps the field usable.
  }
};

function DatePickerInput({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="date-picker-control">
      <input
        id={id}
        ref={inputRef}
        type="date"
        value={value}
        aria-label={label}
        onClick={(event) => openNativeDatePicker(event.currentTarget)}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="date-picker-button"
        aria-label={`打开${label}选择器`}
        onClick={() => openNativeDatePicker(inputRef.current)}
      >
        <CalendarClock size={16} />
      </button>
    </div>
  );
}

function OpportunityCombobox({
  opportunities,
  value,
  onChange,
  emptyLabel,
  searchPlaceholder = "搜索公司、岗位或城市",
}: {
  opportunities: Opportunity[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useMemo(() => `opportunity-combobox-listbox-${makeId("CB")}`, []);
  const selectedOpportunity = opportunities.find((opportunity) => opportunity.id === value);
  const filteredOpportunities = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return opportunities;
    return opportunities.filter((opportunity) => {
      if (opportunity.id === value) return true;
      return `${opportunity.company} ${opportunity.title} ${opportunity.city}`.toLowerCase().includes(keyword);
    });
  }, [opportunities, search, value]);

  const chooseOpportunity = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", closeFromOutside);
    return () => document.removeEventListener("mousedown", closeFromOutside);
  }, [open]);

  return (
    <div className="opportunity-combobox" ref={rootRef}>
      <button
        type="button"
        className="opportunity-combobox-trigger"
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setSearch("");
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-label={selectedOpportunity ? `当前关联岗位：${selectedOpportunity.company} / ${selectedOpportunity.title}` : emptyLabel}
      >
        <span>{selectedOpportunity ? `${selectedOpportunity.company} / ${selectedOpportunity.title}` : emptyLabel}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="opportunity-combobox-menu" id={listboxId} role="listbox" aria-label="选择关联岗位">
          <input
            autoFocus
            value={search}
            aria-label="搜索关联岗位"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                setSearch("");
              }
            }}
            placeholder={searchPlaceholder}
          />
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={!value ? "selected-option" : ""}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => chooseOpportunity("")}
          >
            {emptyLabel}
          </button>
          {filteredOpportunities.map((opportunity) => (
            <button
              type="button"
              role="option"
              aria-selected={opportunity.id === value}
              className={opportunity.id === value ? "selected-option" : ""}
              key={opportunity.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOpportunity(opportunity.id)}
            >
              <strong>{opportunity.company} / {opportunity.title}</strong>
              <span>{opportunity.city} · {statusLabel[opportunity.status]}</span>
            </button>
          ))}
          {filteredOpportunities.length === 0 ? <p>没有匹配的岗位</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("home");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [theme, setTheme] = useState<AppTheme>(() => loadThemePreference());
  const [libraryNavOpen, setLibraryNavOpen] = useState(true);
  const [showMoreTodayActions, setShowMoreTodayActions] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>(seedOpportunities);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(seedOpportunities[0].id);
  const [opportunityHistoryDrafts, setOpportunityHistoryDrafts] = useState<Record<string, string>>({});
  const [interviewSessions, setInterviewSessions] = useState(seedInterviewSessions);
  const [selectedInterviewId, setSelectedInterviewId] = useState(seedInterviewSessions[0].id);
  const [selectedQaId, setSelectedQaId] = useState(seedInterviewSessions[0].qaPairs[0].id);
  const [query, setQuery] = useState("");
  const [interviewPage, setInterviewPage] = useState(0);
  const [answerPage, setAnswerPage] = useState(0);
  const [opportunityPage, setOpportunityPage] = useState(0);
  const [resumeLinkedOpportunityPage, setResumeLinkedOpportunityPage] = useState(0);
  const [weeklyInterviewPage, setWeeklyInterviewPage] = useState(0);
  const [weeklyPracticePage, setWeeklyPracticePage] = useState(0);
  const [interviewView, setInterviewView] = useState<"list" | "session" | "question">("list");
  const [answerView, setAnswerView] = useState<"list" | "detail">("list");
  const [randomPracticeAnswerId, setRandomPracticeAnswerId] = useState("");
  const [randomPracticeSpinning, setRandomPracticeSpinning] = useState(false);
  const [randomPracticeReveal, setRandomPracticeReveal] = useState(false);
  const [opportunityVisibility, setOpportunityVisibility] = useState<OpportunityVisibilityFilter>("ACTIVE");
  const [opportunityPriorityFilter, setOpportunityPriorityFilter] = useState<OpportunityPriorityFilter>("ALL");
  const [opportunityTagFilters, setOpportunityTagFilters] = useState<OpportunityTagFilter[]>([]);
  const [systemMessage, setSystemMessage] = useState("准备好了");
  const [apiMode, setApiMode] = useState<ApiModeState>(() =>
    isPublicDemo ? { status: "demo" } : isApiEnabled ? { status: "checking" } : { status: "mock" },
  );
  const [answerCards, setAnswerCards] = useState<AnswerCard[]>(baseAnswerCards);
  const [answerCategories, setAnswerCategories] = useState<AnswerCategory[]>(baseAnswerCategories);
  const [selectedAnswerCategoryId, setSelectedAnswerCategoryId] = useState(allAnswerCategoryId);
  const [expandedAnswerCategoryIds, setExpandedAnswerCategoryIds] = useState<Set<string>>(
    () => new Set(baseAnswerCategories.filter((category) => !category.system && !category.parentId).map((category) => category.id)),
  );
  const [answerCategoryEditor, setAnswerCategoryEditor] = useState<AnswerCategoryEditorState | null>(null);
  const [openAnswerCategoryMenuId, setOpenAnswerCategoryMenuId] = useState("");
  const [answerCategorySidebarCollapsed, setAnswerCategorySidebarCollapsed] = useState(false);
  const [draggedAnswerCardId, setDraggedAnswerCardId] = useState("");
  const [answerCategoryDropTargetId, setAnswerCategoryDropTargetId] = useState("");
  const [selectedAnswerId, setSelectedAnswerId] = useState(baseAnswerCards[0].id);
  const [resumeList, setResumeList] = useState<ResumeVersion[]>(resumeVersions);
  const [selectedResumeId, setSelectedResumeId] = useState(resumeVersions[0].id);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan>(baseWeeklyPlan);
  const [weeklyTargetDraft, setWeeklyTargetDraft] = useState(String(Math.max(0, baseWeeklyPlan.targetApplications)));
  const [apiDashboardSummary, setApiDashboardSummary] = useState<ApiDashboardSummary | null>(null);
  const [apiTodayActions, setApiTodayActions] = useState<ApiTodayAction[] | null>(null);
  const [previewAsset, setPreviewAsset] = useState<SourceAsset | null>(null);
  const [previewSessionFile, setPreviewSessionFile] = useState<SessionFile | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [endOpportunityDraft, setEndOpportunityDraft] = useState<EndOpportunityDraft>(() => emptyEndOpportunityDraft());
  const [weeklyTaskForm, setWeeklyTaskForm] = useState<WeeklyTaskFormDraft | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [dismissedTodayIds, setDismissedTodayIds] = useState<Set<string>>(() => loadDismissedTodayIds());
  const [composer, setComposer] = useState<ModuleComposer | null>(null);
  const [composerStep, setComposerStep] = useState<ComposerStep>("source");
  const [composerSource, setComposerSource] = useState<ModuleComposerSource>(() => createModuleComposerSource());
  const [composerParsedQaPairs, setComposerParsedQaPairs] = useState<Array<Omit<QaPair, "id">>>([]);
  const [interviewInputMode, setInterviewInputMode] = useState<InterviewInputMode>("review-json");
  const [composerParseNotice, setComposerParseNotice] = useState("");
  const [composerParsing, setComposerParsing] = useState(false);
  const [interviewReparseBusy, setInterviewReparseBusy] = useState(false);
  const [interviewReparseNotice, setInterviewReparseNotice] = useState("");
  const [composerDraft, setComposerDraft] = useState<ModuleComposerDraft>(() =>
    createModuleComposerDraft(resumeVersions[0]?.id ?? "", seedOpportunities[0]?.id ?? ""),
  );
  const apiOpportunityIdsRef = useRef(new Set(seedOpportunities.map((item) => item.id)));
  const endOpportunityDraftRef = useRef<EndOpportunityDraft>(emptyEndOpportunityDraft());
  const modalBackdropPointerStartedRef = useRef(false);

  const markApiOnline = (health?: ApiHealth) => {
    setApiMode({ status: "online", dbPath: health?.dbPath, checkedAt: new Date().toLocaleTimeString() });
  };

  const refreshApiHealth = () => {
    if (!isApiEnabled) {
      setApiMode(isPublicDemo ? { status: "demo" } : { status: "mock" });
      return;
    }
    setApiMode((state) => ({ ...state, status: "checking" }));
    void getApiHealthApi()
      .then((health) => {
        if (health.ok) {
          markApiOnline(health);
          setSystemMessage("已连接");
        } else {
          setApiMode({ status: "offline", checkedAt: new Date().toLocaleTimeString() });
          setSystemMessage("连接异常");
        }
      })
      .catch(() => {
        setApiMode({ status: "offline", checkedAt: new Date().toLocaleTimeString() });
        setSystemMessage("暂时离线");
      });
  };

  const applyLoadedData = (data: InitialApiData | JobPilotBackup) => {
    const firstActiveOpportunity = data.opportunities.find((item) => item.status !== "ENDED") ?? data.opportunities[0];
    setOpportunities(data.opportunities);
    apiOpportunityIdsRef.current = new Set(data.opportunities.map((item) => item.id));
    setSelectedOpportunityId(firstActiveOpportunity?.id ?? "");
    setInterviewSessions(data.interviewSessions);
    setSelectedInterviewId(data.interviewSessions[0]?.id ?? "");
    setSelectedQaId(data.interviewSessions[0]?.qaPairs[0]?.id ?? "");
    setAnswerCards(data.answerCards);
    const loadedAnswerCategories = data.answerCategories?.length ? data.answerCategories : baseAnswerCategories;
    setAnswerCategories(loadedAnswerCategories);
    setSelectedAnswerCategoryId(allAnswerCategoryId);
    setExpandedAnswerCategoryIds(new Set(loadedAnswerCategories.filter((category) => !category.system && !category.parentId).map((category) => category.id)));
    setSelectedAnswerId(data.answerCards[0]?.id ?? "");
    setResumeList(data.resumeVersions);
    setSelectedResumeId(data.resumeVersions[0]?.id ?? "");
    setWeeklyPlan(data.weeklyPlan);
    setApiDashboardSummary("dashboardSummary" in data ? data.dashboardSummary : null);
    setApiTodayActions("todayActions" in data ? data.todayActions : null);
    setComposerDraft(createModuleComposerDraft(data.resumeVersions[0]?.id ?? "", data.opportunities[0]?.id ?? ""));
  };

  useEffect(() => {
    if (!isApiEnabled) {
      setSystemMessage(isPublicDemo ? "演示模式" : "使用本机数据");
      setApiMode(isPublicDemo ? { status: "demo" } : { status: "mock" });
      return;
    }

    let cancelled = false;
    Promise.all([getApiHealthApi(), loadInitialApiData()])
      .then(([health, data]) => {
        if (cancelled) return;
        markApiOnline(health);
        applyLoadedData(data);
        setSystemMessage("数据已加载");
      })
      .catch(() => {
        if (!cancelled) {
          setApiMode({ status: "offline", checkedAt: new Date().toLocaleTimeString() });
          setSystemMessage("使用本机数据");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    window.localStorage.setItem(dismissedTodayStorageKey, JSON.stringify({ date: todayDateKey(), ids: [...dismissedTodayIds] }));
  }, [dismissedTodayIds]);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    setInterviewReparseNotice("");
  }, [selectedInterviewId]);

  const refreshApiInsights = () => {
    if (!isApiEnabled) return;
    void Promise.all([getDashboardSummaryApi(), getTodayActionsApi()])
      .then(([summary, actions]) => {
        setApiDashboardSummary(summary);
        setApiTodayActions(actions);
      })
      .catch(() => {
        setApiDashboardSummary(null);
        setApiTodayActions(null);
      });
  };

  const invalidateApiInsights = () => {
    setApiDashboardSummary(null);
    setApiTodayActions(null);
  };

  const refreshApiWeeklyPlan = () => {
    if (!isApiEnabled) return;
    void getWeeklyPlanApi()
      .then(setWeeklyPlan)
      .catch(() => setSystemMessage("本周计划已保存在本机"));
  };

  const selectedOpportunity = opportunities.find((item) => item.id === selectedOpportunityId) ?? opportunities.find((item) => item.status !== "ENDED") ?? opportunities[0];
  const selectedInterview = interviewSessions.find((item) => item.id === selectedInterviewId) ?? interviewSessions[0];
  const selectedQa = selectedInterview.qaPairs.find((item) => item.id === selectedQaId) ?? selectedInterview.qaPairs[0];
  const selectedAnswer = answerCards.find((item) => item.id === selectedAnswerId) ?? answerCards[0];
  const selectedResume = resumeList.find((item) => item.id === selectedResumeId) ?? resumeList[0];
  const localDashboardSummary = selectDashboardSummary(opportunities, interviewSessions, weeklyPlan);
  const dashboardSummary = normalizeDashboardSummary(apiDashboardSummary, localDashboardSummary);
  const {
    submittedApplications,
    urgentCount,
    pendingReviewCount,
    toApplyCount,
    inProgressCount,
    p0Count,
    p1Count,
    weakInterviewCount,
    applicationGap,
  } = dashboardSummary;
  const getResumeName = (resumeId: string) => selectResumeName(resumeList, resumeId);
  const localTodayActions = selectTodayActions(opportunities, interviewSessions, answerCards, weeklyPlan, resumeList);
  const hydratedTodayActions = normalizeTodayActions(apiTodayActions, localTodayActions);
  const todayActions = hydratedTodayActions.filter((action) => !dismissedTodayIds.has(todayActionKey(action)));
  const hasWeeklyTarget = weeklyPlan.targetApplications > 0;
  const weeklyTargetApplications = Math.max(0, weeklyPlan.targetApplications);
  const weeklyProgressPercent = hasWeeklyTarget ? Math.min(100, (submittedApplications / weeklyTargetApplications) * 100) : 0;
  useEffect(() => {
    setWeeklyTargetDraft(String(weeklyTargetApplications));
  }, [weeklyTargetApplications]);
  const topTodayActions = todayActions.slice(0, 3);
  const moreTodayActions = todayActions.slice(3);
  const normalizedQuery = query.trim().toLowerCase();
  const sortAnswerCategories = (left: AnswerCategory, right: AnswerCategory) =>
    left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hans-CN") || left.id.localeCompare(right.id);
  const answerCategoryById = useMemo(() => new Map(answerCategories.map((category) => [category.id, category])), [answerCategories]);
  const answerCategoryChildren = useMemo(() => {
    const children = new Map<string, AnswerCategory[]>();
    answerCategories.forEach((category) => {
      if (!category.parentId || !answerCategoryById.has(category.parentId)) return;
      const items = children.get(category.parentId) ?? [];
      items.push(category);
      children.set(category.parentId, items);
    });
    children.forEach((items) => items.sort(sortAnswerCategories));
    return children;
  }, [answerCategories, answerCategoryById]);
  const rootAnswerCategories = useMemo(
    () => answerCategories.filter((category) => !category.parentId || !answerCategoryById.has(category.parentId)).sort(sortAnswerCategories),
    [answerCategories, answerCategoryById],
  );
  const resolveAnswerCategoryId = (card: AnswerCard) =>
    card.categoryId && answerCategoryById.has(card.categoryId) ? card.categoryId : uncategorizedAnswerCategoryId;
  const isAllAnswerCategorySelected = selectedAnswerCategoryId === allAnswerCategoryId;
  const selectedAnswerCategory = answerCategoryById.get(selectedAnswerCategoryId) ?? answerCategoryById.get(uncategorizedAnswerCategoryId) ?? baseAnswerCategories[0];
  const selectedAnswerCategoryIds = useMemo(() => {
    if (selectedAnswerCategoryId === allAnswerCategoryId) return new Set(answerCategories.map((category) => category.id));
    const ids = new Set<string>();
    const collect = (categoryId: string) => {
      ids.add(categoryId);
      (answerCategoryChildren.get(categoryId) ?? []).forEach((child) => collect(child.id));
    };
    collect(answerCategoryById.has(selectedAnswerCategoryId) ? selectedAnswerCategoryId : uncategorizedAnswerCategoryId);
    return ids;
  }, [answerCategories, answerCategoryById, answerCategoryChildren, selectedAnswerCategoryId]);
  const answerCategoryCounts = useMemo(() => {
    const directCounts = new Map<string, number>();
    answerCards.forEach((card) => {
      const categoryId = card.categoryId && answerCategoryById.has(card.categoryId) ? card.categoryId : uncategorizedAnswerCategoryId;
      directCounts.set(categoryId, (directCounts.get(categoryId) ?? 0) + 1);
    });
    const aggregateCounts = new Map<string, number>();
    const countWithChildren = (categoryId: string): number => {
      const total =
        (directCounts.get(categoryId) ?? 0) +
        (answerCategoryChildren.get(categoryId) ?? []).reduce((count, child) => count + countWithChildren(child.id), 0);
      aggregateCounts.set(categoryId, total);
      return total;
    };
    answerCategories.forEach((category) => countWithChildren(category.id));
    return aggregateCounts;
  }, [answerCards, answerCategories, answerCategoryById, answerCategoryChildren]);
  const answerCategoryOptions = useMemo(() => {
    const options: Array<{ category: AnswerCategory; label: string }> = [];
    const append = (category: AnswerCategory, depth: number) => {
      options.push({ category, label: `${"　".repeat(depth)}${category.name}` });
      (answerCategoryChildren.get(category.id) ?? []).forEach((child) => append(child, depth + 1));
    };
    rootAnswerCategories.forEach((category) => append(category, 0));
    return options;
  }, [answerCategoryChildren, rootAnswerCategories]);
  const selectedAnswerCategoryLabel = isAllAnswerCategorySelected ? "全部答案" : selectedAnswerCategory.name;
  const selectedAnswerCategoryTotal = isAllAnswerCategorySelected ? answerCards.length : answerCategoryCounts.get(selectedAnswerCategory.id) ?? 0;
  const filteredInterviewSessions = interviewSessions.filter((session) =>
    `${session.company} ${session.role} ${session.round} ${session.date}`.toLowerCase().includes(normalizedQuery),
  );
  const interviewList = paginateList(filteredInterviewSessions, interviewPage, GRID_PAGE_SIZE);
  const visibleInterviewSessions = interviewList.visible;
  const interviewPageCount = interviewList.pageCount;
  const safeInterviewPage = interviewList.safePage;
  const filteredAnswerCards = useMemo(
    () =>
      answerCards.filter((card) => {
        const haystack = `${card.question} ${card.answer} ${card.framework} ${card.source} ${card.relatedRoles} ${card.type} ${card.status} ${card.practiceStatus}`.toLowerCase();
        return (isAllAnswerCategorySelected || selectedAnswerCategoryIds.has(resolveAnswerCategoryId(card))) && haystack.includes(normalizedQuery);
      }),
    [answerCards, normalizedQuery, isAllAnswerCategorySelected, selectedAnswerCategoryIds, answerCategoryById],
  );
  const randomPracticeCard = filteredAnswerCards.find((card) => card.id === randomPracticeAnswerId);
  const answerList = paginateList(filteredAnswerCards, answerPage, GRID_PAGE_SIZE);
  const visibleAnswerCards = answerList.visible;
  const answerPageCount = answerList.pageCount;
  const safeAnswerPage = answerList.safePage;
  useEffect(() => {
    if (selectedAnswerCategoryId !== allAnswerCategoryId && !answerCategoryById.has(selectedAnswerCategoryId)) {
      setSelectedAnswerCategoryId(uncategorizedAnswerCategoryId);
    }
  }, [answerCategoryById, selectedAnswerCategoryId]);
  const openWeeklyTasks = useMemo(() => weeklyPlan.tasks.filter(isOpenWeeklyTask), [weeklyPlan.tasks]);
  const weeklyTaskGroups = useMemo(
    () =>
      [
        {
          id: "interview",
          title: "面试表达练习",
          detail: "从面试复盘或答案卡中选择想练的问题，添加到这里。",
          examples: ["重讲一个薄弱项目题", "把答案卡练到能自然复述"],
          tasks: openWeeklyTasks.filter((task) => task.source === "interview" || task.source === "answer"),
        },
        {
          id: "practice",
          title: "自主训练",
          detail: "手动添加笔试、作品集、英语和材料整理等其他任务。",
          examples: ["练一道笔试题", "整理一版项目表达"],
          tasks: openWeeklyTasks.filter((task) => task.source === "manual" || task.source === "weekly-focus"),
        },
      ],
    [openWeeklyTasks],
  );
  const visibleTrainingTaskCount = weeklyTaskGroups.reduce((count, group) => count + group.tasks.length, 0);

  const selectOpportunityPriorityFilter = (nextFilter: OpportunityPriorityFilter) => {
    setOpportunityPriorityFilter(nextFilter);
    setOpportunityPage(0);
  };

  const toggleOpportunityTagFilter = (tag: OpportunityTagFilter) => {
    setOpportunityTagFilters((currentFilters) =>
      currentFilters.includes(tag) ? currentFilters.filter((item) => item !== tag) : [...currentFilters, tag],
    );
    setOpportunityPage(0);
  };

  const clearOpportunitySearchAndFilters = () => {
    setQuery("");
    setOpportunityVisibility("ACTIVE");
    setOpportunityPriorityFilter("ALL");
    setOpportunityTagFilters([]);
    setOpportunityPage(0);
    setSystemMessage("已清除岗位筛选");
  };

  const selectOpportunityViewMode = (nextViewMode: ViewMode) => {
    if (nextViewMode === viewMode) return;
    setViewMode(nextViewMode);
    setOpportunityPage(0);
  };

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((item) => {
      const resumeName = resumeList.find((resume) => resume.id === item.resumeId)?.name ?? item.resumeId;
      const haystack = `${item.title} ${item.company} ${item.city} ${item.nextAction} ${resumeName}`.toLowerCase();
      const matchesQuery = haystack.includes(normalizedQuery);
      const matchesVisibility =
        opportunityVisibility === "ALL" ||
        (opportunityVisibility === "ACTIVE" && isActiveOpportunityStatus(item.status)) ||
        (opportunityVisibility === "ENDED" && item.status === "ENDED");
      const computedAction = resolveOpportunityAction(item);
      const matchesPriority = opportunityPriorityFilter === "ALL" || computedAction === opportunityPriorityFilter;
      const matchesTags = opportunityTagFilters.every((tag) => {
        if (tag === "HIGH_PRIORITY") return item.priority === "A";
        if (tag === "HIGH_MATCH") return item.match === "HIGH";
        return isOpportunityDueSoon(item);
      });
      return matchesVisibility && matchesPriority && matchesTags && matchesQuery;
    });
  }, [opportunities, normalizedQuery, opportunityPriorityFilter, opportunityTagFilters, resumeList, opportunityVisibility]);
  const opportunityList = paginateList(filteredOpportunities, opportunityPage, OPPORTUNITY_TABLE_PAGE_SIZE);
  const visibleTableOpportunities = opportunityList.visible;
  const opportunityPageCount = opportunityList.pageCount;
  const safeOpportunityPage = opportunityList.safePage;
  const hasOpportunitySearchOrFilters =
    normalizedQuery.length > 0 || opportunityVisibility !== "ACTIVE" || opportunityPriorityFilter !== "ALL" || opportunityTagFilters.length > 0;

  const linkedResumeOpportunities = selectedResume
    ? opportunities.filter((item) => item.resumeId === selectedResume.id || selectedResume.linkedOpportunityIds.includes(item.id))
    : [];
  const linkedResumeOpportunityList = paginateList(linkedResumeOpportunities, resumeLinkedOpportunityPage, 2);
  const visibleLinkedResumeOpportunities = linkedResumeOpportunityList.visible;
  const selectedOpportunityAction = selectedOpportunity ? resolveOpportunityAction(selectedOpportunity) : "P2";
  const selectedOpportunitySuggestedAction = selectedOpportunity ? computeOpportunityAction(selectedOpportunity) : "P2";
  const selectedOpportunityActionHint =
    selectedOpportunity && selectedOpportunity.actionManual
      ? `已手动设为 ${selectedOpportunityAction}；自动建议为 ${selectedOpportunitySuggestedAction}。`
      : `根据状态、截止日和主观优先级自动计算，当前为 ${selectedOpportunityAction}。`;
  const selectedOpportunityHistoryDraft = selectedOpportunity
    ? opportunityHistoryDrafts[selectedOpportunity.id] ?? formatOpportunityHistory(selectedOpportunity.timeline)
    : "";
  const selectedOpportunityEnded = selectedOpportunity?.status === "ENDED";
  const selectedOpportunityEndReason = selectedOpportunity?.endedReason ? endReasonLabel[selectedOpportunity.endedReason] : "其他";
  const selectedOpportunityHeaderAction = selectedOpportunityEnded ? "已结束" : selectedOpportunityAction;
  const visibleOpportunitySourceAssets = selectedOpportunity
    ? selectedOpportunity.sourceAssets.filter((asset) => asset.kind === "job-link" || asset.kind === "screenshot" || Boolean(asset.storageUri))
    : [];

  const resetListNavigation = () => {
    setInterviewPage(0);
    setAnswerPage(0);
    setOpportunityPage(0);
    setWeeklyInterviewPage(0);
    setWeeklyPracticePage(0);
  };

  const goTo = (nextPage: Page) => {
    setPage(nextPage);
    if (nextPage !== page) {
      setQuery("");
      resetListNavigation();
    }
    const label = navItems.find((item) => item.id === nextPage)?.label ?? "页面";
    setSystemMessage(`已打开${label}`);
  };

  const openComposer = (kind: ModuleComposer, linkedOpportunityId = "") => {
    setComposer(kind);
    setComposerStep(kind === "answer" ? "review" : "source");
    setInterviewInputMode("review-json");
    setComposerSource(createModuleComposerSource(kind === "resume" ? "resume-file" : kind === "interview" ? "transcript" : kind === "opportunity" ? "jd-text" : "manual"));
    setComposerParsedQaPairs([]);
    setComposerParseNotice("");
    setComposerParsing(false);
    setComposerDraft(createModuleComposerDraft(resumeList[0]?.id ?? "", linkedOpportunityId));
    setSystemMessage(
      kind === "opportunity"
        ? "开始新增岗位"
        : kind === "interview"
          ? "开始新增面试复盘"
          : kind === "resume"
            ? "开始上传简历"
            : "开始新增答案卡",
    );
  };

  const updateAiSettings = (patch: Partial<AiSettings>) => {
    setAiSettings((settings) => ({ ...settings, ...patch }));
  };

  const updateComposerSource = (field: keyof ModuleComposerSource, value: string) => {
    setComposerSource((source) => ({ ...source, [field]: value } as ModuleComposerSource));
  };

  const updateComposerDraft = <Field extends keyof ModuleComposerDraft>(field: Field, value: ModuleComposerDraft[Field]) => {
    setComposerDraft((draft) => ({ ...draft, [field]: value } as ModuleComposerDraft));
  };

  const handleComposerFileSelected = (fileList: FileList | null) => {
    if (!composer) return;
    const file = fileList?.[0];
    if (!file) return;
    const sourceKind = inferComposerSourceKind(file.name, composer);
    setComposerSource((source) => ({
      ...source,
      fileName: file.name,
      sourceKind,
      rawText: "",
      storageUri: undefined,
      extractionStatus: undefined,
      uploadStatus: isApiEnabled ? "uploading" : "local-only",
      fileSize: `${Math.max(1, Math.round(file.size / 1024))} KB`,
    }));
    setComposerParseNotice("");
    setSystemMessage("已选择材料");

    if (/\.(txt|md|json)$/i.test(file.name)) {
      setSystemMessage("正在读取文件");
      setComposerSource((source) => ({ ...source, uploadStatus: "reading" }));
      void readTextFile(file)
        .then((decoded) => {
          if (decoded.garbled) {
            setComposerSource((source) => ({
              ...source,
              rawText: "",
              extractionStatus: "text-encoding-failed",
              uploadStatus: "failed",
            }));
            setComposerParseNotice("文本文件编码无法识别，看起来像乱码。请用 UTF-8 重新导出转写稿，或直接粘贴文字内容。");
            setSystemMessage("文本编码无法识别");
            return;
          }
          setComposerSource((source) => ({
            ...source,
            rawText: decoded.text,
            extractionStatus: "local-text",
            uploadStatus: isApiEnabled ? source.uploadStatus : "stored",
          }));
          setSystemMessage("文件已读取");
        })
        .catch(() => {
          setComposerSource((source) => ({ ...source, uploadStatus: "failed" }));
          setSystemMessage("文件读取失败");
        });
    }

    if (isApiEnabled) {
      void uploadFileApi(file)
        .then((storedFile) => {
          setComposerSource((source) => ({
            ...source,
            storageUri: storedFile.storageUri,
            fileSize: storedFile.fileSize,
            uploadStatus: "stored",
          }));
          setSystemMessage("文件已保存");
        })
        .catch(() => {
          setComposerSource((source) => ({ ...source, uploadStatus: "local-only" }));
          setSystemMessage("文件已选择");
        });
    }
  };

  const runComposerParse = async () => {
    if (!composer || composerParsing) return;
    const rawText = composerSource.rawText.trim();
    const sourceInputText = composer === "opportunity" && composerSource.sourceKind === "job-link"
      ? `${composerSource.note.trim()} ${rawText}`.trim()
      : rawText;
    const fileName = composerSource.fileName.trim();
    if (composer !== "answer" && !sourceInputText && !fileName) {
      setComposerParseNotice(
        composer === "interview" && interviewInputMode === "review-json"
          ? "请粘贴或上传已经整理好的复盘文档。"
          : "请先上传文件，或粘贴文字内容。",
      );
      setSystemMessage("请先选择材料");
      return;
    }
    if (composer !== "answer" && fileName && !sourceInputText && isApiEnabled && !composerSource.storageUri) {
      setComposerParseNotice("文件还在保存，请稍等几秒后再继续。");
      setSystemMessage("请稍等文件保存");
      return;
    }

    const assistRequirement = composer !== "answer" ? composerAssistRequirement(composer, composerSource.sourceKind, aiSettings) : "";
    if (assistRequirement && !sourceInputText) {
      setComposerSource((source) => ({
        ...source,
        extractionStatus: composerSource.sourceKind === "audio" ? "transcription-unavailable" : "ocr-unavailable",
      }));
      setComposerParseNotice(assistRequirement);
      setSystemMessage("需要先完成设置");
      return;
    }

    const parseText = `${sourceInputText} ${fileBaseName(fileName)}`.trim();
    const defaultResumeId = composerDraft.resumeId || resumeList[0]?.id || "";
    const linkedOpportunity = opportunities.find((item) => item.id === composerDraft.linkedOpportunityId);

    if (composer === "interview" && rawText.startsWith("{")) {
      const imported = parseInterviewReviewJson(rawText);
      if (!imported.ok) {
        setComposerParseNotice(imported.error);
        setSystemMessage("复盘内容格式不对");
        return;
      }
      setComposerParsedQaPairs(imported.review.qaPairs);
      setComposerSource((source) => ({ ...source, extractionStatus: "interview-json" }));
      setComposerDraft((draft) => ({
        ...draft,
        linkedOpportunityId: draft.linkedOpportunityId,
        company: imported.review.company || linkedOpportunity?.company || draft.company || "待填写公司",
        role: imported.review.role || linkedOpportunity?.title || draft.role || "待填写岗位",
        round: imported.review.round || draft.round || "一面",
        date: imported.review.date || draft.date || "Today",
        fileName: fileName || draft.fileName || "interview-review.json",
        sourceText: imported.review.sourceText,
        nextAction: imported.review.note,
      }));
      setComposerStep("review");
      setComposerParseNotice("");
      setSystemMessage("复盘内容已导入");
      return;
    }

    if (composer === "interview" && interviewInputMode === "review-json") {
      setComposerParseNotice("请粘贴已经整理好的复盘文档。它应该包含原问题、原回答、评价、优化框架和优化回答；如果你只有原始转写稿，请切换到「帮我整理文字稿」。");
      setSystemMessage("请粘贴整理好的复盘内容");
      return;
    }

    const applyLocalParse = () => {
      setComposerParsedQaPairs([]);
      if (composer === "opportunity") {
      const company = detectCompany(parseText) || composerDraft.company || "待填写公司";
      const title = detectRoleTitle(parseText, composerDraft.title);
      const parsedSourceText =
        rawText ||
        (composerSource.sourceKind === "screenshot"
          ? `截图文件：${fileName}。文件已保存；开启智能整理后可以识别图片文字。`
          : `上传文件：${fileName}。文件已保存；如果没有读到内容，可以直接粘贴文字。`);
      const parsedDeadline = parseText.includes("今晚") ? "Tonight" : parseText.includes("明天") ? "Tomorrow" : composerDraft.deadline;
      const parsedDueDate = inferDueDateFromText(parsedDeadline);
      const parsedPriority = parseText.includes("内推") || parseText.includes("急") ? "A" : composerDraft.priority;
      const parsedMatch = parseText.match(/React|前端|TypeScript|组件|性能/i) ? "HIGH" : composerDraft.match;
      setComposerDraft((draft) => ({
        ...draft,
        company,
        title,
        city: detectCity(parseText),
        deadline: parsedDeadline,
        dueDate: parsedDueDate || draft.dueDate,
        match: parsedMatch,
        priority: parsedPriority,
        action: computeOpportunityAction({ status: "TO APPLY", deadline: parsedDeadline, dueDate: parsedDueDate || draft.dueDate, match: parsedMatch, priority: parsedPriority }),
        resumeId: defaultResumeId,
        nextAction: `确认 ${getResumeName(defaultResumeId)} 后投递`,
        sourceLabel: fileName || (composerSource.sourceKind === "job-link" ? "招聘链接" : "岗位描述"),
        sourceText: parsedSourceText,
      }));
      }

      if (composer === "interview") {
      const isAudio = composerSource.sourceKind === "audio";
      const transcript =
        rawText ||
        (isAudio
          ? `录音文件：${fileName}。文件已保存；开启录音转文字后可以继续整理。`
          : `文字稿文件：${fileName}。如果没有读到内容，可以直接粘贴文字稿。`);
      setComposerDraft((draft) => ({
        ...draft,
        linkedOpportunityId: draft.linkedOpportunityId,
        company: detectCompany(parseText) || linkedOpportunity?.company || draft.company || "待填写公司",
        role: detectRoleTitle(parseText, linkedOpportunity?.title || draft.role),
        round: parseText.includes("二面") ? "二面" : parseText.includes("HR") ? "HR 面" : draft.round,
        date: draft.date || "Today",
        fileName: fileName || draft.fileName || "interview-transcript.md",
        sourceText: transcript,
        nextAction: composerSource.note,
      }));
      }

      if (composer === "resume") {
      const baseName = fileBaseName(fileName) || "New Resume Version";
      setComposerDraft((draft) => ({
        ...draft,
        title: draft.title || baseName,
        fileName,
        roles: rawText.match(/产品|策略|增长/) ? "产品 / 策略" : rawText.match(/数据|SQL|Python/) ? "数据分析" : "前端 / 全栈",
        points: rawText || "文件已保存；如果没有读到内容，可以直接粘贴简历文字。",
        summary: composerSource.note || "请确认简历定位和核心卖点。",
      }));
      }

      setComposerStep("review");
      setComposerParseNotice("");
      setSystemMessage("内容已整理");
    };

    const shouldUseAiAssist =
      composer === "interview"
        ? composerSource.sourceKind === "audio" && !rawText
          ? aiSettings.transcriptionMode === "assist"
          : aiSettings.parseMode === "assist"
        : aiSettings.parseMode === "assist";
    const sendAiSettings = shouldSendAiSettings(aiSettings, composerSource.sourceKind, shouldUseAiAssist);
    const hasStoredExtractableFile = Boolean(composerSource.storageUri && composer !== "answer" && composerSource.sourceKind !== "audio");
    const shouldUseParseApi = isApiEnabled && (sendAiSettings || hasStoredExtractableFile);
    const requiresFileExtraction = Boolean(fileName && !rawText && composer !== "answer");

    const blockParseWithNotice = (status: string, notice: string) => {
      setComposerSource((source) => ({ ...source, extractionStatus: status }));
      setComposerParseNotice(notice);
      setSystemMessage("材料暂时无法整理");
    };

    if (composer === "interview" && interviewInputMode === "raw-transcript" && rawText && isGarbledTextContent(rawText)) {
      blockParseWithNotice("text-encoding-failed", "文字稿看起来像乱码，通常是文件编码不对。请用 UTF-8 重新导出转写稿，或直接粘贴文字内容。");
      return;
    }

    if (composer === "interview" && interviewInputMode === "raw-transcript" && (!isApiEnabled || !shouldUseAiAssist || !isAiProviderConfigured(aiSettings))) {
      blockParseWithNotice("ai-not-configured", "未整理的面试文稿需要先开启智能整理；整理好的复盘文档可以切回上一个方式直接导入。");
      return;
    }

    if (shouldUseParseApi && ["opportunity", "interview", "resume"].includes(composer)) {
      try {
        setComposerParsing(true);
        setComposerParseNotice("正在整理内容，请稍候...");
        setSystemMessage("正在整理内容");
        const payload = {
          rawText: sourceInputText,
          fileName,
          sourceKind: composerSource.sourceKind,
          note: composerSource.note,
          storageUri: composerSource.storageUri,
          fileSize: composerSource.fileSize,
          company: composerDraft.company,
          title: composerDraft.title,
          role: composerDraft.role,
          round: composerDraft.round,
          date: composerDraft.date,
          deadline: composerDraft.deadline,
          match: composerDraft.match,
          priority: composerDraft.priority,
          action: composerDraft.action,
          nextAction: composerDraft.nextAction,
          aiSettings: sendAiSettings
            ? {
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
                endpoint: aiSettings.endpoint,
              }
            : { provider: "none" },
        };
        if (composer === "opportunity") {
          const parsed = (await parseOpportunityApi(payload)) as Record<string, string> & { extractionError?: string };
          if (failedExtractionStatuses.has(parsed.extractionStatus ?? "")) {
            blockParseWithNotice(
              parsed.extractionStatus ?? "file-extraction-failed",
              [extractionStatusLabel(parsed.extractionStatus), parsed.extractionError].filter(Boolean).join("：") ||
                "没有读到有效内容，请检查文件，或直接粘贴文字。",
            );
            return;
          }
          setComposerSource((source) => ({ ...source, extractionStatus: parsed.extractionStatus || source.extractionStatus }));
          setComposerDraft((draft) => ({
            ...draft,
            company: parsed.company || draft.company,
            title: parsed.title || draft.title,
            city: parsed.city || draft.city,
            deadline: parsed.deadline || draft.deadline,
            dueDate: parsed.dueDate || inferDueDateFromText(parsed.deadline || draft.deadline) || draft.dueDate,
            match: (parsed.match as ModuleComposerDraft["match"]) || draft.match,
            priority: (parsed.priority as ModuleComposerDraft["priority"]) || draft.priority,
            action:
              (parsed.action as ModuleComposerDraft["action"]) ||
              computeOpportunityAction({
                status: "TO APPLY",
                deadline: parsed.deadline || draft.deadline,
                dueDate: parsed.dueDate || draft.dueDate,
                match: ((parsed.match as ModuleComposerDraft["match"]) || draft.match) as Opportunity["match"],
                priority: ((parsed.priority as ModuleComposerDraft["priority"]) || draft.priority) as Opportunity["priority"],
              }),
            resumeId: defaultResumeId,
            nextAction: `确认 ${getResumeName(defaultResumeId)} 后投递`,
            sourceLabel: parsed.sourceLabel || draft.sourceLabel,
            sourceText: parsed.sourceText || draft.sourceText,
          }));
        }
        if (composer === "interview") {
          const parsed = (await parseInterviewApi(payload)) as Record<string, string> & { qaPairs?: unknown; extractionError?: string; aiError?: string };
          if (failedExtractionStatuses.has(parsed.extractionStatus ?? "")) {
            blockParseWithNotice(
              parsed.extractionStatus ?? "file-extraction-failed",
              [extractionStatusLabel(parsed.extractionStatus), parsed.aiError || parsed.extractionError].filter(Boolean).join("：") ||
                "面试复盘整理失败，请检查设置后重试。",
            );
            return;
          }
          setComposerSource((source) => ({ ...source, extractionStatus: parsed.extractionStatus || source.extractionStatus }));
          setComposerParsedQaPairs(normalizeParsedQaPairs(parsed.qaPairs));
          setComposerDraft((draft) => ({
            ...draft,
            linkedOpportunityId: draft.linkedOpportunityId,
            company: parsed.company || linkedOpportunity?.company || draft.company,
            role: parsed.role || linkedOpportunity?.title || draft.role,
            round: parsed.round || draft.round,
            date: parsed.date || draft.date || "Today",
            fileName: parsed.fileName || fileName || draft.fileName,
            sourceText: parsed.sourceText || draft.sourceText,
            nextAction: parsed.note || composerSource.note,
          }));
        }
        if (composer === "resume") {
          const parsed = await parseResumeApi(payload);
          if (failedExtractionStatuses.has(parsed.extractionStatus ?? "")) {
            blockParseWithNotice(
              parsed.extractionStatus ?? "file-extraction-failed",
              [extractionStatusLabel(parsed.extractionStatus), parsed.extractionError].filter(Boolean).join("：") ||
                "没有读到有效内容，请检查文件，或直接粘贴文字。",
            );
            return;
          }
          setComposerSource((source) => ({ ...source, extractionStatus: parsed.extractionStatus || source.extractionStatus }));
          setComposerDraft((draft) => ({
            ...draft,
            title: parsed.title || draft.title,
            fileName: parsed.fileName || fileName,
            roles: parsed.roles || draft.roles,
            points: parsed.points || draft.points,
            summary: parsed.summary || draft.summary,
          }));
        }
        setComposerStep("review");
        setComposerParseNotice("");
        setSystemMessage("内容已整理");
        return;
      } catch (error) {
        const errorDetail = fetchErrorHint(error instanceof Error ? error.message : String(error || ""));
        if (composer === "interview" && sendAiSettings) {
          blockParseWithNotice(
            "ai-parser-failed",
            [
              "面试复盘整理失败，暂时没有保存新内容。",
              errorDetail ? `错误信息：${errorDetail}` : "请检查设置后重试。",
            ].join(" "),
          );
          return;
        }
        if (requiresFileExtraction) {
          blockParseWithNotice("file-extraction-failed", "没有读到文件内容，请先粘贴文字再继续。");
          return;
        }
        setComposerParseNotice("智能整理暂时不可用，已改用基础整理。");
        setSystemMessage("已改用基础整理");
      } finally {
        setComposerParsing(false);
      }
    }

    if (requiresFileExtraction && composerSource.sourceKind === "audio" && aiSettings.transcriptionMode !== "assist") {
      blockParseWithNotice("transcription-unavailable", "录音需要先在设置里开启「录音转文字」。");
      return;
    }

    applyLocalParse();
  };

  const openOpportunity = (id: string) => {
    setSelectedOpportunityId(id);
    setPage("opportunityDetail");
    setSystemMessage("已打开岗位详情");
  };

  const selectInterview = (id: string) => {
    const nextSession = interviewSessions.find((item) => item.id === id);
    if (!nextSession) return;
    setSelectedInterviewId(id);
    setSelectedQaId(nextSession.qaPairs[0]?.id ?? "");
  };

  const openInterviewSession = (id: string) => {
    selectInterview(id);
    setInterviewView("session");
  };

  const openInterviewQuestion = (id: string) => {
    setSelectedQaId(id);
    setInterviewView("question");
  };

  const openAnswerCard = (id: string) => {
    setSelectedAnswerId(id);
    setAnswerView("detail");
  };

  const updateSelectedQa = (field: keyof Pick<QaPair, "question" | "originalAnswer" | "critique" | "framework" | "optimizedAnswer">, value: string) => {
    const patch = { [field]: value } as Partial<QaPair>;
    setInterviewSessions((sessions) =>
      sessions.map((session) =>
        session.id === selectedInterviewId
          ? {
              ...session,
              qaPairs: session.qaPairs.map((pair) => (pair.id === selectedQa.id ? { ...pair, [field]: value } : pair)),
            }
          : session,
      ),
    );
    syncUpdatedQaPair(selectedQa.id, patch);
  };

  const updateSelectedQaWeak = (weak: boolean) => {
    setInterviewSessions((sessions) =>
      sessions.map((session) =>
        session.id === selectedInterviewId
          ? {
              ...session,
              qaPairs: session.qaPairs.map((pair) => (pair.id === selectedQa.id ? { ...pair, weak } : pair)),
            }
          : session,
      ),
    );
    invalidateApiInsights();
    syncUpdatedQaPair(selectedQa.id, { weak });
    setSystemMessage(weak ? "已重新标为薄弱" : "已标记处理");
  };

  const updateSelectedInterview = (patch: Partial<InterviewSession>) => {
    setInterviewSessions((sessions) => sessions.map((session) => (session.id === selectedInterview.id ? { ...session, ...patch } : session)));
    if ("reviewPriority" in patch) invalidateApiInsights();
    syncUpdatedInterviewSession(selectedInterview.id, patch);
  };

  const updateSelectedOpportunity = (patch: Partial<Opportunity>) => {
    const normalizedPatch: Partial<Opportunity> = { ...patch };
    const statusChanged = Boolean(normalizedPatch.status && normalizedPatch.status !== selectedOpportunity.status);
    if (statusChanged && normalizedPatch.status && !("nextAction" in normalizedPatch)) {
      normalizedPatch.nextAction = defaultOpportunityNextAction(normalizedPatch.status);
    }
    if (statusChanged && normalizedPatch.status && !("timeline" in normalizedPatch)) {
      normalizedPatch.timeline = timelineWithSyncedNextEvent(selectedOpportunity.timeline, normalizedPatch.status, normalizedPatch.nextAction ?? selectedOpportunity.nextAction);
    }
    const nextOpportunity = { ...selectedOpportunity, ...normalizedPatch };
    const shouldRecomputeAction =
      !nextOpportunity.actionManual &&
      ["status", "deadline", "dueDate", "priority", "match"].some((field) => field in normalizedPatch) &&
      !("action" in normalizedPatch);
    const nextPatch = shouldRecomputeAction ? { ...normalizedPatch, action: computeOpportunityAction(nextOpportunity) } : normalizedPatch;
    if ("actionManual" in normalizedPatch && normalizedPatch.actionManual === false && !("action" in normalizedPatch)) {
      nextPatch.action = computeOpportunityAction(nextOpportunity);
    }
    setOpportunities((items) => items.map((item) => (item.id === selectedOpportunity.id ? { ...item, ...nextPatch } : item)));
    invalidateApiInsights();
    syncUpdatedOpportunity(selectedOpportunity.id, nextPatch);
  };

  const replaceInterviewQaPairs = (sessionId: string, previousPairs: QaPair[], nextPairs: Array<Omit<QaPair, "id">>) => {
    const qaPairs: QaPair[] = nextPairs.map((pair) => ({ ...pair, id: makeId("QA") }));
    setInterviewSessions((sessions) => sessions.map((session) => (session.id === sessionId ? { ...session, qaPairs } : session)));
    setSelectedQaId(qaPairs[0]?.id ?? "");
    previousPairs.forEach((pair) => syncDeletedQaPair(pair.id));
    qaPairs.forEach((pair) => syncCreatedQaPair(sessionId, pair));
    invalidateApiInsights();
  };

  const executeReparseSelectedInterview = async () => {
    const transcript = getInterviewTranscriptText(selectedInterview);
    if (!transcript) {
      setInterviewReparseNotice("找不到可用文字稿。请先保存文字稿内容，或重新上传后再整理。");
      return;
    }

    setInterviewReparseBusy(true);
    setInterviewReparseNotice("正在根据文字稿重新整理，请稍候...");
    setSystemMessage("正在重新整理面试");

    try {
      const shouldUseAiAssist = aiSettings.parseMode === "assist";
      const sendAiSettings = shouldUseAiAssist && isAiProviderConfigured(aiSettings);
      const transcriptFile = selectedInterview.sourceFiles?.find((file) => file.kind === "transcript") ?? selectedInterview.sourceFiles?.[0];
      let nextPairs: Array<Omit<QaPair, "id">> = [];

      if (isApiEnabled) {
        const parsed = (await parseInterviewApi({
          rawText: transcript,
          fileName: transcriptFile?.fileName || `${selectedInterview.company}-${selectedInterview.round}-transcript.md`,
          sourceKind: "transcript",
          note: "重新解析已有面试文字稿",
          company: selectedInterview.company,
          role: selectedInterview.role,
          round: selectedInterview.round,
          date: selectedInterview.date,
          aiSettings: sendAiSettings
            ? {
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
                endpoint: aiSettings.endpoint,
              }
            : { provider: "none" },
        })) as Record<string, string> & { qaPairs?: unknown; extractionError?: string; aiError?: string };

        if (failedExtractionStatuses.has(parsed.extractionStatus ?? "")) {
          setInterviewReparseNotice(
            [extractionStatusLabel(parsed.extractionStatus), parsed.aiError || parsed.extractionError].filter(Boolean).join("：") ||
              "重新整理失败，请检查文字稿或智能整理设置。",
          );
          setSystemMessage("面试重新整理失败");
          return;
        }
        nextPairs = normalizeParsedQaPairs(parsed.qaPairs);
      } else {
        nextPairs = parseTranscriptQaPairs(transcript);
      }

      if (!nextPairs.length) {
        setInterviewReparseNotice("没有从文字稿中识别出有效问题。请检查文字稿格式，或开启智能整理后重试。");
        setSystemMessage("没有识别出问题");
        return;
      }

      replaceInterviewQaPairs(selectedInterview.id, selectedInterview.qaPairs, nextPairs);
      setInterviewReparseNotice(`已重新整理 ${nextPairs.length} 个问题。`);
      setSystemMessage("面试已重新整理");
    } catch (error) {
      const errorDetail = fetchErrorHint(error instanceof Error ? error.message : String(error || ""));
      setInterviewReparseNotice(errorDetail ? `重新整理失败：${errorDetail}` : "重新整理失败，请稍后重试。");
      setSystemMessage("重新整理失败");
    } finally {
      setInterviewReparseBusy(false);
    }
  };

  const requestReparseSelectedInterview = () => {
    const transcript = getInterviewTranscriptText(selectedInterview);
    if (!transcript) {
      setInterviewReparseNotice("找不到可用文字稿。请先保存文字稿内容，或重新上传后再整理。");
      return;
    }
    requestConfirm({
      title: "重新整理这场面试？",
      description: "会根据文字稿重新生成问题列表，当前问题会被替换。",
      confirmLabel: "重新整理",
      onConfirm: () => {
        void executeReparseSelectedInterview();
      },
    });
  };

  const addQaPair = () => {
    const newQa: QaPair = {
      id: makeId("QA"),
      question: "新增问题：请在这里补充面试官原问题",
      originalAnswer: "在这里记录你的原回答。",
      type: "MANUAL",
      score: 3,
      critique: "在这里补充评价。",
      weak: true,
      framework: "背景 -> 动作 -> 结果 -> 复盘",
      optimizedAnswer: "在这里整理推荐回答表述。",
    };

    setInterviewSessions((sessions) =>
      sessions.map((session) => (session.id === selectedInterviewId ? { ...session, qaPairs: [...session.qaPairs, newQa] } : session)),
    );
    setSelectedQaId(newQa.id);
    setInterviewView("question");
    syncCreatedQaPair(selectedInterviewId, newQa);
    setSystemMessage("已添加问题");
  };

  const requestConfirm = (config: ConfirmDialogState) => setConfirmDialog(config);

  const markModalBackdropPointerStart = (event: MouseEvent<HTMLDivElement>) => {
    modalBackdropPointerStartedRef.current = event.target === event.currentTarget;
  };

  const closeModalFromBackdropClick = (event: MouseEvent<HTMLDivElement>, close: () => void) => {
    const shouldClose = modalBackdropPointerStartedRef.current && event.target === event.currentTarget;
    modalBackdropPointerStartedRef.current = false;
    if (shouldClose) close();
  };

  useEffect(() => {
    if (!confirmDialog && !previewAsset && !previewSessionFile && !weeklyTaskForm && !composer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmDialog) setConfirmDialog(null);
      else if (composer) setComposer(null);
      else if (weeklyTaskForm) setWeeklyTaskForm(null);
      else if (previewAsset) setPreviewAsset(null);
      else if (previewSessionFile) setPreviewSessionFile(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composer, confirmDialog, previewAsset, previewSessionFile, weeklyTaskForm]);

  const modalOpen = Boolean(confirmDialog || previewAsset || previewSessionFile || weeklyTaskForm || composer);
  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  const syncCreatedAnswerCard = (card: AnswerCard) => {
    void createAnswerCardApi(card)
      .then((savedCard) => {
        setAnswerCards((cards) => cards.map((item) => (item.id === card.id ? savedCard : item)));
        setSelectedAnswerId((id) => (id === card.id ? savedCard.id : id));
      })
      .catch(() => setSystemMessage("答案卡已保存在本机"));
  };

  const syncUpdatedAnswerCard = (id: string, patch: Partial<AnswerCard>) => {
    void updateAnswerCardApi(id, patch).catch(() => setSystemMessage("答案卡已保存在本机"));
  };

  const clearAnswerCardDragState = () => {
    setDraggedAnswerCardId("");
    setAnswerCategoryDropTargetId("");
  };

  const getDraggedAnswerCardId = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.getData("application/x-jobpilot-answer-card") || draggedAnswerCardId;

  const canDropAnswerCardToCategory = (answerId: string, categoryId: string) => {
    const card = answerCards.find((item) => item.id === answerId);
    if (!card || !answerCategoryById.has(categoryId)) return false;
    return resolveAnswerCategoryId(card) !== categoryId;
  };

  const handleAnswerCardDragStart = (event: DragEvent<HTMLButtonElement>, card: AnswerCard) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-jobpilot-answer-card", card.id);
    event.dataTransfer.setData("text/plain", card.question);
    const dragPreview = document.createElement("div");
    dragPreview.className = "answer-card-drag-preview";
    dragPreview.textContent = card.question || "答案卡";
    document.body.appendChild(dragPreview);
    event.dataTransfer.setDragImage(dragPreview, 16, 18);
    window.setTimeout(() => dragPreview.remove(), 0);
    setDraggedAnswerCardId(card.id);
    setAnswerCategoryDropTargetId("");
  };

  const handleAnswerCategoryDragOver = (event: DragEvent<HTMLDivElement>, categoryId: string) => {
    const answerId = getDraggedAnswerCardId(event);
    if (!canDropAnswerCardToCategory(answerId, categoryId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setAnswerCategoryDropTargetId(categoryId);
  };

  const handleAnswerCategoryDragLeave = (event: DragEvent<HTMLDivElement>, categoryId: string) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setAnswerCategoryDropTargetId((id) => (id === categoryId ? "" : id));
  };

  const moveAnswerCardToCategory = (answerId: string, categoryId: string) => {
    const card = answerCards.find((item) => item.id === answerId);
    const category = answerCategoryById.get(categoryId);
    if (!card || !category || resolveAnswerCategoryId(card) === category.id) return;
    setAnswerCards((cards) => cards.map((item) => (item.id === answerId ? { ...item, categoryId: category.id } : item)));
    setAnswerPage(0);
    syncUpdatedAnswerCard(answerId, { categoryId: category.id });
    setSystemMessage(`已移动到${category.name}`);
  };

  const handleAnswerCategoryDrop = (event: DragEvent<HTMLDivElement>, categoryId: string) => {
    const answerId = getDraggedAnswerCardId(event);
    if (!canDropAnswerCardToCategory(answerId, categoryId)) {
      clearAnswerCardDragState();
      return;
    }
    event.preventDefault();
    moveAnswerCardToCategory(answerId, categoryId);
    clearAnswerCardDragState();
  };

  const syncDeletedAnswerCard = (id: string) => {
    void deleteAnswerCardApi(id).catch(() => setSystemMessage("答案卡已在本机更新"));
  };

  const syncCreatedAnswerCategory = (category: AnswerCategory) => {
    void createAnswerCategoryApi(category)
      .then((savedCategory) => {
        setAnswerCategories((categories) => categories.map((item) => (item.id === category.id ? savedCategory : item)));
        setSelectedAnswerCategoryId((id) => (id === category.id ? savedCategory.id : id));
      })
      .catch(() => setSystemMessage("分类已保存在本机"));
  };

  const syncUpdatedAnswerCategory = (id: string, patch: Partial<AnswerCategory>) => {
    void updateAnswerCategoryApi(id, patch).catch(() => setSystemMessage("分类已保存在本机"));
  };

  const syncDeletedAnswerCategory = (id: string) => {
    void deleteAnswerCategoryApi(id).catch(() => setSystemMessage("分类已在本机更新"));
  };

  const syncWeeklyPlanPatch = (patch: Partial<Omit<WeeklyPlan, "tasks">>) => {
    void updateWeeklyPlanApi(patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("本周计划已保存在本机"));
  };

  const syncCreatedWeeklyTask = (task: WeeklyTask) => {
    void createWeeklyTaskApi(task)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("本周计划已保存在本机"));
  };

  const syncUpdatedWeeklyTask = (id: string, patch: Partial<WeeklyTask>) => {
    void updateWeeklyTaskApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("本周计划已保存在本机"));
  };

  const syncDeletedWeeklyTask = (id: string) => {
    void deleteWeeklyTaskApi(id)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("本周计划已保存在本机"));
  };

  const syncCreatedResumeVersion = (resume: ResumeVersion) => {
    void createResumeVersionApi(resume)
      .then((savedResume) => {
        setResumeList((items) => items.map((item) => (item.id === resume.id ? savedResume : item)));
        setSelectedResumeId((id) => (id === resume.id ? savedResume.id : id));
      })
      .catch(() => setSystemMessage("简历已保存在本机"));
  };

  const syncUpdatedResumeVersion = (id: string, patch: Partial<ResumeVersion>) => {
    void updateResumeVersionApi(id, patch).catch(() => setSystemMessage("简历已保存在本机"));
  };

  const syncDeletedResumeVersion = (id: string) => {
    void deleteResumeVersionApi(id).catch(() => setSystemMessage("简历已在本机更新"));
  };

  const syncCreatedInterviewSession = (session: InterviewSession) => {
    if (session.opportunityId && !apiOpportunityIdsRef.current.has(session.opportunityId)) {
      setSystemMessage("面试复盘已保存在本机");
      return;
    }
    void createInterviewSessionApi(session)
      .then((savedSession) => {
        setInterviewSessions((sessions) => sessions.map((item) => (item.id === session.id ? savedSession : item)));
        setSelectedInterviewId((id) => (id === session.id ? savedSession.id : id));
        setSelectedQaId((id) => (session.qaPairs.some((pair) => pair.id === id) ? savedSession.qaPairs.find((pair) => pair.id === id)?.id ?? id : id));
        if (savedSession.opportunityId) {
          void getOpportunitiesApi()
            .then((items) => {
              setOpportunities(items);
              apiOpportunityIdsRef.current = new Set(items.map((item) => item.id));
            })
            .catch(() => setSystemMessage("岗位进度已保存在本机"));
        }
        refreshApiInsights();
      })
      .catch(() => setSystemMessage("面试复盘已保存在本机"));
  };

  const syncUpdatedInterviewSession = (id: string, patch: Partial<InterviewSession>) => {
    void updateInterviewSessionApi(id, patch).catch(() => setSystemMessage("面试复盘已保存在本机"));
  };

  const syncCreatedQaPair = (interviewId: string, qaPair: QaPair) => {
    void createQaPairApi(interviewId, qaPair).catch(() => setSystemMessage("面试问题已保存在本机"));
  };

  const syncUpdatedQaPair = (id: string, patch: Partial<QaPair>) => {
    void updateQaPairApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("面试复盘已保存在本机"));
  };

  const syncDeletedQaPair = (id: string) => {
    void deleteQaPairApi(id).catch(() => setSystemMessage("面试问题已在本机更新"));
  };

  const syncDeletedInterviewSession = (id: string) => {
    void deleteInterviewSessionApi(id).catch(() => setSystemMessage("面试复盘已在本机更新"));
  };

  const syncCreatedOpportunity = (opportunity: Opportunity) => {
    void createOpportunityApi(opportunity)
      .then((savedOpportunity) => {
        apiOpportunityIdsRef.current.add(savedOpportunity.id);
        refreshApiInsights();
        setOpportunities((items) => {
          const currentOpportunity = items.find((item) => item.id === savedOpportunity.id);
          if (currentOpportunity && JSON.stringify(currentOpportunity) !== JSON.stringify(savedOpportunity)) {
            void updateOpportunityApi(savedOpportunity.id, currentOpportunity).catch(() => setSystemMessage("岗位已保存在本机"));
            return items;
          }
          return items.map((item) => (item.id === opportunity.id ? savedOpportunity : item));
        });
        setSelectedOpportunityId((id) => (id === opportunity.id ? savedOpportunity.id : id));
      })
      .catch(() => setSystemMessage("岗位已保存在本机"));
  };

  const syncUpdatedOpportunity = (id: string, patch: Partial<Opportunity>) => {
    if (!apiOpportunityIdsRef.current.has(id)) {
      setSystemMessage("岗位已保存在本机");
      return;
    }
    void updateOpportunityApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("岗位已保存在本机"));
  };

  const syncDeletedOpportunity = (id: string) => {
    if (!apiOpportunityIdsRef.current.has(id)) {
      setSystemMessage("岗位已保存在本机");
      return;
    }
    void deleteOpportunityApi(id)
      .then(() => {
        apiOpportunityIdsRef.current.delete(id);
        refreshApiInsights();
      })
      .catch(() => setSystemMessage("岗位已保存在本机"));
  };

  const deleteSelectedQa = () => {
    const qaId = selectedQa.id;
    const remaining = selectedInterview.qaPairs.filter((pair) => pair.id !== selectedQa.id);
    if (remaining.length === 0) {
      setSystemMessage("至少保留一个问题");
      return;
    }
    setInterviewSessions((sessions) =>
      sessions.map((session) => (session.id === selectedInterviewId ? { ...session, qaPairs: remaining } : session)),
    );
    setSelectedQaId(remaining[0].id);
    setInterviewView("session");
    syncDeletedQaPair(qaId);
    setSystemMessage("问题已删除");
  };

  const deleteSelectedInterview = () => {
    const interviewId = selectedInterview.id;
    const remaining = interviewSessions.filter((session) => session.id !== interviewId);
    if (remaining.length === 0) {
      setSystemMessage("至少保留一场面试");
      return;
    }
    setInterviewSessions(remaining);
    setSelectedInterviewId(remaining[0].id);
    setSelectedQaId(remaining[0].qaPairs[0]?.id ?? "");
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => !(task.source === "interview" && task.relatedEntityId === interviewId)) }));
    setInterviewPage(0);
    setInterviewView("list");
    invalidateApiInsights();
    syncDeletedInterviewSession(interviewId);
    setSystemMessage("面试已删除");
  };

  const addAnswerCard = () => {
    const newCard: AnswerCard = {
      id: makeId("AC"),
      question: "新增答案卡：请输入常见面试问题",
      type: "MANUAL",
      status: "DRAFT",
      source: "手动创建",
      categoryId: isAllAnswerCategorySelected || selectedAnswerCategory.system ? uncategorizedAnswerCategoryId : selectedAnswerCategory.id,
      framework: "背景 -> 动作 -> 结果 -> 复盘",
      answer: "在这里写你希望下次面试复用的回答。",
      relatedRoles: "待填写",
      practiceStatus: "中等",
    };
    setAnswerCards((cards) => [newCard, ...cards]);
    setSelectedAnswerId(newCard.id);
    setAnswerView("detail");
    syncCreatedAnswerCard(newCard);
    setSystemMessage("答案卡已添加");
  };

  const openCreateAnswerCategoryEditor = (parentId = "") => {
    setOpenAnswerCategoryMenuId("");
    setAnswerCategoryEditor({ mode: "create", parentId, name: "" });
    if (parentId) setExpandedAnswerCategoryIds((ids) => new Set(ids).add(parentId));
  };

  const openRenameAnswerCategoryEditor = (category: AnswerCategory) => {
    if (category.system) {
      setSystemMessage("系统分类不可重命名");
      return;
    }
    setOpenAnswerCategoryMenuId("");
    setAnswerCategoryEditor({ mode: "rename", categoryId: category.id, name: category.name });
  };

  const commitAnswerCategoryEditor = () => {
    if (!answerCategoryEditor) return;
    const name = answerCategoryEditor.name.trim();
    if (!name) {
      setSystemMessage("请先填写分类名称");
      return;
    }

    if (answerCategoryEditor.mode === "rename") {
      const category = answerCategoryById.get(answerCategoryEditor.categoryId);
      if (!category || category.system || name === category.name) {
        setAnswerCategoryEditor(null);
        return;
      }
      setAnswerCategories((categories) => categories.map((item) => (item.id === category.id ? { ...item, name } : item)));
      syncUpdatedAnswerCategory(category.id, { name });
      setAnswerCategoryEditor(null);
      setSystemMessage("分类已重命名");
      return;
    }

    const parentId = answerCategoryEditor.parentId && answerCategoryById.has(answerCategoryEditor.parentId) ? answerCategoryEditor.parentId : "";
    const siblings = answerCategories.filter((category) => (category.parentId ?? "") === parentId);
    const newCategory: AnswerCategory = {
      id: makeId("CAT"),
      name,
      parentId: parentId || undefined,
      sortOrder: Math.max(-1, ...siblings.map((category) => category.sortOrder)) + 1,
    };
    setAnswerCategories((categories) => [...categories, newCategory]);
    if (parentId) setExpandedAnswerCategoryIds((ids) => new Set(ids).add(parentId));
    setSelectedAnswerCategoryId(newCategory.id);
    setAnswerPage(0);
    setAnswerCategoryEditor(null);
    syncCreatedAnswerCategory(newCategory);
    setSystemMessage("分类已添加");
  };

  const deleteAnswerCategory = (category: AnswerCategory) => {
    if (category.system) {
      setSystemMessage("系统分类不可删除");
      return;
    }
    const ids = new Set<string>([category.id]);
    let changed = true;
    while (changed) {
      changed = false;
      answerCategories.forEach((item) => {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          changed = true;
        }
      });
    }
    setAnswerCards((cards) =>
      cards.map((card) => (card.categoryId && ids.has(card.categoryId) ? { ...card, categoryId: uncategorizedAnswerCategoryId } : card)),
    );
    setAnswerCategories((categories) => categories.filter((item) => !ids.has(item.id)));
    if (ids.has(selectedAnswerCategoryId)) setSelectedAnswerCategoryId(uncategorizedAnswerCategoryId);
    setOpenAnswerCategoryMenuId("");
    setAnswerCategoryEditor(null);
    setAnswerPage(0);
    syncDeletedAnswerCategory(category.id);
    setSystemMessage("分类已删除，卡片已移到尚未归类");
  };

  const toggleAnswerCategoryExpanded = (categoryId: string) => {
    setExpandedAnswerCategoryIds((ids) => {
      const next = new Set(ids);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const updateSelectedAnswer = (field: keyof Pick<AnswerCard, "question" | "type" | "framework" | "answer" | "relatedRoles" | "practiceStatus" | "status" | "categoryId">, value: string) => {
    const patch = { [field]: value } as Partial<AnswerCard>;
    setAnswerCards((cards) => cards.map((card) => (card.id === selectedAnswer.id ? { ...card, [field]: value } : card)));
    if (field === "status" || field === "practiceStatus") invalidateApiInsights();
    syncUpdatedAnswerCard(selectedAnswer.id, patch);
  };

  const updateAnswerPracticeState = (answerId: string, patch: Pick<Partial<AnswerCard>, "practiceStatus" | "status">) => {
    setAnswerCards((cards) => cards.map((card) => (card.id === answerId ? { ...card, ...patch } : card)));
    invalidateApiInsights();
    syncUpdatedAnswerCard(answerId, patch);
  };

  const deleteSelectedAnswer = () => {
    const answerId = selectedAnswer.id;
    const remaining = answerCards.filter((card) => card.id !== selectedAnswer.id);
    if (remaining.length === 0) {
      setSystemMessage("至少保留一张答案卡");
      return;
    }
    setAnswerCards(remaining);
    setSelectedAnswerId(remaining[0].id);
    setAnswerView("list");
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => !(task.source === "answer" && task.relatedEntityId === answerId)) }));
    invalidateApiInsights();
    syncDeletedAnswerCard(answerId);
    setSystemMessage("答案卡已删除");
  };

  const addResumeVersion = () => {
    openComposer("resume");
  };

  const updateSelectedResume = (field: keyof Pick<ResumeVersion, "name" | "roles" | "points" | "summary">, value: string) => {
    const patch = { [field]: value } as Partial<ResumeVersion>;
    setResumeList((items) => items.map((resume) => (resume.id === selectedResume.id ? { ...resume, [field]: value } : resume)));
    syncUpdatedResumeVersion(selectedResume.id, patch);
  };

  const deleteSelectedResume = () => {
    const resumeId = selectedResume.id;
    const remaining = resumeList.filter((resume) => resume.id !== selectedResume.id);
    if (remaining.length === 0) {
      setSystemMessage("至少保留一份简历");
      return;
    }
    setResumeList(remaining);
    setSelectedResumeId(remaining[0].id);
    setOpportunities((items) => items.map((opportunity) => (opportunity.resumeId === resumeId ? { ...opportunity, resumeId: "" } : opportunity)));
    invalidateApiInsights();
    syncDeletedResumeVersion(resumeId);
    setSystemMessage("简历已删除");
  };

  const deleteSelectedOpportunity = () => {
    const opportunityId = selectedOpportunity.id;
    const remaining = opportunities.filter((opportunity) => opportunity.id !== opportunityId);
    if (remaining.length === 0) {
      setSystemMessage("至少保留一个岗位");
      return;
    }

    setOpportunities(remaining);
    setSelectedOpportunityId(remaining[0].id);
    setInterviewSessions((sessions) =>
      sessions.map((session) => (session.opportunityId === opportunityId ? { ...session, opportunityId: undefined } : session)),
    );
    setResumeList((items) =>
      items.map((resume) =>
        resume.linkedOpportunityIds.includes(opportunityId)
          ? { ...resume, linkedOpportunityIds: resume.linkedOpportunityIds.filter((id) => id !== opportunityId) }
          : resume,
      ),
    );
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => !(task.source === "opportunity" && task.relatedEntityId === opportunityId)) }));
    invalidateApiInsights();
    goTo("opportunities");
    syncDeletedOpportunity(opportunityId);
    setSystemMessage("岗位已删除");
  };

  const exportStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

  const downloadTextFile = (fileName: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const openStoredFile = (storageUri?: string) => {
    if (!storageUri || !isApiEnabled) {
      setSystemMessage("没有可打开的文件");
      return;
    }
    window.open(`${apiBaseUrl}${storageUri}`, "_blank", "noopener,noreferrer");
    setSystemMessage("已打开文件预览");
  };

  const buildLocalBackup = (): JobPilotBackup => ({
      schemaVersion: "jobpilot-v0.7.2",
      exportedAt: new Date().toISOString(),
      source: isPublicDemo ? "public-demo" : isApiEnabled ? "local-api" : "local-mock",
      opportunities,
      interviewSessions,
      answerCards,
      answerCategories,
      resumeVersions: resumeList,
      weeklyPlan,
      storedFiles: [],
  });

  const writeBackupFile = (backup: JobPilotBackup) => {
    downloadTextFile(`jobpilot-backup-${exportStamp()}.json`, JSON.stringify(backup, null, 2), "application/json");
    setSystemMessage("备份已导出");
  };

  const exportBackup = () => {
    if (!isApiEnabled) {
      writeBackupFile(buildLocalBackup());
      return;
    }
    void exportBackupApi()
      .then(writeBackupFile)
      .catch(() => {
        writeBackupFile(buildLocalBackup());
        setSystemMessage("备份已恢复到本机");
      });
  };

  const importBackupFromFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const backup = JSON.parse(await file.text()) as JobPilotBackup;
        const restoredBackup = isApiEnabled ? await importBackupApi(backup) : backup;
        applyLoadedData(restoredBackup);
        if (isApiEnabled) refreshApiInsights();
        setSystemMessage("备份已恢复");
      } catch {
        setSystemMessage("备份恢复失败");
      }
    };
    input.click();
  };

  const exportAnswerCards = () => {
    const markdown = [
      "# JobPilot 答案卡",
      "",
      `导出时间：${formatNow()}`,
      "",
      ...answerCards.flatMap((card, index) => [
        `## ${index + 1}. ${card.question}`,
        "",
        `- 类型：${card.type}`,
        `- 状态：${card.status}`,
        `- 来源：${card.source}`,
        `- 分类：${answerCategoryById.get(resolveAnswerCategoryId(card))?.name ?? "尚未归类"}`,
        `- 适用方向：${card.relatedRoles}`,
        `- 练习状态：${card.practiceStatus}`,
        "",
        "### 框架",
        "",
        card.framework,
        "",
        "### 回答",
        "",
        card.answer,
        "",
      ]),
    ].join("\n");
    downloadTextFile(`jobpilot-answer-cards-${exportStamp()}.md`, markdown, "text/markdown");
    setSystemMessage("答案卡已导出");
  };

  const exportInterviewReviews = () => {
    const markdown = [
      "# JobPilot 面试复盘",
      "",
      `导出时间：${formatNow()}`,
      "",
      ...interviewSessions.flatMap((session, index) => [
        `## ${index + 1}. ${session.company} / ${session.role} / ${session.round}`,
        "",
        `- 日期：${session.date}`,
        `- 复盘优先级：${session.reviewPriority ?? "P1"}`,
        `- 关联岗位：${session.opportunityId ?? "未关联"}`,
        `- 备注：${session.note || "无"}`,
        `- 原始材料：${session.sourceFiles?.map((file) => file.fileName).join("、") || "无"}`,
        "",
        ...session.qaPairs.flatMap((pair, pairIndex) => [
          `### Q${pairIndex + 1}. ${pair.question}`,
          "",
          `- 类型：${pair.type}`,
          `- 分数：${pair.score}/5`,
          `- 是否薄弱：${pair.weak ? "是" : "否"}`,
          "",
          "#### 原回答",
          "",
          pair.originalAnswer,
          "",
          "#### 评价",
          "",
          pair.critique,
          "",
          "#### 推荐框架",
          "",
          pair.framework,
          "",
          "#### 优化回答",
          "",
          pair.optimizedAnswer,
          "",
        ]),
      ]),
    ].join("\n");
    downloadTextFile(`jobpilot-interview-reviews-${exportStamp()}.md`, markdown, "text/markdown");
    setSystemMessage("面试复盘已导出");
  };

  const addWeeklyTask = (preset?: Partial<Pick<WeeklyTask, "title" | "detail" | "level">>) => {
    const newTask: WeeklyTask = {
      id: makeId("WT"),
      title: preset?.title?.trim() || "新的练习动作",
      detail: preset?.detail?.trim() || "写下今天准备推进的一件小事。",
      source: "manual",
      sourceLabel: "本周计划",
      level: preset?.level ?? "P2",
      status: "open",
    };
    setWeeklyPlan((plan) => ({ ...plan, tasks: [newTask, ...plan.tasks] }));
    setWeeklyPracticePage(0);
    invalidateApiInsights();
    syncCreatedWeeklyTask(newTask);
    setSystemMessage("动作已添加");
  };

  const openWeeklyTaskDialog = () => setWeeklyTaskForm(emptyWeeklyTaskForm());

  const submitWeeklyTaskForm = () => {
    if (!weeklyTaskForm) return;
    const title = weeklyTaskForm.title.trim();
    if (!title) {
      setSystemMessage("请填写动作标题");
      return;
    }
    addWeeklyTask({
      title,
      detail: weeklyTaskForm.detail.trim() || "例如：练一道笔试题，或整理一个项目表达。",
      level: weeklyTaskForm.level,
    });
    setWeeklyTaskForm(null);
  };

  const updateWeeklyTask = (id: string, field: keyof Pick<WeeklyTask, "title" | "detail" | "status" | "level">, value: string) => {
    const patch = { [field]: value } as Partial<WeeklyTask>;
    setWeeklyPlan((plan) => ({
      ...plan,
      tasks: plan.tasks.map((task) => (task.id === id ? { ...task, [field]: value } : task)),
    }));
    invalidateApiInsights();
    syncUpdatedWeeklyTask(id, patch);
  };

  const deleteWeeklyTask = (id: string) => {
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => task.id !== id) }));
    invalidateApiInsights();
    syncDeletedWeeklyTask(id);
    setSystemMessage("动作已删除");
  };

  const addWeeklyFocus = (field: keyof Pick<WeeklyPlan, "focusDirections" | "focusCities" | "focusCompanies" | "practiceThemes">, value: string) => {
    if (!value.trim()) return;
    const nextValues = [...weeklyPlan[field], value.trim()];
    setWeeklyPlan((plan) => ({ ...plan, [field]: [...plan[field], value.trim()] }));
    syncWeeklyPlanPatch({ [field]: nextValues });
    setSystemMessage("训练重点已添加");
  };

  const createWeeklyTask = (task: Omit<WeeklyTask, "id" | "status">) => {
    const newTask: WeeklyTask = {
      id: makeId("WT"),
      status: "open",
      ...task,
      level: task.level ?? "P2",
    };
    setWeeklyPlan((plan) => ({ ...plan, tasks: [newTask, ...plan.tasks] }));
    invalidateApiInsights();
    syncCreatedWeeklyTask(newTask);
    setSystemMessage("任务已添加");
  };

  const addSelectedAnswerToPractice = () => {
    const existingTask = weeklyPlan.tasks.find((task) => task.source === "answer" && task.relatedEntityId === selectedAnswer.id && task.status === "open");
    if (existingTask) {
      goTo("weekly");
      setSystemMessage("已打开练习任务");
      return;
    }

    createWeeklyTask({
      title: `练习答案：${selectedAnswer.question}`,
      detail: `来自答案库，按「${selectedAnswer.framework}」练到可以自然复述。`,
      source: "answer",
      sourceLabel: "答案库",
      relatedEntityId: selectedAnswer.id,
      level: "P2",
    });
    setPage("weekly");
  };

  const startRandomAnswerPractice = () => {
    const candidates = filteredAnswerCards;
    if (!candidates.length) {
      setSystemMessage("没有可练习的答案卡");
      return;
    }

    let pickedIndex = Math.floor(Math.random() * candidates.length);
    if (candidates.length > 1 && candidates[pickedIndex]?.id === randomPracticeAnswerId) {
      pickedIndex = (pickedIndex + 1) % candidates.length;
    }

    const picked = candidates[pickedIndex];
    setRandomPracticeSpinning(true);
    setRandomPracticeReveal(false);
    window.setTimeout(() => {
      setRandomPracticeAnswerId(picked.id);
      setRandomPracticeSpinning(false);
      setSystemMessage("已抽出一张临时练习卡");
    }, 520);
  };

  const updateWeeklyTargetApplications = (targetApplications: number) => {
    const nextTarget = Number.isFinite(targetApplications) ? Math.max(0, Math.round(targetApplications)) : 0;
    setWeeklyPlan((plan) => ({ ...plan, targetApplications: nextTarget }));
    invalidateApiInsights();
    syncWeeklyPlanPatch({ targetApplications: nextTarget });
  };

  const updateWeeklyTargetDraft = (value: string) => {
    setWeeklyTargetDraft(value);
    if (value.trim() === "") return;
    updateWeeklyTargetApplications(Number(value));
  };

  const restoreWeeklyTargetDraft = () => {
    if (weeklyTargetDraft.trim() === "") setWeeklyTargetDraft(String(weeklyTargetApplications));
  };

  const promoteFocusToTask = (label: string, value: string) => {
    createWeeklyTask({
      title: `推进${value}`,
      detail: `由本周计划的「${label}」生成，今天可以拆成一个具体动作。`,
      source: "weekly-focus",
      sourceLabel: "本周计划",
      level: "P2",
    });
  };

  const createOpportunityDirect = () => {
    if (!composerDraft.company.trim() || !composerDraft.title.trim() || !composerDraft.sourceText.trim()) {
      setSystemMessage("请补齐公司、岗位和岗位描述");
      return;
    }

    const now = todayDateKey();
    const dueDate = composerDraft.dueDate || inferDueDateFromText(composerDraft.deadline);
    const suggestedAction = computeOpportunityAction({
      status: "TO APPLY",
      deadline: composerDraft.deadline,
      dueDate,
      match: composerDraft.match,
      priority: composerDraft.priority,
    });
    const action = composerDraft.actionManual && composerDraft.action ? composerDraft.action : suggestedAction;
    const recruitmentLink = composerSource.note.trim();
    const shouldKeepMaterialAsset = composerSource.sourceKind === "screenshot" || Boolean(composerSource.storageUri);
    const materialAssetKind: SourceAsset["kind"] = composerSource.sourceKind === "screenshot" ? "screenshot" : "jd-text";
    const sourceAssets: SourceAsset[] = [];
    if (recruitmentLink) {
      sourceAssets.push({
        id: makeId("SRC"),
        kind: "job-link",
        title: "招聘链接",
        detail: "来自招聘页面",
        createdAt: now,
        content: recruitmentLink,
      });
    }
    if (shouldKeepMaterialAsset) {
      sourceAssets.push({
        id: makeId("SRC"),
        kind: materialAssetKind,
        title: composerSource.fileName || composerDraft.sourceLabel || (materialAssetKind === "screenshot" ? "岗位截图" : "上传材料"),
        detail: materialAssetKind === "screenshot" ? "截图材料已保存" : "上传材料已保存",
        createdAt: now,
        content: composerDraft.sourceText.trim(),
        storageUri: composerSource.storageUri,
      });
    }
    const nextOpportunity: Opportunity = {
      id: makeId("OP"),
      title: composerDraft.title.trim(),
      company: composerDraft.company.trim(),
      status: "TO APPLY",
      priority: composerDraft.priority,
      match: composerDraft.match,
      action,
      actionManual: Boolean(composerDraft.actionManual),
      city: composerDraft.city.trim() || "待定",
      deadline: composerDraft.deadline.trim(),
      dueDate,
      resumeId: composerDraft.resumeId || resumeList[0]?.id || "",
      nextAction: composerDraft.nextAction.trim() || "补齐材料后投递",
      jdSummary: composerSource.note || "从上传材料整理出的岗位记录。",
      jdText: composerDraft.sourceText.trim(),
      sourceAssets,
      timeline: [
        { id: makeId("TL"), occurredAt: now, title: "写入岗位推进", detail: "必填信息满足后直接生成正式岗位记录", status: "done" },
        { id: makeId("TL"), occurredAt: "Next", title: composerDraft.nextAction.trim() || "补齐材料后投递", detail: "当前进度的备注", status: "next" },
      ],
    };

    setOpportunities((items) => [nextOpportunity, ...items]);
    setSelectedOpportunityId(nextOpportunity.id);
    syncCreatedOpportunity(nextOpportunity);
    setComposer(null);
    setPage("opportunityDetail");
    setSystemMessage("岗位已创建");
  };

  const createInterviewDirect = () => {
    if (!composerDraft.company.trim() || !composerDraft.role.trim() || !composerDraft.round.trim()) {
      setSystemMessage("请补齐公司、岗位和轮次");
      return;
    }

    const fileName = composerDraft.fileName.trim() || composerDraft.company.trim() + "-" + composerDraft.round.trim() + "-notes.txt";
    const isAudio = composerSource.sourceKind === "audio" || /\.(m4a|mp3|wav|aac|ogg)$/i.test(fileName);
    const now = formatNow();
    const transcriptFileName = isAudio ? fileName.replace(/\.[^.]+$/, "-transcript.md") : fileName;
    const sourceText = composerDraft.sourceText.trim();
    const hasUsableTranscript = Boolean(sourceText && !/^(?:录音文件|文字稿文件)[：:]/.test(sourceText));
    const sourceFiles: SessionFile[] = [
      {
        id: makeId("FILE"),
        kind: isAudio ? "audio" : "transcript",
        fileName,
        detail: composerSource.note || (isAudio ? "原录音，整理前会先转成文字" : "原始文字稿"),
        uploadedAt: now,
        duration: isAudio ? "待识别" : undefined,
        storageUri: composerSource.storageUri,
        content: isAudio ? undefined : sourceText || undefined,
      },
    ];

    if (isAudio) {
      sourceFiles.push({
        id: makeId("FILE"),
        kind: "transcript",
        fileName: transcriptFileName,
        detail: "由录音转写生成的文字稿，复盘问题从这里拆分",
        uploadedAt: now,
        content: hasUsableTranscript ? sourceText : undefined,
      });
    }

    if (interviewInputMode === "raw-transcript" && !composerParsedQaPairs.length) {
      setSystemMessage("请先用智能整理生成复盘");
      setComposerParseNotice("未整理的面试文稿需要先开启智能整理并生成复盘后，才能创建正式记录。");
      return;
    }

    const parsedQaPairs = composerParsedQaPairs.length ? composerParsedQaPairs : hasUsableTranscript ? parseTranscriptQaPairs(sourceText) : [];
    const qaPairs: QaPair[] = parsedQaPairs.length
      ? parsedQaPairs.map((pair) => ({
          ...pair,
          id: makeId("QA"),
        }))
      : [
      {
        id: makeId("QA"),
        question: hasUsableTranscript ? "待从文字稿中确认的面试问题" : "等待转写或粘贴面试文字稿",
        originalAnswer: hasUsableTranscript ? sourceText : "当前没有可用文字稿；请上传文字稿、粘贴转写内容，或开启录音转文字后重新整理。",
        type: "PROJECT",
        score: 2,
        critique: hasUsableTranscript ? "已有文字稿，但没有识别出清晰的问答结构；建议按“问题/回答”格式整理后重试。" : "缺少真实文字稿，暂时无法生成有效复盘。",
        weak: true,
        framework: "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
        optimizedAnswer: hasUsableTranscript ? "把文字稿整理成“面试官：问题 / 我：回答”的格式后，再重新整理会更稳定。" : "先获得真实文字稿，再生成优化回答。",
      },
    ];

    const nextSession: InterviewSession = {
      id: makeId("INT"),
      opportunityId: composerDraft.linkedOpportunityId || undefined,
      company: composerDraft.company.trim(),
      role: composerDraft.role.trim(),
      round: composerDraft.round.trim(),
      date: composerDraft.date.trim() || "Today",
      note: composerDraft.nextAction.trim(),
      reviewPriority: composerDraft.reviewPriority,
      sourceFiles,
      qaPairs,
    };

    setInterviewSessions((sessions) => [nextSession, ...sessions]);
    setSelectedInterviewId(nextSession.id);
    setSelectedQaId(nextSession.qaPairs[0]?.id ?? "");
    syncCreatedInterviewSession(nextSession);
    const linkedOpportunity = nextSession.opportunityId ? opportunities.find((item) => item.id === nextSession.opportunityId) : undefined;
    if (
      linkedOpportunity &&
      shouldAdvanceLinkedOpportunityAfterInterview(linkedOpportunity.status) &&
      (!isApiEnabled || !apiOpportunityIdsRef.current.has(linkedOpportunity.id))
    ) {
      applyOpportunityProgress(linkedOpportunity.id, "WAITING", "system", "新增" + nextSession.round + "面试复盘后自动推进");
    }
    setComposer(null);
    setInterviewView("session");
    setPage("interviews");
    setSystemMessage("面试复盘已创建");
  };

  const createResumeDirect = () => {
    if (!composerDraft.title.trim() || !composerDraft.fileName.trim()) {
      setSystemMessage("请补齐简历名称和文件");
      return;
    }

    const fileName = composerDraft.fileName.trim();
    const nextResume: ResumeVersion = {
      id: makeId("RV"),
      name: composerDraft.title.trim(),
      fileName,
      fileType: fileName.split(".").pop()?.toUpperCase() ?? "FILE",
      fileSize: composerSource.fileSize || "待读取",
      uploadedAt: "Now",
      roles: composerDraft.roles.trim() || "待填写",
      points: composerDraft.points.trim() || "待填写核心卖点",
      summary: composerDraft.summary.trim() || composerSource.note || "待填写文件摘要",
      linkedOpportunityIds: [],
      storageUri: composerSource.storageUri,
    };

    setResumeList((items) => [nextResume, ...items]);
    setSelectedResumeId(nextResume.id);
    syncCreatedResumeVersion(nextResume);
    setComposer(null);
    setPage("resumes");
    setSystemMessage("简历已添加");
  };

  const createAnswerDirect = () => {
    if (!composerDraft.question.trim()) {
      setSystemMessage("请先填写问题");
      return;
    }

    const newCard: AnswerCard = {
      id: makeId("AC"),
      question: composerDraft.question.trim(),
      type: "MANUAL",
      status: "DRAFT",
      source: "手动创建",
      categoryId: isAllAnswerCategorySelected || selectedAnswerCategory.system ? uncategorizedAnswerCategoryId : selectedAnswerCategory.id,
      framework: composerDraft.framework.trim() || "背景 -> 动作 -> 结果 -> 复盘",
      answer: composerDraft.answer.trim() || "在这里补充可复用回答。",
      relatedRoles: composerDraft.relatedRoles.trim() || "待填写",
      practiceStatus: "中等",
    };

    setAnswerCards((cards) => [newCard, ...cards]);
    setSelectedAnswerId(newCard.id);
    syncCreatedAnswerCard(newCard);
    setComposer(null);
    setAnswerView("detail");
    setPage("answers");
    setSystemMessage("答案卡已创建");
  };

  const submitComposer = () => {
    if (composer === "opportunity") createOpportunityDirect();
    if (composer === "interview") createInterviewDirect();
    if (composer === "resume") createResumeDirect();
    if (composer === "answer") createAnswerDirect();
  };

  const applyOpportunityProgress = (
    opportunityId: string,
    status: OpportunityStatus,
    source: "system" | "manual",
    detailOverride?: string,
  ) => {
    const targetOpportunity = opportunities.find((item) => item.id === opportunityId);
    if (!targetOpportunity) return;
    const now = todayDateKey();
    const nextAction = opportunityStatusNextAction[status];
    const nextActionLevel = targetOpportunity.actionManual
      ? targetOpportunity.action
      : computeOpportunityAction({ ...targetOpportunity, status });
    const timelineEvent = {
      id: makeId("TL"),
      occurredAt: now,
      title: source === "system" ? `进度更新为${statusLabel[status]}` : `已更新为${statusLabel[status]}`,
      detail: detailOverride || (source === "system" ? "根据相关记录更新岗位进度" : "手动更新当前岗位阶段"),
      status: "done" as const,
    };
    const buildLocalOpportunity = (opportunity: Opportunity): Opportunity => ({
      ...opportunity,
      status,
      action: opportunity.actionManual ? opportunity.action : computeOpportunityAction({ ...opportunity, status }),
      nextAction,
      timeline: [
        ...opportunity.timeline.filter((event) => event.status !== "next"),
        timelineEvent,
        ...(status !== "OFFER" && status !== "ENDED"
          ? [
              {
                id: makeId("TL"),
                occurredAt: "Next",
                title: nextAction,
                detail: "当前进度的备注",
                status: "next" as const,
              },
            ]
          : []),
      ],
    });
    const applyProgressSideEffects = (opportunity: Opportunity) => {
      if (submittedStatuses.includes(status)) {
        setResumeList((items) =>
          items.map((resume) =>
            resume.id === opportunity.resumeId && !resume.linkedOpportunityIds.includes(opportunity.id)
              ? { ...resume, linkedOpportunityIds: [...resume.linkedOpportunityIds, opportunity.id] }
              : resume,
          ),
        );
      }
    };
    const applyLocalProgress = () => {
      const nextOpportunity = buildLocalOpportunity(targetOpportunity);
      setOpportunities((items) => items.map((item) => (item.id === opportunityId ? nextOpportunity : item)));
      applyProgressSideEffects(nextOpportunity);
      setApiTodayActions(null);
      setSystemMessage(`已更新为${statusLabel[status]}`);
    };

    setApiTodayActions(null);
    if (isApiEnabled && apiOpportunityIdsRef.current.has(opportunityId)) {
      setSystemMessage("正在更新进度");
      void progressOpportunityApi(opportunityId, {
        status,
        action: nextActionLevel,
        nextAction,
        timelineEvent,
      })
        .then((savedOpportunity) => {
          setOpportunities((items) => items.map((item) => (item.id === opportunityId ? savedOpportunity : item)));
          applyProgressSideEffects(savedOpportunity);
          refreshApiInsights();
          setSystemMessage(`已更新为${statusLabel[status]}`);
        })
        .catch(() => {
          applyLocalProgress();
          setSystemMessage("岗位已保存在本机");
        });
      return;
    }

    applyLocalProgress();
  };

  const markOpportunityApplied = () => {
    if (!selectedOpportunity) return;
    applyOpportunityProgress(selectedOpportunity.id, "APPLIED", "manual", `使用 ${getResumeName(selectedOpportunity.resumeId)} 完成投递`);
  };

  const updateEndOpportunityDraft = (patch: Partial<EndOpportunityDraft>) => {
    endOpportunityDraftRef.current = { ...endOpportunityDraftRef.current, ...patch };
    setEndOpportunityDraft(endOpportunityDraftRef.current);
  };

  const endSelectedOpportunity = () => {
    if (!selectedOpportunity || selectedOpportunity.status === "ENDED") return;
    const draft = endOpportunityDraftRef.current;
    const endedAt = todayDateKey();
    const note = draft.note.trim();
    const nextTimeline: TimelineEvent[] = [
      ...selectedOpportunity.timeline.filter((event) => event.status !== "next"),
      {
        id: makeId("TL"),
        occurredAt: endedAt,
        title: `已结束：${endReasonLabel[draft.reason]}`,
        detail: note || "结束后保留面试复盘、简历关联、原始材料和时间线。",
        status: "done",
      },
    ];
    const patch: Partial<Opportunity> = {
      status: "ENDED",
      endedAt,
      endedReason: draft.reason,
      endedNote: note || null,
      previousStatus: selectedOpportunity.status,
      nextAction: "已结束，保留历史记录",
      timeline: nextTimeline,
    };
    setOpportunities((items) => items.map((item) => (item.id === selectedOpportunity.id ? { ...item, ...patch } : item)));
    setApiTodayActions(null);
    setApiDashboardSummary(null);
    syncUpdatedOpportunity(selectedOpportunity.id, patch);
    setSystemMessage("岗位已标记为已结束");
  };

  const requestEndSelectedOpportunity = () => {
    if (!selectedOpportunity || selectedOpportunity.status === "ENDED") return;
    const draft = emptyEndOpportunityDraft();
    endOpportunityDraftRef.current = draft;
    setEndOpportunityDraft(draft);
    requestConfirm({
      eyebrow: "结束岗位",
      title: "将这个岗位标记为已结束？",
      description: "结束后它会从默认「推进中」列表和「今日行动」隐藏，但会保留面试复盘、简历关联、原始材料和时间线。这个操作不是删除。",
      confirmLabel: "确认已结束",
      confirmTone: "primary",
      cancelLabel: "继续推进",
      contentKind: "end-opportunity",
      onConfirm: endSelectedOpportunity,
    });
  };

  const restoreSelectedOpportunity = () => {
    if (!selectedOpportunity || selectedOpportunity.status !== "ENDED") return;
    const restoredStatus = getRestorableOpportunityStatus(
      selectedOpportunity,
      interviewSessions.some((session) => session.opportunityId === selectedOpportunity.id),
    );
    const restoredAt = todayDateKey();
    const nextAction = opportunityStatusNextAction[restoredStatus];
    const nextTimeline: TimelineEvent[] = [
      ...selectedOpportunity.timeline.filter((event) => event.status !== "next"),
      {
        id: makeId("TL"),
        occurredAt: restoredAt,
        title: `恢复推进为${statusLabel[restoredStatus]}`,
        detail: "已清除结束状态，重新进入岗位推进。",
        status: "done",
      },
      ...(restoredStatus !== "OFFER"
        ? [
            {
              id: makeId("TL"),
              occurredAt: "Next",
              title: nextAction,
              detail: "恢复推进后生成下一步动作",
              status: "next" as const,
            },
          ]
        : []),
    ];
    const patch: Partial<Opportunity> = {
      status: restoredStatus,
      endedAt: null,
      endedReason: null,
      endedNote: null,
      previousStatus: null,
      nextAction,
      action: selectedOpportunity.actionManual ? selectedOpportunity.action : computeOpportunityAction({ ...selectedOpportunity, status: restoredStatus }),
      timeline: nextTimeline,
    };
    setOpportunities((items) => items.map((item) => (item.id === selectedOpportunity.id ? { ...item, ...patch } : item)));
    setApiTodayActions(null);
    setApiDashboardSummary(null);
    syncUpdatedOpportunity(selectedOpportunity.id, patch);
    setSystemMessage("岗位已恢复推进");
  };

  const applyOpportunityActionFilter = (actionFilter: string) => {
    const normalizedFilter = actionFilter.trim();
    if (!normalizedFilter) return;

    if (normalizedFilter === "ALL" || reviewPriorityOptions.some((item) => item.value === normalizedFilter)) {
      setOpportunityPriorityFilter(normalizedFilter as OpportunityPriorityFilter);
      setOpportunityTagFilters([]);
      setOpportunityPage(0);
      return;
    }

    const legacyTagFilterMap: Record<string, OpportunityTagFilter> = {
      "A PRIORITY": "HIGH_PRIORITY",
      "HIGH MATCH": "HIGH_MATCH",
      "DUE SOON": "DUE_SOON",
    };
    const tagFilter = legacyTagFilterMap[normalizedFilter];
    if (tagFilter) {
      setOpportunityPriorityFilter("ALL");
      setOpportunityTagFilters([tagFilter]);
      setOpportunityPage(0);
    }
  };

  const openTodayAction = (action: TodayAction) => {
    if (action.filter) applyOpportunityActionFilter(action.filter);
    if (action.page === "opportunityDetail") {
      setOpportunityVisibility("ACTIVE");
      const targetOpportunityId = action.targetId || opportunities.find((item) => resolveOpportunityAction(item) === "P0")?.id || opportunities[0]?.id;
      if (targetOpportunityId) openOpportunity(targetOpportunityId);
    } else if (action.page === "interviews" && action.targetId) {
      openInterviewSession(action.targetId);
      goTo("interviews");
    } else if (action.page === "answers" && action.targetId) {
      openAnswerCard(action.targetId);
      goTo("answers");
    } else {
      goTo(action.page);
    }
  };

  const completeTodayAction = (action: TodayAction) => {
    if (action.source === "weekly") {
      const taskId = action.taskId || (action.page === "weekly" ? action.targetId : "");
      if (!taskId) return;
      updateWeeklyTask(taskId, "status", "done");
      setApiTodayActions(null);
      setSystemMessage("今日任务已完成");
      return;
    }

    if (action.source === "opportunity" && action.targetId) {
      const opportunity = opportunities.find((item) => item.id === action.targetId);
      if (!opportunity) return;
      const nextStatus = completedOpportunityStatus(opportunity.status);
      if (nextStatus) {
        applyOpportunityProgress(opportunity.id, nextStatus, "manual", action.title);
      } else {
        setDismissedTodayIds((ids) => new Set(ids).add(todayActionKey(action)));
        setSystemMessage("今日已完成");
      }
      setApiTodayActions(null);
      return;
    }

    if (action.source === "interview" && action.targetId) {
      const session = interviewSessions.find((item) => item.id === action.targetId);
      if (!session) return;
      const weakPairs = session.qaPairs.filter((pair) => pair.weak);
      setInterviewSessions((sessions) =>
        sessions.map((item) =>
          item.id === session.id ? { ...item, qaPairs: item.qaPairs.map((pair) => (pair.weak ? { ...pair, weak: false } : pair)) } : item,
        ),
      );
      weakPairs.forEach((pair) => syncUpdatedQaPair(pair.id, { weak: false }));
      setApiTodayActions(null);
      setSystemMessage("复盘任务已完成");
      return;
    }

    setDismissedTodayIds((ids) => new Set(ids).add(todayActionKey(action)));
    setSystemMessage("今日已暂不显示");
  };

  const homeGoalCta = !hasWeeklyTarget
    ? {
        label: "设置本周目标",
        icon: CalendarClock,
        action: () => goTo("weekly"),
      }
    : applicationGap > 0
      ? {
          label: "去投下一个岗位",
          icon: BriefcaseBusiness,
          action: () => {
            if (toApplyCount > 0) {
              setOpportunityVisibility("ACTIVE");
              setOpportunityPriorityFilter("P0");
              setOpportunityTagFilters([]);
              setOpportunityPage(0);
              goTo("opportunities");
              return;
            }
            openComposer("opportunity");
          },
        }
      : todayActions.length > 0
        ? {
            label: "完成第一项行动",
            icon: Check,
            action: () => openTodayAction(todayActions[0]),
          }
        : {
            label: "添加自训练",
            icon: Plus,
            action: openWeeklyTaskDialog,
          };
  const HomeGoalCtaIcon = homeGoalCta.icon;
  const homeGoalTitle = !hasWeeklyTarget
    ? "先定一个本周投递目标"
    : applicationGap > 0
      ? `这周还差 ${applicationGap} 个投递`
      : "本周投递目标已完成";

  const homeEmptyState = !hasWeeklyTarget
    ? {
        title: "先定一个本周投递目标",
        detail: "不设置也能继续使用今日行动；设定目标后，首页会告诉你本周还差多少次投递。",
        primaryLabel: "去设置目标",
        primaryAction: () => goTo("weekly"),
        secondaryLabel: "新增岗位",
        secondaryAction: () => openComposer("opportunity"),
      }
    : applicationGap > 0
      ? {
          title: "今天还没有行动，先补岗位来源",
          detail: `本周还差 ${applicationGap} 个投递，可以先新增一个岗位，把下一步投递动作放进今日行动。`,
          primaryLabel: "去投下一个岗位",
          primaryAction: () => openComposer("opportunity"),
          secondaryLabel: "查看岗位推进",
          secondaryAction: () => goTo("opportunities"),
        }
      : {
          title: "目标已达成，今天没有待办",
          detail: "可以添加一条自训练，或上传面试复盘，把需要练的问题纳入本周计划。",
          primaryLabel: "添加自训练",
          primaryAction: openWeeklyTaskDialog,
          secondaryLabel: "导入面试复盘",
          secondaryAction: () => openComposer("interview"),
        };

  const isNavItemActive = (id: Page) => page === id || (page === "opportunityDetail" && id === "opportunities");
  const libraryNavActive = libraryNavItems.some((item) => isNavItemActive(item.id));
  const renderNavButton = (item: (typeof navItems)[number], className = "") => {
    const Icon = item.icon;
    const active = isNavItemActive(item.id);
    return (
      <button
        key={item.id}
        type="button"
        className={`nav-item ${className} ${active ? "active" : ""}`}
        onClick={() => goTo(item.id)}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
      >
        <Icon size={18} aria-hidden="true" />
        <span className="nav-label">{item.label}</span>
      </button>
    );
  };

  const addSelectedQaToPractice = () => {
    createWeeklyTask({
      title: `练习：${selectedQa.question}`,
      detail: `来自${selectedInterview.company} / ${selectedInterview.round}，按推荐框架重写并练习表达。`,
      source: "interview",
      sourceLabel: "面试复盘",
      relatedEntityId: selectedInterview.id,
      level: "P2",
    });
    setPage("weekly");
  };

  const createAnswerCard = () => {
    const existingCard = answerCards.find((card) => card.sourceQaPairId === selectedQa.id || card.question === selectedQa.question);
    if (existingCard) {
      openAnswerCard(existingCard.id);
      setPage("answers");
      setSystemMessage("已打开答案卡");
      return;
    }

    const createLocalAnswerCard = () => {
      const newCard: AnswerCard = {
        id: makeId("AC"),
        question: selectedQa.question,
        type: selectedQa.type,
        status: "ACTIVE",
        source: "面试复盘",
        sourceQaPairId: selectedQa.id,
        categoryId: uncategorizedAnswerCategoryId,
        framework: selectedQa.framework,
        answer: selectedQa.optimizedAnswer,
        relatedRoles: selectedInterview.role,
        practiceStatus: selectedQa.weak ? "薄弱" : "中等",
      };
      setAnswerCards((cards) => [newCard, ...cards]);
      setSelectedAnswerId(newCard.id);
      setAnswerView("detail");
      syncCreatedAnswerCard(newCard);
      setPage("answers");
      setSystemMessage("答案卡已创建");
    };

    if (isApiEnabled) {
      setSystemMessage("正在生成答案卡");
      void createAnswerCardFromQaPairApi(selectedQa.id)
        .then((savedCard) => {
          setAnswerCards((cards) =>
            cards.some((card) => card.id === savedCard.id || card.sourceQaPairId === savedCard.sourceQaPairId)
              ? cards.map((card) => (card.id === savedCard.id || card.sourceQaPairId === savedCard.sourceQaPairId ? savedCard : card))
              : [savedCard, ...cards],
          );
          setSelectedAnswerId(savedCard.id);
          setAnswerView("detail");
          setPage("answers");
          setSystemMessage("答案卡已创建");
        })
        .catch(() => {
          createLocalAnswerCard();
          setSystemMessage("答案卡已保存在本机");
        });
      return;
    }

    createLocalAnswerCard();
  };

  const renderAnswerCategoryEditor = (matches: boolean, depth: number) => {
    if (!answerCategoryEditor || !matches) return null;
    const label = answerCategoryEditor.mode === "create" ? "新增分类" : "重命名分类";
    return (
      <div className="answer-category-inline-editor" style={{ "--category-depth": depth } as CSSProperties}>
        <span>{label}</span>
        <input
          autoFocus
          value={answerCategoryEditor.name}
          onChange={(event) => setAnswerCategoryEditor((editor) => (editor ? { ...editor, name: event.target.value } : editor))}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitAnswerCategoryEditor();
            if (event.key === "Escape") setAnswerCategoryEditor(null);
          }}
          placeholder="分类名称"
        />
        <div>
          <button className="primary-button compact-button" onClick={commitAnswerCategoryEditor}>
            保存
          </button>
          <button className="ghost-button compact-button" onClick={() => setAnswerCategoryEditor(null)}>
            取消
          </button>
        </div>
      </div>
    );
  };

  const renderAnswerCategoryTree = (category: AnswerCategory, depth = 0) => {
    const children = answerCategoryChildren.get(category.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = expandedAnswerCategoryIds.has(category.id);
    const active = !isAllAnswerCategorySelected && selectedAnswerCategory.id === category.id;
    const dropTarget = answerCategoryDropTargetId === category.id;
    const FolderIcon = hasChildren && expanded ? FolderOpen : Folder;

    return (
      <div key={category.id} className="answer-category-node">
        <div
          className={`answer-category-row ${active ? "active" : ""} ${dropTarget ? "drop-target" : ""}`}
          style={{ "--category-depth": depth } as CSSProperties}
          onDragOver={(event) => handleAnswerCategoryDragOver(event, category.id)}
          onDragLeave={(event) => handleAnswerCategoryDragLeave(event, category.id)}
          onDrop={(event) => handleAnswerCategoryDrop(event, category.id)}
        >
          <button
            className="answer-category-toggle"
            onClick={() => hasChildren && toggleAnswerCategoryExpanded(category.id)}
            disabled={!hasChildren}
            aria-label={expanded ? "收起分类" : "展开分类"}
          >
            {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}
          </button>
          <button
            className="answer-category-main"
            aria-current={active ? "true" : undefined}
            onClick={() => {
              setSelectedAnswerCategoryId(category.id);
              setOpenAnswerCategoryMenuId("");
              setAnswerPage(0);
              setAnswerView("list");
            }}
            title="拖入答案卡可移动到此分类"
          >
            <FolderIcon size={16} />
            <span>{category.name}</span>
            {category.system ? <em>系统</em> : null}
          </button>
          {!category.system ? (
            <div className="answer-category-actions">
              <button className="answer-category-icon-action" onClick={() => openCreateAnswerCategoryEditor(category.id)} aria-label={`在${category.name}下新增子分类`}>
                <Plus size={13} />
              </button>
              <div className="answer-category-menu-wrap">
                <button
                  className="answer-category-icon-action"
                  onClick={() => setOpenAnswerCategoryMenuId((id) => (id === category.id ? "" : category.id))}
                  aria-label={`${category.name}更多操作`}
                  aria-expanded={openAnswerCategoryMenuId === category.id}
                >
                  ⋮
                </button>
                {openAnswerCategoryMenuId === category.id ? (
                  <div className="answer-category-menu">
                    <button onClick={() => openRenameAnswerCategoryEditor(category)}>
                      <Pencil size={13} />
                      <span>重命名</span>
                    </button>
                    <button
                      className="answer-category-menu-danger"
                      onClick={() => {
                        setOpenAnswerCategoryMenuId("");
                        requestConfirm({
                          title: "删除这个分类？",
                          description: `「${category.name}」及其子分类会被删除，里面的答案卡会移动到「尚未归类」。`,
                          confirmLabel: "删除分类",
                          onConfirm: () => deleteAnswerCategory(category),
                        });
                      }}
                    >
                      <Trash2 size={13} />
                      <span>删除</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {renderAnswerCategoryEditor(answerCategoryEditor?.mode === "rename" && answerCategoryEditor.categoryId === category.id, depth)}
        {renderAnswerCategoryEditor(answerCategoryEditor?.mode === "create" && answerCategoryEditor.parentId === category.id, depth + 1)}
        {hasChildren && expanded ? children.map((child) => renderAnswerCategoryTree(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <div className={`app ${theme}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">JP</div>
          <div>
            <div className="brand-title">JobPilot</div>
            <div className="brand-subtitle">LOCAL OPS</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-group nav-group-primary">{primaryNavItems.map((item) => renderNavButton(item))}</div>
          <div className={`nav-group nav-group-library ${libraryNavActive ? "has-active-child" : ""}`}>
            <button
              type="button"
              className={`nav-section-toggle ${libraryNavActive && !libraryNavOpen ? "active" : ""}`}
              aria-expanded={libraryNavOpen}
              aria-label={libraryNavOpen ? "收起资料库导航" : "展开资料库导航"}
              onClick={() => setLibraryNavOpen((open) => !open)}
            >
              {libraryNavOpen ? <FolderOpen size={18} aria-hidden="true" /> : <Folder size={18} aria-hidden="true" />}
              <span className="nav-label">资料库</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {libraryNavOpen ? <div className="nav-subitems">{libraryNavItems.map((item) => renderNavButton(item, "nav-subitem"))}</div> : null}
          </div>
          <div className="nav-group nav-group-system">{systemNavItems.map((item) => renderNavButton(item, "nav-system-item"))}</div>
        </nav>

        <div className="sidebar-footer">
          <ApiModeBadge apiMode={apiMode} onRefresh={refreshApiHealth} />
          <div className="sidebar-footer-meta">
            <div className="system-readout">
              <span>LOCAL DATA</span>
              <strong aria-live="polite">{systemMessage}</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              title="切换主题"
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {pageShowsTopSearch(page) ? (
          <header className="topbar">
            <div className="search-box search-box-full">
              <Search size={16} />
              <input
                value={query}
                aria-label={topSearchPlaceholder(page)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setInterviewPage(0);
                  setAnswerPage(0);
                  setOpportunityPage(0);
                  setWeeklyInterviewPage(0);
                  setWeeklyPracticePage(0);
                }}
                placeholder={topSearchPlaceholder(page)}
              />
            </div>
          </header>
        ) : null}

        {page === "home" && (
          <section className="home-stack">
            <section className="home-goal-panel surface">
              <div className="home-goal-heading">
                <div>
                  <span className="eyebrow">本周投递进度</span>
                  <h1>{homeGoalTitle}</h1>
                </div>
                <strong>{submittedApplications} / {hasWeeklyTarget ? weeklyTargetApplications : "未设置"}</strong>
              </div>
              <p className="home-goal-summary">先对齐目标和进度，再处理今天需要推进的事。</p>
              <div className="home-goal-meter" aria-label="本周投递进度">
                <div className="linear-progress" aria-hidden="true">
                  <span style={{ width: `${weeklyProgressPercent}%` }} />
                </div>
                <div className="home-goal-stats">
                  <span>本周目标：{hasWeeklyTarget ? `${weeklyTargetApplications} 个岗位` : "未设置"}</span>
                  <span>已完成：{submittedApplications} 个</span>
                  <span>还差：{hasWeeklyTarget ? (applicationGap > 0 ? `${applicationGap} 个` : "已达标") : "先设置目标"}</span>
                </div>
              </div>
              <div className="home-goal-controls">
                <label>
                  <span>编辑目标</span>
                  <input
                    type="number"
                    min="0"
                    value={weeklyTargetDraft}
                    onBlur={restoreWeeklyTargetDraft}
                    onChange={(event) => updateWeeklyTargetDraft(event.target.value)}
                    aria-label="本周投递目标"
                  />
                </label>
                <button className="primary-button" onClick={homeGoalCta.action}>
                  <HomeGoalCtaIcon size={16} />
                  <span>{homeGoalCta.label}</span>
                </button>
                <button className="secondary-button" onClick={() => goTo("weekly")}>
                  <CalendarClock size={16} />
                  <span>调整本周目标</span>
                </button>
              </div>
            </section>

            <section className="today-focus surface">
              <div className="today-focus-header">
                <div>
                  <div className="title-with-help">
                    <span className="eyebrow">今日行动</span>
                    <span
                      className="field-tooltip today-help"
                      tabIndex={0}
                      data-tooltip="今日行动不是手动待办清单，而是从岗位阶段、面试复盘里的待整理问题和本周计划任务自动生成。答案卡不会直接提醒你练习；加入本周计划后，才会出现在这里。"
                      aria-label="今日行动生成规则"
                    >
                      ?
                    </span>
                  </div>
                  <h2>今天先推进这几件事</h2>
                  <p>无需手动列清单，JobPilot 会根据岗位进度、复盘、本周计划和你指定的任务优先级安排今天要做的事。</p>
                </div>
                <div className="hero-number small">{todayActions.length}</div>
              </div>

              {topTodayActions.length > 0 ? (
                <>
                  <div className="today-card-list">
                    {topTodayActions.map((action, index) => (
                      <article className={`today-action-card today-source-${action.source}`} key={todayActionKey(action)}>
                        <span className="today-action-rank">{String(index + 1).padStart(2, "0")}</span>
                        <button className="today-action-open" onClick={() => openTodayAction(action)}>
                          <span className="today-action-icon" aria-hidden="true">
                            {action.source === "opportunity" ? <BriefcaseBusiness size={16} /> : action.source === "interview" ? <FileAudio size={16} /> : <CalendarClock size={16} />}
                          </span>
                          <span className={`priority ${action.level.toLowerCase()}`}>{action.level}</span>
                          <span className="source-chip">{todayActionSourceLabel(action)}</span>
                          <h3>{action.title}</h3>
                        </button>
                        <details className="today-action-context">
                          <summary>查看来源和下一步</summary>
                          <dl>
                            <div>
                              <dt>来源</dt>
                              <dd>{todayActionSourceDetail(action)}</dd>
                            </div>
                            <div>
                              <dt>为什么出现</dt>
                              <dd>{todayActionReason(action)}</dd>
                            </div>
                            <div>
                              <dt>完成后</dt>
                              <dd>{todayActionOutcome(action)}</dd>
                            </div>
                          </dl>
                        </details>
                        <button className="secondary-button compact-button action-complete-button" onClick={() => completeTodayAction(action)}>
                          完成
                        </button>
                      </article>
                    ))}
                  </div>

                  {moreTodayActions.length > 0 ? (
                    <div className="today-more-panel">
                      <button className="ghost-button today-more-toggle" onClick={() => setShowMoreTodayActions((visible) => !visible)}>
                        {showMoreTodayActions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span>{showMoreTodayActions ? "收起更多行动" : `还有 ${moreTodayActions.length} 条行动`}</span>
                      </button>
                      {showMoreTodayActions ? (
                        <div className="action-list today-secondary-list">
                          {moreTodayActions.map((action) => (
                            <div className="action-row" key={todayActionKey(action)}>
                              <button className="action-row-main" onClick={() => openTodayAction(action)}>
                                <span className={`priority ${action.level.toLowerCase()}`}>{action.level}</span>
                                <span className="action-copy">
                                  <strong>
                                    <em className="source-chip">{todayActionSourceLabel(action)}</em>
                                    {action.title}
                                  </strong>
                                </span>
                                <ChevronRight size={16} />
                              </button>
                              <button className="secondary-button compact-button action-complete-button" onClick={() => completeTodayAction(action)}>
                                完成
                              </button>
                              <details className="today-action-context today-secondary-context">
                                <summary>查看来源和下一步</summary>
                                <dl>
                                  <div>
                                    <dt>来源</dt>
                                    <dd>{todayActionSourceDetail(action)}</dd>
                                  </div>
                                  <div>
                                    <dt>为什么出现</dt>
                                    <dd>{todayActionReason(action)}</dd>
                                  </div>
                                  <div>
                                    <dt>完成后</dt>
                                    <dd>{todayActionOutcome(action)}</dd>
                                  </div>
                                </dl>
                              </details>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state home-empty-state">
                  <h3>{homeEmptyState.title}</h3>
                  <p>{homeEmptyState.detail}</p>
                  <div className="button-row">
                    <button className="primary-button" onClick={homeEmptyState.primaryAction}>
                      {homeEmptyState.primaryLabel}
                    </button>
                    <button className="secondary-button" onClick={homeEmptyState.secondaryAction}>
                      {homeEmptyState.secondaryLabel}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </section>
        )}

        {page === "opportunities" && (
          <section className="surface table-page paginated-pane">
            <div className="paginated-pane-header">
              <PageIntro
                label="岗位推进"
                title="你正在跟进的岗位"
                detail="按优先级、匹配度和截止时间管理投递备注。"
                action={`${filteredOpportunities.length} 个岗位`}
              />
              <div className="toolbar-row">
                <div className="opportunity-filter-groups">
                  <div className="opportunity-scope-row" aria-label="岗位记录范围">
                    <div className="opportunity-scope-tabs">
                      {opportunityVisibilityOptions.map((item) => (
                        <button
                          key={item.value}
                          className={`opportunity-scope-tab ${opportunityVisibility === item.value ? "active-scope-tab" : ""}`}
                          aria-current={opportunityVisibility === item.value ? "true" : undefined}
                          onClick={() => {
                            setOpportunityVisibility(item.value);
                            setOpportunityPage(0);
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                      <span className="opportunity-scope-divider" aria-hidden="true">·</span>
                      <button
                        className={`opportunity-ended-link ${opportunityVisibility === "ENDED" ? "active-ended-link" : ""}`}
                        aria-current={opportunityVisibility === "ENDED" ? "true" : undefined}
                        onClick={() => {
                          setOpportunityVisibility(opportunityVisibility === "ENDED" ? "ACTIVE" : "ENDED");
                          setOpportunityPage(0);
                        }}
                      >
                        {opportunityVisibility === "ENDED" ? "查看推进中" : "已结束记录"}
                      </button>
                    </div>
                  </div>
                  <div className="filter-bar opportunity-filter-bar" aria-label="岗位筛选">
                    {opportunityPriorityOptions.map((item) => (
                      <button
                        key={item.value}
                        className={opportunityPriorityFilter === item.value ? "active-filter" : ""}
                        aria-pressed={opportunityPriorityFilter === item.value}
                        onClick={() => selectOpportunityPriorityFilter(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                    <span className="opportunity-filter-separator" aria-hidden="true">|</span>
                    {opportunityTagOptions.map((item) => (
                      <button
                        key={item.value}
                        className={opportunityTagFilters.includes(item.value) ? "active-filter" : ""}
                        aria-pressed={opportunityTagFilters.includes(item.value)}
                        onClick={() => toggleOpportunityTagFilter(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {hasOpportunitySearchOrFilters ? (
                    <button type="button" className="ghost-button compact-button opportunity-clear-filters" onClick={clearOpportunitySearchAndFilters}>
                      {normalizedQuery ? "清除搜索和筛选" : "清除筛选"}
                    </button>
                  ) : null}
                </div>
                <div className="view-toggle">
                  <button className="primary-chip" type="button" onClick={() => openComposer("opportunity")}>
                    <Plus size={14} />
                    新增岗位
                  </button>
                  <div className="view-mode-switch" role="group" aria-label="岗位展示方式">
                    <button
                      className={`view-mode-segment ${viewMode === "table" ? "active-view-mode" : ""}`}
                      type="button"
                      onClick={() => selectOpportunityViewMode("table")}
                      aria-label="切换为表格视图"
                      aria-pressed={viewMode === "table"}
                      title="表格视图"
                    >
                      <FileText size={14} aria-hidden="true" />
                      <span>表格</span>
                    </button>
                    <button
                      className={`view-mode-segment ${viewMode === "board" ? "active-view-mode" : ""}`}
                      type="button"
                      onClick={() => selectOpportunityViewMode("board")}
                      aria-label="切换为看板视图"
                      aria-pressed={viewMode === "board"}
                      title="看板视图"
                    >
                      <KanbanSquare size={14} aria-hidden="true" />
                      <span>看板</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="paginated-pane-body">
              {viewMode === "table" ? (
                <div className="opportunity-table paginated-pane-content paginated-table-content">
                  <div className="table-head">
                    <span>岗位</span>
                    <span>状态</span>
                    <span>优先级</span>
                    <span>截止日期</span>
                    <span>下一步动作</span>
                  </div>
                  {filteredOpportunities.length === 0 ? (
                    <EmptyState title="没有匹配的岗位" detail="清空搜索或切换范围、优先级、标签筛选后再看。" className="table-empty-state" />
                  ) : (
                    visibleTableOpportunities.map((item) => (
                      <button className="table-row table-button" key={item.id} onClick={() => openOpportunity(item.id)}>
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.company} / {item.city} / {getResumeName(item.resumeId)}</small>
                        </span>
                        <StatusPill status={item.status} />
                        <span className="signal-stack">
                          <b className={`priority ${resolveOpportunityAction(item).toLowerCase()}`}>{resolveOpportunityAction(item)}</b>
                          <small>{item.priority} / {item.match}</small>
                        </span>
                        <span className="mono">{getOpportunityDueDate(item)}</span>
                        <span>{item.nextAction}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="paginated-pane-content">
                  {filteredOpportunities.length === 0 ? (
                    <EmptyState title="看板里没有匹配岗位" detail="调整搜索、范围或标签筛选后会重新显示分组结果。" />
                  ) : (
                    <BoardView opportunities={filteredOpportunities} scope={opportunityVisibility} openOpportunity={openOpportunity} />
                  )}
                </div>
              )}
            </div>
            {viewMode === "table" && (
              <ListPager
                className="paginated-pane-footer"
                label="岗位列表"
                page={safeOpportunityPage}
                pageCount={opportunityPageCount}
                onPageChange={setOpportunityPage}
              />
            )}
          </section>
        )}

        {page === "opportunityDetail" && (
          <section className="split-page opportunity-detail-page">
            <div className="surface">
              <button className="ghost-button back-button" onClick={() => goTo("opportunities")}>
                <ChevronLeft size={16} />
                <span>返回岗位推进</span>
              </button>
              <PageIntro
                label={selectedOpportunity.id}
                title={selectedOpportunity.title}
                detail="这里记录这份岗位的进度、原始材料和备注。"
                action={selectedOpportunityHeaderAction}
              />
              <div className="source-panel">
                <SectionTitle label="材料" title="原始材料" action={`${visibleOpportunitySourceAssets.length} 份`} />
                <div className="source-list">
                  {visibleOpportunitySourceAssets.length === 0 ? (
                    <p className="empty-list-note">暂无招聘链接或上传文件。</p>
                  ) : (
                    visibleOpportunitySourceAssets.map((asset) => (
                      <button className="source-item source-button" key={asset.id} onClick={() => setPreviewAsset(asset)}>
                        <div>
                          <span>{sourceKindLabel[asset.kind]}</span>
                          <strong>{asset.title}</strong>
                          <small>{asset.detail}</small>
                        </div>
                        <em>{asset.createdAt}</em>
                      </button>
                    ))
                  )}
                </div>
                <div className="jd-brief">
                  <span>岗位描述原文</span>
                  <textarea className="jd-full-text" value={selectedOpportunity.jdText} onChange={(event) => updateSelectedOpportunity({ jdText: event.target.value })} />
                </div>
              </div>
              <div className="draft-edit-grid opportunity-edit-grid">
                <label>
                  <span>公司</span>
                  <input value={selectedOpportunity.company} onChange={(event) => updateSelectedOpportunity({ company: event.target.value })} />
                </label>
                <label>
                  <span>岗位名称</span>
                  <input value={selectedOpportunity.title} onChange={(event) => updateSelectedOpportunity({ title: event.target.value })} />
                </label>
                <label>
                  <span>状态</span>
                  <input readOnly value={statusLabel[selectedOpportunity.status]} />
                </label>
                <label>
                  <span>主观优先级</span>
                  <select value={selectedOpportunity.priority} onChange={(event) => updateSelectedOpportunity({ priority: event.target.value as Opportunity["priority"] })}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                </label>
                <label>
                  <span>匹配度</span>
                  <select value={selectedOpportunity.match} onChange={(event) => updateSelectedOpportunity({ match: event.target.value as Opportunity["match"] })}>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </label>
                <label>
                  <span className="field-label-row">
                    <span>今日优先级</span>
                    <span className="field-tooltip" tabIndex={0} aria-label={selectedOpportunityActionHint} data-tooltip={selectedOpportunityActionHint}>
                      ?
                    </span>
                  </span>
                  <select
                    value={selectedOpportunity.actionManual ? selectedOpportunity.action : "AUTO"}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "AUTO") {
                        updateSelectedOpportunity({ actionManual: false, action: computeOpportunityAction(selectedOpportunity) });
                        return;
                      }
                      updateSelectedOpportunity({ actionManual: true, action: value as Opportunity["action"] });
                    }}
                  >
                    <option value="AUTO">自动（建议 {selectedOpportunitySuggestedAction}）</option>
                    <option value="P0">P0</option>
                    <option value="P1">P1</option>
                    <option value="P2">P2</option>
                    <option value="P3">P3</option>
                  </select>
                </label>
                <label>
                  <span>城市</span>
                  <input value={selectedOpportunity.city} onChange={(event) => updateSelectedOpportunity({ city: event.target.value })} />
                </label>
                <label>
                  <span>使用简历</span>
                  <select value={selectedOpportunity.resumeId} onChange={(event) => updateSelectedOpportunity({ resumeId: event.target.value })}>
                    {resumeList.map((resume) => (
                      <option key={resume.id} value={resume.id}>
                        {resume.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>下一步动作</span>
                  <input value={selectedOpportunity.nextAction} onChange={(event) => updateSelectedOpportunity({ nextAction: event.target.value })} />
                </label>
                <div className="date-field">
                  <label htmlFor="opportunity-detail-due-date">截止日期</label>
                  <DatePickerInput
                    id="opportunity-detail-due-date"
                    value={selectedOpportunity.dueDate ?? ""}
                    label="截止日期"
                    onChange={(value) => updateSelectedOpportunity({ dueDate: value })}
                  />
                </div>
                <label className="wide-field opportunity-note-field">
                  <span>备注</span>
                  <textarea value={selectedOpportunity.deadline} onChange={(event) => updateSelectedOpportunity({ deadline: event.target.value })} />
                </label>
              </div>
              <div className="button-row">
                {!selectedOpportunityEnded ? (
                  <button className="primary-button" onClick={markOpportunityApplied}>标记已投递</button>
                ) : null}
                <button className="secondary-button" onClick={() => openComposer("interview", selectedOpportunity.id)}>添加面试</button>
              </div>
              <div className="opportunity-status-section">
                <SectionTitle label="岗位进度" title="进度" action={statusLabel[selectedOpportunity.status]} />
                <div className="opportunity-progress-track" aria-label={`当前进度：${statusLabel[selectedOpportunity.status]}`}>
                  {opportunityStatusFlow.map((status, index) => {
                    const displayStatus = selectedOpportunityEnded ? selectedOpportunity.previousStatus : selectedOpportunity.status;
                    const currentIndex = displayStatus ? opportunityStatusFlow.indexOf(displayStatus) : -1;
                    const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "next";
                    return (
                      <button
                        key={status}
                        className={`opportunity-progress-step ${state}`}
                        disabled={selectedOpportunityEnded}
                        onClick={() => applyOpportunityProgress(selectedOpportunity.id, status, "manual")}
                      >
                        <span>{index + 1}</span>
                        <strong>{statusLabel[status]}</strong>
                      </button>
                    );
                  })}
                </div>
                {!selectedOpportunityEnded ? (
                  <p className="opportunity-progress-note">
                    {selectedOpportunity.status === "TO APPLY"
                      ? "今日行动里点完成后，会同步标记为已投递。"
                      : selectedOpportunity.status === "WRITTEN TEST"
                        ? "完成笔试行动后，会推进到筛选中。"
                        : selectedOpportunity.status === "SCREENING"
                          ? "筛选通过后，可以手动切到准备面试并生成面试准备待办。"
                          : "阶段有变化时，可以直接点击上面的节点更新。"}
                  </p>
                ) : null}
                <div className={`opportunity-end-panel ${selectedOpportunityEnded ? "is-ended" : ""}`}>
                  {selectedOpportunityEnded ? (
                    <>
                      <div className="opportunity-end-copy">
                        <span className="opportunity-ended-status">
                          <StatusPill status="ENDED" />
                          <strong>已结束 · {selectedOpportunityEndReason} · {formatEndedDate(selectedOpportunity.endedAt)}</strong>
                        </span>
                        <span
                          className="field-tooltip opportunity-end-help"
                          tabIndex={0}
                          data-tooltip="结束流程不会删除记录，也不会解绑面试复盘、简历或原始材料。"
                          aria-label="结束流程保留内容说明"
                        >
                          ?
                        </span>
                      </div>
                      <button className="secondary-button compact-button" onClick={restoreSelectedOpportunity} aria-label="恢复推进这个岗位">
                        <RotateCcw size={14} />
                        <span>恢复推进</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="opportunity-end-copy">
                        <span className="opportunity-end-question">不再推进这个岗位？</span>
                        <span
                          className="field-tooltip opportunity-end-help"
                          tabIndex={0}
                          data-tooltip="结束流程不会删除记录，也不会解绑面试复盘、简历或原始材料。"
                          aria-label="结束流程保留内容说明"
                        >
                          ?
                        </span>
                      </div>
                      <button className="secondary-button compact-button" onClick={requestEndSelectedOpportunity} aria-label="结束跟进这个岗位">
                        <span>结束跟进</span>
                      </button>
                    </>
                  )}
                </div>
                <div className="opportunity-history-box">
                  <label>
                    <span>历史时间线</span>
                    <textarea
                      value={selectedOpportunityHistoryDraft}
                      placeholder={historyTimelinePlaceholder}
                      onChange={(event) => {
                        const value = event.target.value;
                        setOpportunityHistoryDrafts((drafts) => ({ ...drafts, [selectedOpportunity.id]: value }));
                        updateSelectedOpportunity({
                          timeline: parseOpportunityHistory(value, selectedOpportunity.timeline),
                        });
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="danger-zone">
                <span>危险操作</span>
                <button
                  className="destructive-button"
                  onClick={() =>
                    requestConfirm({
                      title: "删除这个岗位？",
                      description: `「${selectedOpportunity.company} / ${selectedOpportunity.title}」删除后无法恢复；已关联的面试复盘会保留，但会和该岗位解绑。`,
                      confirmLabel: "删除岗位",
                      onConfirm: deleteSelectedOpportunity,
                    })
                  }
                >
                  删除当前岗位
                </button>
              </div>
            </div>
          </section>
        )}

        {page === "interviews" && (
          <section className="interview-page">
            {interviewView === "list" ? (
              <div className="surface interview-list-pane interview-home-pane paginated-pane">
                <div className="paginated-pane-header">
                  <PageIntro
                    label="面试复盘"
                    title="记录每一场面试"
                    detail="保存面试基本信息、问题、原回答、复盘建议和优化回答。"
                    action={`${interviewSessions.length} 场面试`}
                    helpTooltip="待整理问题指复盘中被标记为薄弱、还需要整理或练习的问题。只要一场面试还有待整理问题，它就会进入今日行动；标记已处理后会从今日行动中移除。"
                    helpLabel="待整理问题说明"
                  />

                  <div className="button-row tight-row">
                    <button className="primary-button" onClick={() => openComposer("interview")}>
                      <Upload size={16} />
                      <span>导入面试复盘</span>
                    </button>
                  </div>
                </div>

                <div className="paginated-pane-body">
                  <div className="interview-card-grid paginated-pane-content">
                    {filteredInterviewSessions.length === 0 ? (
                      <EmptyState title="没有匹配的面试" detail="清空搜索，或导入一场新的面试复盘。" className="filtered-empty-state" />
                    ) : visibleInterviewSessions.map((session) => {
                      const weakCount = session.qaPairs.filter((pair) => pair.weak).length;
                      return (
                        <button key={session.id} className="interview-session-card" onClick={() => openInterviewSession(session.id)}>
                          <div className="interview-card-topline">
                            <span>{session.date}</span>
                            <strong>{weakCount ? `${weakCount} 题待整理` : "已整理"}</strong>
                          </div>
                          <h3>{session.company}</h3>
                          <p>{session.role} · {session.round}</p>
                          <div className="interview-card-stats">
                            <span>{session.qaPairs.length} 个问题</span>
                            <span>{session.sourceFiles?.length ?? 0} 份材料</span>
                            <ChevronRight size={16} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <ListPager
                  className="paginated-pane-footer"
                  label="面试复盘列表"
                  page={safeInterviewPage}
                  pageCount={interviewPageCount}
                  onPageChange={setInterviewPage}
                />
              </div>
            ) : (
              <div className="surface review-editor interview-detail-pane">
                <div className="interview-detail-nav interview-detail-nav-start">
                  <button
                    className="ghost-button compact-button"
                    onClick={() => (interviewView === "question" ? setInterviewView("session") : setInterviewView("list"))}
                  >
                    <ChevronLeft size={14} />
                    <span>{interviewView === "question" ? "问题目录" : "全部面试"}</span>
                  </button>
                </div>

                {interviewView === "session" ? (
                  <>
                    <SectionTitle label={`${selectedInterview.date} / ${selectedInterview.round}`} title={`${selectedInterview.company} · ${selectedInterview.role}`} action={`${selectedInterview.qaPairs.length} 个问题`} />

                    <div className="draft-edit-grid interview-session-edit">
                      <label>
                        <span>公司</span>
                        <input value={selectedInterview.company} onChange={(event) => updateSelectedInterview({ company: event.target.value })} />
                      </label>
                      <label>
                        <span>岗位</span>
                        <input value={selectedInterview.role} onChange={(event) => updateSelectedInterview({ role: event.target.value })} />
                      </label>
                      <label>
                        <span>轮次</span>
                        <input value={selectedInterview.round} onChange={(event) => updateSelectedInterview({ round: event.target.value })} />
                      </label>
                      <label>
                        <span>日期</span>
                        <input value={selectedInterview.date} onChange={(event) => updateSelectedInterview({ date: event.target.value })} />
                      </label>
                      <label>
                        <span>复盘优先级</span>
                        <select
                          value={selectedInterview.reviewPriority ?? "P1"}
                          onChange={(event) => updateSelectedInterview({ reviewPriority: event.target.value as OpportunityAction })}
                        >
                          {reviewPriorityOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>关联岗位</span>
                        <OpportunityCombobox
                          opportunities={opportunities}
                          value={selectedInterview.opportunityId ?? ""}
                          onChange={(value) => updateSelectedInterview({ opportunityId: value || undefined })}
                          emptyLabel="未关联岗位"
                        />
                      </label>
                      <label className="wide-field">
                        <span>备注</span>
                        <textarea
                          value={selectedInterview.note ?? ""}
                          onChange={(event) => updateSelectedInterview({ note: event.target.value })}
                          placeholder="记录这场面试的背景、特殊要求或后续关注点。"
                        />
                      </label>
                    </div>

                    <div className="source-panel compact-source">
                      <SectionTitle label="面试材料" title="这场面试的录音或文字稿" action={`${selectedInterview.sourceFiles?.length ?? 0} 份`} />
                      <div className="button-row source-panel-actions">
                        <button className="secondary-button compact-button" disabled={interviewReparseBusy} onClick={requestReparseSelectedInterview}>
                          <RotateCcw size={14} />
                          <span>{interviewReparseBusy ? "整理中..." : "重新整理问题"}</span>
                        </button>
                      </div>
                      {interviewReparseNotice ? <p className="parse-inline-notice">{interviewReparseNotice}</p> : null}
                      <div className="source-list">
                        {(selectedInterview.sourceFiles ?? []).map((file) => {
                          const Icon = file.kind === "audio" ? FileAudio : FileText;
                          const canPreview = Boolean(file.content || file.storageUri);
                          return (
                            <button
                              className="source-item source-button file-source"
                              key={file.id}
                              disabled={!canPreview}
                              onClick={() => (file.content ? setPreviewSessionFile(file) : openStoredFile(file.storageUri))}
                            >
                              <Icon size={18} />
                              <div>
                                <span>{file.kind === "audio" ? "原录音" : "文字稿"}</span>
                                <strong>{file.fileName}</strong>
                                <small>
                                  {file.detail}
                                  {file.duration ? ` / ${file.duration}` : ""}
                                  {file.content ? " / 可预览文字" : file.storageUri ? " / 已存储，可打开" : " / 未存储原文件"}
                                </small>
                              </div>
                              <em>{file.uploadedAt}</em>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="interview-toolbar">
                      <span>问题目录</span>
                      <div className="mini-actions">
                        <button className="secondary-button compact-button" onClick={addQaPair}>
                          <Plus size={14} />
                          <span>添加问题</span>
                        </button>
                      </div>
                    </div>

                    <div className="qa-list qa-directory-list">
                      {selectedInterview.qaPairs.map((pair) => (
                        <button className={`qa-card qa-card-button ${pair.weak ? "weak" : ""} ${pair.id === selectedQa.id ? "selected-qa" : ""}`} key={pair.id} onClick={() => openInterviewQuestion(pair.id)}>
                          <div>
                            <span className="type-pill">{pair.type}</span>
                            <h3>{pair.question}</h3>
                            <p>{pair.critique}</p>
                          </div>
                          <div className="score">{pair.score}/5</div>
                        </button>
                      ))}
                    </div>

                    <div className="danger-zone">
                      <span>危险操作</span>
                      <button
                        className="destructive-button compact-button"
                        onClick={() =>
                          requestConfirm({
                            title: "删除这场面试？",
                            description: `「${selectedInterview.company} / ${selectedInterview.round}」及其中所有问题会一并删除，且无法恢复。`,
                            confirmLabel: "删除面试",
                            onConfirm: deleteSelectedInterview,
                          })
                        }
                      >
                        删除整场面试
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <SectionTitle label={`${selectedInterview.company} / ${selectedInterview.round}`} title={selectedQa.question} action={selectedQa.weak ? "需练习" : "可复用"} />
                    <div className="interview-question-context">
                      <span>{selectedInterview.role}</span>
                      <span>{selectedInterview.date}</span>
                      <span>{selectedQa.type}</span>
                      <strong>{selectedQa.score}/5</strong>
                    </div>

                    <ReviewBlock label="面试问题" value={selectedQa.question} onChange={(value) => updateSelectedQa("question", value)} />
                    <ReviewBlock
                      label="我的原回答"
                      value={selectedQa.originalAnswer}
                      onChange={(value) => updateSelectedQa("originalAnswer", value)}
                    />
                    <ReviewBlock
                      label="复盘建议"
                      value={selectedQa.critique}
                      onChange={(value) => updateSelectedQa("critique", value)}
                    />
                    <ReviewBlock
                      label="推荐回答框架"
                      value={selectedQa.framework}
                      onChange={(value) => updateSelectedQa("framework", value)}
                    />
                    <ReviewBlock
                      label="具体优化回答"
                      value={selectedQa.optimizedAnswer}
                      onChange={(value) => updateSelectedQa("optimizedAnswer", value)}
                    />

                    <div className="button-row">
                      <button className="primary-button" onClick={createAnswerCard}>
                        <BookOpenCheck size={16} />
                        <span>生成答案卡</span>
                      </button>
                      <button
                        className="secondary-button"
                        onClick={addSelectedQaToPractice}
                      >
                        <ClipboardList size={16} />
                        <span>加入练习</span>
                      </button>
                      <button className="secondary-button" onClick={() => updateSelectedQaWeak(!selectedQa.weak)}>
                        <Check size={16} />
                        <span>{selectedQa.weak ? "标记已处理" : "重新标为薄弱"}</span>
                      </button>
                    </div>

                    <div className="danger-zone">
                      <span>危险操作</span>
                      <button
                        className="destructive-button compact-button"
                        onClick={() =>
                          requestConfirm({
                            title: "删除这个问题？",
                            description: `「${selectedQa.question}」及其回答、评价会一并删除，且无法恢复。`,
                            confirmLabel: "删除问题",
                            onConfirm: deleteSelectedQa,
                          })
                        }
                      >
                        删除当前问题
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {page === "answers" && (
          <section className={`answer-workspace ${answerCategorySidebarCollapsed ? "answer-workspace-collapsed" : ""}`}>
            {!answerCategorySidebarCollapsed ? (
              <div className="surface answer-category-pane">
                <div className="answer-category-header">
                  <SectionTitle label="分类" title="答案文件夹" action={`${answerCategories.length} 个`} />
                  <button className="answer-category-icon-action" onClick={() => setAnswerCategorySidebarCollapsed(true)} aria-label="收起分类侧栏">
                    <PanelRight size={15} />
                  </button>
                </div>
                <div className="answer-category-tree">
                  <div className={`answer-category-row answer-category-all-row ${isAllAnswerCategorySelected ? "active" : ""}`}>
                    <span className="answer-category-toggle" />
                    <button
                      className="answer-category-main"
                      aria-current={isAllAnswerCategorySelected ? "true" : undefined}
                      onClick={() => {
                        setSelectedAnswerCategoryId(allAnswerCategoryId);
                        setOpenAnswerCategoryMenuId("");
                        setAnswerPage(0);
                        setAnswerView("list");
                      }}
                    >
                      <Library size={16} />
                      <span>全部答案</span>
                      <strong>{answerCards.length}</strong>
                    </button>
                    <div className="answer-category-actions">
                      <button className="answer-category-icon-action" onClick={() => openCreateAnswerCategoryEditor()} aria-label="新增顶层分类">
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                  {renderAnswerCategoryEditor(answerCategoryEditor?.mode === "create" && answerCategoryEditor.parentId === "", 0)}
                  {rootAnswerCategories.map((category) => renderAnswerCategoryTree(category))}
                </div>
              </div>
            ) : null}
            {answerView === "list" ? (
              <div className="surface answer-list-pane answer-home-pane paginated-pane">
                <div className="paginated-pane-header">
                  {answerCategorySidebarCollapsed ? (
                    <button className="secondary-button compact-button answer-category-reopen" onClick={() => setAnswerCategorySidebarCollapsed(false)}>
                      <PanelRight size={14} />
                      <span>显示分类</span>
                    </button>
                  ) : null}
                  <PageIntro
                    label={selectedAnswerCategoryLabel}
                    title="沉淀可复用回答"
                    detail="答案卡可以手动添加，也可以从面试复盘生成；可随机抽练，或加入本周计划形成练习行动。"
                    action={`${filteredAnswerCards.length}/${selectedAnswerCategoryTotal} 张卡片`}
                  />
                  <div className="button-row tight-row">
                    <button className="primary-button" onClick={() => openComposer("answer")}>
                      <Plus size={16} />
                      <span>新增答案卡</span>
                    </button>
                    <button className="secondary-button answer-random-button" onClick={startRandomAnswerPractice} disabled={randomPracticeSpinning || filteredAnswerCards.length === 0}>
                      <Sparkles size={16} />
                      <span>{randomPracticeSpinning ? "抽取中..." : "随机抽练"}</span>
                    </button>
                    <button className="secondary-button" onClick={() => goTo("interviews")}>
                      <FileAudio size={16} />
                      <span>从复盘生成</span>
                    </button>
                  </div>
                </div>
                <div className="paginated-pane-body">
                  {(randomPracticeCard || randomPracticeSpinning) && (
                    <div className={`answer-practice-panel ${randomPracticeSpinning ? "is-shuffling" : ""}`}>
                      <div className="answer-practice-deck" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className="answer-practice-copy">
                        <span className="eyebrow">临时练习</span>
                        <h3>{randomPracticeSpinning ? "正在洗牌抽题..." : randomPracticeCard?.question}</h3>
                        <p>
                          {randomPracticeSpinning
                            ? "从当前答案库里随机挑一张，不会加入本周计划。"
                            : randomPracticeCard?.framework}
                        </p>
                      </div>
                      {!randomPracticeSpinning && randomPracticeCard ? (
                        <div className="answer-practice-actions">
                          <button className="primary-button compact-button" onClick={() => setRandomPracticeReveal((visible) => !visible)}>
                            {randomPracticeReveal ? "收起答案" : "显示推荐回答"}
                          </button>
                          <button className="secondary-button compact-button" onClick={startRandomAnswerPractice}>
                            换一张
                          </button>
                          <button className="ghost-button compact-button" onClick={() => openAnswerCard(randomPracticeCard.id)}>
                            打开卡片
                          </button>
                        </div>
                      ) : null}
                      {!randomPracticeSpinning && randomPracticeCard && randomPracticeReveal ? (
                        <div className="answer-practice-answer">
                          {randomPracticeCard.answer}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div className="answer-list paginated-pane-content">
                    {filteredAnswerCards.length === 0 ? (
                      <p className="empty-list-note">没有匹配的答案卡，试试换个关键词。</p>
                    ) : (
                      visibleAnswerCards.map((card) => (
                        <button
                          className={`answer-card answer-card-button ${selectedAnswer.id === card.id ? "selected-answer" : ""} ${draggedAnswerCardId === card.id ? "is-dragging" : ""}`}
                          key={card.id}
                          draggable
                          title="拖到左侧分类可移动"
                          aria-label={`打开答案卡：${card.question}。可拖到左侧分类移动。`}
                          onDragStart={(event) => handleAnswerCardDragStart(event, card)}
                          onDragEnd={clearAnswerCardDragState}
                          onClick={() => openAnswerCard(card.id)}
                        >
                          <div>
                            <span className="type-pill">{card.type}</span>
                            <h3>{card.question}</h3>
                          </div>
                          <small>{card.status === "DRAFT" ? "草稿" : "可复用"} / {card.practiceStatus}</small>
                          <span className="answer-card-category">{answerCategoryById.get(resolveAnswerCategoryId(card))?.name ?? "尚未归类"}</span>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <ListPager
                  className="paginated-pane-footer"
                  label="答案卡列表"
                  page={safeAnswerPage}
                  pageCount={answerPageCount}
                  onPageChange={setAnswerPage}
                />
              </div>
            ) : (
              <div className="surface answer-editor answer-detail-pane">
                <div className="interview-detail-nav interview-detail-nav-start">
                  {answerCategorySidebarCollapsed ? (
                    <button className="secondary-button compact-button answer-category-reopen" onClick={() => setAnswerCategorySidebarCollapsed(false)}>
                      <PanelRight size={14} />
                      <span>显示分类</span>
                    </button>
                  ) : null}
                  <button className="ghost-button compact-button" onClick={() => setAnswerView("list")}>
                    <ChevronLeft size={14} />
                    <span>返回{selectedAnswerCategoryLabel}</span>
                  </button>
                </div>
                <SectionTitle
                  label={`${selectedAnswer.source} / ${answerCategoryById.get(resolveAnswerCategoryId(selectedAnswer))?.name ?? "尚未归类"}`}
                  title={selectedAnswer.question}
                  action={selectedAnswer.status === "DRAFT" ? "草稿" : "可复用"}
                />
                <ReviewBlock label="问题" value={selectedAnswer.question} onChange={(value) => updateSelectedAnswer("question", value)} />
                <ReviewBlock label="回答框架" value={selectedAnswer.framework} onChange={(value) => updateSelectedAnswer("framework", value)} />
                <ReviewBlock label="推荐回答" value={selectedAnswer.answer} onChange={(value) => updateSelectedAnswer("answer", value)} />
                <ReviewBlock label="适用岗位" value={selectedAnswer.relatedRoles} onChange={(value) => updateSelectedAnswer("relatedRoles", value)} />
                <div className="inline-controls">
                  <label>
                    <span>卡片状态</span>
                    <select value={selectedAnswer.status} onChange={(event) => updateSelectedAnswer("status", event.target.value)}>
                      <option value="DRAFT">草稿</option>
                      <option value="ACTIVE">可复用</option>
                    </select>
                  </label>
                  <label>
                    <span>练习状态</span>
                    <select value={selectedAnswer.practiceStatus} onChange={(event) => updateSelectedAnswer("practiceStatus", event.target.value)}>
                      <option value="薄弱">薄弱</option>
                      <option value="中等">中等</option>
                      <option value="熟练">熟练</option>
                    </select>
                  </label>
                  <label>
                    <span>移动到</span>
                    <select value={resolveAnswerCategoryId(selectedAnswer)} onChange={(event) => updateSelectedAnswer("categoryId", event.target.value)}>
                      {answerCategoryOptions.map(({ category, label }) => (
                        <option key={category.id} value={category.id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={addSelectedAnswerToPractice}>
                    <ClipboardList size={16} />
                    <span>加入本周计划</span>
                  </button>
                </div>

                <div className="danger-zone">
                  <span>危险操作</span>
                  <button
                    className="destructive-button"
                    onClick={() =>
                      requestConfirm({
                        title: "删除这张答案卡？",
                        description: `「${selectedAnswer.question}」删除后无法恢复。`,
                        confirmLabel: "删除卡片",
                        onConfirm: deleteSelectedAnswer,
                      })
                    }
                  >
                    删除当前卡
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {page === "resumes" && (
          <section className="resume-workspace">
            <div className="surface resume-list-pane">
              <PageIntro
                label="简历版本"
                title="简历档案库"
                detail="保存不同投递版本，记录每版简历适合的方向和实际使用岗位。"
                action={`${resumeList.length} 份简历`}
              />
              <div className="button-row tight-row">
                <button className="primary-button" onClick={addResumeVersion}>
                  <Upload size={16} />
                  <span>上传简历版本</span>
                </button>
                <button className="secondary-button" onClick={() => goTo("opportunities")}>
                  <BriefcaseBusiness size={16} />
                  <span>查看投递使用</span>
                </button>
              </div>
              <div className="resume-list">
                {resumeList.map((resume) => (
                  <button
                    className={`resume-row resume-button ${selectedResume.id === resume.id ? "selected-resume" : ""}`}
                    key={resume.id}
                    onClick={() => {
                      setSelectedResumeId(resume.id);
                      setResumeLinkedOpportunityPage(0);
                    }}
                  >
                    <FileText size={18} />
                    <span>
                      <strong>{resume.name}</strong>
                      <small>{resume.fileName}</small>
                    </span>
                    <span>{resume.roles}</span>
                    <b>{resume.fileType}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className="surface resume-detail-pane">
              <div className="resume-dossier-head">
                <div className="resume-file-badge">
                  <FileText size={24} />
                </div>
                <div>
                  <span className="eyebrow">{selectedResume.fileType} · {selectedResume.fileSize}</span>
                  <h2>{selectedResume.name}</h2>
                  <p>{selectedResume.fileName} · 上传于 {selectedResume.uploadedAt}</p>
                </div>
                <button className="secondary-button compact-button" onClick={() => openStoredFile(selectedResume.storageUri)}>预览文件</button>
              </div>
              <div className="resume-compact-fields">
                <ReviewBlock compact label="版本名称" value={selectedResume.name} onChange={(value) => updateSelectedResume("name", value)} />
                <ReviewBlock compact label="适合方向" value={selectedResume.roles} onChange={(value) => updateSelectedResume("roles", value)} />
              </div>
              <ReviewBlock label="核心卖点" value={selectedResume.points} onChange={(value) => updateSelectedResume("points", value)} />
              <ReviewBlock label="文件摘要" value={selectedResume.summary} onChange={(value) => updateSelectedResume("summary", value)} />
              <div className="linked-list">
                <span>已关联岗位</span>
                {linkedResumeOpportunities.length === 0 ? (
                  <small>暂未用于投递。使用关系会从岗位详情产生。</small>
                ) : (
                  <>
                    {visibleLinkedResumeOpportunities.map((opportunity) => {
                      return (
                        <button key={opportunity.id} onClick={() => openOpportunity(opportunity.id)}>
                          <strong>{opportunity.title}</strong>
                          <small>{opportunity.company}</small>
                        </button>
                      );
                    })}
                    <ListPager
                      alwaysShow={linkedResumeOpportunityList.pageCount > 1}
                      label="简历关联岗位"
                      page={linkedResumeOpportunityList.safePage}
                      pageCount={linkedResumeOpportunityList.pageCount}
                      onPageChange={setResumeLinkedOpportunityPage}
                    />
                  </>
                )}
              </div>
              <div className="danger-zone">
                <span>危险操作</span>
                <button
                  className="destructive-button"
                  onClick={() =>
                    requestConfirm({
                      title: "删除这个简历版本？",
                      description: `「${selectedResume.name}」删除后无法恢复；已关联此版本的岗位需要重新选择简历。`,
                      confirmLabel: "删除简历版本",
                      onConfirm: deleteSelectedResume,
                    })
                  }
                >
                  删除当前简历版本
                </button>
              </div>
            </div>
          </section>
        )}

        {page === "weekly" && (
          <section className="weekly-workspace">
            <div className="surface weekly-board paginated-pane">
              <div className="paginated-pane-header">
                <PageIntro
                  label="本周计划"
                  title="安排本周要练的事"
                  detail="本周计划可包含面试表达练习、笔试准备、作品集整理和材料补充等，拆成本周可以完成的小任务。"
                  action={`${visibleTrainingTaskCount} 待完成`}
                />
                <div className="weekly-overview">
                  <div className="weekly-progress-card">
                    <span>本周投递</span>
                    <strong>{submittedApplications}/{weeklyTargetApplications}</strong>
                    <SegmentedProgress value={weeklyTargetApplications > 0 ? (submittedApplications / weeklyTargetApplications) * 100 : 0} segments={12} />
                  </div>
                  <label className="weekly-goal-card">
                    <span>目标</span>
                    <input
                      type="number"
                      min="0"
                      value={weeklyTargetDraft}
                      onBlur={restoreWeeklyTargetDraft}
                      onChange={(event) => updateWeeklyTargetDraft(event.target.value)}
                    />
                    <small>本周想投递多少个岗位</small>
                  </label>
                </div>
              </div>

              <div className="paginated-pane-body">
                <div className="weekly-group-list weekly-groups-page">
                  {weeklyTaskGroups.map((group) => {
                    if (group.id === "interview" && !group.tasks.length) return null;

                    const page = group.id === "interview" ? weeklyInterviewPage : weeklyPracticePage;
                    const setPage = group.id === "interview" ? setWeeklyInterviewPage : setWeeklyPracticePage;
                    const taskList = paginateWeeklyGroupTasks(group.tasks, page, group.id);
                    const visibleTasks = taskList.visible;
                    const showAddCard = group.id === "practice" && taskList.safePage === 0;

                    return (
                      <section className="weekly-task-group" key={group.id}>
                        <div className="weekly-group-header">
                          <div>
                            <h3>{group.title}</h3>
                            <p>{group.detail}</p>
                          </div>
                          <span>{group.tasks.length} 项</span>
                        </div>
                        <div className="weekly-examples">
                          {group.examples.map((example) => (
                            <small key={example}>{example}</small>
                          ))}
                        </div>
                        <div className="weekly-task-list">
                          {showAddCard ? (
                            <button className="weekly-add-card" onClick={openWeeklyTaskDialog}>
                              <Plus size={18} />
                              <strong>添加动作</strong>
                              <span>新增一张自主训练卡片</span>
                            </button>
                          ) : null}
                          {group.id === "practice" && group.tasks.length === 0 ? (
                            <p className="empty-list-note weekly-empty-note">还没有自主训练动作，可以先添加笔试、作品集或项目表达练习。</p>
                          ) : null}
                          {visibleTasks.map((task) => (
                            <article className={`weekly-task ${task.status === "done" ? "is-done" : ""}`} key={task.id}>
                              <div className="weekly-task-header">
                                <span>{task.status === "done" ? "已完成" : task.level ?? "P2"}</span>
                                <small>{task.sourceLabel}</small>
                              </div>
                              <h3>{task.title}</h3>
                              <p>{task.detail}</p>
                              <div className="weekly-task-actions">
                                <button
                                  className="weekly-card-action is-primary"
                                  onClick={() => updateWeeklyTask(task.id, "status", task.status === "done" ? "open" : "done")}
                                >
                                  {task.status === "done" ? "重新打开" : "标记已完成"}
                                </button>
                                <button
                                  className="weekly-card-action is-danger"
                                  onClick={() =>
                                    requestConfirm({
                                      title: "删除这条动作？",
                                      description: `「${task.title}」删除后不再出现在本周计划里。`,
                                      confirmLabel: "删除",
                                      onConfirm: () => deleteWeeklyTask(task.id),
                                    })
                                  }
                                >
                                  删除
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                        <ListPager
                          className="weekly-section-pager"
                          label={`${group.title}任务`}
                          page={taskList.safePage}
                          pageCount={taskList.pageCount}
                          onPageChange={setPage}
                        />
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {page === "exports" && (
          <section className="surface">
            <PageIntro
              label="设置与备份"
              title="管理数据和智能整理"
              detail="在这里备份数据、导出复习材料，也可以选择是否开启智能整理能力。"
              action={isPublicDemo ? "演示模式" : isApiEnabled ? "本地保存" : "浏览器保存"}
            />
            <div className="settings-grid">
              <ExportAction icon={Archive} title="备份全部数据" detail="保存岗位、面试、答案和简历记录。" onClick={exportBackup} />
              <ExportAction icon={Upload} title="恢复备份" detail="从之前导出的备份文件恢复数据。" onClick={importBackupFromFile} />
              <ExportAction icon={FileDown} title="导出答案卡" detail="下载一份方便复习的材料。" onClick={exportAnswerCards} />
              <ExportAction icon={PanelRight} title="导出面试复盘" detail="下载问题、复盘建议和优化回答。" onClick={exportInterviewReviews} />
            </div>
            <div className="settings-panel">
              <SectionTitle label="智能整理" title="让系统帮你读材料" action={aiSettings.provider === "none" ? "未开启" : "已配置"} />
              <p>
                默认可以直接读取文字文件。需要识别截图、转写录音或整理长文本时，可以在这里接入你自己的模型服务。
              </p>
              <div className="draft-edit-grid">
                <label>
                  <span>服务商</span>
                  <select value={aiSettings.provider} onChange={(event) => updateAiSettings({ provider: event.target.value as AiSettings["provider"] })}>
                    <option value="none">暂不启用</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="custom">自定义兼容接口</option>
                  </select>
                </label>
                <label>
                  <span>模型</span>
                  <input value={aiSettings.model} onChange={(event) => updateAiSettings({ model: event.target.value })} placeholder="填写你常用的模型名称" />
                </label>
                <label>
                  <span>文字材料整理</span>
                  <select value={aiSettings.parseMode} onChange={(event) => updateAiSettings({ parseMode: event.target.value as AiSettings["parseMode"] })}>
                    <option value="mock">基础整理</option>
                    <option value="assist">智能整理</option>
                  </select>
                </label>
                <label>
                  <span>录音转文字</span>
                  <select value={aiSettings.transcriptionMode} onChange={(event) => updateAiSettings({ transcriptionMode: event.target.value as AiSettings["transcriptionMode"] })}>
                    <option value="mock">暂不启用</option>
                    <option value="assist">启用转写</option>
                  </select>
                </label>
                <label className="wide-field">
                  <span>访问密钥（只保存在本机）</span>
                  <input
                    type="password"
                    value={aiSettings.apiKey}
                    onChange={(event) => updateAiSettings({ apiKey: event.target.value })}
                    placeholder="可选，只有开启智能整理时需要"
                  />
                </label>
                <label className="wide-field">
                  <span>服务地址（可选）</span>
                  <input value={aiSettings.endpoint} onChange={(event) => updateAiSettings({ endpoint: event.target.value })} placeholder="使用自定义服务时填写" />
                </label>
                <label className="wide-field">
                  <span>备注</span>
                  <textarea value={aiSettings.notes} onChange={(event) => updateAiSettings({ notes: event.target.value })} placeholder="例如：用于整理面试文字稿或识别截图。" />
                </label>
              </div>
              <div className="button-row">
                <button className="primary-button" onClick={() => setSystemMessage("设置已保存")}>
                  <Settings size={16} />
                  <span>保存设置</span>
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setAiSettings(defaultAiSettings);
                    setSystemMessage("设置已重置");
                  }}
                >
                  重置设置
                </button>
              </div>
            </div>
          </section>
        )}

        {composer && (
          <div
            className="asset-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-dialog-title"
            onMouseDown={markModalBackdropPointerStart}
            onClick={(event) => closeModalFromBackdropClick(event, () => setComposer(null))}
          >
            <div className="asset-preview-panel module-composer-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setComposer(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <SectionTitle
                titleId="composer-dialog-title"
                label={composerStep === "source" ? "步骤 1 / 2" : "步骤 2 / 2"}
                title={
                  composer === "opportunity"
                    ? "新增岗位"
                    : composer === "interview"
                      ? "新增面试复盘"
                      : composer === "resume"
                        ? "上传简历版本"
                        : "新增答案卡"
                }
                action={composerStep === "source" ? "选择材料" : "确认内容"}
              />
              <p>
                {composerStep === "source"
                  ? composer === "interview"
                    ? "选择你现在手里的材料：已经整理好的复盘文档可以直接导入；只有原始转写稿时，可以让系统帮你整理。"
                    : composer === "opportunity"
                      ? "上传 JD 文件，粘贴招聘链接，或直接粘贴文字至岗位描述。"
                      : "上传文件，或直接粘贴文字内容。系统会尽量帮你提取关键信息。"
                  : composer === "opportunity"
                    ? "确认公司、岗位和下一步动作，可补充其他信息。"
                    : "请检查整理结果，补齐必要信息后保存。"}
              </p>

              <div className="composer-steps">
                <span className={composerStep === "source" ? "active-step" : ""}>01 选择材料</span>
                <span className={composerStep === "review" ? "active-step" : ""}>02 确认内容</span>
              </div>

              {composerStep === "source" && composer !== "answer" && (
                <div className="composer-source-grid">
                  {composer === "interview" && (
                    <div className="interview-import-mode wide-field">
                      <button
                        className={interviewInputMode === "review-json" ? "active-import-mode" : ""}
                        aria-pressed={interviewInputMode === "review-json"}
                        onClick={() => {
                          setInterviewInputMode("review-json");
                          setComposerSource((source) => ({ ...source, sourceKind: "transcript", fileName: "", storageUri: undefined, extractionStatus: undefined }));
                          setComposerParseNotice("");
                        }}
                      >
                        <strong>我已经整理好了</strong>
                        <span>粘贴或上传复盘文档，直接生成面试复盘</span>
                      </button>
                      <button
                        className={interviewInputMode === "raw-transcript" ? "active-import-mode" : ""}
                        aria-pressed={interviewInputMode === "raw-transcript"}
                        onClick={() => {
                          setInterviewInputMode("raw-transcript");
                          setComposerSource((source) => ({ ...source, sourceKind: "transcript", extractionStatus: undefined }));
                          setComposerParseNotice("");
                        }}
                      >
                        <strong>帮我整理文字稿</strong>
                        <span>粘贴原始转写稿，让系统先整理问题</span>
                      </button>
                    </div>
                  )}

                  <label className="upload-dropzone">
                    <Upload size={22} />
                    <strong>
                      {composerSource.fileName ||
                        (composer === "interview" && interviewInputMode === "review-json"
                          ? "上传复盘文档"
                          : "选择文件")}
                    </strong>
                    <small>
                      {composer === "opportunity"
                        ? "支持截图、PDF、.txt、.md。"
                        : composer === "interview"
                          ? interviewInputMode === "review-json"
                            ? "支持 .json，或包含同样 JSON 结构的 .txt / .md。"
                            : "支持录音、.txt、.md、.docx。"
                          : "支持图片、PDF、.txt、.md、.docx。"}
                    </small>
                    <small>{uploadStatusLabel(composerSource)}</small>
                    {composerSource.extractionStatus && <small>{extractionStatusLabel(composerSource.extractionStatus)}</small>}
                    <input
                      type="file"
                      accept={
                        composer === "opportunity"
                          ? "image/*,.pdf,.txt,.md"
                          : composer === "interview"
                            ? interviewInputMode === "review-json"
                              ? ".json,.txt,.md"
                              : "audio/*,.txt,.md,.docx"
                            : "image/*,.pdf,.txt,.md,.docx"
                      }
                      onChange={(event) => handleComposerFileSelected(event.target.files)}
                    />
                  </label>

                  {composer !== "interview" && (
                    <div className="source-side">
                      <label>
                        <span>材料类型</span>
                        <select value={composerSource.sourceKind} onChange={(event) => updateComposerSource("sourceKind", event.target.value)}>
                          {composer === "opportunity" && (
                            <>
                              <option value="jd-text">岗位描述 / 文件</option>
                              <option value="screenshot">岗位截图</option>
                              <option value="job-link">招聘链接</option>
                            </>
                          )}
                          {composer === "resume" && <option value="resume-file">简历文件</option>}
                        </select>
                      </label>
                      {composer === "opportunity" && composerSource.sourceKind === "job-link" ? (
                        <label>
                          <span>招聘链接</span>
                          <input
                            value={composerSource.note}
                            onChange={(event) => updateComposerSource("note", event.target.value)}
                            placeholder="https://jobs.example.com/..."
                          />
                        </label>
                      ) : (
                        <label>
                          <span>{composer === "opportunity" ? "招聘链接" : "备注说明"}</span>
                          <input
                            value={composerSource.note}
                            onChange={(event) => updateComposerSource("note", event.target.value)}
                            placeholder="https://jobs.example.com/..."
                          />
                        </label>
                      )}
                    </div>
                  )}

                  <label className="wide-field source-text-input">
                    <span>
                      {composer === "opportunity"
                        ? "岗位描述"
                        : composer === "interview"
                          ? interviewInputMode === "review-json"
                            ? "整理好的复盘内容"
                            : "原始录音转写稿"
                          : "简历文字或补充说明"}
                    </span>
                    <textarea
                      value={composerSource.rawText}
                      onChange={(event) => updateComposerSource("rawText", event.target.value)}
                      placeholder={
                        composer === "opportunity"
                          ? "粘贴岗位描述后，可以继续确认岗位信息。"
                          : composer === "interview"
                            ? interviewInputMode === "review-json"
                              ? "把外部工具整理好的复盘粘贴到这里。内容应包含原问题、原回答、评价、优化框架、优化回答。"
                              : "把未整理的面试转写稿粘贴到这里。"
                            : "粘贴简历摘要或正文后，可以继续确认简历信息。"
                      }
                    />
                  </label>
                  {composer === "interview" && interviewInputMode === "review-json" && (
                    <div className="wide-field interview-json-guide">
                      <div>
                        <strong>还没有整理？可以先复制整理模板</strong>
                        <span>把面试文字稿贴到常用 AI 工具里整理，再把结果粘回上面的输入框。</span>
                      </div>
                      <textarea readOnly value={interviewReviewJsonPrompt} />
                      <button
                        className="secondary-button compact-button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(interviewReviewJsonPrompt);
                          setSystemMessage("整理模板已复制");
                        }}
                      >
                        复制整理模板
                      </button>
                    </div>
                  )}
                </div>
              )}

              {composerStep === "review" && (
              <div className="draft-edit-grid composer-grid">
                {composer === "opportunity" && (
                  <>
                    <label>
                      <span>公司 *</span>
                      <input value={composerDraft.company} onChange={(event) => updateComposerDraft("company", event.target.value)} />
                    </label>
                    <label>
                      <span>岗位名称 *</span>
                      <input value={composerDraft.title} onChange={(event) => updateComposerDraft("title", event.target.value)} />
                    </label>
                    <label>
                      <span>城市</span>
                      <input value={composerDraft.city} onChange={(event) => updateComposerDraft("city", event.target.value)} />
                    </label>
                    <label>
                      <span>下一步动作</span>
                      <input value={composerDraft.nextAction} onChange={(event) => updateComposerDraft("nextAction", event.target.value)} />
                    </label>
                    <div className="date-field">
                      <label htmlFor="composer-opportunity-due-date">截止日期</label>
                      <DatePickerInput
                        id="composer-opportunity-due-date"
                        value={composerDraft.dueDate}
                        label="截止日期"
                        onChange={(value) => updateComposerDraft("dueDate", value)}
                      />
                    </div>
                    <label>
                      <span>主观优先级</span>
                      <select value={composerDraft.priority} onChange={(event) => updateComposerDraft("priority", event.target.value as OpportunityPriority)}>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                      </select>
                    </label>
                    <label>
                      <span>匹配度</span>
                      <select value={composerDraft.match} onChange={(event) => updateComposerDraft("match", event.target.value as OpportunityMatch)}>
                        <option value="HIGH">HIGH</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="LOW">LOW</option>
                      </select>
                    </label>
                    <label>
                      <span className="field-label-row">
                        <span>今日优先级</span>
                        <span
                          className="field-tooltip"
                          tabIndex={0}
                          data-tooltip="默认会根据状态、截止日、匹配度和主观优先级自动计算；也可以手动选择 P0-P3。"
                          aria-label="今日优先级说明"
                        >
                          ?
                        </span>
                      </span>
                      <select
                        value={composerDraft.actionManual ? composerDraft.action : "AUTO"}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "AUTO") {
                            updateComposerDraft("actionManual", false);
                            updateComposerDraft(
                              "action",
                              computeOpportunityAction({
                                status: "TO APPLY",
                                deadline: composerDraft.deadline,
                                dueDate: composerDraft.dueDate,
                                match: composerDraft.match,
                                priority: composerDraft.priority,
                              }),
                            );
                            return;
                          }
                          updateComposerDraft("actionManual", true);
                          updateComposerDraft("action", value as OpportunityAction);
                        }}
                      >
                        <option value="AUTO">
                          自动（建议 {computeOpportunityAction({ status: "TO APPLY", deadline: composerDraft.deadline, dueDate: composerDraft.dueDate, match: composerDraft.match, priority: composerDraft.priority })}）
                        </option>
                        <option value="P0">P0</option>
                        <option value="P1">P1</option>
                        <option value="P2">P2</option>
                        <option value="P3">P3</option>
                      </select>
                    </label>
                    <label>
                      <span>投递简历</span>
                      <select value={composerDraft.resumeId} onChange={(event) => updateComposerDraft("resumeId", event.target.value)}>
                        {resumeList.map((resume) => (
                          <option value={resume.id} key={resume.id}>{resume.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>来源</span>
                      <input value={composerDraft.sourceLabel} onChange={(event) => updateComposerDraft("sourceLabel", event.target.value)} />
                    </label>
                    <label className="wide-field opportunity-note-field">
                      <span>备注</span>
                      <textarea
                        value={composerDraft.deadline}
                        onChange={(event) => updateComposerDraft("deadline", event.target.value)}
                      />
                    </label>
                    <label className="wide-field">
                      <span>岗位描述 *</span>
                      <textarea value={composerDraft.sourceText} onChange={(event) => updateComposerDraft("sourceText", event.target.value)} />
                    </label>
                  </>
                )}

                {composer === "interview" && (
                  <>
                    <label>
                      <span>公司 *</span>
                      <input value={composerDraft.company} onChange={(event) => updateComposerDraft("company", event.target.value)} />
                    </label>
                    <label>
                      <span>岗位 *</span>
                      <input value={composerDraft.role} onChange={(event) => updateComposerDraft("role", event.target.value)} />
                    </label>
                    <label>
                      <span>轮次 *</span>
                      <input value={composerDraft.round} onChange={(event) => updateComposerDraft("round", event.target.value)} />
                    </label>
                    <label>
                      <span>日期</span>
                      <input value={composerDraft.date} onChange={(event) => updateComposerDraft("date", event.target.value)} />
                    </label>
                    <label>
                      <span>关联岗位</span>
                      <OpportunityCombobox
                        opportunities={opportunities}
                        value={composerDraft.linkedOpportunityId}
                        onChange={(value) => updateComposerDraft("linkedOpportunityId", value)}
                        emptyLabel="暂不关联"
                      />
                    </label>
                    <label>
                      <span>复盘优先级</span>
                      <select
                        value={composerDraft.reviewPriority}
                        onChange={(event) => updateComposerDraft("reviewPriority", event.target.value as OpportunityAction)}
                      >
                        {reviewPriorityOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      <span>备注</span>
                      <textarea
                        value={composerDraft.nextAction}
                        onChange={(event) => updateComposerDraft("nextAction", event.target.value)}
                        placeholder="记录这场面试的背景、特殊要求或后续关注点。"
                      />
                    </label>
                    <label className="wide-field">
                      <span>原文件名</span>
                      <input value={composerDraft.fileName} onChange={(event) => updateComposerDraft("fileName", event.target.value)} placeholder="recording.m4a 或 transcript.txt" />
                    </label>
                    <label className="wide-field">
                      <span>面试文字稿 / 复盘内容</span>
                      <textarea value={composerDraft.sourceText} onChange={(event) => updateComposerDraft("sourceText", event.target.value)} />
                    </label>
                  </>
                )}

                {composer === "resume" && (
                  <>
                    <label>
                      <span>版本名称 *</span>
                      <input value={composerDraft.title} onChange={(event) => updateComposerDraft("title", event.target.value)} />
                    </label>
                    <label>
                      <span>文件名 *</span>
                      <input value={composerDraft.fileName} onChange={(event) => updateComposerDraft("fileName", event.target.value)} placeholder="resume-v1.pdf" />
                    </label>
                    <label className="wide-field">
                      <span>适合方向</span>
                      <input value={composerDraft.roles} onChange={(event) => updateComposerDraft("roles", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>核心卖点</span>
                      <textarea value={composerDraft.points} onChange={(event) => updateComposerDraft("points", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>文件摘要</span>
                      <textarea value={composerDraft.summary} onChange={(event) => updateComposerDraft("summary", event.target.value)} />
                    </label>
                  </>
                )}

                {composer === "answer" && (
                  <>
                    <label className="wide-field">
                      <span>问题 *</span>
                      <input value={composerDraft.question} onChange={(event) => updateComposerDraft("question", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>回答框架</span>
                      <textarea value={composerDraft.framework} onChange={(event) => updateComposerDraft("framework", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>具体回答</span>
                      <textarea value={composerDraft.answer} onChange={(event) => updateComposerDraft("answer", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>适用岗位</span>
                      <input value={composerDraft.relatedRoles} onChange={(event) => updateComposerDraft("relatedRoles", event.target.value)} />
                    </label>
                  </>
                )}
              </div>
              )}

              {composerParseNotice && (
                <div className={`composer-parse-notice ${composerParsing ? "is-loading" : "is-error"}`} role="status">
                  {composerParseNotice}
                </div>
              )}

              <div className="button-row">
                {composerStep === "source" && composer !== "answer" ? (
                  <button className="primary-button" onClick={runComposerParse} disabled={!canRunSourceParse(composerSource) || composerParsing}>
                    <Sparkles size={16} />
                    <span>
                      {composerParsing
                        ? "正在处理..."
                        : canRunSourceParse(composerSource)
                          ? composer === "interview" && interviewInputMode === "review-json"
                            ? "导入复盘"
                            : composer === "interview"
                              ? "开始整理"
                              : "开始整理"
                          : uploadStatusLabel(composerSource)}
                    </span>
                  </button>
                ) : (
                  <button className="primary-button" onClick={submitComposer}>
                    <Check size={16} />
                    <span>创建正式记录</span>
                  </button>
                )}
                {composerStep === "review" && composer !== "answer" && (
                  <button className="secondary-button" onClick={() => setComposerStep("source")}>返回材料</button>
                )}
              </div>
            </div>
          </div>
        )}

        {previewAsset && (
          <div
            className="asset-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-preview-title"
            onMouseDown={markModalBackdropPointerStart}
            onClick={(event) => closeModalFromBackdropClick(event, () => setPreviewAsset(null))}
          >
            <div className="asset-preview-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setPreviewAsset(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <SectionTitle titleId="asset-preview-title" label={sourceKindLabel[previewAsset.kind]} title={previewAsset.title} action={previewAsset.createdAt} />
              <p>{previewAsset.detail}</p>
              <textarea readOnly value={previewAsset.content || "当前原材料只有元信息。若该材料来自文件上传，可以点击下方打开原文件。"} />
              <div className="button-row">
                {previewAsset.storageUri && (
                  <button className="secondary-button" onClick={() => openStoredFile(previewAsset.storageUri)}>打开原文件</button>
                )}
                {previewAsset.kind === "job-link" && previewAsset.content?.startsWith("http") && (
                  <button className="secondary-button" onClick={() => window.open(previewAsset.content, "_blank", "noopener,noreferrer")}>打开链接</button>
                )}
              </div>
            </div>
          </div>
        )}

        {previewSessionFile && (
          <div
            className="asset-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-file-preview-title"
            onMouseDown={markModalBackdropPointerStart}
            onClick={(event) => closeModalFromBackdropClick(event, () => setPreviewSessionFile(null))}
          >
            <div className="asset-preview-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setPreviewSessionFile(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <SectionTitle
                titleId="session-file-preview-title"
                label={previewSessionFile.kind === "audio" ? "原录音" : "文字稿"}
                title={previewSessionFile.fileName}
                action={previewSessionFile.uploadedAt}
              />
              <p>{previewSessionFile.detail}{previewSessionFile.duration ? ` / ${previewSessionFile.duration}` : ""}</p>
              <textarea readOnly value={previewSessionFile.content || "当前材料只有文件元信息；如果原文件已存储，可以点击下方打开原文件。"} />
              <div className="button-row">
                {previewSessionFile.storageUri && (
                  <button className="secondary-button" onClick={() => openStoredFile(previewSessionFile.storageUri)}>打开原文件</button>
                )}
              </div>
            </div>
          </div>
        )}

        {weeklyTaskForm && (
          <div
            className="asset-preview weekly-task-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-task-dialog-title"
            onMouseDown={markModalBackdropPointerStart}
            onClick={(event) => closeModalFromBackdropClick(event, () => setWeeklyTaskForm(null))}
          >
            <div className="asset-preview-panel weekly-task-form-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setWeeklyTaskForm(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <div className="section-title">
                <span>自主训练</span>
                <h2 id="weekly-task-dialog-title">添加练习动作</h2>
              </div>
              <p>手动写下这周的练习任务，例如笔试、作品集或项目表达。</p>
              <div className="draft-edit-grid weekly-task-form-grid">
                <label className="wide-field">
                  <span>动作标题</span>
                  <input
                    autoFocus
                    value={weeklyTaskForm.title}
                    onChange={(event) => setWeeklyTaskForm((form) => (form ? { ...form, title: event.target.value } : form))}
                    placeholder="例如：整理一版项目表达"
                  />
                </label>
                <label className="wide-field">
                  <span>备注说明</span>
                  <textarea
                    value={weeklyTaskForm.detail}
                    onChange={(event) => setWeeklyTaskForm((form) => (form ? { ...form, detail: event.target.value } : form))}
                    placeholder="例如：练一道笔试题，或整理一个项目表达。"
                  />
                </label>
                <label>
                  <span>优先级</span>
                  <select
                    value={weeklyTaskForm.level ?? "P2"}
                    onChange={(event) =>
                      setWeeklyTaskForm((form) => (form ? { ...form, level: event.target.value as WeeklyTask["level"] } : form))
                    }
                  >
                    <option value="P0">P0</option>
                    <option value="P1">P1</option>
                    <option value="P2">P2</option>
                    <option value="P3">P3</option>
                  </select>
                </label>
              </div>
              <div className="button-row confirm-actions">
                <button className="primary-button" onClick={submitWeeklyTaskForm}>
                  添加动作
                </button>
                <button className="secondary-button" onClick={() => setWeeklyTaskForm(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDialog && (
          <div
            className="asset-preview confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onMouseDown={markModalBackdropPointerStart}
            onClick={(event) => closeModalFromBackdropClick(event, () => setConfirmDialog(null))}
          >
            <div className="asset-preview-panel confirm-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setConfirmDialog(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <div className="section-title">
                <span>{confirmDialog.eyebrow ?? "确认删除"}</span>
                <h2 id="confirm-dialog-title">{confirmDialog.title}</h2>
              </div>
              <p>{confirmDialog.description}</p>
              {confirmDialog.contentKind === "end-opportunity" ? (
                <div className="end-opportunity-form">
                  <span>结束原因</span>
                  <div className="end-reason-grid">
                    {endReasonOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={endOpportunityDraft.reason === option.value ? "active-filter" : ""}
                        aria-pressed={endOpportunityDraft.reason === option.value}
                        onClick={() => updateEndOpportunityDraft({ reason: option.value })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <label>
                    <span>备注</span>
                    <textarea
                      value={endOpportunityDraft.note}
                      onChange={(event) => updateEndOpportunityDraft({ note: event.target.value })}
                      placeholder="例如：HR 通知岗位暂停招聘；或自己决定不再继续。"
                    />
                  </label>
                </div>
              ) : null}
              <div className="button-row confirm-actions">
                <button className="secondary-button" onClick={() => setConfirmDialog(null)}>
                  {confirmDialog.cancelLabel ?? "取消"}
                </button>
                <button
                  className={confirmDialog.confirmTone === "primary" ? "primary-button" : "destructive-button"}
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  }}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PageIntro({
  label,
  title,
  detail,
  action,
  helpTooltip = "",
  helpLabel = "说明",
}: {
  label: string;
  title: string;
  detail: string;
  action: string;
  helpTooltip?: string;
  helpLabel?: string;
}) {
  return (
    <div className="page-intro">
      <div className="section-title">
        <span>{label}</span>
        <h2>
          {title}
          {helpTooltip ? (
            <span className="field-tooltip section-title-help" tabIndex={0} data-tooltip={helpTooltip} aria-label={helpLabel}>
              ?
            </span>
          ) : null}
        </h2>
        <em>{action}</em>
      </div>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

function SectionTitle({ label, title, action, titleId }: { label: string; title: string; action: string; titleId?: string }) {
  return (
    <div className="section-title">
      <span>{label}</span>
      <h2 id={titleId}>{title}</h2>
      <em>{action}</em>
    </div>
  );
}

function ApiModeBadge({ apiMode, onRefresh }: { apiMode: ApiModeState; onRefresh: () => void }) {
  const label =
    apiMode.status === "online"
      ? "已连接"
      : apiMode.status === "checking"
        ? "检查中"
        : apiMode.status === "offline"
          ? "未连接"
          : apiMode.status === "demo"
            ? "演示模式"
            : "本机模式";
  const detail =
    apiMode.status === "online"
      ? apiMode.dbPath
        ? "数据会保存在本机"
        : "数据服务已可用"
      : apiMode.status === "offline"
        ? "当前使用浏览器数据"
        : apiMode.status === "demo"
          ? "当前是演示数据"
          : apiMode.status === "mock"
            ? "数据保存在浏览器中"
            : "正在检查保存方式";

  return (
    <div className={`api-mode-badge ${apiMode.status}`} title={apiMode.dbPath || apiBaseUrl}>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      {apiMode.checkedAt && <em>{apiMode.checkedAt}</em>}
      <button className="mini-button" onClick={onRefresh} disabled={apiMode.status === "checking"}>
        刷新
      </button>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReviewBlock({
  label,
  value,
  readOnly,
  compact,
  onChange,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  compact?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <label className={`review-block${compact ? " compact-review-block" : ""}`}>
      <span>{label}</span>
      <textarea readOnly={readOnly} value={value} onChange={(event) => onChange?.(event.target.value)} />
    </label>
  );
}

function WeeklyTagEditor({
  label,
  values,
  onAdd,
  onUse,
}: {
  label: string;
  values: string[];
  onAdd: (value: string) => void;
  onUse: (label: string, value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="weekly-tags">
      <span>{label}</span>
      <div className="focus-grid">
        {values.map((item) => (
          <button key={item} onClick={() => onUse(label, item)}>{item}</button>
        ))}
      </div>
      <div className="tag-input-row">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`添加${label}`} />
        <button
          className="secondary-button compact-button"
          onClick={() => {
            onAdd(draft);
            setDraft("");
          }}
        >
          添加
        </button>
      </div>
    </div>
  );
}

function ListPager({
  page,
  pageCount,
  onPageChange,
  alwaysShow = false,
  className = "",
  label = "列表",
}: {
  page: number;
  pageCount: number;
  onPageChange: (nextPage: number) => void;
  alwaysShow?: boolean;
  className?: string;
  label?: string;
}) {
  if (!alwaysShow && pageCount <= 1) return null;

  return (
    <div className={`pager-row ${className}`.trim()} aria-label={`${label}分页`}>
      <button
        type="button"
        className="ghost-button compact-button"
        disabled={page === 0}
        aria-label={`${label}上一页`}
        onClick={() => onPageChange(Math.max(0, page - 1))}
      >
        上一页
      </button>
      <span>
        {page + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="ghost-button compact-button"
        disabled={page >= pageCount - 1}
        aria-label={`${label}下一页`}
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
      >
        下一页
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: Opportunity["status"] }) {
  return <span className={`status-pill ${status.toLowerCase().replace(/\s/g, "-")}`}>{statusLabel[status]}</span>;
}


function SegmentedProgress({ value, segments }: { value: number; segments: number }) {
  const filled = Math.round((value / 100) * segments);
  return (
    <div className="segmented-progress" aria-label={`${value}%`} style={{ "--segments": segments } as CSSProperties}>
      {Array.from({ length: segments }, (_, index) => (
        <span key={index} className={index < filled ? "filled" : ""} />
      ))}
    </div>
  );
}

function EmptyState({ title, detail, className = "" }: { title: string; detail: string; className?: string }) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function BoardView({
  opportunities,
  scope,
  openOpportunity,
}: {
  opportunities: Opportunity[];
  scope: OpportunityVisibilityFilter;
  openOpportunity: (id: string) => void;
}) {
  const [columnPages, setColumnPages] = useState<Partial<Record<OpportunityStatus, number>>>({});
  const boardStatuses = useMemo<OpportunityStatus[]>(
    () =>
      scope === "ENDED"
        ? ["ENDED"]
        : scope === "ALL"
          ? [...activeOpportunityBoardStatuses, "ENDED"]
          : activeOpportunityBoardStatuses,
    [scope],
  );
  const columnStateKey = useMemo(() => opportunities.map((item) => `${item.status}:${item.id}`).join("|"), [opportunities]);

  useEffect(() => {
    setColumnPages({});
  }, [scope, columnStateKey]);

  const setColumnPage = (status: OpportunityStatus, nextPage: number) => {
    setColumnPages((current) => ({ ...current, [status]: nextPage }));
  };

  return (
    <section className="board board-embedded" style={{ "--board-column-count": Math.max(boardStatuses.length, 1) } as CSSProperties}>
      {boardStatuses.map((status) => {
        const columnOpportunities = opportunities.filter((item) => item.status === status);
        const columnPage = columnPages[status] ?? 0;
        const columnList = paginateList(columnOpportunities, columnPage, OPPORTUNITY_BOARD_COLUMN_PAGE_SIZE);
        const isEndedColumn = status === "ENDED";

        return (
          <div className={`board-column ${isEndedColumn ? "board-column-ended" : ""}`} key={status}>
            <SectionTitle label="看板分组" title={statusLabel[status]} action={`${columnOpportunities.length}`} />
            {columnList.visible.map((item) => (
              <button className={`job-card job-card-button board-job-card ${isEndedColumn ? "job-card-ended" : ""}`} key={item.id} onClick={() => openOpportunity(item.id)}>
                <span className={`priority ${resolveOpportunityAction(item).toLowerCase()}`}>{resolveOpportunityAction(item)}</span>
                <h3>{item.title}</h3>
                <p>{item.company}</p>
              </button>
            ))}
            {columnOpportunities.length === 0 && <p className="board-column-empty">暂无岗位</p>}
            {columnList.pageCount > 1 && (
              <div className="board-column-pager" aria-label={`${statusLabel[status]}分页`}>
                <button
                  type="button"
                  aria-label={`${statusLabel[status]}上一页`}
                  disabled={columnList.safePage === 0}
                  onClick={() => setColumnPage(status, Math.max(0, columnList.safePage - 1))}
                >
                  <ChevronLeft size={13} aria-hidden="true" />
                </button>
                <span>
                  {columnList.safePage + 1} / {columnList.pageCount}
                </span>
                <button
                  type="button"
                  aria-label={`${statusLabel[status]}下一页`}
                  disabled={columnList.safePage >= columnList.pageCount - 1}
                  onClick={() => setColumnPage(status, Math.min(columnList.pageCount - 1, columnList.safePage + 1))}
                >
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function ExportAction({
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  icon: typeof Archive;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className="export-action" onClick={onClick}>
      <Icon size={20} />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <Send size={16} />
    </button>
  );
}

export default App;
