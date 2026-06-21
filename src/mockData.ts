import type { AnswerCard, AnswerCategory, InterviewSession, Opportunity, ResumeVersion, SessionFile, WeeklyPlan } from "./types";

const baseOpportunities: Array<Omit<Opportunity, "jdSummary" | "jdText" | "sourceAssets" | "timeline">> = [
  {
    id: "OP-021",
    title: "前端开发实习生",
    company: "字节跳动",
    status: "TO APPLY",
    priority: "A",
    match: "HIGH",
    action: "P0",
    city: "上海",
    deadline: "Tomorrow",
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    resumeId: "RV-101",
    nextAction: "补充低代码项目指标后投递",
  },
  {
    id: "OP-020",
    title: "增长产品实习生",
    company: "小红书",
    status: "INTERVIEWING",
    priority: "A",
    match: "MEDIUM",
    action: "P1",
    city: "上海",
    deadline: "May 28",
    dueDate: "2026-05-28",
    resumeId: "RV-102",
    nextAction: "准备业务拆解和反问",
  },
  {
    id: "OP-019",
    title: "数据分析实习生",
    company: "美团",
    status: "APPLIED",
    priority: "B",
    match: "HIGH",
    action: "P1",
    city: "北京",
    deadline: "May 31",
    dueDate: "2026-05-31",
    resumeId: "RV-103",
    nextAction: "三天后跟进内推人",
  },
  {
    id: "OP-018",
    title: "AI 产品运营实习生",
    company: "快手",
    status: "WAITING",
    priority: "B",
    match: "MEDIUM",
    action: "P2",
    city: "杭州",
    deadline: "Jun 03",
    dueDate: "2026-06-03",
    resumeId: "RV-102",
    nextAction: "整理 AIGC 案例库",
  },
];

const opportunityTrace: Record<string, Pick<Opportunity, "jdSummary" | "jdText" | "sourceAssets" | "timeline">> = {
  "OP-021": {
    jdSummary: "前端开发实习生，偏低代码平台和业务组件。需要 React、性能优化、组件库经验，并能讲清项目指标。",
    jdText:
      "岗位职责：参与低代码平台前端模块开发，负责业务组件沉淀、页面性能优化和跨端体验改进。岗位要求：熟悉 React、TypeScript、组件化开发，有性能优化或工程化经验优先。",
    sourceAssets: [
      {
        id: "SRC-021-1",
        kind: "jd-text",
        title: "岗位 JD 文本",
        detail: "从岗位推进内新增后生成正式记录",
        createdAt: "May 24 22:11",
        content: "岗位职责：参与低代码平台前端模块开发，负责业务组件沉淀、页面性能优化和跨端体验改进。岗位要求：熟悉 React、TypeScript、组件化开发，有性能优化或工程化经验优先。",
      },
      {
        id: "SRC-021-2",
        kind: "screenshot",
        title: "招聘页截图",
        detail: "保留原始招聘页，方便后续核对岗位要求",
        createdAt: "May 24 22:12",
        content: "截图预览占位：招聘页标题、公司、岗位要求、截止时间和投递入口会保存在本地文件库。",
      },
    ],
    timeline: [
      { id: "TL-021-1", occurredAt: "May 24 22:11", title: "导入 JD 文本", detail: "分类为岗位 JD，备注：字节低代码前端实习", status: "done" },
      { id: "TL-021-2", occurredAt: "May 24 22:13", title: "生成岗位草稿", detail: "系统提取公司、岗位、城市、技能关键词和截止时间", status: "done" },
      { id: "TL-021-3", occurredAt: "May 24 22:15", title: "确认进入岗位推进", detail: "用户确认优先级 A，匹配度 HIGH，使用 FE Intern v7", status: "done" },
      { id: "TL-021-4", occurredAt: "Next", title: "补充项目指标后投递", detail: "待补齐低代码项目的性能指标，再执行投递", status: "next" },
    ],
  },
  "OP-020": {
    jdSummary: "增长产品实习生，关注用户增长、数据分析、实验设计和业务拆解。当前已进入面试阶段。",
    jdText:
      "岗位职责：参与增长策略设计、用户行为分析和实验复盘。岗位要求：具备数据分析意识，能拆解业务问题，有产品或运营项目经验优先。",
    sourceAssets: [
      { id: "SRC-020-1", kind: "job-link", title: "招聘链接", detail: "来自小红书校招页面", createdAt: "May 20 19:40", content: "https://job.xiaohongshu.com/growth-product-intern" },
      { id: "SRC-020-2", kind: "referral-note", title: "内推备注", detail: "内推人建议重点准备增长案例", createdAt: "May 21 10:05", content: "内推人备注：业务面会重点看增长拆解、指标意识和反问质量。" },
    ],
    timeline: [
      { id: "TL-020-1", occurredAt: "May 20 19:40", title: "导入招聘链接", detail: "分类为招聘链接，备注：增长产品实习", status: "done" },
      { id: "TL-020-2", occurredAt: "May 20 19:43", title: "确认岗位草稿", detail: "提取岗位要求并选择 Product Hybrid v3", status: "done" },
      { id: "TL-020-3", occurredAt: "May 21 10:08", title: "完成内推投递", detail: "通过内推渠道提交，补充增长案例说明", status: "done" },
      { id: "TL-020-4", occurredAt: "May 22 18:30", title: "收到业务面邀请", detail: "面试复盘已关联到 INT-010", status: "done" },
      { id: "TL-020-5", occurredAt: "Next", title: "准备业务拆解和反问", detail: "从本岗位 JD 和面试复盘生成练习任务", status: "next" },
    ],
  },
  "OP-019": {
    jdSummary: "数据分析实习生，偏 SQL、Python、指标体系和业务分析。已投递，下一步是跟进内推反馈。",
    jdText:
      "岗位职责：负责业务数据分析、指标看板建设和专题分析。岗位要求：熟悉 SQL/Python，能建立指标体系，有互联网业务分析项目经验优先。",
    sourceAssets: [
      { id: "SRC-019-1", kind: "job-link", title: "招聘链接", detail: "来自美团招聘官网", createdAt: "May 21 20:14", content: "https://zhaopin.meituan.com/job/business-analysis-intern" },
      {
        id: "SRC-019-2",
        kind: "jd-text",
        title: "JD 原文",
        detail: "系统从链接中提取并保留原文",
        createdAt: "May 21 20:16",
        content: "岗位职责：负责业务数据分析、指标看板建设和专题分析。岗位要求：熟悉 SQL/Python，能建立指标体系，有互联网业务分析项目经验优先。",
      },
      { id: "SRC-019-3", kind: "referral-note", title: "内推沟通记录", detail: "内推人建议突出 SQL 和指标体系", createdAt: "May 21 20:24", content: "沟通记录：简历里 SQL 和指标体系要放到第一屏，投递后 3 天可跟进。" },
    ],
    timeline: [
      { id: "TL-019-1", occurredAt: "May 21 20:14", title: "导入招聘链接", detail: "分类为招聘链接，备注：美团数据分析实习", status: "done" },
      { id: "TL-019-2", occurredAt: "May 21 20:16", title: "生成岗位草稿", detail: "系统解析 JD，并保留原链接和 JD 原文", status: "done" },
      { id: "TL-019-3", occurredAt: "May 21 20:18", title: "确认进入岗位推进", detail: "确认城市北京、优先级 B、匹配度 HIGH", status: "done" },
      { id: "TL-019-4", occurredAt: "May 21 20:22", title: "选择简历版本", detail: "本次投递使用 Data v2，突出 SQL、Python 和指标体系", status: "done" },
      { id: "TL-019-5", occurredAt: "May 21 20:35", title: "完成投递", detail: "通过官网投递并同步给内推人", status: "done" },
      { id: "TL-019-6", occurredAt: "May 24 09:00", title: "生成跟进动作", detail: "三天后跟进内推人，已进入今日行动", status: "done" },
    ],
  },
  "OP-018": {
    jdSummary: "AI 产品运营实习生，关注 AIGC 案例库、运营策略和内容数据复盘。当前等待结果。",
    jdText:
      "岗位职责：参与 AI 产品运营、内容策略制定和用户反馈整理。岗位要求：理解 AIGC 工具，具备内容运营和数据复盘经验。",
    sourceAssets: [
      {
        id: "SRC-018-1",
        kind: "jd-text",
        title: "JD 文本",
        detail: "来自手动粘贴的岗位说明",
        createdAt: "May 18 21:30",
        content: "岗位职责：参与 AI 产品运营、内容策略制定和用户反馈整理。岗位要求：理解 AIGC 工具，具备内容运营和数据复盘经验。",
      },
      { id: "SRC-018-2", kind: "screenshot", title: "岗位截图", detail: "保留招聘页面关键要求", createdAt: "May 18 21:31", content: "截图预览占位：快手 AI 产品运营实习生招聘页。" },
    ],
    timeline: [
      { id: "TL-018-1", occurredAt: "May 18 21:30", title: "导入 JD", detail: "分类为岗位 JD，备注：快手 AI 产品运营", status: "done" },
      { id: "TL-018-2", occurredAt: "May 18 21:33", title: "确认岗位信息", detail: "确认城市杭州、优先级 B、使用 Product Hybrid v3", status: "done" },
      { id: "TL-018-3", occurredAt: "May 19 09:20", title: "完成投递", detail: "已提交材料并进入等待结果状态", status: "done" },
      { id: "TL-018-4", occurredAt: "Next", title: "整理 AIGC 案例库", detail: "补充可用于后续面试的运营案例", status: "next" },
    ],
  },
};

export const seedOpportunities: Opportunity[] = baseOpportunities.map((item) => ({
  ...item,
  ...opportunityTrace[item.id],
}));

const baseInterviewSessions: InterviewSession[] = [
  {
    id: "INT-011",
    company: "腾讯",
    role: "前端开发实习生",
    round: "一面",
    date: "May 24",
    reviewPriority: "P1",
    qaPairs: [
      {
        id: "QA-101",
        question: "你在低代码项目里如何衡量性能优化结果？",
        originalAnswer: "我主要做了首屏优化、拆包和缓存，页面打开更快了，用户体验更好。",
        type: "PROJECT",
        score: 2,
        critique: "原回答只有动作，没有基线、指标和复盘口径。面试官很难判断你到底贡献了多少。",
        weak: true,
        framework: "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
        optimizedAnswer:
          "项目开始时首屏约 3.2s，目标是把核心页面压到 2s 内。我先用性能面板定位阻塞资源，再做路由级拆包、图片懒加载和缓存策略，最后首屏降到 1.7s，构建产物减少 28%。复盘来看，我会补一组真实用户监控数据，让结论更稳定。",
      },
      {
        id: "QA-102",
        question: "为什么从前端转向产品策略岗位？",
        originalAnswer: "我觉得自己既懂技术，也对业务比较感兴趣，所以想尝试产品方向。",
        type: "MOTIVATION",
        score: 3,
        critique: "动机可信，但需要把技术背景转成岗位优势，并说明不是逃离技术。",
        weak: true,
        framework: "经历触发 -> 能力迁移 -> 岗位匹配 -> 短期学习计划",
        optimizedAnswer:
          "我不是放弃技术，而是希望把技术理解用于更前置的判断。前端经历让我熟悉用户路径、性能约束和工程成本；在产品策略岗位上，这些能力能帮助我把需求拆得更可落地。短期我会补齐行业分析和指标体系，形成技术理解加业务判断的组合。",
      },
      {
        id: "QA-103",
        question: "React 状态管理你会如何选型？",
        originalAnswer: "简单状态用 useState，跨组件用 Context，复杂项目可能会用 Zustand 或 Redux。",
        type: "TECHNICAL",
        score: 4,
        critique: "结构完整，可以补充多人协作、调试能力和状态生命周期的取舍。",
        weak: false,
        framework: "状态范围 -> 更新频率 -> 调试协作 -> 持久化需求",
        optimizedAnswer:
          "我会先看状态范围和更新频率。局部 UI 状态用组件内 state；中等范围共享状态用 Context 或 Zustand；如果是复杂业务、多人协作、需要可追踪调试和中间件，就考虑 Redux Toolkit。选型时我会避免为了工具而工具。",
      },
    ],
  },
  {
    id: "INT-010",
    company: "小红书",
    role: "增长产品实习生",
    round: "业务面",
    date: "May 22",
    reviewPriority: "P1",
    qaPairs: [
      {
        id: "QA-201",
        question: "你会如何拆解一个新用户留存下降的问题？",
        originalAnswer: "我会先看数据，然后分析用户路径，找到可能流失的环节。",
        type: "PRODUCT",
        score: 3,
        critique: "方向对，但拆解层级不够，缺少分群、漏斗和假设验证。",
        weak: true,
        framework: "定义指标 -> 分群定位 -> 漏斗拆解 -> 假设排序 -> 实验验证",
        optimizedAnswer:
          "我会先明确留存口径，比如 D1/D7 和核心行为留存，再按渠道、首日行为、设备和新老版本分群。接着看注册、首刷、关注、互动等关键漏斗，找出异常最大的环节。最后把假设按影响面和验证成本排序，用小实验验证。",
      },
      {
        id: "QA-202",
        question: "如果你要做一个 AI 求职工具，核心北极星指标是什么？",
        originalAnswer: "我觉得可以看用户使用次数和投递数量。",
        type: "PRODUCT",
        score: 4,
        critique: "能想到行为指标，但还要贴近产品承诺：提升求职执行确定性。",
        weak: false,
        framework: "产品承诺 -> 成功行为 -> 领先指标 -> 滞后指标",
        optimizedAnswer:
          "我会把北极星指标定义为每周完成的有效求职动作数，比如确认岗位、完成投递、完成复盘和练习。投递数量只是其中之一，更重要的是从材料进入到行动完成的闭环率。辅助指标可以看草稿确认率、复盘完成率和 P0/P1 动作完成率。",
      },
    ],
  },
];

const interviewSourceFiles: Record<string, SessionFile[]> = {
  "INT-011": [
    {
      id: "FILE-011-A",
      kind: "audio",
      fileName: "tencent-round1-recording.m4a",
      detail: "腾讯一面原录音，已和本场 4 个问题关联",
      uploadedAt: "May 24 20:42",
      duration: "42:18",
    },
    {
      id: "FILE-011-T",
      kind: "transcript",
      fileName: "tencent-round1-transcript.md",
      detail: "由录音转写后的文字稿，复盘问题从这里拆分",
      uploadedAt: "May 24 20:47",
    },
  ],
  "INT-010": [
    {
      id: "FILE-010-A",
      kind: "audio",
      fileName: "xiaohongshu-business-interview.m4a",
      detail: "小红书业务面原录音，已和本场 2 个问题关联",
      uploadedAt: "May 22 21:34",
      duration: "36:05",
    },
    {
      id: "FILE-010-T",
      kind: "transcript",
      fileName: "xiaohongshu-business-transcript.md",
      detail: "面试文字稿，包含增长拆解和北极星指标追问",
      uploadedAt: "May 22 21:40",
    },
  ],
};

export const seedInterviewSessions: InterviewSession[] = baseInterviewSessions.map((session) => ({
  ...session,
  sourceFiles: interviewSourceFiles[session.id] ?? [],
}));

export const uncategorizedAnswerCategoryId = "CAT-UNCATEGORIZED";

export const baseAnswerCategories: AnswerCategory[] = [
  {
    id: uncategorizedAnswerCategoryId,
    name: "尚未归类",
    sortOrder: 0,
    system: true,
  },
  {
    id: "CAT-BASIC",
    name: "个人基础信息类",
    sortOrder: 10,
  },
  {
    id: "CAT-BEHAVIORAL",
    name: "行为问题",
    sortOrder: 20,
  },
  {
    id: "CAT-MOTIVATION",
    name: "动机相关",
    sortOrder: 30,
  },
  {
    id: "CAT-GENERAL",
    name: "通用问题案例库",
    sortOrder: 40,
  },
  {
    id: "CAT-INTERNSHIP",
    name: "某段实习相关",
    sortOrder: 50,
  },
  {
    id: "CAT-INTERNSHIP-PROJECTS",
    name: "项目经历问题",
    parentId: "CAT-INTERNSHIP",
    sortOrder: 10,
  },
  {
    id: "CAT-INTERNSHIP-DETAILS",
    name: "业务理解/细节追问",
    parentId: "CAT-INTERNSHIP",
    sortOrder: 20,
  },
];

export const baseAnswerCards: AnswerCard[] = [
  {
    id: "AC-101",
    question: "如何讲清楚项目结果？",
    type: "PROJECT",
    status: "ACTIVE",
    source: "面试复盘",
    categoryId: "CAT-GENERAL",
    framework: "背景 -> 目标 -> 动作 -> 指标 -> 复盘",
    answer: "先说明项目背景和目标，再给出你负责的动作，最后用指标证明结果。重点是避免只说“做了优化”，要说优化前后差异。",
    relatedRoles: "前端 / 全栈 / 技术产品",
    practiceStatus: "薄弱",
  },
  {
    id: "AC-102",
    question: "如何回答职业动机？",
    type: "HR",
    status: "DRAFT",
    source: "手动创建",
    categoryId: "CAT-MOTIVATION",
    framework: "触发经历 -> 能力迁移 -> 岗位匹配 -> 短期计划",
    answer: "我不是放弃技术，而是希望把技术理解用于更前置的业务判断。短期会补齐行业分析和指标体系。",
    relatedRoles: "产品 / 策略 / 运营",
    practiceStatus: "中等",
  },
  {
    id: "AC-103",
    question: "如何解释技术选型？",
    type: "TECHNICAL",
    status: "ACTIVE",
    source: "手动创建",
    categoryId: "CAT-GENERAL",
    framework: "场景复杂度 -> 团队协作 -> 调试成本 -> 长期维护",
    answer: "我会先看状态范围和更新频率，再判断团队协作、调试能力和持久化需求，不为了工具而工具。",
    relatedRoles: "前端 / 全栈",
    practiceStatus: "熟练",
  },
];

export const resumeVersions: ResumeVersion[] = [
  {
    id: "RV-101",
    name: "FE Intern v7",
    fileName: "frontend-intern-v7.pdf",
    fileType: "PDF",
    fileSize: "428 KB",
    uploadedAt: "May 20",
    roles: "前端 / 全栈",
    points: "React, 性能优化, 组件库",
    summary: "强调前端工程能力、性能优化结果和组件抽象经验，适合技术岗投递。",
    linkedOpportunityIds: ["OP-021"],
  },
  {
    id: "RV-102",
    name: "Product Hybrid v3",
    fileName: "product-hybrid-v3.pdf",
    fileType: "PDF",
    fileSize: "392 KB",
    uploadedAt: "May 18",
    roles: "产品 / 策略",
    points: "用户增长, 数据分析, AI 工具",
    summary: "弱化纯工程细节，突出用户路径、指标拆解和 AI 工具使用经验。",
    linkedOpportunityIds: ["OP-020", "OP-018"],
  },
  {
    id: "RV-103",
    name: "Data v2",
    fileName: "data-analyst-v2.pdf",
    fileType: "PDF",
    fileSize: "405 KB",
    uploadedAt: "May 16",
    roles: "数据分析",
    points: "SQL, Python, 指标体系",
    summary: "突出数据清洗、指标体系和业务分析案例，适合数据分析实习。",
    linkedOpportunityIds: ["OP-019"],
  },
];

export const baseWeeklyPlan: WeeklyPlan = {
  targetApplications: 12,
  focusDirections: ["前端实习", "AI 产品"],
  focusCities: ["上海优先"],
  focusCompanies: ["字节跳动", "小红书"],
  practiceThemes: ["项目表达", "系统设计基础"],
  tasks: [
    {
      id: "WT-101",
      title: "整理一版前端项目表达",
      detail: "来自本周重点：前端实习 / 上海优先",
      source: "manual",
      sourceLabel: "自主训练",
      level: "P1",
      status: "open",
    },
    {
      id: "WT-102",
      title: "练习项目结果表达",
      detail: "来自本周练习主题：项目表达",
      source: "answer",
      sourceLabel: "答案库",
      relatedEntityId: "AC-101",
      level: "P2",
      status: "open",
    },
  ],
};
