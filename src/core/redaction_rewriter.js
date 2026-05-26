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
  buildTextOperatorSource,
  collectContentStreamOperations,
  tokenizeContentStream,
} from "./content_stream_tokenizer.js";
import { bytesToString, stringToBytes } from "../shared/util.js";
import { escapeLiteralString, formatNumber } from "./content_stream_writer.js";
import {
  normalizeRedactionRegions,
  rectIntersectsAnyRegion,
  transformRect,
} from "./redaction_region.js";

const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
const SIMPLE_FONT_SUBTYPES = new Set(["Type1", "MMType1", "TrueType", "Type3"]);
const PATH_OR_PAINT_OPERATORS = new Set([
  "b",
  "B",
  "b*",
  "B*",
  "c",
  "f",
  "F",
  "f*",
  "h",
  "l",
  "m",
  "n",
  "re",
  "s",
  "S",
  "v",
  "W",
  "W*",
  "y",
]);
const UNSUPPORTED_TEXT_SHOWING_OPERATORS = new Set(["'", '"']);

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function toBytes(data) {
  if (typeof data === "string") {
    return stringToBytes(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return null;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cloneState(state) {
  return {
    inTextObject: state.inTextObject,
    ctm: state.ctm.slice(),
    fontName: state.fontName,
    fontSize: state.fontSize,
    charSpacing: state.charSpacing,
    wordSpacing: state.wordSpacing,
    horizontalScale: state.horizontalScale,
    leading: state.leading,
    renderingMode: state.renderingMode,
    rise: state.rise,
    textMatrix: state.textMatrix.slice(),
    textLineMatrix: state.textLineMatrix.slice(),
    graphicsStateStack: state.graphicsStateStack.map(entry => ({
      ctm: entry.ctm.slice(),
    })),
  };
}

function createInitialState() {
  return {
    inTextObject: false,
    ctm: IDENTITY_MATRIX.slice(),
    fontName: null,
    fontSize: null,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    renderingMode: 0,
    rise: 0,
    textMatrix: IDENTITY_MATRIX.slice(),
    textLineMatrix: IDENTITY_MATRIX.slice(),
    graphicsStateStack: [],
  };
}

function translateTextMatrix(state, x, y) {
  const matrix = state.textMatrix;
  matrix[4] = matrix[0] * x + matrix[2] * y + matrix[4];
  matrix[5] = matrix[1] * x + matrix[3] * y + matrix[5];
}

function translateTextLineMatrix(state, x, y) {
  const matrix = state.textLineMatrix;
  matrix[4] = matrix[0] * x + matrix[2] * y + matrix[4];
  matrix[5] = matrix[1] * x + matrix[3] * y + matrix[5];
}

function applyTextTranslation(state, x, y) {
  translateTextLineMatrix(state, x, y);
  state.textMatrix = state.textLineMatrix.slice();
}

function transformMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function numberValue(token) {
  return token?.type === "number" ? token.value : null;
}

function nameValue(token) {
  return token?.type === "name" ? token.value : null;
}

function numberArray(tokens, length) {
  if (tokens.length < length) {
    return null;
  }
  const values = tokens.slice(0, length).map(numberValue);
  return values.every(finiteNumber) ? values : null;
}

function applyNonShowingOperator(operation, state) {
  const operands = operation.operands;
  switch (operation.operatorName) {
    case "q":
      state.graphicsStateStack.push({
        ctm: state.ctm.slice(),
      });
      break;
    case "Q":
      {
        const snapshot = state.graphicsStateStack.pop();
        if (snapshot) {
          state.ctm = snapshot.ctm.slice();
        }
      }
      break;
    case "cm":
      {
        const matrix = numberArray(operands, 6);
        if (matrix) {
          state.ctm = transformMatrices(state.ctm, matrix);
        }
      }
      break;
    case "BT":
      state.inTextObject = true;
      state.textMatrix = IDENTITY_MATRIX.slice();
      state.textLineMatrix = IDENTITY_MATRIX.slice();
      break;
    case "ET":
      state.inTextObject = false;
      break;
    case "Tf":
      state.fontName = nameValue(operands[0]);
      state.fontSize = numberValue(operands[1]);
      break;
    case "Tc":
      state.charSpacing = numberValue(operands[0]) ?? state.charSpacing;
      break;
    case "Tw":
      state.wordSpacing = numberValue(operands[0]) ?? state.wordSpacing;
      break;
    case "Tz":
      state.horizontalScale = finiteNumber(numberValue(operands[0]))
        ? numberValue(operands[0]) / 100
        : state.horizontalScale;
      break;
    case "TL":
      state.leading = numberValue(operands[0]) ?? state.leading;
      break;
    case "Td":
      {
        const delta = numberArray(operands, 2);
        if (delta) {
          applyTextTranslation(state, delta[0], delta[1]);
        }
      }
      break;
    case "TD":
      {
        const delta = numberArray(operands, 2);
        if (delta) {
          state.leading = -delta[1];
          applyTextTranslation(state, delta[0], delta[1]);
        }
      }
      break;
    case "T*":
      applyTextTranslation(state, 0, -state.leading);
      break;
    case "Tr":
      state.renderingMode = numberValue(operands[0]) ?? state.renderingMode;
      break;
    case "Ts":
      state.rise = numberValue(operands[0]) ?? state.rise;
      break;
    case "Tm":
      {
        const matrix = numberArray(operands, 6);
        if (matrix) {
          state.textMatrix = matrix.slice();
          state.textLineMatrix = matrix.slice();
        }
      }
      break;
  }
}

function getFontBinding(fontBindings, fontName) {
  if (!fontName) {
    return null;
  }
  if (fontBindings instanceof Map) {
    return fontBindings.get(fontName) || null;
  }
  return fontBindings?.[fontName] || null;
}

function getBoundFont(fontBindings, fontName) {
  const binding = getFontBinding(fontBindings, fontName);
  return binding?.font || binding;
}

function validateFont(font) {
  if (!font || typeof font !== "object") {
    return unsupported("redact-font-unknown");
  }
  const subtype = font.subtype || font.type || null;
  if (font.composite || subtype === "Type0" || subtype === "CIDFontType0") {
    return unsupported("redact-font-composite-unsupported", { subtype });
  }
  if (subtype && !SIMPLE_FONT_SUBTYPES.has(subtype)) {
    return unsupported("redact-font-subtype-unsupported", { subtype });
  }
  if (font.vertical) {
    return unsupported("redact-font-vertical-unsupported");
  }
  return { ok: true };
}

function getFontMatrix(font) {
  const matrix = font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
  return Array.isArray(matrix) && matrix.length >= 4 && finiteNumber(matrix[0])
    ? matrix
    : null;
}

function lookupWidth(font, charCode, char) {
  if (typeof font.getGlyphWidth === "function") {
    return font.getGlyphWidth(charCode, char);
  }
  if (font.widths instanceof Map) {
    return font.widths.get(charCode);
  }
  if (font.widths && typeof font.widths === "object") {
    return font.widths[charCode] ?? font.widths[char];
  }
  if (finiteNumber(font.defaultWidth)) {
    return font.defaultWidth;
  }
  if (typeof font.charsToGlyphs === "function") {
    const glyphs = font.charsToGlyphs(char);
    if (glyphs?.length === 1 && finiteNumber(glyphs[0].width)) {
      return glyphs[0].width;
    }
  }
  return null;
}

function getVerticalBounds(font) {
  if (finiteNumber(font.descent) && finiteNumber(font.ascent)) {
    return {
      descent: font.descent,
      ascent: font.ascent,
    };
  }
  const fontMatrix = getFontMatrix(font);
  if (fontMatrix && Array.isArray(font.bbox) && font.bbox.length >= 4) {
    return {
      descent: font.bbox[1] * fontMatrix[3],
      ascent: font.bbox[3] * fontMatrix[3],
    };
  }
  return null;
}

function getGlyphMetrics(font, char) {
  const charCode = char.charCodeAt(0);
  if (charCode > 0xff) {
    return unsupported("redact-font-multibyte-glyph-unsupported");
  }

  const width = lookupWidth(font, charCode, char);
  if (!finiteNumber(width)) {
    return unsupported("redact-font-widths-unavailable");
  }

  const bounds = getVerticalBounds(font);
  if (
    !bounds ||
    !finiteNumber(bounds.descent) ||
    !finiteNumber(bounds.ascent)
  ) {
    return unsupported("redact-font-bbox-unavailable");
  }

  const fontMatrix = getFontMatrix(font);
  if (!fontMatrix) {
    return unsupported("redact-font-matrix-unavailable");
  }
  return {
    ok: true,
    width,
    advanceScale: fontMatrix[0],
    minY: bounds.descent,
    maxY: bounds.ascent,
    minX: 0,
    maxX: width * fontMatrix[0],
  };
}

function getCurrentTextTransform(state) {
  const tsm = [
    state.fontSize * state.horizontalScale,
    0,
    0,
    state.fontSize,
    0,
    state.rise,
  ];
  return transformMatrices(state.ctm, transformMatrices(state.textMatrix, tsm));
}

function getGlyphAdvance(state, metrics, char) {
  const spacing =
    state.charSpacing + (char.charCodeAt(0) === 0x20 ? state.wordSpacing : 0);
  const glyphAdvance = metrics.width * metrics.advanceScale * state.fontSize;
  return (glyphAdvance + spacing) * state.horizontalScale;
}

function getGlyphTJAdjustment(state, glyphAdvance) {
  return (-glyphAdvance / (state.fontSize * state.horizontalScale)) * 1000;
}

function advanceGlyph(state, metrics, char) {
  translateTextMatrix(state, getGlyphAdvance(state, metrics, char), 0);
}

function advanceSpacing(state, value) {
  translateTextMatrix(
    state,
    (-value / 1000) * state.fontSize * state.horizontalScale,
    0
  );
}

function appendTextReplacementPart(parts, byteString) {
  const last = parts.at(-1);
  if (last?.kind === "text") {
    last.byteString += byteString;
    return;
  }
  parts.push({
    kind: "text",
    byteString,
  });
}

function appendSpacingReplacementPart(parts, value) {
  const last = parts.at(-1);
  if (last?.kind === "spacing") {
    last.value += value;
    return;
  }
  parts.push({
    kind: "spacing",
    value,
  });
}

function createTextRunReplacement(parts) {
  const chunks = parts.map(part =>
    part.kind === "text"
      ? escapeLiteralString(part.byteString)
      : formatNumber(part.value)
  );
  return ` [${chunks.join(" ")}] TJ `;
}

function validateTextStateForRedaction(state) {
  if (!state.inTextObject) {
    return unsupported("redact-text-operator-outside-text-object");
  }
  if (!state.fontName) {
    return unsupported("redact-font-missing");
  }
  if (!finiteNumber(state.fontSize) || state.fontSize <= 0) {
    return unsupported("redact-font-size-invalid");
  }
  if (!finiteNumber(state.horizontalScale) || state.horizontalScale === 0) {
    return unsupported("redact-horizontal-scale-invalid");
  }
  if (!finiteNumber(state.rise)) {
    return unsupported("redact-text-rise-invalid");
  }
  return { ok: true };
}

function processTextOperation({ operation, regions, state, fontBindings }) {
  const textState = validateTextStateForRedaction(state);
  if (!textState.ok) {
    return textState;
  }

  const font = getBoundFont(fontBindings, state.fontName);
  const fontValidation = validateFont(font);
  if (!fontValidation.ok) {
    return fontValidation;
  }

  const source = buildTextOperatorSource(operation);
  if (!source?.editable) {
    return unsupported("redact-text-source-unsupported", {
      sourceReason: source?.reason || null,
    });
  }

  const replacementParts = [];
  const removed = [];
  let glyphsSeen = 0;
  const workingState = cloneState(state);

  for (const segment of source.segments) {
    if (segment.kind === "spacing") {
      appendSpacingReplacementPart(replacementParts, segment.value);
      advanceSpacing(workingState, segment.value);
      continue;
    }
    if (segment.kind !== "text") {
      return unsupported("redact-text-segment-unsupported", {
        segmentKind: segment.kind || null,
      });
    }

    for (let i = 0, ii = segment.byteString.length; i < ii; i++) {
      const char = segment.byteString.charAt(i);
      const metrics = getGlyphMetrics(font, char);
      if (!metrics.ok) {
        return metrics;
      }

      const transform = getCurrentTextTransform(workingState);
      const glyphRect = transformRect(transform, {
        minX: metrics.minX,
        minY: metrics.minY,
        maxX: metrics.maxX,
        maxY: metrics.maxY,
      });
      const advance = getGlyphAdvance(workingState, metrics, char);
      advanceGlyph(workingState, metrics, char);
      const glyph = {
        byteString: char,
        glyphRect,
        tjAdjustment: getGlyphTJAdjustment(workingState, advance),
      };
      glyphsSeen++;

      if (rectIntersectsAnyRegion(glyphRect, regions)) {
        removed.push(glyph);
        appendSpacingReplacementPart(replacementParts, glyph.tjAdjustment);
      } else {
        appendTextReplacementPart(replacementParts, glyph.byteString);
      }
    }
  }

  state.textMatrix = workingState.textMatrix.slice();
  state.textLineMatrix = workingState.textLineMatrix.slice();
  if (!removed.length) {
    return {
      ok: true,
      changed: false,
      glyphsSeen,
    };
  }

  return {
    ok: true,
    changed: true,
    patch: {
      start: operation.operandRange[0],
      end: operation.operatorRange[1],
      replacement: createTextRunReplacement(replacementParts),
    },
    glyphsRemoved: removed.length,
    bytesRemoved: removed.reduce(
      (sum, glyph) => sum + glyph.byteString.length,
      0
    ),
    glyphsSeen,
  };
}

function validateNonTextOperation(operation) {
  if (operation.operatorName === "BI") {
    return unsupported("redact-inline-image-unsupported");
  }
  if (operation.operatorName === "Do") {
    return unsupported("redact-xobject-unsupported");
  }
  if (operation.operatorName === "sh") {
    return unsupported("redact-shading-unsupported");
  }
  if (PATH_OR_PAINT_OPERATORS.has(operation.operatorName)) {
    return unsupported("redact-path-graphics-unsupported", {
      operatorName: operation.operatorName,
      operatorIndex: operation.operatorIndex,
    });
  }
  if (UNSUPPORTED_TEXT_SHOWING_OPERATORS.has(operation.operatorName)) {
    return unsupported("redact-text-showing-operator-unsupported", {
      operatorName: operation.operatorName,
    });
  }
  return { ok: true };
}

function applyPatches(bytes, patches) {
  const sorted = patches.slice().sort((a, b) => a.start - b.start);
  for (let i = 1, ii = sorted.length; i < ii; i++) {
    if (sorted[i - 1].end > sorted[i].start) {
      return unsupported("redact-rewrite-ranges-overlap");
    }
  }

  const replacementBytes = sorted.map(patch =>
    stringToBytes(patch.replacement)
  );
  const length = sorted.reduce(
    (sum, patch, index) =>
      sum - (patch.end - patch.start) + replacementBytes[index].length,
    bytes.length
  );
  const output = new Uint8Array(length);
  let sourceOffset = 0,
    outputOffset = 0;
  for (let i = 0, ii = sorted.length; i < ii; i++) {
    const patch = sorted[i];
    output.set(bytes.subarray(sourceOffset, patch.start), outputOffset);
    outputOffset += patch.start - sourceOffset;
    output.set(replacementBytes[i], outputOffset);
    outputOffset += replacementBytes[i].length;
    sourceOffset = patch.end;
  }
  output.set(bytes.subarray(sourceOffset), outputOffset);
  return {
    ok: true,
    decodedBytes: output,
  };
}

function createOverlayBytes(regions, fillColor) {
  const [r, g, b] = fillColor;
  const chunks = [
    "\nq\n",
    `${formatNumber(r)} ${formatNumber(g)} ${formatNumber(b)} rg\n`,
  ];
  for (const region of regions) {
    chunks.push(
      `${formatNumber(region.minX)} ${formatNumber(region.minY)} ` +
        `${formatNumber(region.width)} ${formatNumber(region.height)} re\n`
    );
  }
  chunks.push("f\nQ\n");
  return stringToBytes(chunks.join(""));
}

function appendBytes(first, second) {
  const output = new Uint8Array(first.length + second.length);
  output.set(first, 0);
  output.set(second, first.length);
  return output;
}

function rewriteRedactionContentStream({
  decodedBytes,
  regions,
  fontBindings = null,
  overlay = true,
  overlayColor = [0, 0, 0],
}) {
  const bytes = toBytes(decodedBytes);
  if (!bytes) {
    return unsupported("decoded-content-stream-bytes-missing");
  }

  const normalizedRegions = normalizeRedactionRegions(regions);
  if (!normalizedRegions.ok) {
    return normalizedRegions;
  }

  const operations = collectContentStreamOperations(
    tokenizeContentStream(bytes)
  );
  const state = createInitialState();
  const patches = [];
  const unsupportedReasons = [];
  let glyphsRemoved = 0,
    bytesRemoved = 0,
    glyphsVisited = 0;

  for (const operation of operations) {
    const validation = validateNonTextOperation(operation);
    if (!validation.ok) {
      unsupportedReasons.push(validation);
      break;
    }

    if (operation.operatorName === "Tj" || operation.operatorName === "TJ") {
      const result = processTextOperation({
        operation,
        regions: normalizedRegions.regions,
        state,
        fontBindings,
      });
      if (!result.ok) {
        unsupportedReasons.push(result);
        break;
      }
      glyphsVisited += result.glyphsSeen || 0;
      if (result.changed) {
        patches.push(result.patch);
        glyphsRemoved += result.glyphsRemoved;
        bytesRemoved += result.bytesRemoved;
      }
      continue;
    }

    applyNonShowingOperator(operation, state);
  }

  if (unsupportedReasons.length) {
    return unsupported(unsupportedReasons[0].reason, {
      regions: normalizedRegions.regions,
      unsupportedReasons,
      glyphsRemoved: 0,
      bytesRemoved: 0,
    });
  }

  const rewritten = patches.length
    ? applyPatches(bytes, patches)
    : { ok: true, decodedBytes: bytes };
  if (!rewritten.ok) {
    return rewritten;
  }

  const overlayApplied = overlay && glyphsRemoved > 0;
  const outputBytes = overlayApplied
    ? appendBytes(
        rewritten.decodedBytes,
        createOverlayBytes(normalizedRegions.regions, overlayColor)
      )
    : rewritten.decodedBytes;

  return {
    ok: true,
    decodedBytes: outputBytes,
    decodedString: bytesToString(outputBytes),
    report: {
      ok: true,
      reason: null,
      regions: normalizedRegions.regions,
      glyphsVisited,
      glyphsRemoved,
      bytesRemoved,
      overlayApplied,
      unsupportedReasons: [],
    },
  };
}

export { rewriteRedactionContentStream };
