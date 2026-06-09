import {
  Archive,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileAudio,
  FileDown,
  FileText,
  Home,
  KanbanSquare,
  Library,
  Moon,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  buildOpportunityPipeline,
  computeOpportunityAction,
  formatNow,
  getOpportunityDueDate,
  inferDueDateFromText,
  isOpportunityDueSoon,
  makeId,
  opportunityStatusFlow,
  opportunityStatusNextAction,
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
  parseTranscriptQaPairs,
} from "./composerModel";
import {
  createAnswerCardApi,
  createAnswerCardFromQaPairApi,
  createInterviewSessionApi,
  createOpportunityApi,
  createQaPairApi,
  createResumeVersionApi,
  createWeeklyTaskApi,
  deleteAnswerCardApi,
  deleteInterviewSessionApi,
  deleteOpportunityApi,
  deleteQaPairApi,
  deleteResumeVersionApi,
  deleteWeeklyTaskApi,
  exportBackupApi,
  getApiHealthApi,
  getDashboardSummaryApi,
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
import { baseAnswerCards, baseWeeklyPlan, resumeVersions, seedInterviewSessions, seedOpportunities } from "./mockData";
import { selectDashboardSummary, selectResumeName, selectTodayActions, type DashboardSummary, type TodayAction } from "./selectors";
import type {
  AnswerCard,
  ComposerStep,
  InterviewSession,
  ModuleComposer,
  ModuleComposerDraft,
  ModuleComposerSource,
  Opportunity,
  OpportunityStatus,
  Page,
  PipelineStage,
  QaPair,
  ResumeVersion,
  SessionFile,
  SourceAsset,
  ViewMode,
  WeeklyPlan,
  WeeklyTask,
} from "./types";

const navItems: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: "home", label: "今日待办", icon: Home },
  { id: "opportunities", label: "岗位管理", icon: BriefcaseBusiness },
  { id: "interviews", label: "面试复盘", icon: FileAudio },
  { id: "answers", label: "答案库", icon: Library },
  { id: "resumes", label: "简历版本", icon: FileText },
  { id: "weekly", label: "训练计划", icon: CalendarClock },
  { id: "exports", label: "设置导出", icon: FileDown },
];

const flowPipelineSteps = [
  { title: "模块内新增", hint: "上传或粘贴原始材料" },
  { title: "补齐必填", hint: "确认解析与关键字段" },
  { title: "写入模块", hint: "岗位 / 面试 / 答案 / 简历" },
  { title: "今日待办", hint: "从正式记录自动汇总" },
] as const;

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
  onConfirm: () => void;
};

type AiSettings = {
  provider: "none" | "openai" | "anthropic" | "custom";
  model: string;
  apiKey: string;
  parseMode: "mock" | "assist";
  transcriptionMode: "mock" | "assist";
  endpoint: string;
  notes: string;
};

const aiSettingsStorageKey = "jobpilot.aiSettings.v1";
const dismissedTodayStorageKey = "jobpilot.dismissedToday.v1";
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
  if (action.source === "answer") return "答案";
  if (action.source === "weekly") return action.page === "weekly" ? "训练" : "训练关联";
  return "待办";
};

const trainingTaskRouteLabel = (task: WeeklyTask) => {
  if (task.source === "opportunity" && task.relatedEntityId) return "今日待办点击后打开：岗位详情";
  if (task.source === "interview" && task.relatedEntityId) return "今日待办点击后打开：面试复盘";
  if (task.source === "answer" && task.relatedEntityId) return "今日待办点击后打开：答案库";
  return "今日待办点击后打开：训练计划";
};

const pageShowsTopSearch = (currentPage: Page) => currentPage === "opportunities" || currentPage === "interviews" || currentPage === "answers";

const topSearchPlaceholder = (currentPage: Page) => {
  if (currentPage === "interviews") return "搜索公司、岗位、轮次";
  if (currentPage === "answers") return "搜索问题、回答、来源、适用岗位";
  return "搜索岗位、公司、下一步动作";
};

const getInterviewTranscriptText = (session: InterviewSession) => {
  const files = session.sourceFiles ?? [];
  const transcriptFile = files.find((file) => file.kind === "transcript" && file.content?.trim());
  if (transcriptFile?.content) return transcriptFile.content.trim();
  const fallbackFile = files.find((file) => file.content?.trim() && !/^(?:录音文件|文字稿文件)[：:]/.test(file.content.trim()));
  return fallbackFile?.content?.trim() ?? "";
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
]);

const extractionStatusLabel = (status?: string) => {
  if (!status) return "";
  const labels: Record<string, string> = {
    "local-text": "已读取文本文件",
    "local-pdf-text": "已提取 PDF 文字",
    "local-docx-text": "已提取 DOCX 文字",
    "ai-ocr": "已完成 OCR",
    "ai-transcription": "已完成录音转写",
    "ai-not-configured": "Assist 未配置服务商/API Key",
    "stored-file-missing": "找不到已上传文件，请重新上传",
    "empty-pdf-text": "PDF 没有可提取文字，扫描件需要开启 OCR",
    "empty-docx-text": "DOCX 没有可提取文字，请检查文件内容",
    "ocr-unavailable": "截图/图片需要开启 Assist 并配置视觉模型",
    "empty-ocr-text": "OCR 未识别出文字，请换更清晰截图",
    "ocr-provider-failed": "OCR 服务调用失败，请检查模型、Key 或 endpoint",
    "transcription-unavailable": "录音需要开启转写 Assist 并配置可用 API",
    "empty-transcription-text": "转写服务没有返回文字，请检查音频内容",
    "transcription-provider-failed": "转写服务调用失败，请检查 Key、endpoint 或音频格式",
    "transcription-provider-unsupported": "当前服务商不支持录音转写，请用 OpenAI 或兼容接口",
    "ai-review": "已完成 AI 面试复盘",
    "ai-parser-failed": "AI 面试复盘调用失败",
    "ai-parser-invalid-json": "AI 没有返回可解析的 JSON",
    "ai-review-empty": "AI 没有返回有效的问题复盘",
    "unsupported-file-type": "当前文件类型不能自动读取",
    "file-extraction-failed": "文件提取失败，请换文件或粘贴文字",
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
    return "录音需要先开启「录音转写 → Assist」";
  }
  if (sourceKind === "screenshot" && settings.parseMode !== "assist") {
    return "截图需要先开启「文字 / JD / 简历解析 → Assist：OCR + AI 结构化解析」";
  }
  if ((sourceKind === "screenshot" || (composer === "interview" && sourceKind === "audio")) && !isAiProviderConfigured(settings)) {
    return "请先在设置里选择服务商（OpenAI / Anthropic / 自定义）并填写 API Key";
  }
  if (composer === "interview" && sourceKind === "audio" && settings.provider === "anthropic") {
    return "录音转写目前不支持 Anthropic，请改用 OpenAI 或自定义 OpenAI 兼容接口";
  }
  if (sourceKind === "screenshot" && settings.provider === "custom" && /api\.example\.com/i.test(settings.endpoint)) {
    return "自定义 endpoint 还是示例地址 https://api.example.com/v1，请改成真实 API 地址";
  }
  if (sourceKind === "screenshot" && settings.provider === "custom" && settings.endpoint.includes("deepseek.com")) {
    return "DeepSeek 普通 chat API 不支持截图 OCR。截图请改用 OpenAI/Anthropic 视觉模型，或先把 JD 文字粘贴到文本框";
  }
  return "";
};

const uploadStatusLabel = (source: ModuleComposerSource) => {
  if (source.rawText.trim()) return "已读取文字，可解析";
  if (source.uploadStatus === "reading") return "正在读取文本文件...";
  if (source.uploadStatus === "uploading") return "正在保存到本地 API...";
  if (source.uploadStatus === "stored") return "文件已保存，点击开始解析";
  if (source.uploadStatus === "failed") return "文件保存失败，PDF/DOCX/OCR/录音解析不可用";
  if (source.uploadStatus === "local-only") return "文件只在浏览器中，PDF/DOCX/OCR/录音解析不可用";
  if (source.fileName) return "文件已选择";
  return "未选择文件";
};

const canRunSourceParse = (source: ModuleComposerSource) => {
  if (source.rawText.trim()) return true;
  if (!source.fileName.trim()) return false;
  if (source.uploadStatus === "reading" || source.uploadStatus === "uploading") return false;
  return Boolean(isApiEnabled && source.storageUri);
};

const normalizeParsedQaPairs = (items: unknown): Array<Omit<QaPair, "id">> => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Partial<QaPair>;
      const question = String(source.question ?? "").trim();
      if (!question) return null;
      const score = Number(source.score);
      return {
        question,
        originalAnswer: String(source.originalAnswer ?? "").trim() || "待补充原回答。",
        type: String(source.type ?? "").trim() || "BEHAVIORAL",
        score: Number.isFinite(score) ? Math.min(5, Math.max(1, Math.round(score))) : 2,
        critique: String(source.critique ?? "").trim() || "建议补充更具体的例子、指标和复盘。",
        weak: typeof source.weak === "boolean" ? source.weak : true,
        framework: String(source.framework ?? "").trim() || "情境 -> 任务 -> 行动 -> 结果 -> 复盘",
        optimizedAnswer: String(source.optimizedAnswer ?? "").trim() || "按推荐框架重写回答。",
      };
    })
    .filter((item): item is Omit<QaPair, "id"> => Boolean(item))
    .slice(0, 12);
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
      targetId: action.targetId,
      taskId: action.taskId,
    });
    return items;
  }, []);
  return normalizedActions.length ? normalizedActions : fallback;
};

function App() {
  const [page, setPage] = useState<Page>("home");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [opportunities, setOpportunities] = useState<Opportunity[]>(seedOpportunities);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(seedOpportunities[0].id);
  const [interviewSessions, setInterviewSessions] = useState(seedInterviewSessions);
  const [selectedInterviewId, setSelectedInterviewId] = useState(seedInterviewSessions[0].id);
  const [selectedQaId, setSelectedQaId] = useState(seedInterviewSessions[0].qaPairs[0].id);
  const [query, setQuery] = useState("");
  const [interviewPage, setInterviewPage] = useState(0);
  const [filter, setFilter] = useState("ALL");
  const [systemMessage, setSystemMessage] = useState("[READY]");
  const [apiMode, setApiMode] = useState<ApiModeState>(() =>
    isPublicDemo ? { status: "demo" } : isApiEnabled ? { status: "checking" } : { status: "mock" },
  );
  const [answerCards, setAnswerCards] = useState<AnswerCard[]>(baseAnswerCards);
  const [selectedAnswerId, setSelectedAnswerId] = useState(baseAnswerCards[0].id);
  const [resumeList, setResumeList] = useState<ResumeVersion[]>(resumeVersions);
  const [selectedResumeId, setSelectedResumeId] = useState(resumeVersions[0].id);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan>(baseWeeklyPlan);
  const [apiDashboardSummary, setApiDashboardSummary] = useState<ApiDashboardSummary | null>(null);
  const [apiTodayActions, setApiTodayActions] = useState<ApiTodayAction[] | null>(null);
  const [previewAsset, setPreviewAsset] = useState<SourceAsset | null>(null);
  const [previewSessionFile, setPreviewSessionFile] = useState<SessionFile | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [dismissedTodayIds, setDismissedTodayIds] = useState<Set<string>>(() => loadDismissedTodayIds());
  const [composer, setComposer] = useState<ModuleComposer | null>(null);
  const [composerStep, setComposerStep] = useState<ComposerStep>("source");
  const [composerSource, setComposerSource] = useState<ModuleComposerSource>(() => createModuleComposerSource());
  const [composerParsedQaPairs, setComposerParsedQaPairs] = useState<Array<Omit<QaPair, "id">>>([]);
  const [composerParseNotice, setComposerParseNotice] = useState("");
  const [composerParsing, setComposerParsing] = useState(false);
  const [interviewReparseBusy, setInterviewReparseBusy] = useState(false);
  const [interviewReparseNotice, setInterviewReparseNotice] = useState("");
  const [composerDraft, setComposerDraft] = useState<ModuleComposerDraft>(() =>
    createModuleComposerDraft(resumeVersions[0]?.id ?? "", seedOpportunities[0]?.id ?? ""),
  );
  const apiOpportunityIdsRef = useRef(new Set(seedOpportunities.map((item) => item.id)));

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
          setSystemMessage("[API ONLINE]");
        } else {
          setApiMode({ status: "offline", checkedAt: new Date().toLocaleTimeString() });
          setSystemMessage("[API UNHEALTHY]");
        }
      })
      .catch(() => {
        setApiMode({ status: "offline", checkedAt: new Date().toLocaleTimeString() });
        setSystemMessage("[API OFFLINE]");
      });
  };

  const applyLoadedData = (data: InitialApiData | JobPilotBackup) => {
    setOpportunities(data.opportunities);
    apiOpportunityIdsRef.current = new Set(data.opportunities.map((item) => item.id));
    setSelectedOpportunityId(data.opportunities[0]?.id ?? "");
    setInterviewSessions(data.interviewSessions);
    setSelectedInterviewId(data.interviewSessions[0]?.id ?? "");
    setSelectedQaId(data.interviewSessions[0]?.qaPairs[0]?.id ?? "");
    setAnswerCards(data.answerCards);
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
      setSystemMessage(isPublicDemo ? "[PUBLIC DEMO]" : "[LOCAL MOCK]");
      setApiMode(isPublicDemo ? { status: "demo" } : { status: "mock" });
      return;
    }

    let cancelled = false;
    Promise.all([getApiHealthApi(), loadInitialApiData()])
      .then(([health, data]) => {
        if (cancelled) return;
        markApiOnline(health);
        applyLoadedData(data);
        setSystemMessage("[API HYDRATED]");
      })
      .catch(() => {
        if (!cancelled) {
          setApiMode({ status: "offline", checkedAt: new Date().toLocaleTimeString() });
          setSystemMessage("[LOCAL MOCK]");
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
      .catch(() => setSystemMessage("[WEEKLY LOCAL ONLY]"));
  };

  const selectedOpportunity = opportunities.find((item) => item.id === selectedOpportunityId) ?? opportunities[0];
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
  const normalizedQuery = query.trim().toLowerCase();
  const filteredInterviewSessions = interviewSessions.filter((session) =>
    `${session.company} ${session.role} ${session.round} ${session.date}`.toLowerCase().includes(normalizedQuery),
  );
  const interviewPageSize = 4;
  const interviewPageCount = Math.max(1, Math.ceil(filteredInterviewSessions.length / interviewPageSize));
  const visibleInterviewSessions = filteredInterviewSessions.slice(interviewPage * interviewPageSize, interviewPage * interviewPageSize + interviewPageSize);
  const filteredAnswerCards = useMemo(
    () =>
      answerCards.filter((card) => {
        const haystack = `${card.question} ${card.answer} ${card.framework} ${card.source} ${card.relatedRoles} ${card.type} ${card.status} ${card.practiceStatus}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    [answerCards, normalizedQuery],
  );

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((item) => {
      const resumeName = resumeList.find((resume) => resume.id === item.resumeId)?.name ?? item.resumeId;
      const haystack = `${item.title} ${item.company} ${item.city} ${item.nextAction} ${resumeName}`.toLowerCase();
      const matchesQuery = haystack.includes(normalizedQuery);
      const computedAction = computeOpportunityAction(item);
      const matchesFilter =
        filter === "ALL" ||
        computedAction === filter ||
        (filter === "A PRIORITY" && item.priority === "A") ||
        (filter === "HIGH MATCH" && item.match === "HIGH") ||
        (filter === "DUE SOON" && isOpportunityDueSoon(item));
      return matchesQuery && matchesFilter;
    });
  }, [opportunities, normalizedQuery, filter, resumeList]);

  const linkedResumeOpportunities = selectedResume
    ? opportunities.filter((item) => item.resumeId === selectedResume.id || selectedResume.linkedOpportunityIds.includes(item.id))
    : [];
  const selectedOpportunitySessions = interviewSessions.filter((session) => session.opportunityId === selectedOpportunity?.id);
  const selectedOpportunityPipeline = selectedOpportunity ? buildOpportunityPipeline(selectedOpportunity, selectedOpportunitySessions) : [];
  const selectedOpportunityAction = selectedOpportunity ? computeOpportunityAction(selectedOpportunity) : "P2";

  const goTo = (nextPage: Page) => {
    setPage(nextPage);
    setSystemMessage(`[OPENED: ${nextPage.toUpperCase()}]`);
  };

  const openComposer = (kind: ModuleComposer, linkedOpportunityId = "") => {
    setComposer(kind);
    setComposerStep(kind === "answer" ? "review" : "source");
    setComposerSource(createModuleComposerSource(kind === "resume" ? "resume-file" : kind === "interview" ? "audio" : kind === "opportunity" ? "jd-text" : "manual"));
    setComposerParsedQaPairs([]);
    setComposerParseNotice("");
    setComposerParsing(false);
    setComposerDraft(createModuleComposerDraft(resumeList[0]?.id ?? "", linkedOpportunityId));
    setSystemMessage(`[NEW ${kind.toUpperCase()}]`);
  };

  const updateAiSettings = (patch: Partial<AiSettings>) => {
    setAiSettings((settings) => ({ ...settings, ...patch }));
  };

  const updateComposerSource = (field: keyof ModuleComposerSource, value: string) => {
    setComposerSource((source) => ({ ...source, [field]: value } as ModuleComposerSource));
  };

  const updateComposerDraft = (field: keyof ModuleComposerDraft, value: string) => {
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
    setSystemMessage("[SOURCE SELECTED]");

    if (/\.(txt|md)$/i.test(file.name)) {
      setSystemMessage("[READING TEXT FILE]");
      setComposerSource((source) => ({ ...source, uploadStatus: "reading" }));
      void file.text()
        .then((text) => {
          setComposerSource((source) => ({ ...source, rawText: text, uploadStatus: isApiEnabled ? source.uploadStatus : "stored" }));
          setSystemMessage("[TEXT FILE LOADED]");
        })
        .catch(() => {
          setComposerSource((source) => ({ ...source, uploadStatus: "failed" }));
          setSystemMessage("[TEXT FILE READ FAILED]");
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
          setSystemMessage("[FILE STORED]");
        })
        .catch(() => {
          setComposerSource((source) => ({ ...source, uploadStatus: "local-only" }));
          setSystemMessage("[FILE LOCAL ONLY]");
        });
    }
  };

  const runComposerParse = async () => {
    if (!composer || composerParsing) return;
    const rawText = composerSource.rawText.trim();
    const fileName = composerSource.fileName.trim();
    if (composer !== "answer" && !rawText && !fileName) {
      setComposerParseNotice("请先上传文件，或粘贴文字内容。");
      setSystemMessage("[SELECT SOURCE FIRST]");
      return;
    }
    if (composer !== "answer" && fileName && !rawText && isApiEnabled && !composerSource.storageUri) {
      setComposerParseNotice("文件还在保存到本地 API，请稍等几秒后再点「开始解析」。");
      setSystemMessage("[WAIT FOR FILE STORE]");
      return;
    }

    const assistRequirement = composer !== "answer" ? composerAssistRequirement(composer, composerSource.sourceKind, aiSettings) : "";
    if (assistRequirement && !rawText) {
      setComposerSource((source) => ({
        ...source,
        extractionStatus: composerSource.sourceKind === "audio" ? "transcription-unavailable" : "ocr-unavailable",
      }));
      setComposerParseNotice(assistRequirement);
      setSystemMessage("[ASSIST REQUIRED]");
      return;
    }

    const parseText = `${rawText} ${fileBaseName(fileName)}`.trim();
    const defaultResumeId = composerDraft.resumeId || resumeList[0]?.id || "";
    const linkedOpportunity = opportunities.find((item) => item.id === composerDraft.linkedOpportunityId);

    const applyLocalParse = () => {
      setComposerParsedQaPairs([]);
      if (composer === "opportunity") {
      const company = detectCompany(parseText) || composerDraft.company || "待填写公司";
      const title = detectRoleTitle(parseText, composerDraft.title);
      const parsedSourceText =
        rawText ||
        (composerSource.sourceKind === "screenshot"
          ? `截图文件：${fileName}。文件已保存；开启 Assist 后会通过本地 API 调用视觉 OCR 提取 JD。`
          : `上传文件：${fileName}。文件已保存；本地 API 可读取 txt/md/PDF/DOCX 文本，图片需开启 Assist OCR。`);
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
        sourceLabel: fileName || (composerSource.sourceKind === "job-link" ? "招聘链接" : "文字 JD"),
        sourceText: parsedSourceText,
      }));
      }

      if (composer === "interview") {
      const isAudio = composerSource.sourceKind === "audio";
      const transcript =
        rawText ||
        (isAudio
          ? `录音文件：${fileName}。文件已保存；开启转写 Assist 后会通过本地 API 调用转写服务。`
          : `文字稿文件：${fileName}。本地 API 可读取 txt/md/docx 文本；旧 .doc 请先另存为 .docx 或粘贴文字稿。`);
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
        points: rawText || "文件已保存；本地 API 可读取 txt/md/PDF/DOCX 简历文本，图片简历需开启 Assist OCR。",
        summary: composerSource.note || "结构化字段会基于已粘贴或可提取的文本生成。",
      }));
      }

      setComposerStep("review");
      setComposerParseNotice("");
      setSystemMessage("[SOURCE PARSED]");
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
      setSystemMessage(`[PARSE BLOCKED: ${status}]`);
    };

    if (composer === "interview" && rawText && shouldUseAiAssist && !isAiProviderConfigured(aiSettings)) {
      blockParseWithNotice("ai-not-configured", "面试文字稿已选择 Assist，但还没有配置可用的服务商/API Key。请配置后重试。");
      return;
    }

    if (shouldUseParseApi && ["opportunity", "interview", "resume"].includes(composer)) {
      try {
        setComposerParsing(true);
        setComposerParseNotice("正在读取文件并解析，请稍候...");
        setSystemMessage("[PARSING VIA API]");
        const payload = {
          rawText,
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
                "文件提取失败，请检查 Assist 配置、模型和 endpoint。",
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
                "AI 面试复盘失败，请检查 Assist 配置、模型和 endpoint。",
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
                "文件提取失败，请检查 Assist 配置、模型和 endpoint。",
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
        setSystemMessage("[SOURCE PARSED VIA API]");
        return;
      } catch (error) {
        const errorDetail = error instanceof Error ? error.message : String(error || "");
        if (composer === "interview" && sendAiSettings) {
          blockParseWithNotice(
            "ai-parser-failed",
            [
              "AI 面试复盘调用失败，已停止写入旧规则结果。",
              errorDetail ? `实际错误：${errorDetail}` : "请检查模型、Key、endpoint 后重试。",
            ].join(" "),
          );
          return;
        }
        if (requiresFileExtraction) {
          blockParseWithNotice("file-extraction-failed", "本地 API 解析失败。请确认 API ONLINE，或先粘贴文字内容再解析。");
          return;
        }
        setComposerParseNotice("API 解析失败，已回退到本地规则解析。");
        setSystemMessage("[PARSER FALLBACK]");
      } finally {
        setComposerParsing(false);
      }
    }

    if (requiresFileExtraction && composerSource.sourceKind === "audio" && aiSettings.transcriptionMode !== "assist") {
      blockParseWithNotice("transcription-unavailable", "录音需要先开启「录音转写 → Assist」。");
      return;
    }

    applyLocalParse();
  };

  const openOpportunity = (id: string) => {
    setSelectedOpportunityId(id);
    setPage("opportunityDetail");
    setSystemMessage("[OPENED: OPPORTUNITY DETAIL]");
  };

  const selectInterview = (id: string) => {
    const nextSession = interviewSessions.find((item) => item.id === id);
    if (!nextSession) return;
    setSelectedInterviewId(id);
    setSelectedQaId(nextSession.qaPairs[0]?.id ?? "");
  };

  const updateSelectedQa = (field: keyof Pick<QaPair, "originalAnswer" | "critique" | "framework" | "optimizedAnswer">, value: string) => {
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
    setSystemMessage(weak ? "[QA REOPENED]" : "[QA REVIEWED]");
  };

  const updateSelectedInterview = (patch: Partial<InterviewSession>) => {
    setInterviewSessions((sessions) => sessions.map((session) => (session.id === selectedInterview.id ? { ...session, ...patch } : session)));
    syncUpdatedInterviewSession(selectedInterview.id, patch);
  };

  const updateSelectedOpportunity = (patch: Partial<Opportunity>) => {
    const normalizedPatch =
      "deadline" in patch && !("dueDate" in patch) ? { ...patch, dueDate: inferDueDateFromText(patch.deadline ?? "") } : patch;
    const shouldRecomputeAction = ["status", "deadline", "dueDate", "priority", "match"].some((field) => field in normalizedPatch) && !("action" in normalizedPatch);
    const nextOpportunity = { ...selectedOpportunity, ...normalizedPatch };
    const nextPatch = shouldRecomputeAction ? { ...normalizedPatch, action: computeOpportunityAction(nextOpportunity) } : normalizedPatch;
    setOpportunities((items) => items.map((item) => (item.id === selectedOpportunity.id ? { ...item, ...nextPatch } : item)));
    invalidateApiInsights();
    syncUpdatedOpportunity(selectedOpportunity.id, nextPatch);
  };

  const replaceInterviewQaPairs = (sessionId: string, previousPairs: QaPair[], nextPairs: Array<Omit<QaPair, "id">>) => {
    const qaPairs: QaPair[] = nextPairs.map((pair) => ({ id: makeId("QA"), ...pair }));
    setInterviewSessions((sessions) => sessions.map((session) => (session.id === sessionId ? { ...session, qaPairs } : session)));
    setSelectedQaId(qaPairs[0]?.id ?? "");
    previousPairs.forEach((pair) => syncDeletedQaPair(pair.id));
    qaPairs.forEach((pair) => syncCreatedQaPair(sessionId, pair));
    invalidateApiInsights();
  };

  const executeReparseSelectedInterview = async () => {
    const transcript = getInterviewTranscriptText(selectedInterview);
    if (!transcript) {
      setInterviewReparseNotice("找不到可用文字稿。请先在原始材料里保存文字稿内容，或重新上传后再解析。");
      return;
    }

    setInterviewReparseBusy(true);
    setInterviewReparseNotice("正在根据原始文字稿重新解析，请稍候...");
    setSystemMessage("[INTERVIEW REPARSE]");

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
              "重新解析失败，请检查文字稿或 Assist 配置。",
          );
          setSystemMessage(`[REPARSE BLOCKED: ${parsed.extractionStatus ?? "failed"}]`);
          return;
        }
        nextPairs = normalizeParsedQaPairs(parsed.qaPairs);
      } else {
        nextPairs = parseTranscriptQaPairs(transcript);
      }

      if (!nextPairs.length) {
        setInterviewReparseNotice("没有从文字稿中识别出有效问题。请检查文字稿格式，或开启 Assist 后重试。");
        setSystemMessage("[REPARSE EMPTY]");
        return;
      }

      replaceInterviewQaPairs(selectedInterview.id, selectedInterview.qaPairs, nextPairs);
      setInterviewReparseNotice(`已重新解析 ${nextPairs.length} 个问题。`);
      setSystemMessage("[INTERVIEW REPARSED]");
    } catch (error) {
      const errorDetail = error instanceof Error ? error.message : String(error || "");
      setInterviewReparseNotice(errorDetail ? `重新解析失败：${errorDetail}` : "重新解析失败，请稍后重试。");
      setSystemMessage("[REPARSE FAILED]");
    } finally {
      setInterviewReparseBusy(false);
    }
  };

  const requestReparseSelectedInterview = () => {
    const transcript = getInterviewTranscriptText(selectedInterview);
    if (!transcript) {
      setInterviewReparseNotice("找不到可用文字稿。请先在原始材料里保存文字稿内容，或重新上传后再解析。");
      return;
    }
    requestConfirm({
      title: "重新解析这场面试的问题？",
      description: "会用原始文字稿重新拆题并生成复盘，当前问题列表会被替换。",
      confirmLabel: "重新解析",
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
    syncCreatedQaPair(selectedInterviewId, newQa);
    setSystemMessage("[QA ADDED]");
  };

  const requestConfirm = (config: ConfirmDialogState) => setConfirmDialog(config);

  useEffect(() => {
    if (!confirmDialog && !previewAsset && !previewSessionFile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmDialog) setConfirmDialog(null);
      else if (previewAsset) setPreviewAsset(null);
      else if (previewSessionFile) setPreviewSessionFile(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDialog, previewAsset, previewSessionFile]);

  const syncCreatedAnswerCard = (card: AnswerCard) => {
    void createAnswerCardApi(card)
      .then((savedCard) => {
        setAnswerCards((cards) => cards.map((item) => (item.id === card.id ? savedCard : item)));
        setSelectedAnswerId((id) => (id === card.id ? savedCard.id : id));
      })
      .catch(() => setSystemMessage("[ANSWER LOCAL ONLY]"));
  };

  const syncUpdatedAnswerCard = (id: string, patch: Partial<AnswerCard>) => {
    void updateAnswerCardApi(id, patch).catch(() => setSystemMessage("[ANSWER LOCAL ONLY]"));
  };

  const syncDeletedAnswerCard = (id: string) => {
    void deleteAnswerCardApi(id).catch(() => setSystemMessage("[ANSWER LOCAL ONLY]"));
  };

  const syncWeeklyPlanPatch = (patch: Partial<Omit<WeeklyPlan, "tasks">>) => {
    void updateWeeklyPlanApi(patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("[WEEKLY LOCAL ONLY]"));
  };

  const syncCreatedWeeklyTask = (task: WeeklyTask) => {
    void createWeeklyTaskApi(task)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("[WEEKLY LOCAL ONLY]"));
  };

  const syncUpdatedWeeklyTask = (id: string, patch: Partial<WeeklyTask>) => {
    void updateWeeklyTaskApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("[WEEKLY LOCAL ONLY]"));
  };

  const syncDeletedWeeklyTask = (id: string) => {
    void deleteWeeklyTaskApi(id)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("[WEEKLY LOCAL ONLY]"));
  };

  const syncCreatedResumeVersion = (resume: ResumeVersion) => {
    void createResumeVersionApi(resume)
      .then((savedResume) => {
        setResumeList((items) => items.map((item) => (item.id === resume.id ? savedResume : item)));
        setSelectedResumeId((id) => (id === resume.id ? savedResume.id : id));
      })
      .catch(() => setSystemMessage("[RESUME LOCAL ONLY]"));
  };

  const syncUpdatedResumeVersion = (id: string, patch: Partial<ResumeVersion>) => {
    void updateResumeVersionApi(id, patch).catch(() => setSystemMessage("[RESUME LOCAL ONLY]"));
  };

  const syncDeletedResumeVersion = (id: string) => {
    void deleteResumeVersionApi(id).catch(() => setSystemMessage("[RESUME LOCAL ONLY]"));
  };

  const syncCreatedInterviewSession = (session: InterviewSession) => {
    if (session.opportunityId && !apiOpportunityIdsRef.current.has(session.opportunityId)) {
      setSystemMessage("[INTERVIEW LOCAL ONLY]");
      return;
    }
    void createInterviewSessionApi(session)
      .then((savedSession) => {
        setInterviewSessions((sessions) => sessions.map((item) => (item.id === session.id ? savedSession : item)));
        setSelectedInterviewId((id) => (id === session.id ? savedSession.id : id));
        setSelectedQaId((id) => (session.qaPairs.some((pair) => pair.id === id) ? savedSession.qaPairs.find((pair) => pair.id === id)?.id ?? id : id));
      })
      .catch(() => setSystemMessage("[INTERVIEW LOCAL ONLY]"));
  };

  const syncUpdatedInterviewSession = (id: string, patch: Partial<InterviewSession>) => {
    void updateInterviewSessionApi(id, patch).catch(() => setSystemMessage("[INTERVIEW LOCAL ONLY]"));
  };

  const syncCreatedQaPair = (interviewId: string, qaPair: QaPair) => {
    void createQaPairApi(interviewId, qaPair).catch(() => setSystemMessage("[INTERVIEW LOCAL ONLY]"));
  };

  const syncUpdatedQaPair = (id: string, patch: Partial<QaPair>) => {
    void updateQaPairApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("[INTERVIEW LOCAL ONLY]"));
  };

  const syncDeletedQaPair = (id: string) => {
    void deleteQaPairApi(id).catch(() => setSystemMessage("[INTERVIEW LOCAL ONLY]"));
  };

  const syncDeletedInterviewSession = (id: string) => {
    void deleteInterviewSessionApi(id).catch(() => setSystemMessage("[INTERVIEW LOCAL ONLY]"));
  };

  const syncCreatedOpportunity = (opportunity: Opportunity) => {
    void createOpportunityApi(opportunity)
      .then((savedOpportunity) => {
        apiOpportunityIdsRef.current.add(savedOpportunity.id);
        refreshApiInsights();
        setOpportunities((items) => {
          const currentOpportunity = items.find((item) => item.id === savedOpportunity.id);
          if (currentOpportunity && JSON.stringify(currentOpportunity) !== JSON.stringify(savedOpportunity)) {
            void updateOpportunityApi(savedOpportunity.id, currentOpportunity).catch(() => setSystemMessage("[OPPORTUNITY LOCAL ONLY]"));
            return items;
          }
          return items.map((item) => (item.id === opportunity.id ? savedOpportunity : item));
        });
        setSelectedOpportunityId((id) => (id === opportunity.id ? savedOpportunity.id : id));
      })
      .catch(() => setSystemMessage("[OPPORTUNITY LOCAL ONLY]"));
  };

  const syncUpdatedOpportunity = (id: string, patch: Partial<Opportunity>) => {
    if (!apiOpportunityIdsRef.current.has(id)) {
      setSystemMessage("[OPPORTUNITY LOCAL ONLY]");
      return;
    }
    void updateOpportunityApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("[OPPORTUNITY LOCAL ONLY]"));
  };

  const syncDeletedOpportunity = (id: string) => {
    if (!apiOpportunityIdsRef.current.has(id)) {
      setSystemMessage("[OPPORTUNITY LOCAL ONLY]");
      return;
    }
    void deleteOpportunityApi(id)
      .then(() => {
        apiOpportunityIdsRef.current.delete(id);
        refreshApiInsights();
      })
      .catch(() => setSystemMessage("[OPPORTUNITY LOCAL ONLY]"));
  };

  const deleteSelectedQa = () => {
    const qaId = selectedQa.id;
    const remaining = selectedInterview.qaPairs.filter((pair) => pair.id !== selectedQa.id);
    if (remaining.length === 0) {
      setSystemMessage("[KEEP AT LEAST ONE QA]");
      return;
    }
    setInterviewSessions((sessions) =>
      sessions.map((session) => (session.id === selectedInterviewId ? { ...session, qaPairs: remaining } : session)),
    );
    setSelectedQaId(remaining[0].id);
    syncDeletedQaPair(qaId);
    setSystemMessage("[QA DELETED]");
  };

  const deleteSelectedInterview = () => {
    const interviewId = selectedInterview.id;
    const remaining = interviewSessions.filter((session) => session.id !== interviewId);
    if (remaining.length === 0) {
      setSystemMessage("[KEEP AT LEAST ONE INTERVIEW]");
      return;
    }
    setInterviewSessions(remaining);
    setSelectedInterviewId(remaining[0].id);
    setSelectedQaId(remaining[0].qaPairs[0]?.id ?? "");
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => !(task.source === "interview" && task.relatedEntityId === interviewId)) }));
    setInterviewPage(0);
    invalidateApiInsights();
    syncDeletedInterviewSession(interviewId);
    setSystemMessage("[INTERVIEW DELETED]");
  };

  const addAnswerCard = () => {
    const newCard: AnswerCard = {
      id: makeId("AC"),
      question: "新增答案卡：请输入常见面试问题",
      type: "MANUAL",
      status: "DRAFT",
      source: "手动创建",
      framework: "背景 -> 动作 -> 结果 -> 复盘",
      answer: "在这里写你希望下次面试复用的回答。",
      relatedRoles: "待填写",
      practiceStatus: "未练习",
    };
    setAnswerCards((cards) => [newCard, ...cards]);
    setSelectedAnswerId(newCard.id);
    syncCreatedAnswerCard(newCard);
    setSystemMessage("[ANSWER CARD ADDED]");
  };

  const updateSelectedAnswer = (field: keyof Pick<AnswerCard, "question" | "type" | "framework" | "answer" | "relatedRoles" | "practiceStatus" | "status">, value: string) => {
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
      setSystemMessage("[KEEP AT LEAST ONE ANSWER]");
      return;
    }
    setAnswerCards(remaining);
    setSelectedAnswerId(remaining[0].id);
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => !(task.source === "answer" && task.relatedEntityId === answerId)) }));
    invalidateApiInsights();
    syncDeletedAnswerCard(answerId);
    setSystemMessage("[ANSWER CARD DELETED]");
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
      setSystemMessage("[KEEP AT LEAST ONE RESUME]");
      return;
    }
    setResumeList(remaining);
    setSelectedResumeId(remaining[0].id);
    setOpportunities((items) => items.map((opportunity) => (opportunity.resumeId === resumeId ? { ...opportunity, resumeId: "" } : opportunity)));
    invalidateApiInsights();
    syncDeletedResumeVersion(resumeId);
    setSystemMessage("[RESUME VERSION DELETED]");
  };

  const deleteSelectedOpportunity = () => {
    const opportunityId = selectedOpportunity.id;
    const remaining = opportunities.filter((opportunity) => opportunity.id !== opportunityId);
    if (remaining.length === 0) {
      setSystemMessage("[KEEP AT LEAST ONE OPPORTUNITY]");
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
    setSystemMessage("[OPPORTUNITY DELETED]");
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
      setSystemMessage("[FILE NOT STORED]");
      return;
    }
    window.open(`${apiBaseUrl}${storageUri}`, "_blank", "noopener,noreferrer");
    setSystemMessage("[FILE PREVIEW OPENED]");
  };

  const buildLocalBackup = (): JobPilotBackup => ({
      schemaVersion: "jobpilot-v0.7.2",
      exportedAt: new Date().toISOString(),
      source: isPublicDemo ? "public-demo" : isApiEnabled ? "local-api" : "local-mock",
      opportunities,
      interviewSessions,
      answerCards,
      resumeVersions: resumeList,
      weeklyPlan,
      storedFiles: [],
  });

  const writeBackupFile = (backup: JobPilotBackup) => {
    downloadTextFile(`jobpilot-backup-${exportStamp()}.json`, JSON.stringify(backup, null, 2), "application/json");
    setSystemMessage("[BACKUP EXPORTED]");
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
        setSystemMessage("[BACKUP LOCAL ONLY]");
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
        setSystemMessage(isApiEnabled ? "[BACKUP RESTORED]" : "[BACKUP RESTORED LOCAL]");
      } catch {
        setSystemMessage("[BACKUP IMPORT FAILED]");
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
    setSystemMessage("[ANSWER CARDS EXPORTED]");
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
        `- 关联岗位：${session.opportunityId ?? "未关联"}`,
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
    setSystemMessage("[REVIEWS EXPORTED]");
  };

  const addWeeklyTask = () => {
    const newTask: WeeklyTask = {
      id: makeId("WT"),
      title: "新增训练或杂项动作",
      detail: "适合放练笔试、练英语、补材料等不属于具体岗位或面试的问题。",
      source: "manual",
      sourceLabel: "训练计划",
      level: "P2",
      status: "open",
    };
    setWeeklyPlan((plan) => ({ ...plan, tasks: [newTask, ...plan.tasks] }));
    invalidateApiInsights();
    syncCreatedWeeklyTask(newTask);
    setSystemMessage("[WEEKLY TASK ADDED]");
  };

  const updateWeeklyTask = (id: string, field: keyof Pick<WeeklyTask, "title" | "detail" | "status" | "level">, value: string) => {
    const patch = { [field]: value } as Partial<WeeklyTask>;
    const currentTask = weeklyPlan.tasks.find((task) => task.id === id);
    setWeeklyPlan((plan) => ({
      ...plan,
      tasks: plan.tasks.map((task) => (task.id === id ? { ...task, [field]: value } : task)),
    }));
    invalidateApiInsights();
    syncUpdatedWeeklyTask(id, patch);
    if (field === "status" && currentTask?.source === "answer" && currentTask.relatedEntityId) {
      updateAnswerPracticeState(
        currentTask.relatedEntityId,
        value === "done" ? { practiceStatus: "可复用", status: "ACTIVE" } : { practiceStatus: "练习中", status: "NEEDS PRACTICE" },
      );
    }
  };

  const deleteWeeklyTask = (id: string) => {
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => task.id !== id) }));
    invalidateApiInsights();
    syncDeletedWeeklyTask(id);
    setSystemMessage("[WEEKLY TASK DELETED]");
  };

  const addWeeklyFocus = (field: keyof Pick<WeeklyPlan, "focusDirections" | "focusCities" | "focusCompanies" | "practiceThemes">, value: string) => {
    if (!value.trim()) return;
    const nextValues = [...weeklyPlan[field], value.trim()];
    setWeeklyPlan((plan) => ({ ...plan, [field]: [...plan[field], value.trim()] }));
    syncWeeklyPlanPatch({ [field]: nextValues });
    setSystemMessage("[WEEKLY FOCUS ADDED]");
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
    setSystemMessage("[WEEKLY TASK CONNECTED]");
  };

  const addSelectedAnswerToPractice = () => {
    const existingTask = weeklyPlan.tasks.find((task) => task.source === "answer" && task.relatedEntityId === selectedAnswer.id && task.status === "open");
    if (existingTask) {
      goTo("weekly");
      setSystemMessage("[PRACTICE TASK OPEN]");
      return;
    }

    createWeeklyTask({
      title: `练习答案：${selectedAnswer.question}`,
      detail: `来自答案库，按「${selectedAnswer.framework}」练到可以自然复述。`,
      source: "answer",
      sourceLabel: "答案库",
      relatedEntityId: selectedAnswer.id,
      level: selectedAnswer.status === "NEEDS PRACTICE" ? "P1" : "P2",
    });
    updateAnswerPracticeState(selectedAnswer.id, { practiceStatus: "练习中", status: "NEEDS PRACTICE" });
    setPage("weekly");
  };

  const updateWeeklyTargetApplications = (targetApplications: number) => {
    const nextTarget = targetApplications || 1;
    setWeeklyPlan((plan) => ({ ...plan, targetApplications: nextTarget }));
    invalidateApiInsights();
    syncWeeklyPlanPatch({ targetApplications: nextTarget });
  };

  const promoteFocusToTask = (label: string, value: string) => {
    createWeeklyTask({
      title: `推进${value}`,
      detail: `由训练计划的「${label}」生成，今天可以拆成一个具体动作。`,
      source: "weekly-focus",
      sourceLabel: "训练计划",
      level: "P2",
    });
  };

  const createOpportunityDirect = () => {
    if (!composerDraft.company.trim() || !composerDraft.title.trim() || !composerDraft.sourceText.trim()) {
      setSystemMessage("[COMPLETE COMPANY / TITLE / JD]");
      return;
    }

    const now = formatNow();
    const dueDate = composerDraft.dueDate || inferDueDateFromText(composerDraft.deadline);
    const action = computeOpportunityAction({
      status: "TO APPLY",
      deadline: composerDraft.deadline,
      dueDate,
      match: composerDraft.match,
      priority: composerDraft.priority,
    });
    const sourceKind: SourceAsset["kind"] =
      composerSource.sourceKind === "screenshot" ? "screenshot" : composerSource.sourceKind === "job-link" ? "job-link" : "jd-text";
    const nextOpportunity: Opportunity = {
      id: makeId("OP"),
      title: composerDraft.title.trim(),
      company: composerDraft.company.trim(),
      status: "TO APPLY",
      priority: composerDraft.priority,
      match: composerDraft.match,
      action,
      city: composerDraft.city.trim() || "待定",
      deadline: composerDraft.deadline.trim() || "待定",
      dueDate,
      resumeId: composerDraft.resumeId || resumeList[0]?.id || "",
      nextAction: composerDraft.nextAction.trim() || "补齐材料后投递",
      jdSummary: composerSource.note || "由岗位管理内上传材料解析生成的岗位记录。",
      jdText: composerDraft.sourceText.trim(),
      sourceAssets: [
        {
          id: makeId("SRC"),
          kind: sourceKind,
          title: composerSource.fileName || composerDraft.sourceLabel || "岗位 JD",
          detail: composerSource.note || "模块内上传后自动解析并写入岗位管理",
          createdAt: now,
          content: composerDraft.sourceText.trim(),
          storageUri: composerSource.storageUri,
        },
      ],
      timeline: [
        { id: makeId("TL"), occurredAt: now, title: "写入岗位管理", detail: "必填信息满足后直接生成正式岗位记录", status: "done" },
        { id: makeId("TL"), occurredAt: "Next", title: composerDraft.nextAction.trim() || "补齐材料后投递", detail: "由当前岗位进度生成下一步动作", status: "next" },
      ],
    };

    setOpportunities((items) => [nextOpportunity, ...items]);
    setSelectedOpportunityId(nextOpportunity.id);
    syncCreatedOpportunity(nextOpportunity);
    setComposer(null);
    setPage("opportunityDetail");
    setSystemMessage("[OPPORTUNITY CREATED]");
  };

  const createInterviewDirect = () => {
    if (!composerDraft.company.trim() || !composerDraft.role.trim() || !composerDraft.round.trim()) {
      setSystemMessage("[COMPLETE COMPANY / ROLE / ROUND]");
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
        detail: composerSource.note || (isAudio ? "原录音，系统会先转写再拆分 QA" : "原始文字稿，系统会拆分 QA"),
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

    const parsedQaPairs = composerParsedQaPairs.length ? composerParsedQaPairs : hasUsableTranscript ? parseTranscriptQaPairs(sourceText) : [];
    const qaPairs: QaPair[] = parsedQaPairs.length
      ? parsedQaPairs.map((pair) => ({
          id: makeId("QA"),
          ...pair,
        }))
      : [
      {
        id: makeId("QA"),
        question: hasUsableTranscript ? "待从文字稿中确认的面试问题" : "等待转写或粘贴面试文字稿",
        originalAnswer: hasUsableTranscript ? sourceText : "当前没有可用文字稿；请上传 txt/md 文字稿、粘贴转写内容，或开启录音转写 Assist 后重新解析。",
        type: "PROJECT",
        score: 2,
        critique: hasUsableTranscript ? "已有文字稿，但未识别出清晰 Q/A 结构；建议按“问题/回答”格式整理后重新解析。" : "缺少真实文字稿，无法生成有效复盘。",
        weak: true,
        framework: "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
        optimizedAnswer: hasUsableTranscript ? "把文字稿整理成“面试官：问题 / 我：回答”的格式后，系统会更稳定地拆分 QA。" : "先获得真实文字稿，再生成优化回答。",
      },
    ];

    const nextSession: InterviewSession = {
      id: makeId("INT"),
      opportunityId: composerDraft.linkedOpportunityId || undefined,
      company: composerDraft.company.trim(),
      role: composerDraft.role.trim(),
      round: composerDraft.round.trim(),
      date: composerDraft.date.trim() || "Today",
      sourceFiles,
      qaPairs,
    };

    setInterviewSessions((sessions) => [nextSession, ...sessions]);
    setSelectedInterviewId(nextSession.id);
    setSelectedQaId(nextSession.qaPairs[0]?.id ?? "");
    syncCreatedInterviewSession(nextSession);
    if (nextSession.opportunityId) {
      applyOpportunityProgress(nextSession.opportunityId, "INTERVIEWING", "system", "新增" + nextSession.round + "面试复盘后自动推进");
    }
    setComposer(null);
    setPage("interviews");
    setSystemMessage("[INTERVIEW CREATED]");
  };

  const createResumeDirect = () => {
    if (!composerDraft.title.trim() || !composerDraft.fileName.trim()) {
      setSystemMessage("[COMPLETE RESUME NAME / FILE]");
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
    setSystemMessage("[RESUME CREATED]");
  };

  const createAnswerDirect = () => {
    if (!composerDraft.question.trim()) {
      setSystemMessage("[COMPLETE QUESTION]");
      return;
    }

    const newCard: AnswerCard = {
      id: makeId("AC"),
      question: composerDraft.question.trim(),
      type: "MANUAL",
      status: "DRAFT",
      source: "手动创建",
      framework: composerDraft.framework.trim() || "背景 -> 动作 -> 结果 -> 复盘",
      answer: composerDraft.answer.trim() || "在这里补充可复用回答。",
      relatedRoles: composerDraft.relatedRoles.trim() || "待填写",
      practiceStatus: "未练习",
    };

    setAnswerCards((cards) => [newCard, ...cards]);
    setSelectedAnswerId(newCard.id);
    syncCreatedAnswerCard(newCard);
    setComposer(null);
    setPage("answers");
    setSystemMessage("[ANSWER CREATED]");
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
    const alreadySubmitted = submittedStatuses.includes(targetOpportunity.status);
    const now = formatNow();
    const nextAction = opportunityStatusNextAction[status];
    const nextComputedAction = computeOpportunityAction({ ...targetOpportunity, status });
    const timelineEvent = {
      id: makeId("TL"),
      occurredAt: now,
      title: source === "system" ? `系统推进到${statusLabel[status]}` : `手动更新为${statusLabel[status]}`,
      detail: detailOverride || (source === "system" ? "系统根据模块关联信息自动更新岗位进度" : "用户手动覆盖当前岗位阶段"),
      status: "done" as const,
    };
    const buildLocalOpportunity = (opportunity: Opportunity): Opportunity => ({
      ...opportunity,
      status,
      action: computeOpportunityAction({ ...opportunity, status }),
      nextAction,
      timeline: [
        ...opportunity.timeline.filter((event) => event.status !== "next"),
        timelineEvent,
        ...(status !== "OFFER"
          ? [
              {
                id: makeId("TL"),
                occurredAt: "Next",
                title: nextAction,
                detail: "由当前岗位进度生成下一步动作",
                status: "next" as const,
              },
            ]
          : []),
      ],
    });
    const applyProgressSideEffects = (opportunity: Opportunity, createLocalFollowupTask = true) => {
      if (submittedStatuses.includes(status)) {
        setResumeList((items) =>
          items.map((resume) =>
            resume.id === opportunity.resumeId && !resume.linkedOpportunityIds.includes(opportunity.id)
              ? { ...resume, linkedOpportunityIds: [...resume.linkedOpportunityIds, opportunity.id] }
              : resume,
          ),
        );
      }

      if (createLocalFollowupTask && status === "APPLIED" && !alreadySubmitted) {
        createWeeklyTask({
          title: `跟进${opportunity.company}${opportunity.title}`,
          detail: "投递后自动生成的跟进动作，避免投完就丢。",
          source: "opportunity",
          sourceLabel: "岗位管理",
          relatedEntityId: opportunity.id,
          level: "P1",
        });
      }
    };
    const applyLocalProgress = () => {
      const nextOpportunity = buildLocalOpportunity(targetOpportunity);
      setOpportunities((items) => items.map((item) => (item.id === opportunityId ? nextOpportunity : item)));
      applyProgressSideEffects(nextOpportunity);
      setSystemMessage(`[STATUS: ${status}]`);
    };

    if (isApiEnabled && apiOpportunityIdsRef.current.has(opportunityId)) {
      setSystemMessage("[STATUS SYNCING]");
      void progressOpportunityApi(opportunityId, {
        status,
        action: nextComputedAction,
        nextAction,
        timelineEvent,
      })
        .then((savedOpportunity) => {
          setOpportunities((items) => items.map((item) => (item.id === opportunityId ? savedOpportunity : item)));
          applyProgressSideEffects(savedOpportunity, false);
          refreshApiWeeklyPlan();
          refreshApiInsights();
          setSystemMessage(`[STATUS: ${status}]`);
        })
        .catch(() => {
          applyLocalProgress();
          setSystemMessage("[OPPORTUNITY LOCAL ONLY]");
        });
      return;
    }

    applyLocalProgress();
  };

  const markOpportunityApplied = () => {
    if (!selectedOpportunity) return;
    applyOpportunityProgress(selectedOpportunity.id, "APPLIED", "manual", `使用 ${getResumeName(selectedOpportunity.resumeId)} 完成投递`);
  };

  const openTodayAction = (action: TodayAction) => {
    if (action.filter) setFilter(action.filter);
    if (action.page === "opportunityDetail") {
      const targetOpportunityId = action.targetId || opportunities.find((item) => computeOpportunityAction(item) === "P0")?.id || opportunities[0]?.id;
      if (targetOpportunityId) openOpportunity(targetOpportunityId);
    } else if (action.page === "interviews" && action.targetId) {
      selectInterview(action.targetId);
      goTo("interviews");
    } else if (action.page === "answers" && action.targetId) {
      setSelectedAnswerId(action.targetId);
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
      setSystemMessage("[TODAY TASK DONE]");
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
      setSystemMessage("[INTERVIEW REVIEW DONE]");
      return;
    }

    if (action.source === "answer" && action.targetId) {
      updateAnswerPracticeState(action.targetId, { practiceStatus: "可复用", status: "ACTIVE" });
      setApiTodayActions(null);
      setSystemMessage("[ANSWER PRACTICE DONE]");
      return;
    }

    setDismissedTodayIds((ids) => new Set(ids).add(todayActionKey(action)));
    setSystemMessage("[TODAY ITEM DISMISSED]");
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
      setSelectedAnswerId(existingCard.id);
      setPage("answers");
      setSystemMessage("[ANSWER CARD OPENED]");
      return;
    }

    const createLocalAnswerCard = () => {
      const newCard: AnswerCard = {
        id: makeId("AC"),
        question: selectedQa.question,
        type: selectedQa.type,
        status: selectedQa.weak ? "NEEDS PRACTICE" : "DRAFT",
        source: "面试复盘",
        sourceQaPairId: selectedQa.id,
        framework: selectedQa.framework,
        answer: selectedQa.optimizedAnswer,
        relatedRoles: selectedInterview.role,
        practiceStatus: selectedQa.weak ? "练习中" : "未练习",
      };
      setAnswerCards((cards) => [newCard, ...cards]);
      setSelectedAnswerId(newCard.id);
      syncCreatedAnswerCard(newCard);
      setPage("answers");
      setSystemMessage("[ANSWER CARD CREATED]");
    };

    if (isApiEnabled) {
      setSystemMessage("[ANSWER CARD SYNCING]");
      void createAnswerCardFromQaPairApi(selectedQa.id)
        .then((savedCard) => {
          setAnswerCards((cards) =>
            cards.some((card) => card.id === savedCard.id || card.sourceQaPairId === savedCard.sourceQaPairId)
              ? cards.map((card) => (card.id === savedCard.id || card.sourceQaPairId === savedCard.sourceQaPairId ? savedCard : card))
              : [savedCard, ...cards],
          );
          setSelectedAnswerId(savedCard.id);
          setPage("answers");
          setSystemMessage("[ANSWER CARD CREATED]");
        })
        .catch(() => {
          createLocalAnswerCard();
          setSystemMessage("[ANSWER LOCAL ONLY]");
        });
      return;
    }

    createLocalAnswerCard();
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
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = page === item.id || (page === "opportunityDetail" && item.id === "opportunities");
            return (
              <button key={item.id} className={`nav-item ${active ? "active" : ""}`} onClick={() => goTo(item.id)}>
                <Icon size={18} />
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <ApiModeBadge apiMode={apiMode} onRefresh={refreshApiHealth} />
          <div className="sidebar-footer-meta">
            <div className="system-readout">
              <span>LOCAL DATA</span>
              <strong>{systemMessage}</strong>
            </div>
            <button className="icon-button" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setInterviewPage(0);
                }}
                placeholder={topSearchPlaceholder(page)}
              />
            </div>
          </header>
        ) : null}

        {page === "home" && (
          <section className="home-stack">
            <section className="flow-pipeline" aria-label="产品主链路">
              <div className="flow-pipeline-intro">
                <span className="eyebrow">主链路</span>
                <p>在对应模块里创建正式记录，系统再收束到今日待办。</p>
              </div>
              <ol className="flow-pipeline-steps">
                {flowPipelineSteps.map((step, index) => (
                  <li key={step.title} className="flow-step">
                    <span className="flow-step-index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="flow-step-copy">
                      <strong>{step.title}</strong>
                      <span>{step.hint}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="home-main">
              <div className="today-panel surface">
                <div className="eyebrow">今日待办</div>
                <div className="today-heading">
                  <div>
                    <h1>今天先处理这几件事</h1>
                    <p>系统从岗位、面试、答案库和训练计划里收束出今天要执行的动作。</p>
                  </div>
                  <div className="hero-number small">{todayActions.length}</div>
                </div>
                <div className="hero-actions">
                  <button className="primary-button" onClick={() => openComposer("opportunity")}>
                    <BriefcaseBusiness size={16} />
                    <span>新增岗位</span>
                  </button>
                  <button className="secondary-button" onClick={() => goTo("opportunities")}>
                    <BriefcaseBusiness size={16} />
                    <span>查看岗位</span>
                  </button>
                </div>
                <div className="action-list attached">
                  {todayActions.map((action) => (
                    <div className="action-row" key={todayActionKey(action)}>
                      <button className="action-row-main" onClick={() => openTodayAction(action)}>
                        <span className={`priority ${action.level.toLowerCase()}`}>{action.level}</span>
                        <span className="action-copy">
                          <strong>
                            <em className="source-chip">{todayActionSourceLabel(action)}</em>
                            {action.title}
                          </strong>
                          <small>{action.detail}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                      <button className="secondary-button compact-button action-complete-button" onClick={() => completeTodayAction(action)}>
                        完成
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="home-side">
                <div className="instrument-panel compact-metrics">
                  <button className="metric" onClick={() => goTo("opportunities")}>
                    <span>正式岗位</span>
                    <strong className="success">{opportunities.length}</strong>
                    <small>待投递 {toApplyCount} · 进行中 {inProgressCount}</small>
                  </button>
                  <button
                    className="metric"
                    onClick={() => {
                      setFilter("P0");
                      goTo("opportunities");
                    }}
                  >
                    <span>高优先级岗位</span>
                    <strong className="accent">{urgentCount}</strong>
                    <small>P0 {p0Count} · P1 {p1Count}</small>
                  </button>
                  <button className="metric" onClick={() => goTo("interviews")}>
                    <span>薄弱回答</span>
                    <strong className="warning">{pendingReviewCount}</strong>
                    <small>来自 {weakInterviewCount} 场面试</small>
                  </button>
                </div>

                <div className="surface todo-rule-card">
                  <SectionTitle label="待办规则" title="每条任务从哪里来" action="SOURCE MAP" />
                  <div className="todo-rule-list">
                    <button onClick={() => goTo("opportunities")}>
                      <span className="source-chip">岗位</span>
                      <strong>JD 和进度在岗位管理维护</strong>
                      <small>P 级由状态、截止日期、匹配度和主观优先级综合计算。</small>
                    </button>
                    <button onClick={() => goTo("interviews")}>
                      <span className="source-chip">面试</span>
                      <strong>weak QA 自动进入复盘待办</strong>
                      <small>点完成会把该场薄弱问题标为已处理。</small>
                    </button>
                    <button onClick={() => goTo("weekly")}>
                      <span className="source-chip">训练</span>
                      <strong>泛任务和练习在训练计划维护</strong>
                      <small>手动设置 P0-P3；关联任务会跳回岗位、面试或答案库。</small>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="surface weekly-strip weekly-strip-button"
                  onClick={() => goTo("weekly")}
                >
                  <SectionTitle label="训练计划" title="投递目标" action={`${submittedApplications}/${weeklyPlan.targetApplications}`} />
                  <SegmentedProgress value={(submittedApplications / weeklyPlan.targetApplications) * 100} segments={12} />
                  <div className="stat-rows">
                    <StatRow label="已投递" value={submittedApplications} />
                    <StatRow label="本周目标" value={weeklyPlan.targetApplications} />
                    <StatRow label="还差" value={applicationGap > 0 ? `${applicationGap} 个` : "已达标"} />
                    <StatRow label="本周面试" value="2" />
                  </div>
                </button>
              </aside>
            </section>
          </section>
        )}

        {page === "opportunities" && (
          <section className="surface table-page">
            <PageIntro
              label="岗位管理"
              title="你正在跟进的岗位"
              detail="按优先级、匹配度和截止时间安排下一步：投递、准备或跟进。"
              action={`${filteredOpportunities.length} ACTIVE`}
            />
            <div className="toolbar-row">
              <div className="filter-bar">
                {["ALL", "P0", "P1", "A PRIORITY", "HIGH MATCH", "DUE SOON"].map((item) => (
                  <button key={item} className={filter === item ? "active-filter" : ""} onClick={() => setFilter(item)}>
                    {item}
                  </button>
                ))}
              </div>
              <div className="view-toggle">
                <button className="primary-chip" onClick={() => openComposer("opportunity")}>
                  <Plus size={14} />
                  新增岗位 / 上传 JD
                </button>
                <button className={viewMode === "table" ? "active-filter" : ""} onClick={() => setViewMode("table")}>
                  <FileText size={14} />
                  表格
                </button>
                <button className={viewMode === "board" ? "active-filter" : ""} onClick={() => setViewMode("board")}>
                  <KanbanSquare size={14} />
                  看板
                </button>
              </div>
            </div>

            {viewMode === "table" ? (
              <div className="opportunity-table">
                <div className="table-head">
                  <span>岗位</span>
                  <span>状态</span>
                  <span>优先级</span>
                  <span>截止</span>
                  <span>下一步动作</span>
                </div>
                {filteredOpportunities.map((item) => (
                  <button className="table-row table-button" key={item.id} onClick={() => openOpportunity(item.id)}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.company} / {item.city} / {getResumeName(item.resumeId)}</small>
                    </span>
                    <StatusPill status={item.status} />
                    <span className="signal-stack">
                      <b className={`priority ${computeOpportunityAction(item).toLowerCase()}`}>{computeOpportunityAction(item)}</b>
                      <small>{item.priority} / {item.match}</small>
                    </span>
                    <span className="mono">{item.deadline}</span>
                    <span>{item.nextAction}</span>
                  </button>
                ))}
              </div>
            ) : (
              <BoardView opportunities={filteredOpportunities} openOpportunity={openOpportunity} />
            )}
          </section>
        )}

        {page === "opportunityDetail" && (
          <section className="split-page">
            <div className="surface">
              <button className="ghost-button back-button" onClick={() => goTo("opportunities")}>
                <ChevronLeft size={16} />
                <span>返回岗位管理</span>
              </button>
              <PageIntro
                label={selectedOpportunity.id}
                title={selectedOpportunity.title}
                detail="岗位详情把投递状态、使用的简历、下一步动作和时间线串在一起。后续面试、复盘和答案卡也会挂到这个岗位下。"
                action={selectedOpportunityAction}
              />
              <div className="source-panel">
                <SectionTitle label="原材料与 JD" title="投递依据都留在这里" action={`${selectedOpportunity.sourceAssets.length} FILES`} />
                <div className="source-list">
                  {selectedOpportunity.sourceAssets.map((asset) => (
                    <button className="source-item source-button" key={asset.id} onClick={() => setPreviewAsset(asset)}>
                      <div>
                        <span>{sourceKindLabel[asset.kind]}</span>
                        <strong>{asset.title}</strong>
                        <small>{asset.detail}</small>
                      </div>
                      <em>{asset.createdAt}</em>
                    </button>
                  ))}
                </div>
                <div className="jd-brief">
                  <span>JD 摘要</span>
                  <textarea value={selectedOpportunity.jdSummary} onChange={(event) => updateSelectedOpportunity({ jdSummary: event.target.value })} />
                  <span>JD 原文</span>
                  <textarea value={selectedOpportunity.jdText} onChange={(event) => updateSelectedOpportunity({ jdText: event.target.value })} />
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
                  <span>今日动作级别</span>
                  <input readOnly value={`${selectedOpportunityAction}（由状态、截止日期、匹配度和主观优先级计算）`} />
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
                  <span>截止说明</span>
                  <input value={selectedOpportunity.deadline} onChange={(event) => updateSelectedOpportunity({ deadline: event.target.value })} />
                </label>
                <label>
                  <span>截止日期</span>
                  <input
                    type="date"
                    value={getOpportunityDueDate(selectedOpportunity)}
                    onChange={(event) => updateSelectedOpportunity({ dueDate: event.target.value })}
                  />
                </label>
                <label className="wide-field">
                  <span>下一步</span>
                  <input value={selectedOpportunity.nextAction} onChange={(event) => updateSelectedOpportunity({ nextAction: event.target.value })} />
                </label>
              </div>
              <div className="button-row">
                <button className="primary-button" onClick={markOpportunityApplied}>标记已投递</button>
                <button className="secondary-button" onClick={() => openComposer("interview", selectedOpportunity.id)}>添加面试</button>
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
            <div className="surface">
              <SectionTitle label="岗位进度" title="这条机会走到哪一步" action={statusLabel[selectedOpportunity.status]} />
              <OpportunityPipelineView stages={selectedOpportunityPipeline} />
              <div className="progress-controls">
                <span>手动覆盖进度</span>
                <div>
                  {opportunityStatusFlow.map((status) => (
                    <button
                      key={status}
                      className={selectedOpportunity.status === status ? "active-filter" : ""}
                      onClick={() => applyOpportunityProgress(selectedOpportunity.id, status, "manual")}
                    >
                      {statusLabel[status]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="timeline-log">
                <SectionTitle label="系统日志" title="系统和手动操作记录" action={`${selectedOpportunity.timeline.filter((item) => item.status === "done").length} DONE`} />
                <div className="timeline timeline-real">
                  {selectedOpportunity.timeline.map((event) => (
                    <div className={`timeline-row ${event.status}`} key={event.id}>
                      <span>{event.occurredAt}</span>
                      <div>
                        <strong>{event.title}</strong>
                        <small>{event.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {page === "interviews" && (
          <section className="interview-page">
            <div className="surface interview-list-pane">
              <PageIntro
                label="面试复盘"
                title="按场次管理每次面试"
                detail="先选择一场面试，再点左侧问题。右侧会显示该问题的原回答、评价、推荐框架和具体回答表述，并且都可以编辑。"
                action={`${interviewSessions.length} SESSIONS`}
              />

              <div className="button-row tight-row">
                <button className="primary-button" onClick={() => openComposer("interview")}>
                  <Upload size={16} />
                  <span>上传录音 / 文字稿</span>
                </button>
              </div>

              <div className="interview-tabs">
                {visibleInterviewSessions.map((session) => (
                  <button key={session.id} className={session.id === selectedInterview.id ? "active-session" : ""} onClick={() => selectInterview(session.id)}>
                    <strong>{session.company} / {session.round}</strong>
                    <small>{session.role} · {session.date}</small>
                  </button>
                ))}
              </div>

              <div className="pager-row">
                <button className="ghost-button compact-button" disabled={interviewPage === 0} onClick={() => setInterviewPage((pageIndex) => Math.max(0, pageIndex - 1))}>
                  上一页
                </button>
                <span>{interviewPage + 1} / {interviewPageCount}</span>
                <button className="ghost-button compact-button" disabled={interviewPage >= interviewPageCount - 1} onClick={() => setInterviewPage((pageIndex) => Math.min(interviewPageCount - 1, pageIndex + 1))}>
                  下一页
                </button>
              </div>

              <div className="interview-toolbar">
                <span>{selectedInterview.qaPairs.length} 个问题</span>
                <div className="mini-actions">
                  <button className="secondary-button compact-button" onClick={addQaPair}>
                    <Plus size={14} />
                    <span>添加问题</span>
                  </button>
                </div>
              </div>

              <div className="qa-list">
                {selectedInterview.qaPairs.map((pair) => (
                  <button className={`qa-card qa-card-button ${pair.weak ? "weak" : ""} ${pair.id === selectedQa.id ? "selected-qa" : ""}`} key={pair.id} onClick={() => setSelectedQaId(pair.id)}>
                    <div>
                      <span className="type-pill">{pair.type}</span>
                      <h3>{pair.question}</h3>
                      <p>{pair.critique}</p>
                    </div>
                    <div className="score">{pair.score}/5</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="surface review-editor">
              <SectionTitle label={`${selectedInterview.company} / ${selectedInterview.round}`} title={selectedQa.question} action={selectedQa.weak ? "需练习" : "可复用"} />

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
                <label className="wide-field">
                  <span>关联岗位</span>
                  <select
                    value={selectedInterview.opportunityId ?? ""}
                    onChange={(event) => updateSelectedInterview({ opportunityId: event.target.value || undefined })}
                  >
                    <option value="">未关联岗位</option>
                    {opportunities.map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>
                        {opportunity.company} / {opportunity.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="source-panel compact-source">
                <SectionTitle label="原始材料" title="对应这场面试的文件" action={`${selectedInterview.sourceFiles?.length ?? 0} FILES`} />
                <div className="button-row source-panel-actions">
                  <button className="secondary-button compact-button" disabled={interviewReparseBusy} onClick={requestReparseSelectedInterview}>
                    <RotateCcw size={14} />
                    <span>{interviewReparseBusy ? "解析中..." : "重新解析问题"}</span>
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

              <ReviewBlock label="记录原问题" value={selectedQa.question} readOnly />
              <ReviewBlock
                label="记录原回答"
                value={selectedQa.originalAnswer}
                onChange={(value) => updateSelectedQa("originalAnswer", value)}
              />
              <ReviewBlock
                label="评价"
                value={selectedQa.critique}
                onChange={(value) => updateSelectedQa("critique", value)}
              />
              <ReviewBlock
                label="推荐回答框架"
                value={selectedQa.framework}
                onChange={(value) => updateSelectedQa("framework", value)}
              />
              <ReviewBlock
                label="具体回答表述"
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
                <div className="mini-actions">
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
              </div>
            </div>
          </section>
        )}

        {page === "answers" && (
          <section className="answer-workspace">
            <div className="surface answer-list-pane">
              <PageIntro
                label="答案库"
                title="可复用回答和手动准备都在这里"
                detail="答案卡可以来自面试复盘，也可以手动创建。这里不再用“使用次数”做主要指标，而是看来源、适用岗位和练习状态。"
                action={`${answerCards.length} CARDS`}
              />
              <div className="button-row tight-row">
                <button className="primary-button" onClick={() => openComposer("answer")}>
                  <Plus size={16} />
                  <span>新增答案卡</span>
                </button>
                <button className="secondary-button" onClick={() => goTo("interviews")}>
                  <FileAudio size={16} />
                  <span>从复盘生成</span>
                </button>
              </div>
              <div className="answer-list">
                {filteredAnswerCards.length === 0 ? (
                  <p className="empty-list-note">没有匹配的答案卡，试试换个关键词。</p>
                ) : (
                  filteredAnswerCards.map((card) => (
                    <button
                      className={`answer-card answer-card-button ${selectedAnswer.id === card.id ? "selected-answer" : ""}`}
                      key={card.id}
                      onClick={() => setSelectedAnswerId(card.id)}
                    >
                      <span className="type-pill">{card.type}</span>
                      <h3>{card.question}</h3>
                      <small>{card.source} / {card.practiceStatus}</small>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="surface answer-editor">
              <SectionTitle label={selectedAnswer.source} title={selectedAnswer.question} action={selectedAnswer.status} />
              <ReviewBlock label="问题" value={selectedAnswer.question} onChange={(value) => updateSelectedAnswer("question", value)} />
              <ReviewBlock label="回答框架" value={selectedAnswer.framework} onChange={(value) => updateSelectedAnswer("framework", value)} />
              <ReviewBlock label="推荐回答" value={selectedAnswer.answer} onChange={(value) => updateSelectedAnswer("answer", value)} />
              <ReviewBlock label="适用岗位" value={selectedAnswer.relatedRoles} onChange={(value) => updateSelectedAnswer("relatedRoles", value)} />
              <div className="inline-controls">
                <label>
                  <span>状态</span>
                  <select value={selectedAnswer.status} onChange={(event) => updateSelectedAnswer("status", event.target.value)}>
                    <option>DRAFT</option>
                    <option>ACTIVE</option>
                    <option>NEEDS PRACTICE</option>
                  </select>
                </label>
                <label>
                  <span>练习状态</span>
                  <select value={selectedAnswer.practiceStatus} onChange={(event) => updateSelectedAnswer("practiceStatus", event.target.value)}>
                    <option>未练习</option>
                    <option>练习中</option>
                    <option>可复用</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button className="secondary-button" onClick={addSelectedAnswerToPractice}>
                  <ClipboardList size={16} />
                  <span>加入训练计划</span>
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
          </section>
        )}

        {page === "resumes" && (
          <section className="resume-workspace">
            <div className="surface resume-list-pane">
              <PageIntro
                label="简历版本"
                title="管理你上传的几份不同简历文件"
                detail="这里存的是简历文件本身和它的定位。某个岗位实际用了哪版简历，会在岗位详情里作为投递记录出现。"
                action={`${resumeList.length} FILES`}
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
                    onClick={() => setSelectedResumeId(resume.id)}
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
              <SectionTitle label={selectedResume.id} title={selectedResume.name} action={selectedResume.fileType} />
              <div className="file-preview">
                <FileText size={28} />
                <div>
                  <strong>{selectedResume.fileName}</strong>
                  <small>{selectedResume.fileSize} / uploaded {selectedResume.uploadedAt}</small>
                </div>
                <button className="secondary-button compact-button" onClick={() => openStoredFile(selectedResume.storageUri)}>预览文件</button>
              </div>
              <ReviewBlock label="版本名称" value={selectedResume.name} onChange={(value) => updateSelectedResume("name", value)} />
              <ReviewBlock label="适合方向" value={selectedResume.roles} onChange={(value) => updateSelectedResume("roles", value)} />
              <ReviewBlock label="核心卖点" value={selectedResume.points} onChange={(value) => updateSelectedResume("points", value)} />
              <ReviewBlock label="文件摘要" value={selectedResume.summary} onChange={(value) => updateSelectedResume("summary", value)} />
              <div className="linked-list">
                <span>已关联岗位</span>
                {linkedResumeOpportunities.length === 0 ? (
                  <small>暂未用于投递。使用关系会从岗位详情产生。</small>
                ) : (
                  linkedResumeOpportunities.map((opportunity) => {
                    return (
                      <button key={opportunity.id} onClick={() => openOpportunity(opportunity.id)}>
                        <strong>{opportunity.title}</strong>
                        <small>{opportunity.company}</small>
                      </button>
                    );
                  })
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
            <div className="surface weekly-editor">
              <PageIntro
                label="训练计划"
                title="目标方向 + 泛任务训练"
                detail="岗位相关请去「岗位管理」添加 JD 和状态；面试问题请在「面试复盘」加入练习。这里保留投递目标、重点方向，以及练笔试、练英语、补材料等泛任务。"
                action={`${weeklyPlan.tasks.filter((task) => task.status === "open").length} OPEN`}
              />
              <div className="weekly-linkage">
                <div>
                  <span>不要重复录入</span>
                  <strong>具体岗位从岗位管理进入；具体面试问题从面试复盘进入，系统会自动汇总到今日待办。</strong>
                </div>
                <div>
                  <span>适合放这里</span>
                  <strong>练笔试、练英语、补作品集、整理简历卖点，以及本周投递目标和重点方向。</strong>
                </div>
              </div>
              <div className="weekly-target-row">
                <label>
                  <span>系统统计已投递</span>
                  <input
                    type="number"
                    value={submittedApplications}
                    readOnly
                  />
                </label>
                <label>
                  <span>目标投递</span>
                  <input
                    type="number"
                    value={weeklyPlan.targetApplications}
                    onChange={(event) => updateWeeklyTargetApplications(Number(event.target.value))}
                  />
                </label>
              </div>
              <SegmentedProgress value={(submittedApplications / weeklyPlan.targetApplications) * 100} segments={12} />

              <WeeklyTagEditor label="重点方向" values={weeklyPlan.focusDirections} onAdd={(value) => addWeeklyFocus("focusDirections", value)} onUse={promoteFocusToTask} />
              <WeeklyTagEditor label="重点城市" values={weeklyPlan.focusCities} onAdd={(value) => addWeeklyFocus("focusCities", value)} onUse={promoteFocusToTask} />
              <WeeklyTagEditor label="重点公司" values={weeklyPlan.focusCompanies} onAdd={(value) => addWeeklyFocus("focusCompanies", value)} onUse={promoteFocusToTask} />
              <WeeklyTagEditor label="练习主题" values={weeklyPlan.practiceThemes} onAdd={(value) => addWeeklyFocus("practiceThemes", value)} onUse={promoteFocusToTask} />
            </div>

            <div className="surface weekly-task-pane">
              <SectionTitle label="会进入今日待办" title="训练与杂项动作" action="CONNECTED" />
              <button className="primary-button" onClick={addWeeklyTask}>
                <Plus size={16} />
                <span>添加训练 / 杂项动作</span>
              </button>
              <div className="weekly-task-list">
                {weeklyPlan.tasks.map((task) => (
                  <div className="weekly-task" key={task.id}>
                    <span>{task.sourceLabel}</span>
                    <small className="route-hint">{trainingTaskRouteLabel(task)}</small>
                    <label className="weekly-priority-field">
                      <span>今日优先级</span>
                      <select value={task.level ?? "P2"} onChange={(event) => updateWeeklyTask(task.id, "level", event.target.value)}>
                        <option value="P0">P0 - 今天必须处理</option>
                        <option value="P1">P1 - 优先推进</option>
                        <option value="P2">P2 - 正常练习</option>
                        <option value="P3">P3 - 低优先维护</option>
                      </select>
                    </label>
                    <input value={task.title} onChange={(event) => updateWeeklyTask(task.id, "title", event.target.value)} />
                    <textarea value={task.detail} onChange={(event) => updateWeeklyTask(task.id, "detail", event.target.value)} />
                    <button
                      className={task.status === "done" ? "secondary-button compact-button" : "primary-button compact-button"}
                      onClick={() => updateWeeklyTask(task.id, "status", task.status === "done" ? "open" : "done")}
                    >
                      {task.status === "done" ? "重新打开" : "标记完成"}
                    </button>
                    <button
                      className="destructive-button compact-button"
                      onClick={() =>
                        requestConfirm({
                          title: "删除这条训练动作？",
                          description: `「${task.title}」删除后不再出现在训练计划和今日待办。`,
                          confirmLabel: "删除动作",
                          onConfirm: () => deleteWeeklyTask(task.id),
                        })
                      }
                    >
                      删除动作
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {page === "exports" && (
          <section className="surface">
            <PageIntro
              label="设置导出"
              title="本地数据的备份和导出"
              detail="MVP 先保证数据和文件可带走；AI 配置先保存在本机浏览器，后续接真实解析服务时复用。"
              action={isPublicDemo ? "PUBLIC DEMO" : isApiEnabled ? "LOCAL API" : "LOCAL MOCK"}
            />
            <div className="settings-grid">
              <ExportAction icon={Archive} title="导出完整 JSON 备份" detail="包含数据和已保存的本地文件内容。" onClick={exportBackup} />
              <ExportAction icon={Upload} title="导入 JSON 备份" detail="从备份文件恢复；本地 API 模式会写回 SQLite。" onClick={importBackupFromFile} />
              <ExportAction icon={FileDown} title="导出答案卡" detail="下载 Markdown 复习材料。" onClick={exportAnswerCards} />
              <ExportAction icon={PanelRight} title="导出面试复盘" detail="下载 QA、批评点和优化答案。" onClick={exportInterviewReviews} />
            </div>
            <div className="settings-panel">
              <SectionTitle label="AI 设置" title="解析和转写配置" action={aiSettings.provider === "none" ? "MOCK" : aiSettings.provider.toUpperCase()} />
              <p>
                默认使用本地确定性解析；本地 API 可读取 txt/md/PDF/DOCX 文本。切到 Assist 后会调用配置的 AI 做截图 OCR、录音转写和结构化解析，失败会自动回退。API Key 只存在本机浏览器，不写入 SQLite，也不会出现在 JSON 备份里。截图 OCR 需要 OpenAI 或 Anthropic 视觉模型；DeepSeek chat API 不支持直接读图。
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
                  <span>模型名</span>
                  <input value={aiSettings.model} onChange={(event) => updateAiSettings({ model: event.target.value })} placeholder="例如 gpt-4.1 / claude-sonnet" />
                </label>
                <label>
                  <span>文字 / JD / 简历解析</span>
                  <select value={aiSettings.parseMode} onChange={(event) => updateAiSettings({ parseMode: event.target.value as AiSettings["parseMode"] })}>
                    <option value="mock">本地解析（txt/md/PDF/DOCX/文字稿规则）</option>
                    <option value="assist">Assist：OCR + AI 结构化解析/面试复盘</option>
                  </select>
                </label>
                <label>
                  <span>录音转写</span>
                  <select value={aiSettings.transcriptionMode} onChange={(event) => updateAiSettings({ transcriptionMode: event.target.value as AiSettings["transcriptionMode"] })}>
                    <option value="mock">继续使用本地模拟</option>
                    <option value="assist">Assist：调用转写 API</option>
                  </select>
                </label>
                <label className="wide-field">
                  <span>API Key（本机保存）</span>
                  <input
                    type="password"
                    value={aiSettings.apiKey}
                    onChange={(event) => updateAiSettings({ apiKey: event.target.value })}
                    placeholder="不会导出到备份；公开 demo 不需要填写"
                  />
                </label>
                <label className="wide-field">
                  <span>自定义 endpoint（可选）</span>
                  <input value={aiSettings.endpoint} onChange={(event) => updateAiSettings({ endpoint: event.target.value })} placeholder="DeepSeek: https://api.deepseek.com ｜ OpenAI: https://api.openai.com/v1" />
                </label>
                <label className="wide-field">
                  <span>配置备注</span>
                  <textarea value={aiSettings.notes} onChange={(event) => updateAiSettings({ notes: event.target.value })} placeholder="记录这个配置准备用来做什么，例如 JD OCR、面试转写、简历解析。" />
                </label>
              </div>
              <div className="button-row">
                <button className="primary-button" onClick={() => setSystemMessage("[AI SETTINGS SAVED]")}>
                  <Settings size={16} />
                  <span>保存 AI 设置</span>
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setAiSettings(defaultAiSettings);
                    setSystemMessage("[AI SETTINGS RESET]");
                  }}
                >
                  重置设置
                </button>
              </div>
            </div>
          </section>
        )}

        {composer && (
          <div className="asset-preview" role="dialog" aria-modal="true">
            <div className="asset-preview-panel module-composer-panel">
              <SectionTitle
                label={composerStep === "source" ? "步骤 1 / 2" : "步骤 2 / 2"}
                title={
                  composer === "opportunity"
                    ? "新增岗位 / 上传 JD"
                    : composer === "interview"
                      ? "新增面试复盘"
                      : composer === "resume"
                        ? "上传简历版本"
                        : "新增答案卡"
                }
                action={composerStep === "source" ? "SOURCE" : "PARSED"}
              />
              <p>
                {composerStep === "source"
                  ? "先选择原始文件，或直接粘贴文字内容。txt/md/PDF/DOCX 会优先提取文本；截图 OCR 和录音转写需要在设置里开启 Assist。"
                  : "系统已经生成字段草稿。你只需要检查自动解析结果，并补齐必填字段或可选备注，然后创建正式记录。"}
              </p>

              <div className="composer-steps">
                <span className={composerStep === "source" ? "active-step" : ""}>01 原始材料</span>
                <span className={composerStep === "review" ? "active-step" : ""}>02 解析与补齐</span>
              </div>

              {composerStep === "source" && composer !== "answer" && (
                <div className="composer-source-grid">
                  <label className="upload-dropzone">
                    <Upload size={22} />
                    <strong>{composerSource.fileName || "选择文件"}</strong>
                    <small>
                      {composer === "opportunity"
                        ? "支持 JD 截图/PDF/文本；PDF 文本本地提取，截图可用 Assist OCR。"
                        : composer === "interview"
                          ? "支持录音和 txt/md/docx 文字稿；录音可用 Assist 转写。"
                          : "支持 PDF / DOCX / 图片 / 文本；PDF/DOCX 本地提取，图片简历可用 Assist OCR。"}
                    </small>
                    <small>{uploadStatusLabel(composerSource)}</small>
                    {composerSource.extractionStatus && <small>{extractionStatusLabel(composerSource.extractionStatus)}</small>}
                    <input
                      type="file"
                      accept={
                        composer === "opportunity"
                          ? "image/*,.pdf,.txt,.md"
                          : composer === "interview"
                            ? "audio/*,.txt,.md,.docx"
                            : "image/*,.pdf,.txt,.md,.docx"
                      }
                      onChange={(event) => handleComposerFileSelected(event.target.files)}
                    />
                  </label>

                  <div className="source-side">
                    <label>
                      <span>材料类型</span>
                      <select value={composerSource.sourceKind} onChange={(event) => updateComposerSource("sourceKind", event.target.value)}>
                        {composer === "opportunity" && (
                          <>
                            <option value="jd-text">文字 JD / PDF</option>
                            <option value="screenshot">JD 截图</option>
                            <option value="job-link">招聘链接</option>
                          </>
                        )}
                        {composer === "interview" && (
                          <>
                            <option value="audio">面试录音</option>
                            <option value="transcript">文字稿</option>
                          </>
                        )}
                        {composer === "resume" && <option value="resume-file">简历文件</option>}
                      </select>
                    </label>
                    <label>
                      <span>备注（可选）</span>
                      <input value={composerSource.note} onChange={(event) => updateComposerSource("note", event.target.value)} placeholder="来源、轮次、重点方向等" />
                    </label>
                  </div>

                  <label className="wide-field source-text-input">
                    <span>
                      {composer === "opportunity"
                        ? "JD 文字内容（可选）"
                        : composer === "interview"
                          ? "面试文字稿 / 录音转写（可选）"
                          : "简历文字或补充说明（可选）"}
                    </span>
                    <textarea
                      value={composerSource.rawText}
                      onChange={(event) => updateComposerSource("rawText", event.target.value)}
                      placeholder={
                        composer === "opportunity"
                          ? "粘贴 JD 后可以立即生成岗位草稿；PDF/DOCX 会本地提取文字，截图需要开启 Assist OCR。"
                          : composer === "interview"
                            ? "粘贴录音转写或面试文字稿后可以拆分 QA；上传 txt/md/docx 也会尝试自动读取。"
                            : "粘贴简历摘要或正文后可以生成版本草稿；PDF/DOCX 会尝试自动读取，旧 .doc 请另存为 .docx。"
                      }
                    />
                  </label>
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
                      <span>截止说明</span>
                      <input
                        value={composerDraft.deadline}
                        onChange={(event) => {
                          updateComposerDraft("deadline", event.target.value);
                          updateComposerDraft("dueDate", inferDueDateFromText(event.target.value));
                        }}
                      />
                    </label>
                    <label>
                      <span>截止日期</span>
                      <input type="date" value={composerDraft.dueDate} onChange={(event) => updateComposerDraft("dueDate", event.target.value)} />
                    </label>
                    <label>
                      <span>主观优先级</span>
                      <select value={composerDraft.priority} onChange={(event) => updateComposerDraft("priority", event.target.value)}>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                      </select>
                    </label>
                    <label>
                      <span>匹配度</span>
                      <select value={composerDraft.match} onChange={(event) => updateComposerDraft("match", event.target.value)}>
                        <option value="HIGH">HIGH</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="LOW">LOW</option>
                      </select>
                    </label>
                    <label>
                      <span>今日动作级别</span>
                      <input readOnly value={computeOpportunityAction({ status: "TO APPLY", deadline: composerDraft.deadline, dueDate: composerDraft.dueDate, match: composerDraft.match, priority: composerDraft.priority })} />
                    </label>
                    <label>
                      <span>投递简历</span>
                      <select value={composerDraft.resumeId} onChange={(event) => updateComposerDraft("resumeId", event.target.value)}>
                        {resumeList.map((resume) => (
                          <option value={resume.id} key={resume.id}>{resume.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      <span>来源 / 备注</span>
                      <input value={composerDraft.sourceLabel} onChange={(event) => updateComposerDraft("sourceLabel", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>下一步动作</span>
                      <input value={composerDraft.nextAction} onChange={(event) => updateComposerDraft("nextAction", event.target.value)} />
                    </label>
                    <label className="wide-field">
                      <span>JD 原文 *</span>
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
                    <label className="wide-field">
                      <span>关联岗位</span>
                      <select value={composerDraft.linkedOpportunityId} onChange={(event) => updateComposerDraft("linkedOpportunityId", event.target.value)}>
                        <option value="">暂不关联</option>
                        {opportunities.map((opportunity) => (
                          <option value={opportunity.id} key={opportunity.id}>{opportunity.company} / {opportunity.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      <span>原文件名</span>
                      <input value={composerDraft.fileName} onChange={(event) => updateComposerDraft("fileName", event.target.value)} placeholder="recording.m4a 或 transcript.txt" />
                    </label>
                    <label className="wide-field">
                      <span>原录音转写 / 面试文字稿</span>
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
                      {composerParsing ? "正在解析..." : canRunSourceParse(composerSource) ? "开始解析" : uploadStatusLabel(composerSource)}
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
                <button className="ghost-button" onClick={() => setComposer(null)}>取消</button>
              </div>
            </div>
          </div>
        )}

        {previewAsset && (
          <div className="asset-preview" role="dialog" aria-modal="true">
            <div className="asset-preview-panel">
              <SectionTitle label={sourceKindLabel[previewAsset.kind]} title={previewAsset.title} action={previewAsset.createdAt} />
              <p>{previewAsset.detail}</p>
              <textarea readOnly value={previewAsset.content || "当前原材料只有元信息。若该材料来自文件上传，可以点击下方打开原文件。"} />
              <div className="button-row">
                {previewAsset.storageUri && (
                  <button className="secondary-button" onClick={() => openStoredFile(previewAsset.storageUri)}>打开原文件</button>
                )}
                {previewAsset.kind === "job-link" && previewAsset.content?.startsWith("http") && (
                  <button className="secondary-button" onClick={() => window.open(previewAsset.content, "_blank", "noopener,noreferrer")}>打开链接</button>
                )}
                <button className="primary-button" onClick={() => setPreviewAsset(null)}>关闭预览</button>
              </div>
            </div>
          </div>
        )}

        {previewSessionFile && (
          <div className="asset-preview" role="dialog" aria-modal="true">
            <div className="asset-preview-panel">
              <SectionTitle
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
                <button className="primary-button" onClick={() => setPreviewSessionFile(null)}>关闭预览</button>
              </div>
            </div>
          </div>
        )}

        {confirmDialog && (
          <div
            className="asset-preview confirm-dialog"
            role="dialog"
            aria-modal="true"
            onClick={() => setConfirmDialog(null)}
          >
            <div className="asset-preview-panel confirm-panel" onClick={(event) => event.stopPropagation()}>
              <div className="section-title">
                <span>确认删除</span>
                <h2>{confirmDialog.title}</h2>
              </div>
              <p>{confirmDialog.description}</p>
              <div className="button-row confirm-actions">
                <button className="secondary-button" onClick={() => setConfirmDialog(null)}>
                  取消
                </button>
                <button
                  className="destructive-button"
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

function PageIntro({ label, title, detail, action }: { label: string; title: string; detail: string; action: string }) {
  return (
    <div className="page-intro">
      <div className="section-title">
        <span>{label}</span>
        <h2>{title}</h2>
        <em>{action}</em>
      </div>
      <p>{detail}</p>
    </div>
  );
}

function SectionTitle({ label, title, action }: { label: string; title: string; action: string }) {
  return (
    <div className="section-title">
      <span>{label}</span>
      <h2>{title}</h2>
      <em>{action}</em>
    </div>
  );
}

function ApiModeBadge({ apiMode, onRefresh }: { apiMode: ApiModeState; onRefresh: () => void }) {
  const label =
    apiMode.status === "online"
      ? "API ONLINE"
      : apiMode.status === "checking"
        ? "CHECKING API"
        : apiMode.status === "offline"
          ? "API OFFLINE"
          : apiMode.status === "demo"
            ? "PUBLIC DEMO"
            : "LOCAL MOCK";
  const detail =
    apiMode.status === "online"
      ? apiMode.dbPath
        ? "SQLite 已连接"
        : `API: ${apiBaseUrl}`
      : apiMode.status === "offline"
        ? "当前使用 mock 数据"
        : apiMode.status === "demo"
          ? "公开演示数据，不连接本地库"
          : apiMode.status === "mock"
            ? "未连接本地 API"
            : apiBaseUrl;

  return (
    <div className={`api-mode-badge ${apiMode.status}`} title={apiMode.dbPath || apiBaseUrl}>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      {apiMode.checkedAt && <em>{apiMode.checkedAt}</em>}
      <button className="mini-button" onClick={onRefresh} disabled={apiMode.status === "checking"}>
        重新检查
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

function OpportunityPipelineView({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="opportunity-pipeline">
      {stages.map((stage, index) => (
        <div className={`pipeline-stage ${stage.state}`} key={stage.key}>
          <span className="pipeline-index">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <div className="pipeline-title-row">
              <strong>{stage.label}</strong>
              <em>{stage.source === "system" ? "SYSTEM" : "MANUAL"}</em>
            </div>
            <small>{stage.detail}</small>
            {stage.subItems && stage.subItems.length > 0 && (
              <div className="pipeline-subitems">
                {stage.subItems.map((item) => (
                  <span className={item.state} key={`${stage.key}-${item.label}-${item.detail}`}>
                    <b>{item.label}</b>
                    <small>{item.detail}</small>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewBlock({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="review-block">
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

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function BoardView({ opportunities, openOpportunity }: { opportunities: Opportunity[]; openOpportunity: (id: string) => void }) {
  return (
    <section className="board board-embedded">
      {opportunityStatusFlow.map((status) => (
        <div className="board-column" key={status}>
          <SectionTitle label="看板分组" title={statusLabel[status as Opportunity["status"]]} action={`${opportunities.filter((item) => item.status === status).length}`} />
          {opportunities
            .filter((item) => item.status === status)
            .map((item) => (
              <button className="job-card job-card-button" key={item.id} onClick={() => openOpportunity(item.id)}>
                <span className={`priority ${computeOpportunityAction(item).toLowerCase()}`}>{computeOpportunityAction(item)}</span>
                <h3>{item.title}</h3>
                <p>{item.company}</p>
                <small>{item.nextAction}</small>
              </button>
            ))}
        </div>
      ))}
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
