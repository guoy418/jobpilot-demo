import { describe, expect, it } from "vitest";

import { createModuleComposerDraft, createModuleComposerSource } from "../composerModel";
import { canRunSourceParse, extractJobLinkFromSource, isJobLinkOnlyText, uploadStatusLabel } from "./composerSource";
import {
  composerValidationMessage,
  formatComposerApiError,
  getComposerAssistRequirement,
  validateAnswerComposerDraft,
  validateInterviewComposerDraft,
  validateOpportunityComposerDraft,
  validateResumeComposerDraft,
} from "./composerValidation";

const draft = () => createModuleComposerDraft("resume-1", "opportunity-1");
const source = () => createModuleComposerSource("jd-text");

describe("composer validation utilities", () => {
  it("rejects opportunity drafts that still need confirmed company or role", () => {
    const nextDraft = {
      ...draft(),
      company: "待填写公司",
      title: "待确认岗位",
      sourceText: "",
    };

    const result = validateOpportunityComposerDraft(nextDraft, source());

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((error) => error.field)).toEqual(["company", "title"]);
    expect(composerValidationMessage(result)).toContain("真实公司名称");
  });

  it("accepts a complete opportunity draft", () => {
    const nextDraft = {
      ...draft(),
      company: "腾讯",
      title: "前端实习生",
      sourceText: "负责 React 组件开发和性能优化。",
    };

    expect(validateOpportunityComposerDraft(nextDraft, source())).toEqual({ ok: true, errors: [] });
  });

  it("accepts opportunity drafts without JD text", () => {
    const nextDraft = {
      ...draft(),
      company: "腾讯",
      title: "前端实习生",
      sourceText: "",
    };

    expect(validateOpportunityComposerDraft(nextDraft, source())).toEqual({ ok: true, errors: [] });
  });

  it("allows opportunity job-link sources without requiring JD text", () => {
    const recruitmentLink = "https://jobs.example.com/opportunities/frontend-intern";
    const nextDraft = {
      ...draft(),
      company: "腾讯",
      title: "前端实习生",
      sourceText: "",
    };
    const noteLinkSource = {
      ...createModuleComposerSource("job-link"),
      note: recruitmentLink,
    };
    const rawTextLinkSource = {
      ...createModuleComposerSource("job-link"),
      rawText: recruitmentLink,
    };

    expect(canRunSourceParse(noteLinkSource)).toBe(true);
    expect(uploadStatusLabel(noteLinkSource)).toContain("链接已填写");
    expect(extractJobLinkFromSource(rawTextLinkSource)).toBe(recruitmentLink);
    expect(isJobLinkOnlyText(rawTextLinkSource.rawText)).toBe(true);
    expect(validateOpportunityComposerDraft(nextDraft, noteLinkSource)).toEqual({ ok: true, errors: [] });
    expect(validateOpportunityComposerDraft(nextDraft, rawTextLinkSource)).toEqual({ ok: true, errors: [] });
  });

  it("requires imported or parsed interview questions before creating interview records", () => {
    const nextDraft = {
      ...draft(),
      company: "字节跳动",
      role: "前端实习生",
      round: "一面",
    };

    const reviewJsonResult = validateInterviewComposerDraft(nextDraft, createModuleComposerSource("transcript"), {
      inputMode: "review-json",
      parsedQaPairCount: 0,
    });
    const rawTranscriptResult = validateInterviewComposerDraft(nextDraft, createModuleComposerSource("transcript"), {
      inputMode: "raw-transcript",
      parsedQaPairCount: 0,
    });

    expect(composerValidationMessage(reviewJsonResult)).toContain("导入有效的面试复盘");
    expect(composerValidationMessage(rawTranscriptResult)).toContain("智能整理生成复盘");
  });

  it("guards resume creation while uploads are not ready", () => {
    const nextDraft = {
      ...draft(),
      title: "前端实习投递版",
      fileName: "resume.pdf",
    };

    expect(
      composerValidationMessage(
        validateResumeComposerDraft(nextDraft, { ...createModuleComposerSource("resume-file"), uploadStatus: "uploading" }, { requireStoredFile: true }),
      ),
    ).toContain("还在读取或保存");
    expect(
      composerValidationMessage(
        validateResumeComposerDraft(nextDraft, { ...createModuleComposerSource("resume-file"), uploadStatus: "stored" }, { requireStoredFile: true }),
      ),
    ).toContain("本地数据库");
  });

  it("requires answer questions but keeps optional answer body fields flexible", () => {
    expect(composerValidationMessage(validateAnswerComposerDraft(draft()))).toContain("要沉淀的问题");
    expect(validateAnswerComposerDraft({ ...draft(), question: "如何介绍项目难点？" })).toEqual({ ok: true, errors: [] });
  });

  it("returns clearer AI-setting and API error hints", () => {
    expect(
      getComposerAssistRequirement("opportunity", "screenshot", {
        provider: "custom",
        apiKey: "",
        endpoint: "https://api.example.com/v1",
        parseMode: "mock",
        transcriptionMode: "mock",
      }),
    ).toContain("智能整理");
    expect(formatComposerApiError("Failed to fetch")).toContain("本地 API");
  });
});
