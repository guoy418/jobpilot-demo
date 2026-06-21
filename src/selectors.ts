import { computeOpportunityAction, resolveOpportunityAction, statusLabel, submittedStatuses } from "./domain";
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

const priorityOrder: Record<OpportunityAction, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const dayMs = 24 * 60 * 60 * 1000;
const submittedTimelinePattern = /投递|已投递|\bAPPLIED\b/i;
const resolveInterviewReviewPriority = (session: InterviewSession): OpportunityAction => session.reviewPriority ?? "P1";

export const sortTodayActions = (actions: TodayAction[]): TodayAction[] =>
  [...actions].sort((left, right) => priorityOrder[left.level] - priorityOrder[right.level]);

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const parseDateLike = (value = "", now = new Date()): Date | null => {
  const text = value.trim();
  if (!text || /^next$/i.test(text)) return null;
  if (/^(now|today)$/i.test(text)) return now;

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));

  const cnDateMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
  if (cnDateMatch) return new Date(now.getFullYear(), Number(cnDateMatch[1]) - 1, Number(cnDateMatch[2]));

  const enMonthMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i);
  if (enMonthMatch) {
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(enMonthMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return new Date(now.getFullYear(), monthIndex, Number(enMonthMatch[2]));
  }

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const getCurrentWeekStart = (now = new Date()) => {
  const start = startOfDay(now);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
};

const getWeeklyWindow = (weeklyPlan: WeeklyPlan, now = new Date()) => {
  const currentWeekStart = getCurrentWeekStart(now);
  const planStart = weeklyPlan.weekStart ? startOfDay(parseDateLike(weeklyPlan.weekStart, now) ?? currentWeekStart) : currentWeekStart;
  const planEnd = new Date(planStart.getTime() + 7 * dayMs);
  const start = now >= planStart && now < planEnd ? planStart : currentWeekStart;
  return { start, end: new Date(start.getTime() + 7 * dayMs) };
};

const getSubmittedAt = (opportunity: Opportunity, now = new Date()) => {
  if (!submittedStatuses.includes(opportunity.status)) return null;
  return opportunity.timeline
    .filter((event) => event.status === "done" && submittedTimelinePattern.test(`${event.title} ${event.detail}`))
    .map((event) => parseDateLike(event.occurredAt, now))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
};

const selectWeeklySubmittedApplications = (opportunities: Opportunity[], weeklyPlan: WeeklyPlan) => {
  const now = new Date();
  const { start, end } = getWeeklyWindow(weeklyPlan, now);
  return opportunities.filter((opportunity) => {
    const submittedAt = getSubmittedAt(opportunity, now);
    return submittedAt !== null && submittedAt >= start && submittedAt < end;
  }).length;
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
  const opportunityActions = opportunities.map(resolveOpportunityAction);
  const submittedApplications = selectWeeklySubmittedApplications(opportunities, weeklyPlan);
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
