import { afterEach, describe, expect, it, vi } from "vitest";

import { inferDueDateFromText } from "../shared/opportunityRules.mjs";
import { parseOpportunityDraft } from "./parser.mjs";

afterEach(() => {
  vi.useRealTimers();
});

describe("parser shared opportunity rules", () => {
  it("uses shared due-date inference for parsed opportunity drafts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    const draft = parseOpportunityDraft({
      rawText: "明天截止的前端实习生岗位",
      sourceKind: "jd-text",
    });

    expect(draft.deadline).toBe("Tomorrow");
    expect(draft.dueDate).toBe(inferDueDateFromText(draft.deadline));
  });
});
