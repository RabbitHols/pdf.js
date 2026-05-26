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

import { bytesToString, stringToBytes } from "../shared/util.js";
import { Dict, Ref } from "./primitives.js";
import {
  getTextEditSubjectUnsupportedSummary,
  PDF_TEXT_EDIT_SUBJECT_KIND,
} from "./text_edit_subject.js";
import {
  resolvePageContentStreamContainer,
  serializePdfEditContainerDescriptor,
  XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
} from "./text_edit_container_graph.js";
import { BaseStream } from "./base_stream.js";
import { rewriteTextSourceEdit } from "./text_edit_rewriter.js";
import { Stream } from "./stream.js";
import { TEXT_EDIT_SOURCE_MOVE_PLAN_KIND } from "./text_edit_planner.js";

const TEXT_EDIT_CONTENT_STREAM_PATCH_KIND =
  "pdfjs-text-edit-content-stream-patch";
const TEXT_EDIT_XOBJECT_FORM_STREAM_PATCH_KIND =
  "pdfjs-text-edit-xobject-form-stream-patch";

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function serializeRef(ref) {
  if (Number.isInteger(ref?.num) && Number.isInteger(ref?.gen)) {
    return {
      num: ref.num,
      gen: ref.gen,
    };
  }
  if (!(ref instanceof Ref)) {
    return null;
  }
  return {
    num: ref.num,
    gen: ref.gen,
  };
}

function deserializeRef(ref) {
  if (
    ref instanceof Ref ||
    (Number.isInteger(ref?.num) && Number.isInteger(ref?.gen))
  ) {
    return ref instanceof Ref ? ref : Ref.get(ref.num, ref.gen);
  }
  return null;
}

function serializeContainerResult(result) {
  const { descriptor, ...rest } = result;
  return unsupported(result.reason, {
    ...rest,
    descriptor: serializePdfEditContainerDescriptor(descriptor),
  });
}

function isSameSerializedRef(refA, refB) {
  return (
    Number.isInteger(refA?.num) &&
    Number.isInteger(refA?.gen) &&
    refA.num === refB?.num &&
    refA.gen === refB?.gen
  );
}

function cloneDecodedStreamDict(dict) {
  const clone = dict?.clone?.() || null;
  if (!clone) {
    return new Dict(dict?.xref || null);
  }
  for (const key of [
    "Filter",
    "DecodeParms",
    "F",
    "FFilter",
    "FDecodeParms",
    "DL",
  ]) {
    clone.delete(key);
  }
  return clone || new Dict(null);
}

function createDecodedContentStream(decodedBytes, dict) {
  const bytes =
    decodedBytes instanceof Uint8Array
      ? decodedBytes
      : stringToBytes(decodedBytes || "");
  const streamDict = cloneDecodedStreamDict(dict);
  return new Stream(bytes, 0, bytes.length, streamDict);
}

function getSinglePreviewTargetStream(contentStream) {
  const baseStreams = contentStream?.getBaseStreams?.();
  if (!baseStreams) {
    return contentStream;
  }
  return baseStreams.length === 1 ? baseStreams[0] : null;
}

async function createTextEditPreviewContentStream({ contentStream, patch }) {
  if (!patch) {
    return {
      ok: true,
      stream: contentStream,
    };
  }
  if (patch.kind !== TEXT_EDIT_CONTENT_STREAM_PATCH_KIND) {
    return unsupported("text-edit-preview-patch-kind-unsupported");
  }

  const ref = deserializeRef(patch.ref);
  if (!ref) {
    return unsupported("text-edit-preview-patch-ref-invalid");
  }
  const targetStream = getSinglePreviewTargetStream(contentStream);
  const objId = targetStream?.dict?.objId;
  if (!objId || ref.toString() !== objId) {
    return unsupported("text-edit-preview-content-stream-mismatch", {
      expectedRef: ref.toString(),
      actualRef: objId || null,
    });
  }

  let decodedBytes = patch.decodedBytes;
  if (!(decodedBytes instanceof Uint8Array)) {
    if (!patch.plan) {
      return unsupported("text-edit-preview-decoded-bytes-missing");
    }
    const currentDecodedBytes = await getDecodedStreamBytes(targetStream);
    if (!currentDecodedBytes) {
      return unsupported("text-edit-preview-target-invalid");
    }
    const rewritten = rewriteTextSourceEdit({
      decodedBytes: currentDecodedBytes,
      plan: patch.plan,
    });
    if (!rewritten.ok) {
      return unsupported(`text-edit-preview-${rewritten.reason}`);
    }
    decodedBytes = rewritten.decodedBytes;
  }

  return {
    ok: true,
    stream: createDecodedContentStream(
      decodedBytes,
      targetStream.dict,
      patch.plan
    ),
  };
}

async function getDecodedStreamBytes(stream) {
  if (!(stream instanceof BaseStream) || stream.isImageStream) {
    return null;
  }
  if (stream.isAsync) {
    const bytes = await stream.asyncGetBytes();
    return bytes instanceof Uint8Array ? bytes : null;
  }
  stream.reset();
  return stream.getBytes();
}

function clonePlanForSave(plan) {
  return {
    ok: true,
    kind: plan.kind,
    editGeneration: plan.editGeneration ?? null,
    grouped: plan.grouped === true,
    replacementText:
      typeof plan.replacementText === "string" ? plan.replacementText : null,
    container: plan.container || null,
    editSubject: plan.editSubject || null,
    sourceProof: plan.sourceProof,
    moveProof: plan.moveProof || null,
    fontProof: plan.fontProof,
    patch: plan.patch,
    patches: Array.isArray(plan.patches) ? plan.patches : null,
  };
}

function validateTextEditPlanSubject(plan) {
  if (plan?.kind === TEXT_EDIT_SOURCE_MOVE_PLAN_KIND) {
    return { ok: true };
  }
  const subject = plan?.editSubject;
  if (subject?.kind !== PDF_TEXT_EDIT_SUBJECT_KIND) {
    return unsupported("text-edit-content-stream-subject-invalid");
  }
  const unsupportedSummary =
    subject.unsupported || getTextEditSubjectUnsupportedSummary(subject);
  if (unsupportedSummary?.ok === false) {
    return unsupported(
      unsupportedSummary.reason || "text-edit-subject-proof-failed",
      {
        editSubject: subject,
        unsupported: unsupportedSummary,
      }
    );
  }
  if (subject.selectedStrategy?.writer !== "pdfjs-content-stream") {
    return unsupported("text-edit-content-stream-subject-invalid", {
      editSubject: subject,
      unsupported: unsupportedSummary || null,
    });
  }
  return {
    ok: true,
  };
}

function validateTextEditXObjectFormPlanSubject(plan) {
  const subject = plan?.editSubject;
  if (subject?.kind !== PDF_TEXT_EDIT_SUBJECT_KIND) {
    return unsupported("text-edit-xobject-form-subject-invalid");
  }
  const unsupportedSummary =
    subject.unsupported || getTextEditSubjectUnsupportedSummary(subject);
  if (unsupportedSummary?.ok === false) {
    return unsupported(
      unsupportedSummary.reason ||
        "text-edit-xobject-form-subject-proof-failed",
      {
        editSubject: subject,
        unsupported: unsupportedSummary,
      }
    );
  }
  if (subject.selectedStrategy?.writer !== "pdfjs-xobject-form-stream") {
    return unsupported("text-edit-xobject-form-subject-invalid", {
      editSubject: subject,
      unsupported: unsupportedSummary || null,
    });
  }
  return { ok: true };
}

function buildTextEditContentStreamPatch({ pageDict, pageRef = null, plan }) {
  if (!plan?.ok) {
    return unsupported("text-edit-plan-not-ok", {
      planReason: plan?.reason || null,
    });
  }
  const subjectValidation = validateTextEditPlanSubject(plan);
  if (!subjectValidation.ok) {
    return subjectValidation;
  }
  if (!plan.decodedStreamPatch?.ok) {
    return unsupported("text-edit-decoded-stream-patch-not-ok", {
      patchReason: plan.decodedStreamPatch?.reason || null,
    });
  }
  const target = resolvePageContentStreamContainer(pageDict);
  if (!target.ok) {
    return serializeContainerResult(target);
  }
  const descriptor = target.descriptor;
  if (
    descriptor.writableStrategy !== "replace-stream" &&
    descriptor.writableStrategy !== "coalesce-page-contents"
  ) {
    return unsupported("text-edit-content-stream-strategy-unsupported", {
      descriptor: serializePdfEditContainerDescriptor(descriptor),
    });
  }
  if (
    descriptor.writableStrategy === "replace-stream" &&
    !(descriptor.streamRef instanceof Ref)
  ) {
    return unsupported("text-edit-content-stream-ref-missing", {
      descriptor: serializePdfEditContainerDescriptor(descriptor),
    });
  }
  const serializedDescriptor = serializePdfEditContainerDescriptor(descriptor);
  if (
    plan.container?.streamRef &&
    !isSameSerializedRef(
      plan.container.streamRef,
      serializedDescriptor.streamRef
    )
  ) {
    return unsupported("text-edit-content-stream-container-mismatch", {
      descriptor: serializedDescriptor,
      planContainer: plan.container,
    });
  }

  return {
    ok: true,
    kind: TEXT_EDIT_CONTENT_STREAM_PATCH_KIND,
    ref: serializeRef(descriptor.streamRef),
    pageRef: serializeRef(pageRef),
    streamRefs: Array.isArray(descriptor.streamRefs)
      ? descriptor.streamRefs.map(serializeRef)
      : null,
    targetKind: descriptor.targetKind,
    contentsIndex: descriptor.contentsIndex,
    writableStrategy: descriptor.writableStrategy,
    container: serializedDescriptor,
    plan: clonePlanForSave(plan),
    decodedBytes: plan.decodedStreamPatch.decodedBytes,
    decodedString: plan.decodedStreamPatch.decodedString,
    validation: plan.decodedStreamPatch.validation,
  };
}

function buildTextEditXObjectFormStreamPatch({ plan }) {
  if (!plan?.ok) {
    return unsupported("text-edit-plan-not-ok", {
      planReason: plan?.reason || null,
    });
  }
  const subjectValidation = validateTextEditXObjectFormPlanSubject(plan);
  if (!subjectValidation.ok) {
    return subjectValidation;
  }
  if (!plan.decodedStreamPatch?.ok) {
    return unsupported("text-edit-decoded-stream-patch-not-ok", {
      patchReason: plan.decodedStreamPatch?.reason || null,
    });
  }
  if (
    plan.container?.writableStrategy !== XOBJECT_FORM_REPLACE_STREAM_STRATEGY
  ) {
    return unsupported("text-edit-xobject-form-strategy-unsupported", {
      container: plan.container || null,
    });
  }
  const target = plan.container?.xObjectFormEditTarget;
  if (target?.eligible !== true) {
    return unsupported(
      target?.failureReason || "text-edit-xobject-form-not-eligible",
      {
        container: plan.container || null,
      }
    );
  }
  const ref = deserializeRef(target.streamRef || plan.container?.streamRef);
  if (!ref) {
    return unsupported("text-edit-xobject-form-stream-ref-missing", {
      container: plan.container || null,
    });
  }

  return {
    ok: true,
    kind: TEXT_EDIT_XOBJECT_FORM_STREAM_PATCH_KIND,
    ref: serializeRef(ref),
    targetKind: plan.container.targetKind,
    writableStrategy: XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
    container: plan.container,
    plan: clonePlanForSave(plan),
    decodedBytes: plan.decodedStreamPatch.decodedBytes,
    decodedString: plan.decodedStreamPatch.decodedString,
    validation: plan.decodedStreamPatch.validation,
  };
}

function concatBytesWithNewlines(chunks) {
  const length =
    chunks.reduce((sum, chunk) => sum + chunk.length, 0) + chunks.length - 1;
  const output = new Uint8Array(length);
  const coalescedOffsets = [];
  let offset = 0;
  for (let i = 0, ii = chunks.length; i < ii; i++) {
    coalescedOffsets.push(offset);
    output.set(chunks[i], offset);
    offset += chunks[i].length;
    if (i + 1 < ii) {
      output[offset++] = 0x0a;
    }
  }
  return {
    bytes: output,
    coalescedOffsets,
  };
}

function getOriginalOffsets(chunks) {
  const offsets = [];
  let offset = 0;
  for (const chunk of chunks) {
    offsets.push(offset);
    offset += chunk.length;
  }
  return offsets;
}

function findAnchorStreamIndex({ fullByteRange, chunks, originalOffsets }) {
  if (!Array.isArray(fullByteRange)) {
    return -1;
  }
  const [start, end] = fullByteRange;
  for (let i = 0, ii = chunks.length; i < ii; i++) {
    const streamStart = originalOffsets[i];
    const streamEnd = streamStart + chunks[i].length;
    if (start >= streamStart && end <= streamEnd) {
      return i;
    }
  }
  return -1;
}

function getPlanPatchFullByteRanges(plan) {
  const ranges = [];
  const pushRange = range => {
    if (Array.isArray(range)) {
      ranges.push(range);
    }
  };
  if (Array.isArray(plan?.patches)) {
    for (const patch of plan.patches) {
      pushRange(patch.fullByteRange);
    }
  } else {
    pushRange(plan?.patch?.fullByteRange);
  }
  return ranges;
}

async function validateCoalescedPageContentsPlan({ pageDict, xref, plan }) {
  const target = resolvePageContentStreamContainer(pageDict);
  if (
    !target.ok ||
    target.descriptor.writableStrategy !== "coalesce-page-contents"
  ) {
    return { ok: true };
  }
  const streamRefs = Array.isArray(target.descriptor.streamRefs)
    ? target.descriptor.streamRefs
    : null;
  if (!xref || !streamRefs?.length) {
    return unsupported("text-edit-content-stream-refs-invalid", {
      descriptor: serializePdfEditContainerDescriptor(target.descriptor),
    });
  }

  const decodedChunks = [];
  for (const ref of streamRefs) {
    const decodedBytes = await getDecodedStreamBytes(xref.fetchIfRef(ref));
    if (!decodedBytes) {
      return unsupported("text-edit-content-stream-target-invalid", {
        descriptor: serializePdfEditContainerDescriptor(target.descriptor),
      });
    }
    decodedChunks.push(decodedBytes);
  }

  const originalOffsets = getOriginalOffsets(decodedChunks);
  const anchorStreamIndex = findAnchorStreamIndex({
    fullByteRange: plan?.patch?.fullByteRange,
    chunks: decodedChunks,
    originalOffsets,
  });
  if (anchorStreamIndex === -1) {
    return unsupported(
      "text-edit-content-stream-anchor-crosses-stream-boundary",
      {
        descriptor: serializePdfEditContainerDescriptor(target.descriptor),
      }
    );
  }

  const patchStreamIndexes = getPlanPatchFullByteRanges(plan).map(
    fullByteRange =>
      findAnchorStreamIndex({
        fullByteRange,
        chunks: decodedChunks,
        originalOffsets,
      })
  );
  if (
    patchStreamIndexes.length === 0 ||
    patchStreamIndexes.some(index => index !== anchorStreamIndex)
  ) {
    return unsupported(
      "text-edit-content-stream-patches-cross-stream-boundary",
      {
        anchorStreamIndex,
        patchStreamIndexes,
        descriptor: serializePdfEditContainerDescriptor(target.descriptor),
      }
    );
  }

  return {
    ok: true,
    anchorStreamIndex,
  };
}

function translateRange(range, delta) {
  return Array.isArray(range) ? range.map(value => value + delta) : range;
}

function translatePlanForCoalescedStream(plan, delta) {
  return {
    ...plan,
    sourceProof: {
      ...plan.sourceProof,
      operatorRange: translateRange(plan.sourceProof?.operatorRange, delta),
      operandRange: translateRange(plan.sourceProof?.operandRange, delta),
      fullByteRange: translateRange(plan.sourceProof?.fullByteRange, delta),
    },
    patch: {
      ...plan.patch,
      operatorRange: translateRange(plan.patch?.operatorRange, delta),
      operandRange: translateRange(plan.patch?.operandRange, delta),
      fullByteRange: translateRange(plan.patch?.fullByteRange, delta),
      replacementRange: translateRange(plan.patch?.replacementRange, delta),
      sourceProof: {
        ...plan.patch?.sourceProof,
        operatorRange: translateRange(
          plan.patch?.sourceProof?.operatorRange,
          delta
        ),
        operandRange: translateRange(
          plan.patch?.sourceProof?.operandRange,
          delta
        ),
        fullByteRange: translateRange(
          plan.patch?.sourceProof?.fullByteRange,
          delta
        ),
      },
    },
    patches: Array.isArray(plan.patches)
      ? plan.patches.map(patch => ({
          ...patch,
          operatorRange: translateRange(patch.operatorRange, delta),
          operandRange: translateRange(patch.operandRange, delta),
          fullByteRange: translateRange(patch.fullByteRange, delta),
          replacementRange: translateRange(patch.replacementRange, delta),
          sourceProof: {
            ...patch.sourceProof,
            operatorRange: translateRange(
              patch.sourceProof?.operatorRange,
              delta
            ),
            operandRange: translateRange(
              patch.sourceProof?.operandRange,
              delta
            ),
            fullByteRange: translateRange(
              patch.sourceProof?.fullByteRange,
              delta
            ),
          },
        }))
      : plan.patches,
  };
}

async function applyCoalescedPageContentsPatch({ patch, xref, changes }) {
  const pageRef = deserializeRef(patch.pageRef);
  if (!pageRef) {
    throw new Error("text-edit-content-stream-page-ref-invalid");
  }
  if (changes.has(pageRef)) {
    throw new Error("text-edit-content-stream-page-change-conflict");
  }
  const streamRefs = Array.isArray(patch.streamRefs)
    ? patch.streamRefs.map(deserializeRef)
    : null;
  if (!streamRefs?.length || streamRefs.some(ref => !ref)) {
    throw new Error("text-edit-content-stream-refs-invalid");
  }

  const streams = streamRefs.map(ref => xref.fetchIfRef(ref));
  const decodedChunks = [];
  for (const stream of streams) {
    const decodedBytes = await getDecodedStreamBytes(stream);
    if (!decodedBytes) {
      throw new Error("text-edit-content-stream-target-invalid");
    }
    decodedChunks.push(decodedBytes);
  }

  const originalOffsets = getOriginalOffsets(decodedChunks);
  const anchorStreamIndex = findAnchorStreamIndex({
    fullByteRange: patch.plan?.patch?.fullByteRange,
    chunks: decodedChunks,
    originalOffsets,
  });
  if (anchorStreamIndex === -1) {
    throw new Error("text-edit-content-stream-anchor-crosses-stream-boundary");
  }
  const patchStreamIndexes = getPlanPatchFullByteRanges(patch.plan).map(
    fullByteRange =>
      findAnchorStreamIndex({
        fullByteRange,
        chunks: decodedChunks,
        originalOffsets,
      })
  );
  if (
    patchStreamIndexes.length === 0 ||
    patchStreamIndexes.some(index => index !== anchorStreamIndex)
  ) {
    throw new Error("text-edit-content-stream-patches-cross-stream-boundary");
  }

  const { bytes: coalescedBytes, coalescedOffsets } =
    concatBytesWithNewlines(decodedChunks);
  const delta =
    coalescedOffsets[anchorStreamIndex] - originalOffsets[anchorStreamIndex];
  const translatedPlan = translatePlanForCoalescedStream(patch.plan, delta);
  const rewritten = rewriteTextSourceEdit({
    decodedBytes: coalescedBytes,
    plan: translatedPlan,
  });
  if (!rewritten.ok) {
    throw new Error(`text-edit-content-stream-${rewritten.reason}`);
  }

  const newStreamRef = xref.getNewTemporaryRef();
  const newStream = createDecodedContentStream(
    rewritten.decodedBytes,
    streams[anchorStreamIndex].dict
  );
  changes.put(newStreamRef, {
    data: newStream,
  });

  const pageDict = xref.fetchIfRef(pageRef);
  const newPageDict = pageDict.clone();
  newPageDict.set("Contents", newStreamRef);
  changes.put(pageRef, {
    data: newPageDict,
    textEditContentStreamPatch: {
      coalesced: true,
      newStreamRef,
      anchorStreamIndex,
      decodedString: bytesToString(rewritten.decodedBytes),
      replacementRange: rewritten.replacementRange,
      validation: rewritten.validation,
    },
  });
}

async function applyTextEditContentStreamPatches({ patches, xref, changes }) {
  if (!patches) {
    return;
  }
  if (!Array.isArray(patches)) {
    throw new Error("text-edit-content-stream-patches-invalid");
  }

  for (const patch of patches) {
    if (patch?.kind === TEXT_EDIT_XOBJECT_FORM_STREAM_PATCH_KIND) {
      await applyTextEditXObjectFormStreamPatch({ patch, xref, changes });
      continue;
    }
    if (patch?.kind !== TEXT_EDIT_CONTENT_STREAM_PATCH_KIND) {
      throw new Error("text-edit-content-stream-patch-kind-unsupported");
    }
    const subjectValidation = validateTextEditPlanSubject(patch.plan);
    if (!subjectValidation.ok) {
      throw new Error(subjectValidation.reason);
    }

    if (patch.writableStrategy === "coalesce-page-contents") {
      await applyCoalescedPageContentsPatch({ patch, xref, changes });
      continue;
    }

    const ref = deserializeRef(patch.ref);
    if (!ref) {
      throw new Error("text-edit-content-stream-patch-ref-invalid");
    }
    if (changes.has(ref)) {
      throw new Error("text-edit-content-stream-change-conflict");
    }

    const stream = xref.fetchIfRef(ref);
    const decodedBytes = await getDecodedStreamBytes(stream);
    if (!decodedBytes) {
      throw new Error("text-edit-content-stream-target-invalid");
    }

    const rewritten = rewriteTextSourceEdit({
      decodedBytes,
      plan: patch.plan,
    });
    if (!rewritten.ok) {
      throw new Error(`text-edit-content-stream-${rewritten.reason}`);
    }
    const newStream = createDecodedContentStream(
      rewritten.decodedBytes,
      stream.dict
    );
    changes.put(ref, {
      data: newStream,
      textEditContentStreamPatch: {
        decodedString: bytesToString(rewritten.decodedBytes),
        replacementRange: rewritten.replacementRange,
        validation: rewritten.validation,
      },
    });
  }
}

async function applyTextEditXObjectFormStreamPatch({ patch, xref, changes }) {
  const subjectValidation = validateTextEditXObjectFormPlanSubject(patch.plan);
  if (!subjectValidation.ok) {
    throw new Error(subjectValidation.reason);
  }
  if (patch.writableStrategy !== XOBJECT_FORM_REPLACE_STREAM_STRATEGY) {
    throw new Error("text-edit-xobject-form-strategy-unsupported");
  }
  const ref = deserializeRef(patch.ref);
  if (!ref) {
    throw new Error("text-edit-xobject-form-patch-ref-invalid");
  }
  if (changes.has(ref)) {
    throw new Error("text-edit-xobject-form-change-conflict");
  }

  const stream = xref.fetchIfRef(ref);
  const subtype = stream?.dict?.get("Subtype");
  if (!(stream instanceof BaseStream) || subtype?.name !== "Form") {
    throw new Error("text-edit-xobject-form-target-invalid");
  }
  const decodedBytes = await getDecodedStreamBytes(stream);
  if (!decodedBytes) {
    throw new Error("text-edit-xobject-form-target-invalid");
  }

  const rewritten = rewriteTextSourceEdit({
    decodedBytes,
    plan: patch.plan,
  });
  if (!rewritten.ok) {
    throw new Error(`text-edit-xobject-form-${rewritten.reason}`);
  }
  const newStream = createDecodedContentStream(
    rewritten.decodedBytes,
    stream.dict
  );
  changes.put(ref, {
    data: newStream,
    textEditXObjectFormStreamPatch: {
      decodedString: bytesToString(rewritten.decodedBytes),
      replacementRange: rewritten.replacementRange,
      validation: rewritten.validation,
    },
  });
}

export {
  applyTextEditContentStreamPatches,
  buildTextEditContentStreamPatch,
  buildTextEditXObjectFormStreamPatch,
  createTextEditPreviewContentStream,
  TEXT_EDIT_CONTENT_STREAM_PATCH_KIND,
  TEXT_EDIT_XOBJECT_FORM_STREAM_PATCH_KIND,
  validateCoalescedPageContentsPlan,
  validateTextEditPlanSubject,
};
