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
import { getSourceTextFromTextEditSource } from "../shared/text_edit_source.js";
import { rewriteContentStreamOperations } from "./content_stream_filter.js";
import { TEXT_EDIT_SOURCE_MOVE_PLAN_KIND } from "./text_edit_planner.js";
import { XOBJECT_FORM_REPLACE_STREAM_STRATEGY } from "./text_edit_container_graph.js";

const TEXT_EDIT_REWRITER_STRATEGIES = new Set([
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

function toBytes(data) {
  if (typeof data === "string") {
    return stringToBytes(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return null;
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

function findValidationOperation(operations, plan) {
  const { patch, sourceProof } = plan;
  return operations.find(
    operation =>
      operation.operatorName === patch.operatorName &&
      operation.operatorIndex === sourceProof?.operatorIndex
  );
}

function findValidationOperationForPatch(operations, patch) {
  return operations.find(
    operation =>
      operation.operatorName === patch.operatorName &&
      operation.operatorIndex === patch.sourceProof?.operatorIndex
  );
}

function getPatchReplacementRange(patch) {
  return patch?.operandRange;
}

function getPatchReplacementText(patch) {
  return patch?.replacementOperand;
}

function validateRewrittenBytes(bytes, plan) {
  if (Array.isArray(plan.patches)) {
    return validateRewrittenGroupedBytes(bytes, plan);
  }
  const operations = collectContentStreamOperations(
    tokenizeContentStream(bytes)
  );
  const operation = findValidationOperation(operations, plan);
  if (!operation) {
    return unsupported("text-edit-validation-anchor-not-found");
  }

  const currentSource = buildTextOperatorSource(operation);
  if (!currentSource?.editable) {
    return unsupported("text-edit-validation-source-not-editable", {
      sourceReason: currentSource?.reason || null,
    });
  }

  const replacementText = getSourceTextFromTextEditSource(currentSource);
  if (replacementText !== plan.patch?.replacementByteString) {
    return unsupported("text-edit-validation-replacement-mismatch");
  }

  return {
    ok: true,
    operatorName: operation.operatorName,
    operatorIndex: operation.operatorIndex,
    operatorRange: operation.operatorRange,
    operandRange: operation.operandRange,
  };
}

function validateRewrittenGroupedBytes(bytes, plan) {
  const operations = collectContentStreamOperations(
    tokenizeContentStream(bytes)
  );
  let replacementText = "";
  for (const patch of plan.patches) {
    const operation = findValidationOperationForPatch(operations, patch);
    if (!operation) {
      return unsupported("text-edit-validation-anchor-not-found");
    }
    const currentSource = buildTextOperatorSource(operation);
    if (!currentSource?.editable) {
      return unsupported("text-edit-validation-source-not-editable", {
        sourceReason: currentSource?.reason || null,
      });
    }
    replacementText += getSourceTextFromTextEditSource(currentSource);
  }
  if (replacementText !== plan.replacementText) {
    return unsupported("text-edit-validation-replacement-mismatch");
  }
  return {
    ok: true,
    grouped: true,
    operatorCount: plan.patches.length,
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

function findTextMoveAnchorOperation(operations, sourceProof) {
  return operations.find(
    operation =>
      operation.operatorName === sourceProof?.operatorName &&
      operation.operatorIndex === sourceProof?.operatorIndex &&
      isSameRange(operation.operatorRange, sourceProof?.operatorRange) &&
      isSameRange(operation.operandRange, sourceProof?.operandRange) &&
      isSameRange(operation.fullByteRange, sourceProof?.fullByteRange)
  );
}

function getNumberOperands(operation, count) {
  const operands = operation?.operands;
  if (!Array.isArray(operands) || operands.length < count) {
    return null;
  }
  const values = operands.slice(0, count).map(operand => operand.value);
  return values.every(
    value => typeof value === "number" && Number.isFinite(value)
  )
    ? values
    : null;
}

function findOperationByNameAndIndex(operations, operatorName, operatorIndex) {
  return operations.find(
    operation =>
      operation.operatorName === operatorName &&
      operation.operatorIndex === operatorIndex
  );
}

function validateRewrittenTextSourceMove(bytes, plan) {
  const operations = collectContentStreamOperations(
    tokenizeContentStream(bytes)
  );
  const textOperation = findOperationByNameAndIndex(
    operations,
    plan.sourceProof?.operatorName,
    plan.sourceProof?.operatorIndex
  );
  if (!textOperation) {
    return unsupported("text-edit-validation-anchor-not-found");
  }
  const currentSource = buildTextOperatorSource(textOperation);
  if (!currentSource?.editable) {
    return unsupported("text-edit-validation-source-not-editable", {
      sourceReason: currentSource?.reason || null,
    });
  }
  if (
    !isSameFingerprint(
      currentSource.operatorFingerprint,
      plan.sourceProof?.operatorFingerprint
    )
  ) {
    return unsupported("text-edit-validation-source-fingerprint-mismatch");
  }
  if (
    getSourceTextFromTextEditSource(currentSource) !==
    plan.sourceProof?.expectedSourceText
  ) {
    return unsupported("text-edit-validation-source-text-mismatch");
  }

  const moveOperation = findOperationByNameAndIndex(
    operations,
    plan.patch?.operatorName,
    plan.patch?.sourceProof?.operatorIndex
  );
  if (!moveOperation) {
    return unsupported("text-edit-validation-move-anchor-not-found");
  }
  const replacementValues =
    plan.patch?.operatorName === "Tm"
      ? getNumberOperands(moveOperation, 6)
      : getNumberOperands(moveOperation, 2);
  if (!replacementValues) {
    return unsupported("text-edit-validation-move-operands-invalid");
  }
  const expectedValues =
    plan.patch?.operatorName === "Tm"
      ? plan.moveProof?.replacementTextMatrix
      : plan.moveProof?.replacementTextTranslation;
  if (!isSameRange(replacementValues, expectedValues)) {
    return unsupported("text-edit-validation-move-operands-mismatch");
  }

  if (
    plan.moveProof?.strategy === "adjacent-td-translation-with-compensation" ||
    plan.moveProof?.strategy ===
      "adjacent-td-set-leading-translation-with-compensation"
  ) {
    const compensation = findOperationByNameAndIndex(
      operations,
      "Td",
      (plan.sourceProof?.operatorIndex ?? -2) + 1
    );
    if (!compensation) {
      return unsupported("text-edit-validation-compensation-anchor-not-found");
    }
    const compensationValues = getNumberOperands(compensation, 2);
    if (
      !isSameRange(
        compensationValues,
        plan.moveProof?.compensationTextTranslation
      )
    ) {
      return unsupported("text-edit-validation-compensation-mismatch");
    }
    if (
      plan.moveProof?.strategy ===
      "adjacent-td-set-leading-translation-with-compensation"
    ) {
      const leading = findOperationByNameAndIndex(
        operations,
        "TL",
        (plan.sourceProof?.operatorIndex ?? -3) + 2
      );
      if (!leading) {
        return unsupported("text-edit-validation-leading-anchor-not-found");
      }
      const leadingValues = getNumberOperands(leading, 1);
      if (!isSameRange(leadingValues, [plan.moveProof?.restoredTextLeading])) {
        return unsupported("text-edit-validation-leading-mismatch");
      }
    }
  }
  return {
    ok: true,
    operatorName: textOperation.operatorName,
    operatorIndex: textOperation.operatorIndex,
    moveStrategy: plan.moveProof?.strategy || null,
    moveOperatorName: moveOperation.operatorName,
    moveOperatorIndex: moveOperation.operatorIndex,
    replacementTextMatrix: plan.moveProof?.replacementTextMatrix || null,
    replacementValues,
  };
}

function validatePlannedPatch({ operations, patch }) {
  const operation = findOperationForPatch(operations, patch);
  if (!operation) {
    return unsupported("text-edit-source-anchor-not-found");
  }
  const currentSource = buildTextOperatorSource(operation);
  if (!currentSource?.editable) {
    return unsupported("text-edit-source-not-editable", {
      sourceReason: currentSource?.reason || null,
    });
  }
  if (
    !isSameFingerprint(
      currentSource.operatorFingerprint,
      patch.sourceProof?.operatorFingerprint
    )
  ) {
    return unsupported("text-edit-source-fingerprint-mismatch");
  }
  return {
    ok: true,
  };
}

function rewriteGroupedTextSourceEdit({ bytes, plan, operations }) {
  if (!Array.isArray(plan.patches) || plan.patches.length < 2) {
    return unsupported("text-edit-plan-patch-unsupported");
  }
  for (const patch of plan.patches) {
    if (
      (patch.operatorName !== "Tj" && patch.operatorName !== "TJ") ||
      typeof getPatchReplacementText(patch) !== "string" ||
      !Array.isArray(getPatchReplacementRange(patch))
    ) {
      return unsupported("text-edit-plan-patch-unsupported");
    }
    const validation = validatePlannedPatch({ operations, patch });
    if (!validation.ok) {
      return validation;
    }
  }

  const rewritten = rewriteContentStreamOperations({
    bytes,
    operations,
    patches: plan.patches,
  });
  if (!rewritten.ok) {
    return rewritten;
  }
  const rewrittenBytes = rewritten.decodedBytes;
  const validation = validateRewrittenBytes(rewrittenBytes, plan);
  if (!validation.ok) {
    return validation;
  }
  const firstPatch = plan.patches[0];
  return {
    ok: true,
    decodedBytes: rewrittenBytes,
    decodedString: bytesToString(rewrittenBytes),
    replacementRange: rewritten.patches[0]?.replacementRange || [
      firstPatch.operandRange[0],
      firstPatch.operandRange[0] + firstPatch.replacementOperand.length,
    ],
    validation,
  };
}

function rewriteTextSourceEdit({ decodedBytes, plan }) {
  if (!plan?.ok) {
    return unsupported("text-edit-plan-not-ok", {
      planReason: plan?.reason || null,
    });
  }

  const bytes = toBytes(decodedBytes);
  if (!bytes) {
    return unsupported("decoded-content-stream-bytes-missing");
  }

  const { patch, sourceProof } = plan;
  if (
    plan.container &&
    !TEXT_EDIT_REWRITER_STRATEGIES.has(plan.container.writableStrategy)
  ) {
    return unsupported("text-edit-container-writer-unsupported");
  }
  if (plan.kind === TEXT_EDIT_SOURCE_MOVE_PLAN_KIND) {
    return rewriteTextSourceMove({ bytes, plan });
  }
  if (
    (patch?.operatorName !== "Tj" && patch?.operatorName !== "TJ") ||
    typeof getPatchReplacementText(patch) !== "string" ||
    !Array.isArray(getPatchReplacementRange(patch))
  ) {
    return unsupported("text-edit-plan-patch-unsupported");
  }

  const operations = collectContentStreamOperations(
    tokenizeContentStream(bytes)
  );
  if (Array.isArray(plan.patches)) {
    return rewriteGroupedTextSourceEdit({ bytes, plan, operations });
  }
  const operation = findOperationForPatch(operations, {
    ...patch,
    sourceProof,
  });
  if (!operation) {
    return unsupported("text-edit-source-anchor-not-found");
  }

  const currentSource = buildTextOperatorSource(operation);
  if (!currentSource?.editable) {
    return unsupported("text-edit-source-not-editable", {
      sourceReason: currentSource?.reason || null,
    });
  }
  if (
    !isSameFingerprint(
      currentSource.operatorFingerprint,
      sourceProof?.operatorFingerprint
    )
  ) {
    return unsupported("text-edit-source-fingerprint-mismatch");
  }

  const rewritten = rewriteContentStreamOperations({
    bytes,
    operations,
    patches: [
      {
        ...patch,
        sourceProof,
      },
    ],
  });
  if (!rewritten.ok) {
    return rewritten;
  }
  const rewrittenBytes = rewritten.decodedBytes;
  const validation = validateRewrittenBytes(rewrittenBytes, plan);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    decodedBytes: rewrittenBytes,
    decodedString: bytesToString(rewrittenBytes),
    replacementRange: rewritten.patches[0]?.replacementRange,
    validation,
  };
}

function rewriteTextSourceMove({ bytes, plan }) {
  const { patch, sourceProof } = plan;
  const movePatches = Array.isArray(plan.patches) ? plan.patches : [patch];
  if (
    (patch?.operatorName !== "Tm" &&
      patch?.operatorName !== "Td" &&
      patch?.operatorName !== "TD") ||
    movePatches.some(
      movePatch =>
        typeof getPatchReplacementText(movePatch) !== "string" ||
        !Array.isArray(getPatchReplacementRange(movePatch))
    )
  ) {
    return unsupported("text-edit-plan-patch-unsupported");
  }

  const operations = collectContentStreamOperations(
    tokenizeContentStream(bytes)
  );
  const textOperation = findTextMoveAnchorOperation(operations, sourceProof);
  if (!textOperation) {
    return unsupported("text-edit-source-anchor-not-found");
  }
  const currentSource = buildTextOperatorSource(textOperation);
  if (!currentSource?.editable) {
    return unsupported("text-edit-source-not-editable", {
      sourceReason: currentSource?.reason || null,
    });
  }
  if (
    !isSameFingerprint(
      currentSource.operatorFingerprint,
      sourceProof?.operatorFingerprint
    )
  ) {
    return unsupported("text-edit-source-fingerprint-mismatch");
  }
  if (
    getSourceTextFromTextEditSource(currentSource) !==
    sourceProof?.expectedSourceText
  ) {
    return unsupported("source-text-mismatch", {
      sourceProof: {
        sourceText: getSourceTextFromTextEditSource(currentSource),
        expectedSourceText: sourceProof?.expectedSourceText,
        sourceTextMatches: false,
      },
    });
  }

  const moveOperation = findOperationForPatch(operations, patch);
  if (!moveOperation) {
    return unsupported("text-edit-source-move-anchor-not-found");
  }
  if (
    !isSameFingerprint(
      moveOperation.fingerprint,
      patch.sourceProof?.operatorFingerprint
    )
  ) {
    return unsupported("text-edit-source-move-fingerprint-mismatch");
  }
  for (const movePatch of movePatches.slice(1)) {
    const operation = findOperationForPatch(operations, movePatch);
    if (!operation) {
      return unsupported("text-edit-source-compensation-anchor-not-found");
    }
    if (
      !isSameFingerprint(
        operation.fingerprint,
        movePatch.sourceProof?.operatorFingerprint
      )
    ) {
      return unsupported("text-edit-source-compensation-fingerprint-mismatch");
    }
  }

  const rewritten = rewriteContentStreamOperations({
    bytes,
    operations,
    patches: movePatches,
  });
  if (!rewritten.ok) {
    return rewritten;
  }
  const rewrittenBytes = rewritten.decodedBytes;
  const validation = validateRewrittenTextSourceMove(rewrittenBytes, plan);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    decodedBytes: rewrittenBytes,
    decodedString: bytesToString(rewrittenBytes),
    replacementRange: rewritten.patches[0]?.replacementRange,
    validation,
  };
}

export { rewriteTextSourceEdit, validateRewrittenBytes };
