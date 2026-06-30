import { afterEach, describe, expect, it, vi } from "vitest";

import * as sharedOpportunityRules from "../shared/opportunityRules.mjs";
import {
  computeOpportunityAction,
  countWeeklySubmittedApplications,
  createSubmittedTransitionEvent,
  defaultOpportunityNextAction,
  getOpportunityDueDate,
  getOpportunitySubmittedAt,
  getRestorableOpportunityStatus,
  inferDueDateFromText,
  isSubmittedOrLaterStatus,
  normalizeOpportunityDeadlinePatch,
  parseDateLike,
  resolveOpportunityAction,
  shouldRecordSubmittedTransition,
  submittedStatuses,
} from "./domain";
import type { OpportunityStatus, TimelineEvent } from "./types";

afterEach(() => {
  vi.useRealTimers();
});

describe("opportunity action priority guardrails", () => {
  it("keeps terminal opportunities low priority even with urgent or manual signals", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    expect(
      computeOpportunityAction({
        status: "OFFER",
        dueDate: "2026-06-23",
        priority: "A",
        match: "HIGH",
      }),
    ).toBe("P3");

    expect(
      resolveOpportunityAction({
        status: "ENDED",
        actionManual: true,
        action: "P0",
        dueDate: "2026-06-23",
        priority: "A",
        match: "HIGH",
      }),
    ).toBe("P3");
  });

  it("escalates imminent deadlines but leaves waiting items calmer until truly urgent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    expect(
      computeOpportunityAction({
        status: "TO APPLY",
        dueDate: "2026-06-24",
        priority: "B",
        match: "MEDIUM",
      }),
    ).toBe("P0");

    expect(
      computeOpportunityAction({
        status: "WAITING",
        dueDate: "2026-06-25",
        priority: "A",
        match: "HIGH",
      }),
    ).toBe("P2");

    expect(
      computeOpportunityAction({
        status: "WAITING",
        dueDate: "2026-06-24",
        priority: "B",
        match: "MEDIUM",
      }),
    ).toBe("P0");
  });

  it("uses priority and match without over-escalating low-fit undecided roles", () => {
    expect(
      computeOpportunityAction({
        status: "TO APPLY",
        deadline: "",
        priority: "A",
        match: "HIGH",
      }),
    ).toBe("P0");

    expect(
      computeOpportunityAction({
        status: "APPLIED",
        deadline: "",
        priority: "A",
        match: "MEDIUM",
      }),
    ).toBe("P1");

    expect(
      computeOpportunityAction({
        status: "WAITING",
        deadline: "",
        priority: "A",
        match: "HIGH",
      }),
    ).toBe("P2");

    expect(
      computeOpportunityAction({
        status: "TO APPLY",
        deadline: "",
        priority: "C",
        match: "LOW",
      }),
    ).toBe("P2");
  });

  it("honors manual action overrides only for active opportunities", () => {
    expect(
      resolveOpportunityAction({
        status: "SCREENING",
        actionManual: true,
        action: "P0",
        priority: "B",
        match: "MEDIUM",
      }),
    ).toBe("P0");

    expect(
      resolveOpportunityAction({
        status: "SCREENING",
        actionManual: false,
        action: "P0",
        priority: "B",
        match: "MEDIUM",
      }),
    ).toBe("P2");
  });
});

describe("shared opportunity rule facade", () => {
  it("keeps frontend domain exports aligned with the shared rule module", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    const opportunity = {
      status: "TO APPLY" as const,
      deadline: "明天",
      priority: "A" as const,
      match: "HIGH" as const,
    };

    expect(inferDueDateFromText(opportunity.deadline)).toBe(sharedOpportunityRules.inferDueDateFromText(opportunity.deadline));
    expect(computeOpportunityAction(opportunity)).toBe(sharedOpportunityRules.computeOpportunityAction(opportunity));
    expect(defaultOpportunityNextAction("WAITING")).toBe(sharedOpportunityRules.defaultOpportunityNextAction("WAITING"));
    expect(parseDateLike("Jun 24", new Date(2026, 5, 23))?.getTime()).toBe(
      sharedOpportunityRules.parseDateLike("Jun 24", new Date(2026, 5, 23))?.getTime(),
    );
  });

  it("normalizes explicit deadline clears without changing omitted deadline fields", () => {
    expect(normalizeOpportunityDeadlinePatch({ dueDate: "" })).toEqual({
      dueDate: "",
      deadline: "待定",
    });

    expect(normalizeOpportunityDeadlinePatch({ deadline: "" })).toEqual({
      deadline: "待定",
      dueDate: "",
    });

    expect(normalizeOpportunityDeadlinePatch({ priority: "A" })).toEqual({
      priority: "A",
    });
  });

  it("keeps list due-date display empty after an explicit local clear", () => {
    const staleOpportunity = {
      deadline: "2026-07-03",
      dueDate: "2026-07-03",
    };
    const opportunity = {
      ...staleOpportunity,
      ...normalizeOpportunityDeadlinePatch({ dueDate: "" }),
    };

    expect(opportunity.deadline).toBe("待定");
    expect(getOpportunityDueDate(opportunity)).toBe("");
  });

  it("normalizes deadline patches without touching note-like fields", () => {
    const sourceAssets = [{ id: "SRC-1", detail: "内推人备注：周五10-11/10：40面试", content: "JD 原文保持不变" }];
    const timeline = [{ id: "TL-1", title: "收到面试邀请", detail: "周五10-11/10：40面试", status: "done" }];

    expect(
      normalizeOpportunityDeadlinePatch({
        dueDate: "",
        note: "备注：周五10-11/10：40面试",
        jdText: "JD 原文",
        nextAction: "准备面试",
        sourceAssets,
        timeline,
      }),
    ).toEqual({
      dueDate: "",
      deadline: "待定",
      note: "备注：周五10-11/10：40面试",
      jdText: "JD 原文",
      nextAction: "准备面试",
      sourceAssets,
      timeline,
    });
  });

  it("parses English month timeline dates without shifting months", () => {
    expect(parseDateLike("Apr 14 09:30", new Date(2026, 5, 23))?.getTime()).toBe(new Date(2026, 3, 14).getTime());
    expect(parseDateLike("Jun 24", new Date(2026, 5, 23))?.getTime()).toBe(new Date(2026, 5, 24).getTime());
  });

  it("uses imported title dates before relative submitted placeholders", () => {
    const now = new Date(2026, 5, 24, 10);

    expect(
      getOpportunitySubmittedAt(
        {
          status: "APPLIED",
          timeline: [{ occurredAt: "Now", title: "Jun 14, 18:02 已更新为已投递", detail: "上汽官网申请已提交", status: "done" }],
        },
        now,
      )?.getTime(),
    ).toBe(new Date(2026, 5, 14).getTime());

    expect(
      getOpportunitySubmittedAt(
        {
          status: "APPLIED",
          timeline: [{ occurredAt: "Now", title: "已更新为已投递", detail: "手动更新当前岗位阶段", status: "done" }],
        },
        now,
      )?.getTime(),
    ).toBe(now.getTime());
  });

  it("records submitted only when first crossing from to-apply into submitted stages", () => {
    expect(shouldRecordSubmittedTransition({ status: "TO APPLY", timeline: [] }, "INTERVIEWING")).toBe(true);
    expect(shouldRecordSubmittedTransition({ status: "TO APPLY", timeline: [] }, "TO APPLY")).toBe(false);
    expect(shouldRecordSubmittedTransition({ status: "APPLIED", timeline: [] }, "INTERVIEWING")).toBe(false);
    expect(
      shouldRecordSubmittedTransition(
        {
          status: "TO APPLY",
          timeline: [{ occurredAt: "2026-06-15", title: "已投递", detail: "旧投递日期", status: "done" }],
        },
        "INTERVIEWING",
      ),
    ).toBe(false);
  });

  it.each(submittedStatuses)("records first manual transition from TO APPLY to %s as submitted", (nextStatus) => {
    expect(isSubmittedOrLaterStatus(nextStatus)).toBe(true);
    expect(shouldRecordSubmittedTransition({ status: "TO APPLY", timeline: [] }, nextStatus)).toBe(true);
  });

  it.each(submittedStatuses)("does not re-record submitted transitions from %s", (currentStatus) => {
    expect(shouldRecordSubmittedTransition({ status: currentStatus, timeline: [] }, "WAITING")).toBe(false);
  });

  it("counts direct manual overrides into every submitted-or-later stage this week", () => {
    const now = new Date(2026, 5, 24, 10);
    const weeklyPlan = { weekStart: "2026-06-22" };
    const statuses = ["APPLIED", "WRITTEN TEST", "SCREENING", "INTERVIEWING", "WAITING", "OFFER"] satisfies OpportunityStatus[];

    const opportunities = statuses.map((status) => ({
      status,
      timeline: [
        createSubmittedTransitionEvent({
          id: `tl-submit-${status}`,
          occurredAt: "2026-06-24",
          fromStatus: "TO APPLY",
          toStatus: status,
        }) as TimelineEvent,
        { id: `tl-progress-${status}`, occurredAt: "2026-06-24", title: `已更新为${status}`, detail: "手动覆盖当前岗位阶段", status: "done" as const },
      ],
    }));

    expect(countWeeklySubmittedApplications(opportunities, weeklyPlan, now)).toBe(statuses.length);
  });

  it("does not recount later submitted-stage progress or old submitted dates", () => {
    const now = new Date(2026, 5, 24, 10);
    const weeklyPlan = { weekStart: "2026-06-22" };

    expect(
      countWeeklySubmittedApplications(
        [
          {
            status: "INTERVIEWING",
            timeline: [
              { id: "tl-submit", occurredAt: "2026-06-24", title: "已投递", detail: "官网申请已提交", status: "done" },
              { id: "tl-interview", occurredAt: "2026-06-24", title: "已更新为准备面试", detail: "旧岗位继续推进", status: "done" },
            ],
          },
          {
            status: "OFFER",
            timeline: [
              { id: "tl-old-submit", occurredAt: "2026-06-15", title: "已投递", detail: "上周已完成投递", status: "done" },
              { id: "tl-offer", occurredAt: "2026-06-24", title: "已更新为 Offer", detail: "本周进入 Offer", status: "done" },
            ],
          },
        ],
        weeklyPlan,
        now,
      ),
    ).toBe(1);
  });

  it("uses same-week creation as a fallback for already-submitted records missing the transition event", () => {
    const now = new Date(2026, 5, 24, 10);
    const weeklyPlan = { weekStart: "2026-06-22" };

    expect(
      countWeeklySubmittedApplications(
        [
          {
            status: "SCREENING",
            timeline: [
              { id: "tl-created", occurredAt: "2026-06-24", title: "写入岗位推进", detail: "必填信息满足后直接生成正式岗位记录", status: "done" },
              { id: "tl-screening", occurredAt: "2026-06-24", title: "已更新为筛选中", detail: "手动覆盖当前岗位阶段", status: "done" },
            ],
          },
          {
            status: "WAITING",
            timeline: [
              { id: "tl-created-old", occurredAt: "2026-06-15", title: "写入岗位推进", detail: "旧日期创建", status: "done" },
              { id: "tl-waiting", occurredAt: "2026-06-24", title: "已更新为等结果", detail: "本周继续推进", status: "done" },
            ],
          },
        ],
        weeklyPlan,
        now,
      ),
    ).toBe(1);
  });

  it("does not treat directly ended never-submitted opportunities as submitted", () => {
    expect(isSubmittedOrLaterStatus("ENDED")).toBe(false);
    expect(
      getOpportunitySubmittedAt(
        {
          status: "ENDED",
          previousStatus: "TO APPLY",
          timeline: [{ occurredAt: "2026-06-24", title: "已结束", detail: "岗位关闭", status: "done" }],
        },
        new Date(2026, 5, 24, 10),
      ),
    ).toBeNull();
  });
});

describe("opportunity status restoration guardrails", () => {
  it("prefers a non-ended previous status when restoring archived opportunities", () => {
    expect(getRestorableOpportunityStatus({ status: "ENDED", previousStatus: "INTERVIEWING" })).toBe("INTERVIEWING");
  });

  it("falls back based on linked interview context when previous status is missing", () => {
    expect(getRestorableOpportunityStatus({ status: "ENDED", previousStatus: null }, true)).toBe("WAITING");
    expect(getRestorableOpportunityStatus({ status: "ENDED", previousStatus: null }, false)).toBe("APPLIED");
    expect(getRestorableOpportunityStatus({ status: "SCREENING", previousStatus: null }, false)).toBe("SCREENING");
  });
});
