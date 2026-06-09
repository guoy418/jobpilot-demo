# JobPilot Local v0.7 Direction

v0.7 is an independent fusion prototype.

Base:

- Use v0.4 page structure and visual rhythm.
- Keep job board, interview review, answer library, resume versions, training plan, and export/settings surfaces.

Logic:

- Use v0.6's cleaner module-first direction.
- Do not use Material Inbox as the normal creation path.
- Upload/create happens inside each module.
- Required fields block creation only when the formal record cannot exist.
- Optional fields can be edited later.
- Today Todo is always derived from formal records. Do not create or persist a separate todo fact table.
- Training Plan is for weekly goals, focus constraints, and generic practice/misc tasks. Specific jobs belong in Opportunity Management; specific interview questions belong in Interview Review.
- Priority should be explainable: opportunity P-level comes from status, deadline/due date, match, and subjective priority; generic training tasks are user-set P0-P3.
- When changing derived logic, update both frontend selectors and backend selectors, then run build, demo build, and isolated API checks.

Implementation rule:

- Do not continue development in v0.4 or v0.6 directories.
- v0.7 is the working fusion branch.

## Active Development Compass

Before a new development slice, re-read:

1. `V07_DIRECTION.md` for product boundaries and anti-drift rules.
2. `V07_PRD_DATA_TECH.md` for module responsibilities and current status.
3. `V07_BACKEND_CONTRACT.md` before changing data/API shape.
4. `V07_2_ACCEPTANCE_CHECKLIST.md` before deciding whether a slice is MVP-critical.
5. `server/README.md` before changing API commands/endpoints.

Current MVP strategy:

1. Local single-user loop is now mostly reliable: create records, persist data/files, derive today actions, complete actions, export/import backup.
2. Current priority is real-material quality: upload/parse real JD, resume, and interview materials, then tune extraction, prompts, and review UI based on failures.
3. Interview has two valid paths: Local mode for fast create without AI, Assist mode for AI critique/framework/sample answers.
4. AI/OCR/transcription should stay behind the existing parse API boundaries and remain reviewable drafts. Do not let AI create formal records without user confirmation. Do not silently substitute old rule-based interview review when Assist fails.
5. Keep cloud/auth/public demo API out of scope until local personal-use loop and real sample parsing feel solid.
