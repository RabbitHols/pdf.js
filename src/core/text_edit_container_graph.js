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
  collectContentStreamOperations,
  tokenizeContentStream,
} from "./content_stream_tokenizer.js";
import { Dict, Name, Ref } from "./primitives.js";
import { BaseStream } from "./base_stream.js";

const PDF_EDIT_CONTAINER_GRAPH_KIND = "pdfjs-text-edit-container-graph";
const PDF_EDIT_CONTAINER_DESCRIPTOR_KIND =
  "pdfjs-text-edit-container-descriptor";
const PDF_EDIT_XOBJECT_FORM_TARGET_KIND = "pdfjs-text-edit-xobject-form-target";
const XOBJECT_FORM_REPLACE_STREAM_STRATEGY = "replace-xobject-form-stream";

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

function serializePdfEditContainerPathEntry(entry) {
  if (!entry?.type) {
    return null;
  }
  return {
    ...entry,
    type: String(entry.type),
    ref: serializeRef(entry.ref),
  };
}

function serializePdfEditContainerPath(containerPath) {
  if (!Array.isArray(containerPath)) {
    return null;
  }
  return containerPath.map(serializePdfEditContainerPathEntry);
}

function getSerializedRefKey(ref) {
  const serialized = serializeRef(ref);
  return serialized ? `${serialized.num} ${serialized.gen} R` : null;
}

function getXObjectFormReuseTargetKey({
  xObjectRef = null,
  xObjectName = null,
  streamRef = null,
} = {}) {
  return (
    getSerializedRefKey(streamRef) ||
    getSerializedRefKey(xObjectRef) ||
    (xObjectName ? `name:${xObjectName}` : null)
  );
}

function getPdfEditXObjectFormEditTargetFailure({
  containerPath,
  streamRef,
  reuse,
} = {}) {
  const nestedDepth = getPdfEditContainerPathTypeCount(
    containerPath,
    "xobject-form"
  );
  const aliasCount =
    typeof reuse?.aliasCount === "number" ? reuse.aliasCount : null;
  const totalCount =
    typeof reuse?.totalCount === "number" ? reuse.totalCount : null;
  if (nestedDepth > 1) {
    return "text-edit-nested-container-not-enabled";
  }
  if (!serializeRef(streamRef)) {
    return "text-edit-xobject-form-stream-ref-missing";
  }
  if (aliasCount !== null && aliasCount > 1) {
    return "text-edit-xobject-form-alias-unsupported";
  }
  if (reuse?.reused === true || (totalCount !== null && totalCount > 1)) {
    return "text-edit-xobject-form-reused";
  }
  if (reuse?.state !== "single-use") {
    return "text-edit-xobject-form-reuse-unknown";
  }
  return null;
}

function createXObjectFormEditTargetDescriptor({
  containerPath,
  xObjectName = null,
  streamRef = null,
  reuse = null,
} = {}) {
  const failureReason = getPdfEditXObjectFormEditTargetFailure({
    containerPath,
    streamRef,
    reuse,
  });
  return {
    kind: PDF_EDIT_XOBJECT_FORM_TARGET_KIND,
    strategy: XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
    enabled: false,
    eligible: !failureReason,
    reason: failureReason || "text-edit-xobject-form-not-enabled",
    failureReason,
    resourceName: xObjectName || null,
    streamRef: serializeRef(streamRef),
    nestedDepth: getPdfEditContainerPathTypeCount(
      containerPath,
      "xobject-form"
    ),
    reuse: reuse ? { ...reuse } : null,
  };
}

function serializePdfEditContainerDescriptor(descriptor) {
  if (!descriptor) {
    return null;
  }
  return {
    ...descriptor,
    containerPath: serializePdfEditContainerPath(descriptor.containerPath),
    streamRef: serializeRef(descriptor.streamRef),
    streamRefs: Array.isArray(descriptor.streamRefs)
      ? descriptor.streamRefs.map(serializeRef)
      : null,
  };
}

function isPdfEditContainerPathType(containerPath, type) {
  const expectedType = String(type || "").toLowerCase();
  return (containerPath || []).some(
    entry => String(entry?.type || "").toLowerCase() === expectedType
  );
}

function getPdfEditContainerPathTypeCount(containerPath, type) {
  const expectedType = String(type || "").toLowerCase();
  return (containerPath || []).filter(
    entry => String(entry?.type || "").toLowerCase() === expectedType
  ).length;
}

function getPdfEditContainerPathSubjectType(containerPath) {
  if (isPdfEditContainerPathType(containerPath, "form-field")) {
    return "form-field";
  }
  if (
    isPdfEditContainerPathType(containerPath, "annotation") ||
    isPdfEditContainerPathType(containerPath, "widget")
  ) {
    return "annotation";
  }
  if (isPdfEditContainerPathType(containerPath, "xobject-form")) {
    return "xobject-form";
  }
  return "page-content-text";
}

function pagePath(pageDict) {
  return [
    {
      type: "page",
      ref: serializeRef(Ref.fromString(pageDict?.objId || "")),
    },
  ];
}

function createAnnotationAppearanceContainerDescriptor({
  pageDict = null,
  pageRef = null,
  annotationRef,
  appearanceState = null,
  streamRef = null,
  targetKind = "annotation-appearance-stream",
  writableStrategy = "unsupported",
} = {}) {
  return {
    kind: PDF_EDIT_CONTAINER_DESCRIPTOR_KIND,
    containerPath: [
      {
        type: "page",
        ref:
          serializeRef(pageRef) ||
          serializeRef(Ref.fromString(pageDict?.objId || "")),
      },
      {
        type: "annotation",
        ref: serializeRef(annotationRef),
        ...(appearanceState ? { appearanceState } : null),
      },
    ],
    streamRef,
    streamRefs: null,
    contentsIndex: null,
    targetKind,
    writableStrategy,
  };
}

function createFormFieldAppearanceContainerDescriptor({
  pageDict = null,
  pageRef = null,
  fieldRef,
  widgetRef = null,
  appearanceState = null,
  streamRef = null,
  targetKind = "form-field-appearance-stream",
  writableStrategy = "unsupported",
} = {}) {
  return {
    kind: PDF_EDIT_CONTAINER_DESCRIPTOR_KIND,
    containerPath: [
      {
        type: "page",
        ref:
          serializeRef(pageRef) ||
          serializeRef(Ref.fromString(pageDict?.objId || "")),
      },
      {
        type: "form-field",
        ref: serializeRef(fieldRef),
      },
      {
        type: "widget",
        ref: serializeRef(widgetRef),
        ...(appearanceState ? { appearanceState } : null),
      },
    ],
    streamRef,
    streamRefs: null,
    contentsIndex: null,
    targetKind,
    writableStrategy,
  };
}

function createXObjectFormContainerDescriptor({
  parentDescriptor = null,
  pageDict = null,
  pageRef = null,
  xObjectRef,
  xObjectName = null,
  streamRef = null,
  targetKind = "xobject-form-stream",
  writableStrategy = "unsupported",
  reason = null,
  reuse = null,
} = {}) {
  const parentPath = serializePdfEditContainerPath(
    parentDescriptor?.containerPath
  ) || [
    {
      type: "page",
      ref:
        serializeRef(pageRef) ||
        serializeRef(Ref.fromString(pageDict?.objId || "")),
    },
  ];
  const containerPath = [
    ...parentPath,
    {
      type: "xobject-form",
      ref: serializeRef(xObjectRef),
      ...(xObjectName ? { name: xObjectName } : null),
    },
  ];
  const resolvedStreamRef = streamRef || xObjectRef || null;
  return {
    kind: PDF_EDIT_CONTAINER_DESCRIPTOR_KIND,
    containerPath,
    streamRef: resolvedStreamRef,
    streamRefs: null,
    contentsIndex: null,
    targetKind,
    writableStrategy,
    xObjectFormEditTarget: createXObjectFormEditTargetDescriptor({
      containerPath,
      xObjectName,
      streamRef: resolvedStreamRef,
      reuse,
    }),
    ...(reason ? { reason } : null),
    ...(reuse ? { reuse } : null),
  };
}

class PdfEditXObjectFormReuseTracker {
  #scope;

  #targets = new Map();

  #usageGraph;

  constructor({ scope = "page", usageGraph = null } = {}) {
    this.#scope = scope;
    this.#usageGraph = usageGraph;
  }

  registerFormInvocationTarget({
    xObjectRef = null,
    xObjectName = null,
    streamRef = null,
  } = {}) {
    const targetKey = getXObjectFormReuseTargetKey({
      xObjectRef,
      xObjectName,
      streamRef,
    });
    if (!targetKey) {
      return null;
    }
    let target = this.#targets.get(targetKey);
    if (!target) {
      target = {
        targetKey,
        targetRef: serializeRef(streamRef) || serializeRef(xObjectRef),
        names: new Set(),
        totalCount: 0,
        seenCount: 0,
      };
      this.#targets.set(targetKey, target);
    }
    if (xObjectName) {
      target.names.add(xObjectName);
    }
    target.totalCount++;
    return this.#serializeTarget(target);
  }

  beginFormInvocation({
    xObjectRef = null,
    xObjectName = null,
    streamRef = null,
  } = {}) {
    const targetKey = getXObjectFormReuseTargetKey({
      xObjectRef,
      xObjectName,
      streamRef,
    });
    if (!targetKey) {
      return {
        scope: this.#scope,
        state: "unknown",
        reused: null,
        invocationIndex: null,
        totalCount: null,
        targetRef: serializeRef(streamRef) || serializeRef(xObjectRef),
        targetName: xObjectName || null,
      };
    }
    let target = this.#targets.get(targetKey);
    if (!target) {
      target = {
        targetKey,
        targetRef: serializeRef(streamRef) || serializeRef(xObjectRef),
        names: new Set(),
        totalCount: 0,
        seenCount: 0,
      };
      this.#targets.set(targetKey, target);
    }
    if (xObjectName) {
      target.names.add(xObjectName);
    }
    target.seenCount++;
    const graphUsage = this.#usageGraph?.getFormTargetUsage({
      xObjectRef,
      xObjectName,
      streamRef,
    });
    let state = "unknown";
    const totalCount = graphUsage?.totalCount || target.totalCount;
    const aliasCount = graphUsage?.aliasCount || target.names.size;
    if (totalCount > 1 || aliasCount > 1) {
      state = "reused";
    } else if (totalCount === 1) {
      state = "single-use";
    }
    return {
      ...(graphUsage || this.#serializeTarget(target)),
      scope: graphUsage ? "document" : this.#scope,
      invocationIndex: target.seenCount,
      state,
      reused: totalCount > 1 || aliasCount > 1,
    };
  }

  #serializeTarget(target) {
    return {
      scope: this.#scope,
      targetKey: target.targetKey,
      targetRef: target.targetRef,
      names: Array.from(target.names).slice(0, 20),
      totalCount: target.totalCount || null,
    };
  }
}

class PdfEditXObjectFormUsageGraph {
  #targets = new Map();

  #ensureTarget({ xObjectRef = null, xObjectName = null, streamRef = null }) {
    const targetKey = getXObjectFormReuseTargetKey({
      xObjectRef,
      xObjectName,
      streamRef,
    });
    if (!targetKey) {
      return null;
    }
    let target = this.#targets.get(targetKey);
    if (!target) {
      target = {
        targetKey,
        targetRef: serializeRef(streamRef) || serializeRef(xObjectRef),
        names: new Set(),
        aliases: new Set(),
        pages: new Set(),
        totalCount: 0,
      };
      this.#targets.set(targetKey, target);
    }
    if (xObjectName) {
      target.names.add(xObjectName);
    }
    return target;
  }

  registerFormAlias({
    pageIndex = null,
    pageRef = null,
    xObjectRef = null,
    xObjectName = null,
    streamRef = null,
  } = {}) {
    const target = this.#ensureTarget({ xObjectRef, xObjectName, streamRef });
    if (!target) {
      return null;
    }
    target.aliases.add(
      `${Number.isInteger(pageIndex) ? pageIndex : "-"}:${xObjectName || "-"}`
    );
    if (Number.isInteger(pageIndex)) {
      target.pages.add(pageIndex);
    }
    return this.#serializeTarget(target, pageRef);
  }

  registerFormInvocation({
    pageIndex = null,
    pageRef = null,
    xObjectRef = null,
    xObjectName = null,
    streamRef = null,
  } = {}) {
    const target = this.#ensureTarget({ xObjectRef, xObjectName, streamRef });
    if (!target) {
      return null;
    }
    target.totalCount++;
    if (Number.isInteger(pageIndex)) {
      target.pages.add(pageIndex);
    }
    return this.#serializeTarget(target, pageRef);
  }

  getFormTargetUsage({
    xObjectRef = null,
    xObjectName = null,
    streamRef = null,
  } = {}) {
    const targetKey = getXObjectFormReuseTargetKey({
      xObjectRef,
      xObjectName,
      streamRef,
    });
    const target = targetKey ? this.#targets.get(targetKey) : null;
    return target ? this.#serializeTarget(target) : null;
  }

  #serializeTarget(target, pageRef = null) {
    const aliasCount = target.names.size;
    const totalCount = target.totalCount || null;
    return {
      scope: "document",
      targetKey: target.targetKey,
      targetRef: target.targetRef,
      names: Array.from(target.names).slice(0, 20),
      aliasCount,
      totalCount,
      pages: Array.from(target.pages).sort((a, b) => a - b),
      pageRef: serializeRef(pageRef),
      reused: (totalCount || 0) > 1 || aliasCount > 1,
    };
  }
}

function getXObjectResourceRawValue(xobjs, name) {
  if (typeof xobjs?.getRaw === "function") {
    return xobjs.getRaw(name);
  }
  if (typeof xobjs?.get === "function") {
    return xobjs.get(name);
  }
  return xobjs?.[name];
}

function getFormXObjectStream(rawXObject, xref) {
  let xObject = rawXObject;
  if (xObject instanceof Ref) {
    xObject = xref.fetch(xObject);
  }
  if (!(xObject instanceof BaseStream)) {
    return null;
  }
  const subtype = xObject.dict?.get("Subtype");
  return subtype instanceof Name && subtype.name === "Form" ? xObject : null;
}

function registerTextEditXObjectFormInvocations({
  graph,
  stream,
  resources,
  xref,
  pageIndex = null,
  pageRef = null,
}) {
  if (!graph || !stream) {
    return;
  }

  const xobjs =
    (typeof resources?.get === "function" ? resources.get("XObject") : null) ||
    resources?.XObject;
  if (!(xobjs instanceof Dict) && !xobjs) {
    return;
  }

  for (const [name, rawXObject] of xobjs.getRawEntries?.() || []) {
    const xObjectRef = rawXObject instanceof Ref ? rawXObject : null;
    let formStream = null;
    try {
      formStream = getFormXObjectStream(rawXObject, xref);
    } catch {
      continue;
    }
    if (!formStream) {
      continue;
    }
    graph.registerFormAlias({
      pageIndex,
      pageRef,
      xObjectRef,
      xObjectName: name,
      streamRef: xObjectRef || formStream.dict?.objId || null,
    });
  }

  let bytes;
  if (stream.bytes instanceof Uint8Array) {
    bytes = stream.bytes.subarray(stream.start, stream.end);
  } else {
    try {
      bytes = stream.getBytes();
    } catch {
      return;
    }
  }

  let operations;
  try {
    operations = collectContentStreamOperations(tokenizeContentStream(bytes));
  } catch {
    return;
  }

  for (const operation of operations) {
    if (operation.operatorName !== "Do") {
      continue;
    }
    const operand = operation.operands?.at(-1);
    if (operand?.type !== "name" || !operand.value) {
      continue;
    }
    const rawXObject = getXObjectResourceRawValue(xobjs, operand.value);
    const xObjectRef = rawXObject instanceof Ref ? rawXObject : null;
    let formStream = null;
    try {
      formStream = getFormXObjectStream(rawXObject, xref);
    } catch {
      continue;
    }
    if (!formStream) {
      continue;
    }
    graph.registerFormInvocation({
      pageIndex,
      pageRef,
      xObjectRef,
      xObjectName: operand.value,
      streamRef: xObjectRef || formStream.dict?.objId || null,
    });
  }
}

function unsupported(reason, descriptor = null, extra = null) {
  return {
    ok: false,
    reason,
    ...(descriptor ? { descriptor } : null),
    ...(extra || null),
  };
}

function createPageContentsDescriptor({
  pageDict,
  streamRef = null,
  streamRefs = null,
  contentsIndex = null,
  targetKind,
  writableStrategy,
  reason = null,
}) {
  return {
    kind: PDF_EDIT_CONTAINER_DESCRIPTOR_KIND,
    containerPath: pagePath(pageDict),
    streamRef,
    streamRefs,
    contentsIndex,
    targetKind,
    writableStrategy,
    ...(reason ? { reason } : null),
  };
}

function resolvePageContentStreamContainer(pageDict) {
  const contents = pageDict?.getRaw("Contents");
  if (contents instanceof Ref) {
    return {
      ok: true,
      kind: PDF_EDIT_CONTAINER_GRAPH_KIND,
      descriptor: createPageContentsDescriptor({
        pageDict,
        streamRef: contents,
        targetKind: "single-stream-ref",
        writableStrategy: "replace-stream",
      }),
    };
  }

  if (Array.isArray(contents)) {
    if (contents.length === 0) {
      const descriptor = createPageContentsDescriptor({
        pageDict,
        targetKind: "contents-array-empty",
        writableStrategy: "unsupported",
        reason: "text-edit-contents-array-empty",
      });
      return unsupported("text-edit-contents-array-empty", descriptor, {
        length: 0,
      });
    }

    if (contents.length === 1) {
      if (contents[0] instanceof Ref) {
        return {
          ok: true,
          kind: PDF_EDIT_CONTAINER_GRAPH_KIND,
          descriptor: createPageContentsDescriptor({
            pageDict,
            streamRef: contents[0],
            contentsIndex: 0,
            targetKind: "contents-array-single-stream-ref",
            writableStrategy: "replace-stream",
          }),
        };
      }
      const descriptor = createPageContentsDescriptor({
        pageDict,
        contentsIndex: 0,
        targetKind:
          contents[0] instanceof BaseStream
            ? "contents-array-single-direct-stream"
            : "contents-array-single-non-stream-ref",
        writableStrategy: "unsupported",
        reason: "text-edit-content-stream-ref-missing",
      });
      return unsupported("text-edit-content-stream-ref-missing", descriptor);
    }

    const streamRefs = contents.filter(entry => entry instanceof Ref);
    if (streamRefs.length === contents.length) {
      return {
        ok: true,
        kind: PDF_EDIT_CONTAINER_GRAPH_KIND,
        descriptor: createPageContentsDescriptor({
          pageDict,
          streamRefs,
          targetKind: "contents-array-multi-stream",
          writableStrategy: "coalesce-page-contents",
        }),
      };
    }
    const reason = "text-edit-contents-array-entry-not-stream-ref";
    const descriptor = createPageContentsDescriptor({
      pageDict,
      streamRefs,
      targetKind: "contents-array-multi-stream",
      writableStrategy: "unsupported",
      reason,
    });
    return unsupported(reason, descriptor, {
      length: contents.length,
      refCount: streamRefs.length,
    });
  }

  if (contents instanceof BaseStream) {
    const descriptor = createPageContentsDescriptor({
      pageDict,
      targetKind: "direct-stream",
      writableStrategy: "unsupported",
      reason: "text-edit-content-stream-ref-missing",
    });
    return unsupported("text-edit-content-stream-ref-missing", descriptor);
  }

  const descriptor = createPageContentsDescriptor({
    pageDict,
    targetKind: contents === undefined ? "missing" : "unsupported",
    writableStrategy: "unsupported",
    reason: "text-edit-content-stream-target-missing",
  });
  return unsupported("text-edit-content-stream-target-missing", descriptor);
}

export {
  createAnnotationAppearanceContainerDescriptor,
  createFormFieldAppearanceContainerDescriptor,
  createXObjectFormContainerDescriptor,
  createXObjectFormEditTargetDescriptor,
  getPdfEditContainerPathSubjectType,
  getPdfEditContainerPathTypeCount,
  getPdfEditXObjectFormEditTargetFailure,
  isPdfEditContainerPathType,
  PDF_EDIT_CONTAINER_DESCRIPTOR_KIND,
  PDF_EDIT_CONTAINER_GRAPH_KIND,
  PDF_EDIT_XOBJECT_FORM_TARGET_KIND,
  PdfEditXObjectFormReuseTracker,
  PdfEditXObjectFormUsageGraph,
  registerTextEditXObjectFormInvocations,
  resolvePageContentStreamContainer,
  serializePdfEditContainerDescriptor,
  serializePdfEditContainerPath,
  XOBJECT_FORM_REPLACE_STREAM_STRATEGY,
};
