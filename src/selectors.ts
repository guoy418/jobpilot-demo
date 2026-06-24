import { compareOpportunityActions, countWeeklySubmittedApplications, resolveOpportunityAction, statusLabel } from "./domain";
import type { AnswerCard, InterviewSession, Opportunity, OpportunityAction, Page, ResumeVersion, WeeklyPlan, WeeklyTask } from "./types";

export type TodayAction = {
  level: OpportunityAction;
  title: string;
  detail: string;
  page: Page;
  filter: string;
  source: "opportunity" | "interview" | "weekly";
  sourceLabel?: string;
  why?: string;
  completionOutcome?: string;
  targetId?: string;
  taskId?: string;
};

export type DashboardSummary = {
  submittedApplications: number;
  urgentCount: number;
  pendingReviewCount: number;
  toApplyCount: number;
  inProgressCount: number;
  p0Count: number;
  p1Count: number;
  weakInterviewCount: number;
  applicationGap: number;
};

export const selectResumeName = (resumeList: ResumeVersion[], resumeId: string) =>
  resumeList.find((resume) => resume.id === resumeId)?.name ?? "未选择简历";

const resolveInterviewReviewPriority = (session: InterviewSession): OpportunityAction => session.reviewPriority ?? "P1";

export const sortTodayActions = (actions: TodayAction[]): TodayAction[] =>
  [...actions].sort((left, right) => compareOpportunityActions(left.level, right.level));

const selectWeeklySubmittedApplications = (opportunities: Opportunity[], weeklyPlan: WeeklyPlan) => {
  return countWeeklySubmittedApplications(opportunities, weeklyPlan);
};

const weeklyActionRoute = (task: WeeklyTask): Pick<TodayAction, "page" | "targetId" | "taskId"> => {
  if (task.source === "interview" && task.relatedEntityId) return { page: "interviews", targetId: task.relatedEntityId, taskId: task.id };
  if (task.source === "opportunity" && task.relatedEntityId) return { page: "opportunityDetail", targetId: task.relatedEntityId, taskId: task.id };
  if (task.source === "answer" && task.relatedEntityId) return { page: "answers", targetId: task.relatedEntityId, taskId: task.id };
  return { page: "weekly", targetId: task.id, taskId: task.id };
};

const opportunityCompletionOutcome = (status: Opportunity["status"]) => {
  if (status === "TO APPLY") return "完成后会标记为已投递，并计入本周投递进度。";
  if (status === "WRITTEN TEST") return "完成后会推进到筛选中，今日行动不再继续催办这一项。";
  if (status === "INTERVIEWING") return "完成后会推进到等结果，后续复盘从面试记录进入训练。";
  return "完成后会按岗位当前阶段推进下一步。";
};

const weeklyTaskReason = (task: WeeklyTask) => {
  if (task.source === "answer") return "这张答案卡已被加入本周计划，所以进入今日行动。";
  if (task.source === "interview") return "这条面试复盘任务已被加入本周计划，需要今天推进。";
  if (task.source === "weekly-focus") return "本周重点被拆成了一个可执行动作。";
  return "这是本周计划中仍未完成的自定义动作。";
};

export const selectDashboardSummary = (
  opportunities: Opportunity[],
  interviewSessions: InterviewSession[],
  weeklyPlan: WeeklyPlan,
): DashboardSummary => {
  const activeOpportunities = opportunities.filter((item) => item.status !== "ENDED");
  const opportunityActions = activeOpportunities.map(resolveOpportunityAction);
  const submittedApplications = selectWeeklySubmittedApplications(opportunities, weeklyPlan);
  const urgentCount = opportunityActions.filter((action) => action === "P0" || action === "P1").length;
  const pendingReviewCount = interviewSessions.flatMap((item) => item.qaPairs).filter((pair) => pair.weak).length;
  const toApplyCount = activeOpportunities.filter((item) => item.status === "TO APPLY").length;
  const inProgressCount = activeOpportunities.filter((item) => item.status !== "TO APPLY" && item.status !== "OFFER").length;
  const p0Count = opportunityActions.filter((action) => action === "P0").length;
  const p1Count = opportunityActions.filter((action) => action === "P1").length;
  const weakInterviewCount = interviewSessions.filter((item) => item.qaPairs.some((pair) => pair.weak)).length;
  const applicationGap = Math.max(0, weeklyPlan.targetApplications - submittedApplications);

  return {
    submittedApplications,
    urgentCount,
    pendingReviewCount,
    toApplyCount,
    inProgressCount,
    p0Count,
    p1Count,
    weakInterviewCount,
    applicationGap,
  };
};

export const selectTodayActions = (
  opportunities: Opportunity[],
  interviewSessions: InterviewSession[],
  _answerCards: AnswerCard[],
  weeklyPlan: WeeklyPlan,
  resumeList: ResumeVersion[],
): TodayAction[] => {
  const opportunityActionItems: TodayAction[] = opportunities
    .filter((item) => item.status === "TO APPLY" || item.status === "WRITTEN TEST" || item.status === "INTERVIEWING")
    .map((item) => ({
      level: resolveOpportunityAction(item),
      title:
        item.status === "TO APPLY"
          ? `投递${item.company}${item.title}`
          : item.status === "WRITTEN TEST"
            ? `完成${item.company}${item.title}笔试`
            : item.status === "INTERVIEWING"
              ? `准备${item.company}${item.title}`
              : `跟进${item.company}${item.title}`,
      detail: `${item.nextAction} / 使用 ${selectResumeName(resumeList, item.resumeId)}`,
      page: "opportunityDetail",
      filter: resolveOpportunityAction(item),
      source: "opportunity",
      sourceLabel: `岗位推进 / ${item.company}`,
      why: `${statusLabel[item.status]}阶段仍有下一步动作，优先级由状态、截止时间、匹配度和主观优先级计算。`,
      completionOutcome: opportunityCompletionOutcome(item.status),
      targetId: item.id,
    }));

  const interviewActionItems: TodayAction[] = interviewSessions
    .filter((session) => session.qaPairs.some((pair) => pair.weak))
    .map((session) => ({
      level: resolveInterviewReviewPriority(session),
      title: `复盘${session.company}${session.round}`,
      detail: `${session.qaPairs.filter((pair) => pair.weak).length} 个薄弱回答需要处理`,
      page: "interviews",
      filter: "",
      source: "interview",
      sourceLabel: `面试复盘 / ${session.company}${session.round}`,
      why: "复盘里还有标记为薄弱的问题，适合今天先补框架或重讲。",
      completionOutcome: "完成后这些薄弱问题会被标记为已处理；如需持续练习，可加入本周计划。",
      targetId: session.id,
    }));

  const weeklyActionItems: TodayAction[] = weeklyPlan.tasks
    .filter((task) => task.status === "open" && task.source !== "opportunity")
    .map((task) => ({
      level: task.level ?? "P2",
      title: task.title,
      detail: `${task.sourceLabel}: ${task.detail}`,
      filter: "",
      source: "weekly",
      sourceLabel: `${task.sourceLabel || "本周计划"} / ${task.source === "answer" ? "答案练习" : task.source === "interview" ? "面试练习" : "计划动作"}`,
      why: weeklyTaskReason(task),
      completionOutcome: "完成后会标记本周计划任务为 done，并从今日行动移除。",
      ...weeklyActionRoute(task),
    }));

  const rawTodayActions = [...opportunityActionItems, ...interviewActionItems, ...weeklyActionItems];
  return sortTodayActions(rawTodayActions.filter(
    (action, index, actions) => actions.findIndex((candidate) => candidate.title === action.title) === index,
  ));
};
