import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardSummary, TodayAction } from "../selectors";
import type { TimelineEvent, WeeklyTask } from "../types";
import { formatDueDateDisplay, localDateKey } from "./date";
import { BACKUP_SCHEMA_VERSION, getBackupRestorePreview, migrateBackupPayload } from "./backup";
import { formatOpportunityHistory, parseOpportunityHistory } from "./opportunityHistory";
import { paginateList, paginateWeeklyGroupTasks } from "./pagination";
import { normalizeDashboardSummary, normalizeTodayActions, todayActionKey } from "./todayActions";

afterEach(() => {
  vi.useRealTimers();
});

describe("date utilities", () => {
  it("formats local dates and normalizes due date strings", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatDueDateDisplay("2026/1/5")).toBe("2026-01-05");
    expect(formatDueDateDisplay("2026-02-03T10:30:00.000Z")).toBe("2026-02-03");
    expect(formatDueDateDisplay("  next round  ")).toBe("next round");
    expect(formatDueDateDisplay(null)).toBe("");
  });
});

describe("pagination utilities", () => {
  const tasks = Array.from(
    { length: 7 },
    (_, index): WeeklyTask => ({
      id: `task-${index}`,
      title: `Task ${index}`,
      detail: "",
      source: "manual",
      sourceLabel: "Manual",
      status: "open",
    }),
  );

  it("clamps generic lists to valid pages", () => {
    expect(paginateList([1, 2, 3, 4, 5, 6, 7], 99, 3)).toEqual({
      pageCount: 3,
      safePage: 2,
      visible: [7],
    });
  });

  it("keeps the practice group first page intentionally shorter", () => {
    expect(paginateWeeklyGroupTasks(tasks, 0, "practice").visible.map((task) => task.id)).toEqual([
      "task-0",
      "task-1",
      "task-2",
      "task-3",
      "task-4",
    ]);
    expect(paginateWeeklyGroupTasks(tasks, 9, "practice")).toMatchObject({
      pageCount: 2,
      safePage: 1,
      visible: tasks.slice(5),
    });
  });
});

describe("today action utilities", () => {
  const fallbackSummary: DashboardSummary = {
    submittedApplications: 1,
    urgentCount: 2,
    pendingReviewCount: 3,
    toApplyCount: 4,
    inProgressCount: 5,
    p0Count: 6,
    p1Count: 7,
    weakInterviewCount: 8,
    applicationGap: 9,
  };

  const fallbackActions: TodayAction[] = [
    {
      level: "P1",
      title: "Fallback",
      detail: "Existing local action",
      page: "weekly",
      filter: "",
      source: "weekly",
    },
  ];

  it("normalizes dashboard API summaries with safe fallbacks", () => {
    expect(
      normalizeDashboardSummary(
        {
          submittedApplications: 12,
          urgentCount: Number.NaN,
          weakQaCount: 14,
        },
        fallbackSummary,
      ),
    ).toMatchObject({
      submittedApplications: fallbackSummary.submittedApplications,
      urgentCount: fallbackSummary.urgentCount,
      pendingReviewCount: 14,
      applicationGap: fallbackSummary.applicationGap,
    });
  });

  it("normalizes API today actions and falls back when none are usable", () => {
    expect(normalizeTodayActions([{ title: "Missing page" }], fallbackActions)).toBe(fallbackActions);

    const [action] = normalizeTodayActions(
      [
        {
          title: "Apply",
          targetPage: "opportunityDetail",
          targetId: "opp-1",
        },
      ],
      fallbackActions,
    );

    expect(action).toEqual({
      level: "P2",
      title: "Apply",
      detail: "",
      page: "opportunityDetail",
      filter: "",
      source: "opportunity",
      sourceLabel: undefined,
      why: undefined,
      completionOutcome: undefined,
      targetId: "opp-1",
      taskId: undefined,
    });
    expect(todayActionKey(action)).toBe("opportunity:opp-1");
  });
});

describe("backup restore preview", () => {
  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: "2026-06-23T00:00:00.000Z",
    source: "test",
    opportunities: [{ id: "OP-1" }],
    resumeVersions: [{ id: "RV-1" }],
    interviewSessions: [
      { id: "INT-1", qaPairs: [] },
      { id: "INT-2", qaPairs: [] },
    ],
    answerCards: [{ id: "AC-1" }, { id: "AC-2" }, { id: "AC-3" }],
    answerCategories: [{ id: "CAT-1" }],
    weeklyPlan: {
      targetApplications: 3,
      focusDirections: [],
      focusCities: [],
      focusCompanies: [],
      practiceThemes: [],
      tasks: [{ id: "WT-1" }, { id: "WT-2" }],
    },
    storedFiles: [],
  };

  it("passes the current backup version through migration unchanged", () => {
    expect(migrateBackupPayload(backup)).toBe(backup);
  });

  it("summarizes restorable backup counts before applying", () => {
    expect(getBackupRestorePreview(backup)).toMatchObject({
      ok: true,
      summary: {
        opportunities: 1,
        resumes: 1,
        interviews: 2,
        answerCards: 3,
        weeklyTasks: 2,
      },
    });
  });

  it("previews a migrated legacy backup consistently", () => {
    const legacyBackup = {
      ...backup,
      schemaVersion: "jobpilot-v0.7",
      source: undefined,
      exportedAt: undefined,
      answerCategories: undefined,
      answerCards: backup.answerCards.map((answer) => ({ ...answer, categoryId: undefined })),
      weeklyPlan: {
        ...backup.weeklyPlan,
        focusCities: undefined,
        focusCompanies: undefined,
        practiceThemes: undefined,
      },
      storedFiles: undefined,
    };

    const preview = getBackupRestorePreview(legacyBackup);

    expect(preview).toMatchObject({
      ok: true,
      summary: {
        opportunities: 1,
        resumes: 1,
        interviews: 2,
        answerCards: 3,
        weeklyTasks: 2,
      },
    });
    expect(preview.ok ? preview.backup.schemaVersion : "").toBe(BACKUP_SCHEMA_VERSION);
    expect(preview.ok ? preview.backup.answerCategories.map((category) => category.id) : []).toContain("CAT-UNCATEGORIZED");
  });

  it("rejects unsupported schemas before previewing restore", () => {
    expect(getBackupRestorePreview({ ...backup, schemaVersion: "jobpilot-v0.1" })).toMatchObject({
      ok: false,
    });
  });
});

describe("opportunity history utilities", () => {
  const timeline: TimelineEvent[] = [
    {
      id: "done-1",
      occurredAt: "2026-06-01",
      title: "Submitted",
      detail: "Portal",
      status: "done",
    },
    {
      id: "next-1",
      occurredAt: "Next",
      title: "Follow up",
      detail: "",
      status: "next",
    },
  ];

  it("formats only completed history entries", () => {
    expect(formatOpportunityHistory(timeline)).toBe("2026-06-01 Submitted - Portal");
  });

  it("parses edited history while preserving existing done ids and next events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T00:00:00.000Z"));

    expect(parseOpportunityHistory("2026-06-02 Screen - Passed\nManual note - Needs referral", timeline)).toEqual([
      {
        id: "done-1",
        occurredAt: "2026-06-02",
        title: "Screen",
        detail: "Passed",
        status: "done",
      },
      {
        id: "TL-HISTORY-1782172800000-1",
        occurredAt: "",
        title: "Manual note",
        detail: "Needs referral",
        status: "done",
      },
      timeline[1],
    ]);
  });
});
