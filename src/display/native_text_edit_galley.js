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

import {
  getClientRectForBlockCandidate,
  getElementClientRect,
} from "./native_text_edit_geometry.js";
import { MathClamp } from "pdfjs-lib";

const hiddenTextLayerSpanStyleProperties = [
  "backgroundColor",
  "color",
  "opacity",
  "textShadow",
  "webkitTextFillColor",
];

function clampCaretIndex(text, caretIndex) {
  return MathClamp(caretIndex || 0, 0, text.length);
}

function getBlockLines(blockCandidate) {
  const lines = blockCandidate?.lines;
  return Array.isArray(lines) && lines.length === 1 ? lines : null;
}

function getElementText(element) {
  return (element?.textContent || "").replaceAll("\xa0", " ");
}

function getClientRect(element) {
  return getElementClientRect(element);
}

function getTextNodeAndOffsetForCaret(root, caretIndex) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = caretIndex;
  let lastTextNode = null;
  while (true) {
    const textNode = walker.nextNode();
    if (!textNode) {
      break;
    }
    lastTextNode = textNode;
    const length = getElementText(textNode).length;
    if (remaining <= length) {
      return {
        offset: MathClamp(remaining, 0, textNode.data.length),
        textNode,
      };
    }
    remaining -= length;
  }

  if (lastTextNode) {
    return {
      offset: lastTextNode.data.length,
      textNode: lastTextNode,
    };
  }

  const textNode = document.createTextNode("");
  root.append(textNode);
  return { offset: 0, textNode };
}

function setInputSelectionRange(input, anchorIndex, focusIndex = anchorIndex) {
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const start = getTextNodeAndOffsetForCaret(input, startIndex);
  const end = getTextNodeAndOffsetForCaret(input, endIndex);
  const range = document.createRange();
  range.setStart(start.textNode, start.offset);
  range.setEnd(end.textNode, end.offset);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function setInputSelection(input, caretIndex) {
  setInputSelectionRange(input, caretIndex);
}

function getAdvanceWidth(positions, index, fallbackWidth) {
  const start = positions?.[index];
  const end = positions?.[index + 1];
  if (
    typeof start?.viewportX === "number" &&
    typeof end?.viewportX === "number"
  ) {
    return Math.max(0, Math.abs(end.viewportX - start.viewportX));
  }
  return fallbackWidth;
}

function getLineLayoutPositions(lineLayout, text) {
  const layout = lineLayout?.replacementLayout || lineLayout?.sourceLayout;
  const positions = layout?.insertionPositions;
  if (positions?.length >= text.length + 1) {
    return positions;
  }
  return null;
}

function getViewportPointOffset({ point, sourceStart, textRect, wrapperRect }) {
  if (
    typeof point?.viewportX === "number" &&
    typeof point?.viewportY === "number" &&
    typeof sourceStart?.viewportX === "number" &&
    typeof sourceStart?.viewportY === "number"
  ) {
    return {
      x:
        textRect.left -
        wrapperRect.left +
        point.viewportX -
        sourceStart.viewportX,
      y:
        textRect.top -
        wrapperRect.top +
        point.viewportY -
        sourceStart.viewportY,
    };
  }
  return {
    x: textRect.left - wrapperRect.left,
    y: textRect.top - wrapperRect.top,
  };
}

function createFallbackPositions(text, fallbackWidth) {
  return Array.from({ length: text.length + 1 }, (_, index) => ({
    index,
    viewportX: fallbackWidth * index,
    viewportY: 0,
  }));
}

function buildLineInputLayout({
  inputLine,
  layerRect,
  lineLayout,
  outputIndex,
  wrapperRect,
}) {
  const text = inputLine.text ?? "";
  const textRect = getClientRect(inputLine.textDiv) || {
    left: wrapperRect.left,
    top: wrapperRect.top,
    width: 0,
    height: 0,
  };
  const lineHeight = Math.max(1, textRect.height || 0);
  const fallbackSourceLength = Math.max(
    1,
    (inputLine.visibleText || getElementText(inputLine.textDiv) || text).length
  );
  const fallbackWidth = text ? (textRect.width || 0) / fallbackSourceLength : 0;
  const pdfPositions = getLineLayoutPositions(lineLayout, text);
  const layoutPositions =
    pdfPositions || createFallbackPositions(text, fallbackWidth);
  const sourceStart = pdfPositions
    ? lineLayout?.sourceLayout?.insertionPositions?.[0]
    : null;
  const lineStart = getViewportPointOffset({
    point: layoutPositions[0],
    sourceStart,
    textRect,
    wrapperRect,
  });
  const diagnostics = [];
  if (!pdfPositions) {
    diagnostics.push("galley-line-layout-fallback");
  }

  const caretPositions = layoutPositions.map((point, index) => ({
    index,
    x: Math.max(
      0,
      (point.viewportX || 0) - (layoutPositions[0].viewportX || 0)
    ),
    y: Math.max(
      0,
      (point.viewportY || 0) - (layoutPositions[0].viewportY || 0)
    ),
    height: lineHeight,
  }));
  const characters = [];
  for (let index = 0, ii = text.length; index < ii; index++) {
    const caret = caretPositions[index] || { x: fallbackWidth * index, y: 0 };
    characters.push({
      char: text[index],
      index,
      marginLeft:
        index === 0
          ? caret.x
          : caret.x -
            ((characters[index - 1]?.x || 0) +
              (characters[index - 1]?.width || 0)),
      x: caret.x,
      y: caret.y,
      width: getAdvanceWidth(layoutPositions, index, fallbackWidth),
      height: lineHeight,
    });
  }

  const width = Math.max(
    textRect.width || 0,
    caretPositions.at(-1)?.x || 0,
    (characters.at(-1)?.x || 0) + (characters.at(-1)?.width || 0)
  );
  return {
    caretPositions,
    characters,
    diagnostics,
    height: lineHeight,
    index: inputLine.index ?? outputIndex,
    layerX: textRect.left - layerRect.left,
    layerY: textRect.top - layerRect.top,
    text,
    textDiv: inputLine.textDiv,
    width,
    x: lineStart.x,
    y: lineStart.y,
  };
}

function buildGalleyInputLayout({
  lines,
  lineLayouts = [],
  layerRect = null,
  wrapperRect,
}) {
  const normalizedLayerRect = layerRect || wrapperRect;
  const lineBoxes = [];
  const diagnostics = [];
  let textOffset = 0;
  for (
    let outputIndex = 0, ii = lines?.length || 0;
    outputIndex < ii;
    outputIndex++
  ) {
    const inputLine = lines[outputIndex];
    const lineLayout =
      lineLayouts[inputLine.index] ?? lineLayouts[outputIndex] ?? null;
    const line = buildLineInputLayout({
      inputLine,
      layerRect: normalizedLayerRect,
      lineLayout,
      outputIndex,
      wrapperRect,
    });
    line.textStart = textOffset;
    line.textEnd = textOffset + line.text.length;
    textOffset = line.textEnd + (outputIndex + 1 < ii ? 1 : 0);
    lineBoxes.push(line);
    diagnostics.push(
      ...line.diagnostics.map(reason => ({ line: line.index, reason }))
    );
  }
  return {
    diagnostics,
    lines: lineBoxes,
    textLength: textOffset,
  };
}

function getCaretIndexForLineX(line, x) {
  const carets = line.caretPositions;
  if (!carets?.length) {
    return 0;
  }
  for (let index = 0, ii = carets.length - 1; index < ii; index++) {
    const current = carets[index].x;
    const next = carets[index + 1].x;
    if (x < current + (next - current) / 2) {
      return index;
    }
  }
  return carets.length - 1;
}

function getCaretIndexForLayoutPoint(layout, x, y) {
  const lines = layout?.lines;
  if (!lines?.length) {
    return 0;
  }

  let bestLine = lines[0];
  let bestDistance = Infinity;
  for (const line of lines) {
    const lineTop = line.y;
    const lineBottom = line.y + line.height;
    if (y >= lineTop && y <= lineBottom) {
      bestLine = line;
      break;
    }
    const distance = Math.min(Math.abs(y - lineTop), Math.abs(y - lineBottom));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLine = line;
    }
  }

  const lineX = Math.max(0, x - bestLine.x);
  return bestLine.textStart + getCaretIndexForLineX(bestLine, lineX);
}

function getCaretPositionForLayout(layout, caretIndex) {
  const lines = layout?.lines;
  if (!lines?.length) {
    return null;
  }

  const normalizedCaretIndex = MathClamp(
    caretIndex || 0,
    0,
    layout.textLength || 0
  );
  let targetLine = lines.at(-1);
  for (const line of lines) {
    if (normalizedCaretIndex <= line.textEnd) {
      targetLine = line;
      break;
    }
  }

  const lineCaretIndex = MathClamp(
    normalizedCaretIndex - targetLine.textStart,
    0,
    Math.max(0, targetLine.caretPositions.length - 1)
  );
  const point =
    targetLine.caretPositions[lineCaretIndex] ||
    targetLine.caretPositions.at(-1);
  if (!point) {
    return null;
  }

  return {
    height: Math.max(1, point.height || targetLine.height || 1),
    x: (targetLine.x || 0) + (point.x || 0),
    y: (targetLine.y || 0) + (point.y || 0),
  };
}

function createGalleySpan({
  char,
  character = char,
  height,
  index,
  marginLeft = 0,
  width,
  x,
  y,
}) {
  const span = document.createElement("span");
  span.className = "nativeTextEditGalleyTextSpan";
  span.dataset.pdfjsNativeTextEditGalleyChar = String(index);
  span.dataset.pdfjsNativeTextEditGalleySpan = "true";
  span.dataset.width = String(width);
  span.dataset.xpos = String(x);
  span.textContent = character === " " ? "\xa0" : character;
  Object.assign(span.style, {
    boxSizing: "border-box",
    display: "inline-block",
    height: `${Math.max(1, height)}px`,
    margin: `0 0 0 ${marginLeft}px`,
    overflow: "hidden",
    padding: "0",
    position: "static",
    transform: "none",
    verticalAlign: "middle",
    whiteSpace: "pre",
    width: `${Math.max(0, width)}px`,
  });
  span.style.setProperty("--pdfjs-native-text-edit-char-x", `${x}px`);
  span.style.setProperty("--pdfjs-native-text-edit-char-y", `${y}px`);
  return span;
}

function createLineParagraph(line) {
  const paragraph = document.createElement("p");
  paragraph.className = "nativeTextEditGalleyParagraph";
  paragraph.dataset.pdfjsNativeTextEditGalleyLine = String(line.index);
  Object.assign(paragraph.style, {
    boxSizing: "border-box",
    height: `${line.height}px`,
    left: `${line.x}px`,
    lineHeight: `${line.height}px`,
    margin: "0",
    padding: "0",
    position: "absolute",
    top: `${line.y}px`,
    whiteSpace: "pre",
    width: `${line.width}px`,
  });

  if (line.text.length === 0) {
    paragraph.append(
      createGalleySpan({
        character: "",
        height: line.height,
        index: 0,
        width: 0,
        x: 0,
        y: 0,
      })
    );
    return paragraph;
  }

  for (const character of line.characters) {
    paragraph.append(createGalleySpan(character));
  }
  return paragraph;
}

function renderGalleyInputLayout({ input, layout }) {
  const fragment = document.createDocumentFragment();
  for (let index = 0, ii = layout.lines.length; index < ii; index++) {
    fragment.append(createLineParagraph(layout.lines[index]));
    if (index + 1 < ii) {
      fragment.append(document.createTextNode("\n"));
    }
  }
  input.replaceChildren(fragment);
}

function resizeGalleyToLayout({ element, layout }) {
  if (!element || !layout?.lines?.length) {
    return;
  }
  const width = Math.max(
    element.getBoundingClientRect().width || 0,
    ...layout.lines.map(line => (line.x || 0) + (line.width || 0))
  );
  const height = Math.max(
    element.getBoundingClientRect().height || 0,
    ...layout.lines.map(line => (line.y || 0) + (line.height || 0))
  );
  element.style.width = `${Math.ceil(width)}px`;
  element.style.height = `${Math.ceil(height)}px`;
}

function updateGalleyCaret({ caret, caretIndex, layout }) {
  if (!caret) {
    return false;
  }
  const position = getCaretPositionForLayout(layout, caretIndex);
  if (!position) {
    caret.hidden = true;
    return false;
  }

  caret.style.left = `${position.x}px`;
  caret.style.top = `${position.y}px`;
  caret.style.height = `${position.height}px`;
  caret.hidden = false;
  return true;
}

function getBlockClientRect(blockCandidate) {
  return getBlockLines(blockCandidate)
    ? getClientRectForBlockCandidate(blockCandidate)
    : null;
}

function hideTextLayerSpan(textDiv) {
  const previousStyle = Object.create(null);
  const { style } = textDiv;
  for (const property of hiddenTextLayerSpanStyleProperties) {
    previousStyle[property] = style[property];
  }

  style.backgroundColor = "transparent";
  style.color = "transparent";
  style.opacity = "0";
  style.textShadow = "none";
  style.webkitTextFillColor = "transparent";
  return previousStyle;
}

function restoreTextLayerSpan(
  { originalText, previousStyle, textDiv },
  { restoreText = true } = {}
) {
  if (restoreText) {
    textDiv.textContent = originalText;
  }
  for (const property of hiddenTextLayerSpanStyleProperties) {
    textDiv.style[property] = previousStyle[property] || "";
  }
}

class NativeTextEditGalley {
  #abortController = null;

  #blockCandidate = null;

  #hiddenBlockMarker = null;

  #hiddenTextLayerSpans = [];

  #lastInputLayout = null;

  #mounted = false;

  #originalText = "";

  #selectionAnchorIndex = null;

  #textLayerDiv = null;

  constructor({ blockCandidate, originalText = null, textLayerDiv }) {
    this.#blockCandidate = blockCandidate;
    this.#originalText = originalText ?? blockCandidate?.visibleText ?? "";
    this.#textLayerDiv = textLayerDiv;
    this.canvas = null;
    this.caret = null;
    this.element = null;
    this.input = null;
  }

  mount() {
    if (this.#mounted) {
      return this;
    }

    const rect = getBlockClientRect(this.#blockCandidate);
    const layerRect = this.#textLayerDiv?.getBoundingClientRect();
    if (!getBlockLines(this.#blockCandidate)) {
      throw new Error("pdfjs-native-text-edit-galley-requires-single-line");
    }
    if (!rect?.width || !rect?.height || !layerRect) {
      throw new Error("pdfjs-native-text-edit-galley-rect-missing");
    }

    const wrapper = document.createElement("div");
    wrapper.className = "nativeTextEditGalley";
    wrapper.dataset.pdfjsNativeTextEditGalley = "true";
    wrapper.dataset.pdfjsNativeTextEditBlock =
      this.#blockCandidate?.blockId || "";

    const canvas = document.createElement("canvas");
    canvas.className = "nativeTextEditGalleyCanvas";
    canvas.dataset.pdfjsNativeTextEditGalleyCanvas = "true";
    canvas.setAttribute("aria-hidden", "true");

    const input = document.createElement("div");
    input.className = "nativeTextEditGalleyInput";
    input.textContent = this.#originalText;
    input.setAttribute("contenteditable", "plaintext-only");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("title", "Enter: save, Esc: cancel");
    input.setAttribute("aria-label", "PDF text block edit input");
    input.dataset.pdfjsNativeTextEditGalleyInput = "true";
    input.dataset.pdfjsNativeTextEditInput = "true";

    const caret = document.createElement("div");
    caret.className = "nativeTextEditGalleyCaret";
    caret.dataset.pdfjsNativeTextEditGalleyCaret = "true";
    caret.setAttribute("aria-hidden", "true");
    caret.hidden = true;

    const computedStyle = getComputedStyle(
      this.#blockCandidate.lines[0].textDiv
    );
    Object.assign(input.style, {
      backgroundColor: "transparent",
      border: "0",
      boxShadow: "none",
      boxSizing: "border-box",
      caretColor: "transparent",
      color: "transparent",
      font: computedStyle.font,
      fontKerning: computedStyle.fontKerning,
      height: "100%",
      inset: "0",
      letterSpacing: computedStyle.letterSpacing,
      lineHeight: computedStyle.lineHeight,
      margin: "0",
      opacity: "1",
      outline: "none",
      overflow: "hidden",
      padding: "0",
      pointerEvents: "auto",
      position: "absolute",
      resize: "none",
      textRendering: computedStyle.textRendering,
      transformOrigin: "0 0",
      userSelect: "text",
      webkitTextFillColor: "transparent",
      whiteSpace: "pre-wrap",
      width: "100%",
      wordSpacing: computedStyle.wordSpacing,
      zIndex: "2",
    });

    Object.assign(caret.style, {
      backgroundColor: "rgb(20 97 255)",
      borderRadius: "1px",
      boxShadow: "0 0 0 1px rgb(255 255 255 / 80%)",
      height: `${Math.max(1, rect.height)}px`,
      left: "0",
      margin: "0",
      padding: "0",
      pointerEvents: "none",
      position: "absolute",
      top: "0",
      width: "2px",
      zIndex: "3",
    });

    Object.assign(canvas.style, {
      height: `${rect.height}px`,
      inset: "0",
      pointerEvents: "none",
      position: "absolute",
      width: `${rect.width}px`,
      zIndex: "1",
    });

    Object.assign(wrapper.style, {
      background: "transparent",
      border: "0",
      boxSizing: "border-box",
      height: `${rect.height}px`,
      left: `${rect.left - layerRect.left}px`,
      margin: "0",
      outline: "2px solid rgb(45 126 207)",
      outlineOffset: "0",
      overflow: "hidden",
      padding: "0",
      pointerEvents: "auto",
      position: "absolute",
      top: `${rect.top - layerRect.top}px`,
      transform: "none",
      transformOrigin: "0 0",
      width: `${rect.width}px`,
      zIndex: "4",
    });

    wrapper.append(canvas, input, caret);
    this.#textLayerDiv.append(wrapper);
    this.element = wrapper;
    this.canvas = canvas;
    this.caret = caret;
    this.input = input;
    this.#abortController = new AbortController();
    this.#bindInputPointerSelection();
    this.#hideSourceTextLayerSpans();
    this.#hideBlockMarker();
    this.#mounted = true;
    return this;
  }

  destroy({ restoreText = true } = {}) {
    if (!this.#mounted) {
      return;
    }
    this.restoreTextLayerSpans({ restoreText });
    this.#abortController?.abort();
    this.#abortController = null;
    this.#lastInputLayout = null;
    this.#selectionAnchorIndex = null;
    this.#restoreBlockMarker();
    this.element?.remove();
    this.canvas = null;
    this.caret = null;
    this.element = null;
    this.input = null;
    this.#mounted = false;
  }

  getInputText() {
    return (this.input?.textContent || "").replaceAll("\xa0", " ");
  }

  renderTextLayout({ caretIndex = null, lines, lineLayouts = [] }) {
    if (!this.input || !this.element) {
      return null;
    }

    const layerRect = this.#textLayerDiv.getBoundingClientRect();
    const wrapperRect = this.element.getBoundingClientRect();
    const layout = buildGalleyInputLayout({
      layerRect,
      lineLayouts,
      lines,
      wrapperRect,
    });
    this.#lastInputLayout = layout;
    const replacementText = (lines || [])
      .map(line => line.text || "")
      .join("\n");
    if (replacementText !== this.#originalText) {
      resizeGalleyToLayout({ element: this.element, layout });
    }
    renderGalleyInputLayout({ input: this.input, layout });
    if (typeof caretIndex === "number") {
      this.setInputTextAndCaret(null, caretIndex);
    } else {
      updateGalleyCaret({ caret: this.caret, caretIndex: 0, layout });
    }
    return layout;
  }

  setInputTextAndCaret(text, caretIndex) {
    if (!this.input) {
      return;
    }
    if (typeof text === "string" && text !== this.getInputText()) {
      this.input.textContent = text;
    }
    setInputSelection(
      this.input,
      clampCaretIndex(this.getInputText(), caretIndex)
    );
    updateGalleyCaret({
      caret: this.caret,
      caretIndex: clampCaretIndex(this.getInputText(), caretIndex),
      layout: this.#lastInputLayout,
    });
  }

  #bindInputPointerSelection() {
    const { input } = this;
    const signal = this.#abortController?.signal;
    if (!input || !signal) {
      return;
    }

    input.addEventListener(
      "pointerdown",
      event => {
        if (event.button !== 0 || !this.#lastInputLayout) {
          return;
        }
        event.preventDefault();
        input.focus();
        input.setPointerCapture?.(event.pointerId);
        this.#selectionAnchorIndex = this.#getCaretIndexFromPointerEvent(event);
        setInputSelectionRange(input, this.#selectionAnchorIndex);
        updateGalleyCaret({
          caret: this.caret,
          caretIndex: this.#selectionAnchorIndex,
          layout: this.#lastInputLayout,
        });
      },
      { signal }
    );
    input.addEventListener(
      "pointermove",
      event => {
        if (this.#selectionAnchorIndex === null || !this.#lastInputLayout) {
          return;
        }
        event.preventDefault();
        const focusIndex = this.#getCaretIndexFromPointerEvent(event);
        setInputSelectionRange(input, this.#selectionAnchorIndex, focusIndex);
        updateGalleyCaret({
          caret: this.caret,
          caretIndex: focusIndex,
          layout: this.#lastInputLayout,
        });
      },
      { signal }
    );
    input.addEventListener(
      "pointerup",
      event => {
        if (this.#selectionAnchorIndex !== null) {
          input.releasePointerCapture?.(event.pointerId);
        }
        this.#selectionAnchorIndex = null;
      },
      { signal }
    );
    input.addEventListener(
      "pointercancel",
      () => {
        this.#selectionAnchorIndex = null;
      },
      { signal }
    );
  }

  #getCaretIndexFromPointerEvent(event) {
    const wrapperRect = this.element.getBoundingClientRect();
    return clampCaretIndex(
      this.getInputText(),
      getCaretIndexForLayoutPoint(
        this.#lastInputLayout,
        event.clientX - wrapperRect.left,
        event.clientY - wrapperRect.top
      )
    );
  }

  restoreTextLayerSpans({ restoreText = true } = {}) {
    for (const entry of this.#hiddenTextLayerSpans) {
      restoreTextLayerSpan(entry, { restoreText });
    }
    this.#hiddenTextLayerSpans.length = 0;
  }

  #hideBlockMarker() {
    const blockId = this.#blockCandidate?.blockId;
    if (!blockId) {
      return;
    }
    const marker = Array.from(
      this.#textLayerDiv.querySelectorAll(
        '[data-pdfjs-native-text-edit-block-marker="true"]'
      )
    ).find(candidate => candidate.dataset.pdfjsNativeTextEditBlock === blockId);
    if (!marker) {
      return;
    }
    this.#hiddenBlockMarker = {
      hidden: marker.hidden,
      marker,
    };
    marker.hidden = true;
  }

  #hideSourceTextLayerSpans() {
    for (const line of getBlockLines(this.#blockCandidate) || []) {
      for (const textDiv of line.textDivs || [line.textDiv]) {
        this.#hiddenTextLayerSpans.push({
          originalText: textDiv.textContent,
          previousStyle: hideTextLayerSpan(textDiv),
          textDiv,
        });
      }
    }
  }

  #restoreBlockMarker() {
    if (!this.#hiddenBlockMarker) {
      return;
    }
    const { hidden, marker } = this.#hiddenBlockMarker;
    marker.hidden = hidden;
    this.#hiddenBlockMarker = null;
  }
}

function createNativeTextEditGalley(params) {
  return new NativeTextEditGalley(params).mount();
}

export {
  buildGalleyInputLayout,
  createNativeTextEditGalley,
  getBlockClientRect,
  getCaretIndexForLayoutPoint,
  getCaretPositionForLayout,
  NativeTextEditGalley,
  renderGalleyInputLayout,
};
