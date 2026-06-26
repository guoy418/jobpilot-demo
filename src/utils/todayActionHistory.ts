import type { TodayAction } from "../selectors";
import type {
  OpportunityAction,
  TodayActionHistoryActionItem,
  TodayActionHistoryItem,
  TodayActionHistorySource,
  TodayActionHistoryStatus,
  TodayCreatedRecordHistoryItem,
  TodayCreatedRecordInput,
  TodayCreatedRecordKind,
} from "../types";
import { todayActionKey } from "./todayActions";

export const todayActionHistoryStorageKey = "jobpilot.todayActionHistory.v1";

const historyStatuses = new Set<TodayActionHistoryStatus>(["shown", "completed", "dismissed"]);
const historySources = new Set<TodayActionHistorySource>(["opportunity", "interview", "weekly"]);
const createdRecordTypes = new Set<TodayCreatedRecordKind>(["opportunity", "interview", "answer", "weekly", "resume"]);
const opportunityActions = new Set<OpportunityAction>(["P0", "P1", "P2", "P3"]);
const createdRecordTypeLabel: Record<TodayCreatedRecordKind, string> = {
  opportunity: "岗位",
  interview: "面试复盘",
  answer: "答案卡",
  weekly: "训练任务",
  resume: "简历版本",
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";
const stringOrUndefined = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export const isTodayActionHistoryActionItem = (item: TodayActionHistoryItem): item is TodayActionHistoryActionItem =>
  item.kind !== "created";

export const isTodayCreatedRecordHistoryItem = (item: TodayActionHistoryItem): item is TodayCreatedRecordHistoryItem =>
  item.kind === "created";

const coerceCreatedRecordItem = (value: Record<string, unknown>): TodayCreatedRecordHistoryItem | null => {
  const date = stringOrUndefined(value.date);
  const recordKey = stringOrUndefined(value.recordKey);
  const recordType = stringOrUndefined(value.recordType);
  const title = stringOrUndefined(value.title);
  const createdAt = stringOrUndefined(value.createdAt);
  if (!date || !recordKey || !recordType || !title || !createdAt || !createdRecordTypes.has(recordType as TodayCreatedRecordKind)) return null;

  const safeRecordType = recordType as TodayCreatedRecordKind;
  return {
    kind: "created",
    id: stringOrUndefined(value.id) ?? `${date}:created:${recordKey}`,
    date,
    recordKey,
    recordType: safeRecordType,
    recordTypeLabel: stringOrUndefined(value.recordTypeLabel) ?? createdRecordTypeLabel[safeRecordType],
    title,
    detail: stringOrUndefined(value.detail) ?? "",
    targetId: stringOrUndefined(value.targetId),
    createdAt,
  };
};

const coerceHistoryItem = (value: unknown): TodayActionHistoryItem | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "created") return coerceCreatedRecordItem(value);
  if (value.kind && value.kind !== "action") return null;

  const date = stringOrUndefined(value.date);
  const actionKey = stringOrUndefined(value.actionKey);
  const source = stringOrUndefined(value.source);
  const title = stringOrUndefined(value.title);
  const shownAt = stringOrUndefined(value.shownAt);
  const status = stringOrUndefined(value.status);
  const level = stringOrUndefined(value.level);
  if (!date || !actionKey || !source || !title || !shownAt || !status || !level) return null;
  if (!historySources.has(source as TodayActionHistorySource) || !historyStatuses.has(status as TodayActionHistoryStatus) || !opportunityActions.has(level as OpportunityAction)) return null;

  return {
    kind: "action",
    id: stringOrUndefined(value.id) ?? `${date}:${actionKey}`,
    date,
    actionKey,
    source: source as TodayActionHistorySource,
    sourceLabel: stringOrUndefined(value.sourceLabel),
    title,
    detail: stringOrUndefined(value.detail) ?? "",
    level: level as OpportunityAction,
    targetId: stringOrUndefined(value.targetId),
    taskId: stringOrUndefined(value.taskId),
    status: status as TodayActionHistoryStatus,
    shownAt,
    resolvedAt: stringOrUndefined(value.resolvedAt),
  };
};

export const parseTodayActionHistory = (value: string | null): TodayActionHistoryItem[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerceHistoryItem).filter((item): item is TodayActionHistoryItem => Boolean(item));
  } catch {
    return [];
  }
};

export const createTodayActionHistoryItem = (
  action: TodayAction,
  date: string,
  timestamp: string,
  status: TodayActionHistoryStatus = "shown",
): TodayActionHistoryActionItem => {
  const actionKey = todayActionKey(action);
  return {
    kind: "action",
    id: `${date}:${actionKey}`,
    date,
    actionKey,
    source: action.source,
    sourceLabel: action.sourceLabel,
    title: action.title,
    detail: action.detail,
    level: action.level,
    targetId: action.targetId,
    taskId: action.taskId,
    status,
    shownAt: timestamp,
    resolvedAt: status === "shown" ? undefined : timestamp,
  };
};

export const recordShownTodayActions = (
  history: TodayActionHistoryItem[],
  actions: TodayAction[],
  date: string,
  timestamp: string,
): TodayActionHistoryItem[] => {
  const recordedKeys = new Set(
    history.filter(isTodayActionHistoryActionItem).filter((item) => item.date === date).map((item) => item.actionKey),
  );
  const nextItems: TodayActionHistoryActionItem[] = [];

  actions.forEach((action) => {
    const actionKey = todayActionKey(action);
    if (recordedKeys.has(actionKey)) return;
    recordedKeys.add(actionKey);
    nextItems.push(createTodayActionHistoryItem(action, date, timestamp));
  });

  return nextItems.length ? [...history, ...nextItems] : history;
};

export const recordTodayActionResolution = (
  history: TodayActionHistoryItem[],
  action: TodayAction,
  status: Exclude<TodayActionHistoryStatus, "shown">,
  date: string,
  timestamp: string,
): TodayActionHistoryItem[] => {
  const actionKey = todayActionKey(action);
  let matched = false;
  const nextHistory = history.map((item) => {
    if (!isTodayActionHistoryActionItem(item)) return item;
    if (item.date !== date || item.actionKey !== actionKey) return item;
    matched = true;
    return { ...item, status, resolvedAt: timestamp };
  });

  if (matched) return nextHistory;
  return [...history, createTodayActionHistoryItem(action, date, timestamp, status)];
};

export const createTodayCreatedRecordHistoryItem = (
  record: TodayCreatedRecordInput,
  date: string,
  timestamp: string,
): TodayCreatedRecordHistoryItem => {
  const recordKey = record.recordKey ?? `${record.recordType}:${record.targetId ?? `${timestamp}:${record.title}`}`;
  return {
    kind: "created",
    id: `${date}:created:${recordKey}`,
    date,
    recordKey,
    recordType: record.recordType,
    recordTypeLabel: createdRecordTypeLabel[record.recordType],
    title: record.title,
    detail: record.detail ?? "",
    targetId: record.targetId,
    createdAt: timestamp,
  };
};

export const recordTodayCreatedRecord = (
  history: TodayActionHistoryItem[],
  record: TodayCreatedRecordInput,
  date: string,
  timestamp: string,
): TodayActionHistoryItem[] => {
  const nextItem = createTodayCreatedRecordHistoryItem(record, date, timestamp);
  const exists = history
    .filter(isTodayCreatedRecordHistoryItem)
    .some((item) => item.date === date && item.recordKey === nextItem.recordKey);
  return exists ? history : [...history, nextItem];
};

export const getTodayActionHistoryForDate = (history: TodayActionHistoryItem[], date: string) =>
  history.filter((item) => item.date === date);

export const summarizeTodayActionHistoryDate = (items: TodayActionHistoryItem[]) => {
  const actionItems = items.filter(isTodayActionHistoryActionItem);
  const completed = actionItems.filter((item) => item.status === "completed").length;
  const dismissed = actionItems.filter((item) => item.status === "dismissed").length;
  const created = items.filter(isTodayCreatedRecordHistoryItem).length;
  return {
    total: items.length,
    actionTotal: actionItems.length,
    created,
    completed,
    dismissed,
    shown: actionItems.length - completed - dismissed,
  };
};
