import http from "node:http";

const API_URL = process.env.API_URL || "http://127.0.0.1:8787";

const withMockAiServer = async (handler, run) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start mock AI server");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const checks = [
  ["/api/health", (data) => data.ok === true],
  ["/api/opportunities", (data) => Array.isArray(data) && data.length >= 1],
  ["/api/interviews", (data) => Array.isArray(data) && data.length >= 1],
  ["/api/answers", (data) => Array.isArray(data) && data.length >= 1],
  ["/api/resumes", (data) => Array.isArray(data) && data.length >= 1],
  ["/api/weekly-plan/current", (data) => data && typeof data.targetApplications === "number"],
  ["/api/dashboard/summary", (data) => data && typeof data.opportunityCount === "number" && typeof data.pendingReviewCount === "number"],
  [
    "/api/dashboard/today-actions",
    (data) =>
      Array.isArray(data) &&
      data.length >= 1 &&
      data.every((action) => action.page && action.filter !== undefined && action.source && action.level) &&
      data.every((action, index, actions) => index === 0 || ["P0", "P1", "P2", "P3"].indexOf(actions[index - 1].level) <= ["P0", "P1", "P2", "P3"].indexOf(action.level)),
  ],
  ["/api/backup", (data) => data && Array.isArray(data.opportunities) && Array.isArray(data.interviewSessions)],
];

const getJson = async (path) => {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
};

const getOpportunityTodayActions = async (opportunityId) => {
  const actions = await getJson("/api/dashboard/today-actions");
  return actions.filter((action) => action.source === "opportunity" && action.targetId === opportunityId);
};

const expectOpportunityTodayAction = async (opportunityId, label, validate = () => true) => {
  const matches = await getOpportunityTodayActions(opportunityId);
  if (!matches.some(validate)) {
    throw new Error(`${label} should create opportunity today action`);
  }
};

const expectNoOpportunityTodayAction = async (opportunityId, label) => {
  const matches = await getOpportunityTodayActions(opportunityId);
  if (matches.length > 0) {
    throw new Error(`${label} should not create opportunity today action`);
  }
};

for (const [path, validate] of checks) {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  const data = await response.json();
  if (!validate(data)) {
    throw new Error(`${path} returned unexpected payload`);
  }
  console.log(`PASS ${path}`);
}

const uploadedFile = await fetch(`${API_URL}/api/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fileName: `api-check-${Date.now()}.txt`,
    mimeType: "text/plain",
    dataBase64: Buffer.from("JobPilot file check", "utf8").toString("base64"),
  }),
});
if (!uploadedFile.ok) throw new Error(`POST /api/files returned ${uploadedFile.status}`);
const uploadedFilePayload = await uploadedFile.json();
if (!uploadedFilePayload.storageUri || !uploadedFilePayload.fileSize) {
  throw new Error("POST /api/files returned unexpected payload");
}
console.log("PASS POST /api/files");

const fetchedFile = await fetch(`${API_URL}${uploadedFilePayload.storageUri}`);
if (!fetchedFile.ok) throw new Error(`GET /api/files/:id returned ${fetchedFile.status}`);
if ((await fetchedFile.text()) !== "JobPilot file check") {
  throw new Error("GET /api/files/:id returned unexpected content");
}
console.log("PASS GET /api/files/:id");

const fileBackup = await fetch(`${API_URL}/api/backup`).then((response) => response.json());
if (!Array.isArray(fileBackup.storedFiles) || !fileBackup.storedFiles.some((file) => file.storageUri === uploadedFilePayload.storageUri && file.dataBase64)) {
  throw new Error("GET /api/backup did not include uploaded file content");
}
console.log("PASS GET /api/backup storedFiles");

const restoredBackup = await fetch(`${API_URL}/api/backup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(fileBackup),
});
if (!restoredBackup.ok) throw new Error(`POST /api/backup returned ${restoredBackup.status}`);
const restoredFile = await fetch(`${API_URL}${uploadedFilePayload.storageUri}`);
if (!restoredFile.ok || (await restoredFile.text()) !== "JobPilot file check") {
  throw new Error("POST /api/backup did not restore file content");
}
console.log("PASS POST /api/backup restores files");

const parsedOpportunity = await fetch(`${API_URL}/api/parse/opportunity`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "腾讯 前端开发实习生 上海 明天 React TypeScript",
    fileName: "tencent-fe-jd.txt",
    sourceKind: "jd-text",
    note: "api check",
  }),
});
if (!parsedOpportunity.ok) throw new Error(`POST /api/parse/opportunity returned ${parsedOpportunity.status}`);
const parsedOpportunityPayload = await parsedOpportunity.json();
if (parsedOpportunityPayload.company !== "腾讯" || !parsedOpportunityPayload.title.includes("前端")) {
  throw new Error("POST /api/parse/opportunity returned unexpected payload");
}
console.log("PASS POST /api/parse/opportunity");

const parsedInterview = await fetch(`${API_URL}/api/parse/interview`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "小红书 产品经理实习生 二面\n面试官：你负责过什么项目？\n我：我负责过 JobPilot MVP，推进岗位、面试和答案库闭环。",
    fileName: "interview.md",
    sourceKind: "transcript",
    note: "api check",
  }),
});
if (!parsedInterview.ok) throw new Error(`POST /api/parse/interview returned ${parsedInterview.status}`);
const parsedInterviewPayload = await parsedInterview.json();
if (parsedInterviewPayload.extractionStatus !== "ai-not-configured" || parsedInterviewPayload.qaPairs?.length !== 0) {
  throw new Error("POST /api/parse/interview raw transcript should require AI");
}
console.log("PASS POST /api/parse/interview requires AI");

const parsedNaturalInterview = await fetch(`${API_URL}/api/parse/interview`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "面试官问你负责过什么项目？我回答负责 JobPilot。接着问遇到冲突怎么办？我说先对齐目标和约束。",
    fileName: "natural-interview.md",
    sourceKind: "transcript",
  }),
});
if (!parsedNaturalInterview.ok) throw new Error(`POST /api/parse/interview natural transcript returned ${parsedNaturalInterview.status}`);
const parsedNaturalInterviewPayload = await parsedNaturalInterview.json();
if (parsedNaturalInterviewPayload.extractionStatus !== "ai-not-configured" || parsedNaturalInterviewPayload.qaPairs?.length !== 0) {
  throw new Error("POST /api/parse/interview natural transcript should require AI");
}
console.log("PASS POST /api/parse/interview natural transcript requires AI");

const parsedInterviewJson = await fetch(`${API_URL}/api/parse/interview`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: JSON.stringify({
      schemaVersion: "InterviewReviewJSON v1",
      company: "测试公司",
      role: "前端实习生",
      round: "一面",
      date: "Today",
      qaPairs: Array.from({ length: 30 }, (_, index) => ({
        question: `第 ${index + 1} 个问题：介绍一个你做过的项目？`,
        originalAnswer: "我做了 JobPilot MVP。",
        evaluation: index === 0 ? "回答有项目名，但缺少指标和取舍。" : "回答需要补充更多结果和复盘。",
        improvedFramework: "背景 -> 目标 -> 动作 -> 结果 -> 复盘",
        polishedAnswer: "我在 JobPilot MVP 中负责把岗位、面试和答案库串成闭环。",
        questionType: "PROJECT",
      })),
    }),
    fileName: "interview-review.json",
    sourceKind: "transcript",
    aiSettings: {
      provider: "custom",
      endpoint: "http://127.0.0.1:9/v1/chat/completions",
      apiKey: "should-not-be-used",
      model: "test-model",
    },
  }),
});
if (!parsedInterviewJson.ok) throw new Error(`POST /api/parse/interview JSON import returned ${parsedInterviewJson.status}`);
const parsedInterviewJsonPayload = await parsedInterviewJson.json();
if (
  parsedInterviewJsonPayload.extractionStatus !== "interview-json" ||
  parsedInterviewJsonPayload.aiStatus !== "not-used" ||
  parsedInterviewJsonPayload.qaPairs?.length !== 30 ||
  parsedInterviewJsonPayload.qaPairs?.[0]?.critique !== "回答有项目名，但缺少指标和取舍。"
) {
  throw new Error("POST /api/parse/interview did not import InterviewReviewJSON v1 locally");
}
console.log("PASS POST /api/parse/interview JSON import");

const parsedResume = await fetch(`${API_URL}/api/parse/resume`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "React TypeScript 前端 组件 性能优化",
    fileName: "frontend-resume.pdf",
    sourceKind: "resume-file",
    note: "api check",
  }),
});
if (!parsedResume.ok) throw new Error(`POST /api/parse/resume returned ${parsedResume.status}`);
const parsedResumePayload = await parsedResume.json();
if (!parsedResumePayload.title || !parsedResumePayload.roles.includes("前端")) {
  throw new Error("POST /api/parse/resume returned unexpected payload");
}
console.log("PASS POST /api/parse/resume");

const uploadedJdFile = await fetch(`${API_URL}/api/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fileName: `api-check-jd-${Date.now()}.txt`,
    mimeType: "text/plain",
    dataBase64: Buffer.from("阿里 数据分析实习生 杭州 明天 SQL Python", "utf8").toString("base64"),
  }),
});
if (!uploadedJdFile.ok) throw new Error(`POST /api/files for parse returned ${uploadedJdFile.status}`);
const uploadedJdPayload = await uploadedJdFile.json();
const parsedStoredJd = await fetch(`${API_URL}/api/parse/opportunity`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "",
    fileName: uploadedJdPayload.fileName,
    storageUri: uploadedJdPayload.storageUri,
    sourceKind: "jd-text",
    note: "api check stored text",
  }),
});
if (!parsedStoredJd.ok) throw new Error(`POST /api/parse/opportunity stored text returned ${parsedStoredJd.status}`);
const parsedStoredJdPayload = await parsedStoredJd.json();
if (parsedStoredJdPayload.company !== "阿里" || !parsedStoredJdPayload.title.includes("数据")) {
  throw new Error("POST /api/parse/opportunity did not read stored text content");
}
console.log("PASS POST /api/parse/opportunity stored text");

const uploadedUtf16Transcript = await fetch(`${API_URL}/api/files`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fileName: `api-check-utf16-${Date.now()}.txt`,
    mimeType: "text/plain",
    dataBase64: Buffer.from("\ufeff面试官：你负责过什么项目？\n我：我负责 JobPilot。", "utf16le").toString("base64"),
  }),
});
if (!uploadedUtf16Transcript.ok) throw new Error(`POST /api/files utf16 transcript returned ${uploadedUtf16Transcript.status}`);
const uploadedUtf16Payload = await uploadedUtf16Transcript.json();
const parsedUtf16Transcript = await fetch(`${API_URL}/api/parse/interview`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "",
    fileName: uploadedUtf16Payload.fileName,
    storageUri: uploadedUtf16Payload.storageUri,
    sourceKind: "transcript",
  }),
});
if (!parsedUtf16Transcript.ok) throw new Error(`POST /api/parse/interview utf16 transcript returned ${parsedUtf16Transcript.status}`);
const parsedUtf16Payload = await parsedUtf16Transcript.json();
if (parsedUtf16Payload.extractionStatus !== "ai-not-configured" || !String(parsedUtf16Payload.sourceText || "").includes("JobPilot")) {
  throw new Error("POST /api/parse/interview did not decode UTF-16 transcript file");
}
console.log("PASS POST /api/parse/interview UTF-16 transcript decode");

const parsedWithBrokenAi = await fetch(`${API_URL}/api/parse/opportunity`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    rawText: "美团 后端开发实习生 北京 明天 Java",
    fileName: "meituan-backend-jd.txt",
    sourceKind: "jd-text",
    aiSettings: {
      provider: "custom",
      endpoint: "http://127.0.0.1:9/v1/chat/completions",
      apiKey: "intentionally-invalid-api-check-key",
      model: "test-model",
    },
  }),
});
if (!parsedWithBrokenAi.ok) throw new Error(`POST /api/parse/opportunity broken AI fallback returned ${parsedWithBrokenAi.status}`);
const parsedWithBrokenAiPayload = await parsedWithBrokenAi.json();
if (parsedWithBrokenAiPayload.company !== "美团" || !parsedWithBrokenAiPayload.title.includes("后端")) {
  throw new Error("POST /api/parse/opportunity did not fallback after AI provider failure");
}
console.log("PASS POST /api/parse/opportunity AI fallback");

await withMockAiServer(
  async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    if (body.includes("面试稿片段")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "小红书",
                  role: "产品经理实习生",
                  round: "二面",
                  date: "Today",
                  qaPairs: [
                    {
                      question: "介绍一个你推进过的项目。",
                      originalAnswer: "我做了 JobPilot。",
                      type: "PROJECT",
                      score: 2,
                      critique: "回答过短，只说明做过项目，没有交代用户痛点、目标、个人职责、关键取舍和结果指标。",
                      weak: true,
                      framework: "先说明 JobPilot 解决的真实求职管理痛点；再讲自己负责的核心闭环和个人职责；接着展开关键动作和取舍；最后用结果和后续评测计划收束。",
                      optimizedAnswer: "我推进的是 JobPilot，一个面向个人求职管理的本地优先工具。背景是岗位、面试复盘和答案库分散，用户很难形成每日行动。我先把核心目标定为打通岗位录入、面试复盘和今日待办闭环。",
                      sourceChunkId: "chunk-1",
                      isPartial: false,
                      boundaryNote: "",
                    },
                    {
                      question: "如果用户不按流程上传材料怎么办？",
                      originalAnswer: "我会增加状态提示。",
                      type: "PRODUCT",
                      score: 3,
                      critique: "方向正确，但缺少对异常路径的分层，例如文件未上传、模型未配置、解析失败和用户只想粘贴文字的不同处理。",
                      weak: true,
                      framework: "先把异常路径按用户当前目标拆开；再说明每类异常给什么最小可恢复动作；接着强调反馈要出现在当前弹窗而不是隐藏在系统状态里。",
                      optimizedAnswer: "我会先把异常路径拆开：没有文件、文件只在浏览器、API 未连接、模型未配置、模型调用失败。每种情况都给用户一个最小可恢复动作。",
                      sourceChunkId: "chunk-1",
                      isPartial: false,
                      boundaryNote: "",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    if (!body.includes("原问题")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "expected interview parse prompt" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                question: body.includes("原问题:\\n如果用户不按流程上传材料") ? "如果用户不按流程上传材料怎么办？" : "介绍一个你推进过的项目。",
                originalAnswer: body.includes("原问题:\\n如果用户不按流程上传材料") ? "我会增加状态提示。" : "我做了 JobPilot。",
                type: body.includes("原问题:\\n如果用户不按流程上传材料") ? "PRODUCT" : "PROJECT",
                score: body.includes("原问题:\\n如果用户不按流程上传材料") ? 3 : 2,
                critique: body.includes("原问题:\\n如果用户不按流程上传材料")
                  ? "方向正确，但缺少对异常路径的分层，例如文件未上传、模型未配置、解析失败和用户只想粘贴文字的不同处理。"
                  : "回答过短，只说明做过项目，没有交代用户痛点、目标、个人职责、关键取舍和结果指标。",
                weak: true,
                framework: body.includes("原问题:\\n如果用户不按流程上传材料")
                  ? "先把异常路径按用户当前目标拆开；再说明每类异常给什么最小可恢复动作；接着强调反馈要出现在当前弹窗而不是隐藏在系统状态里；最后说明这样能保护数据质量，避免失败结果被写入正式记录。"
                  : "先说明 JobPilot 解决的真实求职管理痛点；再讲自己负责的核心闭环和个人职责；接着展开关键取舍，例如先做持久化和任务联动，再接入 OCR 与 AI 复盘；最后用结果和后续评测计划收束。",
                optimizedAnswer: body.includes("原问题:\\n如果用户不按流程上传材料")
                  ? "我会先把异常路径拆开：没有文件、文件只在浏览器、API 未连接、模型未配置、模型调用失败。每种情况都给用户一个最小可恢复动作，例如等待文件保存、改用粘贴文字、切换 Assist 或检查 endpoint。界面上不只在侧边栏显示状态，而是在当前弹窗里给明确错误和下一步建议。这样用户不会觉得按钮没反应，同时也能避免把失败的 AI 输出直接写成正式记录。"
                  : "我推进的是 JobPilot，一个面向个人求职管理的本地优先工具。背景是岗位、面试复盘和答案库分散，用户很难形成每日行动。我先把核心目标定为打通岗位录入、面试复盘和今日待办闭环，负责梳理数据模型、解析入口和任务联动。过程中我没有一开始追求完整 AI，而是先保证本地持久化和可回滚，再逐步接入 OCR、文字解析和复盘生成。结果是用户可以从真实 JD 或文字稿生成可确认的记录，并在今日待办里看到下一步动作。复盘来看，后续我会补更明确的解析失败反馈和真实样本评测。",
              }),
            },
          },
        ],
      }),
    );
  },
  async (mockAiBaseUrl) => {
    const parsedAiInterview = await fetch(`${API_URL}/api/parse/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: "面试官：介绍一个你推进过的项目。我：我做了 JobPilot。面试官：如果用户不按流程上传材料怎么办？我：我会增加状态提示。",
        fileName: "ai-interview.md",
        sourceKind: "transcript",
        aiSettings: {
          provider: "custom",
          endpoint: `${mockAiBaseUrl}/v1`,
          apiKey: "mock-ai-key",
          model: "mock-review-model",
        },
      }),
    });
    if (!parsedAiInterview.ok) throw new Error(`POST /api/parse/interview AI review returned ${parsedAiInterview.status}`);
    const parsedAiInterviewPayload = await parsedAiInterview.json();
    if (
      !Array.isArray(parsedAiInterviewPayload.qaPairs) ||
      parsedAiInterviewPayload.qaPairs.length < 2 ||
      parsedAiInterviewPayload.qaPairs[0].critique.length < 20 ||
      parsedAiInterviewPayload.qaPairs[0].optimizedAnswer.length < 20
    ) {
      throw new Error("POST /api/parse/interview did not use AI generated review qaPairs");
    }
    console.log("PASS POST /api/parse/interview AI review qaPairs");
  },
);

await withMockAiServer(
  async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    res.writeHead(200, { "Content-Type": "application/json" });
    if (body.includes("面试稿片段")) {
      const isCacheChunk = body.includes("缓存策略") && !body.includes("用户行为埋点");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "小红书",
                  role: "前端实习生",
                  round: "技术面",
                  date: "Today",
                  qaPairs: [
                    isCacheChunk
                      ? {
                          question: "你怎么设计前端缓存策略？",
                          originalAnswer: "我会区分接口缓存、静态资源缓存和本地状态缓存。",
                          type: "TECHNICAL",
                          score: 3,
                          critique: "回答有分层意识，但需要补充失效策略、数据一致性和异常兜底。",
                          weak: true,
                          framework: "先说明缓存目标和约束；再区分资源缓存、接口缓存和状态缓存；接着讲失效策略和一致性；最后补充监控和降级。",
                          optimizedAnswer: "我会先明确缓存要解决的是加载速度和稳定性问题，再按静态资源、接口数据和本地状态三层处理。",
                          sourceChunkId: "chunk-1",
                          isPartial: false,
                          boundaryNote: "",
                        }
                      : {
                          question: "你怎么设计用户行为埋点？",
                          originalAnswer: "我会先定义核心事件，再保证上报可靠性和数据校验。",
                          type: "PRODUCT",
                          score: 3,
                          critique: "回答有产品意识，但需要补充事件口径、数据质量和上线验证方式。",
                          weak: true,
                          framework: "先说明业务目标；再定义事件、属性和触发时机；接着讲上报可靠性和校验；最后说明如何用数据闭环优化。",
                          optimizedAnswer: "我会先从业务目标出发定义核心事件，再补充事件属性、触发时机、去重和数据校验方案。",
                          sourceChunkId: "chunk-2",
                          isPartial: false,
                          boundaryNote: "",
                        },
                  ],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    const isCacheQuestion = body.includes("原问题:\\n你怎么设计前端缓存策略");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                question: isCacheQuestion ? "你怎么设计前端缓存策略？" : "你怎么设计用户行为埋点？",
                originalAnswer: isCacheQuestion ? "我会区分接口缓存、静态资源缓存和本地状态缓存。" : "我会先定义核心事件，再保证上报可靠性和数据校验。",
                type: isCacheQuestion ? "TECHNICAL" : "PRODUCT",
                score: 3,
                critique: isCacheQuestion
                  ? "回答有分层意识，但需要补充失效策略、数据一致性和异常兜底。"
                  : "回答有产品意识，但需要补充事件口径、数据质量和上线验证方式。",
                weak: true,
                framework: isCacheQuestion
                  ? "先说明缓存目标和约束；再区分资源缓存、接口缓存和状态缓存；接着讲失效策略和一致性；最后补充监控和降级。"
                  : "先说明业务目标；再定义事件、属性和触发时机；接着讲上报可靠性和校验；最后说明如何用数据闭环优化。",
                optimizedAnswer: isCacheQuestion
                  ? "我会先明确缓存要解决的是加载速度和稳定性问题，再按静态资源、接口数据和本地状态三层处理。"
                  : "我会先从业务目标出发定义核心事件，再补充事件属性、触发时机、去重和数据校验方案。",
              }),
            },
          },
        ],
      }),
    );
  },
  async (mockAiBaseUrl) => {
    const longTranscript = [
      `第一段背景说明。${"这里是普通聊天内容。".repeat(420)} 面试官：你怎么设计前端缓存策略？ 我：我会区分接口缓存、静态资源缓存和本地状态缓存。`,
      `第二段继续讨论。${"这里是中间过渡内容。".repeat(420)} 面试官：你怎么设计用户行为埋点？ 我：我会先定义核心事件，再保证上报可靠性和数据校验。`,
    ].join("\n\n");
    const parsedChunkedInterview = await fetch(`${API_URL}/api/parse/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: longTranscript,
        fileName: "chunked-ai-interview.md",
        sourceKind: "transcript",
        aiSettings: {
          provider: "custom",
          endpoint: `${mockAiBaseUrl}/v1`,
          apiKey: "mock-ai-key",
          model: "mock-review-model",
        },
      }),
    });
    if (!parsedChunkedInterview.ok) throw new Error(`POST /api/parse/interview chunked AI review returned ${parsedChunkedInterview.status}`);
    const payload = await parsedChunkedInterview.json();
    const questions = (payload.qaPairs ?? []).map((pair) => pair.question).join("\n");
    if (!questions.includes("缓存策略") || !questions.includes("用户行为埋点") || !payload.note?.includes("分成 2 段")) {
      throw new Error("POST /api/parse/interview did not chunk, merge, and review long transcript");
    }
    console.log("PASS POST /api/parse/interview chunked AI review");
  },
);

await withMockAiServer(
  async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    res.writeHead(200, { "Content-Type": "application/json" });
    if (body.includes("上一轮分块复盘输出不是 JSON")) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "小红书",
                  role: "产品经理实习生",
                  round: "一面",
                  date: "Today",
                  qaPairs: [
                    {
                      question: "讲一次你主动发现并解决问题的经历",
                      originalAnswer: "我提到了自己做过 JobPilot，但展开不足。",
                      type: "BEHAVIORAL",
                      score: 3,
                      critique: "回答有项目方向，但缺少背景、关键动作、结果指标和复盘。",
                      weak: true,
                      framework:
                        "先说明问题出现的真实业务场景和影响面；再讲自己如何记录、分类、下钻分析并找到共性原因；接着说明如何推动相关方落地，包括沟通、取舍和优先级；最后用结果指标和个人复盘收束。",
                      optimizedAnswer:
                        "我可以讲 JobPilot 这个项目。最开始我发现自己的求职材料、岗位状态、面试复盘和答案练习分散在不同地方，很难形成稳定的行动闭环。所以我把目标定为做一个本地优先的求职管理工具，先打通岗位录入、面试复盘、答案库和今日待办。\n\n在推进过程中，我不是一开始追求完整功能，而是先保证真实数据可以落地，包括 SQLite 持久化、文件上传、JD/文字稿解析和任务联动。之后再逐步接入 OCR 和 AI 面试复盘，让系统能从真实材料里生成可确认的记录。\n\n这个经历让我最大的收获是，产品不只是把功能做出来，而是要围绕用户的真实流程，把信息输入、结构化、复盘和下一步行动连起来。",
                      sourceChunkId: "chunk-1",
                      isPartial: false,
                      boundaryNote: "",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "用户要求我作为面试复盘助手，根据提供的面试文字稿，直接输出一个 JSON 对象，不要 markdown，不要代码块。",
            },
          },
        ],
      }),
    );
  },
  async (mockAiBaseUrl) => {
    const parsedRepairedAiInterview = await fetch(`${API_URL}/api/parse/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: "面试官：讲一个你主动解决问题的经历。我：我做过 JobPilot。",
        fileName: "repair-ai-review.md",
        sourceKind: "transcript",
        aiSettings: {
          provider: "custom",
          endpoint: `${mockAiBaseUrl}/v1`,
          apiKey: "mock-ai-key",
          model: "mock-review-model",
        },
      }),
    });
    if (!parsedRepairedAiInterview.ok) throw new Error(`POST /api/parse/interview repaired AI review returned ${parsedRepairedAiInterview.status}`);
    const payload = await parsedRepairedAiInterview.json();
    if (payload.extractionStatus !== "ai-review" || !payload.qaPairs?.[0]?.framework.includes("业务场景")) {
      throw new Error("POST /api/parse/interview should repair non-JSON AI response");
    }
    console.log("PASS POST /api/parse/interview repairs non-JSON AI response");
  },
);

await withMockAiServer(
  async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    res.writeHead(200, { "Content-Type": "application/json" });
    if (body.includes("empty-ai-review")) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "小红书",
                  role: "产品经理实习生",
                  round: "二面",
                  sourceText: "面试官问你做过什么项目？我回答 JobPilot。",
                  qaPairs: [],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    if (body.includes("面试稿片段")) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "小红书",
                  role: "产品经理实习生",
                  round: "二面",
                  date: "Today",
                  qaPairs: [
                    {
                      question: "你负责过什么项目？",
                      originalAnswer: "我负责 JobPilot MVP，打通岗位、面试和答案库。",
                      type: "PROJECT",
                      score: 3,
                      critique: "回答说明了项目方向，但还需要补充个人职责、关键动作和结果指标。",
                      weak: true,
                      framework: "先说明 JobPilot 解决的求职管理痛点；再讲自己负责岗位、面试和答案库闭环；接着展开关键动作和取舍；最后用结果、限制和下一步优化收束。",
                      optimizedAnswer: "我负责 JobPilot MVP 的核心闭环，从岗位录入、面试复盘到答案库沉淀，重点解决求职材料分散和行动不可追踪的问题。",
                      sourceChunkId: "chunk-1",
                      isPartial: false,
                      boundaryNote: "",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "{}",
            },
          },
        ],
      }),
    );
  },
  async (mockAiBaseUrl) => {
    const parsedEmptyAiReview = await fetch(`${API_URL}/api/parse/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: "面试官问你做过什么项目？我回答 JobPilot。",
        fileName: "empty-ai-review.md",
        sourceKind: "transcript",
        aiSettings: {
          provider: "custom",
          endpoint: `${mockAiBaseUrl}/v1`,
          apiKey: "mock-ai-key",
          model: "mock-review-model",
        },
      }),
    });
    if (!parsedEmptyAiReview.ok) throw new Error(`POST /api/parse/interview empty AI review returned ${parsedEmptyAiReview.status}`);
    const parsedEmptyAiReviewPayload = await parsedEmptyAiReview.json();
    if (parsedEmptyAiReviewPayload.extractionStatus !== "ai-review-empty" || parsedEmptyAiReviewPayload.qaPairs.length !== 0) {
      throw new Error("POST /api/parse/interview empty AI review should not fallback to local qaPairs");
    }
    console.log("PASS POST /api/parse/interview empty AI review blocked");
  },
);

await withMockAiServer(
  async (req, res) => {
    if (req.url?.endsWith("/audio/transcriptions")) {
      for await (const _chunk of req) {
        // Drain multipart body before responding.
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          text: "小红书 产品经理实习生 二面\n面试官：你负责过什么项目？\n我：我负责 JobPilot MVP，打通岗位、面试和答案库。",
        }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    res.writeHead(200, { "Content-Type": "application/json" });
    if (body.includes("面试稿片段")) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "小红书",
                  role: "产品经理实习生",
                  round: "二面",
                  date: "Today",
                  qaPairs: [
                    {
                      question: "你负责过什么项目？",
                      originalAnswer: "我负责 JobPilot MVP，打通岗位、面试和答案库。",
                      type: "PROJECT",
                      score: 3,
                      critique: "回答说明了项目方向，但还需要补充个人职责、关键动作和结果指标。",
                      weak: true,
                      framework: "先说明 JobPilot 解决的求职管理痛点；再讲自己负责岗位、面试和答案库闭环；接着展开关键动作和取舍；最后用结果、限制和下一步优化收束。",
                      optimizedAnswer: "我负责 JobPilot MVP 的核心闭环，从岗位录入、面试复盘到答案库沉淀，重点解决求职材料分散和行动不可追踪的问题。",
                      sourceChunkId: "chunk-1",
                      isPartial: false,
                      boundaryNote: "",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "腾讯 前端开发实习生 上海 明天 React TypeScript",
            },
          },
        ],
      }),
    );
  },
  async (mockAiBaseUrl) => {
    const uploadedImage = await fetch(`${API_URL}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: `api-check-jd-screenshot-${Date.now()}.png`,
        mimeType: "image/png",
        dataBase64: Buffer.from("fake image bytes", "utf8").toString("base64"),
      }),
    });
    if (!uploadedImage.ok) throw new Error(`POST /api/files image returned ${uploadedImage.status}`);
    const uploadedImagePayload = await uploadedImage.json();
    const parsedImage = await fetch(`${API_URL}/api/parse/opportunity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: "",
        fileName: uploadedImagePayload.fileName,
        storageUri: uploadedImagePayload.storageUri,
        sourceKind: "screenshot",
        aiSettings: {
          provider: "custom",
          endpoint: `${mockAiBaseUrl}/v1`,
          apiKey: "mock-ai-key",
          model: "mock-vision-model",
        },
      }),
    });
    if (!parsedImage.ok) throw new Error(`POST /api/parse/opportunity OCR returned ${parsedImage.status}`);
    const parsedImagePayload = await parsedImage.json();
    if (parsedImagePayload.extractionStatus !== "ai-ocr" || parsedImagePayload.company !== "腾讯") {
      throw new Error("POST /api/parse/opportunity did not OCR stored screenshot through provider");
    }
    console.log("PASS POST /api/parse/opportunity OCR provider");

    const uploadedAudio = await fetch(`${API_URL}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: `api-check-interview-${Date.now()}.m4a`,
        mimeType: "audio/mp4",
        dataBase64: Buffer.from("fake audio bytes", "utf8").toString("base64"),
      }),
    });
    if (!uploadedAudio.ok) throw new Error(`POST /api/files audio returned ${uploadedAudio.status}`);
    const uploadedAudioPayload = await uploadedAudio.json();
    const parsedAudio = await fetch(`${API_URL}/api/parse/interview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: "",
        fileName: uploadedAudioPayload.fileName,
        storageUri: uploadedAudioPayload.storageUri,
        sourceKind: "audio",
        aiSettings: {
          provider: "custom",
          endpoint: `${mockAiBaseUrl}/v1`,
          apiKey: "mock-ai-key",
          model: "mock-chat-model",
        },
      }),
    });
    if (!parsedAudio.ok) throw new Error(`POST /api/parse/interview transcription returned ${parsedAudio.status}`);
    const parsedAudioPayload = await parsedAudio.json();
    if (!["ai-transcription", "ai-review"].includes(parsedAudioPayload.extractionStatus) || !Array.isArray(parsedAudioPayload.qaPairs) || parsedAudioPayload.qaPairs.length < 1) {
      throw new Error(`POST /api/parse/interview did not transcribe stored audio through provider: ${JSON.stringify(parsedAudioPayload).slice(0, 500)}`);
    }
    console.log("PASS POST /api/parse/interview transcription provider");
  },
);

const existingResumes = await fetch(`${API_URL}/api/resumes`).then((response) => response.json());
const dashboardBeforeTempOpportunity = await fetch(`${API_URL}/api/dashboard/summary`).then((response) => response.json());
const tempOpportunity = {
  id: `OP-CHECK-${Date.now()}`,
  title: "API check temporary opportunity",
  company: "API check temporary company",
  status: "TO APPLY",
  priority: "B",
  match: "MEDIUM",
  action: "P2",
  city: "Test City",
  deadline: "Today",
  resumeId: existingResumes[0]?.id ?? "",
  nextAction: "temporary next action",
  jdSummary: "temporary",
  jdText: "temporary",
  sourceAssets: [
    {
      id: `SRC-CHECK-${Date.now()}`,
      kind: "jd-text",
      title: "API check JD",
      detail: "temporary",
      createdAt: "Now",
      content: "temporary",
    },
  ],
  timeline: [
    {
      id: `TL-CHECK-${Date.now()}`,
      occurredAt: "Now",
      title: "API check created",
      detail: "temporary",
      status: "done",
    },
  ],
};

const createdOpportunity = await fetch(`${API_URL}/api/opportunities`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(tempOpportunity),
});
if (!createdOpportunity.ok) throw new Error(`POST /api/opportunities returned ${createdOpportunity.status}`);
const createdOpportunityPayload = await createdOpportunity.json();
if (createdOpportunityPayload.id !== tempOpportunity.id || createdOpportunityPayload.sourceAssets.length !== 1) {
  throw new Error("POST /api/opportunities returned unexpected opportunity");
}
console.log("PASS POST /api/opportunities");

const fetchedOpportunity = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}`);
if (!fetchedOpportunity.ok) throw new Error(`GET /api/opportunities/:id returned ${fetchedOpportunity.status}`);
console.log("PASS GET /api/opportunities/:id");

const fetchedSourceAssets = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/source-assets`);
if (!fetchedSourceAssets.ok) throw new Error(`GET /api/opportunities/:id/source-assets returned ${fetchedSourceAssets.status}`);
const fetchedSourceAssetsPayload = await fetchedSourceAssets.json();
if (!Array.isArray(fetchedSourceAssetsPayload) || fetchedSourceAssetsPayload.length !== 1) {
  throw new Error("GET /api/opportunities/:id/source-assets returned unexpected payload");
}
console.log("PASS GET /api/opportunities/:id/source-assets");

const fetchedTimeline = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/timeline`);
if (!fetchedTimeline.ok) throw new Error(`GET /api/opportunities/:id/timeline returned ${fetchedTimeline.status}`);
const fetchedTimelinePayload = await fetchedTimeline.json();
if (!Array.isArray(fetchedTimelinePayload) || fetchedTimelinePayload.length !== 1) {
  throw new Error("GET /api/opportunities/:id/timeline returned unexpected payload");
}
console.log("PASS GET /api/opportunities/:id/timeline");

const fetchedPipeline = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/pipeline`);
if (!fetchedPipeline.ok) throw new Error(`GET /api/opportunities/:id/pipeline returned ${fetchedPipeline.status}`);
const fetchedPipelinePayload = await fetchedPipeline.json();
if (
  !Array.isArray(fetchedPipelinePayload) ||
  !fetchedPipelinePayload.some((stage) => stage.key === "screening" && stage.label === "筛选中") ||
  !fetchedPipelinePayload.some((stage) => stage.state === "current")
) {
  throw new Error("GET /api/opportunities/:id/pipeline returned unexpected payload");
}
console.log("PASS GET /api/opportunities/:id/pipeline");

const updatedOpportunity = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ priority: "A", nextAction: "updated next action" }),
});
if (!updatedOpportunity.ok) throw new Error(`PATCH /api/opportunities/:id returned ${updatedOpportunity.status}`);
const updatedOpportunityPayload = await updatedOpportunity.json();
if (updatedOpportunityPayload.priority !== "A" || updatedOpportunityPayload.nextAction !== "updated next action") {
  throw new Error("PATCH /api/opportunities/:id did not update opportunity");
}
console.log("PASS PATCH /api/opportunities/:id");

await expectOpportunityTodayAction(
  tempOpportunity.id,
  "TO APPLY opportunity",
  (action) => action.title.includes("投递") && action.page === "opportunityDetail",
);
console.log("PASS TO APPLY opportunity creates today action");

const progressedOpportunity = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "APPLIED",
    timelineEvent: {
      title: "API check applied",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!progressedOpportunity.ok) throw new Error(`POST /api/opportunities/:id/progress returned ${progressedOpportunity.status}`);
const progressedOpportunityPayload = await progressedOpportunity.json();
if (progressedOpportunityPayload.status !== "APPLIED" || progressedOpportunityPayload.nextAction !== "三天后跟进投递结果") {
  throw new Error("POST /api/opportunities/:id/progress did not update progress");
}
console.log("PASS POST /api/opportunities/:id/progress");
await expectNoOpportunityTodayAction(tempOpportunity.id, "APPLIED opportunity");
console.log("PASS completing TO APPLY today action advances to APPLIED");

const dashboardAfterAppliedProgress = await fetch(`${API_URL}/api/dashboard/summary`).then((response) => response.json());
if (dashboardAfterAppliedProgress.submittedApplications !== dashboardBeforeTempOpportunity.submittedApplications + 1) {
  throw new Error("POST /api/opportunities/:id/progress did not increment weekly submitted applications");
}
console.log("PASS dashboard weekly submitted applications");

const weeklyPlanAfterProgress = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
const followupTasksAfterProgress = weeklyPlanAfterProgress.tasks.filter(
  (task) => task.source === "opportunity" && task.relatedEntityId === tempOpportunity.id,
);
if (followupTasksAfterProgress.length !== 0) {
  throw new Error("POST /api/opportunities/:id/progress should not create opportunity follow-up weekly tasks");
}

const repeatedProgress = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "APPLIED",
    timelineEvent: {
      title: "API check repeated applied",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!repeatedProgress.ok) throw new Error(`repeated POST /api/opportunities/:id/progress returned ${repeatedProgress.status}`);
const weeklyPlanAfterRepeatedProgress = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
const followupTasksAfterRepeatedProgress = weeklyPlanAfterRepeatedProgress.tasks.filter(
  (task) => task.source === "opportunity" && task.relatedEntityId === tempOpportunity.id,
);
if (followupTasksAfterRepeatedProgress.length !== 0) {
  throw new Error("POST /api/opportunities/:id/progress created opportunity follow-up weekly tasks");
}
console.log("PASS POST /api/opportunities/:id/progress without follow-up task");

const writtenTestProgress = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "WRITTEN TEST",
    timelineEvent: {
      title: "API check written test",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!writtenTestProgress.ok) throw new Error(`written test POST /api/opportunities/:id/progress returned ${writtenTestProgress.status}`);
const writtenTestOpportunity = await writtenTestProgress.json();
if (writtenTestOpportunity.status !== "WRITTEN TEST") {
  throw new Error("POST /api/opportunities/:id/progress did not update status to WRITTEN TEST");
}
await expectOpportunityTodayAction(
  tempOpportunity.id,
  "WRITTEN TEST opportunity",
  (action) => action.title.includes("笔试") && action.page === "opportunityDetail",
);
console.log("PASS manual WRITTEN TEST creates today action");

const screeningProgress = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "SCREENING",
    timelineEvent: {
      title: "API check screening",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!screeningProgress.ok) throw new Error(`screening POST /api/opportunities/:id/progress returned ${screeningProgress.status}`);
const screeningOpportunity = await screeningProgress.json();
if (screeningOpportunity.status !== "SCREENING") {
  throw new Error("POST /api/opportunities/:id/progress did not update status to SCREENING");
}
const todayActionsAfterScreening = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (todayActionsAfterScreening.some((action) => action.source === "opportunity" && action.targetId === tempOpportunity.id)) {
  throw new Error("SCREENING opportunity should not create opportunity today action");
}
console.log("PASS completing WRITTEN TEST today action advances to SCREENING");

const interviewingProgress = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "INTERVIEWING",
    timelineEvent: {
      title: "API check interviewing",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!interviewingProgress.ok) throw new Error(`interviewing POST /api/opportunities/:id/progress returned ${interviewingProgress.status}`);
const interviewingOpportunity = await interviewingProgress.json();
if (interviewingOpportunity.status !== "INTERVIEWING") {
  throw new Error("POST /api/opportunities/:id/progress did not update status to INTERVIEWING");
}
await expectOpportunityTodayAction(
  tempOpportunity.id,
  "INTERVIEWING opportunity",
  (action) => action.title.includes("准备") && action.page === "opportunityDetail",
);
console.log("PASS manual INTERVIEWING creates today action");

const waitingProgress = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "WAITING",
    timelineEvent: {
      title: "API check waiting",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!waitingProgress.ok) throw new Error(`waiting POST /api/opportunities/:id/progress returned ${waitingProgress.status}`);
const waitingOpportunity = await waitingProgress.json();
if (waitingOpportunity.status !== "WAITING") {
  throw new Error("POST /api/opportunities/:id/progress did not update status to WAITING");
}
await expectNoOpportunityTodayAction(tempOpportunity.id, "WAITING opportunity");
console.log("PASS completing INTERVIEWING today action advances to WAITING");

const linkedInterview = {
  id: `INT-CHECK-LINKED-${Date.now()}`,
  opportunityId: tempOpportunity.id,
  company: tempOpportunity.company,
  role: tempOpportunity.title,
  round: "linked interview",
  date: "Today",
  sourceFiles: [],
  qaPairs: [
    {
      id: `QA-CHECK-LINKED-${Date.now()}`,
      question: "linked interview question",
      answer: "temporary",
      framework: "STAR",
      critique: "temporary",
      optimizedAnswer: "temporary",
      type: "behavioral",
      weak: false,
    },
  ],
};
const createdLinkedInterview = await fetch(`${API_URL}/api/interviews`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(linkedInterview),
});
if (!createdLinkedInterview.ok) throw new Error(`POST linked /api/interviews returned ${createdLinkedInterview.status}`);
const opportunityAfterLinkedInterview = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}`).then((response) => response.json());
if (opportunityAfterLinkedInterview.status !== "WAITING") {
  throw new Error("POST linked /api/interviews did not advance opportunity to WAITING");
}
const todayActionsAfterLinkedInterview = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (todayActionsAfterLinkedInterview.some((action) => action.source === "opportunity" && action.targetId === tempOpportunity.id)) {
  throw new Error("POST linked /api/interviews should not create waiting follow-up today action");
}
const deletedLinkedInterview = await fetch(`${API_URL}/api/interviews/${encodeURIComponent(linkedInterview.id)}`, { method: "DELETE" });
if (!deletedLinkedInterview.ok) throw new Error(`DELETE linked /api/interviews/:id returned ${deletedLinkedInterview.status}`);
console.log("PASS POST linked /api/interviews advances opportunity");

const offerProgress = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}/progress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    status: "OFFER",
    timelineEvent: {
      title: "API check offer",
      detail: "temporary",
      occurredAt: "Now",
    },
  }),
});
if (!offerProgress.ok) throw new Error(`offer POST /api/opportunities/:id/progress returned ${offerProgress.status}`);
const offerOpportunity = await offerProgress.json();
if (offerOpportunity.status !== "OFFER") {
  throw new Error("POST /api/opportunities/:id/progress did not update status to OFFER");
}
await expectNoOpportunityTodayAction(tempOpportunity.id, "OFFER opportunity");
console.log("PASS OFFER opportunity does not create today action");

const deletedOpportunity = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(tempOpportunity.id)}`, { method: "DELETE" });
if (!deletedOpportunity.ok) throw new Error(`DELETE /api/opportunities/:id returned ${deletedOpportunity.status}`);
const weeklyPlanAfterOpportunityDelete = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
if (weeklyPlanAfterOpportunityDelete.tasks.some((task) => task.source === "opportunity" && task.relatedEntityId === tempOpportunity.id)) {
  throw new Error("DELETE /api/opportunities/:id did not remove opportunity follow-up tasks");
}
const dashboardAfterOpportunityDelete = await fetch(`${API_URL}/api/dashboard/summary`).then((response) => response.json());
if (dashboardAfterOpportunityDelete.submittedApplications !== dashboardBeforeTempOpportunity.submittedApplications) {
  throw new Error("DELETE /api/opportunities/:id did not remove weekly submitted application");
}
console.log("PASS DELETE /api/opportunities/:id");

const oldSubmittedOpportunity = {
  ...tempOpportunity,
  id: `OP-CHECK-OLD-${Date.now()}`,
  status: "APPLIED",
  nextAction: "old submitted action",
  timeline: [
    {
      id: `TL-CHECK-OLD-${Date.now()}`,
      occurredAt: "2000-01-01",
      title: "API check old applied",
      detail: "old submitted application outside the current week",
      status: "done",
    },
  ],
};
const createdOldSubmittedOpportunity = await fetch(`${API_URL}/api/opportunities`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(oldSubmittedOpportunity),
});
if (!createdOldSubmittedOpportunity.ok) throw new Error(`POST old submitted /api/opportunities returned ${createdOldSubmittedOpportunity.status}`);
const dashboardAfterOldSubmittedOpportunity = await fetch(`${API_URL}/api/dashboard/summary`).then((response) => response.json());
if (dashboardAfterOldSubmittedOpportunity.submittedApplications !== dashboardBeforeTempOpportunity.submittedApplications) {
  throw new Error("dashboard weekly submitted applications counted an old submitted opportunity");
}
const deletedOldSubmittedOpportunity = await fetch(`${API_URL}/api/opportunities/${encodeURIComponent(oldSubmittedOpportunity.id)}`, { method: "DELETE" });
if (!deletedOldSubmittedOpportunity.ok) throw new Error(`DELETE old submitted /api/opportunities/:id returned ${deletedOldSubmittedOpportunity.status}`);
console.log("PASS dashboard ignores old submitted applications");

const tempAnswer = {
  id: `AC-CHECK-${Date.now()}`,
  question: "API check temporary answer",
  type: "MANUAL",
  status: "DRAFT",
  source: "api:check",
  framework: "背景 -> 动作 -> 结果",
  answer: "temporary",
  relatedRoles: "test",
  practiceStatus: "中等",
};

const created = await fetch(`${API_URL}/api/answers`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(tempAnswer),
});
if (!created.ok) throw new Error(`POST /api/answers returned ${created.status}`);
const createdAnswer = await created.json();
if (createdAnswer.id !== tempAnswer.id) throw new Error("POST /api/answers returned unexpected answer");
console.log("PASS POST /api/answers");

const updated = await fetch(`${API_URL}/api/answers/${encodeURIComponent(tempAnswer.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ practiceStatus: "薄弱", status: "ACTIVE" }),
});
if (!updated.ok) throw new Error(`PATCH /api/answers/:id returned ${updated.status}`);
const updatedAnswer = await updated.json();
if (updatedAnswer.practiceStatus !== "薄弱" || updatedAnswer.status !== "ACTIVE") {
  throw new Error("PATCH /api/answers/:id did not update practice state");
}
console.log("PASS PATCH /api/answers/:id");

const answerTodayActions = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (answerTodayActions.some((action) => action.targetId === tempAnswer.id && action.source === "answer")) {
  throw new Error("/api/dashboard/today-actions should not include direct answer practice action");
}
console.log("PASS answer card does not directly create today action");

const answerLinkedTask = {
  id: `WT-CHECK-ANSWER-${Date.now()}`,
  title: "API check answer-linked task",
  detail: "temporary",
  source: "answer",
  sourceLabel: "api:check",
  relatedEntityId: tempAnswer.id,
  level: "P2",
  status: "open",
};
const createdAnswerLinkedTask = await fetch(`${API_URL}/api/weekly-plan/current/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(answerLinkedTask),
});
if (!createdAnswerLinkedTask.ok) throw new Error(`POST answer-linked weekly task returned ${createdAnswerLinkedTask.status}`);
const answerTaskTodayActions = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (
  !answerTaskTodayActions.some(
    (action) => action.source === "weekly" && action.targetId === tempAnswer.id && action.taskId === answerLinkedTask.id && action.page === "answers",
  )
) {
  throw new Error("/api/dashboard/today-actions did not include answer-linked training task");
}
console.log("PASS answer training task creates today action");

const completedAnswerLinkedTask = await fetch(`${API_URL}/api/weekly-tasks/${encodeURIComponent(answerLinkedTask.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "done" }),
});
if (!completedAnswerLinkedTask.ok) throw new Error(`PATCH answer-linked weekly task returned ${completedAnswerLinkedTask.status}`);
const answerTaskTodayActionsAfterDone = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (answerTaskTodayActionsAfterDone.some((action) => action.source === "weekly" && action.taskId === answerLinkedTask.id)) {
  throw new Error("completed answer-linked training task should not appear in today actions");
}
const answerAfterCompletedTask = (await fetch(`${API_URL}/api/answers`).then((response) => response.json())).find((answer) => answer.id === tempAnswer.id);
if (answerAfterCompletedTask?.status !== "ACTIVE" || answerAfterCompletedTask?.practiceStatus !== "薄弱") {
  throw new Error("completing answer-linked training task should not change answer card practice state");
}
console.log("PASS completed answer training task disappears without changing answer state");

const deleted = await fetch(`${API_URL}/api/answers/${encodeURIComponent(tempAnswer.id)}`, { method: "DELETE" });
if (!deleted.ok) throw new Error(`DELETE /api/answers/:id returned ${deleted.status}`);
const weeklyPlanAfterAnswerDelete = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
if (weeklyPlanAfterAnswerDelete.tasks.some((task) => task.source === "answer" && task.relatedEntityId === tempAnswer.id)) {
  throw new Error("DELETE /api/answers/:id did not remove answer-linked training tasks");
}
console.log("PASS DELETE /api/answers/:id");

const originalWeeklyPlan = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
const tempFocus = `api-check-${Date.now()}`;
const patchedPlan = await fetch(`${API_URL}/api/weekly-plan/current`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    targetApplications: originalWeeklyPlan.targetApplications + 1,
    focusDirections: [...originalWeeklyPlan.focusDirections, tempFocus],
  }),
});
if (!patchedPlan.ok) throw new Error(`PATCH /api/weekly-plan/current returned ${patchedPlan.status}`);
const updatedPlan = await patchedPlan.json();
if (!updatedPlan.focusDirections.includes(tempFocus)) throw new Error("PATCH /api/weekly-plan/current did not update focusDirections");
console.log("PASS PATCH /api/weekly-plan/current");

const restoredPlan = await fetch(`${API_URL}/api/weekly-plan/current`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    targetApplications: originalWeeklyPlan.targetApplications,
    focusDirections: originalWeeklyPlan.focusDirections,
    focusCities: originalWeeklyPlan.focusCities,
    focusCompanies: originalWeeklyPlan.focusCompanies,
    practiceThemes: originalWeeklyPlan.practiceThemes,
  }),
});
if (!restoredPlan.ok) throw new Error(`restore PATCH /api/weekly-plan/current returned ${restoredPlan.status}`);

const tempTask = {
  id: `WT-CHECK-${Date.now()}`,
  title: "API check temporary weekly task",
  detail: "temporary",
  source: "manual",
  sourceLabel: "api:check",
  level: "P1",
  status: "open",
};

const createdTask = await fetch(`${API_URL}/api/weekly-plan/current/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(tempTask),
});
if (!createdTask.ok) throw new Error(`POST /api/weekly-plan/current/tasks returned ${createdTask.status}`);
const createdWeeklyTask = await createdTask.json();
if (createdWeeklyTask.id !== tempTask.id || createdWeeklyTask.level !== "P1") throw new Error("POST /api/weekly-plan/current/tasks returned unexpected task");
console.log("PASS POST /api/weekly-plan/current/tasks");
const weeklyTaskTodayActions = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (!weeklyTaskTodayActions.some((action) => action.source === "weekly" && action.taskId === tempTask.id && action.page === "weekly")) {
  throw new Error("open weekly task should appear in today actions");
}
console.log("PASS open weekly task creates today action");

const updatedTask = await fetch(`${API_URL}/api/weekly-tasks/${encodeURIComponent(tempTask.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "done", level: "P0" }),
});
if (!updatedTask.ok) throw new Error(`PATCH /api/weekly-tasks/:id returned ${updatedTask.status}`);
const updatedWeeklyTask = await updatedTask.json();
if (updatedWeeklyTask.status !== "done" || updatedWeeklyTask.level !== "P0") throw new Error("PATCH /api/weekly-tasks/:id did not update status/level");
console.log("PASS PATCH /api/weekly-tasks/:id");
const completedWeeklyTaskTodayActions = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (completedWeeklyTaskTodayActions.some((action) => action.source === "weekly" && action.taskId === tempTask.id)) {
  throw new Error("completed weekly task should not appear in today actions");
}
const weeklyPlanAfterTaskDone = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
const completedWeeklyTask = weeklyPlanAfterTaskDone.tasks.find((task) => task.id === tempTask.id);
if (completedWeeklyTask?.status !== "done") {
  throw new Error("completed weekly task should remain stored as done");
}
console.log("PASS completed weekly task disappears from today actions");

const deletedTask = await fetch(`${API_URL}/api/weekly-tasks/${encodeURIComponent(tempTask.id)}`, { method: "DELETE" });
if (!deletedTask.ok) throw new Error(`DELETE /api/weekly-tasks/:id returned ${deletedTask.status}`);
console.log("PASS DELETE /api/weekly-tasks/:id");

const tempResume = {
  id: `RV-CHECK-${Date.now()}`,
  name: "API check temporary resume",
  fileName: "api-check-resume.pdf",
  fileType: "PDF",
  fileSize: "1 KB",
  uploadedAt: "Now",
  roles: "test",
  points: "temporary",
  summary: "temporary",
  linkedOpportunityIds: [],
};

const createdResume = await fetch(`${API_URL}/api/resumes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(tempResume),
});
if (!createdResume.ok) throw new Error(`POST /api/resumes returned ${createdResume.status}`);
const createdResumePayload = await createdResume.json();
if (createdResumePayload.id !== tempResume.id) throw new Error("POST /api/resumes returned unexpected resume");
console.log("PASS POST /api/resumes");

const fetchedResume = await fetch(`${API_URL}/api/resumes/${encodeURIComponent(tempResume.id)}`);
if (!fetchedResume.ok) throw new Error(`GET /api/resumes/:id returned ${fetchedResume.status}`);
console.log("PASS GET /api/resumes/:id");

const updatedResume = await fetch(`${API_URL}/api/resumes/${encodeURIComponent(tempResume.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ roles: "updated test role" }),
});
if (!updatedResume.ok) throw new Error(`PATCH /api/resumes/:id returned ${updatedResume.status}`);
const updatedResumePayload = await updatedResume.json();
if (updatedResumePayload.roles !== "updated test role") throw new Error("PATCH /api/resumes/:id did not update roles");
console.log("PASS PATCH /api/resumes/:id");

const linkedOpportunities = await fetch(`${API_URL}/api/resumes/${encodeURIComponent(tempResume.id)}/linked-opportunities`);
if (!linkedOpportunities.ok) throw new Error(`GET /api/resumes/:id/linked-opportunities returned ${linkedOpportunities.status}`);
const linkedOpportunitiesPayload = await linkedOpportunities.json();
if (!Array.isArray(linkedOpportunitiesPayload)) throw new Error("GET /api/resumes/:id/linked-opportunities returned unexpected payload");
console.log("PASS GET /api/resumes/:id/linked-opportunities");

const deletedResume = await fetch(`${API_URL}/api/resumes/${encodeURIComponent(tempResume.id)}`, { method: "DELETE" });
if (!deletedResume.ok) throw new Error(`DELETE /api/resumes/:id returned ${deletedResume.status}`);
console.log("PASS DELETE /api/resumes/:id");

const tempInterview = {
  id: `INT-CHECK-${Date.now()}`,
  company: "API check temporary company",
  role: "Temporary role",
  round: "API Check",
  date: "Today",
  sourceFiles: [
    {
      id: `FILE-CHECK-${Date.now()}`,
      kind: "transcript",
      fileName: "api-check-interview.txt",
      detail: "temporary",
      uploadedAt: "Now",
    },
  ],
  qaPairs: [
    {
      id: `QA-CHECK-${Date.now()}`,
      question: "API check temporary question",
      originalAnswer: "temporary",
      type: "MANUAL",
      score: 3,
      critique: "temporary",
      weak: true,
      framework: "背景 -> 动作 -> 结果",
      optimizedAnswer: "temporary",
    },
  ],
};

const createdInterview = await fetch(`${API_URL}/api/interviews`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(tempInterview),
});
if (!createdInterview.ok) throw new Error(`POST /api/interviews returned ${createdInterview.status}`);
const createdInterviewPayload = await createdInterview.json();
if (createdInterviewPayload.id !== tempInterview.id || createdInterviewPayload.qaPairs.length !== 1) {
  throw new Error("POST /api/interviews returned unexpected interview");
}
console.log("PASS POST /api/interviews");
const interviewTodayActions = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (
  !interviewTodayActions.some(
    (action) => action.source === "interview" && action.targetId === tempInterview.id && action.detail.includes("1 个薄弱回答需要处理"),
  )
) {
  throw new Error("weak interview QA should create pending review today action");
}
console.log("PASS weak interview QA creates pending review action");

const clearedOriginalQa = await fetch(`${API_URL}/api/qa-pairs/${encodeURIComponent(tempInterview.qaPairs[0].id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ weak: false }),
});
if (!clearedOriginalQa.ok) throw new Error(`PATCH original /api/qa-pairs/:id returned ${clearedOriginalQa.status}`);
const interviewTodayActionsAfterOriginalClear = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (interviewTodayActionsAfterOriginalClear.some((action) => action.source === "interview" && action.targetId === tempInterview.id)) {
  throw new Error("interview without weak QA should not create pending review today action");
}
console.log("PASS cleared interview QA removes pending review action");

const fetchedInterview = await fetch(`${API_URL}/api/interviews/${encodeURIComponent(tempInterview.id)}`);
if (!fetchedInterview.ok) throw new Error(`GET /api/interviews/:id returned ${fetchedInterview.status}`);
console.log("PASS GET /api/interviews/:id");

const updatedInterview = await fetch(`${API_URL}/api/interviews/${encodeURIComponent(tempInterview.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ round: "Updated API Check" }),
});
if (!updatedInterview.ok) throw new Error(`PATCH /api/interviews/:id returned ${updatedInterview.status}`);
const updatedInterviewPayload = await updatedInterview.json();
if (updatedInterviewPayload.round !== "Updated API Check") throw new Error("PATCH /api/interviews/:id did not update round");
console.log("PASS PATCH /api/interviews/:id");

const extraQa = {
  id: `QA-CHECK-EXTRA-${Date.now()}`,
  question: "API check extra temporary question",
  originalAnswer: "temporary",
  type: "MANUAL",
  score: 2,
  critique: "temporary",
  weak: true,
  framework: "背景 -> 动作 -> 结果",
  optimizedAnswer: "temporary",
};
const createdQa = await fetch(`${API_URL}/api/interviews/${encodeURIComponent(tempInterview.id)}/qa`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(extraQa),
});
if (!createdQa.ok) throw new Error(`POST /api/interviews/:id/qa returned ${createdQa.status}`);
const createdQaPayload = await createdQa.json();
if (createdQaPayload.id !== extraQa.id) throw new Error("POST /api/interviews/:id/qa returned unexpected QA pair");
console.log("PASS POST /api/interviews/:id/qa");

const answerFromQa = await fetch(`${API_URL}/api/qa-pairs/${encodeURIComponent(extraQa.id)}/create-answer-card`, {
  method: "POST",
});
if (!answerFromQa.ok) throw new Error(`POST /api/qa-pairs/:id/create-answer-card returned ${answerFromQa.status}`);
const answerFromQaPayload = await answerFromQa.json();
if (
  answerFromQaPayload.question !== extraQa.question ||
  answerFromQaPayload.sourceQaPairId !== extraQa.id ||
  answerFromQaPayload.status !== "ACTIVE" ||
  answerFromQaPayload.practiceStatus !== "薄弱"
) {
  throw new Error("POST /api/qa-pairs/:id/create-answer-card returned unexpected answer card");
}
const repeatedAnswerFromQa = await fetch(`${API_URL}/api/qa-pairs/${encodeURIComponent(extraQa.id)}/create-answer-card`, {
  method: "POST",
});
if (!repeatedAnswerFromQa.ok) throw new Error(`repeated POST /api/qa-pairs/:id/create-answer-card returned ${repeatedAnswerFromQa.status}`);
const repeatedAnswerFromQaPayload = await repeatedAnswerFromQa.json();
if (repeatedAnswerFromQaPayload.id !== answerFromQaPayload.id) {
  throw new Error("POST /api/qa-pairs/:id/create-answer-card did not dedupe by source QA");
}
console.log("PASS POST /api/qa-pairs/:id/create-answer-card");

const updatedQa = await fetch(`${API_URL}/api/qa-pairs/${encodeURIComponent(extraQa.id)}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ weak: false, critique: "updated" }),
});
if (!updatedQa.ok) throw new Error(`PATCH /api/qa-pairs/:id returned ${updatedQa.status}`);
const updatedQaPayload = await updatedQa.json();
if (updatedQaPayload.weak !== false || updatedQaPayload.critique !== "updated") throw new Error("PATCH /api/qa-pairs/:id did not update QA pair");
console.log("PASS PATCH /api/qa-pairs/:id");
const interviewTodayActionsAfterExtraClear = await fetch(`${API_URL}/api/dashboard/today-actions`).then((response) => response.json());
if (interviewTodayActionsAfterExtraClear.some((action) => action.source === "interview" && action.targetId === tempInterview.id)) {
  throw new Error("interview should leave today actions after all weak QA are handled");
}
console.log("PASS handled interview QA removes today action");

const interviewLinkedTask = {
  id: `WT-CHECK-INTERVIEW-${Date.now()}`,
  title: "API check interview-linked task",
  detail: "temporary",
  source: "interview",
  sourceLabel: "api:check",
  relatedEntityId: tempInterview.id,
  level: "P2",
  status: "open",
};
const createdInterviewLinkedTask = await fetch(`${API_URL}/api/weekly-plan/current/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(interviewLinkedTask),
});
if (!createdInterviewLinkedTask.ok) throw new Error(`POST interview-linked weekly task returned ${createdInterviewLinkedTask.status}`);

const deletedQa = await fetch(`${API_URL}/api/qa-pairs/${encodeURIComponent(extraQa.id)}`, { method: "DELETE" });
if (!deletedQa.ok) throw new Error(`DELETE /api/qa-pairs/:id returned ${deletedQa.status}`);
console.log("PASS DELETE /api/qa-pairs/:id");

const deletedInterview = await fetch(`${API_URL}/api/interviews/${encodeURIComponent(tempInterview.id)}`, { method: "DELETE" });
if (!deletedInterview.ok) throw new Error(`DELETE /api/interviews/:id returned ${deletedInterview.status}`);
const weeklyPlanAfterInterviewDelete = await fetch(`${API_URL}/api/weekly-plan/current`).then((response) => response.json());
if (weeklyPlanAfterInterviewDelete.tasks.some((task) => task.source === "interview" && task.relatedEntityId === tempInterview.id)) {
  throw new Error("DELETE /api/interviews/:id did not remove interview-linked training tasks");
}
console.log("PASS DELETE /api/interviews/:id");

console.log(`API check passed: ${API_URL}`);
