export const BACKUP_SCHEMA_VERSION = "jobpilot-v0.7.2";
export const LEGACY_BACKUP_SCHEMA_VERSIONS = ["jobpilot-v0.7.1", "jobpilot-v0.7.0", "jobpilot-v0.7", "jobpilot-v0.6.0", "jobpilot-v0.6"];

export class BackupValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupValidationError";
  }
}

const opportunityStatuses = new Set(["TO APPLY", "APPLIED", "WRITTEN TEST", "SCREENING", "INTERVIEWING", "WAITING", "OFFER", "ENDED"]);
const opportunityPriorities = new Set(["A", "B", "C"]);
const opportunityMatches = new Set(["HIGH", "MEDIUM", "LOW"]);
const opportunityActions = new Set(["P0", "P1", "P2", "P3"]);
const weeklyTaskSources = new Set(["manual", "weekly-focus", "opportunity", "interview", "answer"]);
const legacyBackupSchemaVersions = new Set(LEGACY_BACKUP_SCHEMA_VERSIONS);
const uncategorizedAnswerCategoryId = "CAT-UNCATEGORIZED";
const defaultAnswerCategories = [
  { id: uncategorizedAnswerCategoryId, name: "尚未归类", sortOrder: 0, system: true },
  { id: "CAT-BASIC", name: "个人基础信息类", sortOrder: 10, system: false },
  { id: "CAT-BEHAVIORAL", name: "行为问题", sortOrder: 20, system: false },
  { id: "CAT-MOTIVATION", name: "动机相关", sortOrder: 30, system: false },
  { id: "CAT-GENERAL", name: "通用问题案例库", sortOrder: 40, system: false },
  { id: "CAT-INTERNSHIP", name: "某段实习相关", sortOrder: 50, system: false },
  { id: "CAT-INTERNSHIP-PROJECTS", name: "项目经历问题", parentId: "CAT-INTERNSHIP", sortOrder: 10, system: false },
  { id: "CAT-INTERNSHIP-DETAILS", name: "业务理解/细节追问", parentId: "CAT-INTERNSHIP", sortOrder: 20, system: false },
];

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const fail = (message) => {
  throw new BackupValidationError(message);
};

const assertObject = (value, label) => {
  if (!isPlainObject(value)) fail(`Backup field ${label} must be an object`);
  return value;
};

const assertArray = (value, label) => {
  if (!Array.isArray(value)) fail(`Backup field ${label} must be an array`);
  return value;
};

const assertRequiredString = (item, field, label) => {
  if (!isNonEmptyString(item?.[field])) fail(`Backup item ${label}.${field} must be a non-empty string`);
};

const assertOptionalString = (item, field, label) => {
  if (item?.[field] !== undefined && typeof item[field] !== "string") fail(`Backup item ${label}.${field} must be a string`);
};

const assertOptionalArray = (value, label) => {
  if (value === undefined || value === null) return [];
  return assertArray(value, label);
};

const assertOneOf = (value, allowed, label) => {
  if (!allowed.has(value)) fail(`Backup field ${label} has unsupported value ${JSON.stringify(value)}`);
};

const assertUniqueIds = (items, label) => {
  const ids = new Set();
  items.forEach((item, index) => {
    assertObject(item, `${label}[${index}]`);
    assertRequiredString(item, "id", `${label}[${index}]`);
    if (ids.has(item.id)) fail(`Backup field ${label} contains duplicate id ${item.id}`);
    ids.add(item.id);
  });
  return ids;
};

const assertStringArray = (value, label) => {
  assertArray(value, label).forEach((item, index) => {
    if (typeof item !== "string") fail(`Backup field ${label}[${index}] must be a string`);
  });
};

const assertBase64 = (value, label) => {
  if (typeof value !== "string") fail(`Backup field ${label} must be a base64 string`);
  const compact = value.trim();
  if (compact && !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) fail(`Backup field ${label} is not valid base64`);
};

const optionalArrayOrEmpty = (value) => (Array.isArray(value) ? value : []);

const normalizeLegacyWeeklyPlan = (payload) => {
  const weeklyPlan = isPlainObject(payload.weeklyPlan) ? payload.weeklyPlan : {};
  return {
    ...weeklyPlan,
    weekStart: weeklyPlan.weekStart ?? payload.weekStart,
    focusDirections: optionalArrayOrEmpty(weeklyPlan.focusDirections),
    focusCities: optionalArrayOrEmpty(weeklyPlan.focusCities),
    focusCompanies: optionalArrayOrEmpty(weeklyPlan.focusCompanies),
    practiceThemes: optionalArrayOrEmpty(weeklyPlan.practiceThemes),
    tasks: optionalArrayOrEmpty(weeklyPlan.tasks ?? payload.weeklyTasks),
  };
};

const normalizeLegacyAnswerCategories = (payload) =>
  Array.isArray(payload.answerCategories) ? payload.answerCategories : defaultAnswerCategories.map((category) => ({ ...category }));

const normalizeLegacyAnswerCards = (payload) => {
  const answerCards = Array.isArray(payload.answerCards) ? payload.answerCards : payload.answers;
  if (!Array.isArray(answerCards)) return answerCards;
  const hasCategories = Array.isArray(payload.answerCategories);
  return answerCards.map((answer) => {
    if (!isPlainObject(answer) || hasCategories || isNonEmptyString(answer.categoryId)) return answer;
    return { ...answer, categoryId: uncategorizedAnswerCategoryId };
  });
};

export const migrateBackupPayload = (backup) => {
  const payload = assertObject(backup, "root");
  if (payload.schemaVersion === BACKUP_SCHEMA_VERSION) return payload;
  if (!legacyBackupSchemaVersions.has(payload.schemaVersion)) {
    fail(`Unsupported backup schemaVersion ${JSON.stringify(payload.schemaVersion)}; expected ${BACKUP_SCHEMA_VERSION}`);
  }

  return {
    ...payload,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: isNonEmptyString(payload.exportedAt) ? payload.exportedAt : "legacy-unknown",
    source: isNonEmptyString(payload.source) ? payload.source : "legacy-backup",
    opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : payload.jobs,
    interviewSessions: Array.isArray(payload.interviewSessions) ? payload.interviewSessions : payload.interviews,
    answerCards: normalizeLegacyAnswerCards(payload),
    answerCategories: normalizeLegacyAnswerCategories(payload),
    resumeVersions: Array.isArray(payload.resumeVersions) ? payload.resumeVersions : payload.resumes,
    weeklyPlan: normalizeLegacyWeeklyPlan(payload),
    storedFiles: optionalArrayOrEmpty(payload.storedFiles),
  };
};

export const summarizeBackupPayload = (backup) => {
  const payload = migrateBackupPayload(backup);
  const interviewSessions = assertArray(payload.interviewSessions, "interviewSessions");
  const weeklyPlan = assertObject(payload.weeklyPlan, "weeklyPlan");
  const weeklyTasks = assertArray(weeklyPlan.tasks, "weeklyPlan.tasks");

  return {
    opportunities: assertArray(payload.opportunities, "opportunities").length,
    resumes: assertArray(payload.resumeVersions, "resumeVersions").length,
    interviews: interviewSessions.length,
    answerCards: assertArray(payload.answerCards, "answerCards").length,
    weeklyTasks: weeklyTasks.length,
  };
};

export const validateBackupPayload = (backup) => {
  const payload = migrateBackupPayload(backup);
  if (!isNonEmptyString(payload.exportedAt)) fail("Backup field exportedAt must be a non-empty string");
  if (!isNonEmptyString(payload.source)) fail("Backup field source must be a non-empty string");

  const resumeVersions = assertArray(payload.resumeVersions, "resumeVersions");
  const opportunities = assertArray(payload.opportunities, "opportunities");
  const interviewSessions = assertArray(payload.interviewSessions, "interviewSessions");
  const answerCards = assertArray(payload.answerCards, "answerCards");
  const answerCategories = assertArray(payload.answerCategories, "answerCategories");
  const storedFiles = assertOptionalArray(payload.storedFiles, "storedFiles");
  const weeklyPlan = assertObject(payload.weeklyPlan, "weeklyPlan");
  const weeklyTasks = assertArray(weeklyPlan.tasks, "weeklyPlan.tasks");

  const resumeIds = assertUniqueIds(resumeVersions, "resumeVersions");
  const opportunityIds = assertUniqueIds(opportunities, "opportunities");
  const interviewIds = assertUniqueIds(interviewSessions, "interviewSessions");
  const answerIds = assertUniqueIds(answerCards, "answerCards");
  const categoryIds = assertUniqueIds(answerCategories, "answerCategories");
  assertUniqueIds(weeklyTasks, "weeklyPlan.tasks");

  resumeVersions.forEach((resume, index) => {
    ["name", "fileName", "fileType", "fileSize", "uploadedAt", "roles", "points", "summary"].forEach((field) =>
      assertRequiredString(resume, field, `resumeVersions[${index}]`),
    );
  });

  opportunities.forEach((opportunity, index) => {
    ["title", "company", "city", "deadline", "nextAction", "jdSummary", "jdText"].forEach((field) =>
      assertRequiredString(opportunity, field, `opportunities[${index}]`),
    );
    assertOptionalString(opportunity, "note", `opportunities[${index}]`);
    assertOneOf(opportunity.status, opportunityStatuses, `opportunities[${index}].status`);
    assertOneOf(opportunity.priority, opportunityPriorities, `opportunities[${index}].priority`);
    assertOneOf(opportunity.match, opportunityMatches, `opportunities[${index}].match`);
    assertOneOf(opportunity.action, opportunityActions, `opportunities[${index}].action`);
    if (opportunity.resumeId && !resumeIds.has(opportunity.resumeId)) fail(`Backup field opportunities[${index}].resumeId references a missing resume`);
    assertOptionalArray(opportunity.sourceAssets, `opportunities[${index}].sourceAssets`).forEach((asset, assetIndex) => {
      assertObject(asset, `opportunities[${index}].sourceAssets[${assetIndex}]`);
      ["id", "kind", "title", "detail", "createdAt"].forEach((field) =>
        assertRequiredString(asset, field, `opportunities[${index}].sourceAssets[${assetIndex}]`),
      );
    });
    assertOptionalArray(opportunity.timeline, `opportunities[${index}].timeline`).forEach((event, eventIndex) => {
      assertObject(event, `opportunities[${index}].timeline[${eventIndex}]`);
      ["id", "occurredAt", "title", "status"].forEach((field) => assertRequiredString(event, field, `opportunities[${index}].timeline[${eventIndex}]`));
    });
  });

  const qaPairIds = new Set();
  interviewSessions.forEach((session, index) => {
    ["company", "role", "round", "date", "reviewPriority"].forEach((field) => assertRequiredString(session, field, `interviewSessions[${index}]`));
    assertOneOf(session.reviewPriority, opportunityActions, `interviewSessions[${index}].reviewPriority`);
    if (session.opportunityId && !opportunityIds.has(session.opportunityId)) fail(`Backup field interviewSessions[${index}].opportunityId references a missing opportunity`);
    assertOptionalArray(session.sourceFiles, `interviewSessions[${index}].sourceFiles`).forEach((file, fileIndex) => {
      assertObject(file, `interviewSessions[${index}].sourceFiles[${fileIndex}]`);
      ["id", "kind", "fileName", "detail", "uploadedAt"].forEach((field) =>
        assertRequiredString(file, field, `interviewSessions[${index}].sourceFiles[${fileIndex}]`),
      );
    });
    assertArray(session.qaPairs, `interviewSessions[${index}].qaPairs`).forEach((pair, pairIndex) => {
      assertObject(pair, `interviewSessions[${index}].qaPairs[${pairIndex}]`);
      ["id", "question", "originalAnswer", "type", "critique", "framework", "optimizedAnswer"].forEach((field) =>
        assertRequiredString(pair, field, `interviewSessions[${index}].qaPairs[${pairIndex}]`),
      );
      if (qaPairIds.has(pair.id)) fail(`Backup field interviewSessions.qaPairs contains duplicate id ${pair.id}`);
      qaPairIds.add(pair.id);
    });
  });

  answerCategories.forEach((category, index) => {
    assertRequiredString(category, "name", `answerCategories[${index}]`);
    if (category.parentId && !categoryIds.has(category.parentId)) fail(`Backup field answerCategories[${index}].parentId references a missing category`);
  });

  answerCards.forEach((answer, index) => {
    ["question", "type", "status", "source", "framework", "answer", "relatedRoles", "practiceStatus"].forEach((field) =>
      assertRequiredString(answer, field, `answerCards[${index}]`),
    );
    if (answer.categoryId && !categoryIds.has(answer.categoryId)) fail(`Backup field answerCards[${index}].categoryId references a missing category`);
    if (answer.sourceQaPairId && !qaPairIds.has(answer.sourceQaPairId)) fail(`Backup field answerCards[${index}].sourceQaPairId references a missing QA pair`);
  });

  ["focusDirections", "focusCities", "focusCompanies", "practiceThemes"].forEach((field) => assertStringArray(weeklyPlan[field], `weeklyPlan.${field}`));

  weeklyTasks.forEach((task, index) => {
    ["title", "detail", "source", "sourceLabel", "status"].forEach((field) => assertRequiredString(task, field, `weeklyPlan.tasks[${index}]`));
    assertOneOf(task.source, weeklyTaskSources, `weeklyPlan.tasks[${index}].source`);
    if (task.source === "opportunity" && task.relatedEntityId && !opportunityIds.has(task.relatedEntityId)) {
      fail(`Backup field weeklyPlan.tasks[${index}].relatedEntityId references a missing opportunity`);
    }
    if (task.source === "interview" && task.relatedEntityId && !interviewIds.has(task.relatedEntityId)) {
      fail(`Backup field weeklyPlan.tasks[${index}].relatedEntityId references a missing interview`);
    }
    if (task.source === "answer" && task.relatedEntityId && !answerIds.has(task.relatedEntityId)) {
      fail(`Backup field weeklyPlan.tasks[${index}].relatedEntityId references a missing answer card`);
    }
  });

  storedFiles.forEach((file, index) => {
    assertObject(file, `storedFiles[${index}]`);
    ["storageUri", "fileName", "fileSize"].forEach((field) => assertRequiredString(file, field, `storedFiles[${index}]`));
    if (!file.storageUri.startsWith("/api/files/")) fail(`Backup field storedFiles[${index}].storageUri must use /api/files/`);
    assertBase64(file.dataBase64, `storedFiles[${index}].dataBase64`);
  });

  return {
    data: {
      resumeVersions,
      opportunities,
      interviewSessions,
      answerCards,
      answerCategories,
      storedFiles,
      weeklyPlan,
      weekStart: payload.weekStart,
    },
    summary: summarizeBackupPayload(payload),
  };
};
