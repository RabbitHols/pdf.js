import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { buildExportFilename } from "../app/preferences.js";
import { useTranslation } from "../i18n/index.js";
import { createViewerEngine } from "../pdf/index.js";
import { SelectionTransformOverlay } from "./SelectionTransformOverlay.jsx";

function stripNativePdfTooltips(root) {
  if (!root) {
    return;
  }

  const elements =
    root.nodeType === Node.ELEMENT_NODE
      ? [root, ...root.querySelectorAll("[title]")]
      : Array.from(root.querySelectorAll?.("[title]") || []);

  for (const element of elements) {
    if (!element.hasAttribute("title")) {
      continue;
    }
    element.dataset.viewerNextTitle = element.getAttribute("title") || "";
    element.removeAttribute("title");
  }
}

function observeNativePdfTooltips(root) {
  stripNativePdfTooltips(root);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        stripNativePdfTooltips(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        stripNativePdfTooltips(node);
      }
    }
  });
  observer.observe(root, {
    attributeFilter: ["title"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

function ExternalLinkWarningDialog({ linkInfo, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!linkInfo) {
      return undefined;
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [linkInfo, onClose]);

  if (!linkInfo) {
    return null;
  }

  return (
    <div
      className="external-link-warning-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="external-link-warning-title"
        aria-modal="true"
        className="external-link-warning-dialog"
        onClick={event => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>{t("Link esterno")}</span>
            <h3 id="external-link-warning-title">
              {t("Stai lasciando il PDF")}
            </h3>
          </div>
          <button aria-label={t("Chiudi")} onClick={onClose} type="button">
            <span className="symbol">close</span>
          </button>
        </header>
        <div className="external-link-warning-body">
          <span className="symbol warning-symbol">open_in_new</span>
          <div>
            <p>
              {t("Questo link aprira un sito esterno in una nuova scheda.")}
            </p>
            <dl>
              <div>
                <dt>{t("Sito")}</dt>
                <dd>{linkInfo.site}</dd>
              </div>
              <div>
                <dt>{t("Indirizzo")}</dt>
                <dd>{linkInfo.displayUrl}</dd>
              </div>
            </dl>
            {!linkInfo.isAllowed ? (
              <p className="external-link-warning-message">
                {t("Viewer Next non puo aprire questo tipo di link.")}
              </p>
            ) : null}
          </div>
        </div>
        <footer>
          <button autoFocus onClick={onClose} type="button">
            {t("Annulla apertura link")}
          </button>
          {linkInfo.isAllowed ? (
            <a
              className="primary"
              href={linkInfo.url}
              onClick={onClose}
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              {t("Continua al sito")}
            </a>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

export const PdfViewerSurface = forwardRef(function PdfViewerSurface(
  {
    documentInfo,
    enableSignatureTools = false,
    initialFreeTextStyle = null,
    initialTool = null,
    onDocumentLoaded,
    onPdfContextMenu,
    onViewerStateChange,
    readOnly = false,
    resizeShellToPage = false,
    stampSelection = null,
  },
  ref
) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const surfaceRef = useRef(null);
  const stampSelectionRef = useRef(stampSelection);
  const initialFreeTextStyleRef = useRef(initialFreeTextStyle);
  const [error, setError] = useState(null);
  const [externalLinkInfo, setExternalLinkInfo] = useState(null);
  const [pageSize, setPageSize] = useState(null);
  const [viewerInteractionState, setViewerInteractionState] = useState(null);
  initialFreeTextStyleRef.current = initialFreeTextStyle;

  useImperativeHandle(
    ref,
    () => ({
      addImage: () => surfaceRef.current?.addImage(),
      addBookmarkFromSelection: () =>
        surfaceRef.current?.addBookmarkFromSelection(),
      addCommentToSelection: () => surfaceRef.current?.addCommentToSelection(),
      cancelPendingComment: () => surfaceRef.current?.cancelPendingComment(),
      clearHistory: () => surfaceRef.current?.clearHistory(),
      deleteSelectedAnnotation: () =>
        surfaceRef.current?.deleteSelectedAnnotation(),
      deleteBookmark: bookmarkId =>
        surfaceRef.current?.deleteBookmark(bookmarkId),
      deleteSavedSignature: uuid =>
        surfaceRef.current?.deleteSavedSignature?.(uuid),
      download: () => surfaceRef.current?.download(),
      exportData: options => surfaceRef.current?.exportData(options),
      exportRedacted: () => surfaceRef.current?.exportRedacted(),
      find: (query, options) => surfaceRef.current?.find(query, options),
      fitPageWidth: () => {
        if (resizeShellToPage) {
          flushSync(() => setPageSize(null));
        }
        surfaceRef.current?.fitPageWidth();
      },
      goToComment: id => surfaceRef.current?.goToComment(id),
      goToBookmark: bookmark => surfaceRef.current?.goToBookmark(bookmark),
      goToHistoryDestination: destination =>
        surfaceRef.current?.goToHistoryDestination(destination),
      goToPage: pageNumber => surfaceRef.current?.goToPage(pageNumber),
      goToSearchResult: result => surfaceRef.current?.goToSearchResult(result),
      getPageThumbnails: onUpdate =>
        surfaceRef.current?.getPageThumbnails(onUpdate) || {},
      getState: () => surfaceRef.current?.getState(),
      listSavedSignatures: () =>
        surfaceRef.current?.listSavedSignatures?.() || [],
      nextPage: () => surfaceRef.current?.nextPage(),
      openSignatureDialog: tabName =>
        surfaceRef.current?.openSignatureDialog(tabName),
      organizePages: options => surfaceRef.current?.organizePages(options),
      previousPage: () => surfaceRef.current?.previousPage(),
      print: () => surfaceRef.current?.print(),
      readInteractionStateAtPoint: point =>
        surfaceRef.current?.readInteractionStateAtPoint?.(point),
      redo: () => surfaceRef.current?.redo(),
      refreshComments: () => surfaceRef.current?.refreshComments(),
      resetZoom: () => surfaceRef.current?.resetZoom(),
      resetSelectedEditorRotation: () =>
        surfaceRef.current?.resetSelectedEditorRotation?.(),
      rotateSelectedEditorClockwise: () =>
        surfaceRef.current?.rotateSelectedEditorClockwise?.(),
      rotateClockwise: () => surfaceRef.current?.rotateClockwise(),
      save: () => surfaceRef.current?.save(),
      savePendingComment: text => surfaceRef.current?.savePendingComment(text),
      startSelectedEditorResize: (name, event) =>
        surfaceRef.current?.startSelectedEditorResize?.(name, event),
      setFreeTextStyle: (name, value) =>
        surfaceRef.current?.setFreeTextStyle(name, value),
      setDrawTool: toolName => surfaceRef.current?.setDrawTool(toolName),
      setDrawStyle: style => surfaceRef.current?.setDrawStyle(style),
      setHighlightColor: color => surfaceRef.current?.setHighlightColor(color),
      setScale: scaleValue => surfaceRef.current?.setScale(scaleValue),
      setStampSelection: stamp =>
        surfaceRef.current?.setStampSelection(stamp),
      setTool: toolName => surfaceRef.current?.setTool(toolName),
      undo: () => surfaceRef.current?.undo(),
      updateBookmarkTitle: (bookmarkId, title) =>
        surfaceRef.current?.updateBookmarkTitle(bookmarkId, title),
      useSavedSignature: uuid =>
        surfaceRef.current?.useSavedSignature?.(uuid),
      zoomWithWheel: event => surfaceRef.current?.zoomWithWheel(event),
      zoomIn: () => surfaceRef.current?.zoomIn(),
      zoomOut: () => surfaceRef.current?.zoomOut(),
    }),
    [resizeShellToPage]
  );

  useEffect(() => {
    setExternalLinkInfo(null);

    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer || !documentInfo?.data) {
      return undefined;
    }

    let cancelled = false;
    let surface = null;
    const stopObservingTooltips = observeNativePdfTooltips(viewer);
    function onWheel(event) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      surfaceRef.current?.zoomWithWheel(event);
    }

    function onContextMenu(event) {
      if (readOnly) {
        return;
      }
      const interactionState =
        surfaceRef.current?.readInteractionStateAtPoint?.({
          clientX: event.clientX,
          clientY: event.clientY,
        }) ||
        surfaceRef.current?.getState?.()?.viewerInteractionState ||
        null;
      if (!interactionState?.capabilities?.canUseContextMenu) {
        return;
      }
      event.preventDefault();
      onPdfContextMenu?.({
        interactionState,
        x: event.clientX,
        y: event.clientY,
      });
    }

    setError(null);
    setPageSize(null);
    setViewerInteractionState(null);
    onViewerStateChange?.({
      error: null,
      loading: true,
    });
    viewer.textContent = "";
    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    container.addEventListener("contextmenu", onContextMenu);

    createViewerEngine({
      container,
      viewer,
      source: {
        data: documentInfo.data,
      },
      enableSignatureTools,
      filename: documentInfo.name,
      getFilename: () => buildExportFilename(documentInfo.name),
      initialFreeTextStyle: initialFreeTextStyleRef.current,
      initialTool,
      onExternalLinkRequest: setExternalLinkInfo,
      onDocumentLoaded,
      onViewerStateChange: state => {
        setPageSize(state.pageSize || null);
        setViewerInteractionState(state.viewerInteractionState || null);
        onViewerStateChange?.(state);
      },
    })
      .then(instance => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        surface = instance;
        surfaceRef.current = instance;
        if (stampSelectionRef.current) {
          instance.setStampSelection?.(stampSelectionRef.current);
        }
        onViewerStateChange?.({
          ...instance.getState(),
          error: null,
          loading: false,
        });
      })
      .catch(reason => {
        if (!cancelled) {
          console.error("Viewer Next PDF surface failed", reason);
          const message = "The selected PDF could not be rendered.";
          setError(message);
          onViewerStateChange?.({
            error: message,
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener("wheel", onWheel, { capture: true });
      container.removeEventListener("contextmenu", onContextMenu);
      stopObservingTooltips();
      surfaceRef.current = null;
      setViewerInteractionState(null);
      surface?.destroy();
      viewer.textContent = "";
    };
  }, [
    documentInfo,
    enableSignatureTools,
    initialTool,
    onDocumentLoaded,
    onPdfContextMenu,
    onViewerStateChange,
    readOnly,
  ]);

  useEffect(() => {
    stampSelectionRef.current = stampSelection;
    surfaceRef.current?.setStampSelection?.(stampSelection);
  }, [stampSelection]);

  if (!documentInfo) {
    return (
      <div className="empty-document">
        <span className="symbol large">picture_as_pdf</span>
        <h1>{t("No document loaded")}</h1>
        <p>{t("Select a PDF from Home to open it in the Viewer Next editor.")}</p>
      </div>
    );
  }

  return (
    <div
      className="pdf-surface-shell"
      style={
        resizeShellToPage && pageSize
          ? {
              "--pdf-page-height": `${pageSize.height}px`,
              "--pdf-page-width": `${pageSize.width}px`,
            }
          : undefined
      }
    >
      {error ? <div className="surface-error">{error}</div> : null}
      <ExternalLinkWarningDialog
        linkInfo={externalLinkInfo}
        onClose={() => setExternalLinkInfo(null)}
      />
      <div className="pdf-surface-container" ref={containerRef}>
        <div className="pdfViewer" ref={viewerRef}></div>
      </div>
      {readOnly ? null : (
        <SelectionTransformOverlay
          onDelete={() => surfaceRef.current?.deleteSelectedAnnotation()}
          onResetRotation={() =>
            surfaceRef.current?.resetSelectedEditorRotation?.()
          }
          onRotate={() => surfaceRef.current?.rotateSelectedEditorClockwise?.()}
          onResizeStart={(name, event) =>
            surfaceRef.current?.startSelectedEditorResize?.(name, event)
          }
          viewerInteractionState={viewerInteractionState}
        />
      )}
    </div>
  );
});
