import { computeOpportunityAction, resolveOpportunityAction, submittedStatuses } from "./domain";
import type { AnswerCard, InterviewSession, Opportunity, OpportunityAction, Page, ResumeVersion, WeeklyPlan, WeeklyTask } from "./types";

export type TodayAction = {
  level: OpportunityAction;
  title: string;
  detail: string;
  page: Page;
  filter: string;
  source: "opportunity" | "interview" | "answer" | "weekly";
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

const priorityOrder: Record<OpportunityAction, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const sortTodayActions = (actions: TodayAction[]): TodayAction[] =>
  [...actions].sort((left, right) => priorityOrder[left.level] - priorityOrder[right.level]);

const weeklyActionRoute = (task: WeeklyTask): Pick<TodayAction, "page" | "targetId" | "taskId"> => {
  if (task.source === "interview" && task.relatedEntityId) return { page: "interviews", targetId: task.relatedEntityId, taskId: task.id };
  if (task.source === "opportunity" && task.relatedEntityId) return { page: "opportunityDetail", targetId: task.relatedEntityId, taskId: task.id };
  if (task.source === "answer" && task.relatedEntityId) return { page: "answers", targetId: task.relatedEntityId, taskId: task.id };
  return { page: "weekly", targetId: task.id, taskId: task.id };
};

export const selectDashboardSummary = (
  opportunities: Opportunity[],
  interviewSessions: InterviewSession[],
  weeklyPlan: WeeklyPlan,
): DashboardSummary => {
  const opportunityActions = opportunities.map(resolveOpportunityAction);
  const submittedApplications = opportunities.filter((item) => submittedStatuses.includes(item.status)).length;
  const urgentCount = opportunityActions.filter((action) => action === "P0" || action === "P1").length;
  const pendingReviewCount = interviewSessions.flatMap((item) => item.qaPairs).filter((pair) => pair.weak).length;
  const toApplyCount = opportunities.filter((item) => item.status === "TO APPLY").length;
  const inProgressCount = opportunities.filter((item) => item.status !== "TO APPLY" && item.status !== "OFFER").length;
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
  answerCards: AnswerCard[],
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
      targetId: item.id,
    }));

  const interviewActionItems: TodayAction[] = interviewSessions
    .filter((session) => session.qaPairs.some((pair) => pair.weak))
    .map((session) => ({
      level: "P1",
      title: `复盘${session.company}${session.round}`,
      detail: `${session.qaPairs.filter((pair) => pair.weak).length} 个薄弱回答需要处理`,
      page: "interviews",
      filter: "",
      source: "interview",
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
      ...weeklyActionRoute(task),
    }));

  const openAnswerTaskIds = new Set(
    weeklyPlan.tasks
      .filter((task) => task.status === "open" && task.source === "answer" && task.relatedEntityId)
      .map((task) => task.relatedEntityId),
  );
  const answerActionItems: TodayAction[] = answerCards
    .filter((card) => card.status === "NEEDS PRACTICE" && !openAnswerTaskIds.has(card.id))
    .map((card) => ({
      level: "P2",
      title: `练习答案：${card.question}`,
      detail: `${card.source}: ${card.practiceStatus} / 适用 ${card.relatedRoles || "待补充岗位"}`,
      page: "answers",
      filter: "",
      source: "answer",
      targetId: card.id,
    }));

  const rawTodayActions = [...opportunityActionItems, ...interviewActionItems, ...answerActionItems, ...weeklyActionItems];
  return sortTodayActions(rawTodayActions.filter(
    (action, index, actions) => actions.findIndex((candidate) => candidate.title === action.title) === index,
  ));
};
