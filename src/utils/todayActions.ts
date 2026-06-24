import type { DashboardSummary, TodayAction } from "../selectors";
import type { Page } from "../types";

export type ApiDashboardSummary = Partial<DashboardSummary> & {
  weakQaCount?: number;
};

export type ApiTodayAction = Partial<TodayAction> & {
  targetPage?: Page;
};

const validTodayActionPages = new Set<Page>(["home", "opportunities", "opportunityDetail", "interviews", "answers", "resumes", "weekly", "exports"]);

const numberWithFallback = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const todayActionKey = (action: Pick<TodayAction, "page" | "title" | "targetId"> & Partial<Pick<TodayAction, "source" | "taskId">>) =>
  `${action.source ?? action.page}:${action.taskId ?? action.targetId ?? action.title}`;

export const todayActionSourceLabel = (action: TodayAction) => {
  if (action.source === "opportunity") return "岗位";
  if (action.source === "interview") return "面试";
  if (action.source === "weekly") return "训练";
  return "待办";
};

export const todayActionSourceDetail = (action: TodayAction) => action.sourceLabel || todayActionSourceLabel(action);

export const todayActionReason = (action: TodayAction) => {
  if (action.why) return action.why;
  if (action.source === "opportunity") return "岗位当前阶段还有下一步动作，优先级来自状态、截止时间和岗位权重。";
  if (action.source === "interview") return "面试复盘中仍有薄弱或待整理问题。";
  return "本周计划中有仍未完成的行动。";
};

export const todayActionOutcome = (action: TodayAction) => {
  if (action.completionOutcome) return action.completionOutcome;
  if (action.source === "opportunity") return "完成后会推进岗位状态，并从今日行动移除。";
  if (action.source === "interview") return "完成后会标记复盘问题已处理；需要长期练习时请加入本周计划。";
  return "完成后会标记本周计划任务为 done。";
};

export const normalizeDashboardSummary = (summary: ApiDashboardSummary | null, fallback: DashboardSummary): DashboardSummary => ({
  submittedApplications: fallback.submittedApplications,
  urgentCount: numberWithFallback(summary?.urgentCount, fallback.urgentCount),
  pendingReviewCount: numberWithFallback(summary?.pendingReviewCount ?? summary?.weakQaCount, fallback.pendingReviewCount),
  toApplyCount: numberWithFallback(summary?.toApplyCount, fallback.toApplyCount),
  inProgressCount: numberWithFallback(summary?.inProgressCount, fallback.inProgressCount),
  p0Count: numberWithFallback(summary?.p0Count, fallback.p0Count),
  p1Count: numberWithFallback(summary?.p1Count, fallback.p1Count),
  weakInterviewCount: numberWithFallback(summary?.weakInterviewCount, fallback.weakInterviewCount),
  applicationGap: fallback.applicationGap,
});

export const normalizeTodayActions = (actions: ApiTodayAction[] | null, fallback: TodayAction[]): TodayAction[] => {
  if (!actions?.length) return fallback;
  const normalizedActions = actions.reduce<TodayAction[]>((items, action) => {
    const page = action.page ?? action.targetPage;
    if (!page || !validTodayActionPages.has(page) || !action.title) return items;
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
