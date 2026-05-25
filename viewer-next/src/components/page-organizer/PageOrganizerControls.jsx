import { useMemo, useRef, useState } from "react";
import { shouldShowUnimplementedTools } from "../../app/debugSettings.js";
import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import { getVisibleEditPageQuickActions } from "../../app/toolData.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

export const pageOrganizerOptions = [
  ["crop_free", "Imposta riquadri di pagina"],
  ["transition_dissolve", "Transizioni pagina"],
  ["view_module", "Modelli pagina"],
  ["print", "Stampa pagine"],
  ["label", "Etichette pagina"],
  ["settings_applications", "Proprieta' pagina"],
];

export function PageSelectionControls({ currentPage, pageOrganizer }) {
  const { t } = useTranslation();
  const label =
    pageOrganizer.selectedCount === 1
      ? t("1 selezionata")
      : t("{{count}} selezionate", { count: pageOrganizer.selectedCount });

  return (
    <div className="page-organizer-selection">
      <div className="page-organizer-selected-row">
        <button
          aria-label={t("Deseleziona pagine")}
          className={pageOrganizer.selectedCount ? "selected" : ""}
          disabled={!pageOrganizer.selectedCount}
          onClick={pageOrganizer.clearSelection}
          role="checkbox"
          aria-checked={pageOrganizer.selectedCount > 0}
          type="button"
        >
          <Icon>{pageOrganizer.selectedCount ? "check" : "remove"}</Icon>
        </button>
        <span>
          {pageOrganizer.selectedCount ? label : t("Nessuna selezione")}
        </span>
      </div>
      <label>
        <span>{t("Pagine selezionate")}</span>
        <select
          aria-label={t("Seleziona insieme pagine")}
          onChange={event =>
            pageOrganizer.selectPreset(event.target.value, currentPage)
          }
          value={pageOrganizer.selectionPreset}
        >
          <option value="manual">{t("Manuale")}</option>
          <option value="current">{t("Pagina corrente")}</option>
          <option value="all">{t("Tutte le pagine")}</option>
          <option value="odd">{t("Pagine dispari")}</option>
          <option value="even">{t("Pagine pari")}</option>
        </select>
      </label>
    </div>
  );
}

export function PageManageMenu({ isOpen, onToggle, pageOrganizer }) {
  const { t } = useTranslation();
  const showUnimplementedTools = shouldShowUnimplementedTools();
  const disabled = !pageOrganizer.selectedCount;
  const actions = ["Copia", "Taglia", "Elimina", "Esporta selezionate"];

  if (!showUnimplementedTools) {
    return null;
  }

  return (
    <div className="page-manage-menu">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="page-manage-button"
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <span>{t("Gestisci")}</span>
        <Icon>keyboard_arrow_down</Icon>
      </button>
      {isOpen ? (
        <div className="page-manage-options" role="menu">
          {actions.map(action => (
            <button
              disabled
              key={action}
              onClick={() => pageOrganizer.noteUnavailableAction(action)}
              role="menuitem"
              title={t("Azione PDF non ancora collegata")}
              type="button"
            >
              {t(action)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PageOperationButtons({ currentPage, pageOrganizer, viewerState }) {
  const { t } = useTranslation();
  const pageQuickActions = getVisibleEditPageQuickActions({
    showDebug: shouldShowUnimplementedTools(),
  });
  const policyFacts = {
    hasDocument: Boolean(viewerState?.pagesCount),
    loading: viewerState?.loading,
    pdfSecurity: viewerState?.pdfSecurity,
  };
  function runPageAction(action, label) {
    if (label === "Elimina pagina") {
      const targetPages = pageOrganizer.selectedCount
        ? Array.from(pageOrganizer.selectedPages)
        : [currentPage || 1];
      pageOrganizer.deletePages(targetPages);
      return;
    }
    if (action === "rotate") {
      const targetPages = pageOrganizer.selectedCount
        ? Array.from(pageOrganizer.selectedPages)
        : [currentPage || 1];
      pageOrganizer.rotatePagesClockwise(targetPages);
      return;
    }
    if (action === "extract-pages") {
      pageOrganizer.openExtractDialog();
      return;
    }
    pageOrganizer.noteUnavailableAction(label);
  }

  return (
    <div className="page-operation-buttons" aria-label={t("Opzioni pagina")}>
      {pageQuickActions.map(({ action, disabled, icon, label, title }) => {
        const isDelete = label === "Elimina pagina";
        const hasDeleteTarget =
          pageOrganizer.selectedCount > 0 ||
          pageOrganizer.draftOrder.includes(currentPage || 1);
        const actionId =
          action === "rotate"
            ? "rotate-page"
            : action === "delete-page"
              ? "delete-page"
              : action;
        const policy = getPdfActionPolicy(actionId, policyFacts, t);
        const policyDisabled = action && !policy.enabled;
        return (
          <button
            aria-label={t(label)}
            data-page-action={label}
            disabled={
              isDelete
                ? !hasDeleteTarget ||
                  pageOrganizer.draftOrder.length <= 1 ||
                  policyDisabled
                : disabled || !action || policyDisabled
            }
            key={label}
            onClick={() => runPageAction(action, label)}
            title={policyDisabled ? policy.reason : t(title || label)}
            type="button"
          >
            <Icon>{icon}</Icon>
          </button>
        );
      })}
    </div>
  );
}

export function PageOrganizerActionList({ pageOrganizer, viewerState }) {
  const { t } = useTranslation();
  const showUnimplemented = shouldShowUnimplementedTools();
  const policyFacts = {
    hasDocument: Boolean(viewerState?.pagesCount),
    loading: viewerState?.loading,
    pdfSecurity: viewerState?.pdfSecurity,
  };
  const primaryActions = [
    ["note_add", "Inserisci", "insert"],
    ["find_replace", "Sostituisci", "replace"],
    ["ios_share", "Estrai pagine", "extract"],
    ["call_split", "Dividi", "split"],
    ["pin", "Numerazione Bates", null],
  ];
  const visiblePrimaryActions = primaryActions.filter(
    ([, , action]) => action || showUnimplemented
  );

  function renderPrimaryAction([icon, label, action]) {
    const actionId = {
      extract: "extract-pages",
      insert: "insert-pages",
      replace: "replace-pages",
      split: "split-pages",
    }[action];
    const policy = getPdfActionPolicy(actionId, policyFacts, t);
    const isBlocked = action && !policy.enabled;
    return (
      <button
        disabled={!action || isBlocked}
        key={label}
        onClick={() => {
          if (isBlocked) {
            return;
          }
          if (action === "insert") {
            pageOrganizer.openInsertDialog();
            return;
          }
          if (action === "replace") {
            pageOrganizer.openReplaceDialog();
            return;
          }
          if (action === "extract") {
            pageOrganizer.openExtractDialog();
            return;
          }
          if (action === "split") {
            pageOrganizer.openSplitDialog();
            return;
          }
          pageOrganizer.noteUnavailableAction(label);
        }}
        title={
          action
            ? isBlocked
              ? policy.reason
              : t(label)
            : t("Azione PDF non ancora collegata")
        }
        type="button"
      >
        <Icon>{icon}</Icon>
        <span>{t(label)}</span>
      </button>
    );
  }

  return (
    <>
      <div className="page-organizer-action-list">
        {visiblePrimaryActions.map(renderPrimaryAction)}
      </div>
      {showUnimplemented ? (
        <div className="page-organizer-action-list secondary">
          {pageOrganizerOptions.map(([icon, label]) => (
            <button
              disabled
              key={label}
              onClick={() => pageOrganizer.noteUnavailableAction(label)}
              title={t("Azione PDF non ancora collegata")}
              type="button"
            >
              <Icon>{icon}</Icon>
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return min;
  }
  return Math.min(Math.max(number, min), max);
}

function formatPageRange(positions) {
  if (!positions?.length) {
    return "";
  }
  const start = positions[0];
  const end = positions[positions.length - 1];
  return start === end ? String(start) : `${start}-${end}`;
}

function normalizePageSize(value) {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { height, width };
}

function getBlankPageSize(viewerState, pageOrganizer, targetPosition) {
  const targetPage = pageOrganizer?.draftOrder?.[targetPosition - 1];
  const targetPageSize = normalizePageSize(
    viewerState?.pageSizes?.[targetPage - 1]
  );
  if (targetPageSize) {
    return targetPageSize;
  }
  const currentPageSize = normalizePageSize(viewerState?.pagePdfSize);
  if (currentPageSize) {
    return currentPageSize;
  }
  const scale = Number(viewerState?.scale) || 1;
  const width = Number(viewerState?.pageSize?.width) / scale;
  const height = Number(viewerState?.pageSize?.height) / scale;
  return normalizePageSize({ height, width });
}

export function InsertPagesDialog({
  currentPage,
  onClose,
  pageOrganizer,
  pagesCount,
  viewerState,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const selectedPositions = pageOrganizer.getSelectedPositions();
  const currentPosition = Math.max(
    1,
    pageOrganizer.draftOrder.indexOf(currentPage || 1) + 1
  );
  const defaultPosition = selectedPositions.length
    ? Math.max(...selectedPositions)
    : currentPosition;
  const [placement, setPlacement] = useState("after");
  const [targetPosition, setTargetPosition] = useState(defaultPosition);
  const [sourceMode, setSourceMode] = useState("pdf");
  const [sourceBytes, setSourceBytes] = useState(null);
  const [sourceName, setSourceName] = useState("");
  const [sourcePagesCount, setSourcePagesCount] = useState(0);
  const [sourceStart, setSourceStart] = useState(1);
  const [sourceEnd, setSourceEnd] = useState(1);
  const [blankPageCount, setBlankPageCount] = useState(1);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const isBlankMode = sourceMode === "blank";
  const sourceCount = isBlankMode
    ? blankPageCount
    : Math.max(0, sourceEnd - sourceStart + 1);
  const canInsert =
    targetPosition >= 1 &&
    targetPosition <= pagesCount &&
    (isBlankMode
      ? blankPageCount >= 1
      : Boolean(sourceBytes) &&
        sourceCount > 0 &&
        sourceEnd <= sourcePagesCount);
  const insertAfterPosition =
    placement === "before" ? targetPosition - 2 : targetPosition - 1;
  const summary = useMemo(() => {
    if (isBlankMode) {
      return blankPageCount === 1
        ? t("1 pagina vuota da inserire")
        : t("{{count}} pagine vuote da inserire", {
            count: blankPageCount,
          });
    }
    if (!sourceName) {
      return t("Scegli un PDF da inserire nel documento.");
    }
    return t("{{count}} pagine da {{name}}", {
      count: sourceCount,
      name: sourceName,
    });
  }, [blankPageCount, isBlankMode, sourceCount, sourceName, t]);

  async function selectInsertionFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBusy(true);
    setStatus(t("Lettura PDF da inserire..."));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { getPdfPageCount } = await import("../../pdf/pdfMerge.js");
      const count = await getPdfPageCount(bytes);
      setSourceBytes(bytes);
      setSourceName(file.name);
      setSourcePagesCount(count);
      setSourceStart(1);
      setSourceEnd(count);
      setStatus("");
    } catch (reason) {
      setStatus(
        reason?.message || t("Impossibile leggere il PDF da inserire.")
      );
      setSourceBytes(null);
      setSourceName("");
      setSourcePagesCount(0);
    } finally {
      setBusy(false);
    }
  }

  function updateSourceStart(value) {
    const nextStart = clampNumber(value, 1, sourcePagesCount || 1);
    setSourceStart(nextStart);
    if (nextStart > sourceEnd) {
      setSourceEnd(nextStart);
    }
  }

  async function submitInsertion() {
    if (!canInsert) {
      setStatus(
        isBlankMode
          ? t("Scegli quante pagine vuote inserire.")
          : t("Scegli pagine valide dal PDF da inserire.")
      );
      return;
    }
    if (isBlankMode) {
      const { createBlankPdf } = await import("../../pdf/blankPdf.js");
      const blankBytes = createBlankPdf({
        pageCount: blankPageCount,
        pageSize: getBlankPageSize(viewerState, pageOrganizer, targetPosition),
      });
      pageOrganizer.addInsertion({
        insertAfterPosition,
        sourceBytes: blankBytes,
        sourceEndPage: blankPageCount,
        sourceName: t("Pagine vuote"),
        sourcePagesCount: blankPageCount,
        sourceStartPage: 1,
        sourceType: "blank",
      });
      onClose();
      return;
    }
    pageOrganizer.addInsertion({
      insertAfterPosition,
      sourceBytes,
      sourceEndPage: sourceEnd,
      sourceName,
      sourcePagesCount,
      sourceStartPage: sourceStart,
    });
    onClose();
  }

  return (
    <div className="organizer-action-backdrop" role="presentation">
      <section
        aria-labelledby="insert-pages-title"
        className="organizer-action-dialog insert-pages-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>{t("Organizza pagine")}</span>
            <h3 id="insert-pages-title">{t("Inserisci pagine")}</h3>
          </div>
          <button aria-label={t("Chiudi")} onClick={onClose} type="button">
            <Icon>close</Icon>
          </button>
        </header>
        <div className="replace-pages-section">
          <strong>{t("Posizione")}</strong>
          <div className="insert-pages-position">
            <label>
              <span>{t("Inserisci")}</span>
              <select
                onChange={event => setPlacement(event.target.value)}
                value={placement}
              >
                <option value="after">{t("Dopo")}</option>
                <option value="before">{t("Prima")}</option>
              </select>
            </label>
            <label>
              <span>{t("Pagina")}</span>
              <input
                max={pagesCount}
                min="1"
                onChange={event =>
                  setTargetPosition(
                    clampNumber(event.target.value, 1, pagesCount)
                  )
                }
                type="number"
                value={targetPosition}
              />
            </label>
            <small>{t("di {{count}}", { count: pagesCount })}</small>
          </div>
        </div>
        <div className="replace-pages-section">
          <strong>{t("Pagine da inserire")}</strong>
          <div
            aria-label={t("Origine inserimento")}
            className="insert-source-mode"
            role="group"
          >
            <button
              aria-pressed={!isBlankMode}
              className={!isBlankMode ? "active" : ""}
              onClick={() => {
                setSourceMode("pdf");
                setStatus("");
              }}
              type="button"
            >
              <Icon>upload_file</Icon>
              {t("PDF")}
            </button>
            <button
              aria-pressed={isBlankMode}
              className={isBlankMode ? "active" : ""}
              onClick={() => {
                setSourceMode("blank");
                setStatus("");
              }}
              type="button"
            >
              <Icon>note_add</Icon>
              {t("Pagine vuote")}
            </button>
          </div>
          {isBlankMode ? (
            <div className="replace-pages-range insert-blank-pages">
              <label>
                <span>{t("Pagine")}</span>
                <input
                  max="100"
                  min="1"
                  onChange={event =>
                    setBlankPageCount(clampNumber(event.target.value, 1, 100))
                  }
                  type="number"
                  value={blankPageCount}
                />
              </label>
              <small>{t("Massimo {{count}}", { count: 100 })}</small>
            </div>
          ) : (
            <>
              <input
                accept="application/pdf,.pdf"
                className="hidden-input"
                onChange={selectInsertionFile}
                ref={inputRef}
                type="file"
              />
              <button
                className="replace-file-button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                type="button"
              >
                <Icon>upload_file</Icon>
                <span>{sourceName || t("Scegli PDF")}</span>
              </button>
              <div className="replace-pages-range">
                <label>
                  <span>{t("Da")}</span>
                  <input
                    disabled={!sourcePagesCount}
                    max={sourcePagesCount || 1}
                    min="1"
                    onChange={event => updateSourceStart(event.target.value)}
                    type="number"
                    value={sourceStart}
                  />
                </label>
                <label>
                  <span>{t("A")}</span>
                  <input
                    disabled={!sourcePagesCount}
                    max={sourcePagesCount || 1}
                    min={sourceStart}
                    onChange={event =>
                      setSourceEnd(
                        clampNumber(
                          event.target.value,
                          sourceStart,
                          sourcePagesCount || 1
                        )
                      )
                    }
                    type="number"
                    value={sourceEnd}
                  />
                </label>
                <small>
                  {sourcePagesCount
                    ? t("di {{count}}", { count: sourcePagesCount })
                    : t("PDF non scelto")}
                </small>
              </div>
            </>
          )}
          <p>{summary}</p>
        </div>
        {status ? (
          <div className="replace-pages-status" role="status">
            {status}
          </div>
        ) : null}
        <footer>
          <button onClick={onClose} type="button">
            {t("Annulla")}
          </button>
          <button
            className="primary"
            disabled={!canInsert || busy}
            onClick={submitInsertion}
            type="button"
          >
            {t("Inserisci")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function ExtractPagesDialog({
  currentPage,
  onClose,
  onExtractPages,
  pageOrganizer,
}) {
  const { t } = useTranslation();
  const [busyMode, setBusyMode] = useState("");
  const extractionDraft = pageOrganizer.getExtractionDraft(currentPage);
  const extractedCount = extractionDraft.order.length;
  const positionLabel =
    extractedCount === 1
      ? t("Pagina {{page}}", { page: extractionDraft.positions[0] || 1 })
      : extractionDraft.positions.join(", ");

  async function runExtract(mode) {
    setBusyMode(mode);
    try {
      await onExtractPages(mode, extractionDraft);
      onClose();
    } finally {
      setBusyMode("");
    }
  }

  return (
    <div className="organizer-action-backdrop" role="presentation">
      <section
        aria-labelledby="extract-pages-title"
        className="organizer-action-dialog extract-pages-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>{t("Organizza pagine")}</span>
            <h3 id="extract-pages-title">{t("Estrai pagine")}</h3>
          </div>
          <button aria-label={t("Chiudi")} onClick={onClose} type="button">
            <Icon>close</Icon>
          </button>
        </header>
        <div className="extract-pages-summary">
          <Icon>ios_share</Icon>
          <div>
            <strong>
              {extractedCount === 1
                ? t("1 pagina pronta")
                : t("{{count}} pagine pronte", { count: extractedCount })}
            </strong>
            <span>
              {t("Verranno estratte: {{pages}}", { pages: positionLabel })}
            </span>
          </div>
        </div>
        <div className="extract-pages-options">
          <button
            disabled={!extractedCount || Boolean(busyMode)}
            onClick={() => runExtract("download")}
            type="button"
          >
            <Icon>download</Icon>
            <span>
              <strong>{t("Scarica PDF estratto")}</strong>
              <small>{t("Crea un file separato da salvare.")}</small>
            </span>
          </button>
          <button
            disabled={!extractedCount || Boolean(busyMode)}
            onClick={() => runExtract("open")}
            type="button"
          >
            <Icon>tab_new_right</Icon>
            <span>
              <strong>{t("Apri come nuovo PDF")}</strong>
              <small>{t("Apre le pagine estratte in una nuova scheda.")}</small>
            </span>
          </button>
        </div>
        <footer>
          <button onClick={onClose} type="button">
            {t("Annulla")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function SplitPagesDialog({
  onClose,
  onSplitPages,
  pageOrganizer,
  pagesCount,
}) {
  const { t } = useTranslation();
  const defaultPagesPerFile = Math.min(6, Math.max(1, pagesCount || 1));
  const [pagesPerFile, setPagesPerFile] = useState(defaultPagesPerFile);
  const [busyMode, setBusyMode] = useState("");
  const splitDrafts = pageOrganizer.getSplitDrafts(pagesPerFile);
  const fileCount = splitDrafts.length;
  const canSplit = pagesCount > 1 && pagesPerFile >= 1 && fileCount > 0;
  const previewBlocks = splitDrafts.slice(0, 6).map((draft, index) => ({
    id: `split-${index}`,
    label: t("File {{index}}", { index: index + 1 }),
    range: formatPageRange(draft.positions),
    count: draft.positions.length,
  }));
  const hiddenBlocks = Math.max(0, fileCount - previewBlocks.length);

  async function runSplit(mode) {
    if (!canSplit) {
      return;
    }
    setBusyMode(mode);
    try {
      await onSplitPages(mode, splitDrafts, pagesPerFile);
      onClose();
    } finally {
      setBusyMode("");
    }
  }

  function updatePagesPerFile(value) {
    setPagesPerFile(clampNumber(value, 1, Math.max(1, pagesCount || 1)));
  }

  return (
    <div className="organizer-action-backdrop" role="presentation">
      <section
        aria-labelledby="split-pages-title"
        className="organizer-action-dialog split-pages-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>{t("Organizza pagine")}</span>
            <h3 id="split-pages-title">{t("Dividi pagine")}</h3>
          </div>
          <button aria-label={t("Chiudi")} onClick={onClose} type="button">
            <Icon>close</Icon>
          </button>
        </header>
        <div className="extract-pages-summary split-pages-summary">
          <Icon>call_split</Icon>
          <div>
            <strong>
              {t("Dividi ogni {{count}} pagine", { count: pagesPerFile })}
            </strong>
            <span>
              {t("Creera' {{count}} PDF separati", { count: fileCount })}
            </span>
          </div>
        </div>
        <div className="split-pages-config">
          <label>
            <span>{t("Pagine per PDF")}</span>
            <input
              max={Math.max(1, pagesCount || 1)}
              min="1"
              onChange={event => updatePagesPerFile(event.target.value)}
              type="number"
              value={pagesPerFile}
            />
          </label>
          <small>
            {t("La divisione segue l'ordine corrente della bozza.")}
          </small>
        </div>
        <div
          className="split-pages-preview"
          aria-label={t("Anteprima divisione")}
        >
          {previewBlocks.map(block => (
            <div key={block.id}>
              <strong>{block.label}</strong>
              <span>{t("Pagine {{pages}}", { pages: block.range })}</span>
              <small>
                {block.count === 1
                  ? t("1 pagina")
                  : t("{{count}} pagine", { count: block.count })}
              </small>
            </div>
          ))}
          {hiddenBlocks ? (
            <div className="muted">
              <strong>{t("+{{count}} altri", { count: hiddenBlocks })}</strong>
              <span>{t("Visibili dopo la creazione.")}</span>
            </div>
          ) : null}
        </div>
        <div className="extract-pages-options">
          <button
            disabled={!canSplit || Boolean(busyMode)}
            onClick={() => runSplit("download")}
            type="button"
          >
            <Icon>download</Icon>
            <span>
              <strong>{t("Scarica PDF divisi")}</strong>
              <small>{t("Crea un download per ogni blocco.")}</small>
            </span>
          </button>
          <button
            disabled={!canSplit || Boolean(busyMode)}
            onClick={() => runSplit("open")}
            type="button"
          >
            <Icon>tab_new_right</Icon>
            <span>
              <strong>{t("Apri come nuovi PDF")}</strong>
              <small>{t("Apre ogni blocco come scheda separata.")}</small>
            </span>
          </button>
        </div>
        <footer>
          <button onClick={onClose} type="button">
            {t("Annulla")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function ReplacePagesDialog({
  currentPage,
  onClose,
  pageOrganizer,
  pagesCount,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const selectedPositions = pageOrganizer.getSelectedPositions();
  const currentPosition = Math.max(
    1,
    pageOrganizer.draftOrder.indexOf(currentPage || 1) + 1
  );
  const defaultStart = selectedPositions.length
    ? Math.min(...selectedPositions)
    : currentPosition;
  const defaultEnd = selectedPositions.length
    ? Math.max(...selectedPositions)
    : currentPosition;
  const [targetStart, setTargetStart] = useState(defaultStart);
  const [targetEnd, setTargetEnd] = useState(defaultEnd);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [sourceName, setSourceName] = useState("");
  const [sourcePagesCount, setSourcePagesCount] = useState(0);
  const [sourceStart, setSourceStart] = useState(1);
  const [sourceEnd, setSourceEnd] = useState(1);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const targetCount = Math.max(0, targetEnd - targetStart + 1);
  const sourceCount = Math.max(0, sourceEnd - sourceStart + 1);
  const canReplace =
    Boolean(sourceBytes) &&
    targetCount > 0 &&
    sourceCount === targetCount &&
    sourceEnd <= sourcePagesCount;

  const summary = useMemo(() => {
    if (!sourceName) {
      return t("Scegli un PDF per sostituire le pagine selezionate.");
    }
    return t("{{count}} pagine da {{name}}", {
      count: sourceCount,
      name: sourceName,
    });
  }, [sourceCount, sourceName, t]);

  async function selectReplacementFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBusy(true);
    setStatus(t("Lettura PDF sostitutivo..."));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { getPdfPageCount } = await import("../../pdf/pdfMerge.js");
      const count = await getPdfPageCount(bytes);
      const nextSourceEnd = Math.min(count, sourceStart + targetCount - 1);
      setSourceBytes(bytes);
      setSourceName(file.name);
      setSourcePagesCount(count);
      setSourceEnd(nextSourceEnd);
      setStatus("");
    } catch (reason) {
      setStatus(
        reason?.message || t("Impossibile leggere il PDF sostitutivo.")
      );
      setSourceBytes(null);
      setSourceName("");
      setSourcePagesCount(0);
    } finally {
      setBusy(false);
    }
  }

  function updateTargetStart(value) {
    const nextStart = clampNumber(value, 1, pagesCount);
    setTargetStart(nextStart);
    if (nextStart > targetEnd) {
      setTargetEnd(nextStart);
    }
    if (sourcePagesCount) {
      setSourceEnd(
        Math.min(
          sourcePagesCount,
          sourceStart + Math.max(0, targetEnd - nextStart)
        )
      );
    }
  }

  function updateTargetEnd(value) {
    const nextEnd = clampNumber(value, targetStart, pagesCount);
    setTargetEnd(nextEnd);
    if (sourcePagesCount) {
      setSourceEnd(
        Math.min(sourcePagesCount, sourceStart + nextEnd - targetStart)
      );
    }
  }

  function updateSourceStart(value) {
    const nextStart = clampNumber(value, 1, sourcePagesCount || 1);
    setSourceStart(nextStart);
    if (sourcePagesCount) {
      setSourceEnd(Math.min(sourcePagesCount, nextStart + targetCount - 1));
    }
  }

  function submitReplacement() {
    if (!canReplace) {
      setStatus(
        t("Usa lo stesso numero di pagine per origine e sostituzione.")
      );
      return;
    }
    pageOrganizer.addReplacement({
      sourceBytes,
      sourceEndPage: sourceEnd,
      sourceName,
      sourcePagesCount,
      sourceStartPage: sourceStart,
      targetEndPosition: targetEnd,
      targetStartPosition: targetStart,
    });
    onClose();
  }

  return (
    <div className="organizer-action-backdrop" role="presentation">
      <section
        aria-labelledby="replace-pages-title"
        className="organizer-action-dialog replace-pages-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>{t("Organizza pagine")}</span>
            <h3 id="replace-pages-title">{t("Sostituisci pagine")}</h3>
          </div>
          <button aria-label={t("Chiudi")} onClick={onClose} type="button">
            <Icon>close</Icon>
          </button>
        </header>
        <div className="replace-pages-section">
          <strong>{t("Originale")}</strong>
          <div className="replace-pages-range">
            <label>
              <span>{t("Da")}</span>
              <input
                min="1"
                max={pagesCount}
                onChange={event => updateTargetStart(event.target.value)}
                type="number"
                value={targetStart}
              />
            </label>
            <label>
              <span>{t("A")}</span>
              <input
                min={targetStart}
                max={pagesCount}
                onChange={event => updateTargetEnd(event.target.value)}
                type="number"
                value={targetEnd}
              />
            </label>
            <small>{t("di {{count}}", { count: pagesCount })}</small>
          </div>
        </div>
        <div className="replace-pages-section">
          <strong>{t("Sostituzione")}</strong>
          <input
            accept="application/pdf,.pdf"
            className="hidden-input"
            onChange={selectReplacementFile}
            ref={inputRef}
            type="file"
          />
          <button
            className="replace-file-button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <Icon>upload_file</Icon>
            <span>{sourceName || t("Scegli PDF")}</span>
          </button>
          <div className="replace-pages-range">
            <label>
              <span>{t("Da")}</span>
              <input
                disabled={!sourcePagesCount}
                min="1"
                max={sourcePagesCount || 1}
                onChange={event => updateSourceStart(event.target.value)}
                type="number"
                value={sourceStart}
              />
            </label>
            <label>
              <span>{t("A")}</span>
              <input
                disabled={!sourcePagesCount}
                min={sourceStart}
                max={sourcePagesCount || 1}
                onChange={event =>
                  setSourceEnd(
                    clampNumber(
                      event.target.value,
                      sourceStart,
                      sourcePagesCount || 1
                    )
                  )
                }
                type="number"
                value={sourceEnd}
              />
            </label>
            <small>
              {sourcePagesCount
                ? t("di {{count}}", { count: sourcePagesCount })
                : t("PDF non scelto")}
            </small>
          </div>
          <p>{summary}</p>
        </div>
        {status ? (
          <div className="replace-pages-status" role="status">
            {status}
          </div>
        ) : null}
        <footer>
          <button onClick={onClose} type="button">
            {t("Annulla")}
          </button>
          <button
            className="primary"
            disabled={!canReplace || busy}
            onClick={submitReplacement}
            type="button"
          >
            {t("Sostituisci")}
          </button>
        </footer>
      </section>
    </div>
  );
}
