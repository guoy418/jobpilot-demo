import { describe, expect, it } from "vitest";

import type { TodayAction } from "../selectors";
import {
  getTodayActionHistoryForDate,
  isTodayCreatedRecordHistoryItem,
  parseTodayActionHistory,
  recordTodayCreatedRecord,
  recordShownTodayActions,
  recordTodayActionResolution,
  summarizeTodayActionHistoryDate,
} from "./todayActionHistory";

const makeAction = (overrides: Partial<TodayAction> = {}): TodayAction => ({
  level: "P1",
  title: "投递示例公司前端实习",
  detail: "补充简历 / 使用 FE v1",
  page: "opportunityDetail",
  filter: "P1",
  source: "opportunity",
  sourceLabel: "岗位推进 / 示例公司",
  targetId: "opp-1",
  ...overrides,
});

describe("today action history", () => {
  it("records shown snapshots once per day and action key", () => {
    const action = makeAction();
    const first = recordShownTodayActions([], [action, action], "2026-06-26", "2026-06-26T09:00:00.000Z");
    const second = recordShownTodayActions(first, [action], "2026-06-26", "2026-06-26T10:00:00.000Z");

    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(first[0]).toMatchObject({
      date: "2026-06-26",
      title: "投递示例公司前端实习",
      status: "shown",
      shownAt: "2026-06-26T09:00:00.000Z",
    });
  });

  it("updates an existing snapshot to completed without replacing the original copy", () => {
    const action = makeAction();
    const shown = recordShownTodayActions([], [action], "2026-06-26", "2026-06-26T09:00:00.000Z");
    const completed = recordTodayActionResolution(
      shown,
      makeAction({ title: "后续标题变化" }),
      "completed",
      "2026-06-26",
      "2026-06-26T11:30:00.000Z",
    );

    expect(completed[0]).toMatchObject({
      title: "投递示例公司前端实习",
      status: "completed",
      resolvedAt: "2026-06-26T11:30:00.000Z",
    });
  });

  it("can create resolved records even if shown was not written first", () => {
    const dismissed = recordTodayActionResolution([], makeAction({ source: "weekly", page: "weekly", taskId: "task-1" }), "dismissed", "2026-06-26", "2026-06-26T12:00:00.000Z");
    const summary = summarizeTodayActionHistoryDate(dismissed);

    expect(dismissed[0]).toMatchObject({
      status: "dismissed",
      shownAt: "2026-06-26T12:00:00.000Z",
      resolvedAt: "2026-06-26T12:00:00.000Z",
    });
    expect(summary).toEqual({ total: 1, actionTotal: 1, created: 0, completed: 0, dismissed: 1, shown: 0 });
  });

  it("parses legacy action history and created record history", () => {
    const parsed = parseTodayActionHistory(
      JSON.stringify([
        {
          id: "2026-06-26:opportunity:opp-1",
          date: "2026-06-26",
          actionKey: "opportunity:opp-1",
          source: "opportunity",
          title: "投递示例公司前端实习",
          detail: "补充简历",
          level: "P1",
          status: "shown",
          shownAt: "2026-06-26T09:00:00.000Z",
        },
        {
          kind: "created",
          id: "2026-06-26:created:opportunity:opp-2",
          date: "2026-06-26",
          recordKey: "opportunity:opp-2",
          recordType: "opportunity",
          recordTypeLabel: "岗位",
          title: "示例公司 前端实习",
          detail: "上海 · 补齐材料后投递",
          targetId: "opp-2",
          createdAt: "2026-06-26T10:00:00.000Z",
        },
        { title: "invalid" },
      ]),
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ kind: "action", actionKey: "opportunity:opp-1" });
    expect(parsed[1]).toMatchObject({ kind: "created", recordType: "opportunity", title: "示例公司 前端实习" });
  });

  it("records created records once and reads them by date", () => {
    const first = recordTodayCreatedRecord(
      [],
      {
        recordType: "answer",
        title: "项目复盘怎么讲",
        detail: "背景 -> 动作 -> 结果",
        targetId: "answer-1",
        recordKey: "answer:answer-1",
      },
      "2026-06-26",
      "2026-06-26T13:00:00.000Z",
    );
    const second = recordTodayCreatedRecord(
      first,
      {
        recordType: "answer",
        title: "项目复盘怎么讲",
        targetId: "answer-1",
        recordKey: "answer:answer-1",
      },
      "2026-06-26",
      "2026-06-26T13:05:00.000Z",
    );
    const dateItems = getTodayActionHistoryForDate(second, "2026-06-26");
    const created = dateItems.filter(isTodayCreatedRecordHistoryItem);
    const summary = summarizeTodayActionHistoryDate(dateItems);

    expect(second).toBe(first);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      kind: "created",
      recordType: "answer",
      recordTypeLabel: "答案卡",
      createdAt: "2026-06-26T13:00:00.000Z",
    });
    expect(summary).toEqual({ total: 1, actionTotal: 0, created: 1, completed: 0, dismissed: 0, shown: 0 });
  });

  it("reads action and created history for the same date", () => {
    const action = makeAction();
    const shown = recordShownTodayActions([], [action], "2026-06-26", "2026-06-26T09:00:00.000Z");
    const history = recordTodayCreatedRecord(
      shown,
      {
        recordType: "weekly",
        title: "练一道笔试题",
        detail: "自主训练",
        targetId: "task-1",
        recordKey: "weekly:task-1",
      },
      "2026-06-26",
      "2026-06-26T14:00:00.000Z",
    );

    expect(getTodayActionHistoryForDate(history, "2026-06-25")).toEqual([]);
    expect(getTodayActionHistoryForDate(history, "2026-06-26")).toHaveLength(2);
    expect(summarizeTodayActionHistoryDate(history)).toEqual({
      total: 2,
      actionTotal: 1,
      created: 1,
      completed: 0,
      dismissed: 0,
      shown: 1,
    });
  });
});
