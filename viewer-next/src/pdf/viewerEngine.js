import { createAnnotationEditorBridge } from "./annotationEditorBridge.js";
import { createAnnotationCreationActions } from "./annotationCreationActions.js";
import { createCommentBridge } from "./commentBridge.js";
import { createDrawToolBridge } from "./drawToolBridge.js";
import { createFindStateTracker } from "./findStateTracker.js";
import {
  canCreateBookmarkFromSelection,
  countBookmarks,
  createBookmarkFromSelection,
  normalizeBookmarkItems,
} from "./bookmarkState.js";
import { pdfjsLib } from "./pdfDocumentLoader.js";
import {
  createViewerCoreEventBus,
  createViewerCoreRuntime,
} from "./viewerCoreRuntime.js";
import { createPageThumbnailService } from "./pageThumbnailService.js";
import {
  getSavedSignatureCreateData,
  listSavedSignatures,
} from "./savedSignatureStorage.js";
import {
  createInitialPdfSecurityState,
  readPdfSecurityState,
} from "./pdfSecurityState.js";
import { createViewerActions } from "./viewerActions.js";
import {
  bindPagesInit,
  bindViewerStateEvents,
  destroyViewerEngine,
  openViewerDocument,
} from "./viewerLifecycle.js";
import { readViewerInteractionState } from "./viewerInteractionState.js";
import { readPdfViewerState } from "./viewerState.js";
import { createWheelZoomController } from "./wheelZoomController.js";

export async function createViewerEngine({
  container,
  viewer,
  bytes,
  source = null,
  enableSignatureTools = false,
  filename = "document.pdf",
  getFilename = null,
  initialFreeTextStyle = null,
  initialTool = null,
  onExternalLinkRequest = null,
  onDocumentLoaded,
  onViewerStateChange,
}) {
  const eventBus = createViewerCoreEventBus();
  let signatureUi = null;
  const commentBridge = createCommentBridge({
    emitState,
    eventBus,
    pdfjsLib,
  });
  const {
    downloadManager,
    findController,
    linkService,
    pdfViewer,
  } = createViewerCoreRuntime({
    commentManager: commentBridge.commentManager,
    container,
    eventBus,
    onExternalLinkRequest,
    signatureManager: null,
    viewer,
  });
  commentBridge.attach({ linkService, pdfViewer });

  let loadingTask = null;
  let editingState = {
    hasSelectedEditor: false,
    hasSomethingToRedo: false,
    hasSomethingToUndo: false,
  };
  let annotationHistoryState = {
    entries: [],
    position: -1,
  };
  let nativeEditingBridge = null;
  let pageThumbnailService = null;
  let pdfDocument = null;
  let bookmarkLoadId = 0;
  let pdfSecurityLoadId = 0;
  let bookmarksState = {
    canAddFromSelection: false,
    count: 0,
    error: null,
    items: [],
    status: "idle",
  };
  let pdfSecurityState = createInitialPdfSecurityState();

  async function ensureNativeEditingBridge() {
    if (nativeEditingBridge) {
      return nativeEditingBridge;
    }
    const { createNativeEditingBridge } = await import(
      "./nativeEditingBridge.js"
    );
    nativeEditingBridge = createNativeEditingBridge({
      downloadManager,
      emitState,
      eventBus,
      filename,
      getPdfDocument: () => pdfDocument,
      openDocument: async nextSource => {
        loadingTask?.destroy();
        resetPageThumbnailService();
        pdfSecurityState = createInitialPdfSecurityState();
        const loaded = await openViewerDocument({
          linkService,
          onDocumentLoaded,
          pdfViewer,
          source: nextSource,
        });
        loadingTask = loaded.loadingTask;
        pdfDocument = loaded.pdfDocument;
        emitState();
        loadBookmarksForDocument(pdfDocument);
        loadPdfSecurityForDocument(pdfDocument, nextSource);
      },
      pdfViewer,
    });
    return nativeEditingBridge;
  }

  async function ensureSignatureUi() {
    if (!enableSignatureTools) {
      return null;
    }
    if (signatureUi) {
      return signatureUi;
    }
    const { createSignatureDialogElements } = await import(
      "./signatureDialogAdapter.js"
    );
    signatureUi = createSignatureDialogElements(eventBus);
    pdfViewer.setSignatureManager?.(signatureUi.manager);
    return signatureUi;
  }

  function resetPageThumbnailService() {
    pageThumbnailService?.destroy();
    pageThumbnailService = null;
  }

  function getPageThumbnailService() {
    if (!pdfDocument) {
      return null;
    }
    pageThumbnailService ||= createPageThumbnailService({
      eventBus,
      linkService,
      pdfDocument,
    });
    return pageThumbnailService;
  }

  function getState() {
    const nativeEditingState = nativeEditingBridge?.getState() || null;
    const activeTool = nativeEditingState?.textEditActive
      ? "native-text-edit"
      : nativeEditingState?.redactActive
        ? "native-redact"
        : annotationEditorBridge.getActiveTool();
    const freeTextFonts = annotationEditorBridge.getFreeTextFonts();
    const freeTextStyle = annotationEditorBridge.getFreeTextStyle();
    const annotationEditorSelection = annotationEditorBridge.getSelectionState({
      container,
    });
    return {
      ...readPdfViewerState({
        activeTool,
        capabilities: {
          annotationTools: annotationEditorBridge.getToolCapabilities(),
          freeTextFonts,
          nativeRedact: { supported: true },
          nativeTextEdit: { supported: true },
          print: { supported: true },
        },
        findState: findStateTracker.getState(),
        freeTextStyle,
        highlightColor: annotationEditorBridge.getHighlightColor(),
        nativeEditingState,
        pdfDocument,
        pdfViewer,
        viewer,
      }),
      comments: commentBridge.getState(),
      bookmarks: bookmarksState,
      draw: drawToolBridge.getState(),
      editing: {
        ...editingState,
        runtimeHistory: annotationHistoryState,
      },
      pdfSecurity: pdfSecurityState,
      viewerInteractionState: readViewerInteractionState({
        activeTool,
        annotationEditorSelection,
        bookmarksState,
        container,
        nativeEditingState,
        pdfViewer,
        viewer,
      }),
    };
  }

  function emitState() {
    requestAnimationFrame(() => {
      onViewerStateChange?.(getState());
    });
  }

  const cleanupStateEvents = bindViewerStateEvents({ emitState, eventBus });
  function updateSelectionInteractionState() {
    const canAddFromSelection = canCreateBookmarkFromSelection(pdfViewer);
    if (bookmarksState.canAddFromSelection !== canAddFromSelection) {
      bookmarksState = {
        ...bookmarksState,
        canAddFromSelection,
      };
    }
    emitState();
  }
  let selectionStateFrame = 0;
  let selectionStateTimer = 0;
  function scheduleSelectionInteractionStateUpdate() {
    if (selectionStateFrame) {
      cancelAnimationFrame(selectionStateFrame);
    }
    if (selectionStateTimer) {
      clearTimeout(selectionStateTimer);
      selectionStateTimer = 0;
    }
    selectionStateFrame = requestAnimationFrame(() => {
      selectionStateFrame = 0;
      updateSelectionInteractionState();
      selectionStateTimer = window.setTimeout(() => {
        selectionStateTimer = 0;
        updateSelectionInteractionState();
      }, 0);
    });
  }
  document.addEventListener(
    "selectionchange",
    scheduleSelectionInteractionStateUpdate
  );
  window.addEventListener("pointerdown", scheduleSelectionInteractionStateUpdate, {
    capture: true,
  });
  window.addEventListener("pointerup", scheduleSelectionInteractionStateUpdate, {
    capture: true,
  });
  window.addEventListener("mouseup", scheduleSelectionInteractionStateUpdate, {
    capture: true,
  });
  window.addEventListener("keyup", scheduleSelectionInteractionStateUpdate, {
    capture: true,
  });
  function onEditingStatesChanged(event) {
    editingState = {
      ...editingState,
      ...(event.details || {}),
    };
    if (event.details?.hasSomethingToRedo === false) {
      const entries = annotationHistoryState.entries || [];
      const position = annotationHistoryState.position ?? -1;
      if (position < entries.length - 1) {
        annotationHistoryState = {
          entries: entries.slice(0, position + 1),
          position,
        };
      }
    }
    emitState();
  }
  eventBus.on("editingstateschanged", onEditingStatesChanged);

  function normalizeRuntimeHistoryType(type) {
    const params = pdfjsLib.AnnotationEditorParamsType || {};
    const typeMap = new Map([
      [params.CREATE, "create"],
      [params.DRAW_STEP, "draw"],
      [params.FREETEXT_COLOR, "freetext"],
      [params.FREETEXT_OPACITY, "freetext"],
      [params.FREETEXT_SIZE, "freetext"],
      [params.HIGHLIGHT_COLOR, "highlight"],
      [params.HIGHLIGHT_THICKNESS, "highlight"],
      [params.INK_COLOR, "ink"],
      [params.INK_COLOR_AND_OPACITY, "ink"],
      [params.INK_OPACITY, "ink"],
      [params.INK_THICKNESS, "ink"],
      [params.RESIZE, "resize"],
    ]);
    return typeMap.get(type) || type || "annotation";
  }

  function getRuntimeHistoryGroup(type) {
    if (type === "draw" || type === "ink" || type === "shape") {
      return "draw";
    }
    return type || "annotation";
  }

  function shouldCoalesceRuntimeHistoryEntry(previous, next) {
    if (!previous || !next) {
      return false;
    }
    if (previous.strategy !== next.strategy) {
      return false;
    }
    const previousGroup = getRuntimeHistoryGroup(previous.type);
    const nextGroup = getRuntimeHistoryGroup(next.type);
    if (previousGroup !== nextGroup) {
      return false;
    }
    const elapsed = Math.abs((next.timestamp || 0) - (previous.timestamp || 0));
    const isDrawCreatePair =
      previous.type === "draw" &&
      (next.type === "ink" || next.type === "shape");
    return previousGroup === "draw" && isDrawCreatePair && elapsed < 1500;
  }

  function createRuntimeHistoryEntry(details, type) {
    const payload = details.payload || {};
    return {
      id: details.id,
      payload: {
        ...payload,
        destination: payload.destination || {
          pageNumber: pdfViewer?.currentPageNumber || 1,
          type,
        },
      },
      strategy: details.strategy || "pdfjs",
      timestamp: details.timestamp || Date.now(),
      type,
    };
  }

  function onEditingHistoryChanged(event) {
    const details = event.details || {};
    const entries = annotationHistoryState.entries || [];
    let nextEntries = entries;
    let nextPosition = annotationHistoryState.position ?? -1;
    const historyType = normalizeRuntimeHistoryType(details.type);

    if (details.action === "add") {
      const nextEntry = createRuntimeHistoryEntry(details, historyType);
      const currentEntries = entries.slice(0, nextPosition + 1);
      const previousEntry = currentEntries.at(-1) || null;
      if (shouldCoalesceRuntimeHistoryEntry(previousEntry, nextEntry)) {
        nextEntries = [
          ...currentEntries.slice(0, -1),
          {
            ...previousEntry,
            id: nextEntry.id || previousEntry.id,
            payload: nextEntry.payload || previousEntry.payload || null,
            timestamp: nextEntry.timestamp,
            type:
              getRuntimeHistoryGroup(nextEntry.type) === "draw"
                ? "ink"
                : nextEntry.type,
          },
        ];
        nextPosition = nextEntries.length - 1;
      } else {
        nextEntries = [...currentEntries, nextEntry];
        nextPosition = nextEntries.length - 1;
      }
    } else if (details.action === "replace") {
      const currentEntries = entries.slice(0, nextPosition + 1);
      if (nextPosition >= 0) {
        nextEntries = currentEntries.slice();
        nextEntries[nextPosition] = {
          ...nextEntries[nextPosition],
          id: details.id || nextEntries[nextPosition].id,
          payload:
            createRuntimeHistoryEntry(details, historyType).payload ||
            nextEntries[nextPosition].payload ||
            null,
          timestamp: details.timestamp || Date.now(),
          type: historyType || nextEntries[nextPosition].type,
        };
      } else {
        nextEntries = [createRuntimeHistoryEntry(details, historyType)];
        nextPosition = 0;
      }
    } else if (details.action === "undo") {
      nextPosition = Math.max(-1, nextPosition - 1);
    } else if (details.action === "redo") {
      nextPosition = Math.min(entries.length - 1, nextPosition + 1);
    } else if (details.action === "clear") {
      nextEntries = [];
      nextPosition = -1;
    } else {
      return;
    }

    annotationHistoryState = {
      entries: nextEntries,
      position: nextPosition,
    };
    emitState();
  }
  eventBus.on("editinghistorychanged", onEditingHistoryChanged);

  const annotationEditorBridge = createAnnotationEditorBridge({
    emitState,
    eventBus,
    initialFreeTextStyle,
    pdfjsLib,
    pdfViewer,
  });
  const wheelZoomController = createWheelZoomController({
    container,
    emitState,
    pdfViewer,
  });
  const viewerActions = createViewerActions({
    downloadManager,
    emitState,
    eventBus,
    filename,
    findController,
    getFilename,
    getCustomOutlineItems,
    getNativeEditingBridge: () => nativeEditingBridge,
    getPdfDocument: () => pdfDocument,
    linkService,
    pdfViewer,
  });
  const annotationCreationActions = createAnnotationCreationActions({
    annotationEditorBridge,
    eventBus,
    getSignatureUi: ensureSignatureUi,
    pdfjsLib,
  });
  const drawToolBridge = createDrawToolBridge({
    emitState,
    pdfjsLib,
    pdfViewer,
    selectEditorAtPoint: annotationEditorBridge.selectEditorAtPoint,
    viewer,
  });
  const findStateTracker = createFindStateTracker({
    emitState,
    eventBus,
    findController,
  });

  const cleanupPagesInit = bindPagesInit({
    emitState,
    eventBus,
    pdfViewer,
  });

  async function loadBookmarksForDocument(document) {
    const loadId = ++bookmarkLoadId;
    bookmarksState = {
      canAddFromSelection: canCreateBookmarkFromSelection(pdfViewer),
      count: 0,
      error: null,
      items: [],
      status: "loading",
    };
    emitState();

    try {
      const outline = await document.getOutline();
      const items = await normalizeBookmarkItems(document, outline);
      if (loadId !== bookmarkLoadId || document !== pdfDocument) {
        return;
      }
      bookmarksState = {
        canAddFromSelection: canCreateBookmarkFromSelection(pdfViewer),
        count: countBookmarks(items),
        error: null,
        items,
        status: "loaded",
      };
    } catch (reason) {
      if (loadId !== bookmarkLoadId || document !== pdfDocument) {
        return;
      }
      bookmarksState = {
        canAddFromSelection: canCreateBookmarkFromSelection(pdfViewer),
        count: 0,
        error: reason?.message || "bookmarks-load-failed",
        items: [],
        status: "error",
      };
    }
    emitState();
  }

  async function loadPdfSecurityForDocument(document, documentSource) {
    const loadId = ++pdfSecurityLoadId;
    pdfSecurityState = {
      ...createInitialPdfSecurityState(),
      status: "loading",
    };
    emitState();

    try {
      const nextState = await readPdfSecurityState({
        pdfDocument: document,
        pdfjsLib,
        source: documentSource,
      });
      if (loadId !== pdfSecurityLoadId || document !== pdfDocument) {
        return;
      }
      pdfSecurityState = nextState;
    } catch (reason) {
      if (loadId !== pdfSecurityLoadId || document !== pdfDocument) {
        return;
      }
      pdfSecurityState = {
        ...createInitialPdfSecurityState(),
        error: reason?.message || "pdf-security-load-failed",
        status: "error",
      };
    }
    emitState();
  }

  function addBookmarkFromSelection() {
    const bookmark = createBookmarkFromSelection(pdfViewer);
    if (!bookmark) {
      updateBookmarkSelectionState();
      return null;
    }
    document.getSelection()?.removeAllRanges();
    const items = [...(bookmarksState.items || []), bookmark];
    bookmarksState = {
      ...bookmarksState,
      canAddFromSelection: false,
      count: countBookmarks(items),
      error: null,
      items,
      status: "loaded",
    };
    emitState();
    return bookmark;
  }

  function updateCustomBookmarkTitle(bookmarkId, title) {
    const nextTitle = title?.trim();
    if (!bookmarkId || !nextTitle) {
      return false;
    }
    let changed = false;
    function updateItems(items = []) {
      return items.map(item => {
        if (item.id === bookmarkId && item.custom) {
          changed = true;
          return { ...item, title: nextTitle };
        }
        if (!item.children?.length) {
          return item;
        }
        const children = updateItems(item.children);
        return children === item.children ? item : { ...item, children };
      });
    }
    const items = updateItems(bookmarksState.items || []);
    if (!changed) {
      return false;
    }
    bookmarksState = {
      ...bookmarksState,
      items,
    };
    emitState();
    return true;
  }

  function deleteCustomBookmark(bookmarkId) {
    if (!bookmarkId) {
      return false;
    }
    let changed = false;
    function deleteFromItems(items = []) {
      const nextItems = [];
      for (const item of items) {
        if (item.id === bookmarkId && item.custom) {
          changed = true;
          continue;
        }
        if (item.children?.length) {
          const children = deleteFromItems(item.children);
          nextItems.push(children === item.children ? item : { ...item, children });
          continue;
        }
        nextItems.push(item);
      }
      return changed ? nextItems : items;
    }
    const items = deleteFromItems(bookmarksState.items || []);
    if (!changed) {
      return false;
    }
    bookmarksState = {
      ...bookmarksState,
      count: countBookmarks(items),
      items,
    };
    emitState();
    return true;
  }

  function getCustomOutlineItems() {
    const customItems = [];
    function collect(items = []) {
      for (const item of items) {
        if (item.custom && item.destination?.pageNumber) {
          customItems.push({
            pageNumber: item.destination.pageNumber,
            title: item.title,
            x: item.destination.x,
            y: item.destination.y,
          });
        }
        if (item.children?.length) {
          collect(item.children);
        }
      }
    }
    collect(bookmarksState.items);
    return customItems;
  }

  const loadedDocument = await openViewerDocument({
    linkService,
    onDocumentLoaded,
    pdfViewer,
    source: source ?? bytes,
  });
  loadingTask = loadedDocument.loadingTask;
  pdfDocument = loadedDocument.pdfDocument;
  annotationEditorBridge.applyFreeTextStyle(initialFreeTextStyle);
  emitState();
  loadBookmarksForDocument(pdfDocument);
  loadPdfSecurityForDocument(pdfDocument, source ?? bytes);

  async function setViewerTool(toolName, options = {}) {
    const { preserveDrawTool = false, ...annotationOptions } = options;
    if (!preserveDrawTool) {
      drawToolBridge.setDrawTool("draw");
    }
    if (toolName === "native-text-edit") {
      annotationEditorBridge.setTool("select");
      (await ensureNativeEditingBridge()).setNativeTextEditMode(true);
      return;
    }
    if (toolName === "native-redact") {
      annotationEditorBridge.setTool("select");
      (await ensureNativeEditingBridge()).setNativeRedactMode(true);
      return;
    }
    nativeEditingBridge?.disable();
    annotationEditorBridge.setTool(toolName, annotationOptions);
  }

  async function setViewerDrawTool(toolName) {
    if (toolName === "stamp-palette") {
      drawToolBridge.setDrawTool("stamp-palette");
      setViewerTool("select", { preserveDrawTool: true });
      return;
    }
    if (toolName === "callout") {
      drawToolBridge.setDrawTool("callout");
      setViewerTool("ink", { preserveDrawTool: true });
      return;
    }
    if (toolName && toolName !== "draw") {
      drawToolBridge.setDrawTool(toolName);
      setViewerTool("ink", { preserveDrawTool: true });
      return;
    }
    drawToolBridge.setDrawTool("draw");
    setViewerTool("ink", { preserveDrawTool: true });
  }

  function setViewerDrawStyle(style) {
    drawToolBridge.setDrawStyle(style);
    annotationEditorBridge.setInkStyle({
      color: style?.color,
      strokeWidth: style?.strokeWidth,
    });
  }

  function setViewerStampSelection(stampSelection) {
    drawToolBridge.setStampSelection(stampSelection);
    setViewerTool(stampSelection ? "image" : "select", {
      preserveDrawTool: true,
    });
  }

  function onDrawModePointerDown(event) {
    if (
      event.button !== 0 ||
      annotationEditorBridge.getActiveTool() !== "ink"
    ) {
      return;
    }
    if (
      annotationEditorBridge.selectEditorAtPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        pointerEvent: event,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  viewer.addEventListener("pointerdown", onDrawModePointerDown, true);

  function readInteractionStateAtPoint({ clientX, clientY } = {}) {
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      annotationEditorBridge.selectEditorAtPoint({ clientX, clientY });
    }
    return getState().viewerInteractionState;
  }

  if (initialTool) {
    await setViewerTool(initialTool);
  }

  return {
    eventBus,
    pdfDocument,
    pdfViewer,
    addBookmarkFromSelection,
    addCommentToSelection: commentBridge.addCommentToSelection,
    addImage: annotationCreationActions.addImage,
    cancelPendingComment: commentBridge.cancelPendingComment,
    clearHistory: viewerActions.clearHistory,
    download: viewerActions.download,
    deleteSelectedAnnotation: viewerActions.deleteSelectedAnnotation,
    deleteBookmark: deleteCustomBookmark,
    exportData: viewerActions.exportData,
    exportRedacted: viewerActions.exportRedacted,
    find: viewerActions.find,
    fitPageWidth: viewerActions.fitPageWidth,
    goToHistoryDestination: viewerActions.goToHistoryDestination,
    goToBookmark: viewerActions.goToBookmark,
    goToComment: commentBridge.goToComment,
    goToPage: viewerActions.goToPage,
    goToSearchResult: viewerActions.goToSearchResult,
    getState,
    readInteractionStateAtPoint,
    getPageThumbnails: onUpdate => {
      const service = getPageThumbnailService();
      if (!service) {
        return {};
      }
      service.setOnUpdate(onUpdate);
      service.start();
      return service.getPreviews();
    },
    deleteSavedSignature: async uuid => {
      const currentSignatureUi = await ensureSignatureUi();
      const deleted = await currentSignatureUi?.signatureStorage?.delete(uuid);
      if (deleted) {
        eventBus.dispatch("storedsignatureschanged", {
          source: currentSignatureUi.signatureStorage,
        });
      }
      return Boolean(deleted);
    },
    listSavedSignatures: async () => {
      const currentSignatureUi = await ensureSignatureUi();
      return currentSignatureUi?.signatureStorage
        ? listSavedSignatures(currentSignatureUi.signatureStorage)
        : [];
    },
    useSavedSignature: async uuid => {
      const currentSignatureUi = await ensureSignatureUi();
      const signatureData = currentSignatureUi?.signatureStorage
        ? await getSavedSignatureCreateData(
            currentSignatureUi.signatureStorage,
            uuid
          )
        : null;
      if (!signatureData) {
        return false;
      }
      eventBus.dispatch("switchannotationeditorparams", {
        source: window,
        type: pdfjsLib.AnnotationEditorParamsType.CREATE,
        value: { signatureData },
      });
      return true;
    },
    nextPage: viewerActions.nextPage,
    organizePages: viewerActions.organizePages,
    print: viewerActions.print,
    previousPage: viewerActions.previousPage,
    refreshComments: commentBridge.refreshComments,
    resetZoom: viewerActions.resetZoom,
    redo: viewerActions.redo,
    resetSelectedEditorRotation:
      annotationEditorBridge.resetSelectedEditorRotation,
    rotateSelectedEditorClockwise:
      annotationEditorBridge.rotateSelectedEditorClockwise,
    rotateClockwise: viewerActions.rotateClockwise,
    save: viewerActions.save,
    savePendingComment: commentBridge.savePendingComment,
    startSelectedEditorResize:
      annotationEditorBridge.startSelectedEditorResize,
    setNativeRedactMode: async enabled =>
      (await ensureNativeEditingBridge()).setNativeRedactMode(enabled),
    setNativeTextEditMode: async enabled =>
      (await ensureNativeEditingBridge()).setNativeTextEditMode(enabled),
    setDrawTool: setViewerDrawTool,
    setDrawStyle: setViewerDrawStyle,
    setHighlightColor: annotationEditorBridge.setHighlightColor,
    setScale: viewerActions.setScale,
    setFreeTextStyle: annotationEditorBridge.setFreeTextStyle,
    setStampSelection: setViewerStampSelection,
    setTool: setViewerTool,
    updateBookmarkTitle: updateCustomBookmarkTitle,
    undo: viewerActions.undo,
    openSignatureDialog: annotationCreationActions.openSignatureDialog,
    zoomWithWheel: wheelZoomController.zoomWithWheel,
    zoomIn: viewerActions.zoomIn,
    zoomOut: viewerActions.zoomOut,
    destroy() {
      bookmarkLoadId++;
      document.removeEventListener(
        "selectionchange",
        scheduleSelectionInteractionStateUpdate
      );
      window.removeEventListener(
        "pointerdown",
        scheduleSelectionInteractionStateUpdate,
        { capture: true }
      );
      window.removeEventListener(
        "pointerup",
        scheduleSelectionInteractionStateUpdate,
        { capture: true }
      );
      window.removeEventListener(
        "mouseup",
        scheduleSelectionInteractionStateUpdate,
        { capture: true }
      );
      window.removeEventListener(
        "keyup",
        scheduleSelectionInteractionStateUpdate,
        { capture: true }
      );
      if (selectionStateFrame) {
        cancelAnimationFrame(selectionStateFrame);
      }
      if (selectionStateTimer) {
        clearTimeout(selectionStateTimer);
      }
      viewer.removeEventListener("pointerdown", onDrawModePointerDown, true);
      eventBus.off("editingstateschanged", onEditingStatesChanged);
      eventBus.off("editinghistorychanged", onEditingHistoryChanged);
      findStateTracker.destroy();
      commentBridge.commentManager.destroy();
      drawToolBridge.destroy();
      nativeEditingBridge?.destroy();
      annotationEditorBridge.destroy();
      resetPageThumbnailService();
      destroyViewerEngine({
        cleanupPagesInit,
        cleanupStateEvents,
        linkService,
        loadingTask,
        pdfViewer,
        signatureUi,
      });
    },
  };
}
