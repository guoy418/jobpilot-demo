import type { JobPilotBackup } from "../apiClient";

export const BACKUP_SCHEMA_VERSION = "jobpilot-v0.7.2";
export const LEGACY_BACKUP_SCHEMA_VERSIONS = ["jobpilot-v0.7.1", "jobpilot-v0.7.0", "jobpilot-v0.7", "jobpilot-v0.6.0", "jobpilot-v0.6"] as const;

export type BackupRestoreSummary = {
  opportunities: number;
  resumes: number;
  interviews: number;
  answerCards: number;
  weeklyTasks: number;
};

export type BackupRestorePreview =
  | {
      ok: true;
      backup: JobPilotBackup;
      summary: BackupRestoreSummary;
    }
  | {
      ok: false;
      error: string;
    };

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const legacyBackupSchemaVersions = new Set<string>(LEGACY_BACKUP_SCHEMA_VERSIONS);
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

const requireArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} 不是列表`);
  return value;
};

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!isPlainObject(value)) throw new Error(`${label} 不是对象`);
  return value;
};

const requireStringId = (value: Record<string, unknown>, label: string): string => {
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error(`${label}.id 缺失`);
  return value.id;
};

const requireUniqueIds = (items: unknown[], label: string): Set<string> => {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const id = requireStringId(requireObject(item, `${label}[${index}]`), `${label}[${index}]`);
    if (ids.has(id)) throw new Error(`${label} 存在重复 id：${id}`);
    ids.add(id);
  });
  return ids;
};

const optionalArrayOrEmpty = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const normalizeLegacyWeeklyPlan = (payload: Record<string, unknown>): Record<string, unknown> => {
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

const normalizeLegacyAnswerCategories = (payload: Record<string, unknown>): unknown[] =>
  Array.isArray(payload.answerCategories) ? payload.answerCategories : defaultAnswerCategories.map((category) => ({ ...category }));

const normalizeLegacyAnswerCards = (payload: Record<string, unknown>): unknown => {
  const answerCards = Array.isArray(payload.answerCards) ? payload.answerCards : payload.answers;
  if (!Array.isArray(answerCards)) return answerCards;
  const hasCategories = Array.isArray(payload.answerCategories);
  return answerCards.map((answer) => {
    if (!isPlainObject(answer) || hasCategories || isNonEmptyString(answer.categoryId)) return answer;
    return { ...answer, categoryId: uncategorizedAnswerCategoryId };
  });
};

export const migrateBackupPayload = (value: unknown): JobPilotBackup => {
  const payload = requireObject(value, "备份文件");
  if (payload.schemaVersion === BACKUP_SCHEMA_VERSION) return payload as JobPilotBackup;
  if (!legacyBackupSchemaVersions.has(String(payload.schemaVersion))) {
    throw new Error(`备份版本不支持（需要 ${BACKUP_SCHEMA_VERSION}）`);
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
  } as JobPilotBackup;
};

export const getBackupRestorePreview = (value: unknown): BackupRestorePreview => {
  try {
    const backup = migrateBackupPayload(value);

    const weeklyPlan = backup.weeklyPlan;
    if (!isPlainObject(weeklyPlan)) throw new Error("weeklyPlan 缺失或格式不正确");
    const opportunities = requireArray(backup.opportunities, "opportunities");
    const resumeVersions = requireArray(backup.resumeVersions, "resumeVersions");
    const interviewSessions = requireArray(backup.interviewSessions, "interviewSessions");
    const answerCards = requireArray(backup.answerCards, "answerCards");
    const answerCategories = requireArray(backup.answerCategories, "answerCategories");
    const weeklyTasks = requireArray(weeklyPlan.tasks, "weeklyPlan.tasks");
    const opportunityIds = requireUniqueIds(opportunities, "opportunities");
    const resumeIds = requireUniqueIds(resumeVersions, "resumeVersions");
    const interviewIds = requireUniqueIds(interviewSessions, "interviewSessions");
    const answerIds = requireUniqueIds(answerCards, "answerCards");
    const categoryIds = requireUniqueIds(answerCategories, "answerCategories");

    opportunities.forEach((item, index) => {
      const opportunity = requireObject(item, `opportunities[${index}]`);
      if (opportunity.resumeId && typeof opportunity.resumeId === "string" && !resumeIds.has(opportunity.resumeId)) throw new Error(`opportunities[${index}].resumeId 引用不存在`);
    });

    const qaPairIds = new Set<string>();
    interviewSessions.forEach((item, index) => {
      const session = requireObject(item, `interviewSessions[${index}]`);
      if (session.opportunityId && typeof session.opportunityId === "string" && !opportunityIds.has(session.opportunityId)) throw new Error(`interviewSessions[${index}].opportunityId 引用不存在`);
      requireArray(session.qaPairs, `interviewSessions[${index}].qaPairs`).forEach((pair, pairIndex) => {
        const id = requireStringId(requireObject(pair, `interviewSessions[${index}].qaPairs[${pairIndex}]`), `interviewSessions[${index}].qaPairs[${pairIndex}]`);
        if (qaPairIds.has(id)) throw new Error(`qaPairs 存在重复 id：${id}`);
        qaPairIds.add(id);
      });
    });

    answerCards.forEach((item, index) => {
      const answer = requireObject(item, `answerCards[${index}]`);
      if (answer.categoryId && typeof answer.categoryId === "string" && !categoryIds.has(answer.categoryId)) throw new Error(`answerCards[${index}].categoryId 引用不存在`);
      if (answer.sourceQaPairId && typeof answer.sourceQaPairId === "string" && !qaPairIds.has(answer.sourceQaPairId)) throw new Error(`answerCards[${index}].sourceQaPairId 引用不存在`);
    });

    weeklyTasks.forEach((item, index) => {
      const task = requireObject(item, `weeklyPlan.tasks[${index}]`);
      if (task.source === "opportunity" && typeof task.relatedEntityId === "string" && !opportunityIds.has(task.relatedEntityId)) throw new Error(`weeklyPlan.tasks[${index}].relatedEntityId 引用不存在`);
      if (task.source === "interview" && typeof task.relatedEntityId === "string" && !interviewIds.has(task.relatedEntityId)) throw new Error(`weeklyPlan.tasks[${index}].relatedEntityId 引用不存在`);
      if (task.source === "answer" && typeof task.relatedEntityId === "string" && !answerIds.has(task.relatedEntityId)) throw new Error(`weeklyPlan.tasks[${index}].relatedEntityId 引用不存在`);
    });

    requireArray(weeklyPlan.focusDirections, "weeklyPlan.focusDirections");
    requireArray(weeklyPlan.focusCities, "weeklyPlan.focusCities");
    requireArray(weeklyPlan.focusCompanies, "weeklyPlan.focusCompanies");
    requireArray(weeklyPlan.practiceThemes, "weeklyPlan.practiceThemes");

    return {
      ok: true,
      backup,
      summary: {
        opportunities: opportunities.length,
        resumes: resumeVersions.length,
        interviews: interviewSessions.length,
        answerCards: answerCards.length,
        weeklyTasks: weeklyTasks.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "备份文件格式不正确",
    };
  }
};
