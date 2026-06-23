import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileAudio,
  Folder,
  FolderOpen,
  Library,
  PanelRight,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type CSSProperties, type DragEvent } from "react";
import { ListPager, PageIntro, ReviewBlock, SectionTitle } from "../components/AppPrimitives";
import type { AnswerCard, AnswerCategory } from "../types";

export type AnswerCategoryEditorState =
  | {
      mode: "create";
      parentId: string;
      name: string;
    }
  | {
      mode: "rename";
      categoryId: string;
      name: string;
    };

export type AnswerView = "list" | "detail";

export type AnswerCategoryOption = {
  category: AnswerCategory;
  label: string;
};

export type AnswerUpdateField = keyof Pick<AnswerCard, "question" | "type" | "framework" | "answer" | "relatedRoles" | "practiceStatus" | "status" | "categoryId">;

type AnswersPageProps = {
  answerCards: AnswerCard[];
  answerCategories: AnswerCategory[];
  rootAnswerCategories: AnswerCategory[];
  answerCategoryChildren: Map<string, AnswerCategory[]>;
  answerCategoryById: Map<string, AnswerCategory>;
  answerCategoryOptions: AnswerCategoryOption[];
  answerCategoryEditor: AnswerCategoryEditorState | null;
  openAnswerCategoryMenuId: string;
  expandedAnswerCategoryIds: Set<string>;
  answerCategoryDropTargetId: string;
  answerCategorySidebarCollapsed: boolean;
  answerView: AnswerView;
  selectedAnswer: AnswerCard;
  selectedAnswerCategory: AnswerCategory;
  selectedAnswerCategoryLabel: string;
  selectedAnswerCategoryTotal: number;
  isAllAnswerCategorySelected: boolean;
  filteredAnswerCards: AnswerCard[];
  visibleAnswerCards: AnswerCard[];
  safeAnswerPage: number;
  answerPageCount: number;
  draggedAnswerCardId: string;
  randomPracticeCard?: AnswerCard;
  randomPracticeSpinning: boolean;
  randomPracticeReveal: boolean;
  resolveAnswerCategoryId: (card: AnswerCard) => string;
  onSelectAllCategory: () => void;
  onSelectCategory: (categoryId: string) => void;
  onCreateCategory: (parentId?: string) => void;
  onRenameCategory: (category: AnswerCategory) => void;
  onDeleteCategoryRequest: (category: AnswerCategory) => void;
  onToggleCategoryExpanded: (categoryId: string) => void;
  onToggleCategoryMenu: (categoryId: string) => void;
  onCategoryEditorNameChange: (name: string) => void;
  onCommitCategoryEditor: () => void;
  onCancelCategoryEditor: () => void;
  onAnswerCategoryDragOver: (event: DragEvent<HTMLDivElement>, categoryId: string) => void;
  onAnswerCategoryDragLeave: (event: DragEvent<HTMLDivElement>, categoryId: string) => void;
  onAnswerCategoryDrop: (event: DragEvent<HTMLDivElement>, categoryId: string) => void;
  onAnswerCardDragStart: (event: DragEvent<HTMLButtonElement>, card: AnswerCard) => void;
  onAnswerCardDragEnd: () => void;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onOpenComposer: () => void;
  onStartRandomPractice: () => void;
  onToggleRandomPracticeReveal: () => void;
  onOpenAnswerCard: (id: string) => void;
  onGoToInterviews: () => void;
  onAnswerPageChange: (page: number) => void;
  onAnswerViewChange: (view: AnswerView) => void;
  onUpdateSelectedAnswer: (field: AnswerUpdateField, value: string) => void;
  onAddSelectedAnswerToPractice: () => void;
  onDeleteSelectedAnswerRequest: () => void;
};

export function AnswersPage({
  answerCards,
  answerCategories,
  rootAnswerCategories,
  answerCategoryChildren,
  answerCategoryById,
  answerCategoryOptions,
  answerCategoryEditor,
  openAnswerCategoryMenuId,
  expandedAnswerCategoryIds,
  answerCategoryDropTargetId,
  answerCategorySidebarCollapsed,
  answerView,
  selectedAnswer,
  selectedAnswerCategory,
  selectedAnswerCategoryLabel,
  selectedAnswerCategoryTotal,
  isAllAnswerCategorySelected,
  filteredAnswerCards,
  visibleAnswerCards,
  safeAnswerPage,
  answerPageCount,
  draggedAnswerCardId,
  randomPracticeCard,
  randomPracticeSpinning,
  randomPracticeReveal,
  resolveAnswerCategoryId,
  onSelectAllCategory,
  onSelectCategory,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategoryRequest,
  onToggleCategoryExpanded,
  onToggleCategoryMenu,
  onCategoryEditorNameChange,
  onCommitCategoryEditor,
  onCancelCategoryEditor,
  onAnswerCategoryDragOver,
  onAnswerCategoryDragLeave,
  onAnswerCategoryDrop,
  onAnswerCardDragStart,
  onAnswerCardDragEnd,
  onSidebarCollapsedChange,
  onOpenComposer,
  onStartRandomPractice,
  onToggleRandomPracticeReveal,
  onOpenAnswerCard,
  onGoToInterviews,
  onAnswerPageChange,
  onAnswerViewChange,
  onUpdateSelectedAnswer,
  onAddSelectedAnswerToPractice,
  onDeleteSelectedAnswerRequest,
}: AnswersPageProps) {
  const renderAnswerCategoryEditor = (matches: boolean, depth: number) => {
    if (!answerCategoryEditor || !matches) return null;
    const label = answerCategoryEditor.mode === "create" ? "新增分类" : "重命名分类";
    return (
      <div className="answer-category-inline-editor" style={{ "--category-depth": depth } as CSSProperties}>
        <span>{label}</span>
        <input
          autoFocus
          value={answerCategoryEditor.name}
          onChange={(event) => onCategoryEditorNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommitCategoryEditor();
            if (event.key === "Escape") onCancelCategoryEditor();
          }}
          placeholder="分类名称"
        />
        <div>
          <button className="primary-button compact-button" onClick={onCommitCategoryEditor}>
            保存
          </button>
          <button className="ghost-button compact-button" onClick={onCancelCategoryEditor}>
            取消
          </button>
        </div>
      </div>
    );
  };

  const renderAnswerCategoryTree = (category: AnswerCategory, depth = 0) => {
    const children = answerCategoryChildren.get(category.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = expandedAnswerCategoryIds.has(category.id);
    const active = !isAllAnswerCategorySelected && selectedAnswerCategory.id === category.id;
    const dropTarget = answerCategoryDropTargetId === category.id;
    const FolderIcon = hasChildren && expanded ? FolderOpen : Folder;

    return (
      <div key={category.id} className="answer-category-node">
        <div
          className={`answer-category-row ${active ? "active" : ""} ${dropTarget ? "drop-target" : ""}`}
          style={{ "--category-depth": depth } as CSSProperties}
          onDragOver={(event) => onAnswerCategoryDragOver(event, category.id)}
          onDragLeave={(event) => onAnswerCategoryDragLeave(event, category.id)}
          onDrop={(event) => onAnswerCategoryDrop(event, category.id)}
        >
          <button
            className="answer-category-toggle"
            onClick={() => hasChildren && onToggleCategoryExpanded(category.id)}
            disabled={!hasChildren}
            aria-label={expanded ? "收起分类" : "展开分类"}
          >
            {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}
          </button>
          <button className="answer-category-main" aria-current={active ? "true" : undefined} onClick={() => onSelectCategory(category.id)} title="拖入答案卡可移动到此分类">
            <FolderIcon size={16} />
            <span>{category.name}</span>
            {category.system ? <em>系统</em> : null}
          </button>
          {!category.system ? (
            <div className="answer-category-actions">
              <button className="answer-category-icon-action" onClick={() => onCreateCategory(category.id)} aria-label={`在${category.name}下新增子分类`}>
                <Plus size={13} />
              </button>
              <div className="answer-category-menu-wrap">
                <button
                  className="answer-category-icon-action"
                  onClick={() => onToggleCategoryMenu(category.id)}
                  aria-label={`${category.name}更多操作`}
                  aria-expanded={openAnswerCategoryMenuId === category.id}
                >
                  ⋮
                </button>
                {openAnswerCategoryMenuId === category.id ? (
                  <div className="answer-category-menu">
                    <button onClick={() => onRenameCategory(category)}>
                      <Pencil size={13} />
                      <span>重命名</span>
                    </button>
                    <button
                      className="answer-category-menu-danger"
                      onClick={() => onDeleteCategoryRequest(category)}
                    >
                      <Trash2 size={13} />
                      <span>删除</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {renderAnswerCategoryEditor(answerCategoryEditor?.mode === "rename" && answerCategoryEditor.categoryId === category.id, depth)}
        {renderAnswerCategoryEditor(answerCategoryEditor?.mode === "create" && answerCategoryEditor.parentId === category.id, depth + 1)}
        {hasChildren && expanded ? children.map((child) => renderAnswerCategoryTree(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <section className={`answer-workspace ${answerCategorySidebarCollapsed ? "answer-workspace-collapsed" : ""}`}>
      {!answerCategorySidebarCollapsed ? (
        <div className="surface answer-category-pane">
          <div className="answer-category-header">
            <SectionTitle label="分类" title="答案文件夹" action={`${answerCategories.length} 个`} />
            <button className="answer-category-icon-action" onClick={() => onSidebarCollapsedChange(true)} aria-label="收起分类侧栏">
              <PanelRight size={15} />
            </button>
          </div>
          <div className="answer-category-tree">
            <div className={`answer-category-row answer-category-all-row ${isAllAnswerCategorySelected ? "active" : ""}`}>
              <span className="answer-category-toggle" />
              <button className="answer-category-main" aria-current={isAllAnswerCategorySelected ? "true" : undefined} onClick={onSelectAllCategory}>
                <Library size={16} />
                <span>全部答案</span>
                <strong>{answerCards.length}</strong>
              </button>
              <div className="answer-category-actions">
                <button className="answer-category-icon-action" onClick={() => onCreateCategory()} aria-label="新增顶层分类">
                  <Plus size={13} />
                </button>
              </div>
            </div>
            {renderAnswerCategoryEditor(answerCategoryEditor?.mode === "create" && answerCategoryEditor.parentId === "", 0)}
            {rootAnswerCategories.map((category) => renderAnswerCategoryTree(category))}
          </div>
        </div>
      ) : null}
      {answerView === "list" ? (
        <div className="surface answer-list-pane answer-home-pane paginated-pane">
          <div className="paginated-pane-header">
            {answerCategorySidebarCollapsed ? (
              <button className="secondary-button compact-button answer-category-reopen" onClick={() => onSidebarCollapsedChange(false)}>
                <PanelRight size={14} />
                <span>显示分类</span>
              </button>
            ) : null}
            <PageIntro
              label={selectedAnswerCategoryLabel}
              title="沉淀可复用回答"
              detail="答案卡可以手动添加，也可以从面试复盘生成；可随机抽练，或加入本周计划形成练习行动。"
              action={`${filteredAnswerCards.length}/${selectedAnswerCategoryTotal} 张卡片`}
            />
            <div className="button-row tight-row">
              <button className="primary-button" onClick={onOpenComposer}>
                <Plus size={16} />
                <span>新增答案卡</span>
              </button>
              <button className="secondary-button answer-random-button" onClick={onStartRandomPractice} disabled={randomPracticeSpinning || filteredAnswerCards.length === 0}>
                <Sparkles size={16} />
                <span>{randomPracticeSpinning ? "抽取中..." : "随机抽练"}</span>
              </button>
              <button className="secondary-button" onClick={onGoToInterviews}>
                <FileAudio size={16} />
                <span>从复盘生成</span>
              </button>
            </div>
          </div>
          <div className="paginated-pane-body">
            {(randomPracticeCard || randomPracticeSpinning) && (
              <div className={`answer-practice-panel ${randomPracticeSpinning ? "is-shuffling" : ""}`}>
                <div className="answer-practice-deck" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="answer-practice-copy">
                  <span className="eyebrow">临时练习</span>
                  <h3>{randomPracticeSpinning ? "正在洗牌抽题..." : randomPracticeCard?.question}</h3>
                  <p>{randomPracticeSpinning ? "从当前答案库里随机挑一张，不会加入本周计划。" : randomPracticeCard?.framework}</p>
                </div>
                {!randomPracticeSpinning && randomPracticeCard ? (
                  <div className="answer-practice-actions">
                    <button className="primary-button compact-button" onClick={onToggleRandomPracticeReveal}>
                      {randomPracticeReveal ? "收起答案" : "显示推荐回答"}
                    </button>
                    <button className="secondary-button compact-button" onClick={onStartRandomPractice}>
                      换一张
                    </button>
                    <button className="ghost-button compact-button" onClick={() => onOpenAnswerCard(randomPracticeCard.id)}>
                      打开卡片
                    </button>
                  </div>
                ) : null}
                {!randomPracticeSpinning && randomPracticeCard && randomPracticeReveal ? (
                  <div className="answer-practice-answer">
                    {randomPracticeCard.answer}
                  </div>
                ) : null}
              </div>
            )}
            <div className="answer-list paginated-pane-content">
              {filteredAnswerCards.length === 0 ? (
                <p className="empty-list-note">没有匹配的答案卡，试试换个关键词。</p>
              ) : (
                visibleAnswerCards.map((card) => (
                  <button
                    className={`answer-card answer-card-button ${selectedAnswer.id === card.id ? "selected-answer" : ""} ${draggedAnswerCardId === card.id ? "is-dragging" : ""}`}
                    key={card.id}
                    draggable
                    title="拖到左侧分类可移动"
                    aria-label={`打开答案卡：${card.question}。可拖到左侧分类移动。`}
                    onDragStart={(event) => onAnswerCardDragStart(event, card)}
                    onDragEnd={onAnswerCardDragEnd}
                    onClick={() => onOpenAnswerCard(card.id)}
                  >
                    <div>
                      <span className="type-pill">{card.type}</span>
                      <h3>{card.question}</h3>
                    </div>
                    <small>
                      {card.status === "DRAFT" ? "草稿" : "可复用"} / {card.practiceStatus}
                    </small>
                    <span className="answer-card-category">{answerCategoryById.get(resolveAnswerCategoryId(card))?.name ?? "尚未归类"}</span>
                    <ChevronRight size={16} />
                  </button>
                ))
              )}
            </div>
          </div>
          <ListPager className="paginated-pane-footer" label="答案卡列表" page={safeAnswerPage} pageCount={answerPageCount} onPageChange={onAnswerPageChange} />
        </div>
      ) : (
        <div className="surface answer-editor answer-detail-pane">
          <div className="interview-detail-nav interview-detail-nav-start">
            {answerCategorySidebarCollapsed ? (
              <button className="secondary-button compact-button answer-category-reopen" onClick={() => onSidebarCollapsedChange(false)}>
                <PanelRight size={14} />
                <span>显示分类</span>
              </button>
            ) : null}
            <button className="ghost-button compact-button" onClick={() => onAnswerViewChange("list")}>
              <ChevronLeft size={14} />
              <span>返回{selectedAnswerCategoryLabel}</span>
            </button>
          </div>
          <SectionTitle
            label={`${selectedAnswer.source} / ${answerCategoryById.get(resolveAnswerCategoryId(selectedAnswer))?.name ?? "尚未归类"}`}
            title={selectedAnswer.question}
            action={selectedAnswer.status === "DRAFT" ? "草稿" : "可复用"}
          />
          <ReviewBlock label="问题" value={selectedAnswer.question} onChange={(value) => onUpdateSelectedAnswer("question", value)} />
          <ReviewBlock label="回答框架" value={selectedAnswer.framework} onChange={(value) => onUpdateSelectedAnswer("framework", value)} />
          <ReviewBlock label="推荐回答" value={selectedAnswer.answer} onChange={(value) => onUpdateSelectedAnswer("answer", value)} />
          <ReviewBlock label="适用岗位" value={selectedAnswer.relatedRoles} onChange={(value) => onUpdateSelectedAnswer("relatedRoles", value)} />
          <div className="inline-controls">
            <label>
              <span>卡片状态</span>
              <select value={selectedAnswer.status} onChange={(event) => onUpdateSelectedAnswer("status", event.target.value)}>
                <option value="DRAFT">草稿</option>
                <option value="ACTIVE">可复用</option>
              </select>
            </label>
            <label>
              <span>练习状态</span>
              <select value={selectedAnswer.practiceStatus} onChange={(event) => onUpdateSelectedAnswer("practiceStatus", event.target.value)}>
                <option value="薄弱">薄弱</option>
                <option value="中等">中等</option>
                <option value="熟练">熟练</option>
              </select>
            </label>
            <label>
              <span>移动到</span>
              <select value={resolveAnswerCategoryId(selectedAnswer)} onChange={(event) => onUpdateSelectedAnswer("categoryId", event.target.value)}>
                {answerCategoryOptions.map(({ category, label }) => (
                  <option key={category.id} value={category.id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={onAddSelectedAnswerToPractice}>
              <ClipboardList size={16} />
              <span>加入本周计划</span>
            </button>
          </div>

          <div className="danger-zone">
            <span>危险操作</span>
            <button className="destructive-button" onClick={onDeleteSelectedAnswerRequest}>
              删除当前卡
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
