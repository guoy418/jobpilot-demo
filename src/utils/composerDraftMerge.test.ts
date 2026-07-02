import { describe, expect, it } from "vitest";

import { mergeParsedDraftValue, shouldUseParsedDraftValue } from "./composerDraftMerge";

describe("composer draft merge utilities", () => {
  it("allows parsed values to fill empty or default draft fields", () => {
    expect(mergeParsedDraftValue("", "准备面试")).toBe("准备面试");
    expect(mergeParsedDraftValue("补齐信息后推进", "确认简历后投递", ["补齐信息后推进"])).toBe("确认简历后投递");
  });

  it("preserves user-confirmed draft fields", () => {
    expect(mergeParsedDraftValue("我手动写的下一步", "确认简历后投递", ["补齐信息后推进"])).toBe("我手动写的下一步");
  });

  it("does not erase current values when parsed value is empty", () => {
    expect(mergeParsedDraftValue("已有内容", "")).toBe("已有内容");
    expect(shouldUseParsedDraftValue("补齐信息后推进", ["补齐信息后推进"])).toBe(true);
  });
});
