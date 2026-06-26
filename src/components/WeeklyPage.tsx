import { Library, Plus } from "lucide-react";
import type { OpportunityAction, WeeklyTask } from "../types";
import { paginateWeeklyGroupTasks } from "../utils/pagination";
import { ListPager, PageIntro, SegmentedProgress } from "./AppPrimitives";

export type WeeklyTaskGroup = {
  id: string;
  title: string;
  detail: string;
  examples: string[];
  tasks: WeeklyTask[];
};

export function WeeklyPage({
  groups,
  visibleTrainingTaskCount,
  submittedApplications,
  targetApplications,
  targetDraft,
  interviewPage,
  practicePage,
  onTargetDraftChange,
  onTargetDraftBlur,
  onInterviewPageChange,
  onPracticePageChange,
  onAddPracticeTask,
  onGoToAnswers,
  onToggleTaskStatus,
  onUpdateTaskLevel,
  onEditTaskRequest,
  onDeleteTaskRequest,
}: {
  groups: WeeklyTaskGroup[];
  visibleTrainingTaskCount: number;
  submittedApplications: number;
  targetApplications: number;
  targetDraft: string;
  interviewPage: number;
  practicePage: number;
  onTargetDraftChange: (value: string) => void;
  onTargetDraftBlur: () => void;
  onInterviewPageChange: (page: number) => void;
  onPracticePageChange: (page: number) => void;
  onAddPracticeTask: () => void;
  onGoToAnswers: () => void;
  onToggleTaskStatus: (task: WeeklyTask) => void;
  onUpdateTaskLevel: (task: WeeklyTask, level: OpportunityAction) => void;
  onEditTaskRequest: (task: WeeklyTask) => void;
  onDeleteTaskRequest: (task: WeeklyTask) => void;
}) {
  return (
    <section className="weekly-workspace">
      <div className="surface weekly-board paginated-pane">
        <div className="paginated-pane-header">
          <PageIntro
            label="本周计划"
            title="安排本周要练的事"
            detail="本周计划可包含面试表达练习、笔试准备、作品集整理和材料补充等，拆成本周可以完成的小任务。"
            action={`${visibleTrainingTaskCount} 待完成`}
          />
          <div className="weekly-overview">
            <div className="weekly-progress-card">
              <span>本周投递</span>
              <strong>
                {submittedApplications}/{targetApplications}
              </strong>
              <SegmentedProgress value={targetApplications > 0 ? (submittedApplications / targetApplications) * 100 : 0} segments={12} />
            </div>
            <label className="weekly-goal-card">
              <span>目标</span>
              <input type="number" min="0" value={targetDraft} onBlur={onTargetDraftBlur} onChange={(event) => onTargetDraftChange(event.target.value)} />
              <small>本周想投递多少个岗位</small>
            </label>
          </div>
        </div>

        <div className="paginated-pane-body">
          <div className="weekly-group-list weekly-groups-page">
            {groups.map((group) => {
              const page = group.id === "interview" ? interviewPage : practicePage;
              const setPage = group.id === "interview" ? onInterviewPageChange : onPracticePageChange;
              const taskList = paginateWeeklyGroupTasks(group.tasks, page, group.id);
              const visibleTasks = taskList.visible;
              const showAddCard = group.id === "practice" && taskList.safePage === 0;
              const showAnswerPracticeEmpty = group.id === "interview" && group.tasks.length === 0;

              return (
                <section className="weekly-task-group" key={group.id}>
                  <div className="weekly-group-header">
                    <div>
                      <h3>{group.title}</h3>
                      <p>{group.detail}</p>
                    </div>
                    <span>{group.tasks.length} 项</span>
                  </div>
                  <div className="weekly-examples">
                    {group.examples.map((example) => (
                      <small key={example}>{example}</small>
                    ))}
                  </div>
                  <div className="weekly-task-list">
                    {showAddCard ? (
                      <button className="weekly-add-card" onClick={onAddPracticeTask}>
                        <Plus size={18} />
                        <strong>添加动作</strong>
                        <span>新增一张自主训练卡片</span>
                      </button>
                    ) : null}
                    {showAnswerPracticeEmpty ? (
                      <div className="weekly-empty-card weekly-answer-empty-card">
                        <Library size={18} />
                        <strong>还没有答案卡练习</strong>
                        <button className="secondary-button compact-button" onClick={onGoToAnswers}>
                          去答案库添加
                        </button>
                      </div>
                    ) : null}
                    {group.id === "practice" && group.tasks.length === 0 ? (
                      <p className="empty-list-note weekly-empty-note">还没有自主训练动作，可以先添加笔试、作品集或项目表达练习。</p>
                    ) : null}
                    {visibleTasks.map((task) => (
                      <article className={`weekly-task ${task.status === "done" ? "is-done" : ""}`} key={task.id}>
                        <div className="weekly-task-header">
                          <label className="weekly-priority-select-label">
                            <span className="visually-hidden">优先级</span>
                            <select
                              className={`weekly-priority-select priority ${(task.level ?? "P2").toLowerCase()}`}
                              value={task.level ?? "P2"}
                              onChange={(event) => onUpdateTaskLevel(task, event.target.value as OpportunityAction)}
                              aria-label={`调整「${task.title}」优先级`}
                            >
                              <option value="P0">P0</option>
                              <option value="P1">P1</option>
                              <option value="P2">P2</option>
                              <option value="P3">P3</option>
                            </select>
                          </label>
                          <small>{task.sourceLabel}</small>
                        </div>
                        <h3>{task.title}</h3>
                        <p>{task.detail}</p>
                        <div className="weekly-task-actions">
                          <button className="weekly-card-action is-primary" onClick={() => onToggleTaskStatus(task)}>
                            {task.status === "done" ? "重新打开" : "标记已完成"}
                          </button>
                          <button className="weekly-card-action" onClick={() => onEditTaskRequest(task)}>
                            编辑
                          </button>
                          <button className="weekly-card-action is-danger" onClick={() => onDeleteTaskRequest(task)}>
                            删除
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <ListPager className="weekly-section-pager" label={`${group.title}任务`} page={taskList.safePage} pageCount={taskList.pageCount} onPageChange={setPage} />
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
