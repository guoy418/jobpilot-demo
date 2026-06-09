import { apiBaseUrl, isApiEnabled } from "./appConfig";
import type { DashboardSummary, TodayAction } from "./selectors";
import type { AnswerCard, ComposerSourceKind, InterviewSession, Opportunity, QaPair, ResumeVersion, WeeklyPlan, WeeklyTask } from "./types";

const assertApiEnabled = () => {
  if (!isApiEnabled) {
    throw new Error("API is disabled");
  }
};

export type InitialApiData = {
  opportunities: Opportunity[];
  interviewSessions: InterviewSession[];
  answerCards: AnswerCard[];
  resumeVersions: ResumeVersion[];
  weeklyPlan: WeeklyPlan;
  dashboardSummary: DashboardSummary;
  todayActions: TodayAction[];
};

export type JobPilotBackup = Omit<InitialApiData, "dashboardSummary" | "todayActions"> & {
  schemaVersion: string;
  exportedAt: string;
  source: string;
  storedFiles?: Array<{
    storageUri: string;
    fileName: string;
    fileSize: string;
    dataBase64: string;
  }>;
};

export type StoredFile = {
  storageUri: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
};

export type ApiHealth = {
  ok: boolean;
  dbPath?: string;
};

export type ParserPayload = {
  rawText: string;
  fileName: string;
  sourceKind: ComposerSourceKind;
  note: string;
  storageUri?: string;
  fileSize?: string;
  [key: string]: unknown;
};

export type OpportunityProgressPayload = {
  status: Opportunity["status"];
  action?: Opportunity["action"];
  nextAction?: string;
  timelineEvent?: {
    id: string;
    occurredAt: string;
    title: string;
    detail: string;
    status: "done";
  };
};

const getJson = async <T,>(path: string): Promise<T> => {
  assertApiEnabled();
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const sendJson = async <T,>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> => {
  assertApiEnabled();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${method} ${path} returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  return response.json() as Promise<T>;
};

export const createAnswerCardApi = (answer: AnswerCard): Promise<AnswerCard> => sendJson<AnswerCard>("/api/answers", "POST", answer);

export const createAnswerCardFromQaPairApi = (qaPairId: string): Promise<AnswerCard> =>
  sendJson<AnswerCard>(`/api/qa-pairs/${encodeURIComponent(qaPairId)}/create-answer-card`, "POST");

export const updateAnswerCardApi = (id: string, patch: Partial<AnswerCard>): Promise<AnswerCard> =>
  sendJson<AnswerCard>(`/api/answers/${encodeURIComponent(id)}`, "PATCH", patch);

export const deleteAnswerCardApi = (id: string): Promise<{ ok: boolean; id: string }> =>
  sendJson<{ ok: boolean; id: string }>(`/api/answers/${encodeURIComponent(id)}`, "DELETE");

export const updateWeeklyPlanApi = (patch: Partial<Omit<WeeklyPlan, "tasks">>): Promise<WeeklyPlan> =>
  sendJson<WeeklyPlan>("/api/weekly-plan/current", "PATCH", patch);

export const getWeeklyPlanApi = (): Promise<WeeklyPlan> => getJson<WeeklyPlan>("/api/weekly-plan/current");

export const createWeeklyTaskApi = (task: WeeklyTask): Promise<WeeklyTask> =>
  sendJson<WeeklyTask>("/api/weekly-plan/current/tasks", "POST", task);

export const updateWeeklyTaskApi = (id: string, patch: Partial<WeeklyTask>): Promise<WeeklyTask> =>
  sendJson<WeeklyTask>(`/api/weekly-tasks/${encodeURIComponent(id)}`, "PATCH", patch);

export const deleteWeeklyTaskApi = (id: string): Promise<{ ok: boolean; id: string }> =>
  sendJson<{ ok: boolean; id: string }>(`/api/weekly-tasks/${encodeURIComponent(id)}`, "DELETE");

export const createResumeVersionApi = (resume: ResumeVersion): Promise<ResumeVersion> =>
  sendJson<ResumeVersion>("/api/resumes", "POST", resume);

export const updateResumeVersionApi = (id: string, patch: Partial<ResumeVersion>): Promise<ResumeVersion> =>
  sendJson<ResumeVersion>(`/api/resumes/${encodeURIComponent(id)}`, "PATCH", patch);

export const deleteResumeVersionApi = (id: string): Promise<{ ok: boolean; id: string }> =>
  sendJson<{ ok: boolean; id: string }>(`/api/resumes/${encodeURIComponent(id)}`, "DELETE");

export const createInterviewSessionApi = (session: InterviewSession): Promise<InterviewSession> =>
  sendJson<InterviewSession>("/api/interviews", "POST", session);

export const updateInterviewSessionApi = (id: string, patch: Partial<InterviewSession>): Promise<InterviewSession> =>
  sendJson<InterviewSession>(`/api/interviews/${encodeURIComponent(id)}`, "PATCH", patch);

export const deleteInterviewSessionApi = (id: string): Promise<{ ok: boolean; id: string }> =>
  sendJson<{ ok: boolean; id: string }>(`/api/interviews/${encodeURIComponent(id)}`, "DELETE");

export const createQaPairApi = (interviewId: string, qaPair: QaPair): Promise<QaPair> =>
  sendJson<QaPair>(`/api/interviews/${encodeURIComponent(interviewId)}/qa`, "POST", qaPair);

export const updateQaPairApi = (id: string, patch: Partial<QaPair>): Promise<QaPair> =>
  sendJson<QaPair>(`/api/qa-pairs/${encodeURIComponent(id)}`, "PATCH", patch);

export const deleteQaPairApi = (id: string): Promise<{ ok: boolean; id: string }> =>
  sendJson<{ ok: boolean; id: string }>(`/api/qa-pairs/${encodeURIComponent(id)}`, "DELETE");

export const createOpportunityApi = (opportunity: Opportunity): Promise<Opportunity> =>
  sendJson<Opportunity>("/api/opportunities", "POST", opportunity);

export const updateOpportunityApi = (id: string, patch: Partial<Opportunity>): Promise<Opportunity> =>
  sendJson<Opportunity>(`/api/opportunities/${encodeURIComponent(id)}`, "PATCH", patch);

export const progressOpportunityApi = (id: string, payload: OpportunityProgressPayload): Promise<Opportunity> =>
  sendJson<Opportunity>(`/api/opportunities/${encodeURIComponent(id)}/progress`, "POST", payload);

export const deleteOpportunityApi = (id: string): Promise<{ ok: boolean; id: string }> =>
  sendJson<{ ok: boolean; id: string }>(`/api/opportunities/${encodeURIComponent(id)}`, "DELETE");

export const getDashboardSummaryApi = (): Promise<DashboardSummary> => getJson<DashboardSummary>("/api/dashboard/summary");

export const getTodayActionsApi = (): Promise<TodayAction[]> => getJson<TodayAction[]>("/api/dashboard/today-actions");

export const getApiHealthApi = (): Promise<ApiHealth> => getJson<ApiHealth>("/api/health");

export const exportBackupApi = (): Promise<JobPilotBackup> => getJson<JobPilotBackup>("/api/backup");

export const importBackupApi = (backup: JobPilotBackup): Promise<JobPilotBackup> => sendJson<JobPilotBackup>("/api/backup", "POST", backup);

export const uploadFileApi = (file: File): Promise<StoredFile> =>
  new Promise((resolve, reject) => {
    assertApiEnabled();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      const dataBase64 = dataUrl.split(",")[1] ?? "";
      try {
        const uploaded = await sendJson<StoredFile>("/api/files", "POST", {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64,
        });
        resolve(uploaded);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(file);
  });

export const parseOpportunityApi = (payload: ParserPayload): Promise<Record<string, string>> =>
  sendJson<Record<string, string>>("/api/parse/opportunity", "POST", payload);

export const parseInterviewApi = (payload: ParserPayload): Promise<Record<string, string>> =>
  sendJson<Record<string, string>>("/api/parse/interview", "POST", payload);

export const parseResumeApi = (payload: ParserPayload): Promise<Record<string, string>> =>
  sendJson<Record<string, string>>("/api/parse/resume", "POST", payload);

export const loadInitialApiData = async (): Promise<InitialApiData> => {
  assertApiEnabled();
  const [opportunities, interviewSessions, answerCards, resumeVersions, weeklyPlan, dashboardSummary, todayActions] = await Promise.all([
    getJson<Opportunity[]>("/api/opportunities"),
    getJson<InterviewSession[]>("/api/interviews"),
    getJson<AnswerCard[]>("/api/answers"),
    getJson<ResumeVersion[]>("/api/resumes"),
    getJson<WeeklyPlan>("/api/weekly-plan/current"),
    getDashboardSummaryApi(),
    getTodayActionsApi(),
  ]);

  if (
    !Array.isArray(opportunities) ||
    !Array.isArray(interviewSessions) ||
    !Array.isArray(answerCards) ||
    !Array.isArray(resumeVersions) ||
    !weeklyPlan ||
    !Array.isArray(weeklyPlan.tasks)
  ) {
    throw new Error("API returned incomplete initial data");
  }

  return {
    opportunities,
    interviewSessions,
    answerCards,
    resumeVersions,
    weeklyPlan,
    dashboardSummary,
    todayActions,
  };
};
