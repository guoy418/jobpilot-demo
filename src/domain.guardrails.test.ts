import { afterEach, describe, expect, it, vi } from "vitest";

import { computeOpportunityAction, getRestorableOpportunityStatus, resolveOpportunityAction } from "./domain";

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
