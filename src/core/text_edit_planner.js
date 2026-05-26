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
import {
  classifyTextEditSubject,
  getTextEditSubjectUnsupportedSummary,
} from "./text_edit_subject.js";
import {
  escapeHexString,
  escapeLiteralString,
  formatNumber,
} from "./content_stream_writer.js";
import {
  getSourceTextFromTextEditSource,
  getTextEditSourceTextSegments,
} from "../shared/text_edit_source.js";
import {
  validateTextEditCandidate,
  validateTextEditCandidateGroup,
  validateTextEditCandidateGroupSources,
} from "./text_edit_candidate_builder.js";
import { validateTextEditWhitespacePolicy } from "./text_edit_whitespace_policy.js";

const TEXT_EDIT_SOURCE_EDIT_PLAN_KIND = "pdfjs-source-text-edit-plan";
const TEXT_EDIT_SOURCE_MOVE_PLAN_KIND = "pdfjs-source-text-move-plan";

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function compactLayoutText(text) {
  return String(text).replaceAll(/\s+/g, "");
}

function isSameRange(rangeA, rangeB) {
  return (
    rangeA?.length === rangeB?.length &&
    rangeA.every((value, index) => value === rangeB[index])
  );
}

function isSameFingerprint(fingerprintA, fingerprintB) {
  return JSON.stringify(fingerprintA) === JSON.stringify(fingerprintB);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeMoveDelta({ delta = null, deltaX = null, deltaY = null }) {
  const x = Array.isArray(delta) ? delta[0] : deltaX;
  const y = Array.isArray(delta) ? delta[1] : deltaY;
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : null;
}

function numberOperands(operation, count) {
  const operands = operation?.operands;
  if (!Array.isArray(operands) || operands.length < count) {
    return null;
  }
  const values = operands.slice(0, count).map(operand => operand.value);
  return values.every(isFiniteNumber) ? values : null;
}

function normalizeSerializedNumber(value) {
  return Number(formatNumber(value));
}

function normalizeSerializedNumbers(values) {
  return values.map(normalizeSerializedNumber);
}

function isIdentityTextLineBasis(textEditSource) {
  const matrix = textEditSource?.textState?.textLineMatrix;
  return (
    Array.isArray(matrix) &&
    matrix.length >= 4 &&
    Math.abs(matrix[0] - 1) <= 1e-7 &&
    Math.abs(matrix[1]) <= 1e-7 &&
    Math.abs(matrix[2]) <= 1e-7 &&
    Math.abs(matrix[3] - 1) <= 1e-7
  );
}

function findAnchoredTextOperation(operations, textEditSource) {
  return operations.find(
    operation =>
      operation.operatorName === textEditSource.operatorName &&
      operation.operatorIndex === textEditSource.operatorIndex &&
      isSameRange(operation.operatorRange, textEditSource.operatorRange) &&
      isSameRange(operation.operandRange, textEditSource.operandRange) &&
      isSameRange(operation.fullByteRange, textEditSource.fullByteRange)
  );
}

function buildOperationProof(operation) {
  return {
    operatorName: operation.operatorName,
    operatorIndex: operation.operatorIndex,
    operatorRange: operation.operatorRange,
    operandRange: operation.operandRange,
    fullByteRange: operation.fullByteRange,
    operatorFingerprint: operation.fingerprint,
  };
}

const TEXT_STATE_OPERATORS_BEFORE_POSITIONING = new Set([
  "Tc",
  "Tw",
  "Tz",
  "TL",
  "Tf",
  "Tr",
  "Ts",
]);

const TEXT_POSITIONING_BOUNDARY_OPERATORS = new Set([
  "Td",
  "TD",
  "Tm",
  "T*",
  "ET",
]);

const TEXT_SHOWING_OPERATORS = new Set(["Tj", "TJ", "'", '"']);

function validateFollowingTextPositionBoundary({ operations, sourcePosition }) {
  for (const operation of operations.slice(sourcePosition + 1)) {
    if (TEXT_POSITIONING_BOUNDARY_OPERATORS.has(operation.operatorName)) {
      return {
        ok: true,
        boundaryOperatorName: operation.operatorName,
        boundaryOperatorIndex: operation.operatorIndex,
      };
    }
    if (
      TEXT_SHOWING_OPERATORS.has(operation.operatorName) ||
      !TEXT_STATE_OPERATORS_BEFORE_POSITIONING.has(operation.operatorName)
    ) {
      return unsupported("text-move-td-following-state-not-isolable", {
        nextOperatorName: operation.operatorName || null,
        nextOperatorIndex: operation.operatorIndex ?? null,
      });
    }
  }

  return unsupported("text-move-td-following-boundary-missing");
}

function findAdjacentTmMoveAnchor({ operations, sourceOperation }) {
  const sourcePosition = operations.indexOf(sourceOperation);
  if (sourcePosition <= 0) {
    return unsupported("text-move-anchor-tm-missing");
  }

  const tmOperation = operations[sourcePosition - 1];
  if (tmOperation.operatorName !== "Tm") {
    return unsupported("text-move-anchor-tm-not-adjacent", {
      previousOperatorName: tmOperation.operatorName || null,
    });
  }

  const matrix = numberOperands(tmOperation, 6);
  if (!matrix) {
    return unsupported("text-move-anchor-tm-operands-invalid");
  }

  for (let i = sourcePosition - 2; i >= 0; i--) {
    const operation = operations[i];
    if (operation.operatorName === "ET") {
      return unsupported("text-move-anchor-outside-text-object");
    }
    if (operation.operatorName === "BT") {
      return {
        ok: true,
        tmOperation,
        matrix,
      };
    }
  }

  return unsupported("text-move-anchor-outside-text-object");
}

function findAdjacentTextTranslationMoveAnchor({
  operations,
  sourceOperation,
}) {
  const sourcePosition = operations.indexOf(sourceOperation);
  if (sourcePosition <= 0) {
    return unsupported("text-move-anchor-td-missing");
  }

  const tdOperation = operations[sourcePosition - 1];
  if (tdOperation.operatorName !== "Td" && tdOperation.operatorName !== "TD") {
    return unsupported("text-move-anchor-td-not-adjacent", {
      previousOperatorName: tdOperation.operatorName || null,
    });
  }

  const translation = numberOperands(tdOperation, 2);
  if (!translation) {
    return unsupported("text-move-anchor-td-operands-invalid");
  }

  const boundary = validateFollowingTextPositionBoundary({
    operations,
    sourcePosition,
  });
  if (!boundary.ok) {
    return boundary;
  }

  for (let i = sourcePosition - 2; i >= 0; i--) {
    const operation = operations[i];
    if (operation.operatorName === "ET") {
      return unsupported("text-move-anchor-outside-text-object");
    }
    if (operation.operatorName === "BT") {
      return {
        ok: true,
        boundary,
        tdOperation,
        textLeading:
          tdOperation.operatorName === "TD" ? 0 - translation[1] : null,
        translation,
      };
    }
  }

  return unsupported("text-move-anchor-outside-text-object");
}

function hasSourceLayoutSpacing(textEditSource) {
  return (
    textEditSource?.operatorName === "TJ" &&
    Array.isArray(textEditSource.segments) &&
    textEditSource.segments.some(segment => segment.kind === "spacing")
  );
}

function resolveExpectedSourceText({
  expectedSourceText,
  sourceText,
  textEditSource,
  visibleText = null,
}) {
  if (sourceText === expectedSourceText) {
    return {
      ok: true,
      expectedSourceText: sourceText,
      matchKind: "source-text",
    };
  }

  const canUseVisibleLayoutText =
    typeof visibleText === "string" &&
    expectedSourceText === visibleText &&
    hasSourceLayoutSpacing(textEditSource) &&
    compactLayoutText(sourceText) === compactLayoutText(visibleText);
  if (canUseVisibleLayoutText) {
    return {
      ok: true,
      expectedSourceText: sourceText,
      matchKind: "visible-layout-text",
      originalExpectedSourceText: expectedSourceText,
    };
  }

  return {
    ok: false,
    reason: "source-text-mismatch",
    sourceProof: {
      sourceText,
      expectedSourceText,
      ...(typeof visibleText === "string" ? { visibleText } : null),
      sourceTextMatches: false,
    },
  };
}

function getSourceFontMissingGlyphs(font, encodedByteString, text) {
  if (font?.missingFile || typeof font?.charsToGlyphs !== "function") {
    return [];
  }
  const glyphs = font.charsToGlyphs(encodedByteString);
  if (!Array.isArray(glyphs)) {
    return [];
  }
  const textChars = Array.from(text || encodedByteString);
  const encodedChars = Array.from(encodedByteString);
  const missing = [];
  for (let i = 0, ii = glyphs.length; i < ii; i++) {
    const glyph = glyphs[i];
    if (glyph?.isInFont === false) {
      missing.push({
        ch: textChars[Math.min(i, textChars.length - 1)] || encodedChars[i],
        encodedCharCode: encodedChars[i]?.charCodeAt(0) ?? null,
        index: i,
      });
    }
  }
  return missing;
}

function getTextSegments(textEditSource) {
  return getTextEditSourceTextSegments(textEditSource);
}

function getReplacementSource(textEditSource) {
  const segments = textEditSource?.segments;
  if (!Array.isArray(segments)) {
    return null;
  }

  const textSegments = getTextSegments(textEditSource);
  if (textSegments.length === 0) {
    return null;
  }

  if (textEditSource.operatorName === "Tj") {
    const sourceText = getSourceTextFromTextEditSource(textEditSource);
    return sourceText !== null
      ? {
          rawKind: textSegments[0].rawKind,
          sourceText,
        }
      : null;
  }

  if (
    textEditSource.operatorName !== "TJ" ||
    segments.some(
      segment => segment.kind !== "text" && segment.kind !== "spacing"
    )
  ) {
    return null;
  }

  return {
    rawKind: textSegments[0].rawKind,
    sourceText: getSourceTextFromTextEditSource(textEditSource),
  };
}

function encodeReplacement(font, replacementText) {
  if (typeof font?.encodeString !== "function") {
    return unsupported("source-font-encodeString-missing");
  }

  const encodedParts = font.encodeString(replacementText);
  const encoded = [];
  const failures = [];
  for (let i = 0, ii = encodedParts.length; i < ii; i++) {
    const part = encodedParts[i];
    if (i % 2 === 0) {
      encoded.push(part);
    } else if (part) {
      failures.push(part);
    }
  }

  if (failures.length > 0) {
    return unsupported("replacement-not-encodable-in-source-font", {
      fontProof: {
        encodable: false,
        failures,
      },
    });
  }

  const encodedByteString = encoded.join("");
  const missingGlyphs = getSourceFontMissingGlyphs(
    font,
    encodedByteString,
    replacementText
  );
  if (missingGlyphs.length > 0) {
    return unsupported("replacement-not-renderable-in-source-font", {
      fontProof: {
        encodable: true,
        renderable: false,
        missingGlyphs,
      },
    });
  }

  return {
    ok: true,
    encodedByteString,
  };
}

function buildTextStringOperand(rawKind, encodedByteString) {
  let encodedKind;
  switch (rawKind) {
    case "literal":
      encodedKind = "literalString";
      return {
        encodedKind,
        replacementOperand: escapeLiteralString(encodedByteString),
      };
    case "hex":
      encodedKind = "hexString";
      return {
        encodedKind,
        replacementOperand: escapeHexString(encodedByteString),
      };
    default:
      return null;
  }
}

function buildReplacementOperand(operatorName, rawKind, encodedByteString) {
  const replacement = buildTextStringOperand(rawKind, encodedByteString);
  if (!replacement) {
    return null;
  }

  let { replacementOperand } = replacement;
  if (operatorName === "TJ") {
    replacementOperand = `[${replacementOperand}]`;
  }

  return {
    encodedKind: replacement.encodedKind,
    replacementOperand,
  };
}

function getReplacementWords(replacementText) {
  if (!/\s/.test(replacementText)) {
    return null;
  }
  const words = replacementText.split(" ");
  while (words.at(-1) === "") {
    words.pop();
  }
  return words.length > 1 &&
    words.every(word => word) &&
    replacementText.startsWith(words.join(" "))
    ? words
    : null;
}

function getWordSpacingSegments(segments, gapCount, font) {
  if (gapCount === 0) {
    return [];
  }

  const spacingSegments = segments
    .map((segment, index) => ({ ...segment, index }))
    .filter(segment => segment.kind === "spacing");
  const syntheticGapCount = gapCount - spacingSegments.length;
  if (syntheticGapCount > 0) {
    return [
      ...spacingSegments,
      ...createSyntheticWordSpacingSegments(syntheticGapCount, font),
    ];
  }

  const negativeSpacingSegments = spacingSegments.filter(
    segment => segment.value < 0
  );
  const candidates =
    negativeSpacingSegments.length >= gapCount
      ? negativeSpacingSegments
      : spacingSegments;
  return candidates
    .toSorted((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, gapCount)
    .toSorted((a, b) => a.index - b.index);
}

function getSyntheticWordSpacingValue(font) {
  const glyph = font?.charsToGlyphs?.(" ")?.[0];
  let width = 250;
  if (typeof font?.defaultWidth === "number" && font.defaultWidth > 0) {
    width = font.defaultWidth;
  }
  if (typeof font?._spaceWidth === "number" && font._spaceWidth > 0) {
    width = font._spaceWidth;
  }
  if (typeof glyph?.width === "number" && glyph.width > 0) {
    width = glyph.width;
  }
  return -width;
}

function createSyntheticWordSpacingSegments(gapCount, font) {
  const value = getSyntheticWordSpacingValue(font);
  return Array.from({ length: gapCount }, () => ({
    synthetic: true,
    value,
  }));
}

function buildSpacedTJReplacement(textEditSource, replacementText, font) {
  if (textEditSource.operatorName !== "TJ") {
    return null;
  }

  const words = getReplacementWords(replacementText);
  if (!words) {
    return null;
  }

  const textSegments = getTextSegments(textEditSource);
  const gapCount = words.length - 1;
  const wordSpacingSegments = getWordSpacingSegments(
    textEditSource.segments,
    gapCount,
    font
  );
  if (!wordSpacingSegments) {
    return unsupported("replacement-whitespace-gap-count-mismatch", {
      layoutProof: {
        replacementWordCount: words.length,
        sourceSpacingSegmentCount: textEditSource.segments.filter(
          segment => segment.kind === "spacing"
        ).length,
        sourceTextSegmentCount: textSegments.length,
      },
    });
  }

  const operands = [];
  const encodedByteStrings = [];
  const rawKind = textSegments[0]?.rawKind;
  for (let i = 0, ii = words.length; i < ii; i++) {
    const encoded = encodeReplacement(font, words[i]);
    if (!encoded.ok) {
      return encoded;
    }

    const replacement = buildTextStringOperand(
      rawKind,
      encoded.encodedByteString
    );
    if (!replacement) {
      return unsupported("text-edit-source-raw-kind-unsupported", {
        rawKind: rawKind || null,
      });
    }
    operands.push(replacement.replacementOperand);
    encodedByteStrings.push(encoded.encodedByteString);
    if (i < wordSpacingSegments.length) {
      operands.push(formatNumber(wordSpacingSegments[i].value));
    }
  }

  return {
    ok: true,
    encodedKind: "segmentedTJ",
    encodedByteString: encodedByteStrings.join(""),
    replacementOperand: `[${operands.join(" ")}]`,
    layoutProof: {
      spacing: wordSpacingSegments.some(segment => segment.synthetic)
        ? "synthetic-word-spacing"
        : "source-word-spacing",
      wordSpacingValues: wordSpacingSegments.map(segment => segment.value),
    },
  };
}

function buildSegmentPreservingTJReplacement(
  textEditSource,
  replacementText,
  font
) {
  if (!hasSourceLayoutSpacing(textEditSource)) {
    return null;
  }

  const textSegments = getTextSegments(textEditSource);
  const sourceText = getSourceTextFromTextEditSource(textEditSource);
  const replacementSourceText = compactLayoutText(replacementText);
  const sourceChars = Array.from(sourceText || "");
  const replacementChars = Array.from(replacementSourceText);
  if (
    sourceChars.length === 0 ||
    replacementChars.length !== sourceChars.length
  ) {
    return null;
  }

  const operands = [];
  const encodedByteStrings = [];
  let replacementIndex = 0;
  for (const segment of textEditSource.segments) {
    if (segment.kind === "spacing") {
      operands.push(formatNumber(segment.value));
      continue;
    }
    if (segment.kind !== "text") {
      return null;
    }

    const sourceSegmentLength = Array.from(
      segment.text ?? segment.byteString ?? ""
    ).length;
    const chunk = replacementChars
      .slice(replacementIndex, replacementIndex + sourceSegmentLength)
      .join("");
    replacementIndex += sourceSegmentLength;

    const encoded = encodeReplacement(font, chunk);
    if (!encoded.ok) {
      return encoded;
    }
    const replacement = buildTextStringOperand(
      segment.rawKind || textSegments[0]?.rawKind,
      encoded.encodedByteString
    );
    if (!replacement) {
      return unsupported("text-edit-source-raw-kind-unsupported", {
        rawKind: segment.rawKind || textSegments[0]?.rawKind || null,
      });
    }
    operands.push(replacement.replacementOperand);
    encodedByteStrings.push(encoded.encodedByteString);
  }

  return {
    ok: true,
    encodedKind: "segmentedTJ",
    encodedByteString: encodedByteStrings.join(""),
    replacementOperand: `[${operands.join(" ")}]`,
    replacementSourceText,
    layoutProof: {
      spacing: "source-segment-spacing",
      wordSpacingValues: textEditSource.segments
        .filter(segment => segment.kind === "spacing")
        .map(segment => segment.value),
    },
  };
}

function planTextSourceEdit({
  textEditSource,
  textEditCandidate = null,
  expectedSourceText,
  replacementText,
  visibleText = null,
  font,
  editGeneration = null,
}) {
  if (textEditCandidate) {
    const candidateValidation = validateTextEditCandidate(textEditCandidate);
    if (!candidateValidation.ok) {
      return candidateValidation;
    }
    textEditSource ||= textEditCandidate.textEditSource;
  }
  if (!textEditSource) {
    return unsupported("text-edit-source-missing");
  }
  if (!textEditSource.editable) {
    return unsupported("text-edit-source-not-editable", {
      sourceReason: textEditSource.reason || null,
    });
  }
  if (
    textEditSource.operatorName !== "Tj" &&
    textEditSource.operatorName !== "TJ"
  ) {
    return unsupported("text-edit-source-operator-not-supported", {
      operatorName: textEditSource.operatorName || null,
    });
  }
  if (typeof expectedSourceText !== "string") {
    return unsupported("expected-source-text-missing");
  }
  if (typeof replacementText !== "string") {
    return unsupported("replacement-text-missing");
  }

  const replacementSource = getReplacementSource(textEditSource);
  if (!replacementSource) {
    return unsupported("text-edit-source-not-single-text-segment");
  }

  const { sourceText } = replacementSource;
  const expected = resolveExpectedSourceText({
    expectedSourceText,
    sourceText,
    textEditSource,
    visibleText,
  });
  if (!expected.ok) {
    return unsupported(expected.reason, {
      sourceProof: expected.sourceProof,
    });
  }
  expectedSourceText = expected.expectedSourceText;

  const editSubject = classifyTextEditSubject({
    expectedSourceText,
    replacementText,
    textEditCandidate,
    textEditSource,
    visibleText,
  });
  const unsupportedSummary = getTextEditSubjectUnsupportedSummary(editSubject);
  if (!unsupportedSummary.ok) {
    return unsupported(unsupportedSummary.reason, {
      editSubject,
      unsupported: unsupportedSummary,
    });
  }

  const replacementSourceText =
    typeof editSubject.normalizedPacket?.replacementSourceText === "string"
      ? editSubject.normalizedPacket.replacementSourceText
      : replacementText;
  const replacementLayoutText =
    textEditSource.operatorName === "TJ" && /\s/.test(replacementText)
      ? replacementText
      : replacementSourceText;
  const spacedTJReplacement =
    buildSegmentPreservingTJReplacement(
      textEditSource,
      replacementLayoutText,
      font
    ) || buildSpacedTJReplacement(textEditSource, replacementLayoutText, font);
  if (spacedTJReplacement && !spacedTJReplacement.ok) {
    return spacedTJReplacement;
  }

  const encoded =
    spacedTJReplacement?.ok === true
      ? spacedTJReplacement
      : encodeReplacement(font, replacementSourceText);
  if (!encoded.ok) {
    return encoded;
  }

  let replacementSpacingPlan = null;
  if (spacedTJReplacement?.ok === true) {
    replacementSpacingPlan = spacedTJReplacement;
  }

  const whitespaceDecision = validateTextEditWhitespacePolicy({
    policy: editSubject.whitespacePolicy,
    replacementSpacingPlan,
    textEditSource,
  });
  if (!whitespaceDecision.ok) {
    return unsupported(whitespaceDecision.reason, {
      editSubject,
      unsupported: {
        ok: false,
        proofName: "whitespacePolicy",
        reason: whitespaceDecision.reason,
        subjectType: editSubject.subjectType,
        subjectSubtype: editSubject.subjectSubtype,
        strategy: editSubject.selectedStrategy.id,
      },
      whitespaceProof: whitespaceDecision,
    });
  }

  const replacement =
    spacedTJReplacement?.ok === true
      ? spacedTJReplacement
      : buildReplacementOperand(
          textEditSource.operatorName,
          replacementSource.rawKind,
          encoded.encodedByteString
        );
  if (!replacement) {
    return unsupported("text-edit-source-raw-kind-unsupported", {
      rawKind: replacementSource.rawKind || null,
    });
  }

  return {
    ok: true,
    kind: TEXT_EDIT_SOURCE_EDIT_PLAN_KIND,
    editGeneration,
    editSubject,
    replacementText: replacementSourceText,
    ...(replacementSourceText !== replacementText
      ? { replacementVisibleText: replacementText }
      : null),
    ...(textEditCandidate
      ? {
          container: textEditCandidate.container,
          candidateProof: {
            kind: textEditCandidate.kind,
            containerWritable:
              textEditCandidate.proof?.containerWritable === true,
            sourceText: textEditCandidate.proof?.sourceText ?? null,
            fontBinding: textEditCandidate.proof?.fontBinding || null,
            state: textEditCandidate.state || null,
          },
        }
      : null),
    sourceProof: {
      operatorName: textEditSource.operatorName,
      operatorIndex: textEditSource.operatorIndex,
      operatorFingerprint: textEditSource.operatorFingerprint,
      fontName: textEditSource.fontName || null,
      fontLoadedName: textEditSource.fontLoadedName || null,
      expectedSourceText,
      ...(expected.originalExpectedSourceText
        ? { originalExpectedSourceText: expected.originalExpectedSourceText }
        : null),
      sourceTextMatchKind: expected.matchKind,
      sourceTextMatches: true,
    },
    fontProof: {
      encodable: true,
      encodedKind: replacement.encodedKind,
      encodedByteLength: encoded.encodedByteString.length,
      ...(encoded.fontProof || null),
    },
    ...(replacement.layoutProof
      ? { layoutProof: replacement.layoutProof }
      : null),
    patch: {
      operatorName: textEditSource.operatorName,
      operatorRange: textEditSource.operatorRange,
      operandRange: textEditSource.operandRange,
      fullByteRange: textEditSource.fullByteRange,
      replacementByteString: encoded.encodedByteString,
      replacementOperand: replacement.replacementOperand,
      replacementOperator: `${replacement.replacementOperand} ${textEditSource.operatorName}`,
    },
  };
}

function validateTextEditSourceGroup(textEditSources) {
  return validateTextEditCandidateGroupSources(textEditSources);
}

function buildPatchForSource(source, replacementText, font) {
  const replacementSource = getReplacementSource(source);
  const encoded = encodeReplacement(font, replacementText);
  if (!encoded.ok) {
    return encoded;
  }
  const replacement = buildReplacementOperand(
    source.operatorName,
    replacementSource.rawKind,
    encoded.encodedByteString
  );
  if (!replacement) {
    return unsupported("text-edit-source-raw-kind-unsupported", {
      rawKind: replacementSource.rawKind || null,
    });
  }
  return {
    ok: true,
    sourceProof: {
      operatorName: source.operatorName,
      operatorIndex: source.operatorIndex,
      operatorFingerprint: source.operatorFingerprint,
      sourceText: replacementSource.sourceText,
    },
    fontProof: {
      encodedKind: replacement.encodedKind,
      encodedByteLength: encoded.encodedByteString.length,
    },
    patch: {
      operatorName: source.operatorName,
      operatorRange: source.operatorRange,
      operandRange: source.operandRange,
      fullByteRange: source.fullByteRange,
      replacementByteString: encoded.encodedByteString,
      replacementOperand: replacement.replacementOperand,
      replacementOperator: `${replacement.replacementOperand} ${source.operatorName}`,
    },
  };
}

function planTextSourceEditGroup({
  textEditSources,
  textEditCandidateGroup = null,
  expectedSourceText,
  replacementText,
  visibleText = null,
  font,
  editGeneration = null,
}) {
  if (textEditCandidateGroup) {
    const candidateValidation = validateTextEditCandidateGroup(
      textEditCandidateGroup
    );
    if (!candidateValidation.ok) {
      return candidateValidation;
    }
    textEditSources ||= textEditCandidateGroup.sources;
  }
  if (typeof expectedSourceText !== "string") {
    return unsupported("expected-source-text-missing");
  }
  if (typeof replacementText !== "string") {
    return unsupported("replacement-text-missing");
  }
  const group = validateTextEditSourceGroup(textEditSources);
  if (!group.ok) {
    return group;
  }
  const expected = resolveExpectedSourceText({
    expectedSourceText,
    sourceText: group.sourceText,
    textEditSource: {
      grouped: true,
      sources: group.textEditSources,
      operatorName: "TJ",
      segments: group.textEditSources.flatMap(source => source.segments || []),
    },
    visibleText,
  });
  if (!expected.ok) {
    return unsupported(expected.reason, {
      sourceProof: expected.sourceProof,
    });
  }
  expectedSourceText = expected.expectedSourceText;

  const patches = [];
  const first = buildPatchForSource(
    group.textEditSources[0],
    replacementText,
    font
  );
  if (!first.ok) {
    return first;
  }
  patches.push(first);
  for (const source of group.textEditSources.slice(1)) {
    const empty = buildPatchForSource(source, "", font);
    if (!empty.ok) {
      return empty;
    }
    patches.push(empty);
  }

  const editSubject = classifyTextEditSubject({
    expectedSourceText,
    replacementText,
    textEditCandidateGroup,
    textEditSource: { grouped: true, sources: group.textEditSources },
    visibleText,
  });
  const unsupportedSummary = getTextEditSubjectUnsupportedSummary(editSubject);
  if (!unsupportedSummary.ok) {
    return unsupported(unsupportedSummary.reason, {
      editSubject,
      unsupported: unsupportedSummary,
    });
  }

  return {
    ok: true,
    kind: TEXT_EDIT_SOURCE_EDIT_PLAN_KIND,
    editGeneration,
    grouped: true,
    replacementText,
    editSubject,
    ...(textEditCandidateGroup
      ? {
          container: textEditCandidateGroup.container,
          candidateProof: {
            kind: textEditCandidateGroup.kind,
            containerWritable:
              textEditCandidateGroup.proof?.containerWritable === true,
            sourceText: textEditCandidateGroup.proof?.sourceText ?? null,
            fontBinding: textEditCandidateGroup.proof?.fontBinding || null,
            stateCompatibility:
              textEditCandidateGroup.proof?.stateCompatibility || null,
            whitespacePolicy:
              textEditCandidateGroup.proof?.whitespacePolicy || null,
            layoutFacts: textEditCandidateGroup.layoutFacts || null,
          },
        }
      : null),
    sourceProof: {
      operatorCount: group.textEditSources.length,
      sourceText: group.sourceText,
      expectedSourceText,
      ...(expected.originalExpectedSourceText
        ? { originalExpectedSourceText: expected.originalExpectedSourceText }
        : null),
      sourceTextMatchKind: expected.matchKind,
      sourceTextMatches: true,
    },
    fontProof: {
      encodable: true,
      encodedKind: patches[0].fontProof.encodedKind,
      encodedByteLength: patches.reduce(
        (sum, entry) => sum + entry.fontProof.encodedByteLength,
        0
      ),
    },
    patch: patches[0].patch,
    patches: patches.map(entry => ({
      ...entry.patch,
      sourceProof: entry.sourceProof,
    })),
  };
}

function planTextSourceMove({
  textEditSource,
  textEditCandidate = null,
  expectedSourceText,
  delta = null,
  deltaX = null,
  deltaY = null,
  decodedBytes = null,
  editGeneration = null,
}) {
  if (textEditCandidate) {
    const candidateValidation = validateTextEditCandidate(textEditCandidate);
    if (!candidateValidation.ok) {
      return candidateValidation;
    }
    textEditSource ||= textEditCandidate.textEditSource;
  }
  if (!textEditSource) {
    return unsupported("text-edit-source-missing");
  }
  if (textEditSource.grouped === true) {
    return unsupported("text-move-grouped-source-not-supported");
  }
  if (!textEditSource.editable) {
    return unsupported("text-edit-source-not-editable", {
      sourceReason: textEditSource.reason || null,
    });
  }
  if (
    textEditSource.operatorName !== "Tj" &&
    textEditSource.operatorName !== "TJ"
  ) {
    return unsupported("text-edit-source-operator-not-supported", {
      operatorName: textEditSource.operatorName || null,
    });
  }
  if (typeof expectedSourceText !== "string") {
    return unsupported("expected-source-text-missing");
  }

  const moveDelta = normalizeMoveDelta({ delta, deltaX, deltaY });
  if (!moveDelta) {
    return unsupported("text-move-delta-invalid");
  }
  if (!decodedBytes) {
    return unsupported("text-move-decoded-stream-missing");
  }

  const sourceText = getSourceTextFromTextEditSource(textEditSource);
  if (sourceText !== expectedSourceText) {
    return unsupported("source-text-mismatch", {
      sourceProof: {
        sourceText,
        expectedSourceText,
        sourceTextMatches: false,
      },
    });
  }

  const operations = collectContentStreamOperations(
    tokenizeContentStream(decodedBytes)
  );
  const sourceOperation = findAnchoredTextOperation(operations, textEditSource);
  if (!sourceOperation) {
    return unsupported("text-edit-source-anchor-not-found");
  }

  const currentSource = buildTextOperatorSource(sourceOperation);
  if (!currentSource?.editable) {
    return unsupported("text-edit-source-not-editable", {
      sourceReason: currentSource?.reason || null,
    });
  }
  if (
    !isSameFingerprint(
      currentSource.operatorFingerprint,
      textEditSource.operatorFingerprint
    )
  ) {
    return unsupported("text-edit-source-fingerprint-mismatch");
  }

  const currentSourceText = getSourceTextFromTextEditSource(currentSource);
  if (currentSourceText !== expectedSourceText) {
    return unsupported("source-text-mismatch", {
      sourceProof: {
        sourceText: currentSourceText,
        expectedSourceText,
        sourceTextMatches: false,
      },
    });
  }

  const tmAnchor = findAdjacentTmMoveAnchor({ operations, sourceOperation });
  let patch, moveProof;
  if (tmAnchor.ok) {
    const [dx, dy] = moveDelta;
    const originalMatrix = tmAnchor.matrix;
    const replacementMatrix = originalMatrix.slice();
    replacementMatrix[4] += dx;
    replacementMatrix[5] += dy;
    const serializedReplacementMatrix =
      normalizeSerializedNumbers(replacementMatrix);
    const replacementOperand = serializedReplacementMatrix
      .map(formatNumber)
      .join(" ");
    const tmProof = buildOperationProof(tmAnchor.tmOperation);
    moveProof = {
      strategy: "adjacent-tm-translation",
      delta: moveDelta,
      originalTextMatrix: originalMatrix,
      replacementTextMatrix: serializedReplacementMatrix,
      tmOperatorIndex: tmAnchor.tmOperation.operatorIndex,
      tmOperatorFingerprint: tmAnchor.tmOperation.fingerprint,
    };
    patch = {
      operatorName: "Tm",
      operatorRange: tmAnchor.tmOperation.operatorRange,
      operandRange: tmAnchor.tmOperation.operandRange,
      fullByteRange: tmAnchor.tmOperation.fullByteRange,
      replacementOperand,
      replacementOperator: `${replacementOperand} Tm`,
      sourceProof: tmProof,
    };
  } else if (tmAnchor.reason === "text-move-anchor-tm-not-adjacent") {
    if (!isIdentityTextLineBasis(textEditSource)) {
      return unsupported("text-move-td-non-identity-text-line-matrix", {
        textLineMatrix: textEditSource.textState?.textLineMatrix || null,
      });
    }
    const tdAnchor = findAdjacentTextTranslationMoveAnchor({
      operations,
      sourceOperation,
    });
    if (!tdAnchor.ok) {
      return tdAnchor;
    }
    const [dx, dy] = moveDelta;
    const originalTranslation = tdAnchor.translation;
    const replacementTranslation = [
      originalTranslation[0] + dx,
      originalTranslation[1] + dy,
    ];
    const serializedReplacementTranslation = normalizeSerializedNumbers(
      replacementTranslation
    );
    const replacementOperand = serializedReplacementTranslation
      .map(formatNumber)
      .join(" ");
    const compensationTextTranslation = normalizeSerializedNumbers([
      0 - dx,
      0 - dy,
    ]);
    const compensationOperand = compensationTextTranslation
      .map(formatNumber)
      .join(" ");
    const tdProof = buildOperationProof(tdAnchor.tdOperation);
    const sourceOperationProof = buildOperationProof(sourceOperation);
    const originalMatrix = textEditSource.textState.textMatrix;
    const replacementMatrix = originalMatrix.slice();
    replacementMatrix[4] += dx;
    replacementMatrix[5] += dy;
    const serializedReplacementMatrix =
      normalizeSerializedNumbers(replacementMatrix);
    const operatorName = tdAnchor.tdOperation.operatorName;
    const restoresTextLeading = operatorName === "TD";
    const restoredTextLeading = restoresTextLeading
      ? normalizeSerializedNumber(tdAnchor.textLeading)
      : null;
    moveProof = {
      strategy: restoresTextLeading
        ? "adjacent-td-set-leading-translation-with-compensation"
        : "adjacent-td-translation-with-compensation",
      boundary: tdAnchor.boundary,
      delta: moveDelta,
      originalTextMatrix: originalMatrix,
      replacementTextMatrix: serializedReplacementMatrix,
      originalTextTranslation: originalTranslation,
      replacementTextTranslation: serializedReplacementTranslation,
      compensationTextTranslation,
      restoredTextLeading,
      tdOperatorIndex: tdAnchor.tdOperation.operatorIndex,
      tdOperatorFingerprint: tdAnchor.tdOperation.fingerprint,
    };
    patch = {
      operatorName,
      operatorRange: tdAnchor.tdOperation.operatorRange,
      operandRange: tdAnchor.tdOperation.operandRange,
      fullByteRange: tdAnchor.tdOperation.fullByteRange,
      replacementOperand,
      replacementOperator: `${replacementOperand} ${operatorName}`,
      sourceProof: tdProof,
    };
    const compensationReplacement = restoresTextLeading
      ? ` ${compensationOperand} Td ${formatNumber(restoredTextLeading)} TL `
      : ` ${compensationOperand} Td `;
    patch.compensationPatch = {
      operatorName: sourceOperation.operatorName,
      operatorRange: sourceOperation.operatorRange,
      operandRange: sourceOperation.operandRange,
      fullByteRange: sourceOperation.fullByteRange,
      replacementRange: [
        sourceOperation.operatorRange[1],
        sourceOperation.operatorRange[1],
      ],
      replacementOperand: compensationReplacement,
      replacementOperator: compensationReplacement.trim(),
      sourceProof: sourceOperationProof,
    };
  } else {
    return tmAnchor;
  }

  return {
    ok: true,
    kind: TEXT_EDIT_SOURCE_MOVE_PLAN_KIND,
    editGeneration,
    ...(textEditCandidate
      ? {
          container: textEditCandidate.container,
          candidateProof: {
            kind: textEditCandidate.kind,
            containerWritable:
              textEditCandidate.proof?.containerWritable === true,
            sourceText: textEditCandidate.proof?.sourceText ?? null,
            fontBinding: textEditCandidate.proof?.fontBinding || null,
            state: textEditCandidate.state || null,
          },
        }
      : null),
    sourceProof: {
      operatorName: textEditSource.operatorName,
      operatorIndex: textEditSource.operatorIndex,
      operatorRange: textEditSource.operatorRange,
      operandRange: textEditSource.operandRange,
      fullByteRange: textEditSource.fullByteRange,
      operatorFingerprint: textEditSource.operatorFingerprint,
      expectedSourceText,
      sourceTextMatches: true,
    },
    moveProof,
    patch,
    patches: patch.compensationPatch ? [patch, patch.compensationPatch] : null,
  };
}

export {
  getSourceTextFromTextEditSource,
  planTextSourceEdit,
  planTextSourceEditGroup,
  planTextSourceMove,
  TEXT_EDIT_SOURCE_EDIT_PLAN_KIND,
  TEXT_EDIT_SOURCE_MOVE_PLAN_KIND,
};
