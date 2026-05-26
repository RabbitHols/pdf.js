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

import { stringToBytes } from "../shared/util.js";

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function isSameRange(rangeA, rangeB) {
  return (
    rangeA?.length === rangeB?.length &&
    rangeA.every((value, index) => value === rangeB[index])
  );
}

function getPatchReplacementRange(patch) {
  return patch?.replacementRange || patch?.operandRange;
}

function getPatchReplacementText(patch) {
  return patch?.replacementOperand;
}

function validatePatchRange(bytes, patch) {
  const [start, end] = getPatchReplacementRange(patch) || [];
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > bytes.length
  ) {
    return unsupported("text-edit-plan-range-invalid");
  }
  return {
    ok: true,
    start,
    end,
  };
}

function findOperationForPatch(operations, patch) {
  return operations.find(
    operation =>
      operation.operatorName === patch.operatorName &&
      operation.operatorIndex === patch.sourceProof?.operatorIndex &&
      isSameRange(operation.operatorRange, patch.operatorRange) &&
      isSameRange(operation.operandRange, patch.operandRange) &&
      isSameRange(operation.fullByteRange, patch.fullByteRange)
  );
}

function validateContentStreamPatch({ bytes, operations, patch }) {
  if (
    (patch?.operatorName !== "Tj" &&
      patch?.operatorName !== "TJ" &&
      patch?.operatorName !== "Tm" &&
      patch?.operatorName !== "Td" &&
      patch?.operatorName !== "TD") ||
    typeof getPatchReplacementText(patch) !== "string" ||
    !Array.isArray(getPatchReplacementRange(patch))
  ) {
    return unsupported("text-edit-plan-patch-unsupported");
  }

  const operation = findOperationForPatch(operations, patch);
  if (!operation) {
    return unsupported("text-edit-source-anchor-not-found");
  }

  const range = validatePatchRange(bytes, patch);
  if (!range.ok) {
    return range;
  }
  return {
    ok: true,
    operation,
    patch,
    start: range.start,
    end: range.end,
    replacementBytes: stringToBytes(getPatchReplacementText(patch)),
  };
}

function rewriteContentStreamOperations({ bytes, operations, patches }) {
  if (!(bytes instanceof Uint8Array)) {
    return unsupported("decoded-content-stream-bytes-missing");
  }
  if (!Array.isArray(patches) || patches.length === 0) {
    return unsupported("text-edit-plan-patch-unsupported");
  }

  const validatedPatches = [];
  for (const patch of patches) {
    const validation = validateContentStreamPatch({
      bytes,
      operations,
      patch,
    });
    if (!validation.ok) {
      return validation;
    }
    validatedPatches.push(validation);
  }

  validatedPatches.sort((a, b) => a.start - b.start);
  for (let i = 1, ii = validatedPatches.length; i < ii; i++) {
    if (validatedPatches[i - 1].end > validatedPatches[i].start) {
      return unsupported("text-edit-plan-ranges-overlap");
    }
  }

  const length = validatedPatches.reduce(
    (sum, patch) =>
      sum - (patch.end - patch.start) + patch.replacementBytes.length,
    bytes.length
  );
  const output = new Uint8Array(length);
  let sourceOffset = 0,
    outputOffset = 0;
  for (const patch of validatedPatches) {
    output.set(bytes.subarray(sourceOffset, patch.start), outputOffset);
    outputOffset += patch.start - sourceOffset;
    output.set(patch.replacementBytes, outputOffset);
    outputOffset += patch.replacementBytes.length;
    sourceOffset = patch.end;
  }
  output.set(bytes.subarray(sourceOffset), outputOffset);

  return {
    ok: true,
    decodedBytes: output,
    patches: validatedPatches.map(patch => ({
      operatorName: patch.operation.operatorName,
      operatorIndex: patch.operation.operatorIndex,
      replacementRange: [
        patch.start,
        patch.start + patch.replacementBytes.length,
      ],
    })),
  };
}

export { rewriteContentStreamOperations, validateContentStreamPatch };
