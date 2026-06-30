import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isSubmittedTimelineEvent, statusLabel, submittedStatuses } from "../shared/opportunityRules.mjs";

const testContexts = [];

const openTestRepository = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-db-"));
  process.env.JOBPILOT_DB_PATH = path.join(root, "jobpilot.sqlite");
  process.env.JOBPILOT_FILE_DIR = path.join(root, "files");
  vi.resetModules();
  const { createRepository, openDatabase } = await import("./db.mjs");
  const db = openDatabase();
  const repo = createRepository(db);
  testContexts.push({ db, root });
  return repo;
};

const makeOpportunityInput = (id, overrides = {}) => ({
  id,
  title: "前端实习生",
  company: "测试公司",
  status: "TO APPLY",
  priority: "B",
  match: "MEDIUM",
  action: "P2",
  city: "上海",
  deadline: "待定",
  note: "",
  resumeId: "RV-101",
  nextAction: "补齐材料后投递",
  jdSummary: "测试岗位",
  jdText: "测试 JD",
  sourceAssets: [],
  timeline: [{ id: `${id}-created`, occurredAt: "2026-06-24", title: "写入岗位推进", detail: "测试创建", status: "done" }],
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  for (const { db, root } of testContexts.splice(0)) {
    db.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.JOBPILOT_DB_PATH;
  delete process.env.JOBPILOT_FILE_DIR;
  vi.resetModules();
});

describe("repository opportunity progress submitted guardrails", () => {
  it("counts direct creation in a submitted-or-later status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 10));
    const repo = await openTestRepository();

    const before = repo.getDashboardSummary().submittedApplications;
    const created = repo.createOpportunity(
      makeOpportunityInput("OP-TEST-CREATE-SCREENING", {
        status: "SCREENING",
        nextAction: "等待筛选结果",
      }),
    );
    const after = repo.getDashboardSummary().submittedApplications;

    expect(created.timeline.some(isSubmittedTimelineEvent)).toBe(true);
    expect(after).toBe(before + 1);
  });

  it("counts manual patch/edit to a submitted-or-later status even when patching timeline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 10));
    const repo = await openTestRepository();
    const id = "OP-TEST-PATCH-WRITTEN";
    repo.createOpportunity(makeOpportunityInput(id));

    const before = repo.getDashboardSummary().submittedApplications;
    const updated = repo.updateOpportunity(id, {
      status: "WRITTEN TEST",
      nextAction: "完成笔试并同步结果",
      timeline: [
        { id: `${id}-created`, occurredAt: "2026-06-24", title: "写入岗位推进", detail: "测试创建", status: "done" },
        { id: `${id}-progress`, occurredAt: "2026-06-24", title: "已更新为准备笔试", detail: "手动覆盖当前岗位阶段", status: "done" },
        { id: `${id}-next`, occurredAt: "Next", title: "完成笔试并同步结果", detail: "当前进度的备注", status: "next" },
      ],
    });
    const after = repo.getDashboardSummary().submittedApplications;

    expect(updated.timeline.some(isSubmittedTimelineEvent)).toBe(true);
    expect(after).toBe(before + 1);
  });

  it.each(submittedStatuses)("counts first TO APPLY -> %s progress as this week's submitted application", async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 10));
    const repo = await openTestRepository();
    const id = `OP-TEST-${status.replace(/\s+/g, "-")}`;
    repo.createOpportunity(makeOpportunityInput(id));

    const before = repo.getDashboardSummary().submittedApplications;
    const progressed = repo.addOpportunityProgress(id, {
      status,
      timelineEvent: {
        occurredAt: "2026-06-24",
        title: `已更新为${statusLabel[status]}`,
        detail: "手动更新当前岗位阶段",
        status: "done",
      },
    });
    const after = repo.getDashboardSummary().submittedApplications;

    expect(progressed.status).toBe(status);
    expect(progressed.timeline.some(isSubmittedTimelineEvent)).toBe(true);
    expect(after).toBe(before + 1);
  });

  it("does not count later progress for an old submitted opportunity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 10));
    const repo = await openTestRepository();
    const id = "OP-TEST-OLD-SUBMITTED";
    repo.createOpportunity(
      makeOpportunityInput(id, {
        status: "APPLIED",
        nextAction: "三天后跟进投递结果",
        timeline: [{ id: `${id}-submitted`, occurredAt: "2026-06-15", title: "已投递", detail: "上周已完成投递", status: "done" }],
      }),
    );

    const before = repo.getDashboardSummary().submittedApplications;
    repo.addOpportunityProgress(id, {
      status: "WAITING",
      timelineEvent: {
        occurredAt: "2026-06-24",
        title: "已更新为等结果",
        detail: "旧岗位继续推进",
        status: "done",
      },
    });

    expect(repo.getDashboardSummary().submittedApplications).toBe(before);
  });

  it("does not duplicate this week's submitted count when an already submitted opportunity advances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 10));
    const repo = await openTestRepository();
    const id = "OP-TEST-THIS-WEEK-SUBMITTED";
    repo.createOpportunity(
      makeOpportunityInput(id, {
        status: "INTERVIEWING",
        nextAction: "准备下一轮面试",
        timeline: [{ id: `${id}-submitted`, occurredAt: "2026-06-24", title: "已投递", detail: "本周已完成投递", status: "done" }],
      }),
    );

    const before = repo.getDashboardSummary().submittedApplications;
    repo.addOpportunityProgress(id, {
      status: "WAITING",
      timelineEvent: {
        occurredAt: "2026-06-24",
        title: "已更新为等结果",
        detail: "面试后推进",
        status: "done",
      },
    });

    expect(repo.getDashboardSummary().submittedApplications).toBe(before);
  });
});

describe("repository opportunity deadline updates", () => {
  it("clears deadline text when dueDate is explicitly cleared", async () => {
    const repo = await openTestRepository();
    const id = "OP-TEST-CLEAR-DUE-DATE";
    const sourceAssets = [
      {
        id: `${id}-source`,
        kind: "referral-note",
        title: "内推备注",
        detail: "内推人备注：周五10-11/10：40面试",
        createdAt: "2026-06-24",
        content: "JD/沟通原文保持不变",
      },
    ];
    const timeline = [
      { id: `${id}-created`, occurredAt: "2026-06-24", title: "写入岗位推进", detail: "测试创建", status: "done" },
      { id: `${id}-next`, occurredAt: "Next", title: "准备面试", detail: "周五10-11/10：40面试", status: "next" },
    ];
    repo.createOpportunity(
      makeOpportunityInput(id, {
        deadline: "2026-07-03",
        dueDate: "2026-07-03",
        note: "备注：周五10-11/10：40面试",
        jdText: "原始 JD：不要被日期清空",
        nextAction: "准备面试",
        sourceAssets,
        timeline,
      }),
    );

    const updated = repo.updateOpportunity(id, { dueDate: "" });
    const listed = repo.listOpportunities().find((opportunity) => opportunity.id === id);

    expect(updated.deadline).toBe("待定");
    expect(updated.dueDate).toBeUndefined();
    expect(updated.note).toBe("备注：周五10-11/10：40面试");
    expect(updated.jdText).toBe("原始 JD：不要被日期清空");
    expect(updated.nextAction).toBe("准备面试");
    expect(updated.sourceAssets).toEqual(sourceAssets);
    expect(updated.timeline).toEqual(timeline);
    expect(listed.deadline).toBe("待定");
    expect(listed.dueDate).toBeUndefined();
  });

  it("clears dueDate when deadline is explicitly cleared", async () => {
    const repo = await openTestRepository();
    const id = "OP-TEST-CLEAR-DEADLINE";
    repo.createOpportunity(
      makeOpportunityInput(id, {
        deadline: "2026-07-03",
        dueDate: "2026-07-03",
        note: "保留备注：周五10-11/10：40面试",
        jdText: "保留 JD 原文",
        nextAction: "保留下一步",
      }),
    );

    const updated = repo.updateOpportunity(id, { deadline: "" });

    expect(updated.deadline).toBe("待定");
    expect(updated.dueDate).toBeUndefined();
    expect(updated.note).toBe("保留备注：周五10-11/10：40面试");
    expect(updated.jdText).toBe("保留 JD 原文");
    expect(updated.nextAction).toBe("保留下一步");
  });

  it("keeps existing deadline fields when deadline is omitted", async () => {
    const repo = await openTestRepository();
    const id = "OP-TEST-KEEP-DEADLINE";
    repo.createOpportunity(
      makeOpportunityInput(id, {
        deadline: "2026-07-03",
        dueDate: "2026-07-03",
      }),
    );

    const updated = repo.updateOpportunity(id, { priority: "A" });

    expect(updated.deadline).toBe("2026-07-03");
    expect(updated.dueDate).toBe("2026-07-03");
  });

  it("keeps omitted note-like fields but applies explicit note edits", async () => {
    const repo = await openTestRepository();
    const id = "OP-TEST-NOTE-PATCH";
    repo.createOpportunity(
      makeOpportunityInput(id, {
        deadline: "2026-07-03",
        dueDate: "2026-07-03",
        note: "旧备注",
        jdText: "旧 JD",
        nextAction: "旧下一步",
      }),
    );

    const dateOnlyUpdate = repo.updateOpportunity(id, { dueDate: "2026-07-04" });
    const noteUpdate = repo.updateOpportunity(id, { note: "新备注：周五10-11/10：40面试" });

    expect(dateOnlyUpdate.note).toBe("旧备注");
    expect(dateOnlyUpdate.jdText).toBe("旧 JD");
    expect(dateOnlyUpdate.nextAction).toBe("旧下一步");
    expect(noteUpdate.note).toBe("新备注：周五10-11/10：40面试");
    expect(noteUpdate.jdText).toBe("旧 JD");
    expect(noteUpdate.nextAction).toBe("旧下一步");
  });
});
