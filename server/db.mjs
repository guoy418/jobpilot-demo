import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  compareOpportunityActions,
  computeOpportunityAction,
  countWeeklySubmittedApplications,
  createSubmittedTransitionEvent,
  defaultOpportunityNextAction,
  getRestorableOpportunityStatus,
  inferDueDateFromText,
  isSubmittedTimelineEvent,
  normalizeOpportunityDeadlinePatch,
  opportunityActionValues,
  opportunityStatusFlow,
  opportunityStatusNextAction,
  resolveOpportunityAction,
  shouldAdvanceLinkedOpportunityAfterInterview,
  shouldRecordSubmittedTransition,
  statusLabel as opportunityStatusLabel,
  submittedStatuses,
} from "../shared/opportunityRules.mjs";
import { BACKUP_SCHEMA_VERSION, validateBackupPayload } from "./backupValidation.mjs";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const DB_PATH = process.env.JOBPILOT_DB_PATH || path.join(DATA_DIR, "jobpilot.local.sqlite");
const FILE_DIR = process.env.JOBPILOT_FILE_DIR || path.join(DATA_DIR, "files");

const UNCATEGORIZED_ANSWER_CATEGORY_ID = "CAT-UNCATEGORIZED";
const defaultAnswerCategories = [
  { id: UNCATEGORIZED_ANSWER_CATEGORY_ID, name: "尚未归类", parentId: null, sortOrder: 0, system: true },
  { id: "CAT-BASIC", name: "个人基础信息类", parentId: null, sortOrder: 10, system: false },
  { id: "CAT-BEHAVIORAL", name: "行为问题", parentId: null, sortOrder: 20, system: false },
  { id: "CAT-MOTIVATION", name: "动机相关", parentId: null, sortOrder: 30, system: false },
  { id: "CAT-GENERAL", name: "通用问题案例库", parentId: null, sortOrder: 40, system: false },
  { id: "CAT-INTERNSHIP", name: "某段实习相关", parentId: null, sortOrder: 50, system: false },
  { id: "CAT-INTERNSHIP-PROJECTS", name: "项目经历问题", parentId: "CAT-INTERNSHIP", sortOrder: 10, system: false },
  { id: "CAT-INTERNSHIP-DETAILS", name: "业务理解/细节追问", parentId: "CAT-INTERNSHIP", sortOrder: 20, system: false },
];

const actionPrioritySet = new Set(opportunityActionValues);

const selectWeeklySubmittedApplications = (opportunities, weeklyPlan) => {
  return countWeeklySubmittedApplications(opportunities, weeklyPlan);
};

const normalizeOpportunityAction = (value, fallback = "P1") => (actionPrioritySet.has(value) ? value : fallback);

const sortTodayActions = (actions) => [...actions].sort((left, right) => compareOpportunityActions(left.level, right.level));

const opportunityCompletionOutcome = (status) => {
  if (status === "TO APPLY") return "完成后会标记为已投递，并计入本周投递进度。";
  if (status === "WRITTEN TEST") return "完成后会推进到筛选中，今日行动不再继续催办这一项。";
  if (status === "INTERVIEWING") return "完成后会推进到等结果，后续复盘从面试记录进入训练。";
  return "完成后会按岗位当前阶段推进下一步。";
};

const weeklyTaskReason = (task) => {
  if (task.source === "answer") return "这张答案卡已被加入本周计划，所以进入今日行动。";
  if (task.source === "interview") return "这条面试复盘任务已被加入本周计划，需要今天推进。";
  if (task.source === "weekly-focus") return "本周重点被拆成了一个可执行动作。";
  return "这是本周计划中仍未完成的自定义动作。";
};

const nowIso = () => new Date().toISOString();
let idSequence = 0;
const makeId = (prefix) => {
  idSequence = (idSequence + 1) % 10000;
  return `${prefix}-${Date.now().toString().slice(-5)}-${idSequence.toString().padStart(4, "0")}-${Math.floor(Math.random() * 90 + 10)}`;
};
const sequenceIso = (index) => new Date(Date.now() + index).toISOString();
const sanitizeFileName = (fileName = "upload.bin") =>
  fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "upload.bin";

const rowsToMap = (rows, key) =>
  rows.reduce((groups, row) => {
    const groupKey = row[key];
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
    return groups;
  }, new Map());

const parseJson = (value, fallback = []) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const formatFileSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const storageUriToFileName = (storageUri = "") => {
  const prefix = "/api/files/";
  if (!storageUri.startsWith(prefix)) return "";
  return sanitizeFileName(decodeURIComponent(storageUri.slice(prefix.length)));
};

const createRestoreTempDir = (prefix) => {
  const parentDir = path.dirname(FILE_DIR);
  fs.mkdirSync(parentDir, { recursive: true });
  return fs.mkdtempSync(path.join(parentDir, prefix));
};

const cleanupRestoreTempDir = (dirPath) => {
  if (!dirPath) return;
  const parentDir = path.dirname(FILE_DIR);
  const baseName = path.basename(dirPath);
  if (path.dirname(dirPath) !== parentDir || !baseName.startsWith(".jobpilot-restore-")) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
};

const stageStoredFiles = (storedFiles) => {
  const stagingDir = createRestoreTempDir(".jobpilot-restore-files-");
  try {
    storedFiles.forEach((file) => {
      const storedFileName = storageUriToFileName(file.storageUri) || sanitizeFileName(file.fileName);
      if (!storedFileName || !file.dataBase64) return;
      fs.writeFileSync(path.join(stagingDir, storedFileName), Buffer.from(String(file.dataBase64), "base64"));
    });
    return stagingDir;
  } catch (error) {
    cleanupRestoreTempDir(stagingDir);
    throw error;
  }
};

const replaceStoredFileDir = (stagingDir) => {
  let backupDir = "";
  try {
    if (fs.existsSync(FILE_DIR)) {
      backupDir = createRestoreTempDir(".jobpilot-restore-current-");
      fs.rmSync(backupDir, { recursive: true, force: true });
      fs.renameSync(FILE_DIR, backupDir);
    }
    fs.renameSync(stagingDir, FILE_DIR);
  } catch (error) {
    if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(FILE_DIR)) {
      try {
        fs.renameSync(backupDir, FILE_DIR);
      } catch (restoreError) {
        throw new Error(
          `Failed to replace stored files: ${error instanceof Error ? error.message : String(error)}. Failed to restore previous files: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`,
        );
      }
    }
    throw error;
  }
  if (backupDir) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      // The restore has already succeeded; stale temp cleanup should not fail the request.
    }
  }
};

const assertArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`Backup field ${label} must be an array`);
  return value;
};

const hasTimelineSignal = (opportunity, keyword) =>
  opportunity.timeline.some((event) => `${event.title} ${event.detail}`.includes(keyword));

const buildOpportunityPipeline = (opportunity, sessions) => {
  const restoredStatus = opportunity.previousStatus && opportunity.previousStatus !== "ENDED" ? opportunity.previousStatus : undefined;
  const currentStatus = opportunity.status === "ENDED" ? restoredStatus : opportunity.status;
  const currentIndex = currentStatus ? opportunityStatusFlow.indexOf(currentStatus) : -1;
  const hasWrittenTest = opportunity.status === "WRITTEN TEST" || hasTimelineSignal(opportunity, "笔试");
  const hasInterview = sessions.length > 0 || ["INTERVIEWING", "WAITING", "OFFER"].includes(opportunity.status);

  const stageState = (stageStatus, optional = false) => {
    const stageIndex = opportunityStatusFlow.indexOf(stageStatus);
    if (stageStatus === currentStatus) return opportunity.status === "ENDED" ? "done" : "current";
    if (optional && stageStatus === "WRITTEN TEST" && currentIndex > stageIndex && !hasWrittenTest) return "skipped";
    if (stageIndex < currentIndex) return "done";
    return "next";
  };

  const stages = [
    {
      key: "to-apply",
      label: "待投递",
      state: stageState("TO APPLY"),
      detail: opportunity.status === "TO APPLY" ? opportunity.nextAction : `已使用 ${opportunity.resumeId ? "简历版本" : "待选简历"} 建档`,
      source: "system",
    },
    {
      key: "applied",
      label: "已投递",
      state: stageState("APPLIED"),
      detail: submittedStatuses.includes(opportunity.status) ? "投递动作已完成或被手动确认" : "点击“标记已投递”后自动推进",
      source: "manual",
    },
    {
      key: "written-test",
      label: "准备笔试",
      state: stageState("WRITTEN TEST", true),
      detail: hasWrittenTest ? "已记录笔试或测评节点" : "不是每个岗位都有，未出现时可跳过",
      source: hasWrittenTest ? "manual" : "system",
    },
    {
      key: "screening",
      label: "筛选中",
      state: stageState("SCREENING"),
      detail: opportunity.status === "SCREENING" ? opportunity.nextAction : "笔试或投递后等待筛选反馈",
      source: "system",
    },
    {
      key: "interview",
      label: "准备面试",
      state: stageState("INTERVIEWING"),
      detail: hasInterview ? (sessions.length > 0 ? `${sessions.length} 场面试已关联` : "已进入面试/等结果阶段") : "添加面试复盘后自动推进到这里",
      source: sessions.length > 0 ? "system" : "manual",
      subItems: sessions.map((session) => ({
        label: session.round,
        detail: `${session.company} / ${session.role} / ${session.date}`,
        state: "done",
      })),
    },
    {
      key: "waiting",
      label: "等结果",
      state: stageState("WAITING"),
      detail: opportunity.status === "WAITING" ? opportunity.nextAction : "面试结束后可手动切到等结果",
      source: "manual",
    },
    {
      key: "offer",
      label: "Offer",
      state: stageState("OFFER"),
      detail: opportunity.status === "OFFER" ? "已进入 Offer 对比和取舍" : "最终结果节点",
      source: "manual",
    },
  ];

  if (opportunity.status === "ENDED") {
    stages.push({
      key: "ended",
      label: "已结束",
      state: "current",
      detail: opportunity.endedAt ? `结束于 ${opportunity.endedAt}` : "已从默认推进视图和今日行动中隐藏",
      source: "manual",
    });
  }

  return stages;
};

const toOpportunity = (row, sourceAssets = [], timeline = []) => ({
  id: row.id,
  title: row.title,
  company: row.company,
  status: row.status,
  endedAt: row.ended_at ?? undefined,
  endedReason: row.ended_reason ?? undefined,
  endedNote: row.ended_note ?? undefined,
  previousStatus: row.previous_status ?? undefined,
  priority: row.priority,
  match: row.match,
  action: row.action,
  actionManual: Boolean(row.action_manual),
  city: row.city,
  deadline: row.deadline,
  dueDate: row.due_date ?? undefined,
  note: row.note ?? "",
  resumeId: row.resume_id ?? "",
  nextAction: row.next_action,
  jdSummary: row.jd_summary,
  jdText: row.jd_text,
  sourceAssets,
  timeline,
});

const toSourceAsset = (row) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  detail: row.detail,
  createdAt: row.created_at,
  content: row.content ?? undefined,
  storageUri: row.storage_uri ?? undefined,
});

const toTimelineEvent = (row) => ({
  id: row.id,
  occurredAt: row.occurred_at,
  title: row.title,
  detail: row.detail,
  status: row.status,
});

const toSessionFile = (row) => ({
  id: row.id,
  kind: row.kind,
  fileName: row.file_name,
  detail: row.detail,
  uploadedAt: row.uploaded_at,
  duration: row.duration ?? undefined,
  storageUri: row.storage_uri ?? undefined,
  content: row.content ?? undefined,
});

const toQaPair = (row) => ({
  id: row.id,
  question: row.question,
  originalAnswer: row.original_answer,
  type: row.type,
  score: row.score,
  critique: row.critique,
  weak: Boolean(row.weak),
  framework: row.framework,
  optimizedAnswer: row.optimized_answer,
});

const toInterviewSession = (row, sourceFiles = [], qaPairs = []) => ({
  id: row.id,
  opportunityId: row.opportunity_id ?? undefined,
  company: row.company,
  role: row.role,
  round: row.round,
  date: row.date,
  note: row.note ?? "",
  reviewPriority: normalizeOpportunityAction(row.review_priority, "P1"),
  sourceFiles,
  qaPairs,
});

const normalizeAnswerStatus = (status = "") => (status === "DRAFT" ? "DRAFT" : "ACTIVE");

const normalizeAnswerPracticeStatus = (practiceStatus = "", status = "") => {
  if (practiceStatus === "薄弱" || status === "NEEDS PRACTICE" || practiceStatus === "练习中") return "薄弱";
  if (practiceStatus === "熟练" || practiceStatus === "可复用") return "熟练";
  return "中等";
};

const normalizeAnswerCategoryId = (categoryId) => String(categoryId || "").trim() || UNCATEGORIZED_ANSWER_CATEGORY_ID;

const toAnswerCategory = (row) => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id ?? undefined,
  sortOrder: row.sort_order,
  system: Boolean(row.system),
});

const toAnswerCard = (row) => ({
  id: row.id,
  question: row.question,
  type: row.type,
  status: normalizeAnswerStatus(row.status),
  source: row.source,
  sourceQaPairId: row.source_qa_pair_id ?? undefined,
  categoryId: normalizeAnswerCategoryId(row.category_id),
  framework: row.framework,
  answer: row.answer,
  relatedRoles: row.related_roles,
  practiceStatus: normalizeAnswerPracticeStatus(row.practice_status, row.status),
});

const toResumeVersion = (row, linkedOpportunityIds = []) => ({
  id: row.id,
  name: row.name,
  fileName: row.file_name,
  fileType: row.file_type,
  fileSize: row.file_size,
  uploadedAt: row.uploaded_at,
  roles: row.roles,
  points: row.points,
  summary: row.summary,
  linkedOpportunityIds,
  storageUri: row.storage_uri ?? undefined,
});

const toWeeklyTask = (row) => ({
  id: row.id,
  title: row.title,
  detail: row.detail,
  source: row.source,
  sourceLabel: row.source_label,
  relatedEntityId: row.related_entity_id ?? undefined,
  level: row.level ?? "P2",
  status: row.status,
});

const createSchema = (db) => {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      status TEXT NOT NULL,
      ended_at TEXT,
      ended_reason TEXT,
      ended_note TEXT,
      previous_status TEXT,
      priority TEXT NOT NULL,
      match TEXT NOT NULL,
      action TEXT NOT NULL,
      city TEXT NOT NULL,
      deadline TEXT NOT NULL,
      due_date TEXT,
      note TEXT NOT NULL DEFAULT '',
      resume_id TEXT,
      next_action TEXT NOT NULL,
      jd_summary TEXT NOT NULL,
      jd_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS opportunity_source_assets (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      content TEXT,
      storage_uri TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS opportunity_timeline_events (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interview_sessions (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      round TEXT NOT NULL,
      date TEXT NOT NULL,
      note TEXT,
      review_priority TEXT NOT NULL DEFAULT 'P1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
    );

    CREATE TABLE IF NOT EXISTS interview_source_files (
      id TEXT PRIMARY KEY,
      interview_session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      detail TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      duration TEXT,
      content TEXT,
      storage_uri TEXT,
      FOREIGN KEY (interview_session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS qa_pairs (
      id TEXT PRIMARY KEY,
      interview_session_id TEXT NOT NULL,
      question TEXT NOT NULL,
      original_answer TEXT NOT NULL,
      type TEXT NOT NULL,
      score INTEGER NOT NULL,
      critique TEXT NOT NULL,
      weak INTEGER NOT NULL,
      framework TEXT NOT NULL,
      optimized_answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (interview_session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS answer_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL,
      system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answer_cards (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      source_qa_pair_id TEXT,
      category_id TEXT,
      framework TEXT NOT NULL,
      answer TEXT NOT NULL,
      related_roles TEXT NOT NULL,
      practice_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resume_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      roles TEXT NOT NULL,
      points TEXT NOT NULL,
      summary TEXT NOT NULL,
      storage_uri TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      target_applications INTEGER NOT NULL,
      focus_directions_json TEXT NOT NULL,
      focus_cities_json TEXT NOT NULL,
      focus_companies_json TEXT NOT NULL,
      practice_themes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_tasks (
      id TEXT PRIMARY KEY,
      weekly_plan_id TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      source TEXT NOT NULL,
      source_label TEXT NOT NULL,
      related_entity_id TEXT,
      level TEXT NOT NULL DEFAULT 'P2',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (weekly_plan_id) REFERENCES weekly_plans(id) ON DELETE CASCADE
    );
  `);
};

const ensureColumn = (db, tableName, columnName, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const migrateSchema = (db) => {
  ensureColumn(db, "opportunities", "due_date", "TEXT");
  ensureColumn(db, "opportunities", "note", "TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE opportunities SET note = deadline WHERE (note IS NULL OR note = '') AND TRIM(deadline) <> '' AND deadline <> '待定'").run();
  ensureColumn(db, "opportunities", "action_manual", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "opportunities", "ended_at", "TEXT");
  ensureColumn(db, "opportunities", "ended_reason", "TEXT");
  ensureColumn(db, "opportunities", "ended_note", "TEXT");
  ensureColumn(db, "opportunities", "previous_status", "TEXT");
  ensureColumn(db, "opportunity_source_assets", "storage_uri", "TEXT");
  ensureColumn(db, "interview_sessions", "note", "TEXT");
  ensureColumn(db, "interview_sessions", "review_priority", "TEXT NOT NULL DEFAULT 'P1'");
  ensureColumn(db, "interview_source_files", "content", "TEXT");
  ensureColumn(db, "interview_source_files", "storage_uri", "TEXT");
  ensureColumn(db, "resume_versions", "storage_uri", "TEXT");
  ensureColumn(db, "weekly_tasks", "level", "TEXT NOT NULL DEFAULT 'P2'");
  ensureColumn(db, "answer_cards", "category_id", "TEXT");
};

const ensureDefaultAnswerCategories = (db) => {
  const timestamp = nowIso();
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO answer_categories (
      id, name, parent_id, sort_order, system, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  defaultAnswerCategories.forEach((category) =>
    insertCategory.run(
      category.id,
      category.name,
      category.parentId,
      category.sortOrder,
      category.system ? 1 : 0,
      timestamp,
      timestamp,
    ),
  );
};

const seedDatabase = (db) => {
  const count = db.prepare("SELECT COUNT(*) AS count FROM opportunities").get().count;
  if (count > 0) return;

  const createdAt = nowIso();
  const insertOpportunity = db.prepare(`
    INSERT INTO opportunities (
      id, title, company, status, priority, match, action, city, deadline, resume_id,
      next_action, jd_summary, jd_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSource = db.prepare(`
    INSERT INTO opportunity_source_assets (
      id, opportunity_id, kind, title, detail, content, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTimeline = db.prepare(`
    INSERT INTO opportunity_timeline_events (
      id, opportunity_id, occurred_at, title, detail, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInterview = db.prepare(`
    INSERT INTO interview_sessions (
      id, opportunity_id, company, role, round, date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFile = db.prepare(`
    INSERT INTO interview_source_files (
      id, interview_session_id, kind, file_name, detail, uploaded_at, duration
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertQa = db.prepare(`
    INSERT INTO qa_pairs (
      id, interview_session_id, question, original_answer, type, score, critique,
      weak, framework, optimized_answer, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAnswer = db.prepare(`
    INSERT INTO answer_cards (
      id, question, type, status, source, category_id, framework, answer, related_roles,
      practice_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertResume = db.prepare(`
    INSERT INTO resume_versions (
      id, name, file_name, file_type, file_size, uploaded_at, roles, points,
      summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPlan = db.prepare(`
    INSERT INTO weekly_plans (
      id, week_start, target_applications, focus_directions_json, focus_cities_json,
      focus_companies_json, practice_themes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = db.prepare(`
    INSERT INTO weekly_tasks (
      id, weekly_plan_id, title, detail, source, source_label, related_entity_id,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const opportunities = [
    [
      "OP-021",
      "前端开发实习生",
      "字节跳动",
      "TO APPLY",
      "A",
      "HIGH",
      "P0",
      "上海",
      "Tomorrow",
      "RV-101",
      "补充低代码项目指标后投递",
      "前端开发实习生，偏低代码平台和业务组件。需要 React、性能优化、组件库经验，并能讲清项目指标。",
      "岗位职责：参与低代码平台前端模块开发，负责业务组件沉淀、页面性能优化和跨端体验改进。岗位要求：熟悉 React、TypeScript、组件化开发，有性能优化或工程化经验优先。",
    ],
    [
      "OP-020",
      "增长产品实习生",
      "小红书",
      "INTERVIEWING",
      "A",
      "MEDIUM",
      "P1",
      "上海",
      "May 28",
      "RV-102",
      "准备业务拆解和反问",
      "增长产品实习生，关注用户增长、数据分析、实验设计和业务拆解。当前已进入面试阶段。",
      "岗位职责：参与增长策略设计、用户行为分析和实验复盘。岗位要求：具备数据分析意识，能拆解业务问题，有产品或运营项目经验优先。",
    ],
    [
      "OP-019",
      "数据分析实习生",
      "美团",
      "APPLIED",
      "B",
      "HIGH",
      "P1",
      "北京",
      "May 31",
      "RV-103",
      "三天后跟进内推人",
      "数据分析实习生，偏 SQL、Python、指标体系和业务分析。已投递，下一步是跟进内推反馈。",
      "岗位职责：负责业务数据分析、指标看板建设和专题分析。岗位要求：熟悉 SQL/Python，能建立指标体系，有互联网业务分析项目经验优先。",
    ],
    [
      "OP-018",
      "AI 产品运营实习生",
      "快手",
      "WAITING",
      "B",
      "MEDIUM",
      "P2",
      "杭州",
      "Jun 03",
      "RV-102",
      "整理 AIGC 案例库",
      "AI 产品运营实习生，关注 AIGC 案例库、运营策略和内容数据复盘。当前等待结果。",
      "岗位职责：参与 AI 产品运营、内容策略制定和用户反馈整理。岗位要求：理解 AIGC 工具，具备内容运营和数据复盘经验。",
    ],
  ];

  for (const item of opportunities) insertOpportunity.run(...item, createdAt, createdAt);

  [
    ["SRC-021-1", "OP-021", "jd-text", "岗位 JD 文本", "从岗位推进内新增后生成正式记录", opportunities[0][12], "May 24 22:11"],
    ["SRC-021-2", "OP-021", "screenshot", "招聘页截图", "保留原始招聘页，方便后续核对岗位要求", "截图预览占位：招聘页标题、公司、岗位要求、截止时间和投递入口会保存在本地文件库。", "May 24 22:12"],
    ["SRC-020-1", "OP-020", "job-link", "招聘链接", "来自小红书校招页面", "https://job.xiaohongshu.com/growth-product-intern", "May 20 19:40"],
    ["SRC-020-2", "OP-020", "referral-note", "内推备注", "内推人建议重点准备增长案例", "内推人备注：业务面会重点看增长拆解、指标意识和反问质量。", "May 21 10:05"],
    ["SRC-019-1", "OP-019", "job-link", "招聘链接", "来自美团招聘官网", "https://zhaopin.meituan.com/job/business-analysis-intern", "May 21 20:14"],
    ["SRC-019-2", "OP-019", "jd-text", "JD 原文", "系统从链接中提取并保留原文", opportunities[2][12], "May 21 20:16"],
    ["SRC-019-3", "OP-019", "referral-note", "内推沟通记录", "内推人建议突出 SQL 和指标体系", "沟通记录：简历里 SQL 和指标体系要放到第一屏，投递后 3 天可跟进。", "May 21 20:24"],
    ["SRC-018-1", "OP-018", "jd-text", "JD 文本", "来自手动粘贴的岗位说明", opportunities[3][12], "May 18 21:30"],
    ["SRC-018-2", "OP-018", "screenshot", "岗位截图", "保留招聘页面关键要求", "截图预览占位：快手 AI 产品运营实习生招聘页。", "May 18 21:31"],
  ].forEach((item) => insertSource.run(...item));

  [
    ["TL-021-1", "OP-021", "May 24 22:11", "导入 JD 文本", "分类为岗位 JD，备注：字节低代码前端实习", "done"],
    ["TL-021-2", "OP-021", "May 24 22:13", "生成岗位草稿", "系统提取公司、岗位、城市、技能关键词和截止时间", "done"],
    ["TL-021-3", "OP-021", "May 24 22:15", "确认进入岗位推进", "用户确认优先级 A，匹配度 HIGH，使用 FE Intern v7", "done"],
    ["TL-021-4", "OP-021", "Next", "补充项目指标后投递", "待补齐低代码项目的性能指标，再执行投递", "next"],
    ["TL-020-1", "OP-020", "May 20 19:40", "导入招聘链接", "分类为招聘链接，备注：增长产品实习", "done"],
    ["TL-020-2", "OP-020", "May 20 19:43", "确认岗位草稿", "提取岗位要求并选择 Product Hybrid v3", "done"],
    ["TL-020-3", "OP-020", "May 21 10:08", "完成内推投递", "通过内推渠道提交，补充增长案例说明", "done"],
    ["TL-020-4", "OP-020", "May 22 18:30", "收到业务面邀请", "面试复盘已关联到 INT-010", "done"],
    ["TL-020-5", "OP-020", "Next", "准备业务拆解和反问", "从本岗位 JD 和面试复盘生成练习任务", "next"],
    ["TL-019-1", "OP-019", "May 21 20:14", "导入招聘链接", "分类为招聘链接，备注：美团数据分析实习", "done"],
    ["TL-019-2", "OP-019", "May 21 20:16", "生成岗位草稿", "系统解析 JD，并保留原链接和 JD 原文", "done"],
    ["TL-019-3", "OP-019", "May 21 20:18", "确认进入岗位推进", "确认城市北京、优先级 B、匹配度 HIGH", "done"],
    ["TL-019-4", "OP-019", "May 21 20:22", "选择简历版本", "本次投递使用 Data v2，突出 SQL、Python 和指标体系", "done"],
    ["TL-019-5", "OP-019", "May 21 20:35", "完成投递", "通过官网投递并同步给内推人", "done"],
    ["TL-019-6", "OP-019", "May 24 09:00", "生成跟进动作", "三天后跟进内推人，已进入今日行动", "done"],
    ["TL-018-1", "OP-018", "May 18 21:30", "导入 JD", "分类为岗位 JD，备注：快手 AI 产品运营", "done"],
    ["TL-018-2", "OP-018", "May 18 21:33", "确认岗位信息", "确认城市杭州、优先级 B、使用 Product Hybrid v3", "done"],
    ["TL-018-3", "OP-018", "May 19 09:20", "完成投递", "已提交材料并进入等待结果状态", "done"],
    ["TL-018-4", "OP-018", "Next", "整理 AIGC 案例库", "补充可用于后续面试的运营案例", "next"],
  ].forEach((item) => insertTimeline.run(...item, createdAt));

  [
    ["INT-011", null, "腾讯", "前端开发实习生", "一面", "May 24"],
    ["INT-010", "OP-020", "小红书", "增长产品实习生", "业务面", "May 22"],
  ].forEach((item) => insertInterview.run(...item, createdAt, createdAt));

  [
    ["FILE-011-A", "INT-011", "audio", "tencent-round1-recording.m4a", "腾讯一面原录音，已和本场 4 个问题关联", "May 24 20:42", "42:18"],
    ["FILE-011-T", "INT-011", "transcript", "tencent-round1-transcript.md", "由录音转写后的文字稿，复盘问题从这里拆分", "May 24 20:47", null],
    ["FILE-010-A", "INT-010", "audio", "xiaohongshu-business-interview.m4a", "小红书业务面原录音，已和本场 2 个问题关联", "May 22 21:34", "36:05"],
    ["FILE-010-T", "INT-010", "transcript", "xiaohongshu-business-transcript.md", "面试文字稿，包含增长拆解和北极星指标追问", "May 22 21:40", null],
  ].forEach((item) => insertFile.run(...item));

  [
    ["QA-101", "INT-011", "你在低代码项目里如何衡量性能优化结果？", "我主要做了首屏优化、拆包和缓存，页面打开更快了，用户体验更好。", "PROJECT", 2, "原回答只有动作，没有基线、指标和复盘口径。面试官很难判断你到底贡献了多少。", 1, "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制", "项目开始时首屏约 3.2s，目标是把核心页面压到 2s 内。我先用性能面板定位阻塞资源，再做路由级拆包、图片懒加载和缓存策略，最后首屏降到 1.7s，构建产物减少 28%。复盘来看，我会补一组真实用户监控数据，让结论更稳定。", 0],
    ["QA-102", "INT-011", "为什么从前端转向产品策略岗位？", "我觉得自己既懂技术，也对业务比较感兴趣，所以想尝试产品方向。", "MOTIVATION", 3, "动机可信，但需要把技术背景转成岗位优势，并说明不是逃离技术。", 1, "经历触发 -> 能力迁移 -> 岗位匹配 -> 短期学习计划", "我不是放弃技术，而是希望把技术理解用于更前置的判断。前端经历让我熟悉用户路径、性能约束和工程成本；在产品策略岗位上，这些能力能帮助我把需求拆得更可落地。短期我会补齐行业分析和指标体系，形成技术理解加业务判断的组合。", 1],
    ["QA-103", "INT-011", "React 状态管理你会如何选型？", "简单状态用 useState，跨组件用 Context，复杂项目可能会用 Zustand 或 Redux。", "TECHNICAL", 4, "结构完整，可以补充多人协作、调试能力和状态生命周期的取舍。", 0, "状态范围 -> 更新频率 -> 调试协作 -> 持久化需求", "我会先看状态范围和更新频率。局部 UI 状态用组件内 state；中等范围共享状态用 Context 或 Zustand；如果是复杂业务、多人协作、需要可追踪调试和中间件，就考虑 Redux Toolkit。选型时我会避免为了工具而工具。", 2],
    ["QA-201", "INT-010", "你会如何拆解一个新用户留存下降的问题？", "我会先看数据，然后分析用户路径，找到可能流失的环节。", "PRODUCT", 3, "方向对，但拆解层级不够，缺少分群、漏斗和假设验证。", 1, "定义指标 -> 分群定位 -> 漏斗拆解 -> 假设排序 -> 实验验证", "我会先明确留存口径，比如 D1/D7 和核心行为留存，再按渠道、首日行为、设备和新老版本分群。接着看注册、首刷、关注、互动等关键漏斗，找出异常最大的环节。最后把假设按影响面和验证成本排序，用小实验验证。", 0],
    ["QA-202", "INT-010", "如果你要做一个 AI 求职工具，核心北极星指标是什么？", "我觉得可以看用户使用次数和投递数量。", "PRODUCT", 4, "能想到行为指标，但还要贴近产品承诺：提升求职执行确定性。", 0, "产品承诺 -> 成功行为 -> 领先指标 -> 滞后指标", "我会把北极星指标定义为每周完成的有效求职动作数，比如确认岗位、完成投递、完成复盘和练习。投递数量只是其中之一，更重要的是从材料进入到行动完成的闭环率。辅助指标可以看草稿确认率、复盘完成率和 P0/P1 动作完成率。", 1],
  ].forEach((item) => insertQa.run(...item, createdAt, createdAt));

  [
    ["AC-101", "如何讲清楚项目结果？", "PROJECT", "ACTIVE", "面试复盘", "CAT-GENERAL", "背景 -> 目标 -> 动作 -> 指标 -> 复盘", "先说明项目背景和目标，再给出你负责的动作，最后用指标证明结果。重点是避免只说“做了优化”，要说优化前后差异。", "前端 / 全栈 / 技术产品", "薄弱"],
    ["AC-102", "如何回答职业动机？", "HR", "DRAFT", "手动创建", "CAT-MOTIVATION", "触发经历 -> 能力迁移 -> 岗位匹配 -> 短期计划", "我不是放弃技术，而是希望把技术理解用于更前置的业务判断。短期会补齐行业分析和指标体系。", "产品 / 策略 / 运营", "中等"],
    ["AC-103", "如何解释技术选型？", "TECHNICAL", "ACTIVE", "手动创建", "CAT-GENERAL", "场景复杂度 -> 团队协作 -> 调试成本 -> 长期维护", "我会先看状态范围和更新频率，再判断团队协作、调试能力和持久化需求，不为了工具而工具。", "前端 / 全栈", "熟练"],
  ].forEach((item) => insertAnswer.run(...item, createdAt, createdAt));

  [
    ["RV-101", "FE Intern v7", "frontend-intern-v7.pdf", "PDF", "428 KB", "May 20", "前端 / 全栈", "React, 性能优化, 组件库", "强调前端工程能力、性能优化结果和组件抽象经验，适合技术岗投递。"],
    ["RV-102", "Product Hybrid v3", "product-hybrid-v3.pdf", "PDF", "392 KB", "May 18", "产品 / 策略", "用户增长, 数据分析, AI 工具", "弱化纯工程细节，突出用户路径、指标拆解和 AI 工具使用经验。"],
    ["RV-103", "Data v2", "data-analyst-v2.pdf", "PDF", "405 KB", "May 16", "数据分析", "SQL, Python, 指标体系", "突出数据清洗、指标体系和业务分析案例，适合数据分析实习。"],
  ].forEach((item) => insertResume.run(...item, createdAt, createdAt));

  insertPlan.run(
    "WP-2026-06-02",
    "2026-06-01",
    12,
    JSON.stringify(["前端实习", "AI 产品"]),
    JSON.stringify(["上海优先"]),
    JSON.stringify(["字节跳动", "小红书"]),
    JSON.stringify(["项目表达", "系统设计基础"]),
    createdAt,
    createdAt,
  );

  [
    ["WT-101", "补齐字节岗位投递材料", "来自本周重点：前端实习 / 上海优先", "opportunity", "岗位推进", "OP-021", "open"],
    ["WT-102", "练习项目结果表达", "来自本周练习主题：项目表达", "answer", "答案库", "AC-101", "open"],
  ].forEach((item) => insertTask.run(item[0], "WP-2026-06-02", ...item.slice(1), createdAt, createdAt));
};

export const openDatabase = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FILE_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  createSchema(db);
  migrateSchema(db);
  ensureDefaultAnswerCategories(db);
  seedDatabase(db);
  return db;
};

export const createRepository = (db) => {
  const listOpportunitySourceAssets = (opportunityId) =>
    db
      .prepare("SELECT * FROM opportunity_source_assets WHERE opportunity_id = ? ORDER BY created_at ASC, id ASC")
      .all(opportunityId)
      .map(toSourceAsset);

  const listOpportunityTimeline = (opportunityId) =>
    db
      .prepare("SELECT * FROM opportunity_timeline_events WHERE opportunity_id = ? ORDER BY created_at ASC, id ASC")
      .all(opportunityId)
      .map(toTimelineEvent);

  const listOpportunities = () =>
    db
      .prepare("SELECT * FROM opportunities ORDER BY created_at DESC, id DESC")
      .all()
      .map((row) => toOpportunity(row, listOpportunitySourceAssets(row.id), listOpportunityTimeline(row.id)));

  const getOpportunity = (id) => {
    const row = db.prepare("SELECT * FROM opportunities WHERE id = ?").get(id);
    return row ? toOpportunity(row, listOpportunitySourceAssets(row.id), listOpportunityTimeline(row.id)) : null;
  };

  const replaceOpportunitySourceAssets = (opportunityId, sourceAssets = []) => {
    db.prepare("DELETE FROM opportunity_source_assets WHERE opportunity_id = ?").run(opportunityId);
    const insertSource = db.prepare(`
      INSERT INTO opportunity_source_assets (
        id, opportunity_id, kind, title, detail, content, storage_uri, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    sourceAssets.forEach((asset, index) =>
      insertSource.run(
        asset.id || makeId("SRC"),
        opportunityId,
        asset.kind || "jd-text",
        asset.title?.trim() || "岗位 JD",
        asset.detail?.trim() || "岗位原始材料",
        asset.content ?? null,
        asset.storageUri ?? null,
        asset.createdAt?.trim() || sequenceIso(index),
      ),
    );
  };

  const replaceOpportunityTimeline = (opportunityId, timeline = []) => {
    db.prepare("DELETE FROM opportunity_timeline_events WHERE opportunity_id = ?").run(opportunityId);
    const insertTimeline = db.prepare(`
      INSERT INTO opportunity_timeline_events (
        id, opportunity_id, occurred_at, title, detail, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    timeline.forEach((event, index) =>
      insertTimeline.run(
        event.id || makeId("TL"),
        opportunityId,
        event.occurredAt?.trim() || "Now",
        event.title?.trim() || "岗位状态更新",
        event.detail?.trim() || "岗位推进操作记录",
        event.status || "done",
        sequenceIso(index),
      ),
    );
  };

  const timelineWithSubmittedTransitionEvent = (timeline = [], status, sourceOpportunity = null, occurredAt = nowIso(), progressEvents = []) => {
    const doneTimeline = timeline.filter((event) => event.status !== "next");
    const nextTimeline = timeline.filter((event) => event.status === "next");
    const submittedTransitionEvent =
      sourceOpportunity && shouldRecordSubmittedTransition(sourceOpportunity, status) && ![...doneTimeline, ...progressEvents].some(isSubmittedTimelineEvent)
        ? [
            createSubmittedTransitionEvent({
              id: makeId("TL"),
              occurredAt,
              fromStatus: sourceOpportunity.status,
              toStatus: status,
            }),
          ]
        : [];

    return {
      doneTimeline: [...doneTimeline, ...submittedTransitionEvent],
      nextTimeline,
    };
  };

  const timelineWithSyncedNextEvent = (
    timeline = [],
    status,
    nextAction,
    detail = "由当前岗位进度生成下一步动作",
    sourceOpportunity = null,
    occurredAt = nowIso(),
    progressEvent = null,
  ) => {
    const progressEvents = progressEvent ? [progressEvent] : [];
    const { doneTimeline } = timelineWithSubmittedTransitionEvent(timeline, status, sourceOpportunity, occurredAt, progressEvents);

    return [
      ...doneTimeline,
      ...progressEvents,
      ...(status !== "OFFER" && status !== "ENDED"
        ? [
            {
              id: makeId("TL"),
              occurredAt: "Next",
              title: nextAction,
              detail,
              status: "next",
            },
          ]
        : []),
    ];
  };

  const hasLinkedInterviews = (opportunityId) => Boolean(db.prepare("SELECT 1 FROM interview_sessions WHERE opportunity_id = ? LIMIT 1").get(opportunityId));

  const createOpportunity = (input, options = {}) => {
    const { syncSubmittedTransition = true } = options;
    const timestamp = nowIso();
    const status = input.status || "TO APPLY";
    const endedAt = status === "ENDED" ? input.endedAt || nowIso() : input.endedAt || null;
    const endedReason = status === "ENDED" ? input.endedReason || "OTHER" : input.endedReason || null;
    const endedNote = input.endedNote?.trim() || null;
    const previousStatus = status === "ENDED" ? input.previousStatus || "APPLIED" : input.previousStatus || null;
    const deadline = input.deadline?.trim() || "待定";
    const dueDate = input.dueDate || inferDueDateFromText(deadline);
    const priority = input.priority || "B";
    const match = input.match || "MEDIUM";
    const actionManual = Boolean(input.actionManual);
    const action = actionManual && input.action ? input.action : computeOpportunityAction({ status, deadline, dueDate, match, priority });
    const id = input.id || makeId("OP");
    db.prepare(`
      INSERT INTO opportunities (
        id, title, company, status, ended_at, ended_reason, ended_note, previous_status, priority, match, action, action_manual, city, deadline, due_date, resume_id,
        next_action, jd_summary, jd_text, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title?.trim() || "未填写岗位",
      input.company?.trim() || "未填写公司",
      status,
      endedAt,
      endedReason,
      endedNote,
      previousStatus,
      priority,
      match,
      action,
      actionManual ? 1 : 0,
      input.city?.trim() || "待定",
      deadline,
      dueDate || null,
      input.resumeId || null,
      input.nextAction?.trim() || opportunityStatusNextAction[status] || "补齐材料后投递",
      input.jdSummary?.trim() || "由岗位推进内上传材料解析生成的岗位记录。",
      input.jdText?.trim() || "待补充 JD 原文。",
      input.note?.trim() || "",
      timestamp,
      timestamp,
    );
    replaceOpportunitySourceAssets(id, input.sourceAssets ?? []);
    if (syncSubmittedTransition) {
      const sourceOpportunity = { status: "TO APPLY", timeline: input.timeline ?? [] };
      const syncedTimeline = timelineWithSubmittedTransitionEvent(input.timeline ?? [], status, sourceOpportunity, timestamp);
      replaceOpportunityTimeline(id, [...syncedTimeline.doneTimeline, ...syncedTimeline.nextTimeline]);
    } else {
      replaceOpportunityTimeline(id, input.timeline ?? []);
    }
    return getOpportunity(id);
  };

  const updateOpportunity = (id, patch) => {
    const current = getOpportunity(id);
    if (!current) return null;
    const normalizedPatch = normalizeOpportunityDeadlinePatch(patch);
    const hasExplicitStatus = "status" in normalizedPatch && Boolean(normalizedPatch.status);
    const shouldRestoreEndedWithoutStatus =
      current.status === "ENDED" &&
      !hasExplicitStatus &&
      (normalizedPatch.endedAt === null || normalizedPatch.endedReason === null || normalizedPatch.endedNote === null || normalizedPatch.previousStatus === null);
    const restoredStatus = shouldRestoreEndedWithoutStatus ? getRestorableOpportunityStatus(current, hasLinkedInterviews(id)) : undefined;
    const next = {
      ...current,
      ...normalizedPatch,
      ...(restoredStatus ? { status: restoredStatus } : {}),
    };
    const statusChanged = next.status !== current.status;
    if (hasExplicitStatus && normalizedPatch.status === "ENDED") {
      next.endedAt = normalizedPatch.endedAt || current.endedAt || nowIso();
      next.endedReason = normalizedPatch.endedReason || current.endedReason || "OTHER";
      next.endedNote = normalizedPatch.endedNote ?? current.endedNote ?? null;
      next.previousStatus =
        normalizedPatch.previousStatus && normalizedPatch.previousStatus !== "ENDED"
          ? normalizedPatch.previousStatus
          : current.status !== "ENDED"
            ? current.status
            : getRestorableOpportunityStatus(current, hasLinkedInterviews(id));
    } else if (shouldRestoreEndedWithoutStatus || (hasExplicitStatus && normalizedPatch.status !== "ENDED")) {
      next.endedAt = normalizedPatch.endedAt ?? null;
      next.endedReason = normalizedPatch.endedReason ?? null;
      next.endedNote = normalizedPatch.endedNote ?? null;
      next.previousStatus = normalizedPatch.previousStatus ?? null;
    }
    if (statusChanged && !("nextAction" in normalizedPatch)) {
      next.nextAction = defaultOpportunityNextAction(next.status);
    }
    if ("deadline" in normalizedPatch && !("dueDate" in normalizedPatch)) next.dueDate = inferDueDateFromText(next.deadline);
    if (!next.actionManual && (statusChanged || ["deadline", "dueDate", "priority", "match"].some((field) => field in normalizedPatch)) && !("action" in normalizedPatch)) {
      next.action = computeOpportunityAction(next);
    }
    if ("actionManual" in normalizedPatch && normalizedPatch.actionManual === false && !("action" in normalizedPatch)) {
      next.action = computeOpportunityAction(next);
    }
    db.prepare(`
      UPDATE opportunities
      SET title = ?,
          company = ?,
          status = ?,
          ended_at = ?,
          ended_reason = ?,
          ended_note = ?,
          previous_status = ?,
          priority = ?,
          match = ?,
          action = ?,
          action_manual = ?,
          city = ?,
          deadline = ?,
          due_date = ?,
          note = ?,
          resume_id = ?,
          next_action = ?,
          jd_summary = ?,
          jd_text = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.company,
      next.status,
      next.endedAt ?? null,
      next.endedReason ?? null,
      next.endedNote ?? null,
      next.previousStatus ?? null,
      next.priority,
      next.match,
      next.action,
      next.actionManual ? 1 : 0,
      next.city,
      next.deadline,
      next.dueDate || null,
      next.note ?? "",
      next.resumeId || null,
      next.nextAction,
      next.jdSummary,
      next.jdText,
      nowIso(),
      id,
    );
    if (normalizedPatch.sourceAssets) replaceOpportunitySourceAssets(id, normalizedPatch.sourceAssets);
    if (normalizedPatch.timeline) {
      if (statusChanged) {
        const syncedTimeline = timelineWithSubmittedTransitionEvent(normalizedPatch.timeline, next.status, current);
        replaceOpportunityTimeline(id, [...syncedTimeline.doneTimeline, ...syncedTimeline.nextTimeline]);
      } else {
        replaceOpportunityTimeline(id, normalizedPatch.timeline);
      }
    } else if (statusChanged) {
      replaceOpportunityTimeline(id, timelineWithSyncedNextEvent(current.timeline, next.status, next.nextAction, "由当前岗位进度生成下一步动作", current));
    }
    return getOpportunity(id);
  };

  const addOpportunityProgress = (id, input) => {
    const current = getOpportunity(id);
    if (!current) return null;
    const status = input.status || current.status;
    const nextAction = input.nextAction || defaultOpportunityNextAction(status) || current.nextAction;
    const progressEvent = {
      id: input.timelineEvent?.id || makeId("TL"),
      occurredAt: input.timelineEvent?.occurredAt || nowIso(),
      title: input.timelineEvent?.title || `更新为${status}`,
      detail: input.timelineEvent?.detail || "岗位进度更新",
      status: "done",
    };
    const nextTimeline = timelineWithSyncedNextEvent(current.timeline, status, nextAction, "由当前岗位进度生成下一步动作", current, progressEvent.occurredAt, progressEvent);
    const updatedOpportunity = updateOpportunity(id, {
      status,
      ...(status === "ENDED"
        ? {
            endedAt: input.endedAt || nowIso(),
            endedReason: input.endedReason || "OTHER",
            endedNote: input.endedNote ?? null,
            previousStatus:
              input.previousStatus && input.previousStatus !== "ENDED"
                ? input.previousStatus
                : current.status !== "ENDED"
                  ? current.status
                  : getRestorableOpportunityStatus(current, hasLinkedInterviews(id)),
          }
        : current.status === "ENDED"
          ? {
              endedAt: null,
              endedReason: null,
              endedNote: null,
              previousStatus: null,
            }
          : {}),
      ...(current.actionManual ? {} : { action: input.action || computeOpportunityAction({ ...current, status }) }),
      nextAction,
      timeline: nextTimeline,
    });
    return updatedOpportunity;
  };

  const deleteOpportunity = (id) => {
    const current = getOpportunity(id);
    if (!current) return false;
    const timestamp = nowIso();
    db.prepare("UPDATE interview_sessions SET opportunity_id = NULL, updated_at = ? WHERE opportunity_id = ?").run(timestamp, id);
    db.prepare("DELETE FROM weekly_tasks WHERE source = ? AND related_entity_id = ?").run("opportunity", id);
    db.prepare("DELETE FROM opportunities WHERE id = ?").run(id);
    return true;
  };

  const listInterviews = () => {
    const sessions = db.prepare("SELECT * FROM interview_sessions ORDER BY created_at DESC, id DESC").all();
    const filesBySession = rowsToMap(db.prepare("SELECT * FROM interview_source_files ORDER BY uploaded_at ASC, id ASC").all(), "interview_session_id");
    const qaBySession = rowsToMap(db.prepare("SELECT * FROM qa_pairs ORDER BY sort_order ASC, id ASC").all(), "interview_session_id");

    return sessions.map((session) =>
      toInterviewSession(
        session,
        (filesBySession.get(session.id) ?? []).map(toSessionFile),
        (qaBySession.get(session.id) ?? []).map(toQaPair),
      ),
    );
  };

  const getInterview = (id) => {
    const session = db.prepare("SELECT * FROM interview_sessions WHERE id = ?").get(id);
    if (!session) return null;
    const sourceFiles = db
      .prepare("SELECT * FROM interview_source_files WHERE interview_session_id = ? ORDER BY uploaded_at ASC, id ASC")
      .all(id)
      .map(toSessionFile);
    const qaPairs = db
      .prepare("SELECT * FROM qa_pairs WHERE interview_session_id = ? ORDER BY sort_order ASC, id ASC")
      .all(id)
      .map(toQaPair);
    return toInterviewSession(session, sourceFiles, qaPairs);
  };

  const getQaPair = (id) => {
    const row = db.prepare("SELECT * FROM qa_pairs WHERE id = ?").get(id);
    return row ? toQaPair(row) : null;
  };

  const createQaPair = (interviewId, input) => {
    const session = getInterview(interviewId);
    if (!session) return null;
    const timestamp = nowIso();
    let id = input.id || makeId("QA");
    if (db.prepare("SELECT 1 FROM qa_pairs WHERE id = ?").get(id)) {
      id = makeId("QA");
    }
    const nextSortOrder =
      db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM qa_pairs WHERE interview_session_id = ?").get(interviewId).sort_order ?? 0;
    db.prepare(`
      INSERT INTO qa_pairs (
        id, interview_session_id, question, original_answer, type, score, critique,
        weak, framework, optimized_answer, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      interviewId,
      input.question?.trim() || "新增问题：请在这里补充面试官原问题",
      input.originalAnswer?.trim() || "在这里记录你的原回答。",
      input.type?.trim() || "MANUAL",
      Number(input.score ?? 3),
      input.critique?.trim() || "在这里补充评价。",
      input.weak === undefined ? 1 : input.weak ? 1 : 0,
      input.framework?.trim() || "背景 -> 动作 -> 结果 -> 复盘",
      input.optimizedAnswer?.trim() || "在这里整理推荐回答表述。",
      nextSortOrder,
      timestamp,
      timestamp,
    );
    return getQaPair(id);
  };

  const createInterview = (input, options = {}) => {
    const { advanceOpportunity = true } = options;
    const timestamp = nowIso();
    const id = input.id || makeId("INT");
    db.prepare(`
      INSERT INTO interview_sessions (
        id, opportunity_id, company, role, round, date, note, review_priority, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.opportunityId || null,
      input.company?.trim() || "未填写公司",
      input.role?.trim() || "未填写岗位",
      input.round?.trim() || "面试",
      input.date?.trim() || "Today",
      input.note?.trim() || "",
      normalizeOpportunityAction(input.reviewPriority, "P1"),
      timestamp,
      timestamp,
    );

    const insertFile = db.prepare(`
      INSERT INTO interview_source_files (
        id, interview_session_id, kind, file_name, detail, uploaded_at, duration, content, storage_uri
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (input.sourceFiles ?? []).forEach((file) =>
      insertFile.run(
        file.id || makeId("FILE"),
        id,
        file.kind || "transcript",
        file.fileName?.trim() || "interview-notes.txt",
        file.detail?.trim() || "面试原始材料",
        file.uploadedAt?.trim() || "Now",
        file.duration ?? null,
        file.content ?? null,
        file.storageUri ?? null,
      ),
    );

    (input.qaPairs ?? []).forEach((pair) => createQaPair(id, pair));
    const linkedOpportunity = input.opportunityId ? getOpportunity(input.opportunityId) : null;
    if (advanceOpportunity && linkedOpportunity && shouldAdvanceLinkedOpportunityAfterInterview(linkedOpportunity.status)) {
      addOpportunityProgress(input.opportunityId, {
        status: "WAITING",
        timelineEvent: {
          id: makeId("TL"),
          occurredAt: "Now",
          title: "进度更新为等结果",
          detail: `新增${input.round?.trim() || "面试"}面试复盘后自动推进`,
          status: "done",
        },
      });
    }
    return getInterview(id);
  };

  const updateInterview = (id, patch) => {
    const current = getInterview(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
    };
    db.prepare(`
      UPDATE interview_sessions
      SET opportunity_id = ?,
          company = ?,
          role = ?,
          round = ?,
          date = ?,
          note = ?,
          review_priority = ?,
          updated_at = ?
      WHERE id = ?
    `).run(next.opportunityId || null, next.company, next.role, next.round, next.date, next.note || "", normalizeOpportunityAction(next.reviewPriority, "P1"), nowIso(), id);
    return getInterview(id);
  };

  const deleteInterview = (id) => {
    const current = getInterview(id);
    if (!current) return false;
    db.prepare("DELETE FROM weekly_tasks WHERE source = ? AND related_entity_id = ?").run("interview", id);
    db.prepare("DELETE FROM interview_sessions WHERE id = ?").run(id);
    return true;
  };

  const updateQaPair = (id, patch) => {
    const current = getQaPair(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
    };
    db.prepare(`
      UPDATE qa_pairs
      SET question = ?,
          original_answer = ?,
          type = ?,
          score = ?,
          critique = ?,
          weak = ?,
          framework = ?,
          optimized_answer = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      next.question,
      next.originalAnswer,
      next.type,
      Number(next.score),
      next.critique,
      next.weak ? 1 : 0,
      next.framework,
      next.optimizedAnswer,
      nowIso(),
      id,
    );
    return getQaPair(id);
  };

  const deleteQaPair = (id) => {
    const current = getQaPair(id);
    if (!current) return false;
    db.prepare("DELETE FROM qa_pairs WHERE id = ?").run(id);
    return true;
  };

  const listAnswerCategories = () =>
    db
      .prepare("SELECT * FROM answer_categories ORDER BY parent_id IS NOT NULL ASC, sort_order ASC, name ASC, id ASC")
      .all()
      .map(toAnswerCategory);

  const getAnswerCategory = (id) => {
    const row = db.prepare("SELECT * FROM answer_categories WHERE id = ?").get(id);
    return row ? toAnswerCategory(row) : null;
  };

  const answerCategoryExists = (id) => Boolean(db.prepare("SELECT 1 FROM answer_categories WHERE id = ?").get(id));

  const resolveAnswerCategoryId = (categoryId) => {
    const id = normalizeAnswerCategoryId(categoryId);
    return answerCategoryExists(id) ? id : UNCATEGORIZED_ANSWER_CATEGORY_ID;
  };

  const createAnswerCategory = (input) => {
    const timestamp = nowIso();
    let id = input.id || makeId("CAT");
    if (db.prepare("SELECT 1 FROM answer_categories WHERE id = ?").get(id)) {
      id = makeId("CAT");
    }
    const parentId = input.parentId && answerCategoryExists(input.parentId) && input.parentId !== UNCATEGORIZED_ANSWER_CATEGORY_ID ? input.parentId : null;
    const nextSortOrder =
      input.sortOrder ??
      (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM answer_categories WHERE parent_id IS ?").get(parentId).sort_order ?? 0);
    db.prepare(`
      INSERT INTO answer_categories (
        id, name, parent_id, sort_order, system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name?.trim() || "新分类", parentId, Number(nextSortOrder) || 0, input.system ? 1 : 0, timestamp, timestamp);
    return getAnswerCategory(id);
  };

  const updateAnswerCategory = (id, patch) => {
    const current = getAnswerCategory(id);
    if (!current) return null;
    const nextName = current.system ? current.name : patch.name?.trim() || current.name;
    const nextParentId =
      current.system || patch.parentId === id
        ? current.parentId ?? null
        : patch.parentId && answerCategoryExists(patch.parentId) && patch.parentId !== UNCATEGORIZED_ANSWER_CATEGORY_ID
          ? patch.parentId
          : patch.parentId === undefined
            ? current.parentId ?? null
            : null;
    db.prepare(`
      UPDATE answer_categories
      SET name = ?,
          parent_id = ?,
          sort_order = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nextName, nextParentId, Number(patch.sortOrder ?? current.sortOrder) || 0, nowIso(), id);
    return getAnswerCategory(id);
  };

  const restoreAnswerCategory = (category) => {
    if (!category.id) return createAnswerCategory(category);
    return answerCategoryExists(category.id) ? updateAnswerCategory(category.id, category) : createAnswerCategory(category);
  };

  const collectAnswerCategoryDescendantIds = (id) => {
    const all = listAnswerCategories();
    const result = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      all.forEach((category) => {
        if (category.parentId && result.has(category.parentId) && !result.has(category.id)) {
          result.add(category.id);
          changed = true;
        }
      });
    }
    return [...result];
  };

  const deleteAnswerCategory = (id) => {
    const current = getAnswerCategory(id);
    if (!current || current.system) return false;
    const ids = collectAnswerCategoryDescendantIds(id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE answer_cards SET category_id = ?, updated_at = ? WHERE category_id IN (${placeholders})`).run(
      UNCATEGORIZED_ANSWER_CATEGORY_ID,
      nowIso(),
      ...ids,
    );
    db.prepare(`DELETE FROM answer_categories WHERE id IN (${placeholders})`).run(...ids);
    return true;
  };

  const listAnswers = () => db.prepare("SELECT * FROM answer_cards ORDER BY created_at DESC, id DESC").all().map(toAnswerCard);

  const getAnswer = (id) => {
    const row = db.prepare("SELECT * FROM answer_cards WHERE id = ?").get(id);
    return row ? toAnswerCard(row) : null;
  };

  const createAnswer = (input) => {
    const timestamp = nowIso();
    const id = input.id || makeId("AC");
    const categoryId = resolveAnswerCategoryId(input.categoryId);
    db.prepare(`
      INSERT INTO answer_cards (
        id, question, type, status, source, source_qa_pair_id, framework, answer,
        related_roles, practice_status, category_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.question?.trim() || "未命名答案卡",
      input.type?.trim() || "MANUAL",
      normalizeAnswerStatus(input.status || "DRAFT"),
      input.source?.trim() || "手动创建",
      input.sourceQaPairId ?? null,
      input.framework?.trim() || "背景 -> 动作 -> 结果 -> 复盘",
      input.answer?.trim() || "在这里补充可复用回答。",
      input.relatedRoles?.trim() || "待填写",
      normalizeAnswerPracticeStatus(input.practiceStatus?.trim(), input.status || "DRAFT"),
      categoryId,
      timestamp,
      timestamp,
    );
    return getAnswer(id);
  };

  const createAnswerFromQaPair = (qaPairId) => {
    const existing = db.prepare("SELECT * FROM answer_cards WHERE source_qa_pair_id = ? LIMIT 1").get(qaPairId);
    if (existing) return toAnswerCard(existing);

    const row = db
      .prepare(
        `SELECT qa_pairs.*, interview_sessions.role
         FROM qa_pairs
         JOIN interview_sessions ON interview_sessions.id = qa_pairs.interview_session_id
         WHERE qa_pairs.id = ?`,
      )
      .get(qaPairId);
    if (!row) return null;

    return createAnswer({
      question: row.question,
      type: row.type,
      status: "ACTIVE",
      source: "面试复盘",
      sourceQaPairId: qaPairId,
      framework: row.framework,
      answer: row.optimized_answer,
      relatedRoles: row.role,
      practiceStatus: row.weak ? "薄弱" : "中等",
    });
  };

  const updateAnswer = (id, patch) => {
    const current = getAnswer(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
    };
    db.prepare(`
      UPDATE answer_cards
      SET question = ?,
          type = ?,
          status = ?,
          source = ?,
          framework = ?,
          answer = ?,
          related_roles = ?,
          practice_status = ?,
          category_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      next.question,
      next.type,
      normalizeAnswerStatus(next.status),
      next.source,
      next.framework,
      next.answer,
      next.relatedRoles,
      normalizeAnswerPracticeStatus(next.practiceStatus, next.status),
      resolveAnswerCategoryId(next.categoryId),
      nowIso(),
      id,
    );
    return getAnswer(id);
  };

  const deleteAnswer = (id) => {
    const current = getAnswer(id);
    if (!current) return false;
    db.prepare("DELETE FROM weekly_tasks WHERE source = ? AND related_entity_id = ?").run("answer", id);
    db.prepare("DELETE FROM answer_cards WHERE id = ?").run(id);
    return true;
  };

  const listResumes = () => {
    const opportunities = db.prepare("SELECT id, resume_id FROM opportunities WHERE resume_id IS NOT NULL").all();
    const linkedByResume = rowsToMap(opportunities, "resume_id");
    return db
      .prepare("SELECT * FROM resume_versions ORDER BY uploaded_at DESC, id DESC")
      .all()
      .map((resume) => toResumeVersion(resume, (linkedByResume.get(resume.id) ?? []).map((row) => row.id)));
  };

  const getResume = (id) => {
    const row = db.prepare("SELECT * FROM resume_versions WHERE id = ?").get(id);
    if (!row) return null;
    const linkedOpportunityIds = db.prepare("SELECT id FROM opportunities WHERE resume_id = ? ORDER BY created_at DESC, id DESC").all(id).map((item) => item.id);
    return toResumeVersion(row, linkedOpportunityIds);
  };

  const listResumeLinkedOpportunities = (id) =>
    db
      .prepare("SELECT * FROM opportunities WHERE resume_id = ? ORDER BY created_at DESC, id DESC")
      .all(id)
      .map((row) => toOpportunity(row, listOpportunitySourceAssets(row.id), listOpportunityTimeline(row.id)));

  const createResume = (input) => {
    const timestamp = nowIso();
    const id = input.id || makeId("RV");
    db.prepare(`
      INSERT INTO resume_versions (
        id, name, file_name, file_type, file_size, uploaded_at, roles, points,
        summary, storage_uri, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name?.trim() || "未命名简历版本",
      input.fileName?.trim() || "resume.pdf",
      input.fileType?.trim() || "PDF",
      input.fileSize?.trim() || "待读取",
      input.uploadedAt?.trim() || "Now",
      input.roles?.trim() || "待填写",
      input.points?.trim() || "待填写核心卖点",
      input.summary?.trim() || "待填写文件摘要",
      input.storageUri ?? null,
      timestamp,
      timestamp,
    );
    return getResume(id);
  };

  const updateResume = (id, patch) => {
    const current = getResume(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
    };
    db.prepare(`
      UPDATE resume_versions
      SET name = ?,
          file_name = ?,
          file_type = ?,
          file_size = ?,
          uploaded_at = ?,
          roles = ?,
          points = ?,
          summary = ?,
          storage_uri = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.fileName,
      next.fileType,
      next.fileSize,
      next.uploadedAt,
      next.roles,
      next.points,
      next.summary,
      next.storageUri ?? null,
      nowIso(),
      id,
    );
    return getResume(id);
  };

  const deleteResume = (id) => {
    const current = getResume(id);
    if (!current) return false;
    db.prepare("UPDATE opportunities SET resume_id = NULL, updated_at = ? WHERE resume_id = ?").run(nowIso(), id);
    db.prepare("DELETE FROM resume_versions WHERE id = ?").run(id);
    return true;
  };

  const getCurrentWeeklyPlan = () => {
    const plan = db.prepare("SELECT * FROM weekly_plans ORDER BY week_start DESC LIMIT 1").get();
    if (!plan) return null;
    const tasks = db
      .prepare("SELECT * FROM weekly_tasks WHERE weekly_plan_id = ? ORDER BY created_at ASC, id ASC")
      .all(plan.id)
      .map(toWeeklyTask);

    return {
      weekStart: plan.week_start,
      targetApplications: plan.target_applications,
      focusDirections: parseJson(plan.focus_directions_json),
      focusCities: parseJson(plan.focus_cities_json),
      focusCompanies: parseJson(plan.focus_companies_json),
      practiceThemes: parseJson(plan.practice_themes_json),
      tasks,
    };
  };

  const getCurrentWeeklyPlanRow = () => db.prepare("SELECT * FROM weekly_plans ORDER BY week_start DESC LIMIT 1").get();

  const updateCurrentWeeklyPlan = (patch) => {
    const current = getCurrentWeeklyPlanRow();
    if (!current) return null;
    db.prepare(`
      UPDATE weekly_plans
      SET target_applications = ?,
          focus_directions_json = ?,
          focus_cities_json = ?,
          focus_companies_json = ?,
          practice_themes_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      Number.isFinite(Number(patch.targetApplications ?? current.target_applications))
        ? Math.max(0, Math.round(Number(patch.targetApplications ?? current.target_applications)))
        : 0,
      JSON.stringify(patch.focusDirections ?? parseJson(current.focus_directions_json)),
      JSON.stringify(patch.focusCities ?? parseJson(current.focus_cities_json)),
      JSON.stringify(patch.focusCompanies ?? parseJson(current.focus_companies_json)),
      JSON.stringify(patch.practiceThemes ?? parseJson(current.practice_themes_json)),
      nowIso(),
      current.id,
    );
    return getCurrentWeeklyPlan();
  };

  const getWeeklyTask = (id) => {
    const row = db.prepare("SELECT * FROM weekly_tasks WHERE id = ?").get(id);
    return row ? toWeeklyTask(row) : null;
  };

  const createWeeklyTask = (input) => {
    const plan = getCurrentWeeklyPlanRow();
    if (!plan) return null;
    const timestamp = nowIso();
    const id = input.id || makeId("WT");
    db.prepare(`
      INSERT INTO weekly_tasks (
        id, weekly_plan_id, title, detail, source, source_label, related_entity_id,
        level, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      plan.id,
      input.title?.trim() || "新增训练或杂项动作",
      input.detail?.trim() || "适合放练笔试、练英语、补材料等不属于具体岗位或面试的问题。",
      input.source || "manual",
      input.sourceLabel?.trim() || "本周计划",
      input.relatedEntityId ?? null,
      input.level || "P2",
      input.status || "open",
      timestamp,
      timestamp,
    );
    return getWeeklyTask(id);
  };

  const updateWeeklyTask = (id, patch) => {
    const current = getWeeklyTask(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
    };
    db.prepare(`
      UPDATE weekly_tasks
      SET title = ?,
          detail = ?,
          source = ?,
          source_label = ?,
          related_entity_id = ?,
          level = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.detail,
      next.source,
      next.sourceLabel,
      next.relatedEntityId ?? null,
      next.level || "P2",
      next.status,
      nowIso(),
      id,
    );
    return getWeeklyTask(id);
  };

  const deleteWeeklyTask = (id) => {
    const current = getWeeklyTask(id);
    if (!current) return false;
    db.prepare("DELETE FROM weekly_tasks WHERE id = ?").run(id);
    return true;
  };

  const getDashboardSummary = () => {
    const opportunities = listOpportunities();
    const interviews = listInterviews();
    const weeklyPlan = getCurrentWeeklyPlan();
    const activeOpportunities = opportunities.filter((item) => item.status !== "ENDED");
    const opportunityActions = activeOpportunities.map(resolveOpportunityAction);
    const submittedApplications = selectWeeklySubmittedApplications(opportunities, weeklyPlan);
    const urgentCount = opportunityActions.filter((action) => action === "P0" || action === "P1").length;
    const pendingReviewCount = interviews.flatMap((item) => item.qaPairs).filter((pair) => pair.weak).length;
    const toApplyCount = activeOpportunities.filter((item) => item.status === "TO APPLY").length;
    const inProgressCount = activeOpportunities.filter((item) => item.status !== "TO APPLY" && item.status !== "OFFER").length;
    const p0Count = opportunityActions.filter((action) => action === "P0").length;
    const p1Count = opportunityActions.filter((action) => action === "P1").length;
    const weakInterviewCount = interviews.filter((item) => item.qaPairs.some((pair) => pair.weak)).length;
    const targetApplications = weeklyPlan?.targetApplications ?? 0;

    return {
      opportunityCount: opportunities.length,
      toApplyCount,
      inProgressCount,
      urgentCount,
      p0Count,
      p1Count,
      pendingReviewCount,
      weakQaCount: pendingReviewCount,
      weakInterviewCount,
      submittedApplications,
      targetApplications,
      applicationGap: Math.max(0, targetApplications - submittedApplications),
    };
  };

  const getTodayActions = () => {
    const opportunities = listOpportunities();
    const interviews = listInterviews();
    const answers = listAnswers();
    const weeklyPlan = getCurrentWeeklyPlan();
    const resumes = listResumes();
    const resumeName = (resumeId) => resumes.find((resume) => resume.id === resumeId)?.name ?? "未选择简历";
    const weeklyRoute = (task) => {
      if (task.source === "interview" && task.relatedEntityId) return { page: "interviews", targetPage: "interviews", targetId: task.relatedEntityId };
      if (task.source === "opportunity" && task.relatedEntityId) return { page: "opportunityDetail", targetPage: "opportunityDetail", targetId: task.relatedEntityId };
      if (task.source === "answer" && task.relatedEntityId) return { page: "answers", targetPage: "answers", targetId: task.relatedEntityId };
      return { page: "weekly", targetPage: "weekly", targetId: task.id };
    };

    const opportunityActions = opportunities
      .filter((item) => item.status === "TO APPLY" || item.status === "WRITTEN TEST" || item.status === "INTERVIEWING")
      .map((item) => ({
        level: resolveOpportunityAction(item),
        title:
          item.status === "TO APPLY"
            ? `投递${item.company}${item.title}`
            : item.status === "WRITTEN TEST"
              ? `完成${item.company}${item.title}笔试`
            : item.status === "INTERVIEWING"
                ? `准备${item.company}${item.title}面试`
                : `跟进${item.company}${item.title}`,
        detail: `${item.nextAction} / 使用 ${resumeName(item.resumeId)}`,
        page: "opportunityDetail",
        filter: resolveOpportunityAction(item),
        source: "opportunity",
        sourceLabel: `岗位推进 / ${item.company}`,
        why: `${opportunityStatusLabel[item.status] || item.status}阶段仍有下一步动作，优先级由状态、截止时间、匹配度和主观优先级计算。`,
        completionOutcome: opportunityCompletionOutcome(item.status),
        targetPage: "opportunityDetail",
        targetId: item.id,
      }));

    const interviewActions = interviews
      .filter((session) => session.qaPairs.some((pair) => pair.weak))
      .map((session) => ({
        level: normalizeOpportunityAction(session.reviewPriority, "P1"),
        title: `复盘${session.company}${session.round}`,
        detail: `${session.qaPairs.filter((pair) => pair.weak).length} 个薄弱回答需要处理`,
        page: "interviews",
        filter: "",
        source: "interview",
        sourceLabel: `面试复盘 / ${session.company}${session.round}`,
        why: "复盘里还有标记为薄弱的问题，适合今天先补框架或重讲。",
        completionOutcome: "完成后这些薄弱问题会被标记为已处理；如需持续练习，可加入本周计划。",
        targetPage: "interviews",
        targetId: session.id,
      }));

    const missingInterviewReviewActions = opportunities
      .filter((opportunity) => opportunity.status === "WAITING")
      .filter((opportunity) => !interviews.some((session) => session.opportunityId === opportunity.id))
      .map((opportunity) => ({
        level: resolveOpportunityAction(opportunity),
        title: `补充${opportunity.company}${opportunity.title}面试复盘`,
        detail: "已进入等结果阶段，建议趁记忆新鲜整理问题、原回答和优化回答。",
        page: "interviews",
        targetPage: "interviews",
        filter: "",
        source: "interview",
        sourceLabel: "面试复盘 / 待补充",
        why: "岗位已进入等结果阶段，但还没有关联的面试复盘，适合趁记忆新鲜补齐。",
        completionOutcome: "导入或创建面试复盘后，这个行动会自动从今日行动移除。",
        targetId: opportunity.id,
        actionKey: `interview-review-missing:${opportunity.id}`,
        intent: "create-interview-review",
      }));

    const weeklyActions = (weeklyPlan?.tasks ?? [])
      .filter((task) => task.status === "open" && task.source !== "opportunity")
      .map((task) => ({
        level: task.level || "P2",
        title: task.title,
        detail: `${task.sourceLabel}: ${task.detail}`,
        filter: "",
        source: "weekly",
        sourceLabel: `${task.sourceLabel || "本周计划"} / ${task.source === "answer" ? "答案练习" : task.source === "interview" ? "面试练习" : "计划动作"}`,
        why: weeklyTaskReason(task),
        completionOutcome: "完成后会标记本周计划任务为 done，并从今日行动移除。",
        taskId: task.id,
        ...weeklyRoute(task),
      }));

    const rawActions = [...opportunityActions, ...interviewActions, ...missingInterviewReviewActions, ...weeklyActions];
    return sortTodayActions(rawActions.filter((action, index, actions) => actions.findIndex((candidate) => candidate.title === action.title) === index));
  };

  const getOpportunityPipeline = (id) => {
    const opportunity = getOpportunity(id);
    if (!opportunity) return null;
    const sessions = listInterviews().filter((session) => session.opportunityId === id);
    return buildOpportunityPipeline(opportunity, sessions);
  };

  const listStoredFiles = () => {
    fs.mkdirSync(FILE_DIR, { recursive: true });
    return fs
      .readdirSync(FILE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(FILE_DIR, entry.name);
        const buffer = fs.readFileSync(filePath);
        return {
          storageUri: `/api/files/${encodeURIComponent(entry.name)}`,
          fileName: entry.name,
          fileSize: formatFileSize(buffer.length),
          dataBase64: buffer.toString("base64"),
        };
      });
  };

  const createBackup = () => ({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: nowIso(),
    source: "local-api",
    opportunities: listOpportunities(),
    interviewSessions: listInterviews(),
    answerCards: listAnswers(),
    answerCategories: listAnswerCategories(),
    resumeVersions: listResumes(),
    weeklyPlan: getCurrentWeeklyPlan(),
    storedFiles: listStoredFiles(),
  });

  const parseBackupPayload = (backup) => validateBackupPayload(backup).data;

  const restoreBackupRows = (backupData) => {
    const { resumeVersions, opportunities, interviewSessions, answerCards, answerCategories, weeklyPlan, weekStart } = backupData;
    db.exec(`
      DELETE FROM weekly_tasks;
      DELETE FROM weekly_plans;
      DELETE FROM qa_pairs;
      DELETE FROM interview_source_files;
      DELETE FROM interview_sessions;
      DELETE FROM opportunity_timeline_events;
      DELETE FROM opportunity_source_assets;
      DELETE FROM opportunities;
      DELETE FROM answer_cards;
      DELETE FROM answer_categories;
      DELETE FROM resume_versions;
    `);

    const resumeIds = new Set(resumeVersions.map((resume) => resume.id).filter(Boolean));
    resumeVersions.forEach((resume) => createResume(resume));

    const opportunityIds = new Set(opportunities.map((opportunity) => opportunity.id).filter(Boolean));
    const linkedInterviewOpportunityIds = new Set(interviewSessions.map((session) => session.opportunityId).filter((opportunityId) => opportunityIds.has(opportunityId)));
    opportunities.forEach((opportunity) =>
      createOpportunity(
        {
          ...opportunity,
          previousStatus:
            opportunity.status === "ENDED" && !opportunity.previousStatus && linkedInterviewOpportunityIds.has(opportunity.id)
              ? getRestorableOpportunityStatus(opportunity, true)
              : opportunity.previousStatus,
          resumeId: resumeIds.has(opportunity.resumeId) ? opportunity.resumeId : "",
        },
        { syncSubmittedTransition: false },
      ),
    );

    interviewSessions.forEach((session) =>
      createInterview(
        {
          ...session,
          opportunityId: opportunityIds.has(session.opportunityId) ? session.opportunityId : undefined,
        },
        { advanceOpportunity: false },
      ),
    );

    ensureDefaultAnswerCategories(db);
    [...answerCategories]
      .sort((left, right) => (left.parentId ? 1 : 0) - (right.parentId ? 1 : 0))
      .forEach(restoreAnswerCategory);
    answerCards.forEach((answer) => createAnswer(answer));

    const timestamp = nowIso();
    const planId = "WP-RESTORED";
    db.prepare(`
      INSERT INTO weekly_plans (
        id, week_start, target_applications, focus_directions_json, focus_cities_json,
        focus_companies_json, practice_themes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      planId,
      weeklyPlan.weekStart || weekStart || new Date().toISOString().slice(0, 10),
      Number.isFinite(Number(weeklyPlan.targetApplications ?? 0)) ? Math.max(0, Math.round(Number(weeklyPlan.targetApplications ?? 0))) : 0,
      JSON.stringify(assertArray(weeklyPlan.focusDirections ?? [], "weeklyPlan.focusDirections")),
      JSON.stringify(assertArray(weeklyPlan.focusCities ?? [], "weeklyPlan.focusCities")),
      JSON.stringify(assertArray(weeklyPlan.focusCompanies ?? [], "weeklyPlan.focusCompanies")),
      JSON.stringify(assertArray(weeklyPlan.practiceThemes ?? [], "weeklyPlan.practiceThemes")),
      timestamp,
      timestamp,
    );

    assertArray(weeklyPlan.tasks ?? [], "weeklyPlan.tasks").forEach((task) => createWeeklyTask(task));
  };

  const restoreBackupRowsInTransaction = (backupData) => {
    db.exec("BEGIN");
    try {
      restoreBackupRows(backupData);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const rollbackCommittedRestore = (previousBackup) => {
    const previousBackupData = parseBackupPayload(previousBackup);
    let previousFileStage = stageStoredFiles(previousBackupData.storedFiles);
    try {
      restoreBackupRowsInTransaction(previousBackupData);
      replaceStoredFileDir(previousFileStage);
      previousFileStage = "";
    } finally {
      cleanupRestoreTempDir(previousFileStage);
    }
  };

  const restoreBackup = (backup) => {
    const backupData = parseBackupPayload(backup);
    const previousBackup = createBackup();
    let stagedFileDir = stageStoredFiles(backupData.storedFiles);
    let databaseCommitted = false;
    try {
      restoreBackupRowsInTransaction(backupData);
      databaseCommitted = true;
      replaceStoredFileDir(stagedFileDir);
      stagedFileDir = "";
    } catch (error) {
      if (databaseCommitted) {
        try {
          rollbackCommittedRestore(previousBackup);
        } catch (rollbackError) {
          throw new Error(
            `Stored file restore failed after database restore, and rollback failed. Original error: ${
              error instanceof Error ? error.message : String(error)
            }. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
        throw new Error(
          `Stored file restore failed after database restore; previous database and files were restored. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      throw error;
    } finally {
      cleanupRestoreTempDir(stagedFileDir);
    }
    return createBackup();
  };

  const saveFile = (input) => {
    const dataBase64 = String(input?.dataBase64 ?? "");
    if (!dataBase64) throw new Error("File payload is empty");
    const fileName = sanitizeFileName(input.fileName);
    const storedFileName = `${makeId("FILE")}-${fileName}`;
    const filePath = path.join(FILE_DIR, storedFileName);
    const buffer = Buffer.from(dataBase64, "base64");
    fs.writeFileSync(filePath, buffer);
    return {
      storageUri: `/api/files/${encodeURIComponent(storedFileName)}`,
      fileName,
      fileSize: formatFileSize(buffer.length),
      mimeType: input.mimeType || "application/octet-stream",
    };
  };

  const getFilePath = (storedFileName) => {
    const safeName = sanitizeFileName(decodeURIComponent(storedFileName));
    const filePath = path.join(FILE_DIR, safeName);
    return filePath.startsWith(FILE_DIR) && fs.existsSync(filePath) ? filePath : null;
  };

  return {
    dbPath: DB_PATH,
    listOpportunities,
    getOpportunity,
    createOpportunity,
    updateOpportunity,
    addOpportunityProgress,
    deleteOpportunity,
    getOpportunityPipeline,
    listOpportunitySourceAssets,
    listOpportunityTimeline,
    listInterviews,
    getInterview,
    createInterview,
    updateInterview,
    deleteInterview,
    getQaPair,
    createQaPair,
    updateQaPair,
    deleteQaPair,
    listAnswers,
    getAnswer,
    createAnswer,
    createAnswerFromQaPair,
    updateAnswer,
    deleteAnswer,
    listAnswerCategories,
    getAnswerCategory,
    createAnswerCategory,
    updateAnswerCategory,
    deleteAnswerCategory,
    listResumes,
    getResume,
    listResumeLinkedOpportunities,
    createResume,
    updateResume,
    deleteResume,
    getCurrentWeeklyPlan,
    updateCurrentWeeklyPlan,
    getWeeklyTask,
    createWeeklyTask,
    updateWeeklyTask,
    deleteWeeklyTask,
    getDashboardSummary,
    getTodayActions,
    createBackup,
    restoreBackup,
    saveFile,
    getFilePath,
  };
};
