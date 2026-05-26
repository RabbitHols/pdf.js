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

const PDF_TEXT_EDIT_WHITESPACE_POLICY_KIND =
  "pdfjs-text-edit-whitespace-policy";
const PDF_TEXT_EDIT_WHITESPACE_POLICY_VERSION = 1;

function countWhitespace(text) {
  return (String(text || "").match(/\s/g) || []).length;
}

function getSources(textEditSource) {
  if (Array.isArray(textEditSource?.sources)) {
    return textEditSource.sources;
  }
  return textEditSource ? [textEditSource] : [];
}

function getSourceWhitespaceFacts(textEditSource) {
  let sourceSpaceCount = 0;
  let tjAdjustmentCount = 0;
  let textSegmentCount = 0;
  let spacingSegmentCount = 0;

  for (const source of getSources(textEditSource)) {
    for (const segment of source?.segments || []) {
      if (segment.kind === "text") {
        textSegmentCount++;
        sourceSpaceCount += countWhitespace(segment.text ?? segment.byteString);
      } else if (segment.kind === "spacing") {
        spacingSegmentCount++;
        tjAdjustmentCount++;
      }
    }
  }

  return {
    sourceSpaceCount,
    spacingSegmentCount,
    textSegmentCount,
    tjAdjustmentCount,
  };
}

function buildTextEditWhitespacePolicy({
  normalizedPacket = null,
  replacementText = "",
  replacementSourceText = null,
  textEditSource = null,
} = {}) {
  const facts = getSourceWhitespaceFacts(textEditSource);
  const replacementWhitespaceCount = countWhitespace(
    replacementText || normalizedPacket?.replacementVisibleText
  );
  const replacementSourceWhitespaceCount = countWhitespace(
    replacementSourceText ?? normalizedPacket?.replacementSourceText
  );
  const geometryGapCount =
    normalizedPacket?.diagnostics?.sourceHasLayoutAffixes === true
      ? countWhitespace(normalizedPacket.layoutPrefix) +
        countWhitespace(normalizedPacket.layoutSuffix)
      : 0;
  const layoutAffixTextLength =
    normalizedPacket?.diagnostics?.sourceHasLayoutAffixes === true
      ? String(normalizedPacket.layoutPrefix || "").length +
        String(normalizedPacket.layoutSuffix || "").length
      : 0;
  const sourceBackedWhitespace = Math.min(
    replacementSourceWhitespaceCount,
    facts.sourceSpaceCount
  );
  const remainingAfterSource =
    replacementSourceWhitespaceCount - sourceBackedWhitespace;
  const tjBackedWhitespace = Math.min(
    remainingAfterSource,
    facts.tjAdjustmentCount
  );
  const remainingAfterTJ = remainingAfterSource - tjBackedWhitespace;

  return {
    kind: PDF_TEXT_EDIT_WHITESPACE_POLICY_KIND,
    version: PDF_TEXT_EDIT_WHITESPACE_POLICY_VERSION,
    mode: "source-aware",
    ok: true,
    replacementWhitespaceCount,
    replacementSourceWhitespaceCount,
    sourceSpaceCount: facts.sourceSpaceCount,
    tjAdjustmentCount: facts.tjAdjustmentCount,
    geometryGapCount,
    layoutAffixTextLength,
    userSpaceCount: Math.max(0, remainingAfterTJ),
    roles: {
      sourceSpace: sourceBackedWhitespace,
      tjAdjustment: tjBackedWhitespace,
      geometryGap: geometryGapCount,
      fallbackSpace: 0,
      userSpace: Math.max(0, remainingAfterTJ),
      unclassified: 0,
    },
    sourceFacts: facts,
    diagnostics: [],
  };
}

function validateTextEditWhitespacePolicy({
  policy,
  replacementSpacingPlan = null,
  textEditSource = null,
} = {}) {
  if (!policy) {
    return {
      ok: false,
      reason: "text-edit-whitespace-policy-missing",
    };
  }
  if (policy.geometryGapCount > 0 || policy.layoutAffixTextLength > 0) {
    return {
      ok: false,
      reason: "text-edit-whitespace-layout-affix-unsupported",
      geometryGapCount: policy.geometryGapCount,
      layoutAffixTextLength: policy.layoutAffixTextLength,
    };
  }
  if (policy.userSpaceCount > 0) {
    if (
      textEditSource?.operatorName === "TJ" &&
      replacementSpacingPlan?.ok &&
      replacementSpacingPlan?.layoutProof
    ) {
      return {
        ok: true,
        reason: "",
        spacing: replacementSpacingPlan.layoutProof.spacing,
      };
    }
    return {
      ok: false,
      reason: "text-edit-whitespace-user-space-unsupported",
      userSpaceCount: policy.userSpaceCount,
    };
  }
  return {
    ok: true,
    reason: "",
  };
}

export {
  buildTextEditWhitespacePolicy,
  PDF_TEXT_EDIT_WHITESPACE_POLICY_KIND,
  PDF_TEXT_EDIT_WHITESPACE_POLICY_VERSION,
  validateTextEditWhitespacePolicy,
};
