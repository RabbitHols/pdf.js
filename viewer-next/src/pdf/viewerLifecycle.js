import {
  PdfPasswordCancelledError,
  loadPdfDocument,
} from "./pdfDocumentLoader.js";
import { getSafePageWidthScale } from "./viewerActions.js";

const stateEvents = [
  "annotationeditormodechanged",
  "pagechanging",
  "pagesinit",
  "scalechanging",
  "updateviewarea",
];

export function bindViewerStateEvents({ emitState, eventBus }) {
  for (const eventName of stateEvents) {
    eventBus.on(eventName, emitState);
  }
  return () => {
    for (const eventName of stateEvents) {
      eventBus.off(eventName, emitState);
    }
  };
}

export function bindPagesInit({ emitState, eventBus, pdfViewer }) {
  function setPageBoxSize(page, width, height) {
    const nextWidth = `${Math.ceil(width)}px`;
    const nextHeight = `${Math.ceil(height)}px`;
    page.style.width = nextWidth;
    page.style.height = nextHeight;
    const canvasWrapper = page.querySelector(".canvasWrapper");
    if (canvasWrapper) {
      canvasWrapper.style.width = nextWidth;
      canvasWrapper.style.height = nextHeight;
    }
  }

  function syncPageViewSize(pageView) {
    const page = pageView?.div;
    const viewport = pageView?.viewport;
    if (!page || !viewport) {
      return;
    }

    const xfaLayer = pageView.pdfPage?.isPureXfa
      ? page.querySelector(".xfaLayer")
      : null;
    if (xfaLayer) {
      const { height, width } = xfaLayer.getBoundingClientRect();
      if (
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width &&
        height
      ) {
        setPageBoxSize(page, width, height);
        return;
      }
    }

    if (
      Number.isFinite(viewport.width) &&
      Number.isFinite(viewport.height) &&
      viewport.width &&
      viewport.height
    ) {
      setPageBoxSize(page, viewport.width, viewport.height);
    }
  }

  function syncRenderedPageSizes() {
    for (let i = 0; i < pdfViewer.pagesCount; i++) {
      syncPageViewSize(pdfViewer.getPageView(i));
    }
  }

  function onPagesInit() {
    pdfViewer.currentScaleValue =
      getSafePageWidthScale(pdfViewer) || "page-width";
    requestAnimationFrame(() => {
      syncRenderedPageSizes();
      pdfViewer.update();
      pdfViewer.forceRendering();
      emitState();
    });
  }

  function onScaleChanging() {
    requestAnimationFrame(() => {
      syncRenderedPageSizes();
      emitState();
    });
  }

  function onXfaLayerRendered(event) {
    requestAnimationFrame(() => {
      syncPageViewSize(pdfViewer.getPageView(event.pageNumber - 1));
      emitState();
    });
  }

  eventBus.on("pagesinit", onPagesInit);
  eventBus.on("scalechanging", onScaleChanging);
  eventBus.on("xfalayerrendered", onXfaLayerRendered);
  return () => {
    eventBus.off("pagesinit", onPagesInit);
    eventBus.off("scalechanging", onScaleChanging);
    eventBus.off("xfalayerrendered", onXfaLayerRendered);
  };
}

function shouldLogPdfDiagnostics() {
  return (
    new URLSearchParams(window.location.search).get("debugPdf") === "1" ||
    localStorage.getItem("rewirepdf.viewerNext.debugPdf") === "true"
  );
}

function logPdfDiagnostics(pdfDocument) {
  if (!shouldLogPdfDiagnostics()) {
    return;
  }
  console.debug("[Viewer Next] PDF document", JSON.stringify({
    allXfaHtml: Boolean(pdfDocument.allXfaHtml),
    enableXfa: pdfDocument.loadingParams?.enableXfa === true,
    isPureXfa: pdfDocument.isPureXfa,
    numPages: pdfDocument.numPages,
  }));
}

export async function openViewerDocument({
  linkService,
  onDocumentLoaded,
  onPasswordRequest,
  pdfViewer,
  source,
}) {
  const loadingTask = loadPdfDocument(source, { onPasswordRequest });
  let pdfDocument = null;
  try {
    pdfDocument = await loadingTask.promise;
  } catch (reason) {
    if (loadingTask.viewerNextPasswordState?.cancelled) {
      throw new PdfPasswordCancelledError();
    }
    throw reason;
  }
  logPdfDiagnostics(pdfDocument);

  pdfViewer.setDocument(pdfDocument);
  linkService.setDocument(pdfDocument, null);
  onDocumentLoaded?.({
    pagesCount: pdfDocument.numPages,
  });

  return {
    loadingTask,
    pdfDocument,
  };
}

export function destroyViewerEngine({
  cleanupPagesInit,
  cleanupStateEvents,
  linkService,
  loadingTask,
  pdfViewer,
  signatureUi,
}) {
  cleanupStateEvents();
  cleanupPagesInit();
  pdfViewer.setDocument(null);
  linkService.setDocument(null, null);
  signatureUi?.destroy();
  loadingTask?.destroy();
}
