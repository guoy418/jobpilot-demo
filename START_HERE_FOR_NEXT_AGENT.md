# Start Here For Next Agent

Last updated: 2026-06-09

This is the active JobPilot v0.7 local-first MVP. Continue development in this directory only.

## First Commands

```bash
npm install
npm run dev:local
```

Open:

```text
http://127.0.0.1:5175/
```

Before handoff or after meaningful changes:

```bash
npm run mvp:check
```

Important: Node API code does not hot-reload. After changing `server/**`, restart `npm run dev:local` or the user may keep testing old API code.

## Current Product State

The local single-user MVP is mostly connected:

- Frontend hydrates from the local API.
- Local API persists records to SQLite.
- Uploaded files persist under `server/data/files/`.
- JSON backup/restore includes stored files.
- Today Todo is derived from formal records, not stored as an independent todo table.
- Opportunities, interviews, answer cards, resumes, training tasks, Today Todo, source file previews, and backup/restore have API coverage.
- Public demo remains static mock-only and must not include real local data.

## Current Material Parsing State

Supported without external AI:

- Pasted text for JD / interview transcript / resume.
- Uploaded `.txt` and `.md` text files.
- Uploaded text-based `.pdf`.
- Uploaded `.docx`.
- Deterministic interview transcript splitting when the transcript has clear `Q/A`, `问题/回答`, `面试官/我`, or question-mark structure.
- Interview review in **Local** parse mode: user can paste/upload transcript, get local rule-based Q/A split, confirm fields, and create a formal interview record without calling any model.

Supported only with Assist + API key:

- Screenshot/image OCR for JD or resume images through OpenAI-compatible vision or Anthropic vision APIs.
- Audio transcription for interview recordings through OpenAI or custom OpenAI-compatible transcription APIs.
- AI interview review when **文字 / JD / 简历解析 → Assist** is enabled: model extracts real questions and generates per-question critique, answer framework, and polished sample answer.
- Higher-quality semantic AI parsing for messy JD/resume text.

Still limited:

- Old `.doc` files are not parsed; ask user to save as `.docx`.
- Scanned PDFs behave like images and need OCR/Assist.
- Audio transcription is wired but not a current product priority; user can paste transcript text instead.
- Long interview transcripts may still timeout on slow providers (for example Kimi `kimi-k2.6`); prefer `moonshot-v1-32k` or `moonshot-v1-128k` for interview review.
- AI output quality still needs real user sample testing and prompt/schema tuning.

## Assist / Local Mode Rules

Settings has two independent toggles:

- **文字 / JD / 简历解析**: controls JD/resume parsing and **interview text transcript AI review**.
- **录音转写**: controls audio transcription only when there is no pasted transcript.

Important behavior:

- Interview text transcript + parse mode = Local: no AI review call; local rules only; user can still create interview records.
- Interview text transcript + parse mode = Assist: frontend sends provider config to `/api/parse/interview`.
- Interview audio with no pasted text + transcription mode = Assist: API tries transcription first, then parsing/review.
- `transcriptionMode` must **not** trigger AI interview review for pasted text transcripts. This was fixed on 2026-06-08.

## Interview AI Review Architecture

When Assist is enabled and a provider/API key is configured, interview parsing uses a two-stage fan-out flow in `server/aiProvider.mjs`:

1. **Stage 1: Q/A extraction**
   - Input: full transcript (up to 40k chars).
   - Output JSON: `company`, `role`, `round`, `date`, `qaPairs[]` with `question`, `originalAnswer`, `type`.
   - Up to 16 pairs; timeout 90s.
2. **Stage 2: per-pair review**
   - One model call per extracted pair.
   - Output JSON per pair: `score`, `critique`, `weak`, `framework`, `optimizedAnswer`.
   - Runs with concurrency limit 2; timeout 90s per pair.

Fallback and failure rules:

- If stage 1 AI extraction fails, backend may fall back to local `parseTranscriptQaPairs()` to get candidate questions, then still try stage 2 AI review.
- If AI review ultimately produces no valid pairs, API returns `extractionStatus` such as `ai-review-empty` or `ai-parser-failed`.
- Frontend **does not** silently write old rule-based critique/framework when Assist review fails. User sees the error and stays on the source step.

Prompt style (2026-06-08):

- Prompts are short and positive: role + JSON schema + quality requirements.
- Avoid long negative lists like “不要写问题簇/考察点”.
- Backend still sanitizes output if the model emits legacy label words such as `问题簇` or `考察点`.

## Recent Important Fixes

- File upload composer now shows visible upload/read/parse status in the modal.
- Parse API returns `extractionStatus`; frontend blocks invalid file extraction from advancing to review.
- Fake fallback interview questions were removed. If transcript is unavailable, the UI says it is waiting for transcript/transcription.
- Interview parse API returns structured `qaPairs`; frontend uses API QA pairs when Assist succeeds.
- Answer cards with `NEEDS PRACTICE` now derive Today Todo directly, unless an open answer-linked training task already exists.
- Interview source files can persist and preview transcript content in-app.
- `.docx` extraction is supported via `mammoth`; PDF extraction via `pdf-parse`.
- App top bar now shows explicit API mode/health (`API ONLINE`, `API OFFLINE`, `PUBLIC DEMO`, `LOCAL MOCK`) and can re-check `/api/health`.
- OpenAI/custom endpoint handling now accepts a base `/v1` URL and routes chat/OCR to `/chat/completions` and transcription to `/audio/transcriptions`.
- OCR/transcription failures now return visible `extractionStatus` values instead of silently looking like a generic parse failure.
- Interview AI prompts were simplified on 2026-06-08 to reduce token overhead and model confusion.
- Local vs Assist routing for interview text transcripts was fixed on 2026-06-08 so Local mode no longer gets blocked by AI failures.
- Kimi-compatible models use `temperature: 1` when required by the provider.
- `npm run mvp:check` and `npm run api:check` passed after the 2026-06-08 interview AI changes.

## What To Work On Next

Priority 1: Real user material QA.

- Test with the user's actual JD PDF/DOCX, interview transcript DOCX, resume PDF/DOCX, and at least one screenshot.
- For interview review, test both Local mode (create record quickly) and Assist mode (AI critique/framework/sample answer).
- If Assist misses questions or times out, tune `server/aiProvider.mjs` stage-1 extraction first; only then tune per-pair review prompts.
- Keep parse results as reviewable drafts; never create formal records directly from AI without user confirmation.

Priority 2: Assist reliability.

- Configure provider/API key in Settings.
- For Moonshot/Kimi interview review, prefer `moonshot-v1-32k` or `moonshot-v1-128k` over slow structured-output models.
- Test screenshot OCR with a real vision-capable model.
- Audio transcription can stay deferred; pasted transcript + Assist review is the current recommended path.
- If AI fails, surface the exact `extractionStatus` / `aiError`; do not silently fall back to fake local review content.

Priority 3: Product polish for real use.

- Add a "re-parse source" action on existing opportunity/interview/resume records.
- Add clearer per-file source status and retry.
- Consider chunked transcript extraction if full-transcript stage 1 still times out on long interviews.

## Non-Negotiable Product Rules

- Do not reintroduce Material Inbox as the main creation path.
- Upload/create happens inside each target module.
- Today Todo remains derived from formal records.
- Specific jobs belong in Opportunity Management.
- Specific interview questions belong in Interview Review / Answer Library.
- Training Plan is for weekly goals, generic practice, and manual tasks.
- Keep public demo mock-only and real data local-only.

## Key Files

- `src/App.tsx`: main UI state/actions/composer flow.
- `src/types.ts`: entity and composer types.
- `src/composerModel.ts`: composer defaults, local source inference, transcript QA splitting.
- `src/selectors.ts`: frontend derived dashboard/today actions.
- `server/index.mjs`: local API routes.
- `server/db.mjs`: SQLite schema/repository and backend derived selectors.
- `server/fileTextExtractor.mjs`: txt/md/PDF/DOCX/OCR/transcription extraction.
- `server/parser.mjs`: deterministic parse scaffolds.
- `server/aiProvider.mjs`: optional provider calls for text parsing, OCR, transcription.
- `tools/mvp_check.cjs`: full validation loop.
