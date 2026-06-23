import { afterEach, describe, expect, it, vi } from "vitest";

import type { TimelineEvent, WeeklyTask } from "../types";
import { formatDueDateDisplay } from "./date";
import { formatOpportunityHistory, parseOpportunityHistory } from "./opportunityHistory";
import { clampListPage, listPageCount, paginateList, paginateWeeklyGroupTasks } from "./pagination";

afterEach(() => {
  vi.useRealTimers();
});

const makeTask = (index: number): WeeklyTask => ({
  id: `task-${index}`,
  title: `Task ${index}`,
  detail: "",
  source: "manual",
  sourceLabel: "Manual",
  status: "open",
});

describe("pagination boundary guardrails", () => {
  it("keeps empty lists on a single safe page", () => {
    expect(listPageCount(0, 6)).toBe(1);
    expect(clampListPage(-10, 1)).toBe(0);
    expect(paginateList([], 5, 6)).toEqual({
      pageCount: 1,
      safePage: 0,
      visible: [],
    });
  });

  it("clamps negative and overflow page requests without changing visible order", () => {
    const items = ["a", "b", "c", "d", "e"];

    expect(paginateList(items, -1, 2)).toEqual({
      pageCount: 3,
      safePage: 0,
      visible: ["a", "b"],
    });

    expect(paginateList(items, 99, 2)).toEqual({
      pageCount: 3,
      safePage: 2,
      visible: ["e"],
    });
  });

  it("uses the special weekly practice first page boundary exactly at five tasks", () => {
    const fivePracticeTasks = Array.from({ length: 5 }, (_, index) => makeTask(index));
    const sixPracticeTasks = Array.from({ length: 6 }, (_, index) => makeTask(index));

    expect(paginateWeeklyGroupTasks(fivePracticeTasks, 0, "practice")).toEqual({
      pageCount: 1,
      safePage: 0,
      visible: fivePracticeTasks,
    });

    expect(paginateWeeklyGroupTasks(sixPracticeTasks, 1, "practice")).toEqual({
      pageCount: 2,
      safePage: 1,
      visible: [sixPracticeTasks[5]],
    });
  });
});

describe("opportunity history parsing guardrails", () => {
  it("formats completed history while omitting placeholder dates and future next steps", () => {
    const timeline: TimelineEvent[] = [
      { id: "done-1", occurredAt: "历史", title: "导入岗位", detail: "", status: "done" },
      { id: "done-2", occurredAt: "2026-06-22", title: "完成投递", detail: "官网", status: "done" },
      { id: "next-1", occurredAt: "Next", title: "跟进 HR", detail: "", status: "next" },
    ];

    expect(formatOpportunityHistory(timeline)).toBe("导入岗位\n2026-06-22 完成投递 - 官网");
  });

  it("parses mixed date prefixes, preserves detail separators, and carries existing next steps forward", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    const existingNext: TimelineEvent = {
      id: "next-1",
      occurredAt: "Next",
      title: "准备笔试",
      detail: "",
      status: "next",
    };

    const parsed = parseOpportunityHistory("10.1 投递岗位 - 官网 - 内推\nNext 跟进 HR\n无日期备注 - 需要补材料", [existingNext]);

    expect(parsed).toEqual([
      {
        id: expect.stringMatching(/^TL-HISTORY-\d+-0$/),
        occurredAt: "10.1",
        title: "投递岗位",
        detail: "官网 - 内推",
        status: "done",
      },
      {
        id: expect.stringMatching(/^TL-HISTORY-\d+-1$/),
        occurredAt: "Next",
        title: "跟进 HR",
        detail: "",
        status: "done",
      },
      {
        id: expect.stringMatching(/^TL-HISTORY-\d+-2$/),
        occurredAt: "",
        title: "无日期备注",
        detail: "需要补材料",
        status: "done",
      },
      existingNext,
    ]);
  });
});

describe("date display guardrails", () => {
  it("normalizes slash-separated dates and preserves unparseable labels", () => {
    expect(formatDueDateDisplay("2026/6/3")).toBe("2026-06-03");
    expect(formatDueDateDisplay("  next hiring batch  ")).toBe("next hiring batch");
  });
});
