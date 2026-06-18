export type Page =
  | "home"
  | "opportunities"
  | "opportunityDetail"
  | "interviews"
  | "answers"
  | "resumes"
  | "weekly"
  | "exports";

export type OpportunityStatus = "TO APPLY" | "APPLIED" | "WRITTEN TEST" | "SCREENING" | "INTERVIEWING" | "WAITING" | "OFFER";
export type OpportunityPriority = "A" | "B" | "C";
export type OpportunityMatch = "HIGH" | "MEDIUM" | "LOW";
export type OpportunityAction = "P0" | "P1" | "P2" | "P3";

export type OpportunityDraft = {
  kind: "opportunity";
  company: string;
  title: string;
  city: string;
  deadline: string;
  dueDate?: string;
  priority: OpportunityPriority | "";
  match: OpportunityMatch | "";
  action: OpportunityAction | "";
  resumeId: string;
  nextAction: string;
  jdText: string;
  sourceLabel: string;
};

export type ResumeDraft = {
  kind: "resume";
  name: string;
  fileName: string;
  roles: string;
  points: string;
  summary: string;
};

export type InterviewDraft = {
  kind: "interview";
  company: string;
  role: string;
  round: string;
  date: string;
  fileName: string;
  linkedOpportunityId: string;
  sourceText: string;
};

export type SourceAsset = {
  id: string;
  kind: "jd-text" | "job-link" | "screenshot" | "referral-note";
  title: string;
  detail: string;
  createdAt: string;
  content?: string;
  storageUri?: string;
};

export type TimelineEvent = {
  id: string;
  occurredAt: string;
  title: string;
  detail: string;
  status: "done" | "next";
};

export type PipelineStageState = "done" | "current" | "next" | "skipped";

export type PipelineStage = {
  key: string;
  label: string;
  state: PipelineStageState;
  detail: string;
  source: "system" | "manual";
  subItems?: Array<{ label: string; detail: string; state: PipelineStageState }>;
};

export type Opportunity = {
  id: string;
  title: string;
  company: string;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  match: OpportunityMatch;
  action: OpportunityAction;
  actionManual?: boolean;
  city: string;
  deadline: string;
  dueDate?: string;
  resumeId: string;
  nextAction: string;
  jdSummary: string;
  jdText: string;
  sourceAssets: SourceAsset[];
  timeline: TimelineEvent[];
};

export type SessionFile = {
  id: string;
  kind: "audio" | "transcript";
  fileName: string;
  detail: string;
  uploadedAt: string;
  duration?: string;
  storageUri?: string;
  content?: string;
};

export type QaPair = {
  id: string;
  question: string;
  originalAnswer: string;
  type: string;
  score: number;
  critique: string;
  weak: boolean;
  framework: string;
  optimizedAnswer: string;
};

export type InterviewSession = {
  id: string;
  opportunityId?: string;
  company: string;
  role: string;
  round: string;
  date: string;
  sourceFiles?: SessionFile[];
  qaPairs: QaPair[];
};

export type AnswerCard = {
  id: string;
  question: string;
  type: string;
  status: "DRAFT" | "ACTIVE";
  source: string;
  sourceQaPairId?: string;
  framework: string;
  answer: string;
  relatedRoles: string;
  practiceStatus: "薄弱" | "中等" | "熟练";
};

export type ResumeVersion = {
  id: string;
  name: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  uploadedAt: string;
  roles: string;
  points: string;
  summary: string;
  linkedOpportunityIds: string[];
  storageUri?: string;
};

export type WeeklyTask = {
  id: string;
  title: string;
  detail: string;
  source: "manual" | "weekly-focus" | "opportunity" | "interview" | "answer";
  sourceLabel: string;
  relatedEntityId?: string;
  level?: OpportunityAction;
  status: "open" | "done";
};

export type WeeklyPlan = {
  weekStart?: string;
  targetApplications: number;
  focusDirections: string[];
  focusCities: string[];
  focusCompanies: string[];
  practiceThemes: string[];
  tasks: WeeklyTask[];
};

export type ViewMode = "table" | "board";
export type ModuleComposer = "opportunity" | "interview" | "answer" | "resume";
export type ComposerStep = "source" | "review";
export type ComposerSourceKind = "jd-text" | "screenshot" | "job-link" | "audio" | "transcript" | "resume-file" | "manual";

export type ModuleComposerSource = {
  fileName: string;
  sourceKind: ComposerSourceKind;
  rawText: string;
  note: string;
  storageUri?: string;
  fileSize?: string;
  uploadStatus?: "idle" | "reading" | "uploading" | "stored" | "failed" | "local-only";
  extractionStatus?: string;
};

export type ModuleComposerDraft = {
  company: string;
  title: string;
  city: string;
  deadline: string;
  dueDate: string;
  priority: OpportunityPriority;
  match: OpportunityMatch;
  action: OpportunityAction;
  resumeId: string;
  nextAction: string;
  sourceLabel: string;
  sourceText: string;
  fileName: string;
  linkedOpportunityId: string;
  role: string;
  round: string;
  date: string;
  question: string;
  framework: string;
  answer: string;
  relatedRoles: string;
  roles: string;
  points: string;
  summary: string;
};
