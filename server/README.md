# JobPilot Local API Skeleton

Last updated: 2026-06-09

This is the local backend skeleton for the v0.7 prototype.

## Status

- Read APIs for the current frontend modules
- Write APIs for Opportunity Management, Interview Review, Answer Library, Resume Versions, and Weekly Plan
- Local SQLite database using Node's built-in `node:sqlite`
- Seed data mirrors the frontend mock records
- Frontend hydrates initial state from this API and falls back to local mock data when the API is unavailable
- Local file storage under `server/data/files/`
- Deterministic parse APIs for opportunity, interview, and resume drafts
- Local file text extraction for `.txt`, `.md`, text-based `.pdf`, and `.docx`
- Optional AI-backed text parsing, screenshot OCR, and audio transcription behind the same parse endpoints
- Interview Assist uses two-stage fan-out review in `aiProvider.mjs`: extract Q/A from transcript, then review each pair
- No auth
- OCR/transcription require Assist configuration or server-side provider environment variables

## Commands

```bash
npm run dev:local
npm run api
npm run api:check
npm run api:check:persistence
npm run mvp:check
```

Default API URL:

`http://127.0.0.1:8787`

SQLite file:

`server/data/jobpilot.local.sqlite`

For isolated checks or experiments, override paths:

```bash
JOBPILOT_DB_PATH=/tmp/jobpilot-check.sqlite JOBPILOT_FILE_DIR=/tmp/jobpilot-check-files npm run api
```

## Endpoints

```text
GET /api/health
GET /api/opportunities
POST /api/opportunities
GET /api/opportunities/:id
PATCH /api/opportunities/:id
DELETE /api/opportunities/:id
POST /api/opportunities/:id/progress
GET /api/opportunities/:id/pipeline
GET /api/opportunities/:id/source-assets
GET /api/opportunities/:id/timeline
GET /api/interviews
POST /api/interviews
GET /api/interviews/:id
PATCH /api/interviews/:id
DELETE /api/interviews/:id
POST /api/interviews/:id/qa
POST /api/qa-pairs/:id/create-answer-card
PATCH /api/qa-pairs/:id
DELETE /api/qa-pairs/:id
GET /api/answers
POST /api/answers
PATCH /api/answers/:id
DELETE /api/answers/:id
GET /api/resumes
POST /api/resumes
GET /api/resumes/:id
PATCH /api/resumes/:id
DELETE /api/resumes/:id
GET /api/resumes/:id/linked-opportunities
GET /api/weekly-plan/current
PATCH /api/weekly-plan/current
POST /api/weekly-plan/current/tasks
PATCH /api/weekly-tasks/:id
DELETE /api/weekly-tasks/:id
GET /api/dashboard/summary
GET /api/dashboard/today-actions
GET /api/backup
POST /api/backup
POST /api/files
GET /api/files/:storedFileName
POST /api/parse/opportunity
POST /api/parse/interview
POST /api/parse/resume
```

`GET /api/backup` returns the current full data snapshot, including base64 copies of files stored under `server/data/files/`. `POST /api/backup` restores a JSON backup and replaces current local data and stored files, so use it only after exporting a backup you trust.
Uploaded files are stored under `server/data/files/` and referenced by `storageUri` on resumes, interview source files, and opportunity source assets.
Local `.env` files, `server/data/`, and SQLite files are intentionally git-ignored. Public demo builds should go through `npm run demo:check`.
The parse endpoints return structured Composer draft fields and use deterministic local heuristics by default. When `rawText` is empty and a `storageUri` points to a stored `.txt`, `.md`, text-based `.pdf`, or `.docx` file, the API extracts text before parsing. Images can be OCR'd through a vision-capable AI provider, and audio can be transcribed through an OpenAI/custom transcription endpoint. The API returns `extractionStatus`; the frontend blocks review-step advancement when extraction fails.

Interview Assist behavior:

- `POST /api/parse/interview` with `aiSettings.provider != "none"` runs stage-1 Q/A extraction and stage-2 per-pair review.
- If Assist review fails, response uses `ai-parser-failed`, `ai-parser-invalid-json`, or `ai-review-empty`; it does not silently substitute old deterministic critique/framework text.
- With `aiSettings.provider = "none"`, interview parsing stays local/deterministic.

Provider notes:

- Custom OpenAI-compatible endpoints may be passed as base `/v1`; chat/OCR route to `/chat/completions`, transcription to `/audio/transcriptions`.
- Kimi-compatible models that require `temperature: 1` are handled in `aiProvider.mjs`.
- For long interview transcripts, prefer faster text models such as `moonshot-v1-32k` over slow structured-output models.
`npm run dev:local` starts the local API and Vite frontend together for daily personal use. It uses the default persistent SQLite and file storage unless environment variables override them.
`npm run api:check:persistence` starts the API twice with the same SQLite/file paths and verifies that written records and uploaded files survive an API restart.
`npm run mvp:check` runs the local MVP validation loop: local/demo builds, API smoke check, restart persistence check, a temporary API + Vite app, and both frontend audits against that temporary API.

## Next Steps

1. Test OCR with real provider credentials and real user samples.
2. Improve interview stage-1 extraction reliability for long transcripts.
3. Add re-parse action on existing records.
4. Keep Today Todo derived from formal records.
