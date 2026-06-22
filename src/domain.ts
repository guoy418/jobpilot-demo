import type {
  InterviewSession,
  Opportunity,
  OpportunityAction,
  OpportunityMatch,
  OpportunityPriority,
  OpportunityStatus,
  PipelineStage,
  PipelineStageState,
  SourceAsset,
} from "./types";

export const statusLabel: Record<OpportunityStatus, string> = {
  "TO APPLY": "待投递",
  APPLIED: "已投递",
  "WRITTEN TEST": "准备笔试",
  SCREENING: "筛选中",
  INTERVIEWING: "准备面试",
  WAITING: "等结果",
  OFFER: "Offer",
  ENDED: "已结束",
};

export const sourceKindLabel: Record<SourceAsset["kind"], string> = {
  "jd-text": "岗位描述",
  "job-link": "招聘链接",
  screenshot: "页面截图",
  "referral-note": "内推记录",
};

export const submittedStatuses: OpportunityStatus[] = ["APPLIED", "WRITTEN TEST", "SCREENING", "INTERVIEWING", "WAITING", "OFFER"];
export const opportunityStatusFlow: OpportunityStatus[] = ["TO APPLY", "APPLIED", "WRITTEN TEST", "SCREENING", "INTERVIEWING", "WAITING", "OFFER"];

export const opportunityStatusAction: Record<OpportunityStatus, OpportunityAction> = {
  "TO APPLY": "P0",
  APPLIED: "P1",
  "WRITTEN TEST": "P1",
  SCREENING: "P2",
  INTERVIEWING: "P1",
  WAITING: "P2",
  OFFER: "P3",
  ENDED: "P3",
};

export const opportunityStatusNextAction: Record<OpportunityStatus, string> = {
  "TO APPLY": "补齐材料后投递",
  APPLIED: "三天后跟进投递结果",
  "WRITTEN TEST": "完成笔试并同步结果",
  SCREENING: "等待筛选结果",
  INTERVIEWING: "准备下一轮面试",
  WAITING: "等待结果并准备复盘",
  OFFER: "整理 Offer 信息和取舍",
  ENDED: "已结束，保留历史记录",
};

export const defaultOpportunityNextAction = (status: OpportunityStatus) => opportunityStatusNextAction[status] || opportunityStatusNextAction["TO APPLY"];

export const getRestorableOpportunityStatus = (
  opportunity: { previousStatus?: OpportunityStatus | null; status: OpportunityStatus },
  hasLinkedInterviews = false,
): Exclude<OpportunityStatus, "ENDED"> => {
  if (opportunity.previousStatus && opportunity.previousStatus !== "ENDED") return opportunity.previousStatus;
  if (opportunity.status !== "ENDED") return opportunity.status;
  return hasLinkedInterviews ? "WAITING" : "APPLIED";
};

export const shouldAdvanceLinkedOpportunityAfterInterview = (status: OpportunityStatus) => status === "INTERVIEWING";

const dayMs = 24 * 60 * 60 * 1000;
const priorityRank: Record<OpportunityAction, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const rankPriority = ["P0", "P1", "P2", "P3"] as const;
const baseActionRank: Record<OpportunityStatus, number> = {
  "TO APPLY": 1,
  APPLIED: 1,
  "WRITTEN TEST": 1,
  SCREENING: 2,
  INTERVIEWING: 1,
  WAITING: 2,
  OFFER: 3,
  ENDED: 3,
};

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (days: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

export const inferDueDateFromText = (deadline = ""): string => {
  const text = deadline.trim();
  if (!text || text === "待定") return "";
  if (/今晚|today|tonight/i.test(text)) return addDays(0);
  if (/明天|tomorrow/i.test(text)) return addDays(1);

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;

  const cnDateMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
  if (cnDateMatch) {
    const year = new Date().getFullYear();
    return `${year}-${cnDateMatch[1].padStart(2, "0")}-${cnDateMatch[2].padStart(2, "0")}`;
  }

  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) return dateKey(parsedDate);
  return "";
};

export const getOpportunityDueDate = (opportunity: Pick<Opportunity, "deadline" | "dueDate">) =>
  opportunity.dueDate || inferDueDateFromText(opportunity.deadline);

export const getOpportunityDaysUntilDue = (opportunity: Pick<Opportunity, "deadline" | "dueDate">) => {
  const dueDate = getOpportunityDueDate(opportunity);
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / dayMs);
};

export const isOpportunityDueSoon = (opportunity: Pick<Opportunity, "deadline" | "dueDate">) => {
  const daysUntilDue = getOpportunityDaysUntilDue(opportunity);
  return daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7;
};

export const computeOpportunityAction = ({
  status,
  deadline,
  dueDate,
  match,
  priority,
}: {
  status: OpportunityStatus;
  deadline?: string;
  dueDate?: string;
  match?: OpportunityMatch;
  priority?: OpportunityPriority;
}): OpportunityAction => {
  if (status === "ENDED") return "P3";
  if (status === "OFFER") return "P3";

  const daysUntilDue = getOpportunityDaysUntilDue({ deadline: deadline ?? "", dueDate });
  let rank = baseActionRank[status] ?? priorityRank.P2;

  if (daysUntilDue !== null) {
    if (daysUntilDue <= 1) rank = 0;
    else if (daysUntilDue <= 3 && status !== "WAITING") rank = Math.min(rank, 1);
    else if (daysUntilDue <= 7 && status === "TO APPLY") rank = Math.min(rank, 1);
  }

  if (status === "TO APPLY" && priority === "A" && match === "HIGH") rank = Math.min(rank, 0);
  else if (priority === "A" && status !== "WAITING") rank = Math.min(rank, 1);

  if (daysUntilDue === null && priority === "C" && match === "LOW" && status === "TO APPLY") rank = Math.max(rank, 2);

  return rankPriority[Math.max(0, Math.min(3, rank))];
};

export const resolveOpportunityAction = (opportunity: {
  status: OpportunityStatus;
  deadline?: string;
  dueDate?: string;
  match?: OpportunityMatch;
  priority?: OpportunityPriority;
  action?: OpportunityAction;
  actionManual?: boolean;
}): OpportunityAction => {
  if (opportunity.status === "ENDED") return "P3";
  if (opportunity.actionManual && opportunity.action) return opportunity.action;
  return computeOpportunityAction(opportunity);
};

let idSequence = 0;
export const makeId = (prefix: string) => {
  idSequence = (idSequence + 1) % 10000;
  return `${prefix}-${Date.now().toString().slice(-5)}-${idSequence.toString().padStart(4, "0")}-${Math.floor(Math.random() * 90 + 10)}`;
};

export const formatNow = () =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

const hasTimelineSignal = (opportunity: Opportunity, keyword: string) =>
  opportunity.timeline.some((event) => `${event.title} ${event.detail}`.includes(keyword));

export const buildOpportunityPipeline = (opportunity: Opportunity, sessions: InterviewSession[]): PipelineStage[] => {
  const restoredStatus = opportunity.previousStatus ?? undefined;
  const currentStatus = opportunity.status === "ENDED" ? restoredStatus : opportunity.status;
  const currentIndex = currentStatus ? opportunityStatusFlow.indexOf(currentStatus) : -1;
  const hasWrittenTest = opportunity.status === "WRITTEN TEST" || hasTimelineSignal(opportunity, "笔试");
  const hasInterview = sessions.length > 0 || opportunity.status === "INTERVIEWING" || opportunity.status === "WAITING" || opportunity.status === "OFFER";

  const stageState = (stageStatus: OpportunityStatus, optional = false): PipelineStageState => {
    const stageIndex = opportunityStatusFlow.indexOf(stageStatus);
    if (stageStatus === currentStatus) return opportunity.status === "ENDED" ? "done" : "current";
    if (optional && stageStatus === "WRITTEN TEST" && currentIndex > stageIndex && !hasWrittenTest) return "skipped";
    if (stageIndex < currentIndex) return "done";
    return "next";
  };

  const stages: PipelineStage[] = [
    {
      key: "to-apply",
      label: "待投递",
      state: stageState("TO APPLY"),
      detail: opportunity.status === "TO APPLY" ? opportunity.nextAction : `已使用 ${opportunity.resumeId ? "简历版本" : "待选简历"} 建档`,
      source: "system",
    },
    {
      key: "applied",
      label: "已投递",
      state: stageState("APPLIED"),
      detail: submittedStatuses.includes(opportunity.status) ? "投递动作已完成或被手动确认" : "点击“标记已投递”后自动推进",
      source: "manual",
    },
    {
      key: "written-test",
      label: "准备笔试",
      state: stageState("WRITTEN TEST", true),
      detail: hasWrittenTest ? "已记录笔试或测评节点" : "不是每个岗位都有，未出现时可跳过",
      source: hasWrittenTest ? "manual" : "system",
    },
    {
      key: "screening",
      label: "筛选中",
      state: stageState("SCREENING"),
      detail: opportunity.status === "SCREENING" ? opportunity.nextAction : "笔试或投递后等待筛选反馈",
      source: "system",
    },
    {
      key: "interview",
      label: "准备面试",
      state: stageState("INTERVIEWING"),
      detail: hasInterview ? (sessions.length > 0 ? `${sessions.length} 场面试已关联` : "已进入面试/等结果阶段") : "添加面试复盘后自动推进到这里",
      source: sessions.length > 0 ? "system" : "manual",
      subItems: sessions.map((session) => ({
        label: session.round,
        detail: `${session.company} / ${session.role} / ${session.date}`,
        state: "done",
      })),
    },
    {
      key: "waiting",
      label: "等结果",
      state: stageState("WAITING"),
      detail: opportunity.status === "WAITING" ? opportunity.nextAction : "面试结束后可手动切到等结果",
      source: "manual",
    },
    {
      key: "offer",
      label: "Offer",
      state: stageState("OFFER"),
      detail: opportunity.status === "OFFER" ? "已进入 Offer 对比和取舍" : "最终结果节点",
      source: "manual",
    },
  ];

  if (opportunity.status === "ENDED") {
    stages.push({
      key: "ended",
      label: "已结束",
      state: "current",
      detail: opportunity.endedAt ? `结束于 ${opportunity.endedAt}` : "已从默认推进视图和今日行动中隐藏",
      source: "manual",
    });
  }

  return stages;
};
