import {
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileAudio,
  FileText,
  Plus,
  RotateCcw,
  Upload,
} from "lucide-react";
import { EmptyState, ListPager, PageIntro, ReviewBlock, SectionTitle } from "../components/AppPrimitives";
import { OpportunityCombobox } from "../components/OpportunityCombobox";
import type { InterviewSession, Opportunity, OpportunityAction, QaPair, SessionFile } from "../types";

export type InterviewView = "list" | "session" | "question";

export type QaUpdateField = keyof Pick<QaPair, "question" | "originalAnswer" | "critique" | "framework" | "optimizedAnswer">;

export type InterviewUpdatePatch = Partial<Pick<InterviewSession, "company" | "role" | "round" | "date" | "reviewPriority" | "opportunityId" | "note">>;

type ReviewPriorityOption = {
  value: OpportunityAction;
  label: string;
};

type InterviewsPageProps = {
  interviewSessions: InterviewSession[];
  filteredInterviewSessions: InterviewSession[];
  visibleInterviewSessions: InterviewSession[];
  safeInterviewPage: number;
  interviewPageCount: number;
  interviewView: InterviewView;
  selectedInterview: InterviewSession;
  selectedQa: QaPair;
  opportunities: Opportunity[];
  reviewPriorityOptions: ReviewPriorityOption[];
  interviewReparseBusy: boolean;
  interviewReparseNotice: string;
  onOpenComposer: () => void;
  onOpenInterviewSession: (id: string) => void;
  onInterviewPageChange: (page: number) => void;
  onInterviewViewChange: (view: InterviewView) => void;
  onUpdateSelectedInterview: (patch: InterviewUpdatePatch) => void;
  onRequestReparseSelectedInterview: () => void;
  onOpenStoredFile: (storageUri?: string) => void;
  onPreviewSessionFile: (file: SessionFile) => void;
  onAddQaPair: () => void;
  onOpenInterviewQuestion: (id: string) => void;
  onRequestDeleteInterview: () => void;
  onUpdateSelectedQa: (field: QaUpdateField, value: string) => void;
  onCreateAnswerCard: () => void;
  onAddSelectedQaToPractice: () => void;
  onUpdateSelectedQaWeak: (weak: boolean) => void;
  onRequestDeleteQa: () => void;
};

export function InterviewsPage({
  interviewSessions,
  filteredInterviewSessions,
  visibleInterviewSessions,
  safeInterviewPage,
  interviewPageCount,
  interviewView,
  selectedInterview,
  selectedQa,
  opportunities,
  reviewPriorityOptions,
  interviewReparseBusy,
  interviewReparseNotice,
  onOpenComposer,
  onOpenInterviewSession,
  onInterviewPageChange,
  onInterviewViewChange,
  onUpdateSelectedInterview,
  onRequestReparseSelectedInterview,
  onOpenStoredFile,
  onPreviewSessionFile,
  onAddQaPair,
  onOpenInterviewQuestion,
  onRequestDeleteInterview,
  onUpdateSelectedQa,
  onCreateAnswerCard,
  onAddSelectedQaToPractice,
  onUpdateSelectedQaWeak,
  onRequestDeleteQa,
}: InterviewsPageProps) {
  return (
    <section className="interview-page">
      {interviewView === "list" ? (
        <div className="surface interview-list-pane interview-home-pane paginated-pane">
          <div className="paginated-pane-header">
            <PageIntro
              label="面试复盘"
              title="记录每一场面试"
              detail="保存面试基本信息、问题、原回答、复盘建议和优化回答。"
              action={`${interviewSessions.length} 场面试`}
              helpTooltip="待整理问题指复盘中被标记为薄弱、还需要整理或练习的问题。只要一场面试还有待整理问题，它就会进入今日行动；标记已处理后会从今日行动中移除。"
              helpLabel="待整理问题说明"
            />

            <div className="button-row tight-row">
              <button className="primary-button" onClick={onOpenComposer}>
                <Upload size={16} />
                <span>导入面试复盘</span>
              </button>
            </div>
          </div>

          <div className="paginated-pane-body">
            <div className="interview-card-grid paginated-pane-content">
              {filteredInterviewSessions.length === 0 ? (
                <EmptyState title="没有匹配的面试" detail="清空搜索，或导入一场新的面试复盘。" className="filtered-empty-state" />
              ) : (
                visibleInterviewSessions.map((session) => {
                  const weakCount = session.qaPairs.filter((pair) => pair.weak).length;
                  return (
                    <button key={session.id} className="interview-session-card" onClick={() => onOpenInterviewSession(session.id)}>
                      <div className="interview-card-topline">
                        <span>{session.date}</span>
                        <strong>{weakCount ? `${weakCount} 题待整理` : "已整理"}</strong>
                      </div>
                      <h3>{session.company}</h3>
                      <p>
                        {session.role} · {session.round}
                      </p>
                      <div className="interview-card-stats">
                        <span>{session.qaPairs.length} 个问题</span>
                        <span>{session.sourceFiles?.length ?? 0} 份材料</span>
                        <ChevronRight size={16} />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <ListPager className="paginated-pane-footer" label="面试复盘列表" page={safeInterviewPage} pageCount={interviewPageCount} onPageChange={onInterviewPageChange} />
        </div>
      ) : (
        <div className="surface review-editor interview-detail-pane">
          <div className="interview-detail-nav interview-detail-nav-start">
            <button className="ghost-button compact-button" onClick={() => (interviewView === "question" ? onInterviewViewChange("session") : onInterviewViewChange("list"))}>
              <ChevronLeft size={14} />
              <span>{interviewView === "question" ? "问题目录" : "全部面试"}</span>
            </button>
          </div>

          {interviewView === "session" ? (
            <>
              <SectionTitle label={`${selectedInterview.date} / ${selectedInterview.round}`} title={`${selectedInterview.company} · ${selectedInterview.role}`} action={`${selectedInterview.qaPairs.length} 个问题`} />

              <div className="draft-edit-grid interview-session-edit">
                <label>
                  <span>公司</span>
                  <input value={selectedInterview.company} onChange={(event) => onUpdateSelectedInterview({ company: event.target.value })} />
                </label>
                <label>
                  <span>岗位</span>
                  <input value={selectedInterview.role} onChange={(event) => onUpdateSelectedInterview({ role: event.target.value })} />
                </label>
                <label>
                  <span>轮次</span>
                  <input value={selectedInterview.round} onChange={(event) => onUpdateSelectedInterview({ round: event.target.value })} />
                </label>
                <label>
                  <span>日期</span>
                  <input value={selectedInterview.date} onChange={(event) => onUpdateSelectedInterview({ date: event.target.value })} />
                </label>
                <label>
                  <span>复盘优先级</span>
                  <select value={selectedInterview.reviewPriority ?? "P1"} onChange={(event) => onUpdateSelectedInterview({ reviewPriority: event.target.value as OpportunityAction })}>
                    {reviewPriorityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>关联岗位</span>
                  <OpportunityCombobox opportunities={opportunities} value={selectedInterview.opportunityId ?? ""} onChange={(value) => onUpdateSelectedInterview({ opportunityId: value || undefined })} emptyLabel="未关联岗位" />
                </label>
                <label className="wide-field">
                  <span>备注</span>
                  <textarea value={selectedInterview.note ?? ""} onChange={(event) => onUpdateSelectedInterview({ note: event.target.value })} placeholder="记录这场面试的背景、特殊要求或后续关注点。" />
                </label>
              </div>

              <div className="source-panel compact-source">
                <SectionTitle label="面试材料" title="这场面试的录音或文字稿" action={`${selectedInterview.sourceFiles?.length ?? 0} 份`} />
                <div className="button-row source-panel-actions">
                  <button className="secondary-button compact-button" disabled={interviewReparseBusy} onClick={onRequestReparseSelectedInterview}>
                    <RotateCcw size={14} />
                    <span>{interviewReparseBusy ? "整理中..." : "重新整理问题"}</span>
                  </button>
                </div>
                {interviewReparseNotice ? <p className="parse-inline-notice">{interviewReparseNotice}</p> : null}
                <div className="source-list">
                  {(selectedInterview.sourceFiles ?? []).map((file) => {
                    const Icon = file.kind === "audio" ? FileAudio : FileText;
                    const canPreview = Boolean(file.content || file.storageUri);
                    return (
                      <button className="source-item source-button file-source" key={file.id} disabled={!canPreview} onClick={() => (file.content ? onPreviewSessionFile(file) : onOpenStoredFile(file.storageUri))}>
                        <Icon size={18} />
                        <div>
                          <span>{file.kind === "audio" ? "原录音" : "文字稿"}</span>
                          <strong>{file.fileName}</strong>
                          <small>
                            {file.detail}
                            {file.duration ? ` / ${file.duration}` : ""}
                            {file.content ? " / 可预览文字" : file.storageUri ? " / 已存储，可打开" : " / 未存储原文件"}
                          </small>
                        </div>
                        <em>{file.uploadedAt}</em>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="interview-toolbar">
                <span>问题目录</span>
                <div className="mini-actions">
                  <button className="secondary-button compact-button" onClick={onAddQaPair}>
                    <Plus size={14} />
                    <span>添加问题</span>
                  </button>
                </div>
              </div>

              <div className="qa-list qa-directory-list">
                {selectedInterview.qaPairs.map((pair) => (
                  <button className={`qa-card qa-card-button ${pair.weak ? "weak" : ""} ${pair.id === selectedQa.id ? "selected-qa" : ""}`} key={pair.id} onClick={() => onOpenInterviewQuestion(pair.id)}>
                    <div>
                      <span className="type-pill">{pair.type}</span>
                      <h3>{pair.question}</h3>
                      <p>{pair.critique}</p>
                    </div>
                    <div className="score">{pair.score}/5</div>
                  </button>
                ))}
              </div>

              <div className="danger-zone">
                <span>危险操作</span>
                <button className="destructive-button compact-button" onClick={onRequestDeleteInterview}>
                  删除整场面试
                </button>
              </div>
            </>
          ) : (
            <>
              <SectionTitle label={`${selectedInterview.company} / ${selectedInterview.round}`} title={selectedQa.question} action={selectedQa.weak ? "需练习" : "可复用"} />
              <div className="interview-question-context">
                <span>{selectedInterview.role}</span>
                <span>{selectedInterview.date}</span>
                <span>{selectedQa.type}</span>
                <strong>{selectedQa.score}/5</strong>
              </div>

              <ReviewBlock label="面试问题" value={selectedQa.question} onChange={(value) => onUpdateSelectedQa("question", value)} />
              <ReviewBlock label="我的原回答" value={selectedQa.originalAnswer} onChange={(value) => onUpdateSelectedQa("originalAnswer", value)} />
              <ReviewBlock label="复盘建议" value={selectedQa.critique} onChange={(value) => onUpdateSelectedQa("critique", value)} />
              <ReviewBlock label="推荐回答框架" value={selectedQa.framework} onChange={(value) => onUpdateSelectedQa("framework", value)} />
              <ReviewBlock label="具体优化回答" value={selectedQa.optimizedAnswer} onChange={(value) => onUpdateSelectedQa("optimizedAnswer", value)} />

              <div className="button-row">
                <button className="primary-button" onClick={onCreateAnswerCard}>
                  <BookOpenCheck size={16} />
                  <span>生成答案卡</span>
                </button>
                <button className="secondary-button" onClick={onAddSelectedQaToPractice}>
                  <ClipboardList size={16} />
                  <span>加入练习</span>
                </button>
                <button className="secondary-button" onClick={() => onUpdateSelectedQaWeak(!selectedQa.weak)}>
                  <Check size={16} />
                  <span>{selectedQa.weak ? "标记已处理" : "重新标为薄弱"}</span>
                </button>
              </div>

              <div className="danger-zone">
                <span>危险操作</span>
                <button className="destructive-button compact-button" onClick={onRequestDeleteQa}>
                  删除当前问题
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
