# JobPilot v0.7.2 Acceptance Checklist

Goal:

- Validate the v0.7 product loop after removing the old Inbox route.
- Keep page structure stable.
- Keep the local single-user MVP loop stable: module creation, local persistence, derived Today Todo, completion, backup/restore, and static demo safety.
- Fix logic breaks without broad visual redesign.

Must Pass:

1. Navigation
   - Main nav does not expose Material Inbox.
   - Every nav item opens the expected module.

2. Opportunity
   - Add/upload JD opens source step first.
   - Parse/review step requires company, title, JD/source text.
   - Creating a record writes directly to Opportunity.
   - Created opportunity has source assets, JD summary/text, status, resume version, timeline, and next action.
   - Mark applied updates status, pipeline, timeline, resume linkage, and follow-up task.

3. Interview Review
   - Add/upload interview source opens source step first.
   - Review step can link an existing opportunity.
   - Creating a review writes directly to InterviewSession.
   - Linked interview advances the related opportunity to interviewing.
   - Interview detail shows source file(s), QA list, selected QA detail, editable review fields.
   - Each QA can be marked reviewed or reopened as weak, and Today Todo updates from the weak QA state.

4. Resume Versions
   - Upload resume opens source step first.
   - Creating a record writes directly to ResumeVersion.
   - New resume can be selected by future opportunity records.
   - Resume detail remains editable and deletable.

5. Answer Library
   - Answer can be created manually.
   - Answer can be generated from interview QA.
   - Answer can be edited, deleted, and added to practice.
   - Adding an answer to practice creates an answer-linked training task and moves the answer to practice state.

6. Training Plan
   - Training focus can generate concrete tasks.
   - Training/manual tasks appear in Today Todo.
   - Training task priority is manually editable P0-P3 and updates Today Todo immediately.
   - Completing or changing task state should not desync Today Todo.
   - Linked training tasks explain where Today Todo will open: opportunity detail, interview review, answer library, or training plan.
   - Completing an answer-linked training task marks the answer card `ACTIVE` and `可复用`.

7. Today Todo
   - Count equals the derived action list shown on the page.
   - Each todo jumps to the correct module/detail.
   - No todo is generated from an unconfirmed draft or removed Inbox item.
   - Todo rows show source type so the user can tell whether the action came from job, interview, or training plan.
   - Completion semantics are clear: training task done, interview weak QA resolved, opportunity dismissed for today.

8. Priority
   - Opportunity priority is derived from status, due date/deadline, match, and subjective priority.
   - Training/misc task priority is user-set.
   - Frontend selector and backend selector stay aligned.

9. Local Persistence
   - API mode hydrates from SQLite.
   - Uploaded files are stored locally and referenced by `storageUri`.
   - JSON backup/export and restore include stored file contents.

10. Material Parsing And Source UX
   - Composer upload modal shows clear file state: reading, uploading, stored, ready, failed, or local-only.
   - Stored `.txt`, `.md`, text-based `.pdf`, and `.docx` files can be parsed without external AI.
   - Unsupported extraction does not advance to review; frontend shows a clear `extractionStatus` reason.
   - Screenshot/image OCR requires Assist/provider configuration and should not pretend to work without it.
   - Audio transcription requires Assist/provider configuration and should not pretend to work without it.
   - Interview Local parse mode allows pasted/uploaded transcript -> local Q/A split -> create record without AI.
   - Interview Assist parse mode uses two-stage AI review: extract Q/A, then generate per-question critique/framework/sample answer.
   - Interview text review follows parse mode only; transcription mode must not trigger AI review for pasted transcripts.
   - If Assist interview review fails, frontend blocks review step and shows `ai-parser-failed` / `ai-review-empty`; no silent fallback to old rule-based review content.
   - Missing transcripts produce a waiting/needs-transcript QA placeholder, not fake default interview questions.
   - Interview source files can preview transcript content inside the app when `content` is available.

Out Of Scope For v0.7.2:

- Old binary `.doc` extraction.
- Guaranteed AI parsing quality before testing with real user samples.
- Built-in cloud OCR/transcription service without user-provided provider/API key.
- Auth or cloud sync.
- Large visual redesign.
