import { X } from "lucide-react";
import type { MouseEvent } from "react";
import type { WeeklyTask } from "../types";

export type WeeklyTaskFormDraft = {
  editingTaskId?: string;
  title: string;
  detail: string;
  level: WeeklyTask["level"];
};

type BackdropHandler = (event: MouseEvent<HTMLDivElement>) => void;

export function WeeklyTaskDialog({
  form,
  mode = "create",
  onChange,
  onSubmit,
  onClose,
  onBackdropMouseDown,
  onBackdropClick,
}: {
  form: WeeklyTaskFormDraft;
  mode?: "create" | "edit";
  onChange: (patch: Partial<WeeklyTaskFormDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
  onBackdropMouseDown: BackdropHandler;
  onBackdropClick: BackdropHandler;
}) {
  const isEditing = mode === "edit";

  return (
    <div
      className="asset-preview weekly-task-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-task-dialog-title"
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <div className="asset-preview-panel weekly-task-form-panel" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose} aria-label="关闭">
          <X size={16} />
        </button>
        <div className="section-title">
          <span>{isEditing ? "本周计划" : "自主训练"}</span>
          <h2 id="weekly-task-dialog-title">{isEditing ? "编辑练习动作" : "添加练习动作"}</h2>
        </div>
        <p>{isEditing ? "修改这张本周计划卡片的标题、备注和优先级。" : "手动写下这周的练习任务，例如笔试、作品集或项目表达。"}</p>
        <div className="draft-edit-grid weekly-task-form-grid">
          <label className="wide-field">
            <span>动作标题</span>
            <input
              autoFocus
              value={form.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder="例如：整理一版项目表达"
            />
          </label>
          <label className="wide-field">
            <span>备注说明</span>
            <textarea
              value={form.detail}
              onChange={(event) => onChange({ detail: event.target.value })}
              placeholder="例如：练一道笔试题，或整理一个项目表达。"
            />
          </label>
          <label>
            <span>优先级</span>
            <select value={form.level ?? "P2"} onChange={(event) => onChange({ level: event.target.value as WeeklyTask["level"] })}>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
          </label>
        </div>
        <div className="button-row confirm-actions">
          <button className="primary-button" onClick={onSubmit}>
            {isEditing ? "保存修改" : "添加动作"}
          </button>
          <button className="secondary-button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
