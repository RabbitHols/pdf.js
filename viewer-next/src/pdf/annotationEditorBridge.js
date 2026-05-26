export function createAnnotationEditorBridge({
  emitState,
  eventBus,
  initialFreeTextStyle = null,
  pdfjsLib,
  pdfViewer,
}) {
  let activeTool = "select";
  let currentHighlightColor = "#ffea00";
  let internalFreeTextFonts = [];
  let pendingEditorMode = null;
  let hasAppliedInitialFreeTextStyle = false;
  let currentFreeTextStyle = normalizeFreeTextStyle(initialFreeTextStyle);

  const toolModes = new Map([
    ["select", pdfjsLib.AnnotationEditorType.NONE],
    ["pointer", pdfjsLib.AnnotationEditorType.NONE],
    ["textbox", pdfjsLib.AnnotationEditorType.FREETEXT],
    ["text", pdfjsLib.AnnotationEditorType.FREETEXT],
    ["comment", pdfjsLib.AnnotationEditorType.POPUP],
    ["highlight", pdfjsLib.AnnotationEditorType.HIGHLIGHT],
    ["ink", pdfjsLib.AnnotationEditorType.INK],
    ["draw", pdfjsLib.AnnotationEditorType.INK],
    ["image", pdfjsLib.AnnotationEditorType.STAMP],
    ["signature", pdfjsLib.AnnotationEditorType.SIGNATURE],
  ]);
  const toolNamesByMode = new Map(
    Array.from(toolModes, ([toolName, mode]) => [mode, toolName])
  );
  const editorTypeNames = new Map([
    [pdfjsLib.AnnotationEditorType.FREETEXT, "freetext"],
    [pdfjsLib.AnnotationEditorType.HIGHLIGHT, "highlight"],
    [pdfjsLib.AnnotationEditorType.INK, "ink"],
    [pdfjsLib.AnnotationEditorType.POPUP, "comment"],
    [pdfjsLib.AnnotationEditorType.STAMP, "stamp"],
    [pdfjsLib.AnnotationEditorType.SIGNATURE, "signature"],
  ]);

  const freeTextStyleParams = new Map([
    ["fontFamily", pdfjsLib.AnnotationEditorParamsType.FREETEXT_FONT_FAMILY],
    ["fontSize", pdfjsLib.AnnotationEditorParamsType.FREETEXT_SIZE],
    ["color", pdfjsLib.AnnotationEditorParamsType.FREETEXT_COLOR],
    ["bold", pdfjsLib.AnnotationEditorParamsType.FREETEXT_BOLD],
    ["italic", pdfjsLib.AnnotationEditorParamsType.FREETEXT_ITALIC],
    ["underline", pdfjsLib.AnnotationEditorParamsType.FREETEXT_UNDERLINE],
    ["script", pdfjsLib.AnnotationEditorParamsType.FREETEXT_SCRIPT],
    ["textAlign", pdfjsLib.AnnotationEditorParamsType.FREETEXT_ALIGN],
    ["lineSpacing", pdfjsLib.AnnotationEditorParamsType.FREETEXT_LINE_SPACING],
    ["listStyle", pdfjsLib.AnnotationEditorParamsType.FREETEXT_LIST_STYLE],
    ["indent", pdfjsLib.AnnotationEditorParamsType.FREETEXT_INDENT],
    [
      "horizontalScale",
      pdfjsLib.AnnotationEditorParamsType.FREETEXT_HORIZONTAL_SCALE,
    ],
    ["charSpacing", pdfjsLib.AnnotationEditorParamsType.FREETEXT_CHAR_SPACING],
  ]);
  const freeTextStyleNamesByParam = new Map(
    Array.from(freeTextStyleParams, ([name, type]) => [type, name])
  );

  function normalizeFreeTextStyle(style = {}) {
    style ||= {};
    const fontSize = Number(style.fontSize);
    const fontFamily =
      typeof style.fontFamily === "string" && style.fontFamily
        ? style.fontFamily
        : "Helvetica";
    const color =
      typeof style.color === "string" && style.color ? style.color : "#000000";
    return {
      bold: Boolean(style.bold),
      charSpacing: Number(style.charSpacing) || 0,
      color,
      fontFamily,
      fontSize:
        Number.isFinite(fontSize) && fontSize > 0
          ? fontSize
          : 12,
      italic: Boolean(style.italic),
      horizontalScale: Number(style.horizontalScale) || 100,
      indent: Number(style.indent) || 0,
      lineSpacing: Number(style.lineSpacing) || 1.35,
      listStyle: style.listStyle || "none",
      script: style.script || "normal",
      textAlign: style.textAlign || "left",
      underline: Boolean(style.underline),
    };
  }

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

  function getAnnotationEditorUiManager() {
    return pdfViewer._layerProperties?.annotationEditorUIManager || null;
  }

  function normalizeEditorList(editors) {
    if (!editors) {
      return [];
    }
    if (Array.isArray(editors)) {
      return editors.filter(Boolean);
    }
    if (typeof editors[Symbol.iterator] === "function") {
      return Array.from(editors).filter(Boolean);
    }
    return [];
  }

  function getSelectedEditors() {
    const uiManager = getAnnotationEditorUiManager();
    const selectedEditors = normalizeEditorList(
      uiManager?.getSelectedEditors?.()
    );
    const firstSelectedEditor = uiManager?.firstSelectedEditor;
    if (
      firstSelectedEditor &&
      !selectedEditors.includes(firstSelectedEditor)
    ) {
      selectedEditors.push(firstSelectedEditor);
    }

    const selectedEditorElements =
      pdfViewer.container?.querySelectorAll?.(
        ".annotationEditorLayer .selectedEditor"
      ) || [];
    for (const element of selectedEditorElements) {
      const editor = uiManager?.getEditor?.(element.id);
      if (editor && !selectedEditors.includes(editor)) {
        selectedEditors.push(editor);
      }
    }
    return selectedEditors;
  }

  function getEditorTypeName(editor) {
    const historyType = editor?.historyType || "";
    if (historyType === "shape") {
      return "shape";
    }
    if (historyType === "image" || historyType === "signature") {
      return historyType;
    }
    return (
      editorTypeNames.get(editor?.editorType) ||
      historyType ||
      String(editor?.editorType || "unknown")
    );
  }

  function getEditorPageElement(editor) {
    const parentPage = editor?.parent?.div?.closest?.(".page[data-page-number]");
    if (parentPage) {
      return parentPage;
    }
    const pageNumber = Number(editor?.pageIndex) + 1;
    return Number.isInteger(pageNumber) && pageNumber > 0
      ? pdfViewer.container?.querySelector(
          `.page[data-page-number="${pageNumber}"]`
        )
      : null;
  }

  function getSelectionState({ container } = {}) {
    const selectedEditors = getSelectedEditors();
    const selectedEditorIds = [];
    const selectedEditorTypes = [];
    const selectedEditorDetails = [];
    const rects = [];
    let firstPage = null;
    let firstPageNumber = null;

    for (const editor of selectedEditors) {
      const id = editor?.id || editor?.uid || null;
      const editorType = getEditorTypeName(editor);
      const historyType = editor?.historyType || editorType;
      const drawTool =
        editor?.viewerNextDrawTool ||
        (editorType === "ink" || editorType === "shape" ? "draw" : null);
      const pageNumber = Number(editor?.pageIndex) + 1;
      if (id) {
        selectedEditorIds.push(id);
      }
      if (editorType && !selectedEditorTypes.includes(editorType)) {
        selectedEditorTypes.push(editorType);
      }
      selectedEditorDetails.push({
        annotationElementId: editor?.annotationElementId || null,
        canComment: editor?.canAddComment !== false,
        drawTool,
        editorType,
        historyType,
        id,
        isResizable: editor?.isResizable === true,
        pageNumber:
          Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null,
      });
      const rect = editor?.div?.getBoundingClientRect?.();
      if (rect?.width > 0 && rect?.height > 0) {
        rects.push(rect);
      }
      if (!firstPage) {
        firstPage = getEditorPageElement(editor);
        firstPageNumber =
          Number(firstPage?.dataset?.pageNumber) ||
          (Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null);
      }
    }

    const rect = unionRects(rects);
    return {
      bounds:
        rect && firstPage
          ? normalizeBounds(rect, firstPage, container || pdfViewer.container)
          : null,
      primaryEditorType: selectedEditorDetails[0]?.editorType || null,
      selectedEditorCount: selectedEditors.length,
      selectedEditorDetails,
      selectedEditorIds,
      selectedEditorTypes,
      pageNumber: firstPageNumber,
    };
  }

  function normalizeFreeTextStyleValue(name, value) {
    if (name === "bold" || name === "italic" || name === "underline") {
      return Boolean(value);
    }
    if (
      name === "fontSize" ||
      name === "lineSpacing" ||
      name === "indent" ||
      name === "horizontalScale" ||
      name === "charSpacing"
    ) {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0
        ? number
        : currentFreeTextStyle[name];
    }
    if (
      name === "fontFamily" ||
      name === "script" ||
      name === "textAlign" ||
      name === "listStyle"
    ) {
      return typeof value === "string" && value
        ? value
        : currentFreeTextStyle[name];
    }
    if (name === "color") {
      return typeof value === "string" && value
        ? value
        : currentFreeTextStyle.color;
    }
    return value;
  }

  function updateCurrentFreeTextStyle(name, value) {
    const nextValue = normalizeFreeTextStyleValue(name, value);
    if (currentFreeTextStyle[name] === nextValue) {
      return false;
    }
    currentFreeTextStyle = {
      ...currentFreeTextStyle,
      [name]: nextValue,
    };
    return true;
  }

  function dispatchEditorParam(type, value) {
    eventBus.dispatch("switchannotationeditorparams", {
      source: window,
      type,
      value,
    });
  }

  function getActiveTool() {
    return activeTool;
  }

  function getToolCapabilities() {
    return Object.fromEntries(
      Array.from(toolModes.keys()).map(toolName => [
        toolName,
        {
          supported: true,
        },
      ])
    );
  }

  function getFreeTextFonts() {
    return {
      internal: internalFreeTextFonts,
    };
  }

  function getFreeTextStyle() {
    return {
      ...currentFreeTextStyle,
    };
  }

  function getHighlightColor() {
    return currentHighlightColor;
  }

  function onFreeTextFontsChanged(event) {
    const existingValues = new Set(internalFreeTextFonts.map(font => font.value));
    const nextFonts = [...internalFreeTextFonts];
    for (const font of event.fonts || []) {
      if (!font?.value || existingValues.has(font.value)) {
        continue;
      }
      existingValues.add(font.value);
      nextFonts.push({
        label: font.label || font.value,
        value: font.value,
      });
    }
    nextFonts.sort((a, b) => a.label.localeCompare(b.label));
    internalFreeTextFonts = nextFonts;
    emitState();
  }

  eventBus.on("freetextfontschanged", onFreeTextFontsChanged);

  function onAnnotationEditorParamsChanged(event) {
    let changed = false;
    for (const [type, value] of event.details || []) {
      const name = freeTextStyleNamesByParam.get(type);
      if (name) {
        if (!hasAppliedInitialFreeTextStyle) {
          queueInitialFreeTextStyleApply();
          continue;
        }
        changed = updateCurrentFreeTextStyle(name, value) || changed;
      }
    }
    if (changed) {
      emitState();
    }
  }

  eventBus.on("annotationeditorparamschanged", onAnnotationEditorParamsChanged);

  function queueInitialFreeTextStyleApply() {
    queueMicrotask(() => {
      if (hasAppliedInitialFreeTextStyle) {
        return;
      }
      hasAppliedInitialFreeTextStyle = true;
      applyFreeTextStyle();
    });
  }

  function applyEditorMode(mode, options = {}) {
    if (pdfViewer.annotationEditorMode === pdfjsLib.AnnotationEditorType.DISABLE) {
      pendingEditorMode = { mode, options };
      return;
    }
    pendingEditorMode = null;
    pdfViewer.annotationEditorMode = { mode, ...options };
  }

  function setTool(toolName, options = {}) {
    const mode = toolModes.get(toolName) ?? pdfjsLib.AnnotationEditorType.NONE;
    activeTool = toolModes.has(toolName) ? toolName : "select";
    applyEditorMode(mode, options);
    emitState();
  }

  function setMode(mode, options = {}) {
    const toolName = toolNamesByMode.get(mode) || "select";
    activeTool = toolName === "pointer" ? "select" : toolName;
    applyEditorMode(mode, options);
    emitState();
  }

  function onAnnotationEditorUiManager() {
    applyFreeTextStyle();
    if (!pendingEditorMode) {
      return;
    }
    const { mode, options } = pendingEditorMode;
    applyEditorMode(mode, options);
    emitState();
  }

  function onShowAnnotationEditorUi({ mode }) {
    setMode(mode);
  }

  function onSwitchAnnotationEditorMode({ source, ...options }) {
    setMode(options.mode, options);
  }

  eventBus.on("showannotationeditorui", onShowAnnotationEditorUi);
  eventBus.on("switchannotationeditormode", onSwitchAnnotationEditorMode);
  eventBus.on("annotationeditoruimanager", onAnnotationEditorUiManager);

  function setFreeTextStyle(name, value) {
    const type = freeTextStyleParams.get(name);
    if (!type) {
      return false;
    }
    const normalizedValue = normalizeFreeTextStyleValue(name, value);
    const changed = updateCurrentFreeTextStyle(name, normalizedValue);
    dispatchEditorParam(type, normalizedValue);
    if (changed) {
      emitState();
    }
    return true;
  }

  function applyFreeTextStyle(style = currentFreeTextStyle) {
    const normalizedStyle = normalizeFreeTextStyle(style);
    for (const [name] of freeTextStyleParams) {
      setFreeTextStyle(name, normalizedStyle[name]);
    }
  }

  function setHighlightColor(color) {
    if (typeof color === "string" && color) {
      currentHighlightColor = color;
    }
    dispatchEditorParam(
      pdfjsLib.AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      currentHighlightColor
    );
    emitState();
  }

  function setInkStyle({ color, strokeWidth }) {
    if (color) {
      dispatchEditorParam(
        pdfjsLib.AnnotationEditorParamsType.INK_COLOR,
        color
      );
    }
    if (strokeWidth) {
      dispatchEditorParam(
        pdfjsLib.AnnotationEditorParamsType.INK_THICKNESS,
        strokeWidth
      );
    }
  }

  function getAnnotationEditorLayersAtPoint(clientX, clientY) {
    const ownerDocument = viewer.ownerDocument || document;
    const hitElements = ownerDocument.elementsFromPoint(clientX, clientY);
    const layers = new Set(
      hitElements
        .map(element => element.closest?.(".annotationEditorLayer"))
        .filter(Boolean)
    );
    for (const element of hitElements) {
      const page = element.closest?.(".page");
      const layer = page?.querySelector?.(".annotationEditorLayer");
      if (layer) {
        layers.add(layer);
      }
    }
    return layers;
  }

  function selectEditorAtPoint({ clientX, clientY, pointerEvent = null }) {
    const uiManager = pdfViewer._layerProperties?.annotationEditorUIManager;
    if (!uiManager) {
      return false;
    }
    const ownerDocument = viewer.ownerDocument || document;
    const layers = getAnnotationEditorLayersAtPoint(clientX, clientY);
    if (!layers.size) {
      return false;
    }

    for (const layer of layers) {
      layer.classList.add("getElements");
      const elements = ownerDocument.elementsFromPoint(clientX, clientY);
      layer.classList.remove("getElements");
      const editorElement = elements.find(element =>
        element.id?.startsWith("pdfjs_internal_editor_")
      );
      if (!editorElement) {
        continue;
      }
      const editor = uiManager.getEditor(editorElement.id);
      if (!editor) {
        continue;
      }
      uiManager.setSelected(editor);
      editor.focus?.();
      if (pointerEvent) {
        editor.pointerdown?.(pointerEvent);
      }
      emitState();
      return true;
    }
    return false;
  }

  function clonePointerDownEvent(event) {
    const ownerWindow = pdfViewer.container?.ownerDocument?.defaultView || window;
    const EventCtor = ownerWindow.PointerEvent || ownerWindow.MouseEvent;
    return new EventCtor("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      pointerId: event.pointerId || 1,
      pointerType: event.pointerType || "mouse",
      screenX: event.screenX,
      screenY: event.screenY,
      shiftKey: event.shiftKey,
    });
  }

  function watchTransformSession({ onFinish = null } = {}) {
    const ac = new AbortController();
    const { signal } = ac;
    let frame = 0;
    const scheduleEmitState = () => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        emitState();
      });
    };
    const finish = () => {
      ac.abort();
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      requestAnimationFrame(() => {
        onFinish?.();
        emitState();
      });
    };
    window.addEventListener("pointermove", scheduleEmitState, {
      capture: true,
      passive: true,
      signal,
    });
    window.addEventListener("pointerup", finish, {
      capture: true,
      once: true,
      signal,
    });
    window.addEventListener("blur", finish, { once: true, signal });
  }

  function temporarilyUseSelectMode() {
    const uiManager = getAnnotationEditorUiManager();
    const previousMode = uiManager?.getMode?.() ?? pdfViewer.annotationEditorMode;
    if (
      previousMode === pdfjsLib.AnnotationEditorType.NONE ||
      previousMode === pdfjsLib.AnnotationEditorType.DISABLE
    ) {
      return () => {};
    }
    pdfViewer.annotationEditorMode = {
      mode: pdfjsLib.AnnotationEditorType.NONE,
    };
    return () => {
      if (uiManager?.getMode?.() === pdfjsLib.AnnotationEditorType.NONE) {
        pdfViewer.annotationEditorMode = { mode: previousMode };
      }
    };
  }

  function normalizeRotation(value) {
    const rotation = Number(value) || 0;
    return ((rotation % 360) + 360) % 360;
  }

  function applyEditorRotation(editor, rotation) {
    if (!editor?.div) {
      return;
    }
    editor.rotation = normalizeRotation(rotation);
    editor.div.setAttribute(
      "data-editor-rotation",
      String((360 - editor.rotation) % 360)
    );
    editor.rotate?.(editor.rotation);
    editor.setDims?.();
    editor.fixAndSetPosition?.();
    editor._onResized?.();
  }

  function setSelectedEditorRotation(rotation) {
    const [editor] = getSelectedEditors();
    if (!editor?.div) {
      return false;
    }
    const savedRotation = normalizeRotation(editor.rotation);
    const nextRotation = normalizeRotation(rotation);
    if (savedRotation === nextRotation) {
      return false;
    }
    editor.addCommands?.({
      cmd: () => {
        applyEditorRotation(editor, nextRotation);
      },
      undo: () => {
        applyEditorRotation(editor, savedRotation);
      },
      mustExec: true,
    });
    emitState();
    return true;
  }

  function rotateSelectedEditorClockwise() {
    const [editor] = getSelectedEditors();
    if (!editor?.div) {
      return false;
    }
    return setSelectedEditorRotation(normalizeRotation(editor.rotation + 90));
  }

  function resetSelectedEditorRotation() {
    const [editor] = getSelectedEditors();
    if (!editor?.div) {
      return false;
    }
    return setSelectedEditorRotation(
      normalizeRotation(editor.parentRotation ?? 0)
    );
  }

  function startSelectedEditorResize(name, event) {
    if (!name || !event) {
      return false;
    }
    const [editor] = getSelectedEditors();
    if (!editor?.isResizable || !editor?.div) {
      return false;
    }
    editor.makeResizable?.();
    const resizer = editor.div.querySelector(
      `.resizers > .resizer[data-resizer-name="${name}"]`
    );
    if (!resizer) {
      return false;
    }
    const restoreMode = temporarilyUseSelectMode();
    resizer.dispatchEvent(clonePointerDownEvent(event));
    watchTransformSession({ onFinish: restoreMode });
    emitState();
    return true;
  }

  async function waitForAnnotationMode(mode) {
    if (pdfViewer.annotationEditorMode === mode) {
      return;
    }
    const { promise, resolve } = Promise.withResolvers();
    eventBus.on(
      "annotationeditormodechanged",
      event => {
        if (event.mode === mode) {
          resolve();
        }
      },
      { once: true }
    );
    await Promise.race([promise, new Promise(resolve => setTimeout(resolve, 300))]);
  }

  return {
    destroy() {
      eventBus.off("freetextfontschanged", onFreeTextFontsChanged);
      eventBus.off(
        "annotationeditorparamschanged",
        onAnnotationEditorParamsChanged
      );
      eventBus.off("showannotationeditorui", onShowAnnotationEditorUi);
      eventBus.off("switchannotationeditormode", onSwitchAnnotationEditorMode);
      eventBus.off("annotationeditoruimanager", onAnnotationEditorUiManager);
    },
    applyFreeTextStyle,
    getActiveTool,
    getFreeTextFonts,
    getFreeTextStyle,
    getHighlightColor,
    getSelectionState,
    getToolCapabilities,
    setFreeTextStyle,
    setHighlightColor,
    setInkStyle,
    selectEditorAtPoint,
    setTool,
    resetSelectedEditorRotation,
    rotateSelectedEditorClockwise,
    startSelectedEditorResize,
    waitForAnnotationMode,
  };
}
