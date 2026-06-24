import { opportunityStatusFlow, submittedStatuses } from "../shared/opportunityRules.mjs";
import type { InterviewSession, Opportunity, OpportunityStatus, PipelineStage, PipelineStageState, SourceAsset } from "./types";

export {
  compareOpportunityActions,
  computeOpportunityAction,
  countWeeklySubmittedApplications,
  defaultOpportunityNextAction,
  getOpportunitySubmittedAt,
  getOpportunityDaysUntilDue,
  getOpportunityDueDate,
  getRestorableOpportunityStatus,
  getWeeklyWindow,
  inferDueDateFromText,
  isOpportunityDueSoon,
  opportunityActionPriorityRank,
  opportunityActionValues,
  opportunityStatusAction,
  opportunityStatusFlow,
  opportunityStatusNextAction,
  parseDateLike,
  resolveOpportunityAction,
  shouldAdvanceLinkedOpportunityAfterInterview,
  statusLabel,
  submittedStatuses,
  isSubmittedTimelineEvent,
} from "../shared/opportunityRules.mjs";

export const sourceKindLabel: Record<SourceAsset["kind"], string> = {
  "jd-text": "岗位描述",
  "job-link": "招聘链接",
  screenshot: "页面截图",
  "referral-note": "内推记录",
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
