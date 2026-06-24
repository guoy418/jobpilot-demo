export const statusLabel = {
  "TO APPLY": "待投递",
  APPLIED: "已投递",
  "WRITTEN TEST": "准备笔试",
  SCREENING: "筛选中",
  INTERVIEWING: "准备面试",
  WAITING: "等结果",
  OFFER: "Offer",
  ENDED: "已结束",
};

export const submittedStatuses = ["APPLIED", "WRITTEN TEST", "SCREENING", "INTERVIEWING", "WAITING", "OFFER"];
export const opportunityStatusFlow = ["TO APPLY", "APPLIED", "WRITTEN TEST", "SCREENING", "INTERVIEWING", "WAITING", "OFFER"];
const submittedTimelinePattern = /已投递|已更新为已投递|更新为已投递|标记已投递|完成(?:内推)?投递|投递(?:完成|成功)|(?:已)?提交(?:申请|材料|简历)?|申请已提交|\bAPPLIED\b/i;

export const opportunityStatusAction = {
  "TO APPLY": "P0",
  APPLIED: "P1",
  "WRITTEN TEST": "P1",
  SCREENING: "P2",
  INTERVIEWING: "P1",
  WAITING: "P2",
  OFFER: "P3",
  ENDED: "P3",
};

export const opportunityStatusNextAction = {
  "TO APPLY": "补齐材料后投递",
  APPLIED: "三天后跟进投递结果",
  "WRITTEN TEST": "完成笔试并同步结果",
  SCREENING: "等待筛选结果",
  INTERVIEWING: "准备下一轮面试",
  WAITING: "等待结果并准备复盘",
  OFFER: "整理 Offer 信息和取舍",
  ENDED: "已结束，保留历史记录",
};

const dayMs = 24 * 60 * 60 * 1000;
export const opportunityActionValues = ["P0", "P1", "P2", "P3"];
export const opportunityActionPriorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
const baseActionRank = {
  "TO APPLY": 1,
  APPLIED: 1,
  "WRITTEN TEST": 1,
  SCREENING: 2,
  INTERVIEWING: 1,
  WAITING: 2,
  OFFER: 3,
  ENDED: 3,
};

export const compareOpportunityActions = (left, right) => opportunityActionPriorityRank[left] - opportunityActionPriorityRank[right];

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (days) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

export const inferDueDateFromText = (deadline = "") => {
  const text = String(deadline).trim();
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

export const getOpportunityDueDate = (opportunity) => opportunity?.dueDate || inferDueDateFromText(opportunity?.deadline);

export const getOpportunityDaysUntilDue = (opportunity) => {
  const dueDate = getOpportunityDueDate(opportunity);
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / dayMs);
};

export const isOpportunityDueSoon = (opportunity) => {
  const daysUntilDue = getOpportunityDaysUntilDue(opportunity);
  return daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 7;
};

export const computeOpportunityAction = ({ status, deadline = "", dueDate = "", match = "MEDIUM", priority = "B" }) => {
  if (status === "ENDED") return "P3";
  if (status === "OFFER") return "P3";

  const daysUntilDue = getOpportunityDaysUntilDue({ deadline, dueDate });
  let rank = baseActionRank[status] ?? opportunityActionPriorityRank.P2;

  if (daysUntilDue !== null) {
    if (daysUntilDue <= 1) rank = 0;
    else if (daysUntilDue <= 3 && status !== "WAITING") rank = Math.min(rank, 1);
    else if (daysUntilDue <= 7 && status === "TO APPLY") rank = Math.min(rank, 1);
  }

  if (status === "TO APPLY" && priority === "A" && match === "HIGH") rank = Math.min(rank, 0);
  else if (priority === "A" && status !== "WAITING") rank = Math.min(rank, 1);

  if (daysUntilDue === null && priority === "C" && match === "LOW" && status === "TO APPLY") rank = Math.max(rank, 2);

  return opportunityActionValues[Math.max(0, Math.min(3, rank))];
};

export const resolveOpportunityAction = (opportunity) => {
  if (opportunity.status === "ENDED") return "P3";
  if (opportunity.actionManual && opportunity.action) return opportunity.action;
  return computeOpportunityAction(opportunity);
};

export const defaultOpportunityNextAction = (status) => opportunityStatusNextAction[status] || opportunityStatusNextAction["TO APPLY"];

export const getRestorableOpportunityStatus = (opportunity, hasLinkedInterviews = false) => {
  if (opportunity.previousStatus && opportunity.previousStatus !== "ENDED") return opportunity.previousStatus;
  if (opportunity.status !== "ENDED") return opportunity.status;
  return hasLinkedInterviews ? "WAITING" : "APPLIED";
};

export const shouldAdvanceLinkedOpportunityAfterInterview = (status) => status === "INTERVIEWING";

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const parseExplicitDateLike = (value = "", now = new Date()) => {
  const text = String(value).trim();

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));

  const cnDateMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
  if (cnDateMatch) return new Date(now.getFullYear(), Number(cnDateMatch[1]) - 1, Number(cnDateMatch[2]));

  const enMonthMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i);
  if (enMonthMatch) {
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(enMonthMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return new Date(now.getFullYear(), monthIndex, Number(enMonthMatch[2]));
  }

  return null;
};

export const parseDateLike = (value = "", now = new Date()) => {
  const text = String(value).trim();
  if (!text || /^next$/i.test(text)) return null;
  if (/^(now|today)$/i.test(text)) return now;

  const explicitDate = parseExplicitDateLike(text, now);
  if (explicitDate) return explicitDate;

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const getCurrentWeekStart = (now = new Date()) => {
  const start = startOfDay(now);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
};

export const getWeeklyWindow = (weeklyPlan, now = new Date()) => {
  const currentWeekStart = getCurrentWeekStart(now);
  const planStart = weeklyPlan?.weekStart ? startOfDay(parseDateLike(weeklyPlan.weekStart, now) ?? currentWeekStart) : currentWeekStart;
  const planEnd = new Date(planStart.getTime() + 7 * dayMs);
  const start = now >= planStart && now < planEnd ? planStart : currentWeekStart;
  return { start, end: new Date(start.getTime() + 7 * dayMs) };
};

export const isSubmittedTimelineEvent = (event) =>
  event?.status === "done" && submittedTimelinePattern.test(`${event.title ?? ""} ${event.detail ?? ""}`);

const getTimelineEventOccurredAt = (event, now = new Date()) => {
  const occurredAtText = String(event?.occurredAt ?? "").trim();
  const explicitTitleDate = parseExplicitDateLike(event?.title ?? "", now);
  if (/^(now|today)$/i.test(occurredAtText) && explicitTitleDate) return explicitTitleDate;

  return parseDateLike(occurredAtText, now) ?? explicitTitleDate;
};

export const getOpportunitySubmittedAt = (opportunity, now = new Date()) => {
  const hasSubmittedStatus =
    submittedStatuses.includes(opportunity.status) ||
    (opportunity.previousStatus ? submittedStatuses.includes(opportunity.previousStatus) : false) ||
    opportunity.status === "ENDED";
  if (!hasSubmittedStatus) return null;

  const submittedEvents = (opportunity.timeline ?? [])
    .filter(isSubmittedTimelineEvent)
    .map((event) => getTimelineEventOccurredAt(event, now))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());
  return submittedEvents[0] ?? null;
};

export const countWeeklySubmittedApplications = (opportunities = [], weeklyPlan, now = new Date()) => {
  const { start, end } = getWeeklyWindow(weeklyPlan, now);
  return opportunities.filter((opportunity) => {
    const submittedAt = getOpportunitySubmittedAt(opportunity, now);
    return submittedAt !== null && submittedAt >= start && submittedAt < end;
  }).length;
};
