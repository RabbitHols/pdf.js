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

import { getElementClientRect } from "./native_text_edit_geometry.js";

const blockByTextDiv = new WeakMap();

function getSourceText(source) {
  if (source?.grouped === true && typeof source.sourceText === "string") {
    return source.sourceText;
  }
  if (source?.grouped === true && Array.isArray(source.sources)) {
    let text = "";
    for (const entry of source.sources) {
      const sourceText = getSourceText(entry);
      if (typeof sourceText !== "string") {
        return null;
      }
      text += sourceText;
    }
    return text;
  }

  const segments = source?.segments;
  if (!Array.isArray(segments)) {
    return null;
  }

  const textSegments = segments.filter(segment => segment.kind === "text");
  if (textSegments.length === 0) {
    return null;
  }

  if (source.operatorName === "Tj") {
    if (textSegments.length !== 1 || textSegments.length !== segments.length) {
      return null;
    }
  } else if (
    source.operatorName !== "TJ" ||
    segments.some(
      segment => segment.kind !== "text" && segment.kind !== "spacing"
    )
  ) {
    return null;
  }

  return textSegments
    .map(segment => segment.text ?? segment.byteString ?? "")
    .join("");
}

function getTextDivRect(textDiv) {
  return getElementClientRect(textDiv);
}

function getComputedTextStyle(textDiv) {
  const view = textDiv?.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle === "function") {
    return view.getComputedStyle(textDiv);
  }
  return textDiv?.style || null;
}

function getFontSize(textDiv, source, rect) {
  const style = getComputedTextStyle(textDiv);
  const styleFontSize = Number.parseFloat(style?.fontSize);
  const sourceFontSize = Number(source?.fontSize ?? source?.font?.fontSize);
  return (
    (Number.isFinite(styleFontSize) && styleFontSize > 0 && styleFontSize) ||
    (Number.isFinite(sourceFontSize) && sourceFontSize > 0 && sourceFontSize) ||
    rect.height ||
    0
  );
}

function getFontName(textDiv, source) {
  const style = getComputedTextStyle(textDiv);
  return (
    source?.fontName ||
    source?.font?.fontName ||
    style?.fontFamily ||
    style?.font ||
    ""
  );
}

function getDirection(textDiv, source) {
  return (
    source?.dir ||
    textDiv?.dir ||
    getComputedTextStyle(textDiv)?.direction ||
    ""
  );
}

function getVisibleText(textDiv) {
  return (textDiv?.textContent || "").replaceAll("\xa0", " ");
}

function isTextEditXObjectFormUiEditable(source) {
  const target = source?.container?.xObjectFormEditTarget;
  return (
    source?.container?.targetKind === "xobject-form-stream" &&
    target?.strategy === "replace-xobject-form-stream" &&
    target.eligible === true &&
    target.failureReason === null
  );
}

function isTextEditSourceUiEditable(source) {
  return source?.editable === true || isTextEditXObjectFormUiEditable(source);
}

function getLineFacts({ textDiv, textEditSource, pageNumber, index }) {
  const visibleText = getVisibleText(textDiv);
  if (!visibleText.trim()) {
    return null;
  }
  if (!isTextEditSourceUiEditable(textEditSource)) {
    return null;
  }

  const sourceText = getSourceText(textEditSource);
  if (typeof sourceText !== "string") {
    return null;
  }

  const rect = getTextDivRect(textDiv);
  const fontSize = getFontSize(textDiv, textEditSource, rect);
  return {
    index,
    sourceIndex: index,
    textDiv,
    textDivs: [textDiv],
    textEditSource,
    visibleText,
    sourceText,
    rect,
    baseline: rect.bottom,
    fontName: getFontName(textDiv, textEditSource),
    fontSize,
    dir: getDirection(textDiv, textEditSource),
    pageNumber,
  };
}

function isSameRange(rangeA, rangeB) {
  return (
    Array.isArray(rangeA) &&
    Array.isArray(rangeB) &&
    rangeA.length === rangeB.length &&
    rangeA.every((value, index) => value === rangeB[index])
  );
}

function isSameTextEditSource(sourceA, sourceB) {
  if (!sourceA || !sourceB) {
    return false;
  }
  if (sourceA === sourceB) {
    return true;
  }
  if (sourceA.operatorName !== sourceB.operatorName) {
    return false;
  }
  if (
    !isSameRange(sourceA.operatorRange, sourceB.operatorRange) ||
    !isSameRange(sourceA.operandRange, sourceB.operandRange)
  ) {
    return false;
  }
  return (
    JSON.stringify(sourceA.operatorFingerprint || null) ===
    JSON.stringify(sourceB.operatorFingerprint || null)
  );
}

function mergeSameSourceLine(previous, line, spacerEntries) {
  const spacerText = spacerEntries.map(entry => entry.visibleText).join("");
  const spacerTextDivs = spacerEntries.map(entry => entry.textDiv);
  const rect = unionRect([
    previous,
    ...spacerEntries.map(entry => ({ rect: entry.rect })),
    line,
  ]);

  previous.textDivs = [
    ...(previous.textDivs || [previous.textDiv]),
    ...spacerTextDivs,
    ...(line.textDivs || [line.textDiv]),
  ];
  previous.visibleText += spacerText + line.visibleText;
  previous.rect = rect;
  previous.baseline = rect.bottom;
}

function createGroupedTextEditSource(lines) {
  if (lines.length === 1) {
    return lines[0].textEditSource;
  }

  return {
    editable: true,
    grouped: true,
    operatorName: "group",
    sources: lines.map(line => line.textEditSource),
    sourceText: lines.map(line => line.sourceText).join(""),
    fontName: lines[0].fontName,
    fontSize: lines[0].fontSize,
    dir: lines[0].dir,
    webVisualLineGroup: true,
  };
}

function createVisualLine(sourceLines, index) {
  const bbox = unionRect(sourceLines);
  const visibleText = sourceLines.map(line => line.visibleText).join("");
  const sourceText = sourceLines.map(line => line.sourceText).join("");
  const textDivs = sourceLines.flatMap(line => line.textDivs || [line.textDiv]);
  return {
    ...sourceLines[0],
    index,
    sourceIndex: sourceLines[0].sourceIndex,
    sourceLines,
    textDiv: sourceLines[0].textDiv,
    textDivs,
    textEditSource: createGroupedTextEditSource(sourceLines),
    visibleText,
    sourceText,
    rect: bbox,
    baseline: bbox.bottom,
    patchable: true,
  };
}

function getRowTolerance(prevLine, line) {
  return (
    Math.max(
      prevLine.fontSize || prevLine.rect.height || 0,
      line.fontSize || line.rect.height || 0
    ) * 0.45 || 5
  );
}

function isSameVisualRow(prevLine, line) {
  if (prevLine.pageNumber !== line.pageNumber || prevLine.dir !== line.dir) {
    return false;
  }
  const tolerance = Math.max(5, getRowTolerance(prevLine, line));
  const baselineDelta = Math.abs(prevLine.rect.bottom - line.rect.bottom);
  const topDelta = Math.abs(prevLine.rect.top - line.rect.top);
  if (baselineDelta > tolerance && topDelta > tolerance) {
    return false;
  }
  if (!isFontCompatible(prevLine, line)) {
    return false;
  }
  const horizontalGap = line.rect.left - prevLine.rect.right;
  const maxGap = Math.max(8, (prevLine.fontSize || line.fontSize || 10) * 1.5);
  return horizontalGap >= -maxGap && horizontalGap <= maxGap * 3;
}

function buildVisualLines(sourceLines) {
  const visualLines = [];
  let current = [];
  const flush = () => {
    if (!current.length) {
      return;
    }
    visualLines.push(createVisualLine(current, visualLines.length));
    current = [];
  };

  for (const line of sourceLines) {
    const previous = current.at(-1);
    if (previous && !isSameVisualRow(previous, line)) {
      flush();
    }
    current.push(line);
  }
  flush();
  return visualLines;
}

function unionRect(lines) {
  const left = Math.min(...lines.map(line => line.rect.left));
  const top = Math.min(...lines.map(line => line.rect.top));
  const right = Math.max(...lines.map(line => line.rect.right));
  const bottom = Math.max(...lines.map(line => line.rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function isFontCompatible(prevLine, line) {
  const prevSize = prevLine.fontSize || prevLine.rect.height || 1;
  const size = line.fontSize || line.rect.height || 1;
  const maxSize = Math.max(prevSize, size);
  const sizeDelta = Math.abs(prevSize - size);
  if (maxSize > 0 && sizeDelta / maxSize > 0.14) {
    return false;
  }

  if (
    prevLine.fontName &&
    line.fontName &&
    prevLine.fontName !== line.fontName
  ) {
    return false;
  }
  return true;
}

function createLineBlock({ line, blockId, pageNumber }) {
  const blockLine = { ...line, index: 0 };
  return {
    kind: "PdfTextEditBlockCandidate",
    editable: line.patchable !== false,
    sourceBacked: true,
    role: "text-line",
    confidence: "high",
    debugReason: "single-source-backed-visual-line",
    pageNumber,
    blockId,
    textDivs: line.textDivs || [line.textDiv],
    lines: [blockLine],
    bbox: line.rect,
    visibleText: line.visibleText,
    sourceTextLines: [line.sourceText],
    proof: {
      lineCount: 1,
      allLinesEditable: true,
      allLinesPatchable: line.patchable !== false,
      sameColumn: true,
      alignmentCompatible: true,
      fontCompatible: true,
      geometryPolicy: "single-visual-line",
      sourcePolicy: "all-lines-have-editable-source-ref",
    },
    editPolicy: {
      mode: "single-line",
      reflow: false,
      supported: line.patchable !== false,
      unsupportedReason:
        line.patchable !== false ? null : "text-edit-line-unsupported",
    },
  };
}

/**
 * Build source-backed native text edit block candidates for one rendered page.
 *
 * This module intentionally stays viewer/display-side: it groups already
 * rendered text layer spans, but it never invents source refs or PDF patches.
 *
 * @param {Object} params
 * @param {Array<HTMLElement>} params.textDivs
 * @param {function(HTMLElement): Object | null} params.getSource
 * @param {number} [params.pageNumber]
 * @returns {Array<Object>}
 */
function buildNativeTextEditBlocks({ textDivs, getSource, pageNumber = null }) {
  const sourceLineGroups = [];
  let sourceLines = [];
  let spacerEntries = [];
  const flushSourceLines = () => {
    if (sourceLines.length) {
      sourceLineGroups.push(sourceLines);
      sourceLines = [];
    }
    spacerEntries = [];
  };

  for (const [index, textDiv] of textDivs.entries()) {
    blockByTextDiv.delete(textDiv);
    const visibleText = getVisibleText(textDiv);
    const textEditSource = getSource(textDiv);
    const line = getLineFacts({
      textDiv,
      textEditSource,
      pageNumber,
      index,
    });
    if (!line) {
      if (visibleText.trim()) {
        flushSourceLines();
      } else if (sourceLines.length) {
        spacerEntries.push({
          textDiv,
          visibleText,
          rect: getTextDivRect(textDiv),
        });
      }
      continue;
    }

    const previous = sourceLines.at(-1);
    if (
      previous &&
      isSameTextEditSource(previous.textEditSource, line.textEditSource)
    ) {
      mergeSameSourceLine(previous, line, spacerEntries);
      spacerEntries = [];
      continue;
    }
    if (previous && spacerEntries.length > 0) {
      flushSourceLines();
    }
    spacerEntries = [];
    sourceLines.push(line);
  }
  flushSourceLines();

  const blocks = [];
  for (const group of sourceLineGroups) {
    const visualLines = buildVisualLines(group);
    for (const line of visualLines) {
      blocks.push(
        createLineBlock({
          line,
          blockId: `${pageNumber || "page"}:${blocks.length}`,
          pageNumber,
        })
      );
    }
  }

  for (const block of blocks) {
    for (const textDiv of block.textDivs) {
      blockByTextDiv.set(textDiv, block);
    }
  }
  return blocks;
}

function getNativeTextEditBlockForTextDiv(textDiv) {
  return blockByTextDiv.get(textDiv) || null;
}

export { buildNativeTextEditBlocks, getNativeTextEditBlockForTextDiv };
