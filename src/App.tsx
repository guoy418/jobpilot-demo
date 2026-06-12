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
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { isGarbledTextContent, readTextFile } from "./textEncoding";
import {
  computeOpportunityAction,
  resolveOpportunityAction,
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
  parseInterviewReviewJson,
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
  { id: "exports", label: "设置备份", icon: FileDown },
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

const workflowTabs = [
  { page: "opportunities" as const, label: "岗位管理", hint: "录入 JD，推进投递" },
  { page: "interviews" as const, label: "面试复盘", hint: "整理问答，发现问题" },
  { page: "answers" as const, label: "答案库", hint: "沉淀可背答案" },
  { page: "weekly" as const, label: "训练计划", hint: "安排练习与复盘" },
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
type InterviewInputMode = "review-json" | "raw-transcript";

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
  if (action.source === "weekly") return "训练";
  return "待办";
};

const pageShowsTopSearch = (currentPage: Page) => currentPage === "opportunities" || currentPage === "interviews" || currentPage === "answers";

const topSearchPlaceholder = (currentPage: Page) => {
  if (currentPage === "interviews") return "搜索公司、岗位、轮次";
  if (currentPage === "answers") return "搜索问题、回答、来源、适用岗位";
  return "搜索岗位、公司、备注";
};

const opportunityFilterLabel = (value: string) => {
  const labels: Record<string, string> = {
    ALL: "全部",
    P0: "今天要处理",
    P1: "优先推进",
    "A PRIORITY": "高意愿",
    "HIGH MATCH": "高匹配",
    "DUE SOON": "快截止",
  };
  return labels[value] ?? value;
};

const completedOpportunityStatus = (status: OpportunityStatus): OpportunityStatus | null => {
  if (status === "TO APPLY") return "APPLIED";
  if (status === "APPLIED") return "WRITTEN TEST";
  if (status === "WRITTEN TEST") return "INTERVIEWING";
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
  const [interviewView, setInterviewView] = useState<"list" | "session" | "question">("list");
  const [answerView, setAnswerView] = useState<"list" | "detail">("list");
  const [weeklyEditingTaskId, setWeeklyEditingTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [systemMessage, setSystemMessage] = useState("准备好了");
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
  const [interviewInputMode, setInterviewInputMode] = useState<InterviewInputMode>("review-json");
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
      .catch(() => setSystemMessage("训练计划已保存在本机"));
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
  const weeklyTaskGroups = useMemo(
    () =>
      [
        {
          id: "interview",
          title: "面试表达练习",
          detail: "从面试复盘或答案卡中选择想练的问题，添加到这里。",
          examples: ["重讲一个薄弱项目题", "把答案卡练到能自然复述"],
          tasks: weeklyPlan.tasks.filter((task) => task.source === "interview" || task.source === "answer"),
        },
        {
          id: "practice",
          title: "自主训练",
          detail: "手动添加笔试、作品集、英语和材料整理等其他任务。",
          examples: ["练一道笔试题", "整理一版项目表达"],
          tasks: weeklyPlan.tasks.filter((task) => task.source === "manual" || task.source === "weekly-focus"),
        },
      ],
    [weeklyPlan.tasks],
  );

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((item) => {
      const resumeName = resumeList.find((resume) => resume.id === item.resumeId)?.name ?? item.resumeId;
      const haystack = `${item.title} ${item.company} ${item.city} ${item.nextAction} ${resumeName}`.toLowerCase();
      const matchesQuery = haystack.includes(normalizedQuery);
      const computedAction = resolveOpportunityAction(item);
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
  const selectedOpportunityAction = selectedOpportunity ? resolveOpportunityAction(selectedOpportunity) : "P2";
  const selectedOpportunitySuggestedAction = selectedOpportunity ? computeOpportunityAction(selectedOpportunity) : "P2";

  const goTo = (nextPage: Page) => {
    setPage(nextPage);
    setSystemMessage(`[OPENED: ${nextPage.toUpperCase()}]`);
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
    const fileName = composerSource.fileName.trim();
    if (composer !== "answer" && !rawText && !fileName) {
      setComposerParseNotice(
        composer === "interview" && interviewInputMode === "review-json"
          ? "请粘贴或上传已经整理好的复盘文档。"
          : "请先上传文件，或粘贴文字内容。",
      );
      setSystemMessage("请先选择材料");
      return;
    }
    if (composer !== "answer" && fileName && !rawText && isApiEnabled && !composerSource.storageUri) {
      setComposerParseNotice("文件还在保存，请稍等几秒后再继续。");
      setSystemMessage("请稍等文件保存");
      return;
    }

    const assistRequirement = composer !== "answer" ? composerAssistRequirement(composer, composerSource.sourceKind, aiSettings) : "";
    if (assistRequirement && !rawText) {
      setComposerSource((source) => ({
        ...source,
        extractionStatus: composerSource.sourceKind === "audio" ? "transcription-unavailable" : "ocr-unavailable",
      }));
      setComposerParseNotice(assistRequirement);
      setSystemMessage("需要先完成设置");
      return;
    }

    const parseText = `${rawText} ${fileBaseName(fileName)}`.trim();
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
      setSystemMessage(`[PARSE BLOCKED: ${status}]`);
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
    setSystemMessage(weak ? "已重新标为薄弱" : "已标记处理");
  };

  const updateSelectedInterview = (patch: Partial<InterviewSession>) => {
    setInterviewSessions((sessions) => sessions.map((session) => (session.id === selectedInterview.id ? { ...session, ...patch } : session)));
    syncUpdatedInterviewSession(selectedInterview.id, patch);
  };

  const updateSelectedOpportunity = (patch: Partial<Opportunity>) => {
    const normalizedPatch =
      "deadline" in patch && !("dueDate" in patch) ? { ...patch, dueDate: inferDueDateFromText(patch.deadline ?? "") } : patch;
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
          setSystemMessage(`[REPARSE BLOCKED: ${parsed.extractionStatus ?? "failed"}]`);
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
      .catch(() => setSystemMessage("答案卡已保存在本机"));
  };

  const syncUpdatedAnswerCard = (id: string, patch: Partial<AnswerCard>) => {
    void updateAnswerCardApi(id, patch).catch(() => setSystemMessage("答案卡已保存在本机"));
  };

  const syncDeletedAnswerCard = (id: string) => {
    void deleteAnswerCardApi(id).catch(() => setSystemMessage("答案卡已在本机更新"));
  };

  const syncWeeklyPlanPatch = (patch: Partial<Omit<WeeklyPlan, "tasks">>) => {
    void updateWeeklyPlanApi(patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("训练计划已保存在本机"));
  };

  const syncCreatedWeeklyTask = (task: WeeklyTask) => {
    void createWeeklyTaskApi(task)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("训练计划已保存在本机"));
  };

  const syncUpdatedWeeklyTask = (id: string, patch: Partial<WeeklyTask>) => {
    void updateWeeklyTaskApi(id, patch)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("训练计划已保存在本机"));
  };

  const syncDeletedWeeklyTask = (id: string) => {
    void deleteWeeklyTaskApi(id)
      .then(refreshApiInsights)
      .catch(() => setSystemMessage("训练计划已保存在本机"));
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
      framework: "背景 -> 动作 -> 结果 -> 复盘",
      answer: "在这里写你希望下次面试复用的回答。",
      relatedRoles: "待填写",
      practiceStatus: "未练习",
    };
    setAnswerCards((cards) => [newCard, ...cards]);
    setSelectedAnswerId(newCard.id);
    setAnswerView("detail");
    syncCreatedAnswerCard(newCard);
    setSystemMessage("答案卡已添加");
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
    setSystemMessage("面试复盘已导出");
  };

  const addWeeklyTask = (preset?: Partial<Pick<WeeklyTask, "title" | "detail">>) => {
    const newTask: WeeklyTask = {
      id: makeId("WT"),
      title: preset?.title ?? "新的练习动作",
      detail: preset?.detail ?? "写下今天准备推进的一件小事。",
      source: "manual",
      sourceLabel: "训练计划",
      level: "P2",
      status: "open",
    };
    setWeeklyPlan((plan) => ({ ...plan, tasks: [newTask, ...plan.tasks] }));
    setWeeklyEditingTaskId(newTask.id);
    invalidateApiInsights();
    syncCreatedWeeklyTask(newTask);
    setSystemMessage("动作已添加");
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
    setWeeklyEditingTaskId((currentId) => (currentId === id ? null : currentId));
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
      setSystemMessage("请补齐公司、岗位和岗位描述");
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
      jdSummary: composerSource.note || "从上传材料整理出的岗位记录。",
      jdText: composerDraft.sourceText.trim(),
      sourceAssets: [
        {
          id: makeId("SRC"),
          kind: sourceKind,
          title: composerSource.fileName || composerDraft.sourceLabel || "岗位描述",
          detail: composerSource.note || "从上传材料整理",
          createdAt: now,
          content: composerDraft.sourceText.trim(),
          storageUri: composerSource.storageUri,
        },
      ],
      timeline: [
        { id: makeId("TL"), occurredAt: now, title: "写入岗位管理", detail: "必填信息满足后直接生成正式岗位记录", status: "done" },
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
          id: makeId("QA"),
          ...pair,
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
      sourceFiles,
      qaPairs,
    };

    setInterviewSessions((sessions) => [nextSession, ...sessions]);
    setSelectedInterviewId(nextSession.id);
    setSelectedQaId(nextSession.qaPairs[0]?.id ?? "");
    syncCreatedInterviewSession(nextSession);
    if (nextSession.opportunityId && (!isApiEnabled || !apiOpportunityIdsRef.current.has(nextSession.opportunityId))) {
      applyOpportunityProgress(nextSession.opportunityId, "WAITING", "system", "新增" + nextSession.round + "面试复盘后自动推进");
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
      framework: composerDraft.framework.trim() || "背景 -> 动作 -> 结果 -> 复盘",
      answer: composerDraft.answer.trim() || "在这里补充可复用回答。",
      relatedRoles: composerDraft.relatedRoles.trim() || "待填写",
      practiceStatus: "未练习",
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
    const now = formatNow();
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
        ...(status !== "OFFER"
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

  const openTodayAction = (action: TodayAction) => {
    if (action.filter) setFilter(action.filter);
    if (action.page === "opportunityDetail") {
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

    if (action.source === "answer" && action.targetId) {
      updateAnswerPracticeState(action.targetId, { practiceStatus: "可复用", status: "ACTIVE" });
      setApiTodayActions(null);
      setSystemMessage("练习已完成");
      return;
    }

    setDismissedTodayIds((ids) => new Set(ids).add(todayActionKey(action)));
    setSystemMessage("今日已暂不显示");
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
            <section className="flow-pipeline workflow-tabs" aria-label="求职闭环">
              <div className="flow-pipeline-intro">
                <span className="eyebrow">求职闭环</span>
                <p>从岗位到复盘、答案沉淀和训练计划；今日待办会把各模块里该推进的事收在一起。</p>
              </div>
              <ol className="flow-pipeline-steps">
                {workflowTabs.map((step, index) => (
                  <li key={step.page} className="flow-step">
                    <button type="button" className="flow-step-button" onClick={() => goTo(step.page)}>
                      <span className="flow-step-index" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="flow-step-copy">
                        <strong>{step.label}</strong>
                        <span>{step.hint}</span>
                      </div>
                    </button>
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
                    <p>这里会集中显示你今天最应该推进的投递、复盘和练习。</p>
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
                  <SectionTitle label="今日待办" title="待办从哪里来" action="自动汇总" />
                  <div className="todo-rule-list">
                    <button onClick={() => goTo("opportunities")}>
                      <span className="source-chip">岗位</span>
                      <strong>岗位进度</strong>
                      <small>待投递，以及需准备笔试、面试的岗位，会自动生成跟进待办。</small>
                    </button>
                    <button onClick={() => goTo("interviews")}>
                      <span className="source-chip">面试</span>
                      <strong>面试复盘</strong>
                      <small>复盘中标记为薄弱的问题，会自动加入今日待办。</small>
                    </button>
                    <button onClick={() => goTo("weekly")}>
                      <span className="source-chip">训练</span>
                      <strong>训练计划</strong>
                      <small>可手动添加训练任务，也可从面试复盘或答案库加入，自动同步到今日待办。</small>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="surface weekly-strip weekly-strip-button"
                  onClick={() => goTo("weekly")}
                >
                  <SectionTitle label="训练计划" title="本周投递目标" action={`${submittedApplications}/${weeklyPlan.targetApplications}`} />
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
              detail="按优先级、匹配度和截止时间管理投递备注。"
              action={`${filteredOpportunities.length} 个岗位`}
            />
            <div className="toolbar-row">
              <div className="filter-bar">
                {["ALL", "P0", "P1", "A PRIORITY", "HIGH MATCH", "DUE SOON"].map((item) => (
                  <button key={item} className={filter === item ? "active-filter" : ""} onClick={() => setFilter(item)}>
                    {opportunityFilterLabel(item)}
                  </button>
                ))}
              </div>
              <div className="view-toggle">
                <button className="primary-chip" onClick={() => openComposer("opportunity")}>
                  <Plus size={14} />
                  新增岗位
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
                  <span>备注</span>
                </div>
                {filteredOpportunities.map((item) => (
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
          <section className="split-page opportunity-detail-page">
            <div className="surface">
              <button className="ghost-button back-button" onClick={() => goTo("opportunities")}>
                <ChevronLeft size={16} />
                <span>返回岗位管理</span>
              </button>
              <PageIntro
                label={selectedOpportunity.id}
                title={selectedOpportunity.title}
                detail="这里记录这份岗位的进度、原始材料和备注。"
                action={selectedOpportunityAction}
              />
              <div className="source-panel">
                <SectionTitle label="材料" title="原始材料" action={`${selectedOpportunity.sourceAssets.length} 份`} />
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
                  <span>今日优先级</span>
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
                    <option value="P0">P0 · 今天必须做</option>
                    <option value="P1">P1 · 今天优先</option>
                    <option value="P2">P2 · 可排进今天</option>
                    <option value="P3">P3 · 暂不推进</option>
                  </select>
                  <small className="field-hint">
                    {selectedOpportunity.actionManual
                      ? `已手动设为 ${selectedOpportunityAction}；自动建议为 ${selectedOpportunitySuggestedAction}。`
                      : `根据状态、截止日和主观优先级自动计算，当前为 ${selectedOpportunityAction}。`}
                  </small>
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
                  <span>备注</span>
                  <input value={selectedOpportunity.nextAction} onChange={(event) => updateSelectedOpportunity({ nextAction: event.target.value })} />
                </label>
              </div>
              <div className="button-row">
                <button className="primary-button" onClick={markOpportunityApplied}>标记已投递</button>
                <button className="secondary-button" onClick={() => openComposer("interview", selectedOpportunity.id)}>添加面试</button>
              </div>
              <div className="opportunity-status-section">
                <SectionTitle label="岗位进度" title="进度" action={statusLabel[selectedOpportunity.status]} />
                <div className="opportunity-progress-track" aria-label={`当前进度：${statusLabel[selectedOpportunity.status]}`}>
                  {opportunityStatusFlow.map((status, index) => {
                    const currentIndex = opportunityStatusFlow.indexOf(selectedOpportunity.status);
                    const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "next";
                    return (
                      <button
                        key={status}
                        className={`opportunity-progress-step ${state}`}
                        onClick={() => applyOpportunityProgress(selectedOpportunity.id, status, "manual")}
                      >
                        <span>{index + 1}</span>
                        <strong>{statusLabel[status]}</strong>
                      </button>
                    );
                  })}
                </div>
                <p className="opportunity-progress-note">
                  {selectedOpportunity.status === "TO APPLY"
                    ? "今日待办里点完成后，会同步标记为已投递。"
                    : selectedOpportunity.status === "WRITTEN TEST"
                      ? "完成笔试待办后，会推进到面试中。"
                      : "阶段有变化时，可以直接点击上面的节点更新。"}
                </p>
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
              <div className="surface interview-list-pane interview-home-pane">
                <PageIntro
                  label="面试复盘"
                  title="记录每一场面试"
                  detail="保存面试基本信息、问题、原回答、复盘建议和优化回答。"
                  action={`${interviewSessions.length} 场面试`}
                />

                <div className="button-row tight-row">
                  <button className="primary-button" onClick={() => openComposer("interview")}>
                    <Upload size={16} />
                    <span>导入面试复盘</span>
                  </button>
                </div>

                <div className="interview-card-grid">
                  {visibleInterviewSessions.map((session) => {
                    const weakCount = session.qaPairs.filter((pair) => pair.weak).length;
                    return (
                      <button key={session.id} className="interview-session-card" onClick={() => openInterviewSession(session.id)}>
                        <div className="interview-card-topline">
                          <span>{session.date}</span>
                          <strong>{weakCount ? `${weakCount} 题待练` : "已整理"}</strong>
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

                <div className="pager-row">
                  <button className="ghost-button compact-button" disabled={interviewPage === 0} onClick={() => setInterviewPage((pageIndex) => Math.max(0, pageIndex - 1))}>
                    上一页
                  </button>
                  <span>{interviewPage + 1} / {interviewPageCount}</span>
                  <button className="ghost-button compact-button" disabled={interviewPage >= interviewPageCount - 1} onClick={() => setInterviewPage((pageIndex) => Math.min(interviewPageCount - 1, pageIndex + 1))}>
                    下一页
                  </button>
                </div>
              </div>
            ) : (
              <div className="surface review-editor interview-detail-pane">
                <div className="interview-detail-nav">
                  <button className="ghost-button compact-button" onClick={() => setInterviewView("list")}>
                    <ChevronLeft size={14} />
                    <span>全部面试</span>
                  </button>
                  {interviewView === "question" ? (
                    <button className="ghost-button compact-button" onClick={() => setInterviewView("session")}>
                      <ChevronLeft size={14} />
                      <span>问题目录</span>
                    </button>
                  ) : null}
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

                    <ReviewBlock label="面试问题" value={selectedQa.question} readOnly />
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
          <section className="answer-workspace">
            {answerView === "list" ? (
              <div className="surface answer-list-pane answer-home-pane">
                <PageIntro
                  label="答案库"
                  title="沉淀可复用回答"
                  detail="把常见问题、回答框架和推荐表达整理成之后可以直接练习的答案卡。"
                  action={`${answerCards.length} 张卡片`}
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
                        onClick={() => openAnswerCard(card.id)}
                      >
                        <div>
                          <span className="type-pill">{card.type}</span>
                          <h3>{card.question}</h3>
                        </div>
                        <small>{card.source} / {card.practiceStatus}</small>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="surface answer-editor answer-detail-pane">
                <div className="interview-detail-nav">
                  <button className="ghost-button compact-button" onClick={() => setAnswerView("list")}>
                    <ChevronLeft size={14} />
                    <span>全部答案</span>
                  </button>
                </div>
                <SectionTitle label={selectedAnswer.source} title={selectedAnswer.question} action={selectedAnswer.status} />
                <ReviewBlock label="问题" value={selectedAnswer.question} onChange={(value) => updateSelectedAnswer("question", value)} />
                <ReviewBlock label="回答框架" value={selectedAnswer.framework} onChange={(value) => updateSelectedAnswer("framework", value)} />
                <ReviewBlock label="推荐回答" value={selectedAnswer.answer} onChange={(value) => updateSelectedAnswer("answer", value)} />
                <ReviewBlock label="适用岗位" value={selectedAnswer.relatedRoles} onChange={(value) => updateSelectedAnswer("relatedRoles", value)} />
                <div className="inline-controls">
                  <label>
                    <span>状态</span>
                    <select value={selectedAnswer.status} onChange={(event) => updateSelectedAnswer("status", event.target.value)}>
                      <option value="DRAFT">草稿</option>
                      <option value="ACTIVE">可复用</option>
                      <option value="NEEDS PRACTICE">需要练习</option>
                    </select>
                  </label>
                  <label>
                    <span>练习状态</span>
                    <select value={selectedAnswer.practiceStatus} onChange={(event) => updateSelectedAnswer("practiceStatus", event.target.value)}>
                      <option value="未练习">未练习</option>
                      <option value="练习中">练习中</option>
                      <option value="可复用">可复用</option>
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
            )}
          </section>
        )}

        {page === "resumes" && (
          <section className="resume-workspace">
            <div className="surface resume-list-pane">
              <PageIntro
                label="简历版本"
                title="管理你上传的几份不同简历文件"
                detail="这里存的是简历文件本身和它的定位。某个岗位实际用了哪版简历，会在岗位详情里作为投递记录出现。"
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
            <div className="surface weekly-board">
              <PageIntro
                label="训练计划"
                title="安排本周要练的事"
                detail="训练计划可包含面试表达练习、笔试准备、作品集整理和材料补充等，拆成本周可以完成的小任务。"
                action={`${weeklyPlan.tasks.filter((task) => task.status === "open").length} 待完成`}
              />
              <div className="weekly-overview">
                <div className="weekly-progress-card">
                  <span>本周投递</span>
                  <strong>{submittedApplications}/{weeklyPlan.targetApplications}</strong>
                  <SegmentedProgress value={(submittedApplications / weeklyPlan.targetApplications) * 100} segments={12} />
                </div>
                <label className="weekly-goal-card">
                  <span>目标</span>
                  <input
                    type="number"
                    value={weeklyPlan.targetApplications}
                    onChange={(event) => updateWeeklyTargetApplications(Number(event.target.value))}
                  />
                  <small>本周想投递多少个岗位</small>
                </label>
              </div>

              <div className="weekly-group-list">
                {weeklyTaskGroups.map((group) => (
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
                      {group.id === "practice" ? (
                        <button
                          className="weekly-add-card"
                          onClick={() => addWeeklyTask({ title: "新的自主训练", detail: "例如：练一道笔试题，或整理一个项目表达。" })}
                        >
                          <Plus size={18} />
                          <strong>添加动作</strong>
                          <span>新增一张自主训练卡片</span>
                        </button>
                      ) : null}
                      {group.tasks.map((task) => (
                        <article className={`weekly-task ${task.status === "done" ? "is-done" : ""} ${weeklyEditingTaskId === task.id ? "is-editing" : ""}`} key={task.id}>
                          <div className="weekly-task-header">
                            <span>{task.status === "done" ? "已完成" : task.level ?? "P2"}</span>
                            <small>{task.sourceLabel}</small>
                          </div>
                          {weeklyEditingTaskId === task.id ? (
                            <>
                              <input aria-label="动作标题" value={task.title} onChange={(event) => updateWeeklyTask(task.id, "title", event.target.value)} />
                              <textarea aria-label="动作备注" value={task.detail} onChange={(event) => updateWeeklyTask(task.id, "detail", event.target.value)} />
                              <select value={task.level ?? "P2"} onChange={(event) => updateWeeklyTask(task.id, "level", event.target.value)}>
                                <option value="P0">今天必须做</option>
                                <option value="P1">优先推进</option>
                                <option value="P2">正常练习</option>
                                <option value="P3">低优先</option>
                              </select>
                            </>
                          ) : (
                            <>
                              <h3>{task.title}</h3>
                              <p>{task.detail}</p>
                            </>
                          )}
                          <div className="weekly-task-actions">
                            <button className="weekly-card-action" onClick={() => setWeeklyEditingTaskId(weeklyEditingTaskId === task.id ? null : task.id)}>
                              {weeklyEditingTaskId === task.id ? "收起" : "编辑"}
                            </button>
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
                                  description: `「${task.title}」删除后不再出现在训练计划里。`,
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
                  </section>
                ))}
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
          <div className="asset-preview" role="dialog" aria-modal="true" onClick={() => setComposer(null)}>
            <div className="asset-preview-panel module-composer-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setComposer(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <SectionTitle
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
                    : "上传文件，或直接粘贴文字内容。系统会尽量帮你提取关键信息。"
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
                        ? "支持岗位描述截图、PDF 或文本。"
                        : composer === "interview"
                          ? interviewInputMode === "review-json"
                            ? "支持 .json / .txt / .md。内容需要是已整理好的复盘格式。"
                            : "支持录音和文字稿。"
                          : "支持 PDF / DOCX / 图片 / 文本。"}
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

                  <div className="source-side">
                    {!(composer === "interview" && interviewInputMode === "review-json") && (
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
                        {composer === "interview" && (
                          <>
                            <option value="audio">面试录音</option>
                            <option value="transcript">文字稿</option>
                          </>
                        )}
                        {composer === "resume" && <option value="resume-file">简历文件</option>}
                      </select>
                    </label>
                    )}
                    <label>
                      <span>备注（可选）</span>
                      <input
                        value={composerSource.note}
                        onChange={(event) => updateComposerSource("note", event.target.value)}
                        placeholder={composer === "interview" ? "公司、岗位、轮次，或这次复盘重点" : "来源、轮次、重点方向等"}
                      />
                    </label>
                  </div>

                  <label className="wide-field source-text-input">
                    <span>
                      {composer === "opportunity"
                        ? "岗位描述（可选）"
                        : composer === "interview"
                          ? interviewInputMode === "review-json"
                            ? "整理好的复盘内容"
                            : "原始录音转写稿"
                          : "简历文字或补充说明（可选）"}
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
                      <span>备注</span>
                      <input value={composerDraft.nextAction} onChange={(event) => updateComposerDraft("nextAction", event.target.value)} />
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
          <div className="asset-preview" role="dialog" aria-modal="true" onClick={() => setPreviewAsset(null)}>
            <div className="asset-preview-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setPreviewAsset(null)} aria-label="关闭">
                <X size={16} />
              </button>
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
              </div>
            </div>
          </div>
        )}

        {previewSessionFile && (
          <div className="asset-preview" role="dialog" aria-modal="true" onClick={() => setPreviewSessionFile(null)}>
            <div className="asset-preview-panel" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" onClick={() => setPreviewSessionFile(null)} aria-label="关闭">
                <X size={16} />
              </button>
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
              <button className="modal-close-button" onClick={() => setConfirmDialog(null)} aria-label="关闭">
                <X size={16} />
              </button>
              <div className="section-title">
                <span>确认删除</span>
                <h2>{confirmDialog.title}</h2>
              </div>
              <p>{confirmDialog.description}</p>
              <div className="button-row confirm-actions">
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
                <span className={`priority ${resolveOpportunityAction(item).toLowerCase()}`}>{resolveOpportunityAction(item)}</span>
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
