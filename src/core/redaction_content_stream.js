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

import { rewriteRedactionContentStream } from "./redaction_rewriter.js";

const REDACTION_CONTENT_STREAM_PATCH_KIND = "pdfjs-redaction-content-stream";
const REDACTION_INCREMENTAL_SAVE_BLOCK_REASON =
  "redact-save-non-incremental-required";

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function validateRedactionSaveMode({ saveMode } = {}) {
  if (saveMode !== "sanitized-full-rewrite") {
    return unsupported(REDACTION_INCREMENTAL_SAVE_BLOCK_REASON, {
      requiredSaveMode: "sanitized-full-rewrite",
    });
  }
  return { ok: true };
}

function buildRedactionContentStreamPatch({
  decodedBytes,
  regions,
  fontBindings = null,
  container = null,
  saveMode = "incremental",
}) {
  const rewritten = rewriteRedactionContentStream({
    decodedBytes,
    regions,
    fontBindings,
  });
  if (!rewritten.ok) {
    return rewritten;
  }

  const saveValidation = validateRedactionSaveMode({ saveMode });
  if (!saveValidation.ok) {
    return {
      ...saveValidation,
      redaction: rewritten.report,
    };
  }

  return {
    ok: true,
    kind: REDACTION_CONTENT_STREAM_PATCH_KIND,
    container,
    decodedBytes: rewritten.decodedBytes,
    redaction: rewritten.report,
  };
}

export {
  buildRedactionContentStreamPatch,
  REDACTION_CONTENT_STREAM_PATCH_KIND,
  REDACTION_INCREMENTAL_SAVE_BLOCK_REASON,
  validateRedactionSaveMode,
};
