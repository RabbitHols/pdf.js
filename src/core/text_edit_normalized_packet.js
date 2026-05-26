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

import { getSourceTextFromTextEditSource } from "../shared/text_edit_source.js";

const PDF_TEXT_EDIT_NORMALIZED_PACKET_KIND =
  "pdfjs-text-edit-normalized-packet";
const PDF_TEXT_EDIT_NORMALIZED_PACKET_VERSION = 1;

function getSources(textEditSource) {
  if (Array.isArray(textEditSource?.sources)) {
    return textEditSource.sources;
  }
  return textEditSource ? [textEditSource] : [];
}

function getSourceText(textEditSource, expectedSourceText) {
  const sources = getSources(textEditSource);
  if (sources.length === 0) {
    return typeof expectedSourceText === "string" ? expectedSourceText : "";
  }
  let text = "";
  for (const source of sources) {
    const sourceText = getSourceTextFromTextEditSource(source);
    if (typeof sourceText !== "string") {
      return typeof expectedSourceText === "string" ? expectedSourceText : "";
    }
    text += sourceText;
  }
  return text;
}

function compactTextWithRanges(text) {
  return Array.from(text).flatMap((char, index) =>
    /\s/.test(char) ? [] : [{ char, index }]
  );
}

function compactText(text) {
  return Array.from(text || "")
    .filter(char => !/\s/.test(char))
    .join("");
}

function findNeedleRange(haystack, needle, { allowCompact = false } = {}) {
  if (!haystack || !needle) {
    return null;
  }
  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0) {
    return [exactIndex, exactIndex + needle.length];
  }
  if (!allowCompact) {
    return null;
  }

  const compactHaystack = compactTextWithRanges(haystack);
  const compactNeedle = Array.from(needle).filter(char => !/\s/.test(char));
  if (
    compactNeedle.length === 0 ||
    compactNeedle.length > compactHaystack.length
  ) {
    return null;
  }
  for (
    let start = 0, end = compactHaystack.length - compactNeedle.length;
    start <= end;
    start++
  ) {
    let matched = true;
    for (let offset = 0, ii = compactNeedle.length; offset < ii; offset++) {
      if (compactHaystack[start + offset].char !== compactNeedle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return [
        compactHaystack[start].index,
        compactHaystack[start + compactNeedle.length - 1].index + 1,
      ];
    }
  }
  return null;
}

function buildReplacementSourceText({
  replacementVisibleText,
  sourceRangeInVisible,
  sourceText,
  visibleText,
}) {
  if (!sourceRangeInVisible || visibleText === replacementVisibleText) {
    return sourceText;
  }
  if (compactText(visibleText) === sourceText && !/\s/.test(sourceText)) {
    return compactText(replacementVisibleText);
  }
  const [sourceStart, sourceEnd] = sourceRangeInVisible;
  let prefixLength = 0;
  const maxPrefix = Math.min(visibleText.length, replacementVisibleText.length);
  while (
    prefixLength < maxPrefix &&
    visibleText[prefixLength] === replacementVisibleText[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < visibleText.length - prefixLength &&
    suffixLength < replacementVisibleText.length - prefixLength &&
    visibleText[visibleText.length - suffixLength - 1] ===
      replacementVisibleText[replacementVisibleText.length - suffixLength - 1]
  ) {
    suffixLength++;
  }

  const editStart = prefixLength;
  const editEnd = visibleText.length - suffixLength;
  const replacementEditEnd = replacementVisibleText.length - suffixLength;
  if (editEnd <= sourceStart || editStart >= sourceEnd) {
    return sourceText;
  }
  if (editStart < sourceStart || editEnd > sourceEnd) {
    return "";
  }
  return (
    sourceText.slice(0, editStart - sourceStart) +
    replacementVisibleText.slice(editStart, replacementEditEnd) +
    sourceText.slice(editEnd - sourceStart)
  );
}

function buildTextEditNormalizedPacket({
  expectedSourceText,
  replacementText,
  textEditSource = null,
  visibleText = null,
} = {}) {
  const sourceText = getSourceText(textEditSource, expectedSourceText);
  let normalizedVisibleText = sourceText;
  if (typeof expectedSourceText === "string") {
    normalizedVisibleText = expectedSourceText;
  }
  if (typeof visibleText === "string") {
    normalizedVisibleText = visibleText;
  }
  const replacementVisibleText =
    typeof replacementText === "string" ? replacementText : "";
  const visibleRangeInSource = findNeedleRange(
    sourceText,
    normalizedVisibleText
  );
  const sourceRangeInVisible = visibleRangeInSource
    ? null
    : findNeedleRange(normalizedVisibleText, sourceText, {
        allowCompact: true,
      });
  const layoutPrefix = visibleRangeInSource
    ? sourceText.slice(0, visibleRangeInSource[0])
    : "";
  const layoutSuffix = visibleRangeInSource
    ? sourceText.slice(visibleRangeInSource[1])
    : "";

  return {
    kind: PDF_TEXT_EDIT_NORMALIZED_PACKET_KIND,
    version: PDF_TEXT_EDIT_NORMALIZED_PACKET_VERSION,
    sourceText,
    visibleText: normalizedVisibleText,
    replacementVisibleText,
    replacementSourceText: sourceRangeInVisible
      ? buildReplacementSourceText({
          replacementVisibleText,
          sourceRangeInVisible,
          sourceText,
          visibleText: normalizedVisibleText,
        })
      : replacementVisibleText,
    visibleRangeInSource,
    sourceRangeInVisible,
    layoutPrefix,
    layoutSuffix,
    diagnostics: {
      sourceHasLayoutAffixes: !!(layoutPrefix || layoutSuffix),
      sourceTextMatchesExpected:
        typeof expectedSourceText !== "string" ||
        sourceText === expectedSourceText,
      visibleTextMatchesSource:
        sourceText === normalizedVisibleText || !!visibleRangeInSource,
    },
  };
}

export {
  buildTextEditNormalizedPacket,
  PDF_TEXT_EDIT_NORMALIZED_PACKET_KIND,
  PDF_TEXT_EDIT_NORMALIZED_PACKET_VERSION,
};
