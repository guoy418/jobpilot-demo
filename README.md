# JobPilot Local MVP

Last updated: 2026-06-09

JobPilot is a local-first job search workspace for personal use, with a separate static public demo mode for portfolio/interviewer sharing.

## Run For Real Personal Use

Use one command:

```bash
npm install
npm run dev:local
```

Then open:

```text
http://127.0.0.1:5175/
```

`dev:local` starts both the local API and the Vite frontend. Your real data is stored locally:

- SQLite database: `server/data/jobpilot.local.sqlite`
- Uploaded files: `server/data/files/`
- Local env/config files: `.env`, `.env.local`

These local data/config paths are git-ignored and should not be deployed.

## Public Demo

The public demo is mock-only and safe to share. It does not connect to the local API and does not include your SQLite or uploaded files.

```bash
npm run demo:check
```

This builds the static demo and scans `dist` for local API URLs, SQLite names, `server/data`, and sensitive env variable names. GitHub Pages deployment also runs this command.

## Full MVP Check

Before handing off or deploying, run:

```bash
npm run mvp:check
```

This runs:

- local build
- public demo safety check
- API smoke check against a temporary SQLite database
- API restart persistence check
- frontend UI audits against a temporary API + Vite app
- diff whitespace check

## What Is Already Connected

- Frontend can hydrate from the local API.
- Local API persists to SQLite.
- Uploaded files persist under local file storage.
- Opportunities, interviews, QA pairs, answer cards, resume versions, training tasks, Today Todo, backup/restore, file upload, and parse APIs have API coverage.
- Parse APIs use deterministic local parsing by default, can extract text locally from stored `.txt`, `.md`, text-based `.pdf`, and `.docx` files, and can optionally call an AI provider for text parsing, screenshot OCR, and audio transcription when Assist mode and an API key are configured.
- Interview review in Local parse mode works without AI: local transcript splitting + manual confirm/create.
- Interview review in Assist parse mode uses a two-stage AI flow: extract Q/A from transcript, then generate per-question critique/framework/sample answer.
- Composer upload state now shows whether files are reading, stored, ready to parse, or blocked by extraction/OCR/transcription requirements.
- Top bar shows API mode/health (`API ONLINE`, `API OFFLINE`, `PUBLIC DEMO`, `LOCAL MOCK`).
- API restart persistence is verified by `npm run api:check:persistence`.

## Assist vs Local

Settings has two toggles:

- **文字 / JD / 简历解析**: Local = rule-based parsing; Assist = AI parsing and interview text review.
- **录音转写**: only affects audio files without pasted transcript.

If interview Assist fails, the UI shows the real error and does not silently fall back to old rule-based review content.

## Still Out Of Scope

- Old binary `.doc` extraction.
- Cloud-hosted OCR/transcription without user-provided provider configuration.
- Guaranteed high-quality AI parsing before testing with real user samples.
- Reliable long-transcript interview review on every provider/model without tuning or chunking.
- User accounts/auth.
- Cloud database or multi-device sync.
- Public demo API with shared persistence.

Keep the current MVP local-first until the personal-use loop is stable.
