/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createNativeTextEditGalley } from "./native_text_edit_galley.js";
import { MathClamp } from "pdfjs-lib";

const textLayerSpanStyleProperties = [
  "backgroundColor",
  "color",
  "opacity",
  "textShadow",
  "webkitTextFillColor",
];

function getInputText(inputDiv) {
  return (inputDiv?.textContent || "").replaceAll("\xa0", " ");
}

function normalizeSingleLineEditText(text) {
  return String(text || "").replaceAll(/\r\n?|\n/g, " ");
}

function getReplacementTextFromState(state) {
  const text = getInputText(state?.inputDiv);
  return state?.galley ? normalizeSingleLineEditText(text) : text;
}

function clampCaretIndex(text, caretIndex) {
  return MathClamp(caretIndex || 0, 0, text.length);
}

function getInputCaretIndex(inputDiv) {
  const selection = window.getSelection();
  if (
    !inputDiv ||
    !selection?.rangeCount ||
    !inputDiv.contains(selection.focusNode)
  ) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(inputDiv);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return getInputText({ textContent: range.toString() }).length;
}

function setInputTextAndCaret(inputDiv, text, caretIndex) {
  inputDiv.textContent = text;
  let textNode = inputDiv.firstChild;
  if (!textNode) {
    textNode = document.createTextNode("");
    inputDiv.append(textNode);
  }
  const offset = clampCaretIndex(textNode.data, caretIndex);
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function getBlockLines(blockCandidate) {
  const line = getSingleLineBlockLine(blockCandidate);
  return line ? [line] : null;
}

function getSingleLineBlockLine(blockCandidate) {
  const lines = blockCandidate?.lines;
  return Array.isArray(lines) && lines.length === 1 ? lines[0] : null;
}

function createHiddenTextLayerSpanState(textDiv, blockCandidate, galley) {
  if (galley) {
    return null;
  }
  return hideTextLayerSpans(textDiv, blockCandidate);
}

function getOriginalText(textDiv, blockCandidate) {
  return getSingleLineBlockLine(blockCandidate)
    ? blockCandidate.visibleText
    : textDiv.textContent;
}

function unionRects(rects) {
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  const right = Math.max(...rects.map(rect => rect.right));
  const bottom = Math.max(...rects.map(rect => rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function getEditClientRect(textDiv, blockCandidate) {
  const blockLine = getSingleLineBlockLine(blockCandidate);
  const blockRects = (
    blockLine?.textDivs || (blockLine ? [blockLine.textDiv] : null)
  )
    ?.map(lineTextDiv => lineTextDiv?.getBoundingClientRect())
    .filter(rect => rect?.width || rect?.height);
  return blockRects?.length
    ? unionRects(blockRects)
    : textDiv.getBoundingClientRect();
}

function hideTextLayerSpan(textDiv) {
  const previousStyle = Object.create(null);
  const { style } = textDiv;
  for (const property of textLayerSpanStyleProperties) {
    previousStyle[property] = style[property];
  }

  style.backgroundColor = "transparent";
  style.color = "transparent";
  style.opacity = "0";
  style.textShadow = "none";
  style.webkitTextFillColor = "transparent";
  return previousStyle;
}

function hideTextLayerSpans(textDiv, blockCandidate) {
  const blockLine = getSingleLineBlockLine(blockCandidate);
  const entries = blockLine
    ? (blockLine.textDivs || [blockLine.textDiv]).map(lineTextDiv => ({
        originalText: lineTextDiv.textContent,
        textDiv: lineTextDiv,
      }))
    : [
        {
          originalText: textDiv.textContent,
          textDiv,
        },
      ];
  for (const entry of entries) {
    entry.previousTextLayerStyle = hideTextLayerSpan(entry.textDiv);
  }
  return entries;
}

function restoreTextLayerSpans(state, { restoreText = true } = {}) {
  const entries = state?.hiddenTextLayerSpans;
  if (!entries) {
    return;
  }
  for (const { originalText, previousTextLayerStyle, textDiv } of entries) {
    if (restoreText) {
      textDiv.textContent = originalText;
    }
    for (const property of textLayerSpanStyleProperties) {
      textDiv.style[property] = previousTextLayerStyle[property] || "";
    }
  }
  entries.length = 0;
}

function getBlockLineLayoutAnchor(state) {
  const blockLine = getSingleLineBlockLine(state.blockCandidate);
  if (!blockLine) {
    return {
      caretIndex: state.caretIndex,
      expectedSourceText: state.expectedSourceText,
      replacementText: state.replacementText,
      textDiv: state.textDiv,
    };
  }

  return {
    caretIndex: state.caretIndex,
    expectedSourceText: blockLine.sourceText,
    replacementText: state.replacementText,
    textDiv: blockLine.textDiv,
    textEditSource: blockLine.textEditSource,
    visibleText: blockLine.visibleText,
  };
}

function getBlockLineReplacementLayouts(state) {
  const blockLine = getSingleLineBlockLine(state.blockCandidate);
  if (!blockLine) {
    return null;
  }

  return [
    {
      expectedSourceText: blockLine.sourceText,
      index: 0,
      replacementText: state.replacementText,
      textDiv: blockLine.textDiv,
      textEditSource: blockLine.textEditSource,
      visibleText: blockLine.visibleText,
    },
  ];
}

class NativeTextEditController {
  #active = null;

  #getPageViewForTextDiv = null;

  #layout = null;

  #onCancel = null;

  #onCommit = null;

  #onInput = null;

  #onMoveCommit = null;

  constructor(services) {
    this.setServices(services);
  }

  setServices({
    getPageViewForTextDiv,
    layout,
    onCancel,
    onCommit,
    onInput,
    onMoveCommit = null,
  }) {
    this.#getPageViewForTextDiv = getPageViewForTextDiv;
    this.#layout = layout;
    this.#onCancel = onCancel;
    this.#onCommit = onCommit;
    this.#onInput = onInput;
    this.#onMoveCommit = onMoveCommit;
    return this;
  }

  get active() {
    return this.#active;
  }

  getReplacementText(state = this.#active) {
    if (!state) {
      return "";
    }
    state.replacementText = getReplacementTextFromState(state);
    return state.replacementText;
  }

  setReplacementText(
    state = this.#active,
    replacementText = "",
    { caretIndex = replacementText.length, syncSelection = true } = {}
  ) {
    if (!state || state !== this.#active) {
      return;
    }

    state.replacementText = replacementText;
    state.caretIndex = clampCaretIndex(replacementText, caretIndex);
    if (state.galley) {
      state.galley.setInputTextAndCaret(
        state.replacementText,
        state.caretIndex
      );
    } else {
      setInputTextAndCaret(
        state.inputDiv,
        state.replacementText,
        state.caretIndex
      );
    }
    this.syncInputState(state, { syncSelection });
  }

  start({
    textDiv,
    blockCandidate = null,
    lineCandidate = null,
    expectedSourceText,
    options,
    preview = null,
    previewSession = null,
  }) {
    this.cancel();

    const originalText = getOriginalText(textDiv, blockCandidate);
    const { caretDiv, galley, inputDiv, moveHandle } =
      this.#createEditingSurface(textDiv, blockCandidate, originalText);
    const state = {
      abortController: new AbortController(),
      blockCandidate,
      caretDiv,
      caretHeight: null,
      caretIndex: originalText.length,
      caretViewportOffset: null,
      composing: false,
      committing: false,
      expectedSourceText,
      galley,
      hiddenTextLayerSpans: createHiddenTextLayerSpanState(
        textDiv,
        blockCandidate,
        galley
      ),
      inputDiv,
      lastLayout: null,
      lineCandidate,
      layoutCaretIndex: null,
      layoutTextDiv: textDiv,
      layoutGeneration: 0,
      moveHandle,
      options,
      originalText,
      preview,
      previewGeneration: 0,
      previewSession,
      previewTimer: null,
      replacementText: originalText,
      textDiv,
    };

    this.#active = state;
    textDiv.dataset.pdfjsNativeTextEditActive = "true";
    const blockLine = getSingleLineBlockLine(blockCandidate);
    for (const lineTextDiv of blockLine?.textDivs || []) {
      lineTextDiv.dataset.pdfjsNativeTextEditActive = "true";
    }
    this.#bindInputEvents(state);

    inputDiv.focus();
    if (galley) {
      galley.setInputTextAndCaret(state.replacementText, state.caretIndex);
      this.updateGalleyLayout(state).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        )
      );
    } else {
      setInputTextAndCaret(inputDiv, state.replacementText, state.caretIndex);
      this.updateCaretLayout(state).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        )
      );
    }
    return state;
  }

  cancel(
    state = this.#active,
    { restoreText = true, restorePreview = null } = {}
  ) {
    if (!state) {
      return;
    }

    const { caretDiv, galley, inputDiv, moveHandle, textDiv } = state;
    if (state.previewTimer) {
      clearTimeout(state.previewTimer);
      state.previewTimer = null;
    }
    state.previewGeneration++;
    state.abortController.abort();
    if (inputDiv) {
      if (restoreText) {
        restorePreview?.(state);
      }
      restoreTextLayerSpans(state, { restoreText });
    }
    galley?.destroy({ restoreText });
    inputDiv?.remove();
    moveHandle?.remove();
    caretDiv?.remove();
    delete textDiv.dataset.pdfjsNativeTextEditActive;
    const blockLine = getSingleLineBlockLine(state.blockCandidate);
    for (const lineTextDiv of blockLine?.textDivs || []) {
      delete lineTextDiv.dataset.pdfjsNativeTextEditActive;
    }

    if (this.#active === state) {
      this.#active = null;
    }
  }

  syncInputState(state = this.#active, { syncSelection = true } = {}) {
    if (!state || state !== this.#active) {
      return;
    }

    const replacementText = getReplacementTextFromState(state);
    const caretIndex =
      getInputCaretIndex(state.inputDiv) ?? replacementText.length;
    state.replacementText = replacementText;
    state.caretIndex = clampCaretIndex(replacementText, caretIndex);
    if (syncSelection && !state.composing) {
      if (state.galley) {
        state.galley.setInputTextAndCaret(
          state.replacementText,
          state.caretIndex
        );
      } else {
        setInputTextAndCaret(
          state.inputDiv,
          state.replacementText,
          state.caretIndex
        );
      }
    }
    if (state.galley) {
      this.updateGalleyLayout(state).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        )
      );
    } else {
      this.updateCaretLayout(state).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        )
      );
    }
  }

  setCaretIndex(state = this.#active, caretIndex = 0) {
    if (!state || state !== this.#active) {
      return;
    }

    state.caretIndex = clampCaretIndex(state.replacementText, caretIndex);
    if (!state.composing) {
      if (state.galley) {
        state.galley.setInputTextAndCaret(
          state.replacementText,
          state.caretIndex
        );
      } else {
        setInputTextAndCaret(
          state.inputDiv,
          state.replacementText,
          state.caretIndex
        );
      }
    }
    if (state.galley) {
      this.updateGalleyLayout(state).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        )
      );
      return;
    }
    if (!this.#updateCaretOverlay(state, state.lastLayout)) {
      this.updateCaretLayout(state).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        )
      );
    }
  }

  async updateCaretLayout(state = this.#active) {
    if (!state || state !== this.#active || state.committing) {
      return null;
    }
    if (!state.caretDiv) {
      return null;
    }

    const generation = ++state.layoutGeneration;
    const anchor = getBlockLineLayoutAnchor(state);
    if (!anchor) {
      state.caretDiv.hidden = true;
      return null;
    }

    if (state.layoutTextDiv !== anchor.textDiv) {
      state.caretViewportOffset = null;
      state.caretHeight = null;
    }
    state.layoutTextDiv = anchor.textDiv;
    state.layoutCaretIndex = anchor.caretIndex;
    const layout = await this.#layout({
      textDiv: anchor.textDiv,
      textEditSource: anchor.textEditSource,
      expectedSourceText: anchor.expectedSourceText,
      replacementText: anchor.replacementText,
      editGeneration: generation,
      visibleText: anchor.visibleText,
    });
    if (generation !== state.layoutGeneration || state !== this.#active) {
      return null;
    }

    state.lastLayout = layout;
    this.#updateCaretOverlay(state, layout);
    return layout;
  }

  async updateGalleyLayout(state = this.#active) {
    if (!state?.galley || state !== this.#active || state.committing) {
      return null;
    }

    const lineLayoutInputs = getBlockLineReplacementLayouts(state);
    if (!lineLayoutInputs) {
      return null;
    }

    const generation = ++state.layoutGeneration;
    const lineLayouts = [];
    for (const line of lineLayoutInputs) {
      let layout = null;
      try {
        layout = await this.#layout({
          textDiv: line.textDiv,
          textEditSource: line.textEditSource,
          expectedSourceText: line.expectedSourceText,
          replacementText: line.replacementText,
          editGeneration: generation,
          visibleText: line.visibleText,
        });
      } catch (reason) {
        console.warn(
          "PDFJSNativeTextEditController.beginTextEditLayout:",
          reason
        );
      }
      if (generation !== state.layoutGeneration || state !== this.#active) {
        return null;
      }
      lineLayouts[line.index] = layout;
    }

    if (generation !== state.layoutGeneration || state !== this.#active) {
      return null;
    }

    state.lastLayout = {
      ok: true,
      kind: "pdfjs-native-text-edit-line-galley-layout",
      lineLayouts,
    };
    state.galley.renderTextLayout({
      caretIndex: state.caretIndex,
      lineLayouts,
      lines: lineLayoutInputs.map(line => ({
        index: line.index,
        text: line.replacementText,
        textDiv: line.textDiv,
        visibleText: line.visibleText,
      })),
    });
    return state.lastLayout;
  }

  #bindInputEvents(state) {
    const { inputDiv, textDiv } = state;
    const isBlockEdit = !!getBlockLines(state.blockCandidate);
    inputDiv.addEventListener(
      "keydown",
      event => {
        if (event.key === "Enter" && isBlockEdit) {
          event.preventDefault();
          event.stopPropagation();
          this.#onCommit(textDiv);
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          this.#onCommit(textDiv);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.#onCancel();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          this.setCaretIndex(state, state.caretIndex - 1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          this.setCaretIndex(state, state.caretIndex + 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          event.stopPropagation();
          this.setCaretIndex(state, 0);
        } else if (event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          this.setCaretIndex(state, state.replacementText.length);
        }
      },
      { signal: state.abortController.signal }
    );
    inputDiv.addEventListener(
      "beforeinput",
      event => {
        if (
          event.inputType === "insertParagraph" ||
          event.inputType === "insertLineBreak"
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.#onCommit(textDiv);
        }
      },
      { signal: state.abortController.signal }
    );
    inputDiv.addEventListener(
      "blur",
      () => {
        if (state.options.commitOnBlur && !state.committing) {
          this.#onCommit(textDiv);
        }
      },
      { signal: state.abortController.signal }
    );
    inputDiv.addEventListener(
      "compositionstart",
      () => {
        state.composing = true;
      },
      { signal: state.abortController.signal }
    );
    inputDiv.addEventListener(
      "compositionend",
      () => {
        state.composing = false;
        this.syncInputState(state);
      },
      { signal: state.abortController.signal }
    );
    inputDiv.addEventListener(
      "input",
      () => {
        this.syncInputState(state, { syncSelection: false });
        this.#onInput(state);
      },
      { signal: state.abortController.signal }
    );
    this.#bindMoveHandleEvents(state);
  }

  #bindMoveHandleEvents(state) {
    const { moveHandle } = state;
    if (!moveHandle || !this.#onMoveCommit) {
      return;
    }
    moveHandle.addEventListener(
      "pointerdown",
      event => {
        if (event.button !== 0 || state.committing) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        moveHandle.setPointerCapture(event.pointerId);
        const drag = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          deltaX: 0,
          deltaY: 0,
        };
        state.dragMove = drag;
        moveHandle.dataset.pdfjsNativeTextEditMoveDragging = "true";
      },
      { signal: state.abortController.signal }
    );
    moveHandle.addEventListener(
      "pointermove",
      event => {
        const drag = state.dragMove;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        drag.deltaX = event.clientX - drag.startClientX;
        drag.deltaY = event.clientY - drag.startClientY;
        this.#setMovePreviewTransform(state, drag.deltaX, drag.deltaY);
      },
      { signal: state.abortController.signal }
    );
    moveHandle.addEventListener(
      "pointerup",
      event => {
        const drag = state.dragMove;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        state.dragMove = null;
        delete moveHandle.dataset.pdfjsNativeTextEditMoveDragging;
        moveHandle.releasePointerCapture(event.pointerId);
        const moved = Math.hypot(drag.deltaX, drag.deltaY) >= 1;
        if (!moved) {
          this.#setMovePreviewTransform(state, 0, 0);
          return;
        }
        state.committing = true;
        this.#onMoveCommit(state, {
          deltaX: drag.deltaX,
          deltaY: drag.deltaY,
        }).catch(reason => {
          state.committing = false;
          this.#setMovePreviewTransform(state, 0, 0);
          console.warn("PDFJSNativeTextEditController.moveText:", reason);
        });
      },
      { signal: state.abortController.signal }
    );
  }

  #setMovePreviewTransform(state, deltaX, deltaY) {
    const transform = `translate(${deltaX}px, ${deltaY}px)`;
    const target = state.galley?.element || state.inputDiv;
    if (target) {
      target.style.transform = transform;
    }
    if (state.moveHandle) {
      state.moveHandle.style.transform = transform;
    }
  }

  #createEditingSurface(textDiv, blockCandidate, originalText) {
    if (getSingleLineBlockLine(blockCandidate)) {
      const pageView = this.#getPageViewForTextDiv(textDiv);
      const textLayerDiv = pageView?.textLayer?.div;
      if (!textLayerDiv) {
        throw new Error("pdfjs-native-text-edit-text-layer-missing");
      }
      const galley = createNativeTextEditGalley({
        blockCandidate,
        originalText,
        textLayerDiv,
      });
      return {
        caretDiv: null,
        galley,
        inputDiv: galley.input,
        moveHandle: this.#createMoveHandle(textDiv, blockCandidate),
      };
    }

    const inputDiv = this.#createInput(textDiv, blockCandidate, originalText);
    return {
      caretDiv: this.#createCaret(textDiv),
      galley: null,
      inputDiv,
      moveHandle: this.#createMoveHandle(textDiv, blockCandidate),
    };
  }

  #createMoveHandle(textDiv, blockCandidate) {
    const pageView = this.#getPageViewForTextDiv(textDiv);
    const textLayerDiv = pageView?.textLayer?.div;
    if (!textLayerDiv) {
      throw new Error("pdfjs-native-text-edit-text-layer-missing");
    }

    const handle = document.createElement("div");
    const textRect = getEditClientRect(textDiv, blockCandidate);
    const layerRect = textLayerDiv.getBoundingClientRect();
    handle.setAttribute("title", "Drag to move PDF text");
    handle.setAttribute("aria-hidden", "true");
    handle.dataset.pdfjsNativeTextEditMoveHandle = "true";

    const size = 10;
    const style = handle.style;
    style.position = "absolute";
    style.left = `${textRect.left - layerRect.left - size - 3}px`;
    style.top = `${textRect.top - layerRect.top - size - 3}px`;
    style.width = `${size}px`;
    style.height = `${size}px`;
    style.boxSizing = "border-box";
    style.backgroundColor = "rgb(20 97 255)";
    style.border = "2px solid white";
    style.borderRadius = "2px";
    style.boxShadow = "0 1px 3px rgb(0 0 0 / 35%)";
    style.cursor = "move";
    style.touchAction = "none";
    style.transformOrigin = "0 0";
    style.zIndex = "6";

    textLayerDiv.append(handle);
    return handle;
  }

  #createInput(textDiv, blockCandidate, originalText) {
    const pageView = this.#getPageViewForTextDiv(textDiv);
    const textLayerDiv = pageView?.textLayer?.div;
    if (!textLayerDiv) {
      throw new Error("pdfjs-native-text-edit-text-layer-missing");
    }

    const input = document.createElement("div");
    const textRect = getEditClientRect(textDiv, blockCandidate);
    const layerRect = textLayerDiv.getBoundingClientRect();
    const computedStyle = getComputedStyle(textDiv);
    const isBlockEdit = !!getBlockLines(blockCandidate);
    input.textContent = originalText;
    input.setAttribute("contenteditable", "plaintext-only");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("title", "Enter: save, Esc: cancel");
    input.setAttribute("aria-label", "PDF text edit input");
    input.dataset.pdfjsNativeTextEditInput = "true";

    const style = input.style;
    style.position = "absolute";
    style.left = `${textRect.left - layerRect.left}px`;
    style.top = `${textRect.top - layerRect.top}px`;
    style.width = "max-content";
    style.minWidth = `${textRect.width}px`;
    style.maxWidth = `${Math.max(textRect.width, layerRect.right - textRect.left)}px`;
    style.height = `${textRect.height}px`;
    style.boxSizing = "border-box";
    style.margin = "0";
    style.padding = "0";
    style.overflow = "visible";
    style.whiteSpace = isBlockEdit ? "pre-wrap" : "pre";
    style.backgroundColor = "transparent";
    style.border = "0";
    style.boxShadow = "none";
    style.caretColor = "transparent";
    style.color = "transparent";
    style.font = computedStyle.font;
    style.fontKerning = computedStyle.fontKerning;
    style.letterSpacing = computedStyle.letterSpacing;
    style.lineHeight = computedStyle.lineHeight;
    style.opacity = "0";
    style.outline = "none";
    style.pointerEvents = "auto";
    style.textRendering = computedStyle.textRendering;
    style.transformOrigin = "0 0";
    style.userSelect = "text";
    style.webkitTextFillColor = "transparent";
    style.wordSpacing = computedStyle.wordSpacing;
    style.zIndex = "4";

    textLayerDiv.append(input);
    return input;
  }

  #createCaret(textDiv) {
    const pageView = this.#getPageViewForTextDiv(textDiv);
    const textLayerDiv = pageView?.textLayer?.div;
    if (!textLayerDiv) {
      throw new Error("pdfjs-native-text-edit-text-layer-missing");
    }

    const caret = document.createElement("div");
    caret.dataset.pdfjsNativeTextEditCaret = "true";
    caret.hidden = true;

    const textRect = getEditClientRect(textDiv, null);
    const style = caret.style;
    style.position = "absolute";
    style.left = "0";
    style.top = "0";
    style.width = "2px";
    style.height = `${Math.max(1, textRect.height)}px`;
    style.margin = "0";
    style.padding = "0";
    style.backgroundColor = "rgb(20 97 255)";
    style.borderRadius = "1px";
    style.boxShadow = "0 0 0 1px rgb(255 255 255 / 65%)";
    style.pointerEvents = "none";
    style.transformOrigin = "0 0";
    style.zIndex = "5";

    textLayerDiv.append(caret);
    return caret;
  }

  #updateCaretOverlay(state, layoutResult) {
    if (!state?.caretDiv || !layoutResult?.ok) {
      return false;
    }

    const layout = layoutResult.replacementLayout || layoutResult.sourceLayout;
    const positions = layout?.insertionPositions;
    if (!positions?.length) {
      state.caretDiv.hidden = true;
      return false;
    }

    const sourceStart = layoutResult.sourceLayout?.insertionPositions?.[0];
    if (
      !state.caretViewportOffset &&
      typeof sourceStart?.viewportX === "number" &&
      typeof sourceStart?.viewportY === "number"
    ) {
      const textRect = (
        state.layoutTextDiv || state.textDiv
      ).getBoundingClientRect();
      const layerRect = state.caretDiv.parentElement.getBoundingClientRect();
      state.caretViewportOffset = {
        x: textRect.left - layerRect.left - sourceStart.viewportX,
        y: textRect.top - layerRect.top - sourceStart.viewportY,
      };
      state.caretHeight = Math.max(1, textRect.height);
    }

    const caretIndex = clampCaretIndex(
      layout?.text || state.replacementText,
      state.layoutCaretIndex ?? state.caretIndex
    );
    const point = positions[Math.min(caretIndex, positions.length - 1)];
    if (
      typeof point?.viewportX !== "number" ||
      typeof point?.viewportY !== "number"
    ) {
      state.caretDiv.hidden = true;
      return false;
    }

    const offset = state.caretViewportOffset || { x: 0, y: 0 };
    state.caretDiv.style.left = `${point.viewportX + offset.x}px`;
    state.caretDiv.style.top = `${point.viewportY + offset.y}px`;
    state.caretDiv.style.height = `${state.caretHeight || 1}px`;
    state.caretDiv.hidden = false;
    return true;
  }
}

export { NativeTextEditController };
