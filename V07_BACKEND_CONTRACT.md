# JobPilot v0.7 Backend Contract Draft

Date: 2026-06-09 (updated from 2026-06-02 draft)

This document is the backend handoff contract for the current v0.7 frontend prototype. It is derived from:

- `src/types.ts`
- `src/domain.ts`
- `src/composerModel.ts`
- current module creation behavior in `src/App.tsx`

## Product Invariants

1. Do not reintroduce the global Material Inbox as the main creation path.
2. Creation happens inside a target module: Opportunities, Interviews, Answers, Resumes.
3. A module create flow has two conceptual steps:
   - source input: file/link/text/audio/manual
   - review: structured fields the user can confirm or edit
4. Formal module records are the source of truth.
5. Today Todo is derived from formal records. Do not persist `TodayAction` as an independent fact table.
6. Resume usage belongs on the opportunity record through `resumeId`. Resume page should not maintain a separate per-job usage truth.
7. AI parsing and audio transcription must return strict schemas before writing records.

## Core Enums

```ts
type OpportunityStatus =
  | "TO APPLY"
  | "APPLIED"
  | "WRITTEN TEST"
  | "INTERVIEWING"
  | "WAITING"
  | "OFFER";

type OpportunityPriority = "A" | "B" | "C";
type OpportunityMatch = "HIGH" | "MEDIUM" | "LOW";
type OpportunityAction = "P0" | "P1" | "P2" | "P3";

type WeeklyTaskSource =
  | "manual"
  | "weekly-focus"
  | "opportunity"
  | "interview"
  | "answer";
```

## SQLite Tables

### `opportunities`

Formal job records.

```sql
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  match TEXT NOT NULL,
  action TEXT NOT NULL,
  city TEXT NOT NULL,
  deadline TEXT NOT NULL,
  due_date TEXT,
  resume_id TEXT,
  next_action TEXT NOT NULL,
  jd_summary TEXT NOT NULL,
  jd_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resume_id) REFERENCES resume_versions(id)
);
```

Rules:

- Default status for a new opportunity is `TO APPLY`.
- Creating a linked interview should advance the opportunity to `INTERVIEWING`.
- Marking applied should set:
  - `status = "APPLIED"`
  - `action` from the shared priority computation
  - `next_action = "三天后跟进投递结果"`
  - append a timeline event

### `opportunity_source_assets`

Original material attached to an opportunity.

```sql
CREATE TABLE opportunity_source_assets (
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
```

Allowed `kind` values:

- `jd-text`
- `job-link`
- `screenshot`
- `referral-note`

### `opportunity_timeline_events`

System and manual progress records.

```sql
CREATE TABLE opportunity_timeline_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
```

Allowed `status` values:

- `done`
- `next`

### `interview_sessions`

One interview review session.

```sql
CREATE TABLE interview_sessions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  round TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
);
```

### `interview_source_files`

Audio files and transcripts attached to an interview session.

```sql
CREATE TABLE interview_source_files (
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
```

Allowed `kind` values:

- `audio`
- `transcript`

Rules:

- `content` stores extracted or pasted transcript text when available so the app can preview it without re-reading the file.
- `storage_uri` points to the original uploaded file when it was saved through `/api/files`.
- Audio source files may have no `content`; generated transcript source files should include `content` when transcription or pasted transcript text is available.

### `qa_pairs`

Interview questions and review output.

```sql
CREATE TABLE qa_pairs (
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
```

Rules:

- Deleting a QA pair requires confirmation in UI.
- Backend should reject deleting the last QA pair in a session unless the product explicitly allows empty sessions later.

### `answer_cards`

Reusable answers created manually or from interview QA.

```sql
CREATE TABLE answer_cards (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  source_qa_pair_id TEXT,
  framework TEXT NOT NULL,
  answer TEXT NOT NULL,
  related_roles TEXT NOT NULL,
  practice_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_qa_pair_id) REFERENCES qa_pairs(id)
);
```

Allowed `status` values:

- `DRAFT`
- `ACTIVE`
- `NEEDS PRACTICE`

### `resume_versions`

Uploaded resume versions.

```sql
CREATE TABLE resume_versions (
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
```

Rules:

- Do not store duplicated job usage inside the resume table.
- Derive linked opportunities with `SELECT * FROM opportunities WHERE resume_id = ?`.

### `weekly_plans`

Only one active local plan is needed for the current prototype, but the schema supports multiple weeks.

```sql
CREATE TABLE weekly_plans (
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
```

### `weekly_tasks`

Manual or generated weekly actions.

```sql
CREATE TABLE weekly_tasks (
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
```

Allowed `status` values:

- `open`
- `done`

## Derived Selectors

These should be backend service selectors or frontend selectors, not stored tables.

### Today Todo

Derived from:

- opportunities where `status != "OFFER"`
- interview sessions with at least one weak QA pair
- weekly tasks where `status = "open"`

Output shape:

```ts
type TodayActionDto = {
  level: "P0" | "P1" | "P2" | "P3";
  title: string;
  detail: string;
  page: "opportunityDetail" | "interviews" | "weekly" | "answers";
  targetPage: "opportunityDetail" | "interviews" | "weekly" | "answers";
  source: "opportunity" | "interview" | "weekly";
  targetId?: string;
  taskId?: string;
};
```

Do not create `today_actions` as a persistent table.

### Opportunity Pipeline

Derived from:

- `opportunities.status`
- `opportunity_timeline_events`
- linked `interview_sessions`

Output should match the current `PipelineStage` type.

## API Contract

All endpoints are local-first and can be implemented under `/api`.

### Opportunities

```http
GET    /api/opportunities
POST   /api/opportunities
GET    /api/opportunities/:id
PATCH  /api/opportunities/:id
DELETE /api/opportunities/:id
POST   /api/opportunities/:id/progress
GET    /api/opportunities/:id/pipeline
GET    /api/opportunities/:id/source-assets
GET    /api/opportunities/:id/timeline
```

`POST /api/opportunities` body:

```json
{
  "company": "字节跳动",
  "title": "前端开发实习生",
  "city": "上海",
  "deadline": "Tomorrow",
  "priority": "A",
  "match": "HIGH",
  "action": "P0",
  "resumeId": "RV-101",
  "nextAction": "补充低代码项目指标后投递",
  "jdText": "岗位职责...",
  "jdSummary": "前端开发实习生，偏低代码平台和业务组件。",
  "source": {
    "kind": "jd-text",
    "title": "岗位 JD 文本",
    "detail": "从岗位管理内新增后生成正式记录",
    "content": "岗位职责..."
  }
}
```

### Interviews

```http
GET    /api/interviews
POST   /api/interviews
GET    /api/interviews/:id
PATCH  /api/interviews/:id
DELETE /api/interviews/:id
POST   /api/interviews/:id/qa
PATCH  /api/qa-pairs/:id
DELETE /api/qa-pairs/:id
POST   /api/qa-pairs/:id/create-answer-card
```

`POST /api/interviews` body:

```json
{
  "opportunityId": "OP-021",
  "company": "腾讯",
  "role": "前端开发实习生",
  "round": "一面",
  "date": "May 24",
  "sourceFiles": [
    {
      "kind": "audio",
      "fileName": "tencent-round1-recording.m4a",
      "detail": "原录音",
      "duration": "42:18"
    }
  ],
  "qaPairs": [
    {
      "question": "你在低代码项目里如何衡量性能优化结果？",
      "originalAnswer": "我主要做了首屏优化...",
      "type": "PROJECT",
      "score": 2,
      "critique": "缺少基线、指标和复盘口径。",
      "weak": true,
      "framework": "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
      "optimizedAnswer": "项目开始时首屏约 3.2s..."
    }
  ]
}
```

### Answer Cards

```http
GET    /api/answers
POST   /api/answers
GET    /api/answers/:id
PATCH  /api/answers/:id
DELETE /api/answers/:id
```

### Resume Versions

```http
GET    /api/resumes
POST   /api/resumes
GET    /api/resumes/:id
PATCH  /api/resumes/:id
DELETE /api/resumes/:id
GET    /api/resumes/:id/linked-opportunities
```

### Weekly Plan

```http
GET    /api/weekly-plan/current
PATCH  /api/weekly-plan/current
POST   /api/weekly-plan/current/tasks
PATCH  /api/weekly-tasks/:id
DELETE /api/weekly-tasks/:id
```

### Derived Dashboard

```http
GET /api/dashboard/today-actions
GET /api/dashboard/summary
```

`GET /api/dashboard/summary` returns:

```json
{
  "opportunityCount": 4,
  "toApplyCount": 1,
  "inProgressCount": 3,
  "urgentCount": 3,
  "p0Count": 1,
  "p1Count": 2,
  "weakQaCount": 3,
  "weakInterviewCount": 2,
  "submittedApplications": 3,
  "targetApplications": 12,
  "applicationGap": 9
}
```

## AI Parse Contracts

AI output should be validated before creating records. Do not write raw AI output directly into formal tables.

All parse endpoints may return:

```json
{
  "extractionStatus": "local-text",
  "extractionError": "",
  "aiStatus": "used",
  "aiError": ""
}
```

Common `extractionStatus` values:

- Local success: `local-text`, `local-pdf-text`, `local-docx-text`
- Assist success: `ai-review`, `ai-ocr`, `ai-transcription`
- Assist/config failure: `ai-not-configured`, `ocr-unavailable`, `transcription-unavailable`, `ocr-provider-failed`, `transcription-provider-failed`, `transcription-provider-unsupported`
- Interview Assist failure: `ai-parser-failed`, `ai-parser-invalid-json`, `ai-review-empty`
- File failure: `stored-file-missing`, `empty-pdf-text`, `empty-docx-text`, `unsupported-file-type`, `file-extraction-failed`

Frontend rule: when `extractionStatus` is in the failure set, do not advance composer to review.

### Parse Opportunity Source

```json
{
  "company": "字节跳动",
  "title": "前端开发实习生",
  "city": "上海",
  "deadline": "Tomorrow",
  "priority": "A",
  "match": "HIGH",
  "action": "P0",
  "nextAction": "补充低代码项目指标后投递",
  "jdSummary": "前端开发实习生，偏低代码平台和业务组件。",
  "jdText": "完整 JD 原文",
  "sourceLabel": "官网 JD"
}
```

Required before create:

- `company`
- `title`
- `jdText`

### Parse Interview Source

```json
{
  "company": "腾讯",
  "role": "前端开发实习生",
  "round": "一面",
  "date": "May 24",
  "transcript": "完整转写稿",
  "qaPairs": [
    {
      "question": "你在低代码项目里如何衡量性能优化结果？",
      "originalAnswer": "我主要做了首屏优化...",
      "type": "PROJECT",
      "score": 2,
      "critique": "缺少基线、指标和复盘口径。",
      "weak": true,
      "framework": "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
      "optimizedAnswer": "项目开始时首屏约 3.2s..."
    }
  ]
}
```

Required before create:

- `company`
- `role`
- `round`
- at least one `qaPair`

Interview Assist implementation notes:

1. Stage 1 extracts `qaPairs[]` with `question`, `originalAnswer`, `type` from the full transcript.
2. Stage 2 generates `score`, `critique`, `weak`, `framework`, `optimizedAnswer` per pair.
3. If stage 1 AI fails, backend may use local transcript splitting to get candidate pairs, then still attempt stage 2.
4. If Assist review ultimately fails, return `ai-review-empty` or `ai-parser-failed`; do not silently substitute old deterministic critique/framework text.
5. Output sanitization removes legacy label prefixes such as `问题簇` or `考察点` if the model emits them.

Request body may include:

```json
{
  "rawText": "完整转写稿",
  "fileName": "interview-transcript.docx",
  "sourceKind": "transcript",
  "storageUri": "stored-file-name.docx",
  "aiSettings": {
    "provider": "custom",
    "endpoint": "https://api.moonshot.cn/v1",
    "apiKey": "...",
    "model": "moonshot-v1-32k"
  }
}
```

When `aiSettings.provider = "none"`, backend uses deterministic parsing only.

### Parse Resume Source

```json
{
  "name": "FE Intern v7",
  "fileName": "fe-intern-v7.pdf",
  "roles": "前端 / 全栈 / 低代码",
  "points": "组件库、性能优化、低代码平台",
  "summary": "强调 React、TypeScript、工程化和业务组件沉淀。"
}
```

Required before create:

- `name`
- `fileName`

### Generate Answer Card From QA

```json
{
  "question": "你在低代码项目里如何衡量性能优化结果？",
  "type": "PROJECT",
  "status": "NEEDS PRACTICE",
  "source": "面试复盘",
  "framework": "基线 -> 目标 -> 动作 -> 指标结果 -> 复盘限制",
  "answer": "项目开始时首屏约 3.2s...",
  "relatedRoles": "前端 / 全栈 / 技术产品",
  "practiceStatus": "练习中"
}
```

## Backend Status And Next Sequence

Already implemented for the local MVP:

1. Mock data extracted from `App.tsx`.
2. Today Todo and summary metrics extracted into selectors and mirrored in backend selectors.
3. SQLite schema and migration bootstrap.
4. Read/write/delete APIs for active modules.
5. Frontend API hydration with local mock fallback.
6. Local file storage and backup/restore including stored file contents.
7. Parse endpoints with deterministic parsing, local txt/md/PDF/DOCX extraction, optional AI parsing, optional image OCR, optional audio transcription, and `extractionStatus` reporting.
8. Interview Assist two-stage fan-out review in `server/aiProvider.mjs`.
9. Frontend Assist/Local routing so interview text review only follows parse mode, not transcription mode.

Next recommended backend work:

1. Keep frontend/backend derived selectors aligned whenever Today Todo, priority, or dashboard metrics change.
2. Test OCR with real provider credentials and real user samples.
3. Improve interview stage-1 extraction reliability for long transcripts (chunking or faster model defaults).
4. Add a "re-parse source" action on existing records.
5. Add date-versioned training plans only after the single-current-plan loop is stable.
6. Defer auth/cloud sync until the local single-user workflow is reliable.

## Open Decisions

1. Backend runtime packaging: keep lightweight local API process vs Electron/Tauri sidecar.
2. File storage root: current local data directory vs user-selected workspace folder.
3. Whether deletions remain hard delete or move to soft delete/history.
4. Whether training plans remain single-current-plan or become date-versioned.
5. Whether IDs should remain prefixed strings (`OP-*`, `INT-*`) or move to UUIDs while preserving display IDs.
