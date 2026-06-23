import { Archive, FileDown, PanelRight, Settings, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { JobPilotBackup } from "../apiClient";
import { getBackupRestorePreview, type BackupRestorePreview } from "../utils/backup";
import { ExportAction, PageIntro, SectionTitle } from "./AppPrimitives";

type AiSettingsShape = {
  provider: "none" | "openai" | "anthropic" | "custom";
  model: string;
  apiKey: string;
  parseMode: "mock" | "assist";
  transcriptionMode: "mock" | "assist";
  endpoint: string;
  notes: string;
};

export function SettingsPage({
  isPublicDemo,
  isApiEnabled,
  aiSettings,
  onAiSettingsChange,
  onSaveSettings,
  onResetSettings,
  onExportBackup,
  onImportBackup,
  onExportAnswerCards,
  onExportInterviewReviews,
}: {
  isPublicDemo: boolean;
  isApiEnabled: boolean;
  aiSettings: AiSettingsShape;
  onAiSettingsChange: (patch: Partial<AiSettingsShape>) => void;
  onSaveSettings: () => void;
  onResetSettings: () => void;
  onExportBackup: () => void;
  onImportBackup: (backup: JobPilotBackup) => Promise<void> | void;
  onExportAnswerCards: () => void;
  onExportInterviewReviews: () => void;
}) {
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restorePreview, setRestorePreview] = useState<(BackupRestorePreview & { fileName: string }) | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const openRestorePicker = () => {
    if (restoreInputRef.current) restoreInputRef.current.value = "";
    restoreInputRef.current?.click();
  };

  const handleRestoreFileSelected = async () => {
    const file = restoreInputRef.current?.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setRestorePreview({ ...getBackupRestorePreview(parsed), fileName: file.name });
    } catch {
      setRestorePreview({
        ok: false,
        error: "备份文件不是有效 JSON",
        fileName: file.name,
      });
    }
  };

  const applyRestore = async () => {
    if (!restorePreview?.ok) return;
    setRestoreBusy(true);
    try {
      await onImportBackup(restorePreview.backup);
      setRestorePreview(null);
    } catch (error) {
      setRestorePreview({
        ok: false,
        error: error instanceof Error ? error.message : "备份恢复失败，已有数据未被覆盖",
        fileName: restorePreview.fileName,
      });
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <section className="surface">
      <PageIntro
        label="设置与备份"
        title="管理数据和智能整理"
        detail="在这里备份数据、导出复习材料，也可以选择是否开启智能整理能力。"
        action={isPublicDemo ? "演示模式" : isApiEnabled ? "本地保存" : "浏览器保存"}
      />
      <input ref={restoreInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={handleRestoreFileSelected} />
      <div className="settings-grid">
        <ExportAction icon={Archive} title="备份全部数据" detail="保存岗位、面试、答案和简历记录。" onClick={onExportBackup} />
        <ExportAction icon={Upload} title="恢复备份" detail="先预览备份内容，确认后再覆盖当前数据。" onClick={openRestorePicker} />
        <ExportAction icon={FileDown} title="导出答案卡" detail="下载一份方便复习的材料。" onClick={onExportAnswerCards} />
        <ExportAction icon={PanelRight} title="导出面试复盘" detail="下载问题、复盘建议和优化回答。" onClick={onExportInterviewReviews} />
      </div>
      {restorePreview ? (
        <div className={`restore-preview ${restorePreview.ok ? "" : "restore-preview-error"}`}>
          <SectionTitle label="恢复预览" title={restorePreview.ok ? "确认要覆盖当前数据？" : "备份无法恢复"} action={restorePreview.fileName} />
          {restorePreview.ok ? (
            <>
              <p>恢复会替换当前岗位、面试、答案、简历和本周计划。请确认数量符合预期后再继续。</p>
              <div className="restore-preview-grid">
                <div>
                  <span>岗位</span>
                  <strong>{restorePreview.summary.opportunities}</strong>
                </div>
                <div>
                  <span>简历</span>
                  <strong>{restorePreview.summary.resumes}</strong>
                </div>
                <div>
                  <span>面试</span>
                  <strong>{restorePreview.summary.interviews}</strong>
                </div>
                <div>
                  <span>答案卡</span>
                  <strong>{restorePreview.summary.answerCards}</strong>
                </div>
                <div>
                  <span>本周动作</span>
                  <strong>{restorePreview.summary.weeklyTasks}</strong>
                </div>
              </div>
              <div className="button-row">
                <button className="destructive-button" disabled={restoreBusy} onClick={applyRestore}>
                  {restoreBusy ? "恢复中" : "确认恢复"}
                </button>
                <button className="secondary-button" disabled={restoreBusy} onClick={() => setRestorePreview(null)}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{restorePreview.error}。当前数据不会被覆盖。</p>
              <div className="button-row">
                <button className="secondary-button" onClick={openRestorePicker}>
                  重新选择
                </button>
                <button className="ghost-button" onClick={() => setRestorePreview(null)}>
                  关闭
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <div className="settings-panel">
        <SectionTitle label="智能整理" title="让系统帮你读材料" action={aiSettings.provider === "none" ? "未开启" : "已配置"} />
        <p>默认可以直接读取文字文件。需要识别截图、转写录音或整理长文本时，可以在这里接入你自己的模型服务。</p>
        <div className="draft-edit-grid">
          <label>
            <span>服务商</span>
            <select value={aiSettings.provider} onChange={(event) => onAiSettingsChange({ provider: event.target.value as AiSettingsShape["provider"] })}>
              <option value="none">暂不启用</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="custom">自定义兼容接口</option>
            </select>
          </label>
          <label>
            <span>模型</span>
            <input value={aiSettings.model} onChange={(event) => onAiSettingsChange({ model: event.target.value })} placeholder="填写你常用的模型名称" />
          </label>
          <label>
            <span>文字材料整理</span>
            <select value={aiSettings.parseMode} onChange={(event) => onAiSettingsChange({ parseMode: event.target.value as AiSettingsShape["parseMode"] })}>
              <option value="mock">基础整理</option>
              <option value="assist">智能整理</option>
            </select>
          </label>
          <label>
            <span>录音转文字</span>
            <select
              value={aiSettings.transcriptionMode}
              onChange={(event) => onAiSettingsChange({ transcriptionMode: event.target.value as AiSettingsShape["transcriptionMode"] })}
            >
              <option value="mock">暂不启用</option>
              <option value="assist">启用转写</option>
            </select>
          </label>
          <label className="wide-field">
            <span>访问密钥（只保存在本机）</span>
            <input
              type="password"
              value={aiSettings.apiKey}
              onChange={(event) => onAiSettingsChange({ apiKey: event.target.value })}
              placeholder="可选，只有开启智能整理时需要"
            />
          </label>
          <label className="wide-field">
            <span>服务地址（可选）</span>
            <input value={aiSettings.endpoint} onChange={(event) => onAiSettingsChange({ endpoint: event.target.value })} placeholder="使用自定义服务时填写" />
          </label>
          <label className="wide-field">
            <span>备注</span>
            <textarea value={aiSettings.notes} onChange={(event) => onAiSettingsChange({ notes: event.target.value })} placeholder="例如：用于整理面试文字稿或识别截图。" />
          </label>
        </div>
        <div className="button-row">
          <button className="primary-button" onClick={onSaveSettings}>
            <Settings size={16} />
            <span>保存设置</span>
          </button>
          <button className="secondary-button" onClick={onResetSettings}>
            重置设置
          </button>
        </div>
      </div>
    </section>
  );
}
