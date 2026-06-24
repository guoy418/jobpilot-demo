import { afterEach, describe, expect, it, vi } from "vitest";

import { selectDashboardSummary, selectTodayActions } from "./selectors";
import type { InterviewSession, Opportunity, QaPair, ResumeVersion, WeeklyPlan, WeeklyTask } from "./types";

afterEach(() => {
  vi.useRealTimers();
});

const makeOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: "opp-base",
  title: "前端实习生",
  company: "示例公司",
  status: "TO APPLY",
  priority: "B",
  match: "MEDIUM",
  action: "P2",
  city: "上海",
  deadline: "",
  resumeId: "resume-1",
  nextAction: "补充材料",
  jdSummary: "",
  jdText: "",
  sourceAssets: [],
  timeline: [],
  ...overrides,
});

const makeQaPair = (overrides: Partial<QaPair> = {}): QaPair => ({
  id: "qa-base",
  question: "如何拆解项目结果？",
  originalAnswer: "",
  type: "PROJECT",
  score: 3,
  critique: "",
  weak: false,
  framework: "",
  optimizedAnswer: "",
  ...overrides,
});

const makeInterview = (overrides: Partial<InterviewSession> = {}): InterviewSession => ({
  id: "int-base",
  company: "腾讯",
  role: "前端实习生",
  round: "一面",
  date: "2026-06-23",
  reviewPriority: "P1",
  qaPairs: [],
  ...overrides,
});

const makeWeeklyTask = (overrides: Partial<WeeklyTask> = {}): WeeklyTask => ({
  id: "task-base",
  title: "整理项目表达",
  detail: "补充指标",
  source: "manual",
  sourceLabel: "本周计划",
  level: "P2",
  status: "open",
  ...overrides,
});

const makeWeeklyPlan = (overrides: Partial<WeeklyPlan> = {}): WeeklyPlan => ({
  weekStart: "2026-06-22",
  targetApplications: 4,
  focusDirections: [],
  focusCities: [],
  focusCompanies: [],
  practiceThemes: [],
  tasks: [],
  ...overrides,
});

const resumeList: ResumeVersion[] = [
  {
    id: "resume-1",
    name: "FE v1",
    fileName: "fe-v1.pdf",
    fileType: "PDF",
    fileSize: "100 KB",
    uploadedAt: "2026-06-20",
    roles: "前端",
    points: "React",
    summary: "",
    linkedOpportunityIds: [],
  },
];

describe("dashboard selector guardrails", () => {
  it("counts only active opportunities for urgency while preserving weekly submitted history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    const opportunities: Opportunity[] = [
      makeOpportunity({
        id: "opp-urgent",
        status: "TO APPLY",
        priority: "A",
        match: "HIGH",
        dueDate: "2026-06-24",
      }),
      makeOpportunity({
        id: "opp-applied-this-week",
        status: "APPLIED",
        timeline: [{ id: "tl-1", occurredAt: "2026-06-22", title: "完成投递", detail: "官网已投递", status: "done" }],
      }),
      makeOpportunity({
        id: "opp-ended-this-week",
        status: "ENDED",
        previousStatus: "APPLIED",
        dueDate: "2026-06-23",
        timeline: [{ id: "tl-2", occurredAt: "2026-06-23", title: "已投递", detail: "岗位随后关闭", status: "done" }],
      }),
      makeOpportunity({
        id: "opp-applied-last-week",
        status: "APPLIED",
        timeline: [{ id: "tl-3", occurredAt: "2026-06-15", title: "已投递", detail: "上周投递", status: "done" }],
      }),
    ];

    const interviews: InterviewSession[] = [
      makeInterview({
        id: "int-weak",
        qaPairs: [makeQaPair({ id: "qa-weak-1", weak: true }), makeQaPair({ id: "qa-weak-2", weak: true })],
      }),
      makeInterview({
        id: "int-strong",
        qaPairs: [makeQaPair({ id: "qa-strong", weak: false })],
      }),
    ];

    expect(selectDashboardSummary(opportunities, interviews, makeWeeklyPlan())).toEqual({
      submittedApplications: 2,
      urgentCount: 3,
      pendingReviewCount: 2,
      toApplyCount: 1,
      inProgressCount: 2,
      p0Count: 1,
      p1Count: 2,
      weakInterviewCount: 1,
      applicationGap: 2,
    });
  });

  it("counts only real submitted timestamps inside the current weekly window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 24, 10));

    const opportunities: Opportunity[] = [
      makeOpportunity({
        id: "opp-submitted-before-week",
        status: "APPLIED",
        timeline: [
          { id: "tl-old-submit", occurredAt: "Now", title: "Jun 14, 18:02 已更新为已投递", detail: "上汽官网申请已提交", status: "done" },
          { id: "tl-current-follow-up", occurredAt: "Now", title: "Jun 23, 09:30 更新为筛选中", detail: "三天后跟进投递结果", status: "done" },
        ],
      }),
      makeOpportunity({
        id: "opp-submitted-this-week",
        status: "SCREENING",
        timeline: [{ id: "tl-week-submit", occurredAt: "Now", title: "Jun 23, 10:15 已更新为已投递", detail: "官网申请已提交", status: "done" }],
      }),
      makeOpportunity({
        id: "opp-status-only-submitted",
        status: "APPLIED",
        timeline: [],
      }),
      makeOpportunity({
        id: "opp-invalid-submitted-date",
        status: "APPLIED",
        timeline: [{ id: "tl-invalid-submit", occurredAt: "Next", title: "已投递", detail: "状态已是已投递，但没有实际投递时间", status: "done" }],
      }),
    ];

    expect(selectDashboardSummary(opportunities, [], makeWeeklyPlan())).toMatchObject({
      submittedApplications: 1,
      applicationGap: 3,
    });
  });
});

describe("today action selector guardrails", () => {
  it("builds eligible opportunity, interview, and weekly actions with routing, fallbacks, and de-duplication", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 23, 10));

    const actions = selectTodayActions(
      [
        makeOpportunity({
          id: "opp-apply",
          company: "Byte",
          title: "前端",
          status: "TO APPLY",
          priority: "A",
          match: "HIGH",
          dueDate: "2026-06-24",
          resumeId: "resume-1",
          nextAction: "补简历",
        }),
        makeOpportunity({
          id: "opp-test",
          company: "Meituan",
          title: "数据",
          status: "WRITTEN TEST",
          priority: "B",
          match: "HIGH",
          resumeId: "missing-resume",
          nextAction: "完成测评",
        }),
        makeOpportunity({
          id: "opp-interview",
          company: "XHS",
          title: "产品",
          status: "INTERVIEWING",
          priority: "B",
          match: "MEDIUM",
          nextAction: "准备业务拆解",
        }),
        makeOpportunity({
          id: "opp-applied",
          company: "Ali",
          title: "数据",
          status: "APPLIED",
          nextAction: "三天后跟进",
        }),
      ],
      [
        makeInterview({
          id: "int-weak",
          company: "腾讯",
          round: "一面",
          reviewPriority: "P1",
          qaPairs: [makeQaPair({ id: "qa-weak", weak: true }), makeQaPair({ id: "qa-ok", weak: false })],
        }),
      ],
      [],
      makeWeeklyPlan({
        tasks: [
          makeWeeklyTask({
            id: "task-answer",
            title: "练习答案卡",
            source: "answer",
            sourceLabel: "答案库",
            relatedEntityId: "answer-1",
            level: "P0",
          }),
          makeWeeklyTask({
            id: "task-duplicate",
            title: "投递Byte前端",
            source: "manual",
            sourceLabel: "本周计划",
            level: "P0",
          }),
          makeWeeklyTask({
            id: "task-opportunity",
            title: "岗位任务不重复生成",
            source: "opportunity",
            sourceLabel: "岗位推进",
            relatedEntityId: "opp-apply",
            level: "P0",
          }),
          makeWeeklyTask({
            id: "task-done",
            title: "已完成任务",
            source: "manual",
            sourceLabel: "本周计划",
            status: "done",
          }),
        ],
      }),
      resumeList,
    );

    expect(actions.map((action) => action.level)).toEqual(["P0", "P0", "P1", "P1", "P1"]);
    expect(actions.map((action) => action.title)).toEqual([
      "投递Byte前端",
      "练习答案卡",
      "完成Meituan数据笔试",
      "准备XHS产品",
      "复盘腾讯一面",
    ]);

    const applyAction = actions.find((action) => action.targetId === "opp-apply");
    expect(applyAction).toMatchObject({
      page: "opportunityDetail",
      source: "opportunity",
      detail: "补简历 / 使用 FE v1",
      completionOutcome: "完成后会标记为已投递，并计入本周投递进度。",
    });

    const writtenTestAction = actions.find((action) => action.targetId === "opp-test");
    expect(writtenTestAction).toMatchObject({
      detail: "完成测评 / 使用 未选择简历",
      completionOutcome: "完成后会推进到筛选中，今日行动不再继续催办这一项。",
    });

    const answerAction = actions.find((action) => action.taskId === "task-answer");
    expect(answerAction).toMatchObject({
      page: "answers",
      targetId: "answer-1",
      source: "weekly",
      why: "这张答案卡已被加入本周计划，所以进入今日行动。",
    });
  });
});
