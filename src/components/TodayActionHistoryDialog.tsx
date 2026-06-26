import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import type { TodayActionHistoryItem, TodayActionHistorySource, TodayActionHistoryStatus, TodayCreatedRecordKind } from "../types";
import { localDateKey } from "../utils/date";
import {
  getTodayActionHistoryForDate,
  isTodayActionHistoryActionItem,
  isTodayCreatedRecordHistoryItem,
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
  dismissed: "已跳过",
};

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

const parseDateKey = (dateKey: string) => {
  const [year = "0", month = "1", day = "1"] = dateKey.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const formatDateTitle = (dateKey: string) =>
  new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(parseDateKey(dateKey));

const formatTimestamp = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
};

const buildMonthCells = (monthDate: Date) => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      dateKey: localDateKey(date),
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
    };
  });
};

export function TodayActionHistoryDialog({
  historyItems,
  onClose,
  onBackdropMouseDown,
  onBackdropClick,
}: {
  historyItems: TodayActionHistoryItem[];
  onClose: () => void;
  onBackdropMouseDown: BackdropHandler;
  onBackdropClick: BackdropHandler;
}) {
  const newestDate = useMemo(() => [...new Set(historyItems.map((item) => item.date))].sort().at(-1) ?? localDateKey(), [historyItems]);
  const [selectedDate, setSelectedDate] = useState(newestDate);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateKey(newestDate));
  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, TodayActionHistoryItem[]>();
    historyItems.forEach((item) => grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]));
    return grouped;
  }, [historyItems]);
  const monthCells = useMemo(() => buildMonthCells(visibleMonth), [visibleMonth]);
  const selectedItems = useMemo(() => getTodayActionHistoryForDate(historyItems, selectedDate), [historyItems, selectedDate]);
  const selectedActionItems = selectedItems.filter(isTodayActionHistoryActionItem);
  const selectedCreatedItems = selectedItems.filter(isTodayCreatedRecordHistoryItem);
  const selectedSummary = summarizeTodayActionHistoryDate(selectedItems);

  useEffect(() => {
    if (itemsByDate.has(selectedDate)) return;
    setSelectedDate(newestDate);
    setVisibleMonth(parseDateKey(newestDate));
  }, [itemsByDate, newestDate, selectedDate]);

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
          <em>{`${historyItems.length} 条记录`}</em>
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
                const dateItems = itemsByDate.get(cell.dateKey) ?? [];
                const summary = summarizeTodayActionHistoryDate(dateItems);
                const isSelected = cell.dateKey === selectedDate;
                const statusClass =
                  summary.total === 0
                    ? "empty"
                    : summary.actionTotal === 0
                      ? "created"
                      : summary.completed + summary.dismissed === summary.actionTotal
                      ? "resolved"
                      : summary.completed > 0 || summary.dismissed > 0
                        ? "partial"
                        : "shown";
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`today-history-day ${cell.isCurrentMonth ? "" : "outside-month"} ${isSelected ? "active-history-day" : ""} history-day-${statusClass}`}
                    onClick={() => setSelectedDate(cell.dateKey)}
                    aria-pressed={isSelected}
                    aria-label={`${cell.dateKey}，${summary.total} 条记录`}
                  >
                    <span>{cell.day}</span>
                    {summary.total > 0 ? <em>{summary.total}条</em> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="today-history-detail" aria-label={`${selectedDate} 今日行动详情`}>
            <div className="today-history-detail-header">
              <div>
                <span className="eyebrow">{selectedDate}</span>
                <h3>{formatDateTitle(selectedDate)}</h3>
              </div>
              <div className="today-history-stats">
                {selectedSummary.actionTotal > 0 ? (
                  <>
                    <span>{selectedSummary.completed} 已完成</span>
                    {selectedSummary.dismissed > 0 ? <span>{selectedSummary.dismissed} 已跳过</span> : null}
                    <span>{selectedSummary.shown} 未处理</span>
                  </>
                ) : (
                  <span>0 条行动</span>
                )}
              </div>
            </div>

            {selectedCreatedItems.length > 0 ? (
              <section className="today-history-source today-history-created-section">
                <h4>
                  今日新建
                  <span>{selectedCreatedItems.length}</span>
                </h4>
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
              </section>
            ) : null}

            <section className="today-history-source today-history-action-section">
              <h4>
                行动回顾
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
                              <span className={`today-history-status history-status-${item.status}`}>{statusLabel[item.status]}</span>
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
                <p className="today-history-empty-source">这天没有行动提醒。</p>
              )}
            </section>
          </section>
        </div>
      </div>
    </div>
  );
}
