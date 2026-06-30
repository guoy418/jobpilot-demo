import { computeOpportunityAction } from "../domain";
import type {
  ModuleComposer,
  ModuleComposerDraft,
  Opportunity,
  OpportunityAction,
  OpportunityMatch,
  OpportunityPriority,
  ResumeVersion,
} from "../types";
import { DatePickerInput } from "./DatePickerInput";
import { OpportunityCombobox } from "./OpportunityCombobox";

type UpdateComposerDraft = <Field extends keyof ModuleComposerDraft>(field: Field, value: ModuleComposerDraft[Field]) => void;

const reviewPriorityOptions: Array<{ value: OpportunityAction; label: string }> = [
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
];

function OpportunityReviewFields({
  draft,
  resumeList,
  updateDraft,
}: {
  draft: ModuleComposerDraft;
  resumeList: ResumeVersion[];
  updateDraft: UpdateComposerDraft;
}) {
  const suggestedAction = computeOpportunityAction({
    status: "TO APPLY",
    deadline: draft.deadline,
    dueDate: draft.dueDate,
    match: draft.match,
    priority: draft.priority,
  });

  return (
    <>
      <label>
        <span>公司 *</span>
        <input value={draft.company} onChange={(event) => updateDraft("company", event.target.value)} />
      </label>
      <label>
        <span>岗位名称 *</span>
        <input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} />
      </label>
      <label>
        <span>城市</span>
        <input value={draft.city} onChange={(event) => updateDraft("city", event.target.value)} />
      </label>
      <label>
        <span>下一步动作</span>
        <input value={draft.nextAction} onChange={(event) => updateDraft("nextAction", event.target.value)} />
      </label>
      <div className="date-field">
        <label htmlFor="composer-opportunity-due-date">截止日期</label>
        <DatePickerInput id="composer-opportunity-due-date" value={draft.dueDate} label="截止日期" onChange={(value) => updateDraft("dueDate", value)} />
      </div>
      <label>
        <span>主观优先级</span>
        <select value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value as OpportunityPriority)}>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </label>
      <label>
        <span>匹配度</span>
        <select value={draft.match} onChange={(event) => updateDraft("match", event.target.value as OpportunityMatch)}>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
      </label>
      <label>
        <span className="field-label-row">
          <span>今日优先级</span>
          <span
            className="field-tooltip"
            tabIndex={0}
            data-tooltip="默认会根据状态、截止日、匹配度和主观优先级自动计算；也可以手动选择 P0-P3。"
            aria-label="今日优先级说明"
          >
            ?
          </span>
        </span>
        <select
          value={draft.actionManual ? draft.action : "AUTO"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "AUTO") {
              updateDraft("actionManual", false);
              updateDraft("action", suggestedAction);
              return;
            }
            updateDraft("actionManual", true);
            updateDraft("action", value as OpportunityAction);
          }}
        >
          <option value="AUTO">自动（建议 {suggestedAction}）</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
      </label>
      <label>
        <span>投递简历</span>
        <select value={draft.resumeId} onChange={(event) => updateDraft("resumeId", event.target.value)}>
          <option value="">暂不选择简历</option>
          {resumeList.map((resume) => (
            <option value={resume.id} key={resume.id}>
              {resume.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>来源</span>
        <input value={draft.sourceLabel} onChange={(event) => updateDraft("sourceLabel", event.target.value)} />
      </label>
      <label className="wide-field opportunity-note-field">
        <span>备注</span>
        <textarea value={draft.note} onChange={(event) => updateDraft("note", event.target.value)} />
      </label>
      <label className="wide-field">
        <span>岗位描述 *</span>
        <textarea value={draft.sourceText} onChange={(event) => updateDraft("sourceText", event.target.value)} />
      </label>
    </>
  );
}

function InterviewReviewFields({
  draft,
  opportunities,
  updateDraft,
}: {
  draft: ModuleComposerDraft;
  opportunities: Opportunity[];
  updateDraft: UpdateComposerDraft;
}) {
  return (
    <>
      <label>
        <span>公司 *</span>
        <input value={draft.company} onChange={(event) => updateDraft("company", event.target.value)} />
      </label>
      <label>
        <span>岗位 *</span>
        <input value={draft.role} onChange={(event) => updateDraft("role", event.target.value)} />
      </label>
      <label>
        <span>轮次 *</span>
        <input value={draft.round} onChange={(event) => updateDraft("round", event.target.value)} />
      </label>
      <label>
        <span>日期</span>
        <input value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} />
      </label>
      <label>
        <span>关联岗位</span>
        <OpportunityCombobox
          opportunities={opportunities}
          value={draft.linkedOpportunityId}
          onChange={(value) => updateDraft("linkedOpportunityId", value)}
          emptyLabel="暂不关联"
        />
      </label>
      <label>
        <span>复盘优先级</span>
        <select value={draft.reviewPriority} onChange={(event) => updateDraft("reviewPriority", event.target.value as OpportunityAction)}>
          {reviewPriorityOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="wide-field">
        <span>备注</span>
        <textarea
          value={draft.nextAction}
          onChange={(event) => updateDraft("nextAction", event.target.value)}
          placeholder="记录这场面试的背景、特殊要求或后续关注点。"
        />
      </label>
      <label className="wide-field">
        <span>原文件名</span>
        <input value={draft.fileName} onChange={(event) => updateDraft("fileName", event.target.value)} placeholder="recording.m4a 或 transcript.txt" />
      </label>
      <label className="wide-field">
        <span>面试文字稿 / 复盘内容</span>
        <textarea value={draft.sourceText} onChange={(event) => updateDraft("sourceText", event.target.value)} />
      </label>
    </>
  );
}

function ResumeReviewFields({ draft, updateDraft }: { draft: ModuleComposerDraft; updateDraft: UpdateComposerDraft }) {
  return (
    <>
      <label>
        <span>版本名称 *</span>
        <input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} />
      </label>
      <label>
        <span>文件名 *</span>
        <input value={draft.fileName} onChange={(event) => updateDraft("fileName", event.target.value)} placeholder="resume-v1.pdf" />
      </label>
      <label className="wide-field">
        <span>适合方向</span>
        <input value={draft.roles} onChange={(event) => updateDraft("roles", event.target.value)} />
      </label>
      <label className="wide-field">
        <span>核心卖点</span>
        <textarea value={draft.points} onChange={(event) => updateDraft("points", event.target.value)} />
      </label>
      <label className="wide-field">
        <span>文件摘要</span>
        <textarea value={draft.summary} onChange={(event) => updateDraft("summary", event.target.value)} />
      </label>
    </>
  );
}

function AnswerReviewFields({ draft, updateDraft }: { draft: ModuleComposerDraft; updateDraft: UpdateComposerDraft }) {
  return (
    <>
      <label className="wide-field">
        <span>问题 *</span>
        <input value={draft.question} onChange={(event) => updateDraft("question", event.target.value)} />
      </label>
      <label className="wide-field">
        <span>回答框架</span>
        <textarea value={draft.framework} onChange={(event) => updateDraft("framework", event.target.value)} />
      </label>
      <label className="wide-field">
        <span>具体回答</span>
        <textarea value={draft.answer} onChange={(event) => updateDraft("answer", event.target.value)} />
      </label>
      <label className="wide-field">
        <span>适用岗位</span>
        <input value={draft.relatedRoles} onChange={(event) => updateDraft("relatedRoles", event.target.value)} />
      </label>
    </>
  );
}

export function ComposerReviewFields({
  composer,
  draft,
  opportunities,
  resumeList,
  updateDraft,
}: {
  composer: ModuleComposer;
  draft: ModuleComposerDraft;
  opportunities: Opportunity[];
  resumeList: ResumeVersion[];
  updateDraft: UpdateComposerDraft;
}) {
  return (
    <div className="draft-edit-grid composer-grid">
      {composer === "opportunity" && <OpportunityReviewFields draft={draft} resumeList={resumeList} updateDraft={updateDraft} />}
      {composer === "interview" && <InterviewReviewFields draft={draft} opportunities={opportunities} updateDraft={updateDraft} />}
      {composer === "resume" && <ResumeReviewFields draft={draft} updateDraft={updateDraft} />}
      {composer === "answer" && <AnswerReviewFields draft={draft} updateDraft={updateDraft} />}
    </div>
  );
}
