import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon.jsx";
import { useTranslation } from "../i18n/index.js";
import {
  getPdfPageCount,
  mergePdfDocuments,
  renderPdfPageThumbnail,
  renderPdfPageThumbnails,
} from "../pdf/pdfMerge.js";
import { formatBytes } from "../pdf/pdfStorage.js";

function createMergeItemId() {
  return `merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCombinedFilename(items) {
  const firstName = items[0]?.name?.replace(/\.pdf$/i, "") || "combined";
  return `${firstName}-combined.pdf`;
}

function getVisiblePages(item) {
  return item.pages.filter(page => !page.removed);
}

function getPageCountLabel(count, t) {
  if (count === 1) {
    return t("1 pagina");
  }
  return t("{{count}} pagine", { count });
}

async function createMergeItem({ bytes, name, size, source }) {
  const pagesCount = await getPdfPageCount(bytes);
  const firstThumbnail =
    pagesCount > 0 ? await renderPdfPageThumbnail(bytes, 1, 116) : "";
  return {
    bytes,
    id: createMergeItemId(),
    name: name || "Document.pdf",
    pages: Array.from({ length: pagesCount }, (_, index) => ({
      pageNumber: index + 1,
      removed: false,
      thumbnail: index === 0 ? firstThumbnail : "",
    })),
    pagesCount,
    size: size || bytes.byteLength || bytes.length || 0,
    source,
  };
}

function MergeSteps({ hasItems }) {
  return (
    <div className="merge-steps" aria-hidden="true">
      <span className="active">
        <i></i>
        <strong>Seleziona i file</strong>
      </span>
      <span className={hasItems ? "active" : ""}>
        <i></i>
        <strong>Ridisponi le pagine</strong>
      </span>
      <span>
        <i></i>
        <strong>Combina</strong>
      </span>
    </div>
  );
}

function MergeItemActions({ canMoveDown, canMoveUp, onMoveDown, onMoveUp, onRemove }) {
  return (
    <div className="merge-item-actions" role="menu">
      <button
        aria-label="Sposta prima"
        disabled={!canMoveUp}
        onClick={onMoveUp}
        title="Sposta prima"
        type="button"
      >
        <Icon>arrow_upward</Icon>
      </button>
      <button
        aria-label="Sposta dopo"
        disabled={!canMoveDown}
        onClick={onMoveDown}
        title="Sposta dopo"
        type="button"
      >
        <Icon>arrow_downward</Icon>
      </button>
      <button
        aria-label="Rimuovi PDF"
        className="danger"
        onClick={onRemove}
        title="Rimuovi PDF"
        type="button"
      >
        <Icon>delete</Icon>
      </button>
    </div>
  );
}

function MergePageTile({ page, onRemove }) {
  return (
    <div className="merge-page-tile">
      <div className="merge-page-paper">
        {page.thumbnail ? (
          <img alt="" src={page.thumbnail} />
        ) : (
          <Icon>description</Icon>
        )}
      </div>
      <button
        aria-label={`Rimuovi pagina ${page.pageNumber}`}
        className="merge-page-delete"
        onClick={onRemove}
        title={`Rimuovi pagina ${page.pageNumber}`}
        type="button"
      >
        <Icon>delete</Icon>
      </button>
      <span>{page.pageNumber}</span>
    </div>
  );
}

function OpenFilesDialog({
  activePdfTabId,
  onAdd,
  onClose,
  pdfTabs,
  selectedIds,
  setSelectedIds,
}) {
  const { t } = useTranslation();
  const toggleId = id => {
    setSelectedIds(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id]
    );
  };

  return (
    <div className="merge-modal-backdrop" role="presentation">
      <section
        aria-labelledby="merge-open-files-title"
        className="merge-open-files-dialog"
        role="dialog"
      >
        <header>
          <h2 id="merge-open-files-title">{t("Apri file PDF")}</h2>
          <button aria-label={t("Chiudi")} onClick={onClose} type="button">
            <Icon>close</Icon>
          </button>
        </header>
        <div className="merge-open-files-table">
          <div className="merge-open-files-head">
            <span>{t("Nome")}</span>
            <span>{t("Dimensione")}</span>
          </div>
          {pdfTabs.length > 0 ? (
            pdfTabs.map(tab => (
              <label
                className={selectedIds.includes(tab.id) ? "selected" : ""}
                key={tab.id}
              >
                <span>
                  <input
                    checked={selectedIds.includes(tab.id)}
                    onChange={() => toggleId(tab.id)}
                    type="checkbox"
                  />
                  <strong>{tab.name}</strong>
                  {tab.id === activePdfTabId ? <em>{t("Attivo")}</em> : null}
                </span>
                <small>{formatBytes(tab.size)}</small>
              </label>
            ))
          ) : (
            <p>{t("Nessun PDF aperto.")}</p>
          )}
        </div>
        <footer>
          <button className="secondary" onClick={onClose} type="button">
            {t("Annulla")}
          </button>
          <button
            className="primary"
            disabled={selectedIds.length === 0}
            onClick={onAdd}
            type="button"
          >
            {t("Aggiungi file")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function CombinePdfView({
  activePdfTabId,
  getOpenPdfSource,
  navigate,
  onOpenFile,
  pdfTabs,
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [showOpenFilesDialog, setShowOpenFilesDialog] = useState(false);
  const [selectedOpenFileIds, setSelectedOpenFileIds] = useState([]);
  const [status, setStatus] = useState({ message: "", state: "idle" });
  const [viewMode, setViewMode] = useState("grid");

  const totalPages = useMemo(
    () => items.reduce((sum, item) => sum + getVisiblePages(item).length, 0),
    [items]
  );
  const selectedItemIndex = items.findIndex(item => item.id === selectedItemId);
  const canCombine = totalPages > 0 && status.state !== "running";

  const addMergeItems = useCallback(
    async sources => {
      const pdfSources = sources.filter(source =>
        source.name?.toLowerCase().endsWith(".pdf")
      );
      if (pdfSources.length === 0) {
        setStatus({
          message: t("Seleziona almeno un file PDF."),
          state: "error",
        });
        return;
      }
      setStatus({ message: t("Preparazione PDF..."), state: "running" });
      try {
        const nextItems = [];
        for (const source of pdfSources) {
          nextItems.push(
            await createMergeItem({
              bytes: source.bytes,
              name: source.name,
              size: source.size,
              source: source.source,
            })
          );
        }
        setItems(current => [...current, ...nextItems]);
        setSelectedItemId(current => current || nextItems[0]?.id || null);
        setStatus({
          message: t("File aggiunti alla combinazione."),
          state: "done",
        });
      } catch (reason) {
        setStatus({
          message: reason?.message || t("Impossibile leggere uno dei PDF."),
          state: "error",
        });
      }
    },
    [t]
  );

  const handleFileSelection = useCallback(
    async event => {
      const files = [...(event.target.files || [])];
      event.target.value = "";
      const sources = await Promise.all(
        files.map(async file => ({
          bytes: new Uint8Array(await file.arrayBuffer()),
          name: file.name,
          size: file.size,
          source: "upload",
        }))
      );
      await addMergeItems(sources);
    },
    [addMergeItems]
  );

  const handleDrop = useCallback(
    async event => {
      event.preventDefault();
      setDragActive(false);
      const files = [...(event.dataTransfer?.files || [])];
      const sources = await Promise.all(
        files.map(async file => ({
          bytes: new Uint8Array(await file.arrayBuffer()),
          name: file.name,
          size: file.size,
          source: "drop",
        }))
      );
      await addMergeItems(sources);
    },
    [addMergeItems]
  );

  const openFilesDialog = useCallback(() => {
    setSelectedOpenFileIds(activePdfTabId ? [activePdfTabId] : []);
    setShowOpenFilesDialog(true);
  }, [activePdfTabId]);

  const addOpenFiles = useCallback(async () => {
    const sources = [];
    for (const id of selectedOpenFileIds) {
      const tab = await getOpenPdfSource(id);
      if (!tab?.data) {
        continue;
      }
      sources.push({
        bytes: tab.data,
        name: tab.name,
        size: tab.size,
        source: "open-tab",
      });
    }
    setShowOpenFilesDialog(false);
    await addMergeItems(sources);
  }, [addMergeItems, getOpenPdfSource, selectedOpenFileIds]);

  const removeItem = useCallback(id => {
    setItems(current => current.filter(item => item.id !== id));
    setSelectedItemId(current => (current === id ? null : current));
    setExpandedItemId(current => (current === id ? null : current));
  }, []);

  const moveItem = useCallback((id, direction) => {
    setItems(current => {
      const index = current.findIndex(item => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }, []);

  const removePage = useCallback((itemId, pageNumber) => {
    setItems(current =>
      current.flatMap(item => {
        if (item.id !== itemId) {
          return item;
        }
        const visiblePages = getVisiblePages(item);
        if (visiblePages.length <= 1) {
          return [];
        }
        return {
          ...item,
          pages: item.pages.map(page =>
            page.pageNumber === pageNumber ? { ...page, removed: true } : page
          ),
        };
      })
    );
  }, []);

  const expandItem = useCallback(
    async item => {
      const nextExpandedId = expandedItemId === item.id ? null : item.id;
      setExpandedItemId(nextExpandedId);
      setSelectedItemId(item.id);
      if (!nextExpandedId) {
        return;
      }
      const missingPages = item.pages
        .filter(page => !page.removed && !page.thumbnail)
        .map(page => page.pageNumber);
      if (missingPages.length === 0) {
        return;
      }
      setStatus({ message: t("Creazione anteprime pagine..."), state: "running" });
      try {
        const thumbnails = await renderPdfPageThumbnails(item.bytes, missingPages, 116);
        setItems(current =>
          current.map(currentItem =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  pages: currentItem.pages.map(page => ({
                    ...page,
                    thumbnail: thumbnails[page.pageNumber] || page.thumbnail,
                  })),
                }
              : currentItem
          )
        );
        setStatus({ message: "", state: "idle" });
      } catch (reason) {
        setStatus({
          message: reason?.message || t("Anteprime non disponibili."),
          state: "error",
        });
      }
    },
    [expandedItemId, t]
  );

  const combineFiles = useCallback(async () => {
    if (!canCombine) {
      return;
    }
    setStatus({ message: t("Combinazione PDF..."), state: "running" });
    try {
      const bytes = await mergePdfDocuments(items);
      const file = new File([bytes], getCombinedFilename(items), {
        type: "application/pdf",
      });
      await onOpenFile(file, { source: "merge-pdf" });
      setStatus({ message: t("PDF combinato creato."), state: "done" });
    } catch (reason) {
      setStatus({
        message: reason?.message || t("Combinazione non riuscita."),
        state: "error",
      });
    }
  }, [canCombine, items, onOpenFile, t]);

  return (
    <main
      className={`workspace combine-workspace ${dragActive ? "drag-active" : ""}`}
      onDragEnter={event => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => {
        if (event.currentTarget === event.target) {
          setDragActive(false);
        }
      }}
      onDrop={handleDrop}
    >
      <input
        accept="application/pdf,.pdf"
        className="hidden-input"
        multiple
        onChange={handleFileSelection}
        ref={fileInputRef}
        type="file"
      />
      <header className="combine-commandbar">
        <strong>{t("Combina più file")}</strong>
        <div className="combine-commandbar-center">
          <button onClick={() => fileInputRef.current?.click()} type="button">
            <Icon>upload_file</Icon>
            <span>{t("Aggiungere file")}</span>
          </button>
          <button
            disabled={selectedItemIndex < 0}
            onClick={() => selectedItemId && removeItem(selectedItemId)}
            title={t("Rimuovi PDF")}
            type="button"
          >
            <Icon>delete</Icon>
          </button>
          <span className="combine-separator"></span>
          <button
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
            title={t("Griglia")}
            type="button"
          >
            <Icon>grid_view</Icon>
          </button>
          <button
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
            title={t("Lista")}
            type="button"
          >
            <Icon>view_list</Icon>
          </button>
        </div>
        <div className="combine-commandbar-actions">
          {status.message ? (
            <span className={`merge-status ${status.state}`} role="status">
              {status.message}
            </span>
          ) : null}
          <button className="secondary" onClick={() => navigate("all-tools")} type="button">
            {t("Chiudi")}
          </button>
          <button
            className="primary"
            disabled={!canCombine}
            onClick={combineFiles}
            type="button"
          >
            {t("Combina")}
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <section className="combine-empty">
          <h1>{t("Combina più file in un unico PDF")}</h1>
          <MergeSteps hasItems={false} />
          <button
            className="combine-dropzone"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Icon>library_add</Icon>
            <strong>{t("Trascina i file")}</strong>
            <small>
              {t("Seleziona più PDF o usa i PDF già aperti nell'editor.")}
            </small>
          </button>
          <div className="combine-empty-actions">
            <button
              className="secondary dark"
              disabled={pdfTabs.length === 0}
              onClick={openFilesDialog}
              type="button"
            >
              {t("Aggiungi file aperti")}
            </button>
            <button
              className="primary"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              {t("Aggiungi")}
            </button>
          </div>
        </section>
      ) : (
        <section className="combine-board">
          <div className="combine-board-header">
            <MergeSteps hasItems={true} />
            <div>
              <strong>{getPageCountLabel(totalPages, t)}</strong>
              <small>{t("Ordine finale del PDF combinato")}</small>
            </div>
            <button
              className="secondary"
              disabled={pdfTabs.length === 0}
              onClick={openFilesDialog}
              type="button"
            >
              <Icon>folder_open</Icon>
              <span>{t("Aggiungi file aperti")}</span>
            </button>
          </div>

          <div className={`merge-items ${viewMode}`}>
            {items.map((item, index) => {
              const visiblePages = getVisiblePages(item);
              const isSelected = selectedItemId === item.id;
              const isExpanded = expandedItemId === item.id;
              return (
                <article
                  className={`merge-item ${isSelected ? "selected" : ""} ${
                    isExpanded ? "expanded" : ""
                  }`}
                  key={item.id}
                >
                  <button
                    className="merge-file-tile"
                    onClick={() => {
                      setSelectedItemId(item.id);
                      expandItem(item);
                    }}
                    type="button"
                  >
                    <div className="merge-file-paper">
                      {visiblePages[0]?.thumbnail ? (
                        <img alt="" src={visiblePages[0].thumbnail} />
                      ) : (
                        <Icon>picture_as_pdf</Icon>
                      )}
                    </div>
                    <strong>{item.name}</strong>
                    <small>
                      {getPageCountLabel(visiblePages.length, t)} ·{" "}
                      {formatBytes(item.size)}
                    </small>
                  </button>
                  {isSelected ? (
                    <MergeItemActions
                      canMoveDown={index < items.length - 1}
                      canMoveUp={index > 0}
                      onMoveDown={() => moveItem(item.id, 1)}
                      onMoveUp={() => moveItem(item.id, -1)}
                      onRemove={() => removeItem(item.id)}
                    />
                  ) : null}
                  {isExpanded ? (
                    <div className="merge-pages-strip">
                      {visiblePages.map(page => (
                        <MergePageTile
                          key={page.pageNumber}
                          onRemove={() => removePage(item.id, page.pageNumber)}
                          page={page}
                        />
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {showOpenFilesDialog ? (
        <OpenFilesDialog
          activePdfTabId={activePdfTabId}
          onAdd={addOpenFiles}
          onClose={() => setShowOpenFilesDialog(false)}
          pdfTabs={pdfTabs}
          selectedIds={selectedOpenFileIds}
          setSelectedIds={setSelectedOpenFileIds}
        />
      ) : null}
    </main>
  );
}
