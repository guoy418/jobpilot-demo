import { useEffect, useMemo, useState } from "react";
import type { TodayAction } from "../selectors";
import type { TodayActionHistoryItem, TodayActionHistoryStatus, TodayCreatedRecordInput } from "../types";
import { localDateKey } from "../utils/date";
import {
  parseTodayActionHistory,
  recordShownTodayActions,
  recordTodayActionResolution,
  recordTodayCreatedRecord,
  todayActionHistoryStorageKey,
} from "../utils/todayActionHistory";
import { todayActionKey } from "../utils/todayActions";

const readHistory = () => {
  if (typeof window === "undefined") return [];
  return parseTodayActionHistory(window.localStorage.getItem(todayActionHistoryStorageKey));
};

const writeHistory = (items: TodayActionHistoryItem[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(todayActionHistoryStorageKey, JSON.stringify(items));
};

export function useTodayActionHistory(actions: TodayAction[]) {
  const [historyItems, setHistoryItems] = useState<TodayActionHistoryItem[]>(readHistory);
  const todayActionSignature = useMemo(() => actions.map(todayActionKey).join("|"), [actions]);

  useEffect(() => {
    const date = localDateKey();
    const timestamp = new Date().toISOString();
    setHistoryItems((items) => recordShownTodayActions(items, actions, date, timestamp));
  }, [todayActionSignature]);

  useEffect(() => {
    try {
      writeHistory(historyItems);
    } catch {
      // History is helpful context, but should never block the daily workflow.
    }
  }, [historyItems]);

  const recordResolved = (action: TodayAction, status: Exclude<TodayActionHistoryStatus, "shown">) => {
    const date = localDateKey();
    const timestamp = new Date().toISOString();
    setHistoryItems((items) => recordTodayActionResolution(items, action, status, date, timestamp));
  };

  const recordCreated = (record: TodayCreatedRecordInput) => {
    const date = localDateKey();
    const timestamp = new Date().toISOString();
    setHistoryItems((items) => recordTodayCreatedRecord(items, record, date, timestamp));
  };

  return {
    historyItems,
    recordCompletedTodayAction: (action: TodayAction) => recordResolved(action, "completed"),
    recordDismissedTodayAction: (action: TodayAction) => recordResolved(action, "dismissed"),
    recordCreatedTodayRecord: recordCreated,
    recordResolvedTodayAction: recordResolved,
  };
}
