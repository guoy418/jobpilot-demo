import {
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
  Plus,
  RotateCcw,
  Search,
  Sun,
  Upload,
} from "lucide-react";
import { type DragEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiModeBadge,
  EmptyState,
  ListPager,
  PageIntro,
  ReviewBlock,
  SectionTitle,
  SegmentedProgress,
  StatRow,
  StatusPill,
  WeeklyTagEditor,
} from "./components/AppPrimitives";
import { BoardView } from "./components/BoardView";
import { ConfirmDialog, type ConfirmDialogState, type EndOpportunityDraft } from "./components/ConfirmDialog";
import { DatePickerInput } from "./components/DatePickerInput";
import { ModuleComposerDialog } from "./components/ModuleComposerDialog";
import { AssetPreviewDialog, SessionFilePreviewDialog } from "./components/PreviewDialogs";
import { SettingsPage } from "./components/SettingsPage";
import { WeeklyPage } from "./components/WeeklyPage";
import { WeeklyTaskDialog } from "./components/WeeklyTaskDialog";
import { useAiSettings, type AiSettings } from "./hooks/useAiSettings";
import { useAnswerPracticeController } from "./hooks/useAnswerPracticeController";
import { useApiInsights } from "./hooks/useApiInsights";
import { useApiModeController } from "./hooks/useApiModeController";
import { useDismissedTodayActions } from "./hooks/useDismissedTodayActions";
import { useModuleComposerController } from "./hooks/useModuleComposerController";
import { useThemePreference } from "./hooks/useThemePreference";
import { useWeeklyPlanController } from "./hooks/useWeeklyPlanController";
import { AnswersPage, type AnswerCategoryEditorState, type AnswerUpdateField } from "./pages/AnswersPage";
import { InterviewsPage, type InterviewView, type QaUpdateField } from "./pages/InterviewsPage";
import { isGarbledTextContent } from "./textEncoding";
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
  detectCity,
  detectCompany,
  detectRoleTitle,
  fileBaseName,
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
  deleteAnswerCardApi,
  deleteAnswerCategoryApi,
  deleteInterviewSessionApi,
  deleteOpportunityApi,
  deleteQaPairApi,
  deleteResumeVersionApi,
  exportBackupApi,
  getApiHealthApi,
  getOpportunitiesApi,
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
} from "./apiClient";
import { apiBaseUrl, isApiEnabled, isPublicDemo } from "./appConfig";
import { baseAnswerCards, baseAnswerCategories, baseWeeklyPlan, resumeVersions, seedInterviewSessions, seedOpportunities, uncategorizedAnswerCategoryId } from "./mockData";
import { selectDashboardSummary, selectResumeName, selectTodayActions, type TodayAction } from "./selectors";
import { formatDueDateDisplay, localDateKey as todayDateKey } from "./utils/date";
import { BACKUP_SCHEMA_VERSION } from "./utils/backup";
import { extractionStatusLabel, failedExtractionStatuses } from "./utils/composerSource";
import {
  composerValidationMessage,
  formatComposerApiError,
  getComposerAssistRequirement as composerAssistRequirement,
  isComposerAiProviderConfigured as isAiProviderConfigured,
  validateAnswerComposerDraft,
  validateInterviewComposerDraft,
  validateOpportunityComposerDraft,
  validateResumeComposerDraft,
  type ComposerValidationResult,
} from "./utils/composerValidation";
import { formatOpportunityHistory, historyTimelinePlaceholder, parseOpportunityHistory } from "./utils/opportunityHistory";
import { GRID_PAGE_SIZE, OPPORTUNITY_TABLE_PAGE_SIZE, paginateList } from "./utils/pagination";
import {
  normalizeDashboardSummary,
  normalizeTodayActions,
  todayActionKey,
  todayActionOutcome,
  todayActionReason,
  todayActionSourceDetail,
  todayActionSourceLabel,
} from "./utils/todayActions";
import type {
  AnswerCard,
  AnswerCategory,
  InterviewSession,
  ModuleComposer,
  ModuleComposerDraft,
  ModuleComposerSource,
  Opportunity,
  OpportunityAction,
  OpportunityEndReason,
  OpportunityPriority,
  OpportunityStatus,
  Page,
  QaPair,
  ResumeVersion,
  SessionFile,
  SourceAsset,
  TimelineEvent,
  ViewMode,
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

type OpportunityVisibilityFilter = "ACTIVE" | "ENDED" | "ALL";
type OpportunityPriorityFilter = "ALL" | OpportunityAction;
type OpportunityTagFilter = "HIGH_PRIORITY" | "HIGH_MATCH" | "DUE_SOON";

const allAnswerCategoryId = "all";

const endReasonLabel: Record<OpportunityEndReason, string> = {
  REJECTED: "被拒",
  CLOSED: "岗位关闭",
  WITHDRAWN: "不再考虑",
  OTHER: "其他",
};

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

const shouldSendAiSettings = (settings: AiSettings, sourceKind: ModuleComposerSource["sourceKind"], useAssist: boolean) => {
  if (!isAiProviderConfigured(settings)) return false;
  if (useAssist) return true;
  if (sourceKind === "screenshot") return settings.parseMode === "assist";
  if (sourceKind === "audio") return settings.transcriptionMode === "assist";
  return false;
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

function App() {
  const [page, setPage] = useState<Page>("home");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const { theme, toggleTheme } = useThemePreference();
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
  const [interviewView, setInterviewView] = useState<InterviewView>("list");
  const [answerView, setAnswerView] = useState<"list" | "detail">("list");
  const [opportunityVisibility, setOpportunityVisibility] = useState<OpportunityVisibilityFilter>("ACTIVE");
  const [opportunityPriorityFilter, setOpportunityPriorityFilter] = useState<OpportunityPriorityFilter>("ALL");
  const [opportunityTagFilters, setOpportunityTagFilters] = useState<OpportunityTagFilter[]>([]);
  const [systemMessage, setSystemMessage] = useState("准备好了");
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
  const [previewAsset, setPreviewAsset] = useState<SourceAsset | null>(null);
  const [previewSessionFile, setPreviewSessionFile] = useState<SessionFile | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [endOpportunityDraft, setEndOpportunityDraft] = useState<EndOpportunityDraft>(() => emptyEndOpportunityDraft());
  const [interviewReparseBusy, setInterviewReparseBusy] = useState(false);
  const [interviewReparseNotice, setInterviewReparseNotice] = useState("");
  const apiOpportunityIdsRef = useRef(new Set(seedOpportunities.map((item) => item.id)));
  const endOpportunityDraftRef = useRef<EndOpportunityDraft>(emptyEndOpportunityDraft());
  const modalBackdropPointerStartedRef = useRef(false);
  const { aiSettings, updateAiSettings, resetAiSettings } = useAiSettings();
  const { apiMode, markApiOnline, markApiOffline, refreshApiHealth, useFallbackApiMode } = useApiModeController({ onMessage: setSystemMessage });
  const { apiDashboardSummary, apiTodayActions, replaceApiInsights, refreshApiInsights, invalidateApiInsights, invalidateTodayActions } = useApiInsights();
  const { dismissTodayAction, isTodayActionDismissed } = useDismissedTodayActions();
  const {
    composer,
    composerStep,
    composerSource,
    composerParsedQaPairs,
    interviewInputMode,
    composerParseNotice,
    composerParsing,
    composerDraft,
    closeComposer,
    openComposer: openComposerDialog,
    updateComposerSource,
    patchComposerSource,
    updateComposerDraft,
    handleComposerFileSelected,
    resetComposerDraft,
    setComposerStep,
    setComposerSource,
    setComposerParsedQaPairs,
    setInterviewInputMode,
    setComposerParseNotice,
    setComposerParsing,
    setComposerDraft,
  } = useModuleComposerController({
    initialResumeId: resumeVersions[0]?.id ?? "",
    initialOpportunityId: seedOpportunities[0]?.id ?? "",
    onMessage: setSystemMessage,
  });

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
    replaceWeeklyPlan(data.weeklyPlan);
    replaceApiInsights("dashboardSummary" in data ? data.dashboardSummary : null, "todayActions" in data ? data.todayActions : null);
    resetComposerDraft(data.resumeVersions[0]?.id ?? "", data.opportunities[0]?.id ?? "");
  };

  useEffect(() => {
    if (!isApiEnabled) {
      setSystemMessage(isPublicDemo ? "演示模式" : "使用本机数据");
      useFallbackApiMode();
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
          markApiOffline();
          setSystemMessage("使用本机数据");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setInterviewReparseNotice("");
  }, [selectedInterviewId]);

  const {
    weeklyPlan,
    weeklyTargetDraft,
    weeklyTargetApplications,
    hasWeeklyTarget,
    weeklyTaskGroups,
    visibleTrainingTaskCount,
    weeklyInterviewPage,
    weeklyPracticePage,
    weeklyTaskForm,
    replaceWeeklyPlan,
    setWeeklyInterviewPage,
    setWeeklyPracticePage,
    openWeeklyTaskDialog,
    updateWeeklyTaskForm,
    closeWeeklyTaskDialog,
    submitWeeklyTaskForm,
    updateWeeklyTask,
    deleteWeeklyTask,
    addWeeklyFocus,
    createWeeklyTask,
    removeWeeklyTasksByEntity,
    updateWeeklyTargetDraft,
    restoreWeeklyTargetDraft,
  } = useWeeklyPlanController({
    initialPlan: baseWeeklyPlan,
    onInsightsRefresh: refreshApiInsights,
    onInsightsInvalidate: invalidateApiInsights,
    onMessage: setSystemMessage,
  });

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
  const todayActions = hydratedTodayActions.filter((action) => !isTodayActionDismissed(action));
  const weeklyProgressPercent = hasWeeklyTarget ? Math.min(100, (submittedApplications / weeklyTargetApplications) * 100) : 0;
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
  const { randomPracticeCard, randomPracticeSpinning, randomPracticeReveal, startRandomAnswerPractice, toggleRandomPracticeReveal } = useAnswerPracticeController({
    answerCards: filteredAnswerCards,
    onMessage: setSystemMessage,
  });
  const answerList = paginateList(filteredAnswerCards, answerPage, GRID_PAGE_SIZE);
  const visibleAnswerCards = answerList.visible;
  const answerPageCount = answerList.pageCount;
  const safeAnswerPage = answerList.safePage;
  useEffect(() => {
    if (selectedAnswerCategoryId !== allAnswerCategoryId && !answerCategoryById.has(selectedAnswerCategoryId)) {
      setSelectedAnswerCategoryId(uncategorizedAnswerCategoryId);
    }
  }, [answerCategoryById, selectedAnswerCategoryId]);
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

  const openComposer = (kind: ModuleComposer, linkedOpportunityId = "") => openComposerDialog(kind, resumeList[0]?.id ?? "", linkedOpportunityId);

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
        summary: "请确认简历定位和核心卖点。",
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
          note: composer === "resume" ? "" : composerSource.note,
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
        const errorDetail = formatComposerApiError(error instanceof Error ? error.message : String(error || ""));
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

  const updateSelectedQa = (field: QaUpdateField, value: string) => {
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
    if ("resumeId" in nextPatch && selectedOpportunity.resumeId !== (nextPatch.resumeId ?? "")) {
      const previousResumeId = selectedOpportunity.resumeId;
      const nextResumeId = nextPatch.resumeId ?? "";
      setResumeList((items) =>
        items.map((resume) => {
          if (resume.id === previousResumeId) {
            return { ...resume, linkedOpportunityIds: resume.linkedOpportunityIds.filter((id) => id !== selectedOpportunity.id) };
          }
          if (resume.id === nextResumeId && !resume.linkedOpportunityIds.includes(selectedOpportunity.id)) {
            return { ...resume, linkedOpportunityIds: [...resume.linkedOpportunityIds, selectedOpportunity.id] };
          }
          return resume;
        }),
      );
      setResumeLinkedOpportunityPage(0);
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
      const errorDetail = formatComposerApiError(error instanceof Error ? error.message : String(error || ""));
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
      else if (composer) closeComposer();
      else if (weeklyTaskForm) closeWeeklyTaskDialog();
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
    removeWeeklyTasksByEntity("interview", interviewId);
    setInterviewPage(0);
    setInterviewView("list");
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

  const updateSelectedAnswer = (field: AnswerUpdateField, value: string) => {
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
    removeWeeklyTasksByEntity("answer", answerId);
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
    removeWeeklyTasksByEntity("opportunity", opportunityId);
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
      schemaVersion: BACKUP_SCHEMA_VERSION,
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

  const importBackup = async (backup: JobPilotBackup) => {
    try {
      const restoredBackup = isApiEnabled ? await importBackupApi(backup) : backup;
      applyLoadedData(restoredBackup);
      if (isApiEnabled) refreshApiInsights();
      setSystemMessage("备份已恢复");
    } catch (error) {
      setSystemMessage("备份恢复失败，已有数据未被覆盖");
      throw error;
    }
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

  const promoteFocusToTask = (label: string, value: string) => {
    createWeeklyTask({
      title: `推进${value}`,
      detail: `由本周计划的「${label}」生成，今天可以拆成一个具体动作。`,
      source: "weekly-focus",
      sourceLabel: "本周计划",
      level: "P2",
    });
  };

  const blockInvalidComposerSubmit = (validation: ComposerValidationResult) => {
    if (validation.ok) return true;
    const message = composerValidationMessage(validation);
    setComposerParseNotice(message);
    setSystemMessage(validation.errors[0]?.message ?? "请检查表单");
    return false;
  };

  const createOpportunityDirect = () => {
    if (!blockInvalidComposerSubmit(validateOpportunityComposerDraft(composerDraft, composerSource))) {
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
    closeComposer();
    setPage("opportunityDetail");
    setSystemMessage("岗位已创建");
  };

  const createInterviewDirect = () => {
    if (
      !blockInvalidComposerSubmit(
        validateInterviewComposerDraft(composerDraft, composerSource, {
          inputMode: interviewInputMode,
          parsedQaPairCount: composerParsedQaPairs.length,
        }),
      )
    ) {
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
    closeComposer();
    setInterviewView("session");
    setPage("interviews");
    setSystemMessage("面试复盘已创建");
  };

  const createResumeDirect = () => {
    if (!blockInvalidComposerSubmit(validateResumeComposerDraft(composerDraft, composerSource, { requireStoredFile: isApiEnabled }))) {
      return;
    }

    const fileName = composerDraft.fileName.trim();
    const nextResume: ResumeVersion = {
      id: makeId("RV"),
      name: composerDraft.title.trim(),
      fileName,
      fileType: fileName.split(".").pop()?.toUpperCase() ?? "FILE",
      fileSize: composerSource.fileSize || "待读取",
      uploadedAt: todayDateKey(),
      roles: composerDraft.roles.trim() || "待填写",
      points: composerDraft.points.trim() || "待填写核心卖点",
      summary: composerDraft.summary.trim() || "待填写文件摘要",
      linkedOpportunityIds: [],
      storageUri: composerSource.storageUri,
    };

    setResumeList((items) => [nextResume, ...items]);
    setSelectedResumeId(nextResume.id);
    syncCreatedResumeVersion(nextResume);
    closeComposer();
    setPage("resumes");
    setSystemMessage("简历已添加");
  };

  const createAnswerDirect = () => {
    if (!blockInvalidComposerSubmit(validateAnswerComposerDraft(composerDraft))) {
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
    closeComposer();
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
      invalidateTodayActions();
      setSystemMessage(`已更新为${statusLabel[status]}`);
    };

    invalidateTodayActions();
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
    invalidateApiInsights();
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
    invalidateApiInsights();
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
      invalidateTodayActions();
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
        dismissTodayAction(action);
        setSystemMessage("今日已完成");
      }
      invalidateTodayActions();
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
      invalidateTodayActions();
      setSystemMessage("复盘任务已完成");
      return;
    }

    dismissTodayAction(action);
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
          detail: `本周还差 ${applicationGap} 个投递，可以先新增一个岗位。`,
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
              onClick={toggleTheme}
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
                          <summary className="today-action-disclosure" aria-label={`查看 ${action.title} 的来源与下一步`}>
                            <span>来源与下一步</span>
                            <ChevronRight size={13} aria-hidden="true" />
                          </summary>
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
                              </button>
                              <button className="secondary-button compact-button action-complete-button" onClick={() => completeTodayAction(action)}>
                                完成
                              </button>
                              <details className="today-action-context today-secondary-context">
                                <summary className="today-action-disclosure" aria-label={`查看 ${action.title} 的来源与下一步`}>
                                  <span className="visually-hidden">来源与下一步</span>
                                  <ChevronRight size={14} aria-hidden="true" />
                                </summary>
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
                detail="按优先级、匹配度和截止时间管理投递岗位。"
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
                        <span className="mono">{formatDueDateDisplay(getOpportunityDueDate(item)) || "待定"}</span>
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
                    <option value="">未选择简历</option>
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
          <InterviewsPage
            interviewSessions={interviewSessions}
            filteredInterviewSessions={filteredInterviewSessions}
            visibleInterviewSessions={visibleInterviewSessions}
            safeInterviewPage={safeInterviewPage}
            interviewPageCount={interviewPageCount}
            interviewView={interviewView}
            selectedInterview={selectedInterview}
            selectedQa={selectedQa}
            opportunities={opportunities}
            reviewPriorityOptions={reviewPriorityOptions}
            interviewReparseBusy={interviewReparseBusy}
            interviewReparseNotice={interviewReparseNotice}
            onOpenComposer={() => openComposer("interview")}
            onOpenInterviewSession={openInterviewSession}
            onInterviewPageChange={setInterviewPage}
            onInterviewViewChange={setInterviewView}
            onUpdateSelectedInterview={updateSelectedInterview}
            onRequestReparseSelectedInterview={requestReparseSelectedInterview}
            onOpenStoredFile={openStoredFile}
            onPreviewSessionFile={setPreviewSessionFile}
            onAddQaPair={addQaPair}
            onOpenInterviewQuestion={openInterviewQuestion}
            onRequestDeleteInterview={() =>
              requestConfirm({
                title: "删除这场面试？",
                description: `「${selectedInterview.company} / ${selectedInterview.round}」及其中所有问题会一并删除，且无法恢复。`,
                confirmLabel: "删除面试",
                onConfirm: deleteSelectedInterview,
              })
            }
            onUpdateSelectedQa={updateSelectedQa}
            onCreateAnswerCard={createAnswerCard}
            onAddSelectedQaToPractice={addSelectedQaToPractice}
            onUpdateSelectedQaWeak={updateSelectedQaWeak}
            onRequestDeleteQa={() =>
              requestConfirm({
                title: "删除这个问题？",
                description: `「${selectedQa.question}」及其回答、评价会一并删除，且无法恢复。`,
                confirmLabel: "删除问题",
                onConfirm: deleteSelectedQa,
              })
            }
          />
        )}

        {page === "answers" && (
          <AnswersPage
            answerCards={answerCards}
            answerCategories={answerCategories}
            rootAnswerCategories={rootAnswerCategories}
            answerCategoryChildren={answerCategoryChildren}
            answerCategoryById={answerCategoryById}
            answerCategoryOptions={answerCategoryOptions}
            answerCategoryEditor={answerCategoryEditor}
            openAnswerCategoryMenuId={openAnswerCategoryMenuId}
            expandedAnswerCategoryIds={expandedAnswerCategoryIds}
            answerCategoryDropTargetId={answerCategoryDropTargetId}
            answerCategorySidebarCollapsed={answerCategorySidebarCollapsed}
            answerView={answerView}
            selectedAnswer={selectedAnswer}
            selectedAnswerCategory={selectedAnswerCategory}
            selectedAnswerCategoryLabel={selectedAnswerCategoryLabel}
            selectedAnswerCategoryTotal={selectedAnswerCategoryTotal}
            isAllAnswerCategorySelected={isAllAnswerCategorySelected}
            filteredAnswerCards={filteredAnswerCards}
            visibleAnswerCards={visibleAnswerCards}
            safeAnswerPage={safeAnswerPage}
            answerPageCount={answerPageCount}
            draggedAnswerCardId={draggedAnswerCardId}
            randomPracticeCard={randomPracticeCard}
            randomPracticeSpinning={randomPracticeSpinning}
            randomPracticeReveal={randomPracticeReveal}
            resolveAnswerCategoryId={resolveAnswerCategoryId}
            onSelectAllCategory={() => {
              setSelectedAnswerCategoryId(allAnswerCategoryId);
              setOpenAnswerCategoryMenuId("");
              setAnswerPage(0);
              setAnswerView("list");
            }}
            onSelectCategory={(categoryId) => {
              setSelectedAnswerCategoryId(categoryId);
              setOpenAnswerCategoryMenuId("");
              setAnswerPage(0);
              setAnswerView("list");
            }}
            onCreateCategory={openCreateAnswerCategoryEditor}
            onRenameCategory={openRenameAnswerCategoryEditor}
            onDeleteCategoryRequest={(category) => {
              setOpenAnswerCategoryMenuId("");
              requestConfirm({
                title: "删除这个分类？",
                description: `「${category.name}」及其子分类会被删除，里面的答案卡会移动到「尚未归类」。`,
                confirmLabel: "删除分类",
                onConfirm: () => deleteAnswerCategory(category),
              });
            }}
            onToggleCategoryExpanded={toggleAnswerCategoryExpanded}
            onToggleCategoryMenu={(categoryId) => setOpenAnswerCategoryMenuId((id) => (id === categoryId ? "" : categoryId))}
            onCategoryEditorNameChange={(name) => setAnswerCategoryEditor((editor) => (editor ? { ...editor, name } : editor))}
            onCommitCategoryEditor={commitAnswerCategoryEditor}
            onCancelCategoryEditor={() => setAnswerCategoryEditor(null)}
            onAnswerCategoryDragOver={handleAnswerCategoryDragOver}
            onAnswerCategoryDragLeave={handleAnswerCategoryDragLeave}
            onAnswerCategoryDrop={handleAnswerCategoryDrop}
            onAnswerCardDragStart={handleAnswerCardDragStart}
            onAnswerCardDragEnd={clearAnswerCardDragState}
            onSidebarCollapsedChange={setAnswerCategorySidebarCollapsed}
            onOpenComposer={() => openComposer("answer")}
            onStartRandomPractice={startRandomAnswerPractice}
            onToggleRandomPracticeReveal={toggleRandomPracticeReveal}
            onOpenAnswerCard={openAnswerCard}
            onGoToInterviews={() => goTo("interviews")}
            onAnswerPageChange={setAnswerPage}
            onAnswerViewChange={setAnswerView}
            onUpdateSelectedAnswer={updateSelectedAnswer}
            onAddSelectedAnswerToPractice={addSelectedAnswerToPractice}
            onDeleteSelectedAnswerRequest={() =>
              requestConfirm({
                title: "删除这张答案卡？",
                description: `「${selectedAnswer.question}」删除后无法恢复。`,
                confirmLabel: "删除卡片",
                onConfirm: deleteSelectedAnswer,
              })
            }
          />
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
                  <p>上传于 {selectedResume.uploadedAt}</p>
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
          <WeeklyPage
            groups={weeklyTaskGroups}
            visibleTrainingTaskCount={visibleTrainingTaskCount}
            submittedApplications={submittedApplications}
            targetApplications={weeklyTargetApplications}
            targetDraft={weeklyTargetDraft}
            interviewPage={weeklyInterviewPage}
            practicePage={weeklyPracticePage}
            onTargetDraftChange={updateWeeklyTargetDraft}
            onTargetDraftBlur={restoreWeeklyTargetDraft}
            onInterviewPageChange={setWeeklyInterviewPage}
            onPracticePageChange={setWeeklyPracticePage}
            onAddPracticeTask={openWeeklyTaskDialog}
            onToggleTaskStatus={(task) => updateWeeklyTask(task.id, "status", task.status === "done" ? "open" : "done")}
            onDeleteTaskRequest={(task) =>
              requestConfirm({
                title: "删除这条动作？",
                description: `「${task.title}」删除后不再出现在本周计划里。`,
                confirmLabel: "删除",
                onConfirm: () => deleteWeeklyTask(task.id),
              })
            }
          />
        )}

        {page === "exports" && (
          <SettingsPage
            isPublicDemo={isPublicDemo}
            isApiEnabled={isApiEnabled}
            aiSettings={aiSettings}
            onAiSettingsChange={updateAiSettings}
            onSaveSettings={() => setSystemMessage("设置已保存")}
            onResetSettings={() => {
              resetAiSettings();
              setSystemMessage("设置已重置");
            }}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
            onExportAnswerCards={exportAnswerCards}
            onExportInterviewReviews={exportInterviewReviews}
          />
        )}

        {composer && (
          <ModuleComposerDialog
            composer={composer}
            composerStep={composerStep}
            composerSource={composerSource}
            composerDraft={composerDraft}
            composerParseNotice={composerParseNotice}
            composerParsing={composerParsing}
            interviewInputMode={interviewInputMode}
            interviewReviewJsonPrompt={interviewReviewJsonPrompt}
            opportunities={opportunities}
            resumeList={resumeList}
            onClose={closeComposer}
            onBackdropMouseDown={markModalBackdropPointerStart}
            onBackdropClick={(event) => closeModalFromBackdropClick(event, closeComposer)}
            onInterviewInputModeChange={setInterviewInputMode}
            onSourceChange={(field, value) => {
              updateComposerSource(field, value);
              if (composerParseNotice) setComposerParseNotice("");
            }}
            onSourcePatch={patchComposerSource}
            onFileSelected={handleComposerFileSelected}
            onClearParseNotice={() => setComposerParseNotice("")}
            onTemplateCopied={() => setSystemMessage("整理模板已复制")}
            onDraftChange={(field, value) => {
              updateComposerDraft(field, value);
              if (composerParseNotice) setComposerParseNotice("");
            }}
            onParse={runComposerParse}
            onSubmit={submitComposer}
            onBackToSource={() => setComposerStep("source")}
          />
        )}

        {previewAsset && (
          <AssetPreviewDialog
            asset={previewAsset}
            onClose={() => setPreviewAsset(null)}
            onBackdropMouseDown={markModalBackdropPointerStart}
            onBackdropClick={(event) => closeModalFromBackdropClick(event, () => setPreviewAsset(null))}
            onOpenStoredFile={openStoredFile}
          />
        )}

        {previewSessionFile && (
          <SessionFilePreviewDialog
            file={previewSessionFile}
            onClose={() => setPreviewSessionFile(null)}
            onBackdropMouseDown={markModalBackdropPointerStart}
            onBackdropClick={(event) => closeModalFromBackdropClick(event, () => setPreviewSessionFile(null))}
            onOpenStoredFile={openStoredFile}
          />
        )}

        {weeklyTaskForm && (
          <WeeklyTaskDialog
            form={weeklyTaskForm}
            onChange={updateWeeklyTaskForm}
            onSubmit={submitWeeklyTaskForm}
            onClose={closeWeeklyTaskDialog}
            onBackdropMouseDown={markModalBackdropPointerStart}
            onBackdropClick={(event) => closeModalFromBackdropClick(event, closeWeeklyTaskDialog)}
          />
        )}

        {confirmDialog && (
          <ConfirmDialog
            dialog={confirmDialog}
            endOpportunityDraft={endOpportunityDraft}
            onEndOpportunityDraftChange={updateEndOpportunityDraft}
            onClose={() => setConfirmDialog(null)}
            onConfirm={() => {
              confirmDialog.onConfirm();
              setConfirmDialog(null);
            }}
            onBackdropMouseDown={markModalBackdropPointerStart}
            onBackdropClick={(event) => closeModalFromBackdropClick(event, () => setConfirmDialog(null))}
          />
        )}
      </main>
    </div>
  );
}

export default App;
