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
  getPdfEditContainerPathSubjectType,
  XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
} from "./text_edit_container_graph.js";
import { buildTextEditNormalizedPacket } from "./text_edit_normalized_packet.js";
import { buildTextEditWhitespacePolicy } from "./text_edit_whitespace_policy.js";
import { getSourceTextFromTextEditSource } from "../shared/text_edit_source.js";

const PDF_TEXT_EDIT_SUBJECT_KIND = "pdfjs-text-edit-subject";
const PDF_TEXT_EDIT_SUBJECT_VERSION = 1;

function cloneArray(value) {
  return Array.isArray(value) ? value.slice() : null;
}

function normalizeContainer(container) {
  if (!container) {
    return null;
  }
  return {
    containerPath: Array.isArray(container.containerPath)
      ? container.containerPath.map(entry => ({ ...entry }))
      : null,
    contentsIndex: Number.isInteger(container.contentsIndex)
      ? container.contentsIndex
      : null,
    streamRef: container.streamRef || null,
    streamRefs: Array.isArray(container.streamRefs)
      ? container.streamRefs.slice()
      : null,
    targetKind: container.targetKind || null,
    writableStrategy: container.writableStrategy || null,
    xObjectFormEditTarget: container.xObjectFormEditTarget
      ? { ...container.xObjectFormEditTarget }
      : null,
  };
}

function getSources({
  textEditSource = null,
  textEditCandidate = null,
  textEditCandidateGroup = null,
}) {
  if (Array.isArray(textEditCandidateGroup?.sources)) {
    return textEditCandidateGroup.sources.slice();
  }
  if (Array.isArray(textEditSource?.sources)) {
    return textEditSource.sources.slice();
  }
  const source = textEditSource || textEditCandidate?.textEditSource || null;
  return source ? [source] : [];
}

function getContainer({
  textEditCandidate = null,
  textEditCandidateGroup = null,
}) {
  return normalizeContainer(
    textEditCandidateGroup?.container || textEditCandidate?.container || null
  );
}

function classifySubjectType(container) {
  return getPdfEditContainerPathSubjectType(container?.containerPath);
}

function classifyOperation({ replacementText, expectedSourceText, sources }) {
  if (replacementText === "" && (expectedSourceText || sources.length > 0)) {
    return "replace-with-empty-text";
  }
  return "replace-source-text";
}

function classifySubjectSubtype({ sources, operation }) {
  if (operation === "replace-with-empty-text") {
    return "source-text-delete";
  }
  if (sources.length > 1) {
    return "adjacent-operators";
  }
  const operatorName = sources[0]?.operatorName || "";
  if (operatorName === "Tj") {
    return "single-tj";
  }
  if (operatorName === "TJ") {
    return "single-tj-array";
  }
  return "unknown-text-operator";
}

function buildContainerFacts(container) {
  let streamRefCount = 0;
  if (Array.isArray(container?.streamRefs)) {
    streamRefCount = container.streamRefs.length;
  } else if (container?.streamRef) {
    streamRefCount = 1;
  }

  return {
    targetKind: container?.targetKind || null,
    writableStrategy: container?.writableStrategy || null,
    streamRef: container?.streamRef || null,
    streamRefCount,
  };
}

function buildOperatorFacts(sources) {
  return {
    operatorCount: sources.length,
    operators: sources.map(source => source?.operatorName || null),
    operatorIndexes: sources.map(source =>
      Number.isInteger(source?.operatorIndex) ? source.operatorIndex : null
    ),
    byteRanges: sources.map(source => ({
      fullByteRange: cloneArray(source?.fullByteRange),
      operandRange: cloneArray(source?.operandRange),
      operatorRange: cloneArray(source?.operatorRange),
    })),
    grouped: sources.length > 1,
  };
}

function buildFontFacts({
  textEditCandidate = null,
  textEditCandidateGroup = null,
}) {
  const binding =
    textEditCandidateGroup?.proof?.fontBinding ||
    textEditCandidate?.proof?.fontBinding ||
    null;
  return {
    encodeStringAvailable:
      binding?.encodeStringAvailable === undefined
        ? null
        : binding.encodeStringAvailable === true,
    fallbackName: binding?.fallbackName || null,
    fontLoadedName: binding?.fontLoadedName || null,
    fontName: binding?.fontName || null,
    fontRef: binding?.fontRef || null,
    fontSize: typeof binding?.fontSize === "number" ? binding.fontSize : null,
    isType3Font: binding?.isType3Font === true,
    vertical: binding?.vertical === true,
  };
}

function buildLayoutFacts({
  textEditCandidate = null,
  textEditCandidateGroup = null,
}) {
  const layout =
    textEditCandidateGroup?.layoutFacts ||
    textEditCandidateGroup?.proof?.layout ||
    textEditCandidate?.proof?.layout ||
    null;
  return {
    ok: layout?.ok === undefined ? null : layout.ok === true,
    reason: layout?.reason || "",
    glyphCount:
      typeof layout?.glyphCount === "number" ? layout.glyphCount : null,
    spacingSegmentCount:
      typeof layout?.spacingSegmentCount === "number"
        ? layout.spacingSegmentCount
        : null,
    whitespacePolicy: layout?.whitespacePolicy || null,
    width: typeof layout?.width === "number" ? layout.width : null,
    height: typeof layout?.height === "number" ? layout.height : null,
  };
}

function buildSubjectSurfaceProof(container, subjectType) {
  if (subjectType === "page-content-text") {
    return { ok: true, reason: "" };
  }
  if (
    subjectType === "xobject-form" &&
    container?.writableStrategy === XOBJECT_FORM_REPLACE_STREAM_STRATEGY &&
    container.xObjectFormEditTarget?.eligible === true
  ) {
    return { ok: true, reason: "" };
  }
  return {
    ok: false,
    reason: "text-edit-subject-not-page-content-text",
  };
}

function buildContainerProof(container) {
  if (!container) {
    return {
      ok: true,
      reason: "",
      writableStrategy: null,
    };
  }
  if (
    container.writableStrategy === "replace-stream" ||
    container.writableStrategy === "coalesce-page-contents" ||
    (container.writableStrategy === XOBJECT_FORM_REPLACE_STREAM_STRATEGY &&
      container.xObjectFormEditTarget?.eligible === true)
  ) {
    return {
      ok: true,
      reason: "",
      writableStrategy: container.writableStrategy,
    };
  }
  return {
    ok: false,
    reason: "text-edit-container-writer-unsupported",
    writableStrategy: container.writableStrategy || null,
  };
}

function buildSourceAnchorProof(sources) {
  if (sources.length === 0) {
    return { ok: false, reason: "text-edit-source-missing" };
  }
  for (const source of sources) {
    if (source?.editable !== true) {
      return {
        ok: false,
        reason: source?.reason || "text-edit-source-not-editable",
      };
    }
    if (source.operatorName !== "Tj" && source.operatorName !== "TJ") {
      return {
        ok: false,
        reason: "text-edit-source-operator-not-supported",
      };
    }
    if (!Array.isArray(source.fullByteRange)) {
      return {
        ok: false,
        reason: "text-edit-source-byte-range-missing",
      };
    }
    if (typeof getSourceTextFromTextEditSource(source) !== "string") {
      return {
        ok: false,
        reason: "text-edit-source-text-missing",
      };
    }
  }
  return { ok: true, reason: "" };
}

function buildFontEncodingProof(fontFacts) {
  if (fontFacts.encodeStringAvailable === false) {
    return {
      ok: false,
      reason: "source-font-encodeString-missing",
    };
  }
  return {
    ok: true,
    reason: "",
  };
}

function buildLayoutProof(layoutFacts) {
  if (layoutFacts.ok === false) {
    return {
      ok: false,
      reason: layoutFacts.reason || "text-edit-layout-proof-failed",
    };
  }
  return {
    ok: true,
    reason: "",
  };
}

function selectStrategy({ operation, proofs, subjectSubtype, subjectType }) {
  if (
    subjectType === "page-content-text" &&
    proofs.containerProof.ok &&
    proofs.fontEncodingProof.ok &&
    proofs.layoutProof.ok &&
    proofs.sourceAnchorProof.ok &&
    proofs.subjectSurfaceProof.ok
  ) {
    let id = "single-source-text";
    if (operation === "replace-with-empty-text") {
      id = "source-text-delete";
    } else if (subjectSubtype === "adjacent-operators") {
      id = "adjacent-source-text";
    }
    return {
      id,
      writer: "pdfjs-content-stream",
    };
  }
  if (
    subjectType === "xobject-form" &&
    proofs.containerProof.ok &&
    proofs.fontEncodingProof.ok &&
    proofs.layoutProof.ok &&
    proofs.sourceAnchorProof.ok &&
    proofs.subjectSurfaceProof.ok
  ) {
    return {
      id: "xobject-form-source-text",
      writer: "pdfjs-xobject-form-stream",
    };
  }
  return {
    id: "blocked",
    writer: null,
  };
}

function buildUnsupportedSummary(subject) {
  const proofOrder = [
    ["subjectSurfaceProof", subject.proofs.subjectSurfaceProof],
    ["containerProof", subject.proofs.containerProof],
    ["sourceAnchorProof", subject.proofs.sourceAnchorProof],
    ["fontEncodingProof", subject.proofs.fontEncodingProof],
    ["layoutProof", subject.proofs.layoutProof],
  ];
  for (const [proofName, proof] of proofOrder) {
    if (proof?.ok === false) {
      return {
        ok: false,
        reason: proof.reason || "text-edit-subject-proof-failed",
        proofName,
        subjectType: subject.subjectType,
        subjectSubtype: subject.subjectSubtype,
        strategy: subject.selectedStrategy.id,
      };
    }
  }
  if (subject.whitespacePolicy?.ok === false) {
    return {
      ok: false,
      reason:
        subject.whitespacePolicy.diagnostics?.[0]?.reason ||
        "text-edit-whitespace-policy-not-ok",
      proofName: "whitespacePolicy",
      subjectType: subject.subjectType,
      subjectSubtype: subject.subjectSubtype,
      strategy: subject.selectedStrategy.id,
    };
  }
  if (subject.selectedStrategy.id === "blocked") {
    return {
      ok: false,
      reason: "text-edit-subject-blocked",
      proofName: "selectedStrategy",
      subjectType: subject.subjectType,
      subjectSubtype: subject.subjectSubtype,
      strategy: subject.selectedStrategy.id,
    };
  }
  return {
    ok: true,
    reason: "",
    proofName: "",
    subjectType: subject.subjectType,
    subjectSubtype: subject.subjectSubtype,
    strategy: subject.selectedStrategy.id,
  };
}

function classifyTextEditSubject({
  expectedSourceText = "",
  replacementText = "",
  textEditCandidate = null,
  textEditCandidateGroup = null,
  textEditSource = null,
  visibleText = null,
} = {}) {
  const sources = getSources({
    textEditCandidate,
    textEditCandidateGroup,
    textEditSource,
  });
  const normalizedSource =
    textEditSource ||
    textEditCandidateGroup?.candidateGroup ||
    textEditCandidate?.textEditSource ||
    (sources.length > 1 ? { grouped: true, sources } : sources[0]) ||
    null;
  const normalizedPacket = buildTextEditNormalizedPacket({
    expectedSourceText,
    replacementText,
    textEditSource: normalizedSource,
    visibleText,
  });
  const whitespacePolicy = buildTextEditWhitespacePolicy({
    normalizedPacket,
    replacementText,
    textEditSource: normalizedSource,
  });
  const container = getContainer({ textEditCandidate, textEditCandidateGroup });
  const subjectType = classifySubjectType(container);
  const operation = classifyOperation({
    expectedSourceText,
    replacementText,
    sources,
  });
  const subjectSubtype = classifySubjectSubtype({ operation, sources });
  const containerFacts = buildContainerFacts(container);
  const operatorFacts = buildOperatorFacts(sources);
  const fontFacts = buildFontFacts({
    textEditCandidate,
    textEditCandidateGroup,
  });
  const layoutFacts = buildLayoutFacts({
    textEditCandidate,
    textEditCandidateGroup,
  });
  const proofs = {
    containerProof: buildContainerProof(container),
    fontEncodingProof: buildFontEncodingProof(fontFacts),
    layoutProof: buildLayoutProof(layoutFacts),
    sourceAnchorProof: buildSourceAnchorProof(sources),
    subjectSurfaceProof: buildSubjectSurfaceProof(container, subjectType),
  };
  const writerEligibility = {
    sourceContentStream:
      subjectType === "page-content-text" &&
      proofs.containerProof.ok &&
      proofs.sourceAnchorProof.ok,
    xObjectFormStream:
      subjectType === "xobject-form" &&
      proofs.containerProof.ok &&
      proofs.sourceAnchorProof.ok,
    requiresNonPageContentWriter: subjectType !== "page-content-text",
  };
  const selectedStrategy = selectStrategy({
    operation,
    proofs,
    subjectSubtype,
    subjectType,
  });

  const subject = {
    kind: PDF_TEXT_EDIT_SUBJECT_KIND,
    version: PDF_TEXT_EDIT_SUBJECT_VERSION,
    subjectType,
    subjectSubtype,
    operation,
    containerFacts,
    operatorFacts,
    fontFacts,
    layoutFacts,
    normalizedPacket,
    proofs,
    selectedStrategy,
    whitespacePolicy,
    writerEligibility,
  };
  subject.unsupported = buildUnsupportedSummary(subject);
  return Object.freeze(subject);
}

export {
  classifyTextEditSubject,
  buildUnsupportedSummary as getTextEditSubjectUnsupportedSummary,
  PDF_TEXT_EDIT_SUBJECT_KIND,
  PDF_TEXT_EDIT_SUBJECT_VERSION,
};
