import { useEffect, useMemo, useRef, useState } from "react";
import { shouldShowUnimplementedTools } from "../../app/debugSettings.js";
import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import { SearchControl } from "../SearchControl.jsx";
import { PagesContextPanel } from "./PagesContextPanel.jsx";

const panelTitles = {
  bookmarks: "Segnalibri",
  comments: "Commento 1",
  history: "Storico modifiche",
  pages: "Pagine",
  permissions: "Autorizzazioni file",
  protect: "Proteggi PDF",
  search: "Cerca",
  signatures: "Firma digitale",
};

const PDF_SEARCH_RESULT_BATCH = 24;
const defaultProtectPermissions = {
  accessibility: true,
  annotations: true,
  assemble: true,
  copy: true,
  forms: true,
  modify: true,
  print: true,
};

const readOnlyProtectPermissions = {
  accessibility: true,
  annotations: false,
  assemble: false,
  copy: false,
  forms: false,
  modify: false,
  print: true,
};

const protectPermissionOptions = [
  { key: "print" },
  { key: "modify" },
  { key: "copy" },
  { key: "annotations" },
  { key: "forms" },
  {
    disabled: true,
    helper: "Sempre consentito nei PDF protetti moderni",
    key: "accessibility",
  },
  { key: "assemble" },
];

function getInitialProtectPermissions(viewerState) {
  const details = viewerState?.pdfSecurity?.permissions?.details;
  if (!Array.isArray(details) || details.length === 0) {
    return defaultProtectPermissions;
  }
  const permissions = details.reduce(
    (nextPermissions, detail) => {
      if (detail?.key in nextPermissions) {
        nextPermissions[detail.key] = detail.allowed === true;
      }
      return nextPermissions;
    },
    { ...defaultProtectPermissions, accessibility: true }
  );
  return { ...permissions, accessibility: true };
}

function formatCommentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatHistoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatSecurityDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function getRuntimeHistoryLabel(type, t) {
  const labels = {
    annotation: t("Modifica annotazione"),
    comment: t("Commento"),
    create: t("Nuova annotazione"),
    delete: t("Elimina annotazione"),
    draw: t("Disegno"),
    "free-text": t("Testo"),
    freetext: t("Testo"),
    highlight: t("Evidenziazione"),
    image: t("Immagine"),
    ink: t("Disegno"),
    move: t("Sposta annotazione"),
    "native-redact": t("Redazione nativa"),
    "native-text-edit": t("Modifica testo sorgente"),
    paste: t("Incolla annotazione"),
    resize: t("Ridimensionamento"),
    signature: t("Firma"),
    stamp: t("Timbro"),
  };
  return labels[type] || t("Modifica annotazione");
}

function getHistoryIcon(type) {
  if (type === "document") {
    return "picture_as_pdf";
  }
  if (type === "delete-page") {
    return "delete";
  }
  if (type === "page-organizer") {
    return "drive_file_move";
  }
  if (type === "highlight") {
    return "ink_highlighter";
  }
  if (type === "free-text") {
    return "text_fields";
  }
  if (type === "freetext") {
    return "text_fields";
  }
  if (type === "image") {
    return "image";
  }
  if (type === "stamp") {
    return "approval";
  }
  if (type === "native-redact") {
    return "ink_eraser";
  }
  if (type === "native-text-edit") {
    return "edit_note";
  }
  return "edit";
}

function buildLinearHistoryGraph({
  editHistory,
  revisionEntries,
  runtimeEntries,
  runtimeHistory,
  t,
}) {
  const runtimeIndexById = new Map(
    runtimeEntries.map((entry, index) => [entry.id, index])
  );
  const redoRevisionTimestamp = editHistory?.redoEntry?.timestamp || null;
  const undoRevisionId = editHistory?.undoEntry?.id || null;
  const nodes = [
    ...runtimeEntries.map(entry => {
      const runtimeIndex = runtimeIndexById.get(entry.id);
      const isRuntime = Number.isInteger(runtimeIndex);
      return {
        entry,
        id: `runtime-${entry.id}`,
        isCurrent: isRuntime && runtimeHistory.position === runtimeIndex,
        isFuture: isRuntime && runtimeIndex > runtimeHistory.position,
        label: entry.label || getRuntimeHistoryLabel(entry.type, t),
        timestamp: entry.timestamp || 0,
        track: "runtime",
        type: entry.type,
      };
    }),
    ...revisionEntries.map(entry => ({
      entry,
      id: `revision-${entry.id}`,
      isCurrent: undoRevisionId === entry.id,
      isFuture:
        Boolean(redoRevisionTimestamp) &&
        (entry.timestamp || 0) >= redoRevisionTimestamp,
      label: entry.label,
      timestamp: entry.timestamp || 0,
      track: "revision",
      type: entry.type,
    })),
  ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const hasCurrentNode = nodes.some(node => node.isCurrent);
  nodes.push({
    entry: null,
    id: "history-root-document",
    isCurrent: !hasCurrentNode && !editHistory?.undoEntry,
    isFuture: false,
    label: t("Documento aperto"),
    note: nodes.length ? "" : t("Nessuna modifica registrata"),
    timestamp: 0,
    track: "root",
    type: "document",
  });
  return nodes;
}

function getContextTargetLabel(target, t) {
  const labels = {
    freetext: t("Testo"),
    highlight: t("Evidenziazione"),
    image: t("Immagine"),
    ink: t("Disegno"),
    "native-text": t("Testo sorgente"),
    redaction: t("Redazione"),
    signature: t("Firma"),
    stamp: t("Timbro"),
    text: t("Testo selezionato"),
  };
  return labels[target?.kind] || t("Selezione PDF");
}

function InteractionTargetPanel({
  onAddBookmarkFromSelection,
  onAddCommentToSelection,
  onDeleteSelection,
  onSetTool,
  showUnimplementedTools = false,
  viewerState,
}) {
  const { t } = useTranslation();
  const interactionState = viewerState.viewerInteractionState || {};
  const capabilities = interactionState.capabilities || {};
  const target = interactionState.contextTarget;
  if (!target || target.kind === "page") {
    return null;
  }
  const canAnnotateText = target.kind === "text";
  const canRedact =
    capabilities.canRedact &&
    (target.kind === "text" ||
      target.kind === "native-text" ||
      target.kind === "redaction");
  const policyFacts = {
    hasDocument: Boolean(viewerState.pagesCount),
    loading: viewerState.loading,
    pdfSecurity: viewerState.pdfSecurity,
  };
  const commentPolicy = getPdfActionPolicy("comment", policyFacts, t);
  const highlightPolicy = getPdfActionPolicy("highlight", policyFacts, t);
  const redactPolicy = getPdfActionPolicy("native-redact", policyFacts, t);
  const deletePolicy = getPdfActionPolicy(
    "delete-annotation",
    policyFacts,
    t
  );

  return (
    <div
      className="interaction-target-panel"
      data-context-target-kind={target.kind}
    >
      <div>
        <strong>{getContextTargetLabel(target, t)}</strong>
        <span>
          {t("Pagina {{pageNumber}}", {
            pageNumber: target.pageNumber || viewerState.pageNumber || 1,
          })}
        </span>
      </div>
      <div className="interaction-target-actions">
        {capabilities.canComment ? (
          <button
            aria-label={t("Aggiungi commento")}
            disabled={!onAddCommentToSelection || !commentPolicy.enabled}
            onClick={onAddCommentToSelection}
            title={
              commentPolicy.enabled ? t("Aggiungi commento") : commentPolicy.reason
            }
            type="button"
          >
            <Icon>add_comment</Icon>
          </button>
        ) : null}
        {capabilities.canBookmark ? (
          <button
            aria-label={t("Aggiungi segnalibro")}
            disabled={!onAddBookmarkFromSelection}
            onClick={onAddBookmarkFromSelection}
            title={t("Aggiungi segnalibro")}
            type="button"
          >
            <Icon>bookmark_add</Icon>
          </button>
        ) : null}
        {canAnnotateText && capabilities.canHighlight ? (
          <button
            aria-label={t("Evidenzia")}
            disabled={!onSetTool || !highlightPolicy.enabled}
            onClick={() => onSetTool?.("highlight")}
            title={
              highlightPolicy.enabled ? t("Evidenzia") : highlightPolicy.reason
            }
            type="button"
          >
            <Icon>ink_highlighter</Icon>
          </button>
        ) : null}
        {showUnimplementedTools && canRedact ? (
          <button
            aria-label={t("Redigi")}
            disabled={!onSetTool || !redactPolicy.enabled}
            onClick={() => onSetTool?.("native-redact")}
            title={redactPolicy.enabled ? t("Redigi") : redactPolicy.reason}
            type="button"
          >
            <Icon>ink_eraser</Icon>
          </button>
        ) : null}
        {capabilities.canDelete ? (
          <button
            aria-label={t("Elimina selezione")}
            disabled={!onDeleteSelection || !deletePolicy.enabled}
            onClick={onDeleteSelection}
            title={
              deletePolicy.enabled
                ? t("Elimina selezione")
                : deletePolicy.reason
            }
            type="button"
          >
            <Icon>delete</Icon>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommentsPanel({
  isSearchOpen,
  onCancelPendingComment,
  onGoToComment,
  onSearchClose,
  onSavePendingComment,
  viewerState,
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);
  const commentsState = viewerState.comments || {};
  const comments = commentsState.comments || [];
  const pendingDraft = commentsState.pendingDraft;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleComments = useMemo(() => {
    if (!normalizedQuery) {
      return comments;
    }
    return comments.filter(comment => {
      const pageLabel = t("Pagina {{pageNumber}}", {
        pageNumber: comment.pageNumber,
      });
      return [comment.text, pageLabel, formatCommentDate(comment.updatedAt)]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(normalizedQuery));
    });
  }, [comments, normalizedQuery, t]);
  const hasSearch = Boolean(normalizedQuery);
  const showSearch = isSearchOpen || hasSearch;

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  return (
    <div className="editor-context-content comments-context-panel">
      {showSearch ? (
        <div className="comment-search">
          <Icon>search</Icon>
          <input
            aria-label={t("Cerca nei commenti")}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder={t("Cerca nei commenti")}
            ref={searchInputRef}
            type="search"
            value={searchQuery}
          />
          <button
            aria-label={t("Cancella ricerca")}
            onClick={() => {
              setSearchQuery("");
              onSearchClose?.();
            }}
            type="button"
          >
            <Icon>close</Icon>
          </button>
        </div>
      ) : null}
      {hasSearch ? (
        <div className="comment-search-summary" role="status">
          {t("{{count}} risultati", { count: visibleComments.length })}
        </div>
      ) : null}
      {pendingDraft ? (
        <form
          className="comment-composer"
          onSubmit={event => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            onSavePendingComment(formData.get("comment")?.toString() || "");
          }}
        >
          <div>
            <strong>{t("Nuovo commento")}</strong>
            <span>{t("Pagina {{pageNumber}}", { pageNumber: pendingDraft.pageNumber })}</span>
          </div>
          <textarea
            aria-label={t("Testo commento")}
            autoFocus
            defaultValue={pendingDraft.text}
            name="comment"
            placeholder={t("Scrivi un commento")}
          ></textarea>
          <div className="comment-composer-actions">
            <button type="button" onClick={onCancelPendingComment}>
              {t("Annulla")}
            </button>
            <button type="submit">{t("Salva")}</button>
          </div>
        </form>
      ) : (
        <div className="comment-panel-hint">
          <Icon>comment</Icon>
          <span>{t("Seleziona testo nel PDF e premi Commento nella toolbar.")}</span>
        </div>
      )}
      {commentsState.status ? (
        <div className="comment-status" role="status">
          {commentsState.status}
        </div>
      ) : null}
      <div className="comment-list" aria-label={t("Commenti nel PDF")}>
        {visibleComments.length ? (
          visibleComments.map(comment => (
            <button
              className={
                comment.id === commentsState.selectedCommentId
                  ? "comment-list-item selected"
                  : "comment-list-item"
              }
              key={comment.id}
              onClick={() => onGoToComment(comment.id)}
              type="button"
            >
              <span className="comment-avatar">
                <Icon>comment</Icon>
              </span>
              <span>
                <strong>{t("Pagina {{pageNumber}}", { pageNumber: comment.pageNumber })}</strong>
                <small>{formatCommentDate(comment.updatedAt)}</small>
                <em>{comment.text}</em>
              </span>
            </button>
          ))
        ) : hasSearch ? (
          <div className="comment-empty">
            <Icon>search_off</Icon>
            <span>{t("Nessun risultato")}</span>
          </div>
        ) : (
          <div className="comment-empty">
            <Icon>speaker_notes_off</Icon>
            <span>{t("Nessun commento nel PDF.")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function bookmarkCanNavigate(bookmark) {
  return Boolean(
    bookmark?.destination || bookmark?.dest || bookmark?.action || bookmark?.url
  );
}

function BookmarkRow({
  bookmark,
  level,
  onDeleteBookmark,
  onGoToBookmark,
  onUpdateBookmarkTitle,
}) {
  const { t } = useTranslation();
  const clickTimerRef = useRef(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(bookmark.title);
  const hasChildren = bookmark.children?.length > 0;
  const isActionable = bookmarkCanNavigate(bookmark);

  useEffect(() => {
    setDraftTitle(bookmark.title);
  }, [bookmark.title]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  function navigateToBookmark() {
    onGoToBookmark?.(bookmark);
  }

  function handleBookmarkClick() {
    if (!bookmark.custom) {
      navigateToBookmark();
      return;
    }
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      navigateToBookmark();
    }, 220);
  }

  function handleBookmarkDoubleClick() {
    if (!bookmark.custom) {
      return;
    }
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setIsEditing(true);
  }

  function submitTitle(event) {
    event.preventDefault();
    const nextTitle = draftTitle.trim();
    if (nextTitle) {
      onUpdateBookmarkTitle?.(bookmark.id, nextTitle);
      setIsEditing(false);
    }
  }

  return (
    <div className="bookmark-row-group">
      <div className="bookmark-row-shell">
        <button
          className="bookmark-row"
          disabled={!isActionable}
          onClick={handleBookmarkClick}
          onDoubleClick={handleBookmarkDoubleClick}
          style={{ paddingInlineStart: `${8 + Math.min(level, 4) * 14}px` }}
          type="button"
        >
          <Icon>
            {hasChildren
              ? "subdirectory_arrow_right"
              : bookmark.custom
                ? "bookmark_added"
                : "bookmark"}
          </Icon>
          <span className="bookmark-row-title">{bookmark.title}</span>
          {bookmark.pageNumber ? (
            <span className="bookmark-page">{bookmark.pageNumber}</span>
          ) : null}
        </button>
        {bookmark.custom ? (
          <button
            aria-label={t("Modifica segnalibro")}
            className="bookmark-edit-button"
            onClick={() => setIsEditing(true)}
            title={t("Modifica segnalibro")}
            type="button"
          >
            <Icon>edit</Icon>
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <form className="bookmark-edit-form" onSubmit={submitTitle}>
          <input
            aria-label={t("Descrizione segnalibro")}
            onChange={event => setDraftTitle(event.target.value)}
            value={draftTitle}
          />
          <div className="bookmark-edit-actions">
            <button aria-label={t("Salva")} type="submit">
              <Icon>check</Icon>
            </button>
            <button
              aria-label={t("Annulla modifica")}
              onClick={() => {
                setDraftTitle(bookmark.title);
                setIsEditing(false);
              }}
              type="button"
            >
              <Icon>close</Icon>
            </button>
            <button
              aria-label={t("Elimina segnalibro")}
              onClick={() => onDeleteBookmark?.(bookmark.id)}
              type="button"
            >
              <Icon>delete</Icon>
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function BookmarkRows({
  bookmarks,
  level = 0,
  onDeleteBookmark,
  onGoToBookmark,
  onUpdateBookmarkTitle,
}) {
  return bookmarks.map(bookmark => {
    return (
      <div className="bookmark-row-group" key={bookmark.id}>
        <BookmarkRow
          bookmark={bookmark}
          level={level}
          onDeleteBookmark={onDeleteBookmark}
          onGoToBookmark={onGoToBookmark}
          onUpdateBookmarkTitle={onUpdateBookmarkTitle}
        />
        {bookmark.children?.length ? (
          <BookmarkRows
            bookmarks={bookmark.children}
            level={level + 1}
            onDeleteBookmark={onDeleteBookmark}
            onGoToBookmark={onGoToBookmark}
            onUpdateBookmarkTitle={onUpdateBookmarkTitle}
          />
        ) : null}
      </div>
    );
  });
}

function BookmarksPanel({
  onDeleteBookmark,
  onGoToBookmark,
  onUpdateBookmarkTitle,
  viewerState,
}) {
  const { t } = useTranslation();
  const bookmarks = viewerState.bookmarks || {};
  const items = bookmarks.items || [];
  const status = bookmarks.status || "idle";

  if ((status === "idle" || status === "loading") && !items.length) {
    return (
      <div className="editor-context-content bookmarks-context-panel">
        <div className="comment-empty">
          <Icon>hourglass_empty</Icon>
          <span>{t("Caricamento segnalibri...")}</span>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="editor-context-content bookmarks-context-panel">
        <div className="comment-empty">
          <Icon>bookmark_remove</Icon>
          <span>{t("Segnalibri non disponibili.")}</span>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="editor-context-content bookmarks-context-panel">
        <div className="comment-empty">
          <Icon>bookmark_remove</Icon>
          <span>{t("Nessun segnalibro nel PDF.")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-context-content bookmarks-context-panel">
      <BookmarkRows
        bookmarks={items}
        onDeleteBookmark={onDeleteBookmark}
        onGoToBookmark={onGoToBookmark}
        onUpdateBookmarkTitle={onUpdateBookmarkTitle}
      />
    </div>
  );
}

function PdfSearchPanel({ onGoToSearchResult, onSearch, viewerState }) {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  const loadMoreRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(PDF_SEARCH_RESULT_BATCH);
  const findState = viewerState.find || {};
  const current = findState.matchesCount?.current ?? 0;
  const results = findState.results || [];
  const total = findState.matchesCount?.total ?? 0;
  const query = findState.rawQuery || "";
  const visibleResults = results.slice(0, visibleCount);
  const hasMoreResults = visibleCount < results.length;

  useEffect(() => {
    setVisibleCount(PDF_SEARCH_RESULT_BATCH);
  }, [query, total]);

  useEffect(() => {
    if (!hasMoreResults) {
      return undefined;
    }
    const sentinel = loadMoreRef.current;
    if (!sentinel) {
      return undefined;
    }
    if (!window.IntersectionObserver) {
      setVisibleCount(results.length);
      return undefined;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisibleCount(count =>
            Math.min(count + PDF_SEARCH_RESULT_BATCH, results.length)
          );
        }
      },
      {
        root: panelRef.current,
        rootMargin: "80px 0px",
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreResults, results.length, visibleCount]);

  return (
    <div
      className="editor-context-content pdf-search-context-panel"
      ref={panelRef}
    >
      <SearchControl
        disabled={!viewerState.pagesCount}
        findState={findState}
        onSearch={onSearch}
      />
      {query ? (
        <div className="pdf-search-summary" role="status">
          {total > 0
            ? t("{{count}} risultati", { count: total })
            : t("Nessun risultato")}
        </div>
      ) : null}
      {visibleResults.length ? (
        <div
          aria-label={t("Risultati nel PDF")}
          className="pdf-search-results"
          data-rendered-count={visibleResults.length}
          data-total-count={total}
        >
          {visibleResults.map(result => (
            <button
              className={
                result.index === current
                  ? "pdf-search-result selected"
                  : "pdf-search-result"
              }
              data-match-index={result.matchIndex}
              data-page-number={result.pageNumber}
              data-result-index={result.index}
              key={result.id}
              onClick={() => onGoToSearchResult?.(result)}
              type="button"
            >
              <strong>{t("Pagina {{pageNumber}}", { pageNumber: result.pageNumber })}</strong>
              <span>
                {result.before ? `${result.before} ` : ""}
                <mark>{result.match}</mark>
                {result.after ? ` ${result.after}` : ""}
              </span>
            </button>
          ))}
          {hasMoreResults ? (
            <div
              aria-hidden="true"
              className="pdf-search-results-sentinel"
              ref={loadMoreRef}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HistoryPanel({
  editHistory,
  onRedo,
  onSelectHistoryEntry,
  onUndo,
  viewerState,
}) {
  const { t } = useTranslation();
  const revisionEntries = editHistory?.revisionEntries || [];
  const runtimeHistory = viewerState.editing?.runtimeHistory || {
    entries: [],
    position: -1,
  };
  const runtimeEntries = runtimeHistory.entries || [];
  const historyGraph = buildLinearHistoryGraph({
    editHistory,
    revisionEntries,
    runtimeEntries,
    runtimeHistory,
    t,
  });
  const canUndo = Boolean(
    viewerState.editing?.hasSomethingToUndo || editHistory?.canUndo
  );
  const canRedo = Boolean(
    viewerState.editing?.hasSomethingToRedo || editHistory?.canRedo
  );

  return (
    <div className="editor-context-content history-context-panel">
      <div className="history-actions">
        <button disabled={!canUndo} onClick={onUndo} type="button">
          <Icon>undo</Icon>
          {t("Annulla")}
        </button>
        <button disabled={!canRedo} onClick={onRedo} type="button">
          <Icon>redo</Icon>
          {t("Ripristina")}
        </button>
      </div>
      <section className="history-section">
        <p>{t("Modifiche annotazioni")}</p>
        <ol className="history-graph">
          {historyGraph.map(node => {
            const isClickable = Boolean(
              node.entry?.payload?.destination && onSelectHistoryEntry
            );
            return (
              <li
                className={[
                  "history-graph-node",
                  isClickable ? "clickable" : "",
                  node.isCurrent ? "current" : "",
                  node.isFuture ? "future" : "",
                ].join(" ")}
                data-history-track={node.track}
                key={node.id}
                onClick={() => {
                  if (isClickable) {
                    onSelectHistoryEntry?.(node.entry);
                  }
                }}
                onKeyDown={event => {
                  if (
                    isClickable &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onSelectHistoryEntry?.(node.entry);
                  }
                }}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
              >
                <span className="history-graph-rail">
                  <span className="history-graph-dot">
                    <Icon>{getHistoryIcon(node.type)}</Icon>
                  </span>
                </span>
                <span className="history-graph-card">
                  <span className="history-graph-title-row">
                    <strong>{node.label}</strong>
                    {node.isCurrent ? (
                      <span className="history-graph-state">
                        {t("Corrente")}
                      </span>
                    ) : null}
                    {node.isFuture ? (
                      <span className="history-graph-state muted">
                        {t("Annullata")}
                      </span>
                    ) : null}
                  </span>
                  {node.note ? (
                    <small>{node.note}</small>
                  ) : node.timestamp ? (
                    <small>{formatHistoryDate(node.timestamp)}</small>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function getPermissionLabel(key, t) {
  const labels = {
    accessibility: t("Copia per accessibilita"),
    annotations: t("Annotazioni"),
    assemble: t("Organizzazione pagine"),
    copy: t("Copia contenuto"),
    forms: t("Compilazione moduli"),
    modify: t("Modifica contenuto"),
    print: t("Stampa"),
  };
  return labels[key] || key;
}

function getPermissionSummary(permissions, t) {
  if (!permissions?.isAvailable) {
    return t("Autorizzazioni non disponibili");
  }
  if (!permissions.hasRestrictions) {
    return t("Nessuna restrizione rilevata");
  }
  const allowedChanges = (permissions.details || [])
    .filter(
      detail =>
        detail.allowed &&
        ["modify", "annotations", "forms", "assemble"].includes(detail.key)
    )
    .map(detail => getPermissionLabel(detail.key, t));
  if (!allowedChanges.length) {
    return t("Nessuna modifica consentita");
  }
  return t("Modifiche consentite: {{changes}}", {
    changes: allowedChanges.join(", "),
  });
}

function hasRestrictedProtectPermissions(permissions) {
  return protectPermissionOptions.some(
    ({ disabled, key }) => !disabled && permissions[key] === false
  );
}

function SignaturesPanel({ viewerState }) {
  const { t } = useTranslation();
  const pdfSecurity = viewerState.pdfSecurity || {};
  const signatures = pdfSecurity.signatures || {};
  const signatureDetails = signatures.details || [];
  const primarySignature = signatureDetails[0] || null;
  const hasSignatures = Boolean(signatures.hasDigitalSignatures);

  if (pdfSecurity.status === "loading") {
    return (
      <div className="editor-context-content security-context-panel">
        <div className="security-empty">
          <Icon>hourglass_empty</Icon>
          <span>{t("Lettura firme digitali...")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-context-content security-context-panel">
      <section className="security-section">
        {hasSignatures ? (
          <div className="security-status-card warning">
            <span className="security-status-icon">
              <Icon>gpp_maybe</Icon>
            </span>
            <span>
              <strong>{t("Firma sconosciuta")}</strong>
              <small>
                {t(
                  "Viewer Next ha rilevato una firma digitale, ma non puo verificarne l'identita."
                )}
              </small>
            </span>
          </div>
        ) : (
          <div className="security-status-card">
            <span className="security-status-icon">
              <Icon>verified_user</Icon>
            </span>
            <span>
              <strong>{t("Nessuna firma digitale rilevata")}</strong>
              <small>
                {t("pdf.js non segnala firme digitali in questo documento.")}
              </small>
            </span>
          </div>
        )}
        {primarySignature ? (
          <dl className="security-detail-list">
            <div>
              <dt>{t("Firmatario")}</dt>
              <dd>{primarySignature.signerName || t("Sconosciuto")}</dd>
            </div>
            <div>
              <dt>{t("Stato")}</dt>
              <dd>{t("Non verificabile in Viewer Next")}</dd>
            </div>
            {primarySignature.signingTime ? (
              <div>
                <dt>{t("Ora firma")}</dt>
                <dd>{formatSecurityDate(primarySignature.signingTime)}</dd>
              </div>
            ) : null}
            {primarySignature.documentModified !== null &&
            primarySignature.documentModified !== undefined ? (
              <div>
                <dt>{t("Documento modificato")}</dt>
                <dd>
                  {primarySignature.documentModified
                    ? t("Modifiche dopo la firma rilevate")
                    : t("Nessuna modifica dopo la firma rilevata")}
                </dd>
              </div>
            ) : null}
            {primarySignature.certificate?.subject ? (
              <div>
                <dt>{t("Certificato")}</dt>
                <dd>{primarySignature.certificate.subject}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {hasSignatures ? (
          <div className="security-note">
            {t(
              "Viewer Next non esegue validazione crittografica o verifica della catena certificati per questa firma."
            )}
          </div>
        ) : null}
      </section>

      {hasSignatures ? (
        <section className="security-section">
          <p>{t("Guardrail modifica")}</p>
          <div className="security-note">
            {t("Le modifiche possono invalidare la firma digitale.")}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PermissionsPanel({ onOpenProtectPanel, viewerState }) {
  const { t } = useTranslation();
  const pdfSecurity = viewerState.pdfSecurity || {};
  const permissions = pdfSecurity.permissions || {};
  const permissionDetails = permissions.details || [];

  if (pdfSecurity.status === "loading") {
    return (
      <div className="editor-context-content security-context-panel">
        <div className="security-empty">
          <Icon>hourglass_empty</Icon>
          <span>{t("Lettura autorizzazioni file...")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-context-content security-context-panel">
      <section className="security-section">
        <div className="security-summary">
          <Icon>{permissions.hasRestrictions ? "lock" : "lock_open"}</Icon>
          <span>{getPermissionSummary(permissions, t)}</span>
        </div>
        {permissionDetails.length ? (
          <ul className="permission-list">
            {permissionDetails.map(detail => (
              <li
                className={detail.allowed ? "allowed" : "blocked"}
                key={detail.key}
              >
                <Icon>{detail.allowed ? "check" : "block"}</Icon>
                <span>{getPermissionLabel(detail.key, t)}</span>
                <small>{detail.allowed ? t("Consentito") : t("Limitato")}</small>
              </li>
            ))}
          </ul>
        ) : (
          <div className="security-empty">
            <Icon>info</Icon>
            <span>{t("Nessuna restrizione PDF esplicita rilevata.")}</span>
          </div>
        )}
        <button
          className="security-action-button"
          onClick={onOpenProtectPanel}
          type="button"
        >
          <Icon>shield</Icon>
          <span>{t("Imposta restrizioni")}</span>
        </button>
      </section>
    </div>
  );
}

function ProtectPanel({
  documentPasswordStatus,
  onProtectPdfWithPassword,
  viewerState,
}) {
  const { t } = useTranslation();
  const hasExistingOpenPassword =
    documentPasswordStatus?.hasOpenPassword === true;
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordAction, setPasswordAction] = useState(() =>
    hasExistingOpenPassword ? "keep" : "none"
  );
  const [permissions, setPermissions] = useState(() =>
    getInitialProtectPermissions(viewerState)
  );
  const [permissionsEdited, setPermissionsEdited] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const permissionsEditedRef = useRef(false);
  const currentPasswordRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    if (!permissionsEditedRef.current) {
      setPermissions(getInitialProtectPermissions(viewerState));
    }
  }, [viewerState.pdfSecurity]);

  useEffect(() => {
    setPasswordAction(hasExistingOpenPassword ? "keep" : "none");
    setCurrentPassword("");
    setPassword("");
    setConfirmation("");
    setPermissionsEdited(false);
    setError("");
  }, [hasExistingOpenPassword]);

  useEffect(() => {
    if (
      hasExistingOpenPassword &&
      (passwordAction !== "keep" || permissionsEdited)
    ) {
      requestAnimationFrame(() => currentPasswordRef.current?.focus());
      return;
    }
    if (passwordAction === "add" || passwordAction === "change") {
      requestAnimationFrame(() => passwordRef.current?.focus());
    }
  }, [hasExistingOpenPassword, passwordAction, permissionsEdited]);

  async function submitProtection(event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const changingPassword =
      passwordAction === "add" || passwordAction === "change";
    const keepingPassword = passwordAction === "keep";
    const requireOpenPassword = changingPassword || keepingPassword;
    const hasRestrictions = hasRestrictedProtectPermissions(permissions);
    const needsCurrentPassword =
      hasExistingOpenPassword && (passwordAction !== "keep" || permissionsEdited);
    if (
      hasExistingOpenPassword &&
      passwordAction === "keep" &&
      !permissionsEdited
    ) {
      setError(t("Scegli Cambia, Rimuovi oppure modifica una restrizione."));
      return;
    }
    if (needsCurrentPassword && !currentPassword) {
      setError(t("Inserisci la password attuale del PDF."));
      return;
    }
    if (changingPassword && !password) {
      setError(
        hasExistingOpenPassword
          ? t("Inserisci la nuova password.")
          : t("Inserisci una password.")
      );
      return;
    }
    if (changingPassword && password !== confirmation) {
      setError(t("Le password non corrispondono."));
      return;
    }
    if (
      !hasExistingOpenPassword &&
      passwordAction === "none" &&
      !hasRestrictions
    ) {
      setError(t("Scegli una password o almeno una restrizione."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onProtectPdfWithPassword?.({
        currentPassword: hasExistingOpenPassword ? currentPassword : "",
        permissions,
        passwordAction,
        requireOpenPassword,
        userPassword: changingPassword ? password : currentPassword,
      });
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      setPermissionsEdited(false);
    } catch {
      setError(
        hasExistingOpenPassword
          ? t("Protezione PDF non riuscita. Controlla la password attuale e riprova.")
          : t("Protezione PDF non riuscita.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="editor-context-content security-context-panel protect-context-panel"
      onSubmit={submitProtection}
    >
      <section className="security-section">
        <div className="security-status-card">
          <span className="security-status-icon">
            <Icon>shield</Icon>
          </span>
          <span>
            <strong>{t("Password di apertura")}</strong>
            <small>
              {hasExistingOpenPassword
                ? t("Scegli se mantenerla, cambiarla o rimuoverla.")
                : t(
                    "Scegli se la nuova revisione richiedera una password per aprirsi."
                  )}
            </small>
          </span>
        </div>
        <div className="protect-mode-options">
          {(hasExistingOpenPassword
            ? [
                {
                  description: t("Usa ancora la password attuale."),
                  label: t("Mantieni"),
                  value: "keep",
                },
                {
                  description: t("Imposta una nuova password di apertura."),
                  label: t("Cambia"),
                  value: "change",
                },
                {
                  description: t("La nuova revisione si aprira senza password."),
                  label: t("Rimuovi"),
                  value: "remove",
                },
              ]
            : [
                {
                  description: t("La nuova revisione si aprira senza password."),
                  label: t("Nessuna password"),
                  value: "none",
                },
                {
                  description: t("Richiedi una password per aprire il PDF."),
                  label: t("Aggiungi password"),
                  value: "add",
                },
              ]
          ).map(option => (
            <label className="protect-mode-option" key={option.value}>
              <input
                checked={passwordAction === option.value}
                disabled={busy || viewerState.loading}
                name="protect-password-action"
                onChange={() => {
                  setPasswordAction(option.value);
                  setPassword("");
                  setConfirmation("");
                  setError("");
                }}
                type="radio"
                value={option.value}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
        {hasExistingOpenPassword &&
        (passwordAction !== "keep" || permissionsEdited) ? (
          <label className="protect-password-field">
            <span>{t("Password attuale")}</span>
            <input
              aria-invalid={error && !currentPassword ? "true" : "false"}
              autoComplete="current-password"
              disabled={busy || viewerState.loading}
              onChange={event => {
                setCurrentPassword(event.target.value);
                setError("");
              }}
              ref={currentPasswordRef}
              type="password"
              value={currentPassword}
            />
          </label>
        ) : null}
        {passwordAction === "add" || passwordAction === "change" ? (
          <>
            <label className="protect-password-field">
              <span>
                {hasExistingOpenPassword
                  ? t("Nuova password PDF")
                  : t("Password PDF")}
              </span>
              <input
                aria-invalid={error && !password ? "true" : "false"}
                autoComplete="new-password"
                disabled={busy || viewerState.loading}
                onChange={event => {
                  setPassword(event.target.value);
                  setError("");
                }}
                ref={passwordRef}
                type="password"
                value={password}
              />
            </label>
            <label className="protect-password-field">
              <span>
                {hasExistingOpenPassword
                  ? t("Conferma nuova password")
                  : t("Conferma password")}
              </span>
              <input
                aria-invalid={
                  error && password && password !== confirmation
                    ? "true"
                    : "false"
                }
                autoComplete="new-password"
                disabled={busy || viewerState.loading}
                onChange={event => {
                  setConfirmation(event.target.value);
                  setError("");
                }}
                type="password"
                value={confirmation}
              />
            </label>
          </>
        ) : null}
        {error ? (
          <div className="protect-password-error" role="alert">
            <Icon>error</Icon>
            <span>{error}</span>
          </div>
        ) : null}
      </section>
      <section className="security-section">
        <p>{t("Autorizzazioni file")}</p>
        <div className="security-note">
          {t(
            "Queste restrizioni sono indipendenti dalla password di apertura."
          )}
        </div>
        <ul className="protect-permission-list">
          {protectPermissionOptions.map(({ disabled, helper, key }) => {
            const checked = permissions[key] !== false;
            return (
              <li key={key}>
                <label>
                  <input
                    checked={checked}
                    disabled={disabled || busy || viewerState.loading}
                    onChange={event => {
                      const allowed = event.target.checked;
                      permissionsEditedRef.current = true;
                      setPermissionsEdited(true);
                      setPermissions(current => ({
                        ...current,
                        [key]: allowed,
                      }));
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>{getPermissionLabel(key, t)}</strong>
                    <small>
                      {helper
                        ? t(helper)
                        : checked
                          ? t("Consentito")
                          : t("Limitato")}
                    </small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="protect-permission-presets">
          <button
            disabled={busy || viewerState.loading}
            onClick={() => {
              permissionsEditedRef.current = true;
              setPermissionsEdited(true);
              setPermissions(defaultProtectPermissions);
            }}
            type="button"
          >
            {t("Consenti tutto")}
          </button>
          <button
            disabled={busy || viewerState.loading}
            onClick={() => {
              permissionsEditedRef.current = true;
              setPermissionsEdited(true);
              setPermissions(readOnlyProtectPermissions);
            }}
            type="button"
          >
            {t("Solo lettura")}
          </button>
        </div>
        <button
          className="protect-password-submit"
          disabled={busy || viewerState.loading}
          type="submit"
        >
          <Icon>
            {busy
              ? "hourglass_empty"
              : hasExistingOpenPassword
                ? "lock_reset"
                : "lock"}
          </Icon>
          <span>
            {busy
              ? t("Protezione PDF in corso...")
              : t("Applica protezione")}
          </span>
        </button>
      </section>
      <section className="security-section">
        <p>{t("Output")}</p>
        <div className="security-note">
          {passwordAction === "remove"
            ? t(
                "La nuova revisione si apre in una nuova scheda senza password di apertura."
              )
            : passwordAction === "change" || passwordAction === "add"
              ? t(
                  "La nuova revisione si apre in una nuova scheda e richiedera la nuova password."
                )
              : passwordAction === "keep"
                ? t(
                    "La nuova revisione si apre in una nuova scheda e mantiene la password attuale."
                  )
                : t(
                    "La revisione protetta si apre in una nuova scheda senza chiedere password."
                  )}
        </div>
      </section>
    </form>
  );
}

export function EditorContextSideNav({
  activePanel,
  documentPasswordStatus,
  editHistory,
  onClose,
  onCancelPendingComment,
  onAddCommentToSelection,
  onAddBookmarkFromSelection,
  onDeleteBookmark,
  onDeleteSelection,
  onGoToBookmark,
  onGoToPage,
  onGoToComment,
  onOpenFullOrganizer,
  onOpenProtectPanel,
  onProtectPdfWithPassword,
  onGoToSearchResult,
  onRedo,
  onSavePendingComment,
  onSearch,
  onSelectHistoryEntry,
  onSetTool,
  onUndo,
  onUpdateBookmarkTitle,
  pageOrganizer,
  pagePreviews,
  viewerState,
}) {
  const { t } = useTranslation();
  const [commentSearchOpen, setCommentSearchOpen] = useState(false);
  const showUnimplementedTools = shouldShowUnimplementedTools();
  if (!activePanel) {
    return null;
  }

  const activePanelTitle = t(panelTitles[activePanel]);
  const interactionCapabilities =
    viewerState.viewerInteractionState?.capabilities || {};
  const canBookmarkFromInteraction = Boolean(
    interactionCapabilities.canBookmark
  );

  return (
    <aside className="editor-context-sidenav" aria-label={activePanelTitle}>
      <div className="editor-context-header">
        <button
          aria-label={t("Chiudi {{title}}", { title: activePanelTitle })}
          onClick={onClose}
          type="button"
        >
          <Icon>close</Icon>
        </button>
        <h2>{activePanelTitle}</h2>
        <div className="editor-context-header-actions">
          {activePanel === "comments" ? (
            <button
              aria-label={t("Cerca commenti")}
              onClick={() => setCommentSearchOpen(open => !open)}
              type="button"
            >
              <Icon>search</Icon>
            </button>
          ) : null}
          {activePanel === "bookmarks" ? (
            <button
              aria-label={t("Aggiungi segnalibro")}
              disabled={!canBookmarkFromInteraction}
              onClick={onAddBookmarkFromSelection}
              onMouseDown={event => event.preventDefault()}
              title={
                canBookmarkFromInteraction
                  ? t("Aggiungi segnalibro")
                  : t("Seleziona testo nel PDF per aggiungere un segnalibro.")
              }
              type="button"
            >
              <Icon>bookmark_add</Icon>
            </button>
          ) : null}
          {activePanel === "pages" && showUnimplementedTools ? (
            <button
              aria-label={t("Inserisci pagina")}
              disabled
              title={t("Non ancora collegato")}
              type="button"
            >
              <Icon>note_add</Icon>
            </button>
          ) : null}
          {activePanel !== "bookmarks" && showUnimplementedTools ? (
            <button aria-label={t("Altre opzioni")} type="button">
              <Icon>more_horiz</Icon>
            </button>
          ) : null}
        </div>
      </div>
      <InteractionTargetPanel
        onAddBookmarkFromSelection={onAddBookmarkFromSelection}
        onAddCommentToSelection={onAddCommentToSelection}
        onDeleteSelection={onDeleteSelection}
        onSetTool={onSetTool}
        showUnimplementedTools={showUnimplementedTools}
        viewerState={viewerState}
      />
      {activePanel === "comments" ? (
        <CommentsPanel
          isSearchOpen={commentSearchOpen}
          onCancelPendingComment={onCancelPendingComment}
          onGoToComment={onGoToComment}
          onSearchClose={() => setCommentSearchOpen(false)}
          onSavePendingComment={onSavePendingComment}
          viewerState={viewerState}
        />
      ) : null}
      {activePanel === "bookmarks" ? (
        <BookmarksPanel
          onDeleteBookmark={onDeleteBookmark}
          onGoToBookmark={onGoToBookmark}
          onUpdateBookmarkTitle={onUpdateBookmarkTitle}
          viewerState={viewerState}
        />
      ) : null}
      {activePanel === "search" ? (
        <PdfSearchPanel
          onGoToSearchResult={onGoToSearchResult}
          onSearch={onSearch}
          viewerState={viewerState}
        />
      ) : null}
      {activePanel === "history" ? (
        <HistoryPanel
          editHistory={editHistory}
          onRedo={onRedo}
          onSelectHistoryEntry={onSelectHistoryEntry}
          onUndo={onUndo}
          viewerState={viewerState}
        />
      ) : null}
      {activePanel === "signatures" ? (
        <SignaturesPanel viewerState={viewerState} />
      ) : null}
      {activePanel === "permissions" ? (
        <PermissionsPanel
          onOpenProtectPanel={onOpenProtectPanel}
          viewerState={viewerState}
        />
      ) : null}
      {activePanel === "protect" ? (
        <ProtectPanel
          documentPasswordStatus={documentPasswordStatus}
          onProtectPdfWithPassword={onProtectPdfWithPassword}
          viewerState={viewerState}
        />
      ) : null}
      {activePanel === "pages" ? (
        <PagesContextPanel
          onGoToPage={onGoToPage}
          onOpenFullOrganizer={onOpenFullOrganizer}
          pageOrganizer={pageOrganizer}
          pagePreviews={pagePreviews}
          viewerState={viewerState}
        />
      ) : null}
    </aside>
  );
}
