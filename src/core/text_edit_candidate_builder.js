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
  getSourceTextFromTextEditSource,
  getTextEditSourceTextSegments,
} from "../shared/text_edit_source.js";
import {
  serializePdfEditContainerDescriptor,
  XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
} from "./text_edit_container_graph.js";
import { buildTextOperatorSource } from "./content_stream_tokenizer.js";

const PDF_TEXT_EDIT_CANDIDATE_KIND = "PdfTextEditCandidate";
const PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND = "PdfTextEditCandidateGroup";
const WRITABLE_CONTENT_STREAM_STRATEGIES = new Set([
  "replace-stream",
  "coalesce-page-contents",
  XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
]);

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function cloneArray(value) {
  return Array.isArray(value) ? value.slice() : null;
}

function cloneTextEditSource(source) {
  if (!source) {
    return null;
  }
  return {
    ...source,
    operatorRange: cloneArray(source.operatorRange),
    operandRange: cloneArray(source.operandRange),
    fullByteRange: cloneArray(source.fullByteRange),
    arrayRange: cloneArray(source.arrayRange),
    segments: Array.isArray(source.segments)
      ? source.segments.map(segment => ({
          ...segment,
          rawRange: cloneArray(segment.rawRange),
          contentRange: cloneArray(segment.contentRange),
          logicalRange: cloneArray(segment.logicalRange),
        }))
      : null,
  };
}

function cloneTextStateSnapshot(state) {
  const horizontalScale =
    typeof state?.horizontalScale === "number"
      ? state.horizontalScale
      : state?.textHScale;
  const rise = typeof state?.rise === "number" ? state.rise : state?.textRise;
  return {
    inTextObject: state?.inTextObject === true,
    ctm: cloneArray(state?.ctm),
    fontName: state?.fontName || null,
    fontLoadedName: state?.fontLoadedName || null,
    fontRef: state?.fontRef || null,
    fontSize: typeof state?.fontSize === "number" ? state.fontSize : null,
    charSpacing:
      typeof state?.charSpacing === "number" ? state.charSpacing : null,
    wordSpacing:
      typeof state?.wordSpacing === "number" ? state.wordSpacing : null,
    horizontalScale:
      typeof horizontalScale === "number" ? horizontalScale : null,
    leading: typeof state?.leading === "number" ? state.leading : null,
    renderingMode:
      typeof state?.renderingMode === "number" ? state.renderingMode : null,
    rise: typeof rise === "number" ? rise : null,
    textMatrix: cloneArray(state?.textMatrix),
    textLineMatrix: cloneArray(state?.textLineMatrix),
    graphicsStateDepth:
      typeof state?.graphicsStateDepth === "number"
        ? state.graphicsStateDepth
        : null,
    markedContentDepth:
      typeof state?.markedContentDepth === "number"
        ? state.markedContentDepth
        : null,
    unsupportedContextReasons: Array.isArray(state?.unsupportedContextReasons)
      ? state.unsupportedContextReasons.slice()
      : [],
  };
}

function normalizeFontBinding({ font = null, fontRef = null, state = null }) {
  return {
    fontName: state?.fontName || null,
    fontLoadedName: state?.fontLoadedName || null,
    fontRef: fontRef || state?.fontRef || null,
    fontSize: typeof state?.fontSize === "number" ? state.fontSize : null,
    encodeStringAvailable: typeof font?.encodeString === "function",
    vertical: font?.vertical === true,
    isType3Font: font?.isType3Font === true,
    fallbackName: font?.fallbackName || null,
    defaultWidth:
      typeof font?.defaultWidth === "number" ? font.defaultWidth : null,
  };
}

function getTextSegmentWidths(source, font) {
  if (typeof font?.charsToGlyphs !== "function") {
    return null;
  }
  const widths = [];
  for (const segment of source.segments || []) {
    if (segment.kind !== "text") {
      continue;
    }
    const glyphs = font.charsToGlyphs(segment.text || segment.byteString || "");
    if (!Array.isArray(glyphs)) {
      return null;
    }
    widths.push(
      ...glyphs.map(glyph =>
        typeof glyph?.width === "number" ? glyph.width : null
      )
    );
  }
  return widths.every(width => typeof width === "number") ? widths : null;
}

function buildLayoutProof({ source, state, font }) {
  const glyphWidths = getTextSegmentWidths(source, font);
  const spacingSegments = (source.segments || []).filter(
    segment => segment.kind === "spacing"
  );
  if (!glyphWidths) {
    return {
      ok: false,
      reason: "text-edit-glyph-width-proof-missing",
      spacingSegmentCount: spacingSegments.length,
    };
  }
  const fontSize = typeof state.fontSize === "number" ? state.fontSize : 0;
  const horizontalScale =
    typeof state.horizontalScale === "number" ? state.horizontalScale : 1;
  const sourceAdvance = glyphWidths.reduce(
    (sum, width) => sum + (width * fontSize * horizontalScale) / 1000,
    0
  );
  const tjAdjustment = spacingSegments.reduce(
    (sum, segment) =>
      sum + (-segment.value * fontSize * horizontalScale) / 1000,
    0
  );
  return {
    ok: true,
    glyphCount: glyphWidths.length,
    glyphWidthSum: glyphWidths.reduce((sum, width) => sum + width, 0),
    sourceAdvance,
    tjAdjustment,
    spacingSegmentCount: spacingSegments.length,
    whitespacePolicy:
      spacingSegments.length > 0 ? "tj-spacing-segments" : "glyph-spacing",
  };
}

function getSourceFontKey(source) {
  return `${source.fontName || ""}/${source.fontLoadedName || ""}`;
}

function getComparableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSameNumber(valueA, valueB) {
  const a = getComparableNumber(valueA);
  const b = getComparableNumber(valueB);
  return a === null || b === null || Math.abs(a - b) <= 1e-7;
}

function isSameMatrix(matrixA, matrixB) {
  if (!Array.isArray(matrixA) || !Array.isArray(matrixB)) {
    return true;
  }
  return (
    matrixA.length === matrixB.length &&
    matrixA.every((value, index) => isSameNumber(value, matrixB[index]))
  );
}

function getReplacementSource(source) {
  const segments = source?.segments;
  if (!Array.isArray(segments)) {
    return null;
  }

  const textSegments = getTextEditSourceTextSegments(source);
  if (textSegments.length === 0) {
    return null;
  }

  if (source.operatorName === "Tj") {
    const sourceText = getSourceTextFromTextEditSource(source);
    return sourceText !== null
      ? {
          rawKind: textSegments[0].rawKind,
          sourceText,
        }
      : null;
  }

  if (
    source.operatorName !== "TJ" ||
    segments.some(
      segment => segment.kind !== "text" && segment.kind !== "spacing"
    )
  ) {
    return null;
  }

  return {
    rawKind: textSegments[0].rawKind,
    sourceText: getSourceTextFromTextEditSource(source),
  };
}

function getNormalizedTextState(source) {
  return cloneTextStateSnapshot(source?.textState || null);
}

function isWritableContentStreamStrategy(strategy) {
  return WRITABLE_CONTENT_STREAM_STRATEGIES.has(strategy);
}

function validateGroupSourceState({ first, source }) {
  const firstState = getNormalizedTextState(first);
  const state = getNormalizedTextState(source);
  if (!isSameNumber(firstState.fontSize, state.fontSize)) {
    return unsupported("text-edit-source-group-font-size-mismatch");
  }
  if (!isSameNumber(firstState.horizontalScale, state.horizontalScale)) {
    return unsupported("text-edit-source-group-horizontal-scale-mismatch");
  }
  if (!isSameNumber(firstState.charSpacing, state.charSpacing)) {
    return unsupported("text-edit-source-group-char-spacing-mismatch");
  }
  if (!isSameNumber(firstState.wordSpacing, state.wordSpacing)) {
    return unsupported("text-edit-source-group-word-spacing-mismatch");
  }
  if (!isSameNumber(firstState.rise, state.rise)) {
    return unsupported("text-edit-source-group-rise-mismatch");
  }
  if (!isSameMatrix(firstState.ctm, state.ctm)) {
    return unsupported("text-edit-source-group-ctm-mismatch");
  }
  if (
    firstState.graphicsStateDepth !== null &&
    state.graphicsStateDepth !== null &&
    firstState.graphicsStateDepth !== state.graphicsStateDepth
  ) {
    return unsupported("text-edit-source-group-graphics-state-mismatch");
  }
  if (
    firstState.markedContentDepth !== null &&
    state.markedContentDepth !== null &&
    firstState.markedContentDepth !== state.markedContentDepth
  ) {
    return unsupported("text-edit-source-group-marked-content-mismatch");
  }
  return { ok: true };
}

function validateTextEditCandidateGroupSources(textEditSources) {
  if (!Array.isArray(textEditSources) || textEditSources.length < 2) {
    return unsupported("text-edit-source-group-missing");
  }
  const sorted = textEditSources
    .map(cloneTextEditSource)
    .toSorted((a, b) => a.operatorIndex - b.operatorIndex);
  const fontKey = getSourceFontKey(sorted[0]);
  let sourceText = "";
  for (let i = 0, ii = sorted.length; i < ii; i++) {
    const source = sorted[i];
    if (!source?.editable) {
      return unsupported("text-edit-source-not-editable", {
        sourceReason: source?.reason || null,
      });
    }
    if (source.operatorName !== "Tj" && source.operatorName !== "TJ") {
      return unsupported("text-edit-source-operator-not-supported", {
        operatorName: source.operatorName || null,
      });
    }
    if (i > 0 && sorted[i - 1].fullByteRange?.[1] > source.fullByteRange?.[0]) {
      return unsupported("text-edit-source-group-not-source-ordered");
    }
    if (getSourceFontKey(source) !== fontKey) {
      return unsupported("text-edit-source-group-font-mismatch");
    }
    if (i > 0) {
      const stateValidation = validateGroupSourceState({
        first: sorted[0],
        source,
      });
      if (!stateValidation.ok) {
        return stateValidation;
      }
    }
    const replacementSource = getReplacementSource(source);
    if (!replacementSource) {
      return unsupported("text-edit-source-not-single-text-segment");
    }
    sourceText += replacementSource.sourceText;
  }
  return {
    ok: true,
    textEditSources: sorted,
    sourceText,
    fontKey,
  };
}

function buildGroupLayoutFacts(textItem = null) {
  if (!textItem) {
    return null;
  }
  return {
    text: typeof textItem.str === "string" ? textItem.str : null,
    width: getComparableNumber(textItem.width),
    height: getComparableNumber(textItem.height),
    transform: cloneArray(textItem.transform),
    fontName: textItem.fontName || null,
    hasEOL: textItem.hasEOL === true,
  };
}

function getGroupLineContinuity(textEditSources) {
  const firstState = getNormalizedTextState(textEditSources[0]);
  return textEditSources
    .slice(1)
    .every(source =>
      isSameMatrix(
        firstState.textLineMatrix,
        getNormalizedTextState(source).textLineMatrix
      )
    )
    ? "same-text-line-matrix"
    : "text-item-layout-facts";
}

function buildTextEditCandidateGroup({
  container = null,
  textEditSources,
  textItem = null,
  font = null,
}) {
  const serializedContainer = serializePdfEditContainerDescriptor(container);
  if (container && !serializedContainer) {
    return unsupported("text-edit-container-missing", {
      candidateGroup: {
        kind: PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND,
        editable: false,
        reason: "text-edit-container-missing",
      },
    });
  }
  if (
    serializedContainer &&
    !isWritableContentStreamStrategy(serializedContainer.writableStrategy)
  ) {
    return unsupported("text-edit-container-writer-unsupported", {
      candidateGroup: {
        kind: PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND,
        editable: false,
        reason: "text-edit-container-writer-unsupported",
        container: serializedContainer,
      },
    });
  }

  const group = validateTextEditCandidateGroupSources(textEditSources);
  if (!group.ok) {
    return unsupported(group.reason, {
      ...group,
      candidateGroup: {
        kind: PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND,
        editable: false,
        reason: group.reason,
        container: serializedContainer || null,
      },
    });
  }

  return {
    ok: true,
    candidateGroup: {
      kind: PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND,
      editable: true,
      grouped: true,
      operatorName: "group",
      reason: null,
      container: serializedContainer || null,
      sources: group.textEditSources,
      sourceText: group.sourceText,
      operatorRange: [
        group.textEditSources[0].operatorRange?.[0] ?? null,
        group.textEditSources.at(-1).operatorRange?.[1] ?? null,
      ],
      operandRange: [
        group.textEditSources[0].operandRange?.[0] ?? null,
        group.textEditSources.at(-1).operandRange?.[1] ?? null,
      ],
      fullByteRange: [
        group.textEditSources[0].fullByteRange?.[0] ?? null,
        group.textEditSources.at(-1).fullByteRange?.[1] ?? null,
      ],
      layoutFacts: buildGroupLayoutFacts(textItem),
      proof: {
        containerWritable: serializedContainer
          ? isWritableContentStreamStrategy(
              serializedContainer.writableStrategy
            )
          : null,
        sourceText: group.sourceText,
        fontBinding: normalizeFontBinding({
          font,
          state: getNormalizedTextState(group.textEditSources[0]),
        }),
        stateCompatibility: {
          fontKey: group.fontKey,
          fontSize: getNormalizedTextState(group.textEditSources[0]).fontSize,
          lineContinuity: getGroupLineContinuity(group.textEditSources),
          textLineMatrix: cloneArray(
            getNormalizedTextState(group.textEditSources[0]).textLineMatrix
          ),
        },
        whitespacePolicy: "concat-source-text-empty-followers",
      },
    },
  };
}

function candidateUnsupported(reason, { container, operation, source, state }) {
  return unsupported(reason, {
    candidate: {
      kind: PDF_TEXT_EDIT_CANDIDATE_KIND,
      editable: false,
      reason,
      container,
      operation: {
        operatorName: source?.operatorName || operation?.operatorName || null,
        operatorIndex:
          source?.operatorIndex ?? operation?.operatorIndex ?? null,
        operatorRange: cloneArray(source?.operatorRange),
        operandRange: cloneArray(source?.operandRange),
        fullByteRange: cloneArray(source?.fullByteRange),
        operatorFingerprint: source?.operatorFingerprint || null,
      },
      state,
    },
  });
}

function buildTextEditCandidate({
  container,
  operation = null,
  textEditSource = null,
  textState = null,
  font = null,
  fontRef = null,
}) {
  const source = cloneTextEditSource(
    textEditSource || buildTextOperatorSource(operation)
  );
  const serializedContainer = serializePdfEditContainerDescriptor(container);
  const state = cloneTextStateSnapshot(
    textState || operation?.textStateBefore || null
  );
  const unsupportedContext = {
    container: serializedContainer,
    operation,
    source,
    state,
  };

  if (!serializedContainer) {
    return candidateUnsupported(
      "text-edit-container-missing",
      unsupportedContext
    );
  }
  if (!isWritableContentStreamStrategy(serializedContainer.writableStrategy)) {
    return candidateUnsupported(
      "text-edit-container-writer-unsupported",
      unsupportedContext
    );
  }
  if (!source) {
    return candidateUnsupported("text-edit-source-missing", unsupportedContext);
  }
  if (!source.editable) {
    return candidateUnsupported(
      source.reason || "text-edit-source-not-editable",
      unsupportedContext
    );
  }
  if (state.inTextObject !== true) {
    return candidateUnsupported(
      "text-edit-not-in-text-object",
      unsupportedContext
    );
  }
  if (!state.fontName || typeof state.fontSize !== "number") {
    return candidateUnsupported(
      "text-edit-font-state-missing",
      unsupportedContext
    );
  }
  const fontBinding = normalizeFontBinding({ font, fontRef, state });
  if (!fontBinding.encodeStringAvailable) {
    return candidateUnsupported(
      "source-font-encodeString-missing",
      unsupportedContext
    );
  }
  if (state.unsupportedContextReasons.length > 0) {
    return candidateUnsupported(state.unsupportedContextReasons[0], {
      ...unsupportedContext,
      state,
    });
  }

  const sourceText = getSourceTextFromTextEditSource(source);
  if (typeof sourceText !== "string") {
    return candidateUnsupported("text-edit-source-text-missing", {
      ...unsupportedContext,
      state,
    });
  }

  source.fontName ||= state.fontName;
  source.fontLoadedName ||= state.fontLoadedName;

  const layoutProof = buildLayoutProof({ source, state, font });
  return {
    ok: true,
    candidate: {
      kind: PDF_TEXT_EDIT_CANDIDATE_KIND,
      editable: true,
      container: serializedContainer,
      textEditSource: source,
      operation: {
        operatorName: source.operatorName,
        operatorIndex: source.operatorIndex,
        operatorRange: cloneArray(source.operatorRange),
        operandRange: cloneArray(source.operandRange),
        fullByteRange: cloneArray(source.fullByteRange),
        operatorFingerprint: source.operatorFingerprint,
        segments: source.segments,
      },
      state,
      proof: {
        containerWritable: true,
        sourceText,
        fontBinding,
        layout: layoutProof,
      },
    },
  };
}

function buildTextEditCandidates({ container, program, fontBindings = null }) {
  const candidates = [];
  for (const operation of program?.operations || []) {
    if (operation.operatorName !== "Tj" && operation.operatorName !== "TJ") {
      continue;
    }
    const fontName = operation.textStateBefore?.fontName || null;
    const binding = fontBindings?.get?.(fontName) || null;
    const result = buildTextEditCandidate({
      container,
      operation,
      font: binding?.font || null,
      fontRef: binding?.fontRef || null,
    });
    candidates.push(result.ok ? result.candidate : result.candidate);
  }
  return candidates;
}

function validateTextEditCandidate(candidate) {
  if (!candidate) {
    return unsupported("text-edit-candidate-missing");
  }
  if (candidate.kind !== PDF_TEXT_EDIT_CANDIDATE_KIND) {
    return unsupported("text-edit-candidate-kind-unsupported");
  }
  if (!candidate.editable) {
    return unsupported(candidate.reason || "text-edit-candidate-not-editable");
  }
  if (!isWritableContentStreamStrategy(candidate.container?.writableStrategy)) {
    return unsupported("text-edit-container-writer-unsupported");
  }
  if (!candidate.textEditSource?.editable) {
    return unsupported(
      candidate.textEditSource?.reason || "text-edit-source-not-editable"
    );
  }
  return { ok: true };
}

function validateTextEditCandidateGroup(candidateGroup) {
  if (!candidateGroup) {
    return unsupported("text-edit-candidate-group-missing");
  }
  if (candidateGroup.kind !== PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND) {
    return unsupported("text-edit-candidate-group-kind-unsupported");
  }
  if (!candidateGroup.editable) {
    return unsupported(
      candidateGroup.reason || "text-edit-candidate-group-not-editable"
    );
  }
  if (
    candidateGroup.container &&
    !isWritableContentStreamStrategy(candidateGroup.container.writableStrategy)
  ) {
    return unsupported("text-edit-container-writer-unsupported");
  }
  return validateTextEditCandidateGroupSources(candidateGroup.sources);
}

export {
  buildTextEditCandidate,
  buildTextEditCandidateGroup,
  buildTextEditCandidates,
  isWritableContentStreamStrategy,
  PDF_TEXT_EDIT_CANDIDATE_GROUP_KIND,
  PDF_TEXT_EDIT_CANDIDATE_KIND,
  validateTextEditCandidate,
  validateTextEditCandidateGroup,
  validateTextEditCandidateGroupSources,
};
