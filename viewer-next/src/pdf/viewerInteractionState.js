const DEFAULT_CAPABILITIES = Object.freeze({
  canBookmark: false,
  canComment: false,
  canDelete: false,
  canHighlight: false,
  canRedact: false,
  canResetRotation: false,
  canResize: false,
  canRotate: false,
  canStyle: false,
  canTransform: false,
  canUseContextMenu: false,
});

const STYLEABLE_TOOLS = new Set([
  "comment",
  "draw",
  "highlight",
  "image",
  "ink",
  "signature",
  "text",
  "textbox",
]);

const STYLEABLE_EDITOR_TYPES = new Set([
  "freetext",
  "free-text",
  "highlight",
  "ink",
  "shape",
]);

const EDITOR_CONTEXT_KINDS = new Map([
  ["free-text", "freetext"],
  ["freetext", "freetext"],
  ["highlight", "highlight"],
  ["image", "image"],
  ["ink", "ink"],
  ["shape", "ink"],
  ["signature", "signature"],
  ["stamp", "stamp"],
]);

const TRANSFORMABLE_EDITOR_TYPES = new Set([
  "image",
  "ink",
  "shape",
  "signature",
  "stamp",
]);

function roundCoordinate(value) {
  return Math.round(value * 10) / 10;
}

function rectToPlainObject(rect, originRect) {
  return {
    height: roundCoordinate(rect.height),
    width: roundCoordinate(rect.width),
    x: roundCoordinate(rect.left - originRect.left),
    y: roundCoordinate(rect.top - originRect.top),
  };
}

function unionRects(rects) {
  if (!rects.length) {
    return null;
  }
  const bounds = {
    bottom: rects[0].bottom,
    left: rects[0].left,
    right: rects[0].right,
    top: rects[0].top,
  };
  for (const rect of rects.slice(1)) {
    bounds.bottom = Math.max(bounds.bottom, rect.bottom);
    bounds.left = Math.min(bounds.left, rect.left);
    bounds.right = Math.max(bounds.right, rect.right);
    bounds.top = Math.min(bounds.top, rect.top);
  }
  return {
    ...bounds,
    height: bounds.bottom - bounds.top,
    width: bounds.right - bounds.left,
  };
}

function getElementPage(element) {
  const page = element?.closest?.(".page[data-page-number]");
  const pageNumber = Number(page?.dataset.pageNumber || 0);
  if (!page || !Number.isInteger(pageNumber) || pageNumber < 1) {
    return null;
  }
  return { page, pageNumber };
}

function normalizeBounds(rect, page, container) {
  if (!rect || !page || !container) {
    return null;
  }
  const pageRect = page.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    page: rectToPlainObject(rect, pageRect),
    viewport: rectToPlainObject(rect, containerRect),
  };
}

function getTextSelectionTarget({ container, viewer }) {
  const selection = viewer?.ownerDocument?.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return null;
  }

  const anchorElement =
    selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
  const textLayer = anchorElement?.closest?.(".textLayer");
  if (!textLayer || !viewer.contains(textLayer)) {
    return null;
  }

  const pageTarget = getElementPage(textLayer);
  if (!pageTarget) {
    return null;
  }

  const rects = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!viewer.contains(range.commonAncestorContainer)) {
      return null;
    }
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) {
        rects.push(rect);
      }
    }
  }

  const rect = unionRects(rects);
  if (!rect) {
    return null;
  }

  return {
    bounds: normalizeBounds(rect, pageTarget.page, container),
    pageNumber: pageTarget.pageNumber,
  };
}

export function createDefaultViewerInteractionState() {
  return {
    activeTool: "select",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
    },
    contextTarget: null,
    contextTargetKind: null,
    selectedEditorCount: 0,
    selectedEditorDetails: [],
    selectedEditorIds: [],
    selectedEditorTypes: [],
    selectionBounds: null,
    selectionKind: "none",
  };
}

export function readViewerInteractionState({
  activeTool = "select",
  annotationEditorSelection = null,
  bookmarksState = null,
  container,
  nativeEditingState = null,
  pdfViewer,
  viewer,
}) {
  const selectedEditors = annotationEditorSelection || {
    bounds: null,
    pageNumber: null,
    primaryEditorType: null,
    selectedEditorCount: 0,
    selectedEditorDetails: [],
    selectedEditorIds: [],
    selectedEditorTypes: [],
  };
  const textSelection = getTextSelectionTarget({ container, viewer });
  const currentPageNumber = pdfViewer?.currentPageNumber || 1;
  const primaryEditorType = selectedEditors.primaryEditorType || null;
  const primaryEditorKind =
    EDITOR_CONTEXT_KINDS.get(primaryEditorType) || "annotation-editor";
  let selectionBounds = null;
  let selectionKind = "none";
  let contextTarget = null;

  if (selectedEditors.selectedEditorCount > 0) {
    selectionKind = "annotation-editor";
    selectionBounds = selectedEditors.bounds;
    contextTarget = {
      editorDetails: selectedEditors.selectedEditorDetails || [],
      editorIds: selectedEditors.selectedEditorIds,
      editorType: primaryEditorType,
      editorTypes: selectedEditors.selectedEditorTypes || [],
      kind: primaryEditorKind,
      pageNumber: selectedEditors.pageNumber || currentPageNumber,
      selectionKind,
    };
  } else if (nativeEditingState?.redactActive) {
    selectionKind = "redaction";
    contextTarget = {
      kind: "redaction",
      pageNumber: nativeEditingState.redactPageNumber || currentPageNumber,
      redactionPatches: nativeEditingState.redactionPatches || 0,
      selectionKind,
    };
  } else if (nativeEditingState?.textEditActive) {
    selectionKind = "native-text";
    contextTarget = {
      kind: "native-text",
      pageNumber: nativeEditingState.textEditPageNumber || currentPageNumber,
      selectionKind,
      textEditEditableCount: nativeEditingState.textEditEditableCount || 0,
    };
  } else if (textSelection) {
    selectionKind = "text";
    selectionBounds = textSelection.bounds;
    contextTarget = {
      kind: "text",
      pageNumber: textSelection.pageNumber,
      selectionKind,
    };
  }

  if (contextTarget && selectionBounds) {
    contextTarget = {
      ...contextTarget,
      bounds: selectionBounds,
    };
  }

  const hasTextSelection = selectionKind === "text";
  const hasSelectedEditor = selectedEditors.selectedEditorCount > 0;
  const hasSingleSelectedEditor = selectedEditors.selectedEditorCount === 1;
  const hasSelectedDrawEditor = Boolean(
    selectedEditors.selectedEditorDetails?.some(
      detail =>
        detail?.drawTool ||
        detail?.editorType === "ink" ||
        detail?.editorType === "shape" ||
        detail?.historyType === "shape"
    )
  );
  const canTransform =
    hasSingleSelectedEditor &&
    Boolean(selectionBounds) &&
    TRANSFORMABLE_EDITOR_TYPES.has(primaryEditorType || "");
  const canResize =
    canTransform &&
    selectedEditors.selectedEditorDetails?.[0]?.isResizable !== false;
  const canRotate = canTransform;
  const effectiveActiveTool = hasSelectedDrawEditor ? "ink" : activeTool;
  const hasSingleEditorType = selectedEditors.selectedEditorTypes?.length === 1;
  const editorCanStyle =
    hasSelectedEditor &&
    hasSingleEditorType &&
    STYLEABLE_EDITOR_TYPES.has(primaryEditorType || "");
  const nativeTextEditable = Boolean(
    nativeEditingState?.textEditActive &&
      nativeEditingState?.textEditEditableCount > 0
  );
  const redactionReady = Boolean(
    nativeEditingState?.redactActive || hasTextSelection
  );
  const canBookmark = Boolean(
    bookmarksState?.canAddFromSelection || hasTextSelection
  );
  const capabilities = {
    canBookmark,
    canComment: hasTextSelection,
    canDelete: hasSelectedEditor,
    canHighlight: hasTextSelection || effectiveActiveTool === "highlight",
    canRedact: redactionReady,
    canResetRotation: canRotate,
    canResize,
    canRotate,
    canStyle:
      editorCanStyle ||
      nativeTextEditable ||
      STYLEABLE_TOOLS.has(effectiveActiveTool),
    canTransform,
    canUseContextMenu: Boolean(contextTarget),
  };

  return {
    activeTool: effectiveActiveTool,
    capabilities,
    contextTarget,
    contextTargetKind: contextTarget?.kind || null,
    selectedEditorCount: selectedEditors.selectedEditorCount,
    selectedEditorDetails: selectedEditors.selectedEditorDetails || [],
    selectedEditorIds: selectedEditors.selectedEditorIds,
    selectedEditorTypes: selectedEditors.selectedEditorTypes || [],
    selectionBounds,
    selectionKind,
  };
}
