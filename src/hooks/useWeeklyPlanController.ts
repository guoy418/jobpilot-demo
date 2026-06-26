import { useEffect, useMemo, useState } from "react";
import { createWeeklyTaskApi, deleteWeeklyTaskApi, getWeeklyPlanApi, updateWeeklyPlanApi, updateWeeklyTaskApi } from "../apiClient";
import { isApiEnabled } from "../appConfig";
import { makeId } from "../domain";
import type { WeeklyTaskFormDraft } from "../components/WeeklyTaskDialog";
import type { WeeklyPlan, WeeklyTask } from "../types";

const isOpenWeeklyTask = (task: WeeklyTask) => task.status === "open";
const emptyWeeklyTaskForm = (): WeeklyTaskFormDraft => ({
  title: "",
  detail: "",
  level: "P2",
});

const weeklyTaskEditForm = (task: WeeklyTask): WeeklyTaskFormDraft => ({
  editingTaskId: task.id,
  title: task.title,
  detail: task.detail,
  level: task.level ?? "P2",
});

const isValidWeeklyTaskLevel = (level: WeeklyTask["level"]): level is NonNullable<WeeklyTask["level"]> =>
  level === "P0" || level === "P1" || level === "P2" || level === "P3";

export function useWeeklyPlanController({
  initialPlan,
  onInsightsRefresh,
  onInsightsInvalidate,
  onMessage,
  onTaskCreated,
}: {
  initialPlan: WeeklyPlan;
  onInsightsRefresh: () => void;
  onInsightsInvalidate: () => void;
  onMessage: (message: string) => void;
  onTaskCreated?: (task: WeeklyTask) => void;
}) {
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan>(initialPlan);
  const [weeklyTargetDraft, setWeeklyTargetDraft] = useState(String(Math.max(0, initialPlan.targetApplications)));
  const [weeklyInterviewPage, setWeeklyInterviewPage] = useState(0);
  const [weeklyPracticePage, setWeeklyPracticePage] = useState(0);
  const [weeklyTaskForm, setWeeklyTaskForm] = useState<WeeklyTaskFormDraft | null>(null);

  const hasWeeklyTarget = weeklyPlan.targetApplications > 0;
  const weeklyTargetApplications = Math.max(0, weeklyPlan.targetApplications);

  useEffect(() => {
    setWeeklyTargetDraft(String(weeklyTargetApplications));
  }, [weeklyTargetApplications]);

  const openWeeklyTasks = useMemo(() => weeklyPlan.tasks.filter(isOpenWeeklyTask), [weeklyPlan.tasks]);
  const weeklyTaskGroups = useMemo(
    () => [
      {
        id: "interview",
        title: "面试表达练习",
        detail: "从面试复盘或答案卡中选择想练的问题，添加到这里。",
        examples: ["重讲一个薄弱项目题", "把答案卡练到能自然复述"],
        tasks: openWeeklyTasks.filter((task) => task.source === "interview" || task.source === "answer"),
      },
      {
        id: "practice",
        title: "自主训练",
        detail: "手动添加笔试、作品集、英语和材料整理等其他任务。",
        examples: ["练一道笔试题", "整理一版项目表达"],
        tasks: openWeeklyTasks.filter((task) => task.source === "manual" || task.source === "weekly-focus"),
      },
    ],
    [openWeeklyTasks],
  );
  const visibleTrainingTaskCount = weeklyTaskGroups.reduce((count, group) => count + group.tasks.length, 0);

  const replaceWeeklyPlan = (plan: WeeklyPlan) => setWeeklyPlan(plan);

  const refreshWeeklyPlan = () => {
    if (!isApiEnabled) return;
    void getWeeklyPlanApi()
      .then(setWeeklyPlan)
      .catch(() => onMessage("本周计划已保存在本机"));
  };

  const syncWeeklyPlanPatch = (patch: Partial<Omit<WeeklyPlan, "tasks">>) => {
    void updateWeeklyPlanApi(patch)
      .then(onInsightsRefresh)
      .catch(() => onMessage("本周计划已保存在本机"));
  };

  const syncCreatedWeeklyTask = (task: WeeklyTask) => {
    void createWeeklyTaskApi(task)
      .then(onInsightsRefresh)
      .catch(() => onMessage("本周计划已保存在本机"));
  };

  const syncUpdatedWeeklyTask = (id: string, patch: Partial<WeeklyTask>) => {
    void updateWeeklyTaskApi(id, patch)
      .then(onInsightsRefresh)
      .catch(() => onMessage("本周计划已保存在本机"));
  };

  const syncDeletedWeeklyTask = (id: string) => {
    void deleteWeeklyTaskApi(id)
      .then(onInsightsRefresh)
      .catch(() => onMessage("本周计划已保存在本机"));
  };

  const prependWeeklyTask = (task: WeeklyTask, options: { resetPracticePage?: boolean; message?: string } = {}) => {
    setWeeklyPlan((plan) => ({ ...plan, tasks: [task, ...plan.tasks] }));
    if (options.resetPracticePage) setWeeklyPracticePage(0);
    onInsightsInvalidate();
    onTaskCreated?.(task);
    syncCreatedWeeklyTask(task);
    if (options.message) onMessage(options.message);
  };

  const patchWeeklyTask = (id: string, patch: Partial<WeeklyTask>) => {
    setWeeklyPlan((plan) => ({
      ...plan,
      tasks: plan.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    }));
    onInsightsInvalidate();
    syncUpdatedWeeklyTask(id, patch);
  };

  const removeWeeklyTaskById = (id: string, message?: string) => {
    setWeeklyPlan((plan) => ({ ...plan, tasks: plan.tasks.filter((task) => task.id !== id) }));
    onInsightsInvalidate();
    syncDeletedWeeklyTask(id);
    if (message) onMessage(message);
  };

  const removeWeeklyTasksByEntity = (source: WeeklyTask["source"], relatedEntityId: string) => {
    setWeeklyPlan((plan) => ({
      ...plan,
      tasks: plan.tasks.filter((task) => !(task.source === source && task.relatedEntityId === relatedEntityId)),
    }));
    onInsightsInvalidate();
  };

  const addWeeklyTask = (preset?: Partial<Pick<WeeklyTask, "title" | "detail" | "level">>) => {
    const newTask: WeeklyTask = {
      id: makeId("WT"),
      title: preset?.title?.trim() || "新的练习动作",
      detail: preset?.detail?.trim() || "写下今天准备推进的一件小事。",
      source: "manual",
      sourceLabel: "本周计划",
      level: preset?.level ?? "P2",
      status: "open",
    };
    prependWeeklyTask(newTask, { resetPracticePage: true, message: "动作已添加" });
  };

  const openWeeklyTaskDialog = () => setWeeklyTaskForm(emptyWeeklyTaskForm());
  const openWeeklyTaskEditDialog = (task: WeeklyTask) => setWeeklyTaskForm(weeklyTaskEditForm(task));
  const updateWeeklyTaskForm = (patch: Partial<WeeklyTaskFormDraft>) => setWeeklyTaskForm((form) => (form ? { ...form, ...patch } : form));
  const closeWeeklyTaskDialog = () => setWeeklyTaskForm(null);

  const submitWeeklyTaskForm = () => {
    if (!weeklyTaskForm) return;
    const title = weeklyTaskForm.title.trim();
    if (!title) {
      onMessage("请填写动作标题");
      return;
    }
    if (!isValidWeeklyTaskLevel(weeklyTaskForm.level)) {
      onMessage("请选择有效优先级");
      return;
    }
    if (weeklyTaskForm.editingTaskId) {
      patchWeeklyTask(weeklyTaskForm.editingTaskId, {
        title,
        detail: weeklyTaskForm.detail.trim(),
        level: weeklyTaskForm.level,
      });
      onMessage("动作已更新");
      setWeeklyTaskForm(null);
      return;
    }
    addWeeklyTask({
      title,
      detail: weeklyTaskForm.detail.trim() || "例如：练一道笔试题，或整理一个项目表达。",
      level: weeklyTaskForm.level,
    });
    setWeeklyTaskForm(null);
  };

  const updateWeeklyTask = (id: string, field: keyof Pick<WeeklyTask, "title" | "detail" | "status" | "level">, value: string) => {
    const patch = { [field]: value } as Partial<WeeklyTask>;
    patchWeeklyTask(id, patch);
  };

  const deleteWeeklyTask = (id: string) => {
    removeWeeklyTaskById(id, "动作已删除");
  };

  const addWeeklyFocus = (field: keyof Pick<WeeklyPlan, "focusDirections" | "focusCities" | "focusCompanies" | "practiceThemes">, value: string) => {
    if (!value.trim()) return;
    const nextValues = [...weeklyPlan[field], value.trim()];
    setWeeklyPlan((plan) => ({ ...plan, [field]: [...plan[field], value.trim()] }));
    syncWeeklyPlanPatch({ [field]: nextValues });
    onMessage("训练重点已添加");
  };

  const createWeeklyTask = (task: Omit<WeeklyTask, "id" | "status">) => {
    const newTask: WeeklyTask = {
      id: makeId("WT"),
      status: "open",
      ...task,
      level: task.level ?? "P2",
    };
    prependWeeklyTask(newTask, { message: "任务已添加" });
  };

  const updateWeeklyTargetApplications = (targetApplications: number) => {
    const nextTarget = Number.isFinite(targetApplications) ? Math.max(0, Math.round(targetApplications)) : 0;
    setWeeklyPlan((plan) => ({ ...plan, targetApplications: nextTarget }));
    onInsightsInvalidate();
    syncWeeklyPlanPatch({ targetApplications: nextTarget });
  };

  const updateWeeklyTargetDraft = (value: string) => {
    setWeeklyTargetDraft(value);
    if (value.trim() === "") return;
    updateWeeklyTargetApplications(Number(value));
  };

  const restoreWeeklyTargetDraft = () => {
    if (weeklyTargetDraft.trim() === "") setWeeklyTargetDraft(String(weeklyTargetApplications));
  };

  return {
    weeklyPlan,
    weeklyTargetDraft,
    weeklyTargetApplications,
    hasWeeklyTarget,
    weeklyTaskGroups,
    visibleTrainingTaskCount,
    weeklyInterviewPage,
    weeklyPracticePage,
    weeklyTaskForm,
    replaceWeeklyPlan,
    refreshWeeklyPlan,
    setWeeklyInterviewPage,
    setWeeklyPracticePage,
    openWeeklyTaskDialog,
    openWeeklyTaskEditDialog,
    updateWeeklyTaskForm,
    closeWeeklyTaskDialog,
    submitWeeklyTaskForm,
    updateWeeklyTask,
    deleteWeeklyTask,
    addWeeklyFocus,
    createWeeklyTask,
    removeWeeklyTasksByEntity,
    updateWeeklyTargetDraft,
    restoreWeeklyTargetDraft,
  };
}
