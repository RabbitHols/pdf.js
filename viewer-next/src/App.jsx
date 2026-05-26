import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shouldShowUnimplementedTools } from "./app/debugSettings.js";
import {
  getPdfActionPolicy,
  inferPdfActionId,
} from "./app/pdfActionPolicy.js";
import { buildExportFilename } from "./app/preferences.js";
import { defaultTextStyle } from "./app/toolData.js";
import {
  documentViewIds,
  getInitialView,
  initialToolByView,
  normalizeView,
  requiresDocumentView,
  toolViewIds,
  updateUrl,
} from "./app/viewRouting.js";
import { SideNav } from "./components/sidebars/SideNav.jsx";
import { TopNav } from "./components/TopNav.jsx";
import { Icon } from "./components/Icon.jsx";
import { PdfViewerSurface } from "./components/PdfViewerSurface.jsx";
import { usePageOrganizerState } from "./hooks/usePageOrganizerState.js";
import { usePagePreviewSnapshots } from "./hooks/usePagePreviewSnapshots.js";
import { useEditHistory } from "./hooks/useEditHistory.js";
import { usePdfTabs } from "./hooks/usePdfTabs.js";
import { usePdfViewerActions } from "./hooks/usePdfViewerActions.js";
import { useTranslation } from "./i18n/index.js";
import { createDefaultViewerInteractionState } from "./pdf/viewerInteractionState.js";
import {
  getActivePdfTabId,
  getStoredPdfTabAsync,
} from "./pdf/pdfStorage.js";
import { useTheme } from "./theme/index.js";
import { EditView, SignView } from "./views/DocumentEditorView.jsx";
import demoPdfUrl from "../../test/pdfs/tracemonkey.pdf?url";

const AllToolsView = lazy(() =>
  import("./views/AllToolsView.jsx").then(module => ({
    default: module.AllToolsView,
  }))
);
const CombinePdfView = lazy(() =>
  import("./views/CombinePdfView.jsx").then(module => ({
    default: module.CombinePdfView,
  }))
);
const ConvertView = lazy(() =>
  import("./views/ConvertView.jsx").then(module => ({
    default: module.ConvertView,
  }))
);
const HomeView = lazy(() =>
  import("./views/HomeView.jsx").then(module => ({
    default: module.HomeView,
  }))
);
const OptionsView = lazy(() =>
  import("./views/OptionsView.jsx").then(module => ({
    default: module.OptionsView,
  }))
);

const initialViewerState = {
  activeTool: "select",
  bookmarks: {
    canAddFromSelection: false,
    count: 0,
    error: null,
    items: [],
    status: "idle",
  },
  comments: {
    comments: [],
    pendingDraft: null,
    selectedCommentId: null,
    status: "",
  },
  editing: {
    hasSelectedEditor: false,
    hasSomethingToRedo: false,
    hasSomethingToUndo: false,
    runtimeHistory: {
      entries: [],
      position: -1,
    },
  },
  draw: {
    stampSelection: null,
    style: {
      color: "#1f2937",
      fillColor: "",
      strokeWidth: 2,
    },
    tool: "draw",
  },
  error: null,
  find: {
    matchesCount: {
      current: 0,
      total: 0,
    },
    rawQuery: null,
    state: "idle",
  },
  freeTextFonts: {
    internal: [],
  },
  freeTextStyle: defaultTextStyle,
  highlightColor: "#ffea00",
  loading: false,
  nativeEditing: {
    message: "",
    redactionPatches: 0,
    redactActive: false,
    redactPageNumber: null,
    textEditEditableCount: 0,
    textEditActive: false,
    textEditCommitted: false,
    textEditPageNumber: null,
    textEditUnsupportedCount: 0,
  },
  pageNumber: 1,
  pagePdfSize: null,
  pdfSecurity: {
    error: null,
    metadata: {
      encryptFilterName: null,
      isSignaturesPresent: false,
    },
    permissions: {
      details: [],
      hasRestrictions: false,
      isAvailable: false,
      raw: null,
      summary: "unknown",
    },
    signatures: {
      count: 0,
      details: [],
      hasDigitalSignatures: false,
      status: "none",
      verificationSupported: false,
    },
    status: "idle",
  },
  pagesCount: 0,
  pageSizes: [],
  rotation: 0,
  scale: 0,
  scalePercent: 0,
  scaleValue: "page-width",
  viewerInteractionState: createDefaultViewerInteractionState(),
};

function normalizeTextStyle(style, fallback = defaultTextStyle) {
  const fontSize = Number(style?.fontSize);
  const lineSpacing = Number(style?.lineSpacing);
  const indent = Number(style?.indent);
  const horizontalScale = Number(style?.horizontalScale);
  const charSpacing = Number(style?.charSpacing);
  return {
    bold: Boolean(style?.bold ?? fallback.bold),
    charSpacing: Number.isFinite(charSpacing)
      ? charSpacing
      : fallback.charSpacing,
    color:
      typeof style?.color === "string" && style.color
        ? style.color
        : fallback.color,
    fontFamily:
      typeof style?.fontFamily === "string" && style.fontFamily
        ? style.fontFamily
        : fallback.fontFamily,
    fontSize:
      Number.isFinite(fontSize) && fontSize > 0
        ? fontSize
        : fallback.fontSize,
    horizontalScale:
      Number.isFinite(horizontalScale) && horizontalScale > 0
        ? horizontalScale
        : fallback.horizontalScale,
    indent: Number.isFinite(indent) ? indent : fallback.indent,
    italic: Boolean(style?.italic ?? fallback.italic),
    lineSpacing:
      Number.isFinite(lineSpacing) && lineSpacing > 0
        ? lineSpacing
        : fallback.lineSpacing,
    listStyle:
      typeof style?.listStyle === "string" && style.listStyle
        ? style.listStyle
        : fallback.listStyle,
    script:
      typeof style?.script === "string" && style.script
        ? style.script
        : fallback.script,
    textAlign:
      typeof style?.textAlign === "string" && style.textAlign
        ? style.textAlign
        : fallback.textAlign,
    underline: Boolean(style?.underline ?? fallback.underline),
  };
}

function areTextStylesEqual(first, second) {
  return (
    first.bold === second.bold &&
    first.charSpacing === second.charSpacing &&
    first.color === second.color &&
    first.fontFamily === second.fontFamily &&
    first.fontSize === second.fontSize &&
    first.horizontalScale === second.horizontalScale &&
    first.indent === second.indent &&
    first.italic === second.italic &&
    first.lineSpacing === second.lineSpacing &&
    first.listStyle === second.listStyle &&
    first.script === second.script &&
    first.textAlign === second.textAlign &&
    first.underline === second.underline
  );
}

const editorActionActivation = {
  "bookmarks-panel": {
    panel: "bookmarks",
    tool: "select",
  },
  "comments-panel": {
    panel: "comments",
    tool: "select",
  },
  "pages-organizer": {
    pageOrganizerMode: "full",
    tool: "select",
  },
  "extract-pages": {
    pageOrganizerDialog: "extract",
    pageOrganizerMode: "full",
    tool: "select",
  },
  "pages-panel": {
    pageOrganizerMode: "quick",
    panel: "pages",
    tool: "select",
  },
  "protect-pdf": {
    panel: "protect",
    tool: "select",
  },
  "stamp-palette": {
    panel: "stamps",
    tool: "select",
  },
};

function getExtractedFilename(name = "document.pdf") {
  return name.replace(/\.pdf$/i, "") + "-extracted.pdf";
}

function getSplitFilename(name = "document.pdf", index = 1) {
  const suffix = String(index).padStart(2, "0");
  return name.replace(/\.pdf$/i, "") + `-split-${suffix}.pdf`;
}

function getProtectedFilename(name = "document.pdf") {
  return name.replace(/\.pdf$/i, "") + "-protected.pdf";
}

function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getEditorActionActivation(action) {
  if (!action) {
    return {};
  }
  return editorActionActivation[action] || { tool: action };
}

function isMobileReaderViewport() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  if (!navigator.maxTouchPoints) {
    return false;
  }
  return window.matchMedia(
    [
      "((hover: none) and (pointer: coarse))",
      "((any-pointer: coarse) and (max-width: 1366px))",
    ].join(", ")
  ).matches;
}

function useMobileReaderMode() {
  const [isMobileReader, setIsMobileReader] = useState(
    isMobileReaderViewport
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const queries = [
      window.matchMedia("((hover: none) and (pointer: coarse))"),
      window.matchMedia("((any-pointer: coarse) and (max-width: 1366px))"),
    ];
    const update = () => setIsMobileReader(isMobileReaderViewport());
    for (const query of queries) {
      query.addEventListener("change", update);
    }
    update();
    return () => {
      for (const query of queries) {
        query.removeEventListener("change", update);
      }
    };
  }, []);

  return isMobileReader;
}

function MobileReaderShell({
  activePdfTabId,
  closePdfTab,
  documentInfo,
  onDocumentLoaded,
  onOpenFile,
  onSelectPdfTab,
  onViewerStateChange,
  pdfHandleRef,
  pdfTabs,
  viewerState,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);

  async function onFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await onOpenFile(file);
    }
  }

  const pageNumber = viewerState.pageNumber || 1;
  const pagesCount = viewerState.pagesCount || 0;

  return (
    <div className="mobile-reader-shell">
      <input
        accept="application/pdf,.pdf"
        className="hidden-input"
        onChange={onFileChange}
        ref={inputRef}
        type="file"
      />
      <header className="mobile-reader-topbar">
        <div>
          <span>{t("Modalita lettura")}</span>
          <strong>{documentInfo?.name || "Viewer Next"}</strong>
        </div>
        <button onClick={() => inputRef.current?.click()} type="button">
          <Icon>upload_file</Icon>
          {t("Apri PDF")}
        </button>
      </header>
      <div className="mobile-reader-notice" role="status">
        <Icon>desktop_windows</Icon>
        <span>
          <strong>{t("Editor disponibile da desktop")}</strong>
          <small>
            {t(
              "Su mobile e tablet Viewer Next apre i PDF solo in lettura."
            )}
          </small>
        </span>
      </div>
      {documentInfo ? (
        <main className="mobile-reader-document">
          <PdfViewerSurface
            documentInfo={documentInfo}
            onDocumentLoaded={onDocumentLoaded}
            onViewerStateChange={onViewerStateChange}
            readOnly
            ref={pdfHandleRef}
          />
          <nav aria-label={t("Pagina corrente")} className="mobile-reader-bar">
            <button
              aria-label={t("Previous page")}
              disabled={pageNumber <= 1}
              onClick={() => pdfHandleRef.current?.previousPage()}
              type="button"
            >
              <Icon>chevron_left</Icon>
            </button>
            <span>
              {pagesCount
                ? t("Page {{page}} of {{count}}", {
                    count: pagesCount,
                    page: pageNumber,
                  })
                : t("Pagina {{pageNumber}}", { pageNumber })}
            </span>
            <button
              aria-label={t("Next page")}
              disabled={Boolean(pagesCount) && pageNumber >= pagesCount}
              onClick={() => pdfHandleRef.current?.nextPage()}
              type="button"
            >
              <Icon>chevron_right</Icon>
            </button>
            <button
              aria-label={t("Zoom out")}
              onClick={() => pdfHandleRef.current?.zoomOut()}
              type="button"
            >
              <Icon>remove</Icon>
            </button>
            <button
              aria-label={t("Zoom in")}
              onClick={() => pdfHandleRef.current?.zoomIn()}
              type="button"
            >
              <Icon>add</Icon>
            </button>
            <button
              aria-label={t("Chiudi")}
              disabled={!activePdfTabId}
              onClick={() => {
                if (activePdfTabId) {
                  closePdfTab(activePdfTabId);
                }
              }}
              type="button"
            >
              <Icon>close</Icon>
            </button>
          </nav>
        </main>
      ) : (
        <main className="mobile-reader-empty">
          <Icon>picture_as_pdf</Icon>
          <h1>{t("Apri o riprendi un PDF")}</h1>
          <p>
            {t(
              "Su mobile puoi leggere il documento. Gli strumenti di modifica sono disponibili da desktop."
            )}
          </p>
          <button onClick={() => inputRef.current?.click()} type="button">
            <Icon>upload_file</Icon>
            {t("Apri PDF")}
          </button>
          {pdfTabs.length ? (
            <div className="mobile-reader-recents">
              {pdfTabs.map(tab => (
                <button
                  className={tab.id === activePdfTabId ? "active" : ""}
                  key={tab.id}
                  onClick={() => onSelectPdfTab(tab.id)}
                  type="button"
                >
                  <Icon>picture_as_pdf</Icon>
                  <span>{tab.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </main>
      )}
    </div>
  );
}

export function App() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme, theme } = useTheme();
  const isMobileReader = useMobileReaderMode();
  const [view, setView] = useState(() => normalizeView(getInitialView()));
  const [contextSidebarOpen, setContextSidebarOpen] = useState(true);
  const [documentPanelOpen, setDocumentPanelOpen] = useState(false);
  const [activeEditorPanel, setActiveEditorPanel] = useState(null);
  const [editorEntryAction, setEditorEntryAction] = useState(null);
  const [pageOrganizerInitialDialog, setPageOrganizerInitialDialog] =
    useState(null);
  const [pageOrganizerMode, setPageOrganizerMode] = useState(null);
  const [pageOrganizerBusy, setPageOrganizerBusy] = useState(false);
  const [documentActionStatus, setDocumentActionStatus] = useState({
    message: "",
    state: "idle",
    type: "",
  });
  const [pageInfo, setPageInfo] = useState({ pagesCount: 0 });
  const [viewerState, setViewerState] = useState(initialViewerState);
  const [highlightColor, setHighlightColor] = useState("#ffea00");
  const [stampSelection, setStampSelection] = useState(null);
  const [textStyle, setTextStyle] = useState(defaultTextStyle);
  const pdfHandleRef = useRef(null);
  const nativeHistoryStateRef = useRef({
    activeDocumentId: null,
    redactionPatches: 0,
    textEditCommitted: false,
  });
  const signedSaveWarningRef = useRef({
    documentId: null,
    warned: false,
  });
  const activePdfTabIdRef = useRef(null);
  const documentInfoRef = useRef(null);
  const demoPdfLoadStartedRef = useRef(false);
  const lastEditorInitialToolRef = useRef("select");
  const lastEditorViewRef = useRef("edit");
  const mergePdfSourcesRef = useRef(new Map());
  const viewRef = useRef(view);
  const pdfActions = usePdfViewerActions(pdfHandleRef);
  const pageOrganizer = usePageOrganizerState(viewerState.pagesCount || 0);
  const viewerInteractionState =
    viewerState.viewerInteractionState ||
    initialViewerState.viewerInteractionState;
  const confirmedActiveTool = viewerInteractionState.activeTool || "select";
  const getPageThumbnails = useCallback(
    onUpdate => pdfHandleRef.current?.getPageThumbnails?.(onUpdate) || {},
    []
  );

  const snapshotActivePdfForMerge = useCallback(async () => {
    const activeId = activePdfTabIdRef.current;
    const currentDocument = documentInfoRef.current;
    const exportData = await pdfHandleRef.current?.exportData?.();
    if (!activeId || !currentDocument || !exportData?.data) {
      return;
    }
    const data =
      exportData.data instanceof Uint8Array
        ? exportData.data.slice()
        : new Uint8Array(exportData.data);
    mergePdfSourcesRef.current.set(activeId, {
      data,
      name: currentDocument.name,
      size: data.byteLength || data.length || currentDocument.size || 0,
      source: exportData.kind || "viewer-export",
      type: "application/pdf",
    });
  }, []);

  const navigate = useCallback(
    async (nextView, options = {}) => {
      const normalized = normalizeView(nextView);
      if (
        viewRef.current !== normalized &&
        activePdfTabIdRef.current &&
        pdfHandleRef.current?.exportData
      ) {
        try {
          await snapshotActivePdfForMerge();
        } catch (reason) {
          console.warn(
            "Viewer Next PDF snapshot before navigation failed.",
            reason
          );
        }
      }
      const nextEditorAction =
        normalized === "edit" ? options.editorAction || null : null;
      const editorActivation = getEditorActionActivation(nextEditorAction);
      const keepsStampPanel =
        normalized === "edit" && editorActivation.panel === "stamps";
      if (!keepsStampPanel) {
        setStampSelection(null);
        pdfActions.setStampSelection(null);
      }
      setDocumentPanelOpen(false);
      setActiveEditorPanel(editorActivation.panel || null);
      setEditorEntryAction(nextEditorAction);
      setPageOrganizerInitialDialog(editorActivation.pageOrganizerDialog || null);
      setPageOrganizerMode(editorActivation.pageOrganizerMode || null);
      setContextSidebarOpen(true);
      const initialTool =
        editorActivation.tool || initialToolByView[normalized];
      if (initialTool) {
        pdfActions.setTool(initialTool);
      }
      setView(normalized);
      viewRef.current = normalized;
      updateUrl(normalized, options);
    },
    [pdfActions, snapshotActivePdfForMerge]
  );
  const {
    activePdfTabId,
    closePdfTab,
    documentInfo,
    openPdfFile,
    pdfTabs,
    selectPdfTab,
  } = usePdfTabs({ navigate });

  useEffect(() => {
    if (documentInfo || demoPdfLoadStartedRef.current) {
      return;
    }
    demoPdfLoadStartedRef.current = true;
    async function openDemoPdf() {
      try {
        if (documentInfoRef.current || getActivePdfTabId()) {
          return;
        }
        const response = await fetch(demoPdfUrl);
        if (!response.ok) {
          throw new Error(`viewer-next-demo-pdf-${response.status}`);
        }
        const blob = await response.blob();
        if (documentInfoRef.current || getActivePdfTabId()) {
          return;
        }
        await openPdfFile(
          new File([blob], "tracemonkey.pdf", {
            type: "application/pdf",
          }),
          { source: "viewer-next-demo" }
        );
      } catch (reason) {
        demoPdfLoadStartedRef.current = false;
        console.error("Viewer Next demo PDF failed to load.", reason);
      }
    }
    void openDemoPdf();
  }, [documentInfo, openPdfFile]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);
  const getOpenPdfSource = useCallback(async id => {
    const snapshot = mergePdfSourcesRef.current.get(id);
    if (snapshot?.data) {
      return {
        ...snapshot,
        data: snapshot.data.slice(),
      };
    }
    return getStoredPdfTabAsync(id);
  }, []);

  const editHistory = useEditHistory({
    activePdfTabId,
    documentInfo,
    onSelectPdfTab: selectPdfTab,
  });
  const hasDocument = Boolean(documentInfo);
  const showUnimplementedTools = shouldShowUnimplementedTools();
  const guardedView =
    view === "convert" && !showUnimplementedTools
      ? hasDocument
        ? "all-tools"
        : "home"
      : !hasDocument && requiresDocumentView(view)
        ? "home"
        : view;
  const pagePreviews = usePagePreviewSnapshots({
    documentKey: activePdfTabId,
    enabled: activeEditorPanel === "pages" || pageOrganizerMode === "full",
    getPageThumbnails,
    pageNumber: viewerState.pageNumber,
    pagesCount: viewerState.pagesCount || 0,
  });
  const getActionPolicy = useCallback(
    action => {
      const nativeEditing = viewerState.nativeEditing || {};
      return getPdfActionPolicy(
        inferPdfActionId(action),
        {
          editing: viewerState.editing,
          hasDocument,
          hasPageDraftChanges: pageOrganizer.hasDraftChanges,
          loading: viewerState.loading,
          nativeEditing,
          pagesCount: viewerState.pagesCount || 0,
          pdfSecurity: viewerState.pdfSecurity,
          viewerInteractionState,
        },
        t
      );
    },
    [
      hasDocument,
      pageOrganizer.hasDraftChanges,
      t,
      viewerInteractionState,
      viewerState.editing,
      viewerState.loading,
      viewerState.nativeEditing,
      viewerState.pagesCount,
      viewerState.pdfSecurity,
    ]
  );
  const guardPdfAction = useCallback(
    action => {
      const policy = getActionPolicy(action);
      if (policy.enabled) {
        return true;
      }
      setDocumentActionStatus({
        message: policy.reason,
        state: "error",
        type: policy.actionId || action || "",
      });
      return false;
    },
    [getActionPolicy]
  );
  const rotateClockwise = useCallback(() => {
    if (!guardPdfAction("rotate-page")) {
      return;
    }
    pdfActions.rotateClockwise();
  }, [guardPdfAction, pdfActions]);
  const deleteSelectedAnnotation = useCallback(() => {
    if (!guardPdfAction("delete-annotation")) {
      return;
    }
    pdfActions.deleteSelectedAnnotation();
  }, [guardPdfAction, pdfActions]);
  const savePendingComment = useCallback(
    text => {
      if (!guardPdfAction("comment")) {
        return;
      }
      pdfActions.savePendingComment(text);
    },
    [guardPdfAction, pdfActions]
  );
  const openSignatureDialog = useCallback(tabName => {
    if (!guardPdfAction("signature")) {
      return;
    }
    pdfActions.openSignatureDialog(tabName);
  }, [guardPdfAction, pdfActions]);
  const useSavedSignature = useCallback(
    signature => {
      if (!guardPdfAction("signature")) {
        return;
      }
      pdfActions.useSavedSignature(signature);
    },
    [guardPdfAction, pdfActions]
  );

  const handleDocumentLoaded = useCallback(info => {
    setPageInfo(info);
    setViewerState(current => ({
      ...current,
      error: null,
      loading: false,
      pageNumber: 1,
      pagesCount: info.pagesCount,
    }));
  }, []);

  const handleViewerStateChange = useCallback(nextState => {
    setViewerState(current => ({
      ...current,
      ...nextState,
    }));
    if (nextState.freeTextStyle) {
      setTextStyle(current => {
        const nextStyle = normalizeTextStyle(nextState.freeTextStyle, current);
        return areTextStylesEqual(current, nextStyle) ? current : nextStyle;
      });
    }
    if (nextState.highlightColor) {
      setHighlightColor(current =>
        current === nextState.highlightColor ? current : nextState.highlightColor
      );
    }
  }, []);

  const handleCreateFile = useCallback(
    async event => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      await openPdfFile(file);
      event.target.value = "";
    },
    [openPdfFile]
  );

  const handleSearch = useCallback(
    (query, options = {}) => {
      if (!documentInfo) {
        return;
      }
      const normalizedQuery = query?.trim();
      pdfActions.find(normalizedQuery || "", options);
    },
    [documentInfo, pdfActions]
  );

  const runDocumentAction = useCallback(
    async (type, action, successMessage) => {
      if (!documentInfo) {
        return;
      }
      const policy = getActionPolicy(type);
      if (!policy.enabled) {
        setDocumentActionStatus({
          message: policy.reason,
          state: "error",
          type,
        });
        return;
      }
      const hasDigitalSignatures = Boolean(
        viewerState.pdfSecurity?.signatures?.hasDigitalSignatures
      );
      const hasRuntimeEdits = Boolean(
        viewerState.editing?.runtimeHistory?.entries?.length ||
          viewerState.nativeEditing?.redactionPatches ||
          viewerState.nativeEditing?.textEditCommitted ||
          pageOrganizer.hasDraftChanges
      );
      if (
        type === "download" &&
        hasDigitalSignatures &&
        hasRuntimeEdits &&
        (!signedSaveWarningRef.current.warned ||
          signedSaveWarningRef.current.documentId !== documentInfo.id)
      ) {
        signedSaveWarningRef.current = {
          documentId: documentInfo.id,
          warned: true,
        };
        setDocumentActionStatus({
          message: t(
            "Le modifiche possono invalidare la firma digitale. Premi Salva di nuovo per continuare."
          ),
          state: "warning",
          type,
        });
        return;
      }
      setDocumentActionStatus({
        message: "",
        state: "running",
        type,
      });
      try {
        await action();
        setDocumentActionStatus({
          message: successMessage,
          state: "done",
          type,
        });
      } catch (reason) {
        setDocumentActionStatus({
          message: reason?.message || `${type} failed`,
          state: "error",
          type,
        });
      }
    },
    [
      documentInfo,
      getActionPolicy,
      pageOrganizer.hasDraftChanges,
      t,
      viewerState.editing?.runtimeHistory?.entries?.length,
      viewerState.nativeEditing?.redactionPatches,
      viewerState.nativeEditing?.textEditCommitted,
      viewerState.pdfSecurity?.signatures?.hasDigitalSignatures,
    ]
  );

  const handleHighlightColorChange = useCallback(
    color => {
      pdfActions.setHighlightColor(color);
    },
    [pdfActions]
  );

  const handleTextStyleChange = useCallback(
    (name, value) => {
      pdfActions.setFreeTextStyle(name, value);
    },
    [pdfActions]
  );

  const handleStampSelection = useCallback(
    stamp => {
      setStampSelection(stamp);
      pdfActions.setStampSelection(stamp);
    },
    [pdfActions]
  );

  const openEditorToolContext = useCallback(
    editorAction => {
      setDocumentPanelOpen(false);
      setContextSidebarOpen(true);
      setActiveEditorPanel(null);
      setPageOrganizerInitialDialog(null);
      setPageOrganizerMode(null);
      if (viewRef.current !== "edit") {
        navigate("edit", { editorAction });
        return true;
      }
      return false;
    },
    [navigate]
  );

  const activateEditorTool = useCallback(
    toolName => {
      if (!guardPdfAction(toolName)) {
        return;
      }
      if (toolName !== "select" && toolName !== "signature") {
        const didNavigate = openEditorToolContext(toolName);
        if (didNavigate) {
          return;
        }
      } else {
        setDocumentPanelOpen(false);
        setContextSidebarOpen(true);
      }
      setPageOrganizerInitialDialog(null);
      setActiveEditorPanel(null);
      setPageOrganizerMode(null);
      pdfActions.setTool(toolName);
    },
    [guardPdfAction, openEditorToolContext, pdfActions]
  );

  const activateDrawTool = useCallback(
    toolName => {
      if (!guardPdfAction(toolName)) {
        return;
      }
      setDocumentPanelOpen(false);
      setContextSidebarOpen(true);
      setPageOrganizerInitialDialog(null);
      setPageOrganizerMode(null);

      if (toolName === "stamp-palette") {
        setActiveEditorPanel("stamps");
        pdfActions.setDrawTool(toolName);
        if (viewRef.current !== "edit") {
          navigate("edit", { editorAction: "stamp-palette" });
        }
        return;
      }

      setActiveEditorPanel(null);
      pdfActions.setDrawTool(toolName);
      if (viewRef.current !== "edit") {
        navigate("edit", { editorAction: "ink" });
      }
    },
    [guardPdfAction, navigate, pdfActions]
  );

  const activateImageTool = useCallback(() => {
    if (!guardPdfAction("add-image")) {
      return;
    }
    const didNavigate = openEditorToolContext("image");
    if (didNavigate) {
      window.setTimeout(() => pdfActions.addImage(), 150);
      return;
    }
    pdfActions.addImage();
  }, [guardPdfAction, openEditorToolContext, pdfActions]);

  const addCommentToSelection = useCallback(() => {
    if (!guardPdfAction("comment")) {
      return;
    }
    setDocumentPanelOpen(false);
    setContextSidebarOpen(true);
    setActiveEditorPanel("comments");
    setPageOrganizerInitialDialog(null);
    setPageOrganizerMode(null);
    pdfActions.addCommentToSelection();
    if (viewRef.current !== "edit") {
      navigate("edit", { editorAction: "comments-panel" });
    }
  }, [guardPdfAction, navigate, pdfActions]);

  const addBookmarkFromSelection = useCallback(() => {
    setDocumentPanelOpen(false);
    setContextSidebarOpen(true);
    setActiveEditorPanel("bookmarks");
    setPageOrganizerInitialDialog(null);
    setPageOrganizerMode(null);
    pdfActions.addBookmarkFromSelection();
    if (viewRef.current !== "edit") {
      navigate("edit", { editorAction: "bookmarks-panel" });
    }
  }, [navigate, pdfActions]);

  const openStampPanelFromToolbar = useCallback(
    () => activateDrawTool("stamp-palette"),
    [activateDrawTool]
  );

  const runEditorAction = useCallback(
    action => {
      if (!guardPdfAction(action)) {
        return;
      }
      navigate("edit", { editorAction: action });
    },
    [guardPdfAction, navigate]
  );

  const openQuickEditorPanel = useCallback(
    panel => {
      const isSamePanelOpen = activeEditorPanel === panel;
      setDocumentPanelOpen(false);
      setContextSidebarOpen(true);
      setPageOrganizerMode(panel === "pages" ? "quick" : null);
      setActiveEditorPanel(panel);
      if (panel === "comments" && !isSamePanelOpen) {
        window.setTimeout(() => pdfActions.refreshComments(), 0);
      }
      if (confirmedActiveTool !== "select") {
        pdfActions.setTool("select");
      }
    },
    [activeEditorPanel, confirmedActiveTool, pdfActions]
  );

  const openFullPageOrganizer = useCallback(() => {
    if (!guardPdfAction("organize-pages")) {
      return;
    }
    setDocumentPanelOpen(false);
    setContextSidebarOpen(true);
    setActiveEditorPanel(null);
    setPageOrganizerInitialDialog(null);
    setPageOrganizerMode("full");
    if (confirmedActiveTool !== "select") {
      pdfActions.setTool("select");
    }
  }, [confirmedActiveTool, guardPdfAction, pdfActions]);

  const openExtractPagesWorkflow = useCallback(() => {
    if (!guardPdfAction("extract-pages")) {
      return;
    }
    setDocumentPanelOpen(false);
    setContextSidebarOpen(true);
    setActiveEditorPanel(null);
    setPageOrganizerInitialDialog("extract");
    setPageOrganizerMode("full");
    if (confirmedActiveTool !== "select") {
      pdfActions.setTool("select");
    }
  }, [confirmedActiveTool, guardPdfAction, pdfActions]);

  const closePageOrganizer = useCallback(() => {
    setPageOrganizerInitialDialog(null);
    setPageOrganizerMode(null);
  }, []);

  const closeEditorPanel = useCallback(() => {
    if (activeEditorPanel === "stamps") {
      setStampSelection(null);
      pdfActions.setStampSelection(null);
    }
    setActiveEditorPanel(null);
    setPageOrganizerMode(current => (current === "quick" ? null : current));
  }, [activeEditorPanel, pdfActions]);

  const buildOrganizedPdfBytes = useCallback(async () => {
    const exportData = await pdfActions.organizePages({
      insertions: pageOrganizer.insertions,
      order: pageOrganizer.draftOrder,
      replacements: pageOrganizer.replacements,
      rotations: pageOrganizer.pageRotations,
    });
    if (!exportData?.data) {
      throw new Error(t("PDF non disponibile"));
    }
    return exportData.data;
  }, [
    pageOrganizer.draftOrder,
    pageOrganizer.insertions,
    pageOrganizer.pageRotations,
    pageOrganizer.replacements,
    pdfActions,
    t,
  ]);

  const runUndo = useCallback(async () => {
    if (viewerState.editing?.hasSomethingToUndo) {
      pdfActions.undo();
      return;
    }
    await editHistory.undo();
  }, [editHistory, pdfActions, viewerState.editing?.hasSomethingToUndo]);

  const runRedo = useCallback(async () => {
    if (viewerState.editing?.hasSomethingToRedo) {
      pdfActions.redo();
      return;
    }
    await editHistory.redo();
  }, [editHistory, pdfActions, viewerState.editing?.hasSomethingToRedo]);

  const selectHistoryEntry = useCallback(
    async entry => {
      if (!entry) {
        return;
      }
      const destination = entry.payload?.destination || null;
      if (entry.strategy === "revision" && entry.afterTabId) {
        navigate("edit");
        await selectPdfTab(entry.afterTabId);
        window.setTimeout(() => {
          pdfActions.goToHistoryDestination(
            destination || {
              pageNumber: entry.payload?.pageNumber || 1,
              type: entry.type,
            }
          );
        }, 150);
        return;
      }
      pdfActions.goToHistoryDestination(destination);
    },
    [navigate, pdfActions, selectPdfTab]
  );

  const applyPageOrganization = useCallback(async () => {
    if (!documentInfo || !pageOrganizer.hasDraftChanges) {
      return;
    }
    if (!guardPdfAction("organize-pages")) {
      return;
    }
    setPageOrganizerBusy(true);
    pageOrganizer.setStatus(t("Applicazione organizzazione pagine..."));
    try {
      const bytes = await buildOrganizedPdfBytes();
      const file = new File([bytes], documentInfo.name || "document.pdf", {
        type: "application/pdf",
      });
      const beforeTabId = documentInfo.id;
      const afterPdf = await openPdfFile(file, {
        historyDocumentId: documentInfo.historyDocumentId || documentInfo.id,
        parentTabId: beforeTabId,
        source: "page-organizer",
      });
      await editHistory.recordRevision({
        afterTabId: afterPdf?.id,
        beforeTabId,
        label: t("Organizzazione pagine applicata"),
        payload: {
          insertions: pageOrganizer.insertions.map(insertion => ({
            insertAfterPosition: insertion.insertAfterPosition,
            sourceName: insertion.sourceName,
            sourcePages: [insertion.sourceStartPage, insertion.sourceEndPage],
            sourceType: insertion.sourceType || "pdf",
          })),
          order: pageOrganizer.draftOrder,
          rotations: pageOrganizer.pageRotations,
          replacements: pageOrganizer.replacements.map(replacement => ({
            sourceName: replacement.sourceName,
            sourcePages: [
              replacement.sourceStartPage,
              replacement.sourceEndPage,
            ],
            targetPositions: [
              replacement.targetStartPosition,
              replacement.targetEndPosition,
            ],
          })),
        },
        type: "page-organizer",
      });
      pageOrganizer.resetDraftOrder();
      setDocumentActionStatus({
        message: t("Organizzazione pagine applicata"),
        state: "done",
        type: "page-organizer",
      });
    } catch (reason) {
      pageOrganizer.setStatus(
        reason?.message || t("Organizzazione pagine non riuscita")
      );
    } finally {
      setPageOrganizerBusy(false);
    }
  }, [
    buildOrganizedPdfBytes,
    documentInfo,
    editHistory,
    guardPdfAction,
    openPdfFile,
    pageOrganizer,
    t,
  ]);

  const exportPageOrganization = useCallback(async () => {
    if (!documentInfo || !pageOrganizer.hasDraftChanges) {
      return;
    }
    if (!guardPdfAction("organize-pages")) {
      return;
    }
    setPageOrganizerBusy(true);
    pageOrganizer.setStatus(t("Preparazione esportazione pagine..."));
    try {
      const bytes = await buildOrganizedPdfBytes();
      downloadPdfBytes(bytes, buildExportFilename(documentInfo.name));
      pageOrganizer.setStatus(t("PDF organizzato esportato."));
      setDocumentActionStatus({
        message: t("PDF organizzato esportato"),
        state: "done",
        type: "page-organizer",
      });
    } catch (reason) {
      pageOrganizer.setStatus(
        reason?.message || t("Esportazione pagine non riuscita")
      );
    } finally {
      setPageOrganizerBusy(false);
    }
  }, [
    buildOrganizedPdfBytes,
    documentInfo,
    guardPdfAction,
    pageOrganizer,
    t,
  ]);

  const extractPages = useCallback(
    async (mode, extractionDraft) => {
      if (!documentInfo || !extractionDraft?.order?.length) {
        return;
      }
      if (!guardPdfAction("extract-pages")) {
        return;
      }
      setPageOrganizerBusy(true);
      pageOrganizer.setStatus(t("Preparazione estrazione pagine..."));
      try {
        const exportData = await pdfActions.organizePages({
          order: extractionDraft.order,
          replacements: extractionDraft.replacements,
          rotations: extractionDraft.rotations,
        });
        if (!exportData?.data) {
          throw new Error(t("PDF non disponibile"));
        }
        const filename = getExtractedFilename(documentInfo.name);
        if (mode === "open") {
          const file = new File([exportData.data], filename, {
            type: "application/pdf",
          });
          await openPdfFile(file, {
            historyDocumentId:
              documentInfo.historyDocumentId || documentInfo.id,
            parentTabId: documentInfo.id,
            source: "extract-pages",
          });
          setDocumentActionStatus({
            message: t("Pagine estratte in un nuovo PDF"),
            state: "done",
            type: "extract-pages",
          });
          return;
        }
        downloadPdfBytes(exportData.data, filename);
        pageOrganizer.setStatus(t("PDF estratto scaricato."));
        setDocumentActionStatus({
          message: t("PDF estratto scaricato"),
          state: "done",
          type: "extract-pages",
        });
      } catch (reason) {
        pageOrganizer.setStatus(
          reason?.message || t("Estrazione pagine non riuscita")
        );
        setDocumentActionStatus({
          message: reason?.message || t("Estrazione pagine non riuscita"),
          state: "error",
          type: "extract-pages",
        });
      } finally {
        setPageOrganizerBusy(false);
      }
    },
    [documentInfo, guardPdfAction, openPdfFile, pageOrganizer, pdfActions, t]
  );

  const splitPages = useCallback(
    async (mode, splitDrafts, pagesPerFile) => {
      const drafts = (splitDrafts || []).filter(draft => draft?.order?.length);
      if (!documentInfo || !drafts.length) {
        return;
      }
      if (!guardPdfAction("split-pages")) {
        return;
      }
      setPageOrganizerBusy(true);
      pageOrganizer.setStatus(t("Preparazione divisione pagine..."));
      try {
        const splitFiles = [];
        for (let index = 0; index < drafts.length; index += 1) {
          const draft = drafts[index];
          const exportData = await pdfActions.organizePages({
            order: draft.order,
            replacements: draft.replacements,
            rotations: draft.rotations,
          });
          if (!exportData?.data) {
            throw new Error(t("PDF non disponibile"));
          }
          splitFiles.push({
            bytes: exportData.data,
            filename: getSplitFilename(documentInfo.name, index + 1),
          });
        }

        if (mode === "open") {
          for (const fileInfo of splitFiles) {
            const file = new File([fileInfo.bytes], fileInfo.filename, {
              type: "application/pdf",
            });
            await openPdfFile(file, {
              historyDocumentId:
                documentInfo.historyDocumentId || documentInfo.id,
              parentTabId: documentInfo.id,
              source: "split-pages",
            });
          }
          setDocumentActionStatus({
            message: t("PDF divisi aperti in nuove schede"),
            state: "done",
            type: "split-pages",
          });
          return;
        }

        for (const fileInfo of splitFiles) {
          downloadPdfBytes(fileInfo.bytes, fileInfo.filename);
        }
        pageOrganizer.setStatus(
          t("{{count}} PDF divisi scaricati.", { count: splitFiles.length })
        );
        setDocumentActionStatus({
          message: t("PDF divisi scaricati"),
          state: "done",
          type: "split-pages",
        });
      } catch (reason) {
        pageOrganizer.setStatus(
          reason?.message || t("Divisione pagine non riuscita")
        );
        setDocumentActionStatus({
          message: reason?.message || t("Divisione pagine non riuscita"),
          state: "error",
          type: "split-pages",
        });
      } finally {
        setPageOrganizerBusy(false);
      }
    },
    [documentInfo, guardPdfAction, openPdfFile, pageOrganizer, pdfActions, t]
  );

  const protectPdfWithPassword = useCallback(
    async ({ userPassword } = {}) => {
      if (!documentInfo) {
        return null;
      }
      if (!guardPdfAction("protect-pdf")) {
        return null;
      }
      setDocumentActionStatus({
        message: t("Protezione PDF in corso..."),
        state: "running",
        type: "protect-pdf",
      });
      try {
        const exportData = await pdfActions.protectWithPassword({
          userPassword,
        });
        if (!exportData?.data) {
          throw new Error(t("PDF non disponibile"));
        }
        const file = new File(
          [exportData.data],
          getProtectedFilename(documentInfo.name),
          { type: "application/pdf" }
        );
        const beforeTabId = documentInfo.id;
        const afterPdf = await openPdfFile(file, {
          historyDocumentId: documentInfo.historyDocumentId || documentInfo.id,
          parentTabId: beforeTabId,
          source: "protect-pdf",
        });
        await editHistory.recordRevision({
          afterTabId: afterPdf?.id,
          beforeTabId,
          label: t("Password PDF applicata"),
          payload: {
            sourceKind: exportData.sourceKind || "viewer-export",
          },
          type: "protect-pdf",
        });
        setDocumentActionStatus({
          message: t("Password PDF applicata"),
          state: "done",
          type: "protect-pdf",
        });
        return afterPdf;
      } catch (reason) {
        setDocumentActionStatus({
          message: reason?.message || t("Protezione PDF non riuscita"),
          state: "error",
          type: "protect-pdf",
        });
        throw reason;
      }
    },
    [documentInfo, editHistory, guardPdfAction, openPdfFile, pdfActions, t]
  );

  const deleteCurrentPage = useCallback(async () => {
    const pagesCount = viewerState.pagesCount || 0;
    const pageNumber = viewerState.pageNumber || 1;
    if (!documentInfo || pagesCount <= 0) {
      return;
    }
    if (!guardPdfAction("delete-page")) {
      return;
    }
    if (pagesCount <= 1) {
      setDocumentActionStatus({
        message: t("Non puoi eliminare tutte le pagine."),
        state: "error",
        type: "delete-page",
      });
      return;
    }
    setDocumentActionStatus({
      message: "",
      state: "running",
      type: "delete-page",
    });
    try {
      const originalOrder = Array.from(
        { length: pagesCount },
        (_, index) => index + 1
      );
      const order = originalOrder.filter(page => page !== pageNumber);
      const exportData = await pdfActions.organizePages({ order });
      if (!exportData?.data) {
        throw new Error(t("PDF non disponibile"));
      }
      const file = new File(
        [exportData.data],
        documentInfo.name || "document.pdf",
        { type: "application/pdf" }
      );
      const beforeTabId = documentInfo.id;
      const afterPdf = await openPdfFile(file, {
        historyDocumentId: documentInfo.historyDocumentId || documentInfo.id,
        parentTabId: beforeTabId,
        source: "delete-page",
      });
      await editHistory.recordRevision({
        afterTabId: afterPdf?.id,
        beforeTabId,
        label: t("Pagina {{page}} eliminata", { page: pageNumber }),
        payload: {
          pageNumber,
          pagesAfter: order.length,
          pagesBefore: pagesCount,
          remainingOrder: order,
          sourceOrder: originalOrder,
        },
        type: "delete-page",
      });
      setDocumentActionStatus({
        message: t("Pagina eliminata"),
        state: "done",
        type: "delete-page",
      });
    } catch (reason) {
      setDocumentActionStatus({
        message: reason?.message || t("Eliminazione pagina non riuscita"),
        state: "error",
        type: "delete-page",
      });
    }
  }, [
    documentInfo,
    editHistory,
    guardPdfAction,
    openPdfFile,
    pdfActions,
    t,
    viewerState.pageNumber,
    viewerState.pagesCount,
  ]);

  useEffect(() => {
    const onPopState = () => {
      setContextSidebarOpen(true);
      setView(normalizeView(getInitialView()));
      viewRef.current = normalizeView(getInitialView());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    activePdfTabIdRef.current = activePdfTabId;
    documentInfoRef.current = documentInfo;
  }, [activePdfTabId, documentInfo]);

  useEffect(() => {
    signedSaveWarningRef.current = {
      documentId: documentInfo?.id || null,
      warned: false,
    };
  }, [documentInfo?.id]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (view === "convert" && !showUnimplementedTools) {
      navigate(hasDocument ? "all-tools" : "home", { replace: true });
      return;
    }
    if (!hasDocument && documentViewIds.has(view)) {
      navigate("home", { replace: true });
    }
  }, [hasDocument, navigate, showUnimplementedTools, view]);

  useEffect(() => {
    if (view !== "edit" || !stampSelection || viewerState.loading) {
      return;
    }
    pdfActions.setStampSelection(stampSelection);
  }, [
    pdfActions,
    stampSelection,
    view,
    viewerState.loading,
    viewerState.pagesCount,
  ]);

  useEffect(() => {
    if (!editHistory.documentId) {
      return;
    }
    const nativeEditing = viewerState.nativeEditing || {};
    const previous = nativeHistoryStateRef.current;
    if (previous.activeDocumentId !== editHistory.documentId) {
      nativeHistoryStateRef.current = {
        activeDocumentId: editHistory.documentId,
        redactionPatches: nativeEditing.redactionPatches || 0,
        textEditCommitted: Boolean(nativeEditing.textEditCommitted),
      };
      return;
    }

    if (nativeEditing.textEditCommitted && !previous.textEditCommitted) {
      editHistory.recordTimeline({
        id: `native-text-${activePdfTabId}-${Date.now()}`,
        label: t("Modifica testo sorgente"),
        payload: {
          destination: {
            pageNumber:
              nativeEditing.textEditPageNumber || viewerState.pageNumber || 1,
            type: "native-text-edit",
          },
        },
        timestamp: Date.now(),
        type: "native-text-edit",
        strategy: "native",
      });
    }
    if ((nativeEditing.redactionPatches || 0) > previous.redactionPatches) {
      editHistory.recordTimeline({
        id: `native-redact-${activePdfTabId}-${Date.now()}`,
        label: t("Redazione nativa"),
        payload: {
          destination: {
            pageNumber:
              nativeEditing.redactPageNumber || viewerState.pageNumber || 1,
            type: "native-redact",
          },
        },
        timestamp: Date.now(),
        type: "native-redact",
        strategy: "native",
      });
    }

    nativeHistoryStateRef.current = {
      activeDocumentId: editHistory.documentId,
      redactionPatches: nativeEditing.redactionPatches || 0,
      textEditCommitted: Boolean(nativeEditing.textEditCommitted),
    };
  }, [
    activePdfTabId,
    editHistory,
    editHistory.documentId,
    t,
    viewerState.nativeEditing,
    viewerState.pageNumber,
  ]);

  const activeToolView =
    contextSidebarOpen && toolViewIds.has(guardedView) ? guardedView : null;
  const isDocumentEditorView =
    guardedView === "edit" || guardedView === "sign";
  const shouldKeepDocumentEditorMounted =
    hasDocument && (isDocumentEditorView || guardedView === "options");
  const visibleEditorInitialTool =
    guardedView === "sign"
      ? "signature"
      : getEditorActionActivation(editorEntryAction).tool || "select";

  if (isDocumentEditorView) {
    lastEditorViewRef.current = guardedView;
    lastEditorInitialToolRef.current = visibleEditorInitialTool;
  }

  const activeView = useMemo(() => {
    if (guardedView === "home") {
      return (
        <HomeView
          activePdfTabId={activePdfTabId}
          hasDocument={hasDocument}
          navigate={navigate}
          onClosePdfTab={closePdfTab}
          onOpenFile={openPdfFile}
          onRunEditorAction={runEditorAction}
          onSelectPdfTab={selectPdfTab}
          pdfTabs={pdfTabs}
        />
      );
    }
    if (guardedView === "all-tools") {
      return (
        <AllToolsView
          hasDocument={hasDocument}
          navigate={navigate}
          onOpenFile={openPdfFile}
          onRunEditorAction={runEditorAction}
          viewerState={viewerState}
        />
      );
    }
    if (guardedView === "combine") {
      return (
        <CombinePdfView
          activePdfTabId={activePdfTabId}
          getOpenPdfSource={getOpenPdfSource}
          navigate={navigate}
          onOpenFile={openPdfFile}
          pdfTabs={pdfTabs}
        />
      );
    }
    if (guardedView === "convert") {
      return (
        <ConvertView
          documentInfo={documentInfo}
          pageInfo={pageInfo}
          pdfHandleRef={pdfHandleRef}
        />
      );
    }
    if (guardedView === "options") {
      return <OptionsView />;
    }
    if (isDocumentEditorView) {
      return null;
    }
    return null;
  }, [
    activePdfTabId,
    closePdfTab,
    documentInfo,
    guardedView,
    getOpenPdfSource,
    hasDocument,
    navigate,
    openPdfFile,
    pageInfo,
    pdfHandleRef,
    pdfTabs,
    runEditorAction,
    selectPdfTab,
    showUnimplementedTools,
    viewerState,
  ]);

  const documentEditorView = useMemo(() => {
    if (!shouldKeepDocumentEditorMounted) {
      return null;
    }

    const editorProps = {
      documentInfo,
      activeEditorPanel,
      highlightColor,
      onAddBookmarkFromSelection: addBookmarkFromSelection,
      onAddCommentToSelection: addCommentToSelection,
      onAddImage: activateImageTool,
      onDocumentLoaded: handleDocumentLoaded,
      onHighlightColorChange: handleHighlightColorChange,
      onOpenEditorPanel: openQuickEditorPanel,
      onOpenStampPanel: openStampPanelFromToolbar,
      onProtectPdfWithPassword: protectPdfWithPassword,
      onSearch: handleSearch,
      onSetDrawTool: activateDrawTool,
      onSetTool: activateEditorTool,
      onViewerStateChange: handleViewerStateChange,
      pageOrganizer,
      pageOrganizerMode,
      pagePreviews,
      pdfActions: {
        ...pdfActions,
        deleteSelectedAnnotation,
        openSignatureDialog,
        rotateClockwise,
        savePendingComment,
        useSavedSignature,
      },
      pdfHandleRef,
      editHistory,
      confirmedActiveTool,
      initialFreeTextStyle: textStyle,
      onApplyPageOrganization: applyPageOrganization,
      onExportPageOrganization: exportPageOrganization,
      pageOrganizerBusy,
      stampSelection,
      viewerState,
    };
    if (lastEditorViewRef.current === "sign") {
      return <SignView {...editorProps} />;
    }
    return (
      <EditView
        {...editorProps}
        initialTool={lastEditorInitialToolRef.current}
      />
    );
  }, [
    documentInfo,
    handleDocumentLoaded,
    handleHighlightColorChange,
    handleSearch,
    handleStampSelection,
    handleViewerStateChange,
    highlightColor,
    confirmedActiveTool,
    activeEditorPanel,
    activateEditorTool,
    activateDrawTool,
    activateImageTool,
    addBookmarkFromSelection,
    addCommentToSelection,
    guardedView,
    deleteCurrentPage,
    deleteSelectedAnnotation,
    openQuickEditorPanel,
    openStampPanelFromToolbar,
    openSignatureDialog,
    applyPageOrganization,
    exportPageOrganization,
    extractPages,
    splitPages,
    protectPdfWithPassword,
    editHistory,
    pageInfo,
    pageOrganizer,
    pageOrganizerMode,
    pageOrganizerBusy,
    pagePreviews,
    pdfActions,
    rotateClockwise,
    shouldKeepDocumentEditorMounted,
    stampSelection,
    savePendingComment,
    textStyle,
    viewerState,
    useSavedSignature,
  ]);

  if (isMobileReader) {
    return (
      <MobileReaderShell
        activePdfTabId={activePdfTabId}
        closePdfTab={closePdfTab}
        documentInfo={documentInfo}
        onDocumentLoaded={handleDocumentLoaded}
        onOpenFile={openPdfFile}
        onSelectPdfTab={selectPdfTab}
        onViewerStateChange={handleViewerStateChange}
        pdfHandleRef={pdfHandleRef}
        pdfTabs={pdfTabs}
        viewerState={viewerState}
      />
    );
  }

  return (
    <div
      className={`app-shell view-${guardedView}`}
      data-annotation-editor-mode={viewerState.annotationEditorMode ?? ""}
      data-find-current={viewerState.find?.matchesCount?.current ?? 0}
      data-find-query={viewerState.find?.rawQuery || ""}
      data-find-state={viewerState.find?.state || "idle"}
      data-find-total={viewerState.find?.matchesCount?.total ?? 0}
      data-document-action-state={documentActionStatus.state}
      data-document-action-type={documentActionStatus.type}
      data-draw-color={viewerState.draw?.style?.color || ""}
      data-draw-fill-color={viewerState.draw?.style?.fillColor || ""}
      data-draw-stroke-width={viewerState.draw?.style?.strokeWidth || ""}
      data-draw-tool={viewerState.draw?.tool || ""}
      data-interaction-active-tool={confirmedActiveTool}
      data-interaction-can-bookmark={
        viewerInteractionState.capabilities?.canBookmark ? "true" : "false"
      }
      data-interaction-can-comment={
        viewerInteractionState.capabilities?.canComment ? "true" : "false"
      }
      data-interaction-can-delete={
        viewerInteractionState.capabilities?.canDelete ? "true" : "false"
      }
      data-interaction-context-kind={
        viewerInteractionState.contextTargetKind || ""
      }
      data-interaction-selected-editor-count={
        viewerInteractionState.selectedEditorCount || 0
      }
      data-interaction-selection-kind={
        viewerInteractionState.selectionKind || "none"
      }
      data-edit-history-revision-count={editHistory.entries.length}
      data-edit-history-runtime-count={
        viewerState.editing?.runtimeHistory?.entries?.length || 0
      }
      data-edit-history-runtime-position={
        viewerState.editing?.runtimeHistory?.position ?? -1
      }
      data-theme={resolvedTheme}
      data-theme-preference={theme}
      data-stamp-selected={
        viewerState.draw?.stampSelection?.id || stampSelection?.id || ""
      }
      data-native-redact-active={
        viewerState.nativeEditing?.redactActive ? "true" : "false"
      }
      data-native-redact-patches={
        viewerState.nativeEditing?.redactionPatches ?? 0
      }
      data-native-text-edit-active={
        viewerState.nativeEditing?.textEditActive ? "true" : "false"
      }
      data-native-text-edit-editable={
        viewerState.nativeEditing?.textEditEditableCount ?? 0
      }
      data-native-text-edit-committed={
        viewerState.nativeEditing?.textEditCommitted ? "true" : "false"
      }
      data-native-text-edit-unsupported={
        viewerState.nativeEditing?.textEditUnsupportedCount ?? 0
      }
      data-page-number={viewerState.pageNumber || 1}
      data-pages-count={viewerState.pagesCount || 0}
      data-page-organizer-mode={pageOrganizerMode || ""}
      data-page-organizer-order={pageOrganizer.draftOrder.join(",")}
      data-page-organizer-selected={pageOrganizer.selectedCount}
    >
      <TopNav
        activePdfTabId={activePdfTabId}
        activeToolView={activeToolView}
        canRunDocumentActions={hasDocument && documentViewIds.has(guardedView)}
        hasDocument={hasDocument}
        isDocumentPanelOpen={documentPanelOpen}
        navigate={navigate}
        documentActionStatus={documentActionStatus}
        onDownload={() =>
          runDocumentAction(
            "download",
            pdfActions.download,
            t("Documento salvato")
          )
        }
        onToggleTheme={toggleTheme}
        onToggleDocumentPanel={() => {
          setDocumentPanelOpen(open => !open);
          setContextSidebarOpen(true);
        }}
        pdfTabs={pdfTabs}
        resolvedTheme={resolvedTheme}
        view={guardedView}
      />
      <div className="app-body">
        <SideNav
          activeTool={confirmedActiveTool}
          activeEditorPanel={activeEditorPanel}
          activePdfTabId={activePdfTabId}
          contextSidebarOpen={contextSidebarOpen}
          documentPanelOpen={documentPanelOpen}
          documentInfo={documentInfo}
          editHistory={editHistory}
          navigate={navigate}
          onAddImage={activateImageTool}
          onCancelPendingComment={pdfActions.cancelPendingComment}
          onAddCommentToSelection={addCommentToSelection}
          onClose={() => setContextSidebarOpen(false)}
          onCloseDocumentPanel={() => setDocumentPanelOpen(false)}
          onCloseEditorPanel={closeEditorPanel}
          onClosePageOrganizer={closePageOrganizer}
          onClosePdfTab={closePdfTab}
          onCreateFile={handleCreateFile}
          onExtractPages={extractPages}
          onSplitPages={splitPages}
          onAddBookmarkFromSelection={addBookmarkFromSelection}
          onDeleteBookmark={pdfActions.deleteBookmark}
          onDeleteSavedSignature={pdfActions.deleteSavedSignature}
          onGoToBookmark={pdfActions.goToBookmark}
          onGoToComment={pdfActions.goToComment}
          onGoToPage={pdfActions.goToPage}
          onGoToSearchResult={pdfActions.goToSearchResult}
          onOpenFullOrganizer={openFullPageOrganizer}
          onOpenExtractPages={openExtractPagesWorkflow}
          onOpenSignatureDialog={openSignatureDialog}
          onListSavedSignatures={pdfActions.listSavedSignatures}
          onOpenEditorPanel={openQuickEditorPanel}
          onProtectPdfWithPassword={protectPdfWithPassword}
          onDeleteCurrentPage={deleteCurrentPage}
          onDeleteSelection={deleteSelectedAnnotation}
          onDrawStyleChange={pdfActions.setDrawStyle}
          onRunEditorAction={runEditorAction}
          onRotateClockwise={rotateClockwise}
          onRedo={runRedo}
          onSavePendingComment={savePendingComment}
          onSearch={handleSearch}
          onSelectHistoryEntry={selectHistoryEntry}
          onSetStampSelection={handleStampSelection}
          onSetTool={activateEditorTool}
          onTextStyleChange={handleTextStyleChange}
          onSelectPdfTab={selectPdfTab}
          onUndo={runUndo}
          onUpdateBookmarkTitle={pdfActions.updateBookmarkTitle}
          onUseSavedSignature={useSavedSignature}
          pdfTabs={pdfTabs}
          pageOrganizer={pageOrganizer}
          pageOrganizerInitialDialog={pageOrganizerInitialDialog}
          pageOrganizerMode={pageOrganizerMode}
          pagePreviews={pagePreviews}
          textStyle={textStyle}
          viewerState={viewerState}
          view={guardedView}
        />
        <Suspense fallback={null}>
          {shouldKeepDocumentEditorMounted ? (
            <div
              aria-hidden={guardedView === "options" ? "true" : undefined}
              className="preserved-document-editor-view"
              style={{
                display: guardedView === "options" ? "none" : "contents",
              }}
            >
              {documentEditorView}
            </div>
          ) : null}
          {activeView}
        </Suspense>
      </div>
    </div>
  );
}
