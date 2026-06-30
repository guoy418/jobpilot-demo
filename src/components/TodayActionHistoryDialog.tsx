import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import type { TodayAction } from "../selectors";
import type { TodayActionHistoryItem, TodayActionHistorySource, TodayActionHistoryStatus, TodayCreatedRecordKind } from "../types";
import { localDateKey } from "../utils/date";
import {
  buildTodayActionHistoryMonthCells,
  createTodayActionHistoryCalendarState,
  formatDaySummaryLabel,
  formatTodayActionHistoryDateTitle,
  getVisibleHistoryItemsForDate,
  isFutureTodayActionHistoryDateKey,
  isTodayActionHistoryActionItem,
  isTodayCreatedRecordHistoryItem,
  normalizeTodayActionHistory,
  summarizeTodayActionHistoryDate,
} from "../utils/todayActionHistory";

type BackdropHandler = (event: MouseEvent<HTMLDivElement>) => void;

const sourceGroups: Array<{ source: TodayActionHistorySource; label: string }> = [
  { source: "opportunity", label: "岗位推进" },
  { source: "interview", label: "面试复盘" },
  { source: "weekly", label: "训练计划" },
];

const createdRecordGroups: Array<{ recordType: TodayCreatedRecordKind; label: string }> = [
  { recordType: "opportunity", label: "岗位" },
  { recordType: "interview", label: "面试复盘" },
  { recordType: "answer", label: "答案卡" },
  { recordType: "weekly", label: "训练任务" },
  { recordType: "resume", label: "简历版本" },
];

const statusLabel: Record<TodayActionHistoryStatus, string> = {
  shown: "未处理",
  completed: "已完成",
  dismissed: "未处理",
};

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

const formatTimestamp = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
};

const formatHistoryOverviewLabel = (summary: ReturnType<typeof summarizeTodayActionHistoryDate>) => {
  const parts: string[] = [];
  if (summary.actionTotal > 0) parts.push(`${summary.actionTotal} 个行动`);
  if (summary.created > 0) parts.push(`${summary.created} 新建`);
  return parts.length ? parts.join(" · ") : "暂无记录";
};

const formatDaySummaryAriaLabel = (summary: ReturnType<typeof summarizeTodayActionHistoryDate>) => {
  const parts: string[] = [];
  if (summary.actionTotal > 0) parts.push(`${summary.actionTotal} 个行动提醒`);
  if (summary.created > 0) parts.push(`${summary.created} 条新建记录`);
  return parts.length ? parts.join("，") : "无行动提醒或新建记录";
};

export function TodayActionHistoryDialog({
  historyItems,
  todayActions,
  onClose,
  onBackdropMouseDown,
  onBackdropClick,
}: {
  historyItems: TodayActionHistoryItem[];
  todayActions: TodayAction[];
  onClose: () => void;
  onBackdropMouseDown: BackdropHandler;
  onBackdropClick: BackdropHandler;
}) {
  const todayKey = localDateKey();
  const initialCalendarState = useMemo(() => createTodayActionHistoryCalendarState(todayKey), [todayKey]);
  const [selectedDate, setSelectedDate] = useState(initialCalendarState.selectedDate);
  const [visibleMonth, setVisibleMonth] = useState(initialCalendarState.visibleMonth);
  const safeSelectedDate = selectedDate > todayKey ? todayKey : selectedDate;
  const visibleHistoryItems = useMemo(
    () => normalizeTodayActionHistory(historyItems, todayKey),
    [historyItems, todayKey],
  );
  const visibleCalendarItems = useMemo(() => {
    const currentTodayItems = getVisibleHistoryItemsForDate(visibleHistoryItems, todayKey, todayKey, todayActions).filter(isTodayActionHistoryActionItem);
    return [
      ...visibleHistoryItems.filter((item) => !(isTodayActionHistoryActionItem(item) && item.date === todayKey)),
      ...currentTodayItems,
    ];
  }, [visibleHistoryItems, todayActions, todayKey]);
  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, TodayActionHistoryItem[]>();
    visibleCalendarItems.forEach((item) => grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]));
    return grouped;
  }, [visibleCalendarItems]);
  const monthCells = useMemo(() => buildTodayActionHistoryMonthCells(visibleMonth), [visibleMonth]);
  const selectedItems = useMemo(
    () => getVisibleHistoryItemsForDate(visibleHistoryItems, safeSelectedDate, todayKey, todayActions),
    [visibleHistoryItems, safeSelectedDate, todayActions, todayKey],
  );
  const selectedActionItems = selectedItems.filter(isTodayActionHistoryActionItem);
  const selectedCreatedItems = selectedItems.filter(isTodayCreatedRecordHistoryItem);
  const selectedSummary = summarizeTodayActionHistoryDate(selectedItems);
  const visibleSummary = summarizeTodayActionHistoryDate(visibleCalendarItems);
  const isSelectedToday = safeSelectedDate === todayKey;

  useEffect(() => {
    if (selectedDate > todayKey) setSelectedDate(todayKey);
  }, [selectedDate, todayKey]);

  const moveMonth = (offset: number) => {
    setVisibleMonth((date) => new Date(date.getFullYear(), date.getMonth() + offset, 1));
  };

  return (
    <div
      className="asset-preview today-history-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="today-history-title"
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <div className="asset-preview-panel today-history-panel" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close-button" onClick={onClose} aria-label="关闭">
          <X size={16} />
        </button>
        <div className="section-title">
          <h2 id="today-history-title">行动历史回顾</h2>
          <em>{formatHistoryOverviewLabel(visibleSummary)}</em>
        </div>

        <div className="today-history-layout">
          <section className="today-history-calendar" aria-label="今日行动回顾日历">
            <div className="today-history-monthbar">
              <button className="secondary-button compact-button" onClick={() => moveMonth(-1)} aria-label="上个月">
                <ChevronLeft size={14} />
              </button>
              <strong>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(visibleMonth)}</strong>
              <button className="secondary-button compact-button" onClick={() => moveMonth(1)} aria-label="下个月">
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="today-history-weekdays">
              {weekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="today-history-grid">
              {monthCells.map((cell) => {
                const isFuture = isFutureTodayActionHistoryDateKey(cell.dateKey, todayKey);
                const dateItems = isFuture ? [] : (itemsByDate.get(cell.dateKey) ?? []);
                const summary = summarizeTodayActionHistoryDate(dateItems);
                const summaryLabel = formatDaySummaryLabel(summary);
                const isSelected = !isFuture && cell.dateKey === safeSelectedDate;
                const statusClass =
                  summary.total === 0
                    ? "empty"
                    : summary.actionTotal === 0
                      ? "created"
                      : summary.resolved === summary.actionTotal
                      ? "resolved"
                      : summary.resolved > 0
                        ? "partial"
                        : "shown";
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`today-history-day ${cell.isCurrentMonth ? "" : "outside-month"} ${isFuture ? "future-day" : ""} ${isSelected ? "active-history-day" : ""} history-day-${statusClass}`}
                    onClick={() => {
                      if (!isFuture) setSelectedDate(cell.dateKey);
                    }}
                    disabled={isFuture}
                    aria-pressed={isFuture ? undefined : isSelected}
                    aria-label={isFuture ? `${cell.dateKey}，未来日期不可选择` : `${cell.dateKey}，${formatDaySummaryAriaLabel(summary)}`}
                  >
                    <span>{cell.day}</span>
                    {summaryLabel ? <em>{summaryLabel}</em> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="today-history-detail" aria-label={`${safeSelectedDate} 今日行动详情`}>
            <div className="today-history-detail-header">
              <div>
                <span className="eyebrow">{safeSelectedDate}</span>
                <h3>{formatTodayActionHistoryDateTitle(safeSelectedDate)}</h3>
              </div>
              <div className="today-history-stats">
                <span>{selectedSummary.actionTotal} 个行动</span>
                {selectedSummary.completed > 0 ? <span>{selectedSummary.completed} 已完成</span> : null}
                <span>{selectedSummary.shown} 未处理</span>
                {selectedSummary.created > 0 ? <span>{selectedSummary.created} 新建</span> : null}
              </div>
            </div>

            <section className="today-history-source today-history-created-section">
              <h4>
                当天新建记录
                <span>{selectedCreatedItems.length}</span>
              </h4>
              {selectedCreatedItems.length > 0 ? (
                <div className="today-history-created-groups">
                  {createdRecordGroups.map((group) => {
                    const groupItems = selectedCreatedItems.filter((item) => item.recordType === group.recordType);
                    if (groupItems.length === 0) return null;
                    return (
                      <div className="today-history-created-group" key={group.recordType}>
                        <div className="today-history-created-label">
                          <span>{group.label}</span>
                          <em>{groupItems.length}</em>
                        </div>
                        <div className="today-history-item-list">
                          {groupItems.map((item) => (
                            <article className="today-history-item today-history-created-item" key={item.id}>
                              <div className="today-history-item-header">
                                <span className="source-chip">{item.recordTypeLabel}</span>
                              </div>
                              <h5>{item.title}</h5>
                              {item.detail ? <p>{item.detail}</p> : null}
                              <div className="today-history-time">
                                <span>新建 {formatTimestamp(item.createdAt)}</span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="today-history-empty-source">功能开启后新建的岗位、面试、答案、训练和简历会显示在这里。</p>
              )}
            </section>

            <section className="today-history-source today-history-action-section">
              <h4>
                当天行动提醒
                <span>{selectedSummary.actionTotal}</span>
              </h4>
              {selectedSummary.actionTotal > 0 ? (
                sourceGroups.map((group) => {
                  const groupItems = selectedActionItems.filter((item) => item.source === group.source);
                  if (groupItems.length === 0) return null;
                  return (
                    <section className={`today-history-source today-source-${group.source}`} key={group.source}>
                      <h4>
                        {group.label}
                        <span>{groupItems.length}</span>
                      </h4>
                      <div className="today-history-item-list">
                        {groupItems.map((item) => (
                          <article className="today-history-item" key={item.id}>
                            <div className="today-history-item-header">
                              <span className={`priority ${item.level.toLowerCase()}`}>{item.level}</span>
                              <span className="source-chip">{item.sourceLabel ?? group.label}</span>
                              <span className={`today-history-status history-status-${item.status === "dismissed" ? "shown" : item.status}`}>{statusLabel[item.status]}</span>
                            </div>
                            <h5>{item.title}</h5>
                            {item.detail ? <p>{item.detail}</p> : null}
                            <div className="today-history-time">
                              <span>出现 {formatTimestamp(item.shownAt)}</span>
                              {item.resolvedAt ? <span>处理 {formatTimestamp(item.resolvedAt)}</span> : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })
              ) : (
                <p className="today-history-empty-source">
                  {isSelectedToday
                    ? "今天还没有行动提醒；历史会从已有提醒开始顺延未处理项，并记录后续新出现的提醒。"
                    : "这天没有行动提醒。历史功能上线前、或没有任何已记录提醒作为起点的日期不会回填。"}
                </p>
              )}
            </section>
          </section>
        </div>
      </div>
    </div>
  );
}
