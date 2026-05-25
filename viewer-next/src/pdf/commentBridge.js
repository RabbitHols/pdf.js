function toDateValue(value) {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.startsWith("D:")) {
    const year = value.slice(2, 6);
    const month = value.slice(6, 8) || "01";
    const day = value.slice(8, 10) || "01";
    const hour = value.slice(10, 12) || "00";
    const minute = value.slice(12, 14) || "00";
    const second = value.slice(14, 16) || "00";
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeComment(annotation) {
  const text = annotation?.contentsObj?.str || annotation?.comment?.text || "";
  if (!annotation?.id || !text.trim()) {
    return null;
  }
  return {
    color: annotation.color || null,
    id: annotation.id,
    pageIndex: annotation.pageIndex || 0,
    pageNumber: (annotation.pageIndex || 0) + 1,
    rect: annotation.rect || null,
    text,
    updatedAt: toDateValue(
      annotation.modificationDate || annotation.creationDate || annotation.comment?.date
    ),
  };
}

function sortComments(a, b) {
  if (a.pageIndex !== b.pageIndex) {
    return a.pageIndex - b.pageIndex;
  }
  const topA = a.rect?.[3] ?? 0;
  const topB = b.rect?.[3] ?? 0;
  if (topA !== topB) {
    return topB - topA;
  }
  return a.updatedAt.localeCompare(b.updatedAt);
}

export function createCommentBridge({ emitState, eventBus, pdfjsLib }) {
  const comments = new Map();
  const dialogElement = document.createElement("div");
  dialogElement.className = "viewer-next-comment-dialog";
  dialogElement.hidden = true;

  let linkService = null;
  let pendingEditor = null;
  let pendingDraft = null;
  let pdfViewer = null;
  let selectedCommentId = null;
  let status = "";
  let uiManager = null;

  function notify() {
    emitState();
  }

  function upsertComment(annotation) {
    const comment = normalizeComment(annotation);
    if (!comment) {
      return;
    }
    comments.set(comment.id, comment);
  }

  const commentManager = {
    dialogElement,
    addComment(annotation) {
      upsertComment(annotation);
      notify();
    },
    destroy() {
      comments.clear();
      pendingDraft = null;
      pendingEditor = null;
    },
    destroyPopup() {},
    hideSidebar() {},
    makeCommentColor() {
      return null;
    },
    removeComments(ids = []) {
      for (const id of ids) {
        comments.delete(id);
      }
      if (ids.includes(selectedCommentId)) {
        selectedCommentId = null;
      }
      notify();
    },
    selectComment(id) {
      selectedCommentId = id;
      notify();
    },
    setSidebarUiManager(nextUiManager) {
      uiManager = nextUiManager;
    },
    showDialog(nextUiManager, editor) {
      uiManager = nextUiManager || uiManager;
      pendingEditor = editor;
      pendingDraft = {
        pageNumber: (editor?.pageIndex || 0) + 1,
        text: editor?.comment?.text || "",
      };
      status = "Scrivi il commento nella barra Commenti.";
      notify();
    },
    showSidebar(annotations = []) {
      comments.clear();
      for (const annotation of annotations) {
        upsertComment(annotation);
      }
      status = "";
      notify();
    },
    toggleCommentPopup(editor, isSelected) {
      if (isSelected && editor?.uid) {
        selectedCommentId = editor.uid;
        notify();
      }
    },
    updateComment(annotation) {
      if (annotation?.popupRef === false || !annotation?.contentsObj?.str) {
        comments.delete(annotation?.id);
      } else {
        upsertComment(annotation);
      }
      pendingDraft = null;
      pendingEditor = null;
      status = "";
      notify();
    },
    updatePopupColor() {},
  };

  function attach({ linkService: nextLinkService, pdfViewer: nextPdfViewer }) {
    linkService = nextLinkService;
    pdfViewer = nextPdfViewer;
  }

  function addCommentToSelection() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      status = "Seleziona del testo nel PDF, poi premi Commento.";
      pendingDraft = null;
      notify();
      return false;
    }
    const anchorElement =
      selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    if (!anchorElement?.closest(".textLayer")) {
      status = "Il commento puo' partire solo da una selezione nel testo del PDF.";
      notify();
      return false;
    }
    eventBus.dispatch("editingaction", {
      source: window,
      name: "commentSelection",
    });
    return true;
  }

  function cancelPendingComment() {
    pendingEditor?.remove?.();
    pendingDraft = null;
    pendingEditor = null;
    status = "";
    notify();
  }

  function getState() {
    return {
      comments: Array.from(comments.values()).sort(sortComments),
      pendingDraft,
      selectedCommentId,
      status,
    };
  }

  async function goToComment(id) {
    const comment = comments.get(id);
    if (!comment) {
      return;
    }
    selectedCommentId = id;
    const pageNumber = comment.pageNumber;
    const pageVisiblePromise = uiManager?.waitForEditorsRendered?.(pageNumber);
    if (comment.rect) {
      linkService?.goToXY(pageNumber, comment.rect[0], comment.rect[3], {
        center: "both",
      });
    } else {
      pdfViewer.currentPageNumber = pageNumber;
    }
    await pageVisiblePromise;
    uiManager?.selectComment?.(comment.pageIndex, id);
    notify();
  }

  function refreshComments() {
    if (!pdfViewer || pdfViewer.annotationEditorMode === pdfjsLib.AnnotationEditorType.DISABLE) {
      return;
    }
    let restored = false;
    let cleanupId = null;
    let fallbackId = null;
    const onModeChanged = ({ mode }) => {
      if (mode === pdfjsLib.AnnotationEditorType.POPUP) {
        requestAnimationFrame(restoreTextSelectionMode);
      }
    };
    const stopWaitingForPopupMode = () => {
      eventBus.off("annotationeditormodechanged", onModeChanged);
      if (cleanupId) {
        window.clearTimeout(cleanupId);
        cleanupId = null;
      }
      if (fallbackId) {
        window.clearTimeout(fallbackId);
        fallbackId = null;
      }
    };
    const restoreTextSelectionMode = () => {
      if (
        restored ||
        !pdfViewer ||
        pdfViewer.annotationEditorMode !== pdfjsLib.AnnotationEditorType.POPUP
      ) {
        return;
      }
      restored = true;
      stopWaitingForPopupMode();
      pdfViewer.annotationEditorMode = {
        mode: pdfjsLib.AnnotationEditorType.NONE,
      };
      notify();
    };
    eventBus.on("annotationeditormodechanged", onModeChanged);
    pdfViewer.annotationEditorMode = {
      mode: pdfjsLib.AnnotationEditorType.POPUP,
    };
    fallbackId = window.setTimeout(restoreTextSelectionMode, 500);
    cleanupId = window.setTimeout(stopWaitingForPopupMode, 5000);
    notify();
  }

  function savePendingComment(text) {
    const normalizedText = text.trim();
    if (!pendingEditor || !normalizedText) {
      cancelPendingComment();
      return;
    }
    pendingEditor.comment = normalizedText;
    pendingDraft = null;
    pendingEditor = null;
    status = "";
    notify();
  }

  return {
    addCommentToSelection,
    attach,
    cancelPendingComment,
    commentManager,
    getState,
    goToComment,
    refreshComments,
    savePendingComment,
  };
}
