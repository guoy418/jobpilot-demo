import type { OpportunityAction, OpportunityMatch, OpportunityPriority, OpportunityStatus } from "../src/types";

type OpportunityDeadlineLike = {
  deadline?: string;
  dueDate?: string | null;
};

type OpportunityActionInput = OpportunityDeadlineLike & {
  status: OpportunityStatus;
  match?: OpportunityMatch;
  priority?: OpportunityPriority;
};

type OpportunityActionLike = OpportunityActionInput & {
  action?: OpportunityAction;
  actionManual?: boolean;
};

type RestorableOpportunityLike = {
  previousStatus?: OpportunityStatus | null;
  status: OpportunityStatus;
};

type WeeklyPlanLike = {
  weekStart?: string;
};

export const statusLabel: Record<OpportunityStatus, string>;
export const submittedStatuses: OpportunityStatus[];
export const opportunityStatusFlow: OpportunityStatus[];
export const opportunityStatusAction: Record<OpportunityStatus, OpportunityAction>;
export const opportunityStatusNextAction: Record<OpportunityStatus, string>;
export const opportunityActionValues: OpportunityAction[];
export const opportunityActionPriorityRank: Record<OpportunityAction, number>;
export const compareOpportunityActions: (left: OpportunityAction, right: OpportunityAction) => number;
export const inferDueDateFromText: (deadline?: string) => string;
export const getOpportunityDueDate: (opportunity: OpportunityDeadlineLike) => string;
export const getOpportunityDaysUntilDue: (opportunity: OpportunityDeadlineLike) => number | null;
export const isOpportunityDueSoon: (opportunity: OpportunityDeadlineLike) => boolean;
export const computeOpportunityAction: (input: OpportunityActionInput) => OpportunityAction;
export const resolveOpportunityAction: (opportunity: OpportunityActionLike) => OpportunityAction;
export const defaultOpportunityNextAction: (status: OpportunityStatus) => string;
export const getRestorableOpportunityStatus: (
  opportunity: RestorableOpportunityLike,
  hasLinkedInterviews?: boolean,
) => Exclude<OpportunityStatus, "ENDED">;
export const shouldAdvanceLinkedOpportunityAfterInterview: (status: OpportunityStatus) => boolean;
export const parseDateLike: (value?: string, now?: Date) => Date | null;
export const getWeeklyWindow: (weeklyPlan?: WeeklyPlanLike | null, now?: Date) => { start: Date; end: Date };
import type { Opportunity, OpportunityAction, OpportunityMatch, OpportunityPriority, OpportunityStatus } from "../src/types";

type ActionInput = {
  status?: OpportunityStatus;
  deadline?: string;
  dueDate?: string;
  match?: OpportunityMatch | "";
  priority?: OpportunityPriority | "";
};

type RestorableOpportunityInput = Pick<Opportunity, "status" | "previousStatus">;
type ResolveOpportunityInput = ActionInput & Pick<Opportunity, "status"> & Partial<Pick<Opportunity, "action" | "actionManual">>;

export const statusLabel: Record<OpportunityStatus, string>;
export const submittedStatuses: OpportunityStatus[];
export const opportunityStatusFlow: OpportunityStatus[];
export const opportunityStatusAction: Record<OpportunityStatus, OpportunityAction>;
export const opportunityStatusNextAction: Record<OpportunityStatus, string>;
export const opportunityActionValues: OpportunityAction[];
export const opportunityActionPriorityRank: Record<OpportunityAction, number>;

export const compareOpportunityActions: (left: OpportunityAction, right: OpportunityAction) => number;
export const inferDueDateFromText: (deadline?: string) => string;
export const getOpportunityDueDate: (opportunity: Pick<ActionInput, "deadline" | "dueDate">) => string;
export const getOpportunityDaysUntilDue: (opportunity: Pick<ActionInput, "deadline" | "dueDate">) => number | null;
export const isOpportunityDueSoon: (opportunity: Pick<ActionInput, "deadline" | "dueDate">) => boolean;
export const computeOpportunityAction: (input: ActionInput) => OpportunityAction;
export const resolveOpportunityAction: (opportunity: ResolveOpportunityInput) => OpportunityAction;
export const defaultOpportunityNextAction: (status: OpportunityStatus) => string;
export const getRestorableOpportunityStatus: (opportunity: RestorableOpportunityInput, hasLinkedInterviews?: boolean) => Exclude<OpportunityStatus, "ENDED">;
export const shouldAdvanceLinkedOpportunityAfterInterview: (status: OpportunityStatus) => boolean;
export const parseDateLike: (value?: string, now?: Date) => Date | null;
export const getWeeklyWindow: (weeklyPlan?: { weekStart?: string } | null, now?: Date) => { start: Date; end: Date };
