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

import { AppOptions, OptionKind } from "./app_options.js";
import {
  buildNativeTextEditBlocks,
  getNativeTextEditBlockForTextDiv,
} from "./native_text_edit_block_builder.js";
import {
  captureNativeTextEditOverlayPreviewSurface,
  captureNativeTextEditPagePreviewSurface,
} from "./native_text_edit_surface.js";
import {
  getCanvasPixelRectForClientRect,
  getCanvasPixelRectForElement,
  getClientRectForBlockCandidate,
  getClientRectForElements,
} from "./native_text_edit_geometry.js";
import { getDocument, MathClamp } from "pdfjs-lib";
import {
  getNativeTextEditLineCandidate,
  isNativeTextEditLineCandidateInteractive,
} from "./native_text_edit_line_candidate.js";

function clonePdfBytes(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes.slice();
  }
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }
  return new Uint8Array(bytes);
}

function getClientRectForTextDivs(textDivs) {
  return getClientRectForElements(textDivs);
}

function getBlockClientRect(blockCandidate) {
  return getClientRectForBlockCandidate(blockCandidate);
}

function shouldRenderNativeTextEditBlockMarker(blockCandidate) {
  return isNativeTextEditLineCandidateInteractive(blockCandidate);
}

function isNativeTextEditBlockInteractive(blockCandidate) {
  return shouldRenderNativeTextEditBlockMarker(blockCandidate);
}

function isNativeTextEditBlockSupported(blockCandidate) {
  return (
    blockCandidate?.editable !== false &&
    blockCandidate?.editPolicy?.supported !== false
  );
}

function getSourceText(source) {
  if (source?.grouped === true && typeof source.sourceText === "string") {
    return source.sourceText;
  }
  if (source?.grouped === true && Array.isArray(source.sources)) {
    let text = "";
    for (const entry of source.sources) {
      const sourceText = getSourceText(entry);
      if (typeof sourceText !== "string") {
        return null;
      }
      text += sourceText;
    }
    return text;
  }

  const segments = source?.segments;
  if (!Array.isArray(segments)) {
    return null;
  }

  const textSegments = segments.filter(segment => segment.kind === "text");
  if (textSegments.length === 0) {
    return null;
  }

  if (source.operatorName === "Tj") {
    if (textSegments.length !== 1 || textSegments.length !== segments.length) {
      return null;
    }
  } else if (
    source.operatorName !== "TJ" ||
    segments.some(
      segment => segment.kind !== "text" && segment.kind !== "spacing"
    )
  ) {
    return null;
  }

  return textSegments
    .map(segment => segment.text ?? segment.byteString ?? "")
    .join("");
}

function getTextDivStyle(textDiv) {
  const view = textDiv?.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle === "function") {
    return view.getComputedStyle(textDiv);
  }
  return textDiv?.style || null;
}

function getTextEditSourceEntries(source) {
  if (source?.grouped === true && Array.isArray(source.sources)) {
    return source.sources.flatMap(getTextEditSourceEntries);
  }
  return source ? [source] : [];
}

function collectTextEditSourceValues(source, getter) {
  const values = [];
  const seen = new Set();
  for (const entry of getTextEditSourceEntries(source)) {
    const value = getter(entry);
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const normalized = String(value);
    if (!seen.has(normalized)) {
      values.push(normalized);
      seen.add(normalized);
    }
  }
  return values;
}

function formatTextEditSourceValue(source, getter) {
  const values = collectTextEditSourceValues(source, getter);
  if (values.length === 0) {
    return null;
  }
  return values.length === 1 ? values[0] : `mixed (${values.join(", ")})`;
}

function formatTextEditColor(value) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (!Array.isArray(value) && !(value instanceof Uint8ClampedArray)) {
    return null;
  }
  const components = Array.from(value).slice(0, 3);
  if (
    components.length < 3 ||
    !components.every(component => Number.isFinite(component))
  ) {
    return null;
  }
  const scale = components.every(component => component >= 0 && component <= 1)
    ? 255
    : 1;
  const [r, g, b] = components.map(component =>
    MathClamp(Math.round(component * scale), 0, 255)
  );
  return `rgb(${r}, ${g}, ${b})`;
}

function getTextEditFillColor(source) {
  return formatTextEditSourceValue(source, entry =>
    formatTextEditColor(
      entry.fillColorHex ||
        entry.fillColor ||
        entry.color ||
        entry.textState?.fillColorHex ||
        entry.textState?.fillColor ||
        entry.textState?.fillRGBColor
    )
  );
}

function getNativeTextEditFontSize({ block, source, textDiv }) {
  const sourceFontSize = formatTextEditSourceValue(
    source,
    entry => entry.fontSize ?? entry.textState?.fontSize ?? entry.font?.fontSize
  );
  if (sourceFontSize) {
    return `${sourceFontSize}px`;
  }

  const blockFontSize = block?.lines?.find(
    line => typeof line?.fontSize === "number" && line.fontSize > 0
  )?.fontSize;
  if (blockFontSize) {
    return `${blockFontSize}px`;
  }

  const styleFontSize = Number.parseFloat(getTextDivStyle(textDiv)?.fontSize);
  return Number.isFinite(styleFontSize) && styleFontSize > 0
    ? `${styleFontSize}px`
    : null;
}

function inferNativeTextEditStyle({ source, textDiv }) {
  const style = getTextDivStyle(textDiv);
  const styleParts = [
    style?.fontFamily,
    style?.fontStyle,
    style?.fontWeight,
    ...collectTextEditSourceValues(
      source,
      entry =>
        entry.fontName ||
        entry.fontLoadedName ||
        entry.textState?.fontName ||
        entry.textState?.fontLoadedName ||
        entry.font?.name ||
        entry.font?.loadedName
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!styleParts) {
    return null;
  }

  const isBold =
    /\b(bold|black|heavy|demi|semibold|semi-bold|extrabold|extra-bold)\b/.test(
      styleParts
    ) || Number.parseInt(style?.fontWeight, 10) >= 600;
  const isItalic = /\b(italic|oblique)\b/.test(styleParts);
  if (isBold && isItalic) {
    return "Bold Italic";
  }
  if (isBold) {
    return "Bold";
  }
  if (isItalic) {
    return "Italic";
  }
  return "Regular";
}

function getTextEditContainerLabel(container) {
  const subjectType = getNativeTextEditContainerSubjectType(container);
  const targetKind = container?.targetKind;
  if (subjectType && targetKind && subjectType !== targetKind) {
    return `${subjectType} (${targetKind})`;
  }
  return subjectType || targetKind || null;
}

function buildNativeTextEditInfoTooltip({ block = null, source, textDiv }) {
  const unavailable = "unavailable";
  const sourceText = getSourceText(source);
  const fontFamily =
    getTextDivStyle(textDiv)?.fontFamily ||
    formatTextEditSourceValue(
      source,
      entry => entry.fontFamily || entry.font?.fallbackName
    );
  const fontName = formatTextEditSourceValue(
    source,
    entry => entry.fontName || entry.textState?.fontName || entry.font?.fontName
  );
  const loadedName = formatTextEditSourceValue(
    source,
    entry =>
      entry.fontLoadedName ||
      entry.loadedName ||
      entry.textState?.fontLoadedName ||
      entry.font?.loadedName
  );
  const operator = formatTextEditSourceValue(source, entry =>
    entry.operatorName
      ? `${entry.operatorName}${
          Number.isInteger(entry.operatorIndex)
            ? ` #${entry.operatorIndex}`
            : ""
        }`
      : null
  );
  const container = getTextEditContainerLabel(source?.container);
  const lines = [
    "Native text info",
    `Font family: ${fontFamily || unavailable}`,
    `Font name: ${fontName || unavailable}`,
    `Loaded font: ${loadedName || unavailable}`,
    `Font size: ${
      getNativeTextEditFontSize({ block, source, textDiv }) || unavailable
    }`,
    `Color: ${getTextEditFillColor(source) || unavailable}`,
    `Style: ${inferNativeTextEditStyle({ source, textDiv }) || unavailable}`,
  ];
  if (sourceText) {
    lines.push(
      `Source text: ${
        sourceText.length > 80 ? `${sourceText.slice(0, 77)}...` : sourceText
      }`
    );
  }
  if (operator) {
    lines.push(`PDF operator: ${operator}`);
  }
  if (container) {
    lines.push(`Container: ${container}`);
  }
  if (source?.container?.writableStrategy) {
    lines.push(`Writable strategy: ${source.container.writableStrategy}`);
  }
  lines.push(
    block?.lines?.length > 1
      ? "Click to edit existing PDF text block"
      : "Click to edit existing PDF text"
  );
  return lines.join("\n");
}

function getNativeTextEditUnsupportedSummary(result) {
  return (
    result?.unsupported ||
    result?.editSubject?.unsupported ||
    result?.contentStreamPatch?.unsupported ||
    result?.contentStreamPatch?.plan?.editSubject?.unsupported ||
    result?.xObjectFormStreamPatch?.unsupported ||
    result?.xObjectFormStreamPatch?.plan?.editSubject?.unsupported ||
    result?.linePlan?.unsupported ||
    result?.linePlan?.editSubject?.unsupported ||
    null
  );
}

function getNativeTextEditContainerSubjectType(container) {
  const path = container?.containerPath;
  if (!Array.isArray(path)) {
    return null;
  }
  if (path.some(entry => entry?.type === "xobject-form")) {
    return "xobject-form";
  }
  if (
    path.some(entry => entry?.type === "annotation" || entry?.type === "widget")
  ) {
    return "annotation";
  }
  if (path.some(entry => entry?.type === "form-field")) {
    return "form-field";
  }
  return "page-content-text";
}

function getNativeTextEditContainerSummary(container) {
  if (!container) {
    return null;
  }
  const target = container.xObjectFormEditTarget || null;
  return {
    targetKind: container.targetKind || null,
    reason: container.reason || target?.reason || null,
    writableStrategy: container.writableStrategy || null,
    reuse: container.reuse || target?.reuse || null,
    xObjectFormEditTarget: target
      ? {
          eligible: target.eligible === true,
          enabled: target.enabled === true,
          failureReason: target.failureReason || null,
          strategy: target.strategy || null,
          nestedDepth: Number.isInteger(target.nestedDepth)
            ? target.nestedDepth
            : null,
        }
      : null,
  };
}

function getNativeTextEditSourceUnsupportedSummary(source) {
  if (source?.editable !== false) {
    return null;
  }
  const container = source.container || null;
  return {
    ok: false,
    proofName: "textEditSourceContainerProof",
    reason:
      source.reason || container?.reason || "text-edit-source-not-editable",
    strategy: "blocked",
    subjectType: getNativeTextEditContainerSubjectType(container),
    targetKind: container?.targetKind || null,
    containerSummary: getNativeTextEditContainerSummary(container),
    container,
  };
}

function isNativeTextEditXObjectFormValidationAnchor(source) {
  const target = source?.container?.xObjectFormEditTarget;
  return (
    source?.container?.targetKind === "xobject-form-stream" &&
    target?.strategy === "replace-xobject-form-stream" &&
    target.eligible === true &&
    target.failureReason === null
  );
}

function isNativeTextEditSourceNormalUiEditable(source) {
  return (
    source?.editable === true ||
    isNativeTextEditXObjectFormValidationAnchor(source)
  );
}

function getNativeTextEditXObjectFormTargetStatus(source) {
  const containerSummary = getNativeTextEditContainerSummary(source?.container);
  const target = containerSummary?.xObjectFormEditTarget || null;
  const targetKind = containerSummary?.targetKind || null;
  const isXObjectForm = targetKind === "xobject-form-stream";
  const devCommitEligible = isNativeTextEditXObjectFormValidationAnchor(source);
  const normalUiEditable = isNativeTextEditSourceNormalUiEditable(source);
  let reason = null;
  if (!source) {
    reason = "pdfjs-native-text-edit-source-missing";
  } else if (!isXObjectForm) {
    reason = "pdfjs-native-text-edit-target-not-xobject-form";
  } else if (normalUiEditable) {
    reason = "pdfjs-native-text-edit-xobject-form-ui-editable";
  } else if (devCommitEligible) {
    reason = "pdfjs-native-text-edit-xobject-form-dev-commit-eligible";
  } else {
    reason =
      target?.failureReason ||
      containerSummary?.reason ||
      source.reason ||
      "pdfjs-native-text-edit-xobject-form-target-not-eligible";
  }
  return {
    ok: !!source,
    reason,
    subjectType: getNativeTextEditContainerSubjectType(
      source?.container || null
    ),
    targetKind,
    normalUiEditable,
    devCommitEligible,
    containerSummary,
    xObjectFormEditTarget: target,
    debugCommand: devCommitEligible
      ? 'PDFJSNativeTextEditDebug.commitSelectedXObjectFormEdit("replacement")'
      : null,
  };
}

function isNativeTextEditReplacementAnchorEditable(
  item,
  { allowXObjectFormReplacementAnchor = false } = {}
) {
  const source = item?.textEditSource;
  return (
    isNativeTextEditSourceNormalUiEditable(source) ||
    (allowXObjectFormReplacementAnchor === true &&
      isNativeTextEditXObjectFormValidationAnchor(source))
  );
}

function clearNativeTextEditXObjectFormDataset(textDiv) {
  delete textDiv.dataset.pdfjsNativeTextEditTargetKind;
  delete textDiv.dataset.pdfjsNativeTextEditXObjectFormEligible;
  delete textDiv.dataset.pdfjsNativeTextEditXObjectFormEnabled;
  delete textDiv.dataset.pdfjsNativeTextEditXObjectFormFailureReason;
  delete textDiv.dataset.pdfjsNativeTextEditXObjectFormNestedDepth;
  delete textDiv.dataset.pdfjsNativeTextEditXObjectFormStrategy;
}

function applyNativeTextEditXObjectFormDataset(textDiv, unsupportedSummary) {
  clearNativeTextEditXObjectFormDataset(textDiv);
  const summary = unsupportedSummary?.containerSummary;
  const target = summary?.xObjectFormEditTarget;
  if (!target || summary.targetKind !== "xobject-form-stream") {
    return;
  }
  textDiv.dataset.pdfjsNativeTextEditTargetKind = summary.targetKind;
  textDiv.dataset.pdfjsNativeTextEditXObjectFormEligible = String(
    target.eligible === true
  );
  textDiv.dataset.pdfjsNativeTextEditXObjectFormEnabled = String(
    target.enabled === true
  );
  if (target.failureReason) {
    textDiv.dataset.pdfjsNativeTextEditXObjectFormFailureReason =
      target.failureReason;
  }
  if (target.strategy) {
    textDiv.dataset.pdfjsNativeTextEditXObjectFormStrategy = target.strategy;
  }
  if (Number.isInteger(target.nestedDepth)) {
    textDiv.dataset.pdfjsNativeTextEditXObjectFormNestedDepth = String(
      target.nestedDepth
    );
  }
}

function shouldKeepRejectedReplacementInInput(result) {
  return result?.reason === "text-edit-whitespace-user-space-unsupported";
}

function canPreviewWithContentStreamPatch(patches) {
  return (
    patches?.length === 1 &&
    patches[0]?.kind === "pdfjs-text-edit-content-stream-patch"
  );
}

function normalizeCanvasPixelRect(rect, canvas, padding = 0) {
  if (!rect || !canvas) {
    return null;
  }

  const x = Math.floor((Number(rect.x) || 0) - padding);
  const y = Math.floor((Number(rect.y) || 0) - padding);
  const right = Math.ceil(
    (Number(rect.x) || 0) + (Number(rect.width) || 0) + padding
  );
  const bottom = Math.ceil(
    (Number(rect.y) || 0) + (Number(rect.height) || 0) + padding
  );
  const clampedX = Math.max(0, x);
  const clampedY = Math.max(0, y);
  const clampedRight = Math.min(canvas.width, right);
  const clampedBottom = Math.min(canvas.height, bottom);
  if (clampedRight <= clampedX || clampedBottom <= clampedY) {
    return null;
  }
  return {
    x: clampedX,
    y: clampedY,
    width: clampedRight - clampedX,
    height: clampedBottom - clampedY,
  };
}

function unionCanvasPixelRects(rects, canvas, padding = 0) {
  const usableRects = (rects || [])
    .map(rect => normalizeCanvasPixelRect(rect, canvas, padding))
    .filter(rect => rect?.width && rect?.height);
  if (!usableRects.length) {
    return null;
  }

  const x = Math.min(...usableRects.map(rect => rect.x));
  const y = Math.min(...usableRects.map(rect => rect.y));
  const right = Math.max(...usableRects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...usableRects.map(rect => rect.y + rect.height));
  return normalizeCanvasPixelRect(
    {
      x,
      y,
      width: right - x,
      height: bottom - y,
    },
    canvas
  );
}

function summarizeNativeTextEditValue(value, depth = 0) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return {
      kind: "Uint8Array",
      length: value.length,
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      kind: "ArrayBuffer",
      byteLength: value.byteLength,
    };
  }
  if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) {
    return {
      kind: "HTMLElement",
      className: value.className || "",
      id: value.id || "",
      tagName: value.tagName,
      textContent: value.textContent || "",
    };
  }
  if (depth >= 5) {
    return Array.isArray(value) ? "[Array]" : "[Object]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .map(entry => summarizeNativeTextEditValue(entry, depth + 1));
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "decodedBytes" ||
      key === "lastBytes" ||
      key === "stream" ||
      key === "canvas" ||
      key === "context" ||
      key === "originalImageData" ||
      key === "pdfDocument" ||
      key === "pdfPage"
    ) {
      output[key] = summarizeNativeTextEditValue(entry, depth + 1);
      continue;
    }
    output[key] = summarizeNativeTextEditValue(entry, depth + 1);
  }
  return output;
}

function normalizeBlockReplacementText(text) {
  return (text || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

const DEFAULT_NATIVE_TEXT_EDIT_LIVE_PREVIEW_DELAY = 24;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}

function getLinePreservingBlockReplacements(blockCandidate, replacementText) {
  const lines = blockCandidate?.lines;
  if (!Array.isArray(lines) || lines.length < 2) {
    return {
      ok: false,
      reason: "text-edit-block-candidate-missing",
    };
  }

  const replacementLines =
    normalizeBlockReplacementText(replacementText).split("\n");
  if (replacementLines.length !== lines.length) {
    return {
      ok: false,
      reason: "text-edit-block-line-count-mismatch",
      lineCount: lines.length,
      replacementLineCount: replacementLines.length,
    };
  }

  return {
    ok: true,
    lines: lines.map((line, index) => ({
      line,
      replacementText: replacementLines[index],
    })),
  };
}

function getPatchGroupKey(patch) {
  if (patch.writableStrategy === "coalesce-page-contents") {
    return [
      patch.writableStrategy,
      `${patch.pageRef?.num}:${patch.pageRef?.gen}`,
      ...(patch.streamRefs || []).map(ref => `${ref?.num}:${ref?.gen}`),
    ].join("|");
  }
  return [
    patch.writableStrategy || "replace-stream",
    `${patch.ref?.num}:${patch.ref?.gen}`,
  ].join("|");
}

function getPlanPatchesForContentStreamPatch(contentStreamPatch) {
  const plan = contentStreamPatch?.plan;
  if (!plan?.ok) {
    return null;
  }
  if (Array.isArray(plan.patches)) {
    return plan.patches;
  }
  if (plan.patch) {
    return [
      {
        ...plan.patch,
        sourceProof: plan.sourceProof,
      },
    ];
  }
  return null;
}

function combineLinePreservingBlockContentStreamPatches(contentStreamPatches) {
  const groups = new Map();
  for (const patch of contentStreamPatches || []) {
    if (!patch?.ok || !patch.contentStreamPatch?.ok) {
      return {
        ok: false,
        reason: "text-edit-block-content-stream-patch-missing",
        patchReason: patch?.contentStreamPatch?.reason || patch?.reason || null,
      };
    }
    const contentStreamPatch = patch.contentStreamPatch;
    const key = getPatchGroupKey(contentStreamPatch);
    const group = groups.get(key) || [];
    group.push(contentStreamPatch);
    groups.set(key, group);
  }

  const patches = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      patches.push(group[0]);
      continue;
    }

    const flatPatches = [];
    for (const contentStreamPatch of group) {
      const planPatches =
        getPlanPatchesForContentStreamPatch(contentStreamPatch);
      if (!planPatches?.length) {
        return {
          ok: false,
          reason: "text-edit-block-plan-patch-unsupported",
        };
      }
      flatPatches.push(...planPatches);
    }

    const first = group[0];
    const firstPlan = first.plan;
    patches.push({
      ...first,
      blockPatchCount: group.length,
      decodedBytes: null,
      decodedString: null,
      validation: null,
      plan: {
        ok: true,
        kind: firstPlan.kind,
        editGeneration: firstPlan.editGeneration ?? null,
        grouped: true,
        blockLinePreserving: true,
        replacementText: flatPatches
          .map(patch => patch.replacementByteString || "")
          .join(""),
        container: null,
        sourceProof: {
          operatorCount: flatPatches.length,
          blockPatchCount: group.length,
          sourceTextMatches: true,
        },
        fontProof: {
          encodable: true,
          encodedByteLength: flatPatches.reduce(
            (sum, patch) => sum + (patch.replacementByteString || "").length,
            0
          ),
        },
        patch: flatPatches[0],
        patches: flatPatches,
      },
    });
  }
  return {
    ok: true,
    patches,
  };
}

class NativeTextEditService {
  constructor(app) {
    this.app = app;
    this.enabled = false;
    this.visualEditing = false;
    this.visualOptions = {
      commitOnBlur: false,
      download: false,
      livePreview: true,
      livePreviewDelay: DEFAULT_NATIVE_TEXT_EDIT_LIVE_PREVIEW_DELAY,
      liveValidate: false,
      pageNumber: null,
      previewRect: true,
      reopen: false,
      validate: true,
    };
    this.visualAbortController = null;
    this.activeVisualEdit = null;
    this.currentLoadingTask = null;
    this.currentPdfDocument = null;
    this.patches = [];
    this.lastBytes = null;
    this.lastPlan = null;
    this.lastPreview = null;
    this.lastReplacementText = null;
    this.lastError = null;
    this.lastUnsupported = null;
    this.lastTextEditHit = null;
    this.lastValidation = null;
    this.lastDraftBytes = null;
    this.lastDraftPlan = null;
    this.lastDraftPatches = null;
    this.lastDraftReplacementText = null;
    this.lastDraftGeneration = null;
    this.lastDraftValidation = null;
    this.lastDraftError = null;
    this.lastDraftTiming = null;
    this.textEditBlocks = new Map();
    this.hoveredBlockMarker = null;
    this.hoveredInfoIcon = null;

    this.#controllerServices = {
      getPageViewForTextDiv: textDiv => this.getPageViewForTextDiv(textDiv),
      layout: params => this.layout(params),
      onCancel: () => this.cancelVisualEdit(),
      onCommit: textDiv =>
        this.commitVisualEdit(textDiv).catch(reason =>
          console.error("PDFJSNativeTextEditDebug.commitVisualEdit:", reason)
        ),
      onInput: state => {
        if (state.options.livePreview !== false) {
          this.scheduleVisualEditPreview(state);
        }
      },
      onMoveCommit: (state, delta) => this.commitVisualMove(state, delta),
    };
  }

  #controllerServices = null;

  get visualEditController() {
    return this.app.ensureNativeTextEditController(this.#controllerServices);
  }

  getPageView(pageNumber = this.app.pdfViewer?.currentPageNumber || 1) {
    return this.app.pdfViewer?.getPageView(pageNumber - 1) || null;
  }

  getPageViewForTextDiv(textDiv) {
    const pageNumber = Number(textDiv?.closest?.(".page")?.dataset.pageNumber);
    return Number.isInteger(pageNumber) ? this.getPageView(pageNumber) : null;
  }

  getTextDivFromNode(node) {
    const element =
      node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return element?.closest?.("span[role='presentation']") || null;
  }

  getTextDivFromEvent(event) {
    const targetTextDiv = this.getTextDivFromNode(event?.target);
    if (targetTextDiv) {
      return targetTextDiv;
    }
    if (
      typeof document === "undefined" ||
      typeof document.elementsFromPoint !== "function" ||
      typeof event?.clientX !== "number" ||
      typeof event?.clientY !== "number"
    ) {
      return null;
    }
    for (const element of document.elementsFromPoint(
      event.clientX,
      event.clientY
    )) {
      const textDiv = this.getTextDivFromNode(element);
      if (textDiv) {
        return textDiv;
      }
    }
    return null;
  }

  getInfoIconFromNode(node) {
    const element =
      node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return (
      element?.closest?.("[data-pdfjs-native-text-edit-info-icon]") || null
    );
  }

  getInfoIconFromEvent(event) {
    return this.getInfoIconFromNode(event?.target);
  }

  getBlockForInfoIcon(infoIcon) {
    const blockId = infoIcon?.dataset?.pdfjsNativeTextEditBlock;
    if (!blockId) {
      return null;
    }
    const pageNumber = Number(infoIcon.dataset.pdfjsNativeTextEditPage);
    return (
      this.getBlocks(
        Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined
      ).find(block => block.blockId === blockId) || null
    );
  }

  getHoveredInfoBridgeBlock(event) {
    if (
      !this.hoveredBlockMarker ||
      !this.hoveredInfoIcon ||
      typeof event?.clientX !== "number" ||
      typeof event?.clientY !== "number"
    ) {
      return null;
    }
    const markerRect = this.hoveredBlockMarker.getBoundingClientRect?.();
    const iconRect = this.hoveredInfoIcon.getBoundingClientRect?.();
    if (!markerRect || !iconRect) {
      return null;
    }

    const padding = 8;
    const left = Math.min(markerRect.left, iconRect.left) - padding;
    const top = Math.min(markerRect.top, iconRect.top) - padding;
    const right = Math.max(markerRect.right, iconRect.right) + padding;
    const bottom = Math.max(markerRect.bottom, iconRect.bottom) + padding;
    if (
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom
    ) {
      return null;
    }
    return this.getBlockForInfoIcon(this.hoveredInfoIcon);
  }

  getSelectedTextDiv() {
    return this.getTextDivFromNode(window.getSelection()?.anchorNode);
  }

  isVisualEditTextDiv(textDiv) {
    return (
      this.getPageViewForTextDiv(textDiv)?.id === this.visualOptions.pageNumber
    );
  }

  getTextDivsInPage(pageNumber) {
    return [
      ...(this.getPageView(pageNumber)?.textLayer?.div?.querySelectorAll(
        "span[role='presentation']"
      ) || []),
    ];
  }

  enable({ refresh = true, pageNumber = null } = {}) {
    this.enabled = true;
    if (refresh) {
      if (pageNumber) {
        this.refreshPageTextLayer(pageNumber);
      } else {
        this.refreshTextLayers();
      }
    }
    return this;
  }

  clear() {
    this.patches.length = 0;
    this.lastBytes = null;
    this.lastPlan = null;
    this.lastPreview = null;
    this.lastReplacementText = null;
    this.lastError = null;
    this.lastUnsupported = null;
    this.lastTextEditHit = null;
    this.lastValidation = null;
    this.clearDraftState();
  }

  clearDraftState() {
    this.lastDraftBytes = null;
    this.lastDraftPlan = null;
    this.lastDraftPatches = null;
    this.lastDraftReplacementText = null;
    this.lastDraftGeneration = null;
    this.lastDraftValidation = null;
    this.lastDraftError = null;
    this.lastDraftTiming = null;
  }

  recordDiagnostic(result, stage) {
    const reason =
      result instanceof Error
        ? result.message
        : result?.reason || String(result);
    this.lastError = {
      ok: false,
      reason,
      stage,
    };
    const unsupportedSummary = getNativeTextEditUnsupportedSummary(result);
    if (unsupportedSummary?.ok === false) {
      this.lastUnsupported = {
        ...unsupportedSummary,
        stage,
      };
      this.lastError.unsupported = this.lastUnsupported;
    }
    return result;
  }

  describeTextEditHit(textDiv, stage = "hit") {
    const source = textDiv ? this.getSource(textDiv) : null;
    const unsupported = getNativeTextEditSourceUnsupportedSummary(source);
    const container = source?.container || null;
    return {
      ok: !!source && source.editable !== false,
      stage,
      pageNumber:
        this.getPageViewForTextDiv(textDiv)?.id ||
        this.app?.pdfViewer?.currentPageNumber ||
        null,
      text: textDiv?.textContent || "",
      reason:
        unsupported?.reason ||
        (!source ? "pdfjs-native-text-edit-source-missing" : null),
      unsupported,
      textEditSource: source,
      container,
      containerSummary: getNativeTextEditContainerSummary(container),
    };
  }

  recordTextEditHit(textDiv, stage = "hit") {
    const hit = this.describeTextEditHit(textDiv, stage);
    this.lastTextEditHit = hit;
    if (hit.unsupported?.ok === false) {
      this.lastUnsupported = {
        ...hit.unsupported,
        stage,
      };
      this.lastError = {
        ok: false,
        reason: hit.unsupported.reason,
        stage,
        unsupported: this.lastUnsupported,
      };
    }
    return hit;
  }

  getSelectedTextEditHit() {
    const textDiv =
      typeof window !== "undefined" ? this.getSelectedTextDiv() : null;
    return textDiv ? this.describeTextEditHit(textDiv, "selection") : null;
  }

  describeXObjectFormEditTarget(textDiv = this.getSelectedTextDiv()) {
    const hit = this.describeTextEditHit(textDiv, "xobject-form-target");
    const status = getNativeTextEditXObjectFormTargetStatus(hit.textEditSource);
    return {
      ...status,
      pageNumber: hit.pageNumber,
      text: hit.text,
      hit,
    };
  }

  describeSelectedXObjectFormEditTarget() {
    let textDiv = null;
    try {
      textDiv = this.getSelectedTextDiv();
    } catch {}
    if (!textDiv) {
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-selection-missing",
        normalUiEditable: false,
        devCommitEligible: false,
        debugCommand: null,
      };
    }
    return this.describeXObjectFormEditTarget(textDiv);
  }

  recordDraftDiagnostic(
    result,
    stage,
    generation = null,
    replacementText = null
  ) {
    const reason =
      result instanceof Error
        ? result.message
        : result?.reason || String(result);
    this.lastDraftError = {
      ok: false,
      reason,
      stage,
      generation,
      replacementText,
    };
    return this.lastDraftError;
  }

  promoteDraftState({
    bytes,
    generation,
    patches,
    plan,
    replacementText,
    validation = null,
    timing = null,
  }) {
    this.lastDraftBytes = clonePdfBytes(bytes);
    this.lastDraftPlan = plan;
    this.lastDraftPatches = patches?.slice() || null;
    this.lastDraftReplacementText = replacementText;
    this.lastDraftGeneration = generation;
    this.lastDraftValidation = validation;
    this.lastDraftError = null;
    this.lastDraftTiming = timing;
    this.lastError = null;
    return this.lastDraftBytes;
  }

  getLastDraftCommitStatus(state, replacementText) {
    if (!this.lastDraftBytes || !this.lastDraftPatches?.length) {
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-draft-missing",
      };
    }
    if (this.lastDraftReplacementText !== replacementText) {
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-draft-stale",
        draftReplacementText: this.lastDraftReplacementText,
        replacementText,
      };
    }
    if (
      state &&
      this.lastDraftGeneration !== null &&
      this.lastDraftGeneration !== state.previewGeneration
    ) {
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-draft-stale",
        draftGeneration: this.lastDraftGeneration,
        generation: state.previewGeneration,
      };
    }
    if (this.lastDraftValidation && !this.lastDraftValidation.ok) {
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-draft-not-committable",
        validation: this.lastDraftValidation,
      };
    }
    return {
      ok: true,
      bytes: this.lastDraftBytes,
      patches: this.lastDraftPatches,
      plan: this.lastDraftPlan,
      validation: this.lastDraftValidation,
    };
  }

  getDebugSnapshot({
    includeActiveEdit = true,
    includePatches = true,
    includePlan = true,
  } = {}) {
    return summarizeNativeTextEditValue({
      kind: "PdfjsNativeTextEditDebugSnapshot",
      timestamp: new Date().toISOString(),
      enabled: this.enabled,
      pageNumber: this.app?.pdfViewer?.currentPageNumber || null,
      visualEditing: this.visualEditing,
      visualOptions: this.visualOptions,
      lastError: this.lastError,
      lastUnsupported: this.lastUnsupported,
      lastTextEditHit: this.lastTextEditHit,
      selectedTextEditHit: this.getSelectedTextEditHit(),
      lastReplacementText: this.lastReplacementText,
      lastValidation: this.lastValidation,
      lastPreview: this.lastPreview,
      lastDraftBytes: this.lastDraftBytes,
      lastDraftPlan: this.lastDraftPlan,
      lastDraftPatches: this.lastDraftPatches,
      lastDraftReplacementText: this.lastDraftReplacementText,
      lastDraftGeneration: this.lastDraftGeneration,
      lastDraftValidation: this.lastDraftValidation,
      lastDraftError: this.lastDraftError,
      lastDraftTiming: this.lastDraftTiming,
      committable: this.getLastDraftCommitStatus(
        this.activeVisualEdit,
        this.activeVisualEdit?.replacementText
      ).ok,
      ...(includePlan ? { lastPlan: this.lastPlan } : null),
      ...(includePatches ? { patches: this.patches } : null),
      ...(includeActiveEdit
        ? {
            activeVisualEdit: this.activeVisualEdit,
          }
        : null),
    });
  }

  getCurrentPdfDocument() {
    return this.currentPdfDocument || this.app.pdfDocument;
  }

  hasCommittedBytes() {
    return !!this.lastBytes;
  }

  getCommittedBytes() {
    return this.lastBytes ? clonePdfBytes(this.lastBytes) : null;
  }

  async destroyCurrentPdfDocument() {
    const loadingTask = this.currentLoadingTask;
    this.currentLoadingTask = null;
    this.currentPdfDocument = null;
    await loadingTask?.destroy();
  }

  enableVisualEditing({
    pageNumber = this.app.pdfViewer?.currentPageNumber || 1,
    refresh = true,
    ...options
  } = {}) {
    const previousPageNumber = this.visualOptions.pageNumber;
    if (previousPageNumber && previousPageNumber !== pageNumber) {
      this.cancelVisualEdit();
      this.setHoveredBlockMarker(null);
      this.clearEditableTextDivs(previousPageNumber);
    }
    this.visualOptions = {
      ...this.visualOptions,
      pageNumber,
      ...options,
    };
    this.enable({ pageNumber, refresh });
    if (!refresh) {
      this.markEditableTextDivs(pageNumber);
    }
    if (this.visualEditing) {
      return this;
    }

    this.visualEditing = true;
    this.visualAbortController = new AbortController();
    document.addEventListener(
      "pointermove",
      event => {
        const infoIcon = this.getInfoIconFromEvent(event);
        const iconBlock = infoIcon ? this.getBlockForInfoIcon(infoIcon) : null;
        const bridgeBlock = iconBlock
          ? null
          : this.getHoveredInfoBridgeBlock(event);
        const textDiv =
          iconBlock || bridgeBlock ? null : this.getTextDivFromEvent(event);
        const block =
          iconBlock || bridgeBlock || (textDiv ? this.getBlock(textDiv) : null);
        const source = textDiv ? this.getSource(textDiv) : null;
        if (
          (!iconBlock &&
            (!textDiv ||
              !this.isVisualEditTextDiv(textDiv) ||
              !isNativeTextEditSourceNormalUiEditable(source))) ||
          !isNativeTextEditBlockInteractive(block)
        ) {
          this.setHoveredBlockMarker(null);
          return;
        }
        this.setHoveredBlockMarker(block);
      },
      { signal: this.visualAbortController.signal }
    );
    document.addEventListener(
      "click",
      event => {
        if (this.getInfoIconFromEvent(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const textDiv = this.getTextDivFromEvent(event);
        const source = textDiv ? this.getSource(textDiv) : null;
        const block = textDiv ? this.getBlock(textDiv) : null;
        if (
          textDiv &&
          this.isVisualEditTextDiv(textDiv) &&
          source?.editable === false
        ) {
          this.recordTextEditHit(textDiv, "click");
          return;
        }
        if (
          !textDiv ||
          !this.isVisualEditTextDiv(textDiv) ||
          !source?.editable ||
          !isNativeTextEditBlockInteractive(block)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.startVisualEdit(textDiv);
      },
      { signal: this.visualAbortController.signal }
    );
    this.app.eventBus?._on(
      "textlayerrendered",
      ({ pageNumber: renderedPageNumber }) => {
        if (renderedPageNumber === this.visualOptions.pageNumber) {
          this.markEditableTextDivs(renderedPageNumber);
        }
      },
      { signal: this.visualAbortController.signal }
    );
    return this;
  }

  disableVisualEditing() {
    this.cancelVisualEdit();
    this.setHoveredBlockMarker(null);
    this.clearEditableTextDivs();
    this.visualAbortController?.abort();
    this.visualAbortController = null;
    this.visualEditing = false;
    this.enabled = false;
    this.visualOptions.pageNumber = null;
    return this;
  }

  startVisualEdit(textDiv = this.getSelectedTextDiv(), options = null) {
    if (!textDiv) {
      throw new Error("pdfjs-native-text-edit-text-div-missing");
    }

    const source = this.getSource(textDiv);
    if (!this.isVisualEditTextDiv(textDiv)) {
      throw new Error("pdfjs-native-text-edit-page-not-active");
    }
    if (!isNativeTextEditSourceNormalUiEditable(source)) {
      this.recordTextEditHit(textDiv, "start-visual-edit");
      throw new Error(
        source?.reason || "pdfjs-native-text-edit-source-missing"
      );
    }

    if (this.activeVisualEdit?.textDiv === textDiv) {
      return this.activeVisualEdit;
    }
    this.cancelVisualEdit();

    const blockCandidate = this.getBlock(textDiv);
    if (!isNativeTextEditBlockInteractive(blockCandidate)) {
      throw new Error(
        blockCandidate?.editPolicy?.unsupportedReason ||
          "pdfjs-native-text-edit-block-marker-missing"
      );
    }

    const lineCandidate = getNativeTextEditLineCandidate(blockCandidate);
    const editSource = lineCandidate?.textEditSource || source;
    const expectedSourceText = getSourceText(editSource);
    if (typeof expectedSourceText !== "string") {
      throw new Error("pdfjs-native-text-edit-source-text-missing");
    }

    const state = this.visualEditController.start({
      textDiv,
      blockCandidate,
      lineCandidate,
      expectedSourceText,
      options: { ...this.visualOptions, ...(options || null) },
      preview: null,
    });
    state.preview = state.galley
      ? this.captureVisualEditGalleyCanvasState(state)
      : this.captureVisualEditCanvasState(textDiv, blockCandidate);
    state.previewSession = this.beginTextEditPreviewSession(state, editSource);
    this.activeVisualEdit = state;
    this.clearDraftState();
    return state;
  }

  cancelVisualEdit({ restoreText = true } = {}) {
    const state = this.activeVisualEdit;
    if (!state) {
      return;
    }

    this.visualEditController.cancel(state, {
      restoreText,
      restorePreview: editState => this.restoreVisualEditPreview(editState),
    });
    this.activeVisualEdit = null;
  }

  async commitVisualEdit(
    textDiv = this.activeVisualEdit?.textDiv,
    options = null
  ) {
    const state = this.activeVisualEdit;
    if (!state || state.textDiv !== textDiv) {
      throw new Error("pdfjs-native-text-edit-active-edit-missing");
    }
    if (state.committing) {
      return null;
    }

    const replacementText = this.visualEditController.getReplacementText(state);
    if (replacementText === state.originalText) {
      this.cancelVisualEdit();
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-unchanged",
      };
    }

    const draftStatus = this.getLastDraftCommitStatus(state, replacementText);
    if (!draftStatus.ok) {
      this.recordDiagnostic(draftStatus, "commit-draft");
      this.recordDraftDiagnostic(
        draftStatus,
        "commit-draft",
        state.previewGeneration,
        replacementText
      );
      state.inputDiv.style.boxShadow = "0 0 0 2px rgb(191 54 12 / 80%)";
      this.lastPreview = {
        ok: false,
        draftStale: draftStatus.reason.endsWith("-stale"),
        draftValid: false,
        generation: state.previewGeneration,
        reason: draftStatus.reason,
        replacementText,
      };
      return draftStatus;
    }

    state.committing = true;
    state.inputDiv.style.boxShadow = "0 0 0 2px rgb(25 118 210 / 80%)";
    try {
      const saveOptions = {
        ...state.options,
        ...(options || null),
      };
      const bytes = clonePdfBytes(draftStatus.bytes);
      const plan = draftStatus.plan;
      this.lastBytes = clonePdfBytes(bytes);
      this.lastValidation = draftStatus.validation || this.lastValidation;
      this.app.setTitle?.();
      if (saveOptions.download) {
        this.download(saveOptions.filename);
      }
      if (saveOptions.reopen) {
        await this.destroyCurrentPdfDocument();
        await this.app.open({
          data: clonePdfBytes(bytes),
          filename: saveOptions.filename || "pdfjs-native-text-edit.pdf",
        });
      }
      const isBlockEdit = state.blockCandidate?.lines?.length > 1;
      const lineCandidate =
        state.lineCandidate ||
        getNativeTextEditLineCandidate(state.blockCandidate);
      const promotedPreview = this.promoteVisualEditOverlayPreview(state);
      const preview = promotedPreview
        ? {
            ok: true,
            promoted: true,
            rect: promotedPreview.rect,
            target: "page",
          }
        : await this.renderVisualEditCommitPreview({
            bytes,
            isBlockEdit,
            saveOptions,
            state,
            textDiv,
          });
      const pageNumber =
        this.getPageViewForTextDiv(textDiv)?.id ||
        this.app.pdfViewer?.currentPageNumber ||
        1;
      this.patches.length = 0;
      this.applyVisualEditTextLayerResult({
        isBlockEdit,
        lineCandidate,
        replacementText,
        state,
        textDiv,
      });
      this.cancelVisualEdit({ restoreText: false });
      const reconciliation = saveOptions.reopen
        ? null
        : await this.reconcilePageTextLayer({
            bytes,
            pageNumber,
          });
      return {
        ok: true,
        bytes,
        plan,
        preview,
        reconciliation,
      };
    } catch (reason) {
      this.recordDiagnostic(reason, "commit");
      this.cancelVisualEdit();
      throw reason;
    }
  }

  async planVisualEditCommit({ replacementText, state, textDiv }) {
    const isBlockEdit = state.blockCandidate?.lines?.length > 1;
    const lineCandidate =
      state.lineCandidate ||
      getNativeTextEditLineCandidate(state.blockCandidate);
    const plan = isBlockEdit
      ? await this.planBlock({
          blockCandidate: state.blockCandidate,
          replacementText,
        })
      : await this.plan({
          textDiv: lineCandidate?.textDiv || textDiv,
          textEditSource: lineCandidate?.textEditSource,
          expectedSourceText:
            lineCandidate?.sourceText || state.expectedSourceText,
          visibleText: lineCandidate?.visibleText,
          replacementText,
          storePatch: false,
        });
    const contentStreamPatches =
      plan.contentStreamPatches ||
      (plan.contentStreamPatch || plan.xObjectFormStreamPatch
        ? [plan.contentStreamPatch || plan.xObjectFormStreamPatch]
        : null);
    const failedPatch = contentStreamPatches?.find(patch => !patch?.ok);
    if (plan.ok && (!contentStreamPatches?.length || failedPatch)) {
      const unsupportedSummary = getNativeTextEditUnsupportedSummary(plan);
      return {
        contentStreamPatches: null,
        isBlockEdit,
        lineCandidate,
        plan: {
          ok: false,
          reason:
            failedPatch?.reason ||
            plan.contentStreamPatch?.reason ||
            plan.xObjectFormStreamPatch?.reason ||
            "pdfjs-native-text-edit-content-stream-patch-missing",
          ...(unsupportedSummary?.ok === false
            ? { unsupported: unsupportedSummary }
            : null),
        },
      };
    }
    return {
      contentStreamPatches,
      isBlockEdit,
      lineCandidate,
      plan,
    };
  }

  async renderVisualEditCommitPreview({
    bytes,
    isBlockEdit,
    saveOptions,
    state,
    textDiv,
  }) {
    if (state.options.previewRect === false || saveOptions.reopen) {
      return null;
    }

    let commitPreview = null;
    if (state.galley) {
      await this.updateVisualEditPreviewLayout(state);
      commitPreview = this.captureVisualEditElementCanvasState({
        element: state.galley.element,
        padding: false,
        textDiv,
      });
    } else if (isBlockEdit) {
      commitPreview = this.captureVisualEditCanvasState(
        textDiv,
        state.blockCandidate
      );
    }
    return this.previewVisualEditRect({
      bytes,
      preview: commitPreview,
      textDiv,
    });
  }

  captureVisualMoveCommitPreview(state = this.activeVisualEdit) {
    const pageView = this.getPageViewForTextDiv(state?.textDiv);
    const canvas = pageView?.canvas;
    const movedElement = state?.galley?.element || state?.inputDiv;
    if (!canvas || !movedElement) {
      return null;
    }

    const originalRect =
      state.preview?.rect ||
      this.captureVisualEditCanvasState(state.textDiv, state.blockCandidate)
        ?.rect;
    const movedRect = getCanvasPixelRectForElement(movedElement, canvas);
    const rect = unionCanvasPixelRects([originalRect, movedRect], canvas, 2);
    if (!rect?.width || !rect?.height) {
      return null;
    }
    return {
      canvas,
      pageView,
      rect,
    };
  }

  async reconcileVisualMoveAfterSave({ bytes, pageNumber, preview }) {
    try {
      const result = await this.renderSavedPageRectAndReconcileTextLayer({
        bytes,
        pageNumber,
        preview,
      });
      return {
        preview: {
          ok: true,
          pageNumber,
          rect: result.rect,
          target: "page-partial",
          timing: result.timing,
        },
        reconciliation: {
          ok: true,
          pageNumber,
          redrawPage: false,
          partialRedraw: true,
        },
      };
    } catch (reason) {
      this.recordDiagnostic(
        {
          reason: reason?.message || String(reason),
        },
        "move-partial-reconcile"
      );
      const reconciliation = await this.reconcilePageTextLayer({
        bytes,
        pageNumber,
        redrawPage: true,
      });
      return {
        preview: {
          ok: true,
          fallbackReason: reason?.message || String(reason),
          target: "page-redraw",
        },
        reconciliation,
      };
    }
  }

  async updateVisualEditPreviewLayout(state = this.activeVisualEdit) {
    if (!state?.galley) {
      return null;
    }
    const controller = this.visualEditController;
    if (typeof controller?.updateGalleyLayout !== "function") {
      return null;
    }
    try {
      return await controller.updateGalleyLayout(state);
    } catch (reason) {
      console.warn(
        "PDFJSNativeTextEditDebug.updateVisualEditPreviewLayout:",
        reason
      );
      return null;
    }
  }

  promoteVisualEditOverlayPreview(state = this.activeVisualEdit) {
    const preview = state?.preview;
    if (
      !preview?.canvas ||
      !preview?.context ||
      !preview?.targetCanvas ||
      preview.targetCanvas === preview.canvas ||
      !preview?.rect?.width ||
      !preview?.rect?.height
    ) {
      return null;
    }

    preview.context.drawImage(
      preview.targetCanvas,
      0,
      0,
      preview.targetCanvas.width,
      preview.targetCanvas.height,
      preview.rect.x,
      preview.rect.y,
      preview.rect.width,
      preview.rect.height
    );
    return {
      ok: true,
      rect: preview.rect,
    };
  }

  applyVisualEditTextLayerResult({
    isBlockEdit,
    lineCandidate,
    replacementText,
    state,
    textDiv,
  }) {
    if (isBlockEdit) {
      const replacementLines =
        normalizeBlockReplacementText(replacementText).split("\n");
      for (const [index, line] of state.blockCandidate.lines.entries()) {
        line.textDiv.textContent = replacementLines[index] || "";
      }
      return;
    }

    if (lineCandidate?.textDivs?.length > 1) {
      lineCandidate.textDiv.textContent = replacementText;
      for (const fragmentTextDiv of lineCandidate.textDivs.slice(1)) {
        fragmentTextDiv.textContent = "";
      }
      return;
    }

    textDiv.textContent = replacementText;
  }

  getTextDiv({
    pageNumber = this.visualOptions.pageNumber ||
      this.app.pdfViewer?.currentPageNumber ||
      1,
    index = 0,
  } = {}) {
    return (
      this.getPageView(pageNumber)?.textLayer?.div?.querySelectorAll(
        "span[role='presentation']"
      )[index] || null
    );
  }

  getSource(textDiv = null) {
    textDiv ||= this.getSelectedTextDiv();
    const pageView = this.getPageViewForTextDiv(textDiv);
    return pageView?.textLayer?.getTextEditSource(textDiv) || null;
  }

  getBlock(textDiv = null) {
    textDiv ||= this.getSelectedTextDiv();
    return getNativeTextEditBlockForTextDiv(textDiv);
  }

  getBlocks(pageNumber = this.visualOptions.pageNumber) {
    return this.textEditBlocks.get(pageNumber) || [];
  }

  markEditableTextDivs(pageNumber = this.visualOptions.pageNumber) {
    if (!pageNumber) {
      return;
    }

    const pageView = this.getPageView(pageNumber);
    const textLayerDiv = pageView?.textLayer?.div;
    if (!textLayerDiv) {
      return;
    }
    textLayerDiv.dataset.pdfjsNativeTextEditPage = "true";
    const textDivs = this.getTextDivsInPage(pageNumber);
    const blocks = buildNativeTextEditBlocks({
      textDivs,
      pageNumber,
      getSource: textDiv => this.getSource(textDiv),
    });
    this.textEditBlocks.set(pageNumber, blocks);
    this.renderBlockMarkers({ blocks, textLayerDiv });
    for (const textDiv of textDivs) {
      const source = this.getSource(textDiv);
      const block = this.getBlock(textDiv);
      if (
        isNativeTextEditSourceNormalUiEditable(source) &&
        isNativeTextEditBlockInteractive(block)
      ) {
        textDiv.dataset.pdfjsNativeTextEditable = "true";
        delete textDiv.dataset.pdfjsNativeTextEditUnsupportedReason;
        if (isNativeTextEditXObjectFormValidationAnchor(source)) {
          applyNativeTextEditXObjectFormDataset(textDiv, {
            containerSummary: getNativeTextEditContainerSummary(
              source.container
            ),
          });
        } else {
          clearNativeTextEditXObjectFormDataset(textDiv);
        }
        if (block) {
          textDiv.dataset.pdfjsNativeTextEditBlock = block.blockId;
          textDiv.dataset.pdfjsNativeTextEditBlockLine = String(
            block.lines.find(line =>
              (line.textDivs || [line.textDiv]).includes(textDiv)
            )?.index ?? ""
          );
        } else {
          delete textDiv.dataset.pdfjsNativeTextEditBlock;
          delete textDiv.dataset.pdfjsNativeTextEditBlockLine;
        }
        if (source.grouped === true) {
          textDiv.dataset.pdfjsNativeTextEditGroup = "true";
        } else {
          delete textDiv.dataset.pdfjsNativeTextEditGroup;
        }
        textDiv.title = buildNativeTextEditInfoTooltip({
          block,
          source,
          textDiv,
        });
      } else {
        const unsupportedSummary =
          getNativeTextEditSourceUnsupportedSummary(source);
        delete textDiv.dataset.pdfjsNativeTextEditable;
        delete textDiv.dataset.pdfjsNativeTextEditGroup;
        delete textDiv.dataset.pdfjsNativeTextEditBlock;
        delete textDiv.dataset.pdfjsNativeTextEditBlockLine;
        if (unsupportedSummary?.reason) {
          textDiv.dataset.pdfjsNativeTextEditUnsupportedReason =
            unsupportedSummary.reason;
          applyNativeTextEditXObjectFormDataset(textDiv, unsupportedSummary);
          textDiv.title = unsupportedSummary.reason;
        } else {
          delete textDiv.dataset.pdfjsNativeTextEditUnsupportedReason;
          clearNativeTextEditXObjectFormDataset(textDiv);
          textDiv.removeAttribute?.("title");
          textDiv.title = "";
        }
      }
    }
  }

  clearEditableTextDivs(pageNumber = null) {
    const pageNumbers = pageNumber
      ? [pageNumber]
      : Array.from(
          { length: this.app.pdfViewer?.pagesCount || 0 },
          (_, index) => index + 1
        );
    for (const page of pageNumbers) {
      const pageView = this.getPageView(page);
      const textLayerDiv = pageView?.textLayer?.div;
      delete textLayerDiv?.dataset.pdfjsNativeTextEditPage;
      this.clearBlockMarkers(textLayerDiv);
      for (const textDiv of this.getTextDivsInPage(page)) {
        delete textDiv.dataset.pdfjsNativeTextEditable;
        delete textDiv.dataset.pdfjsNativeTextEditGroup;
        delete textDiv.dataset.pdfjsNativeTextEditBlock;
        delete textDiv.dataset.pdfjsNativeTextEditBlockLine;
        delete textDiv.dataset.pdfjsNativeTextEditUnsupportedReason;
        clearNativeTextEditXObjectFormDataset(textDiv);
        textDiv.removeAttribute?.("title");
        textDiv.title = "";
      }
      this.textEditBlocks.delete(page);
    }
  }

  clearBlockMarkers(textLayerDiv = null) {
    if (
      this.hoveredBlockMarker &&
      textLayerDiv?.contains(this.hoveredBlockMarker)
    ) {
      this.hoveredBlockMarker = null;
    }
    if (this.hoveredInfoIcon && textLayerDiv?.contains(this.hoveredInfoIcon)) {
      this.hoveredInfoIcon = null;
    }
    textLayerDiv
      ?.querySelectorAll(
        [
          "[data-pdfjs-native-text-edit-block-marker]",
          "[data-pdfjs-native-text-edit-info-icon]",
        ].join(",")
      )
      .forEach(element => element.remove());
  }

  setHoveredBlockMarker(blockCandidate = null) {
    if (this.hoveredBlockMarker) {
      delete this.hoveredBlockMarker.dataset
        .pdfjsNativeTextEditBlockMarkerHover;
    }
    if (this.hoveredInfoIcon) {
      delete this.hoveredInfoIcon.dataset.pdfjsNativeTextEditInfoIconHover;
    }
    this.hoveredBlockMarker = null;
    this.hoveredInfoIcon = null;

    const blockId = blockCandidate?.blockId;
    if (!blockId) {
      return;
    }
    const textLayerDiv = this.getPageView(
      blockCandidate.pageNumber || this.visualOptions.pageNumber
    )?.textLayer?.div;
    const marker = Array.from(
      textLayerDiv?.querySelectorAll(
        "[data-pdfjs-native-text-edit-block-marker]"
      ) || []
    ).find(candidate => candidate.dataset.pdfjsNativeTextEditBlock === blockId);
    if (!marker) {
      return;
    }
    const infoIcon = Array.from(
      textLayerDiv?.querySelectorAll(
        "[data-pdfjs-native-text-edit-info-icon]"
      ) || []
    ).find(candidate => candidate.dataset.pdfjsNativeTextEditBlock === blockId);

    marker.dataset.pdfjsNativeTextEditBlockMarkerHover = "true";
    this.hoveredBlockMarker = marker;
    if (infoIcon) {
      infoIcon.dataset.pdfjsNativeTextEditInfoIconHover = "true";
      this.hoveredInfoIcon = infoIcon;
    }
  }

  renderBlockMarkers({ blocks, textLayerDiv }) {
    this.clearBlockMarkers(textLayerDiv);
    const layerRect = textLayerDiv?.getBoundingClientRect();
    if (!layerRect?.width || !layerRect?.height) {
      return;
    }

    for (const block of blocks || []) {
      if (
        !shouldRenderNativeTextEditBlockMarker(block) ||
        !block.textDivs?.length
      ) {
        continue;
      }
      const rect = getClientRectForTextDivs(block.textDivs);
      if (!rect?.width || !rect?.height) {
        continue;
      }

      const padding = 3;
      const marker = document.createElement("div");
      marker.dataset.pdfjsNativeTextEditBlockMarker = "true";
      marker.dataset.pdfjsNativeTextEditBlock = block.blockId;
      marker.dataset.pdfjsNativeTextEditBlockRole = block.role || "";
      marker.dataset.pdfjsNativeTextEditBlockConfidence =
        block.confidence || "";
      marker.dataset.pdfjsNativeTextEditBlockReason = block.debugReason || "";
      marker.setAttribute("aria-hidden", "true");
      const style = marker.style;
      style.left = `${rect.left - layerRect.left - padding}px`;
      style.top = `${rect.top - layerRect.top - padding}px`;
      style.width = `${rect.width + padding * 2}px`;
      style.height = `${rect.height + padding * 2}px`;
      textLayerDiv.append(marker);

      const textDiv = block.textDivs[0];
      const source =
        block.lines?.[0]?.textEditSource || this.getSource(textDiv);
      const info = buildNativeTextEditInfoTooltip({ block, source, textDiv });
      const infoIcon = document.createElement("button");
      infoIcon.type = "button";
      infoIcon.textContent = "i";
      infoIcon.title = info;
      infoIcon.setAttribute("aria-label", info);
      infoIcon.dataset.pdfjsNativeTextEditInfoIcon = "true";
      infoIcon.dataset.pdfjsNativeTextEditBlock = block.blockId;
      infoIcon.dataset.pdfjsNativeTextEditPage = String(block.pageNumber || "");
      infoIcon.addEventListener("pointerdown", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      infoIcon.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      const iconSize = 16;
      const iconGap = 4;
      infoIcon.style.left = `${MathClamp(
        rect.right - layerRect.left + iconGap,
        0,
        Math.max(0, layerRect.width - iconSize)
      )}px`;
      infoIcon.style.top = `${MathClamp(
        rect.top - layerRect.top - iconSize - iconGap,
        0,
        Math.max(0, layerRect.height - iconSize)
      )}px`;
      textLayerDiv.append(infoIcon);
    }
  }

  async plan(textDivOrParams = null, replacementText = null, options = null) {
    const isTextDiv =
      typeof HTMLElement !== "undefined" &&
      textDivOrParams instanceof HTMLElement;
    const params =
      textDivOrParams && !isTextDiv && typeof textDivOrParams === "object"
        ? textDivOrParams
        : {
            textDiv: textDivOrParams,
            replacementText,
            ...(options || null),
          };
    const textDiv =
      params.textDiv ||
      (params.textEditSource ? null : this.getSelectedTextDiv());
    const pageNumber =
      params.pageNumber || this.app.pdfViewer?.currentPageNumber || 1;
    const pageView =
      this.getPageViewForTextDiv(textDiv) || this.getPageView(pageNumber);
    const source = params.textEditSource || this.getSource(textDiv);

    if (!pageView?.pdfPage) {
      throw new Error("pdfjs-native-text-edit-page-not-ready");
    }
    if (!source) {
      throw new Error("pdfjs-native-text-edit-source-missing");
    }

    const result = await pageView.pdfPage.planTextSourceEdit({
      textEditSource: source,
      expectedSourceText:
        params.expectedSourceText ??
        getSourceText(source) ??
        textDiv?.textContent ??
        "",
      visibleText: params.visibleText ?? textDiv?.textContent ?? null,
      replacementText: params.replacementText,
      includeDecodedStreamPatch: true,
    });
    this.lastPlan = result;
    this.lastReplacementText = params.replacementText;
    if (!result.ok) {
      this.recordDiagnostic(result, "plan");
    } else {
      const unsupportedSummary = getNativeTextEditUnsupportedSummary(result);
      this.lastUnsupported =
        unsupportedSummary?.ok === false ? unsupportedSummary : null;
      this.lastError = null;
    }

    const patch = result.contentStreamPatch || result.xObjectFormStreamPatch;
    if (params.storePatch !== false && patch?.ok) {
      this.patches.push(patch);
    }
    return result;
  }

  getPdfDeltaForViewportDelta({ pageView, deltaX, deltaY }) {
    const viewport = pageView?.viewport;
    if (!viewport || typeof viewport.convertToPdfPoint !== "function") {
      throw new Error("pdfjs-native-text-edit-viewport-missing");
    }
    const [x0, y0] = viewport.convertToPdfPoint(0, 0);
    const [x1, y1] = viewport.convertToPdfPoint(deltaX, deltaY);
    return [x1 - x0, y1 - y0];
  }

  async planMove(params = {}) {
    const textDiv = params.textDiv || this.activeVisualEdit?.textDiv;
    const pageNumber =
      params.pageNumber || this.app.pdfViewer?.currentPageNumber || 1;
    const pageView =
      this.getPageViewForTextDiv(textDiv) || this.getPageView(pageNumber);
    const source = params.textEditSource || this.getSource(textDiv);

    if (!pageView?.pdfPage) {
      throw new Error("pdfjs-native-text-edit-page-not-ready");
    }
    if (!source) {
      throw new Error("pdfjs-native-text-edit-source-missing");
    }

    const delta =
      params.delta ||
      this.getPdfDeltaForViewportDelta({
        pageView,
        deltaX: params.deltaX || 0,
        deltaY: params.deltaY || 0,
      });
    const result = await pageView.pdfPage.planTextSourceMove({
      textEditSource: source,
      expectedSourceText:
        params.expectedSourceText ??
        getSourceText(source) ??
        textDiv?.textContent ??
        "",
      delta,
      editGeneration: params.editGeneration ?? null,
      includeDecodedStreamPatch: true,
    });
    this.lastPlan = result;
    if (!result.ok) {
      this.recordDiagnostic(result, "move-plan");
    } else {
      this.lastError = null;
      this.lastUnsupported = null;
    }
    if (params.storePatch !== false && result.contentStreamPatch?.ok) {
      this.patches.push(result.contentStreamPatch);
    }
    return result;
  }

  async commitVisualMove(state = this.activeVisualEdit, delta = null) {
    if (!state || state !== this.activeVisualEdit) {
      throw new Error("pdfjs-native-text-edit-active-edit-missing");
    }
    const pageView = this.getPageViewForTextDiv(state.textDiv);
    const moveDelta = {
      deltaX: delta?.deltaX || 0,
      deltaY: delta?.deltaY || 0,
    };
    let plan = await this.planMove({
      textDiv: state.lineCandidate?.textDiv || state.textDiv,
      textEditSource: state.lineCandidate?.textEditSource,
      expectedSourceText:
        state.lineCandidate?.sourceText || state.expectedSourceText,
      ...moveDelta,
      storePatch: false,
    });
    if (!plan.contentStreamPatch?.ok) {
      const spanSource = this.getSource(state.textDiv);
      if (
        spanSource &&
        spanSource !== state.lineCandidate?.textEditSource &&
        spanSource.grouped !== true
      ) {
        plan = await this.planMove({
          textDiv: state.textDiv,
          textEditSource: spanSource,
          expectedSourceText: getSourceText(spanSource),
          ...moveDelta,
          storePatch: false,
        });
      }
    }
    if (!plan.ok || !plan.contentStreamPatch?.ok) {
      const result = {
        ok: false,
        reason:
          plan.reason ||
          plan.contentStreamPatch?.patchReason ||
          plan.contentStreamPatch?.reason ||
          plan.decodedStreamPatch?.reason ||
          "pdfjs-native-text-edit-move-content-stream-patch-missing",
        plan,
      };
      this.recordDiagnostic(result, "move-commit");
      throw new Error(result.reason);
    }

    const bytes = await this.save({
      patches: [plan.contentStreamPatch],
      download: state.options.download,
      filename: state.options.filename || "pdfjs-native-text-edit.pdf",
      reopen: state.options.reopen,
      validate: false,
    });
    const pageNumber =
      pageView?.id || this.app.pdfViewer?.currentPageNumber || 1;
    const commitPreview = this.captureVisualMoveCommitPreview(state);
    this.cancelVisualEdit({ restoreText: false });
    const { preview, reconciliation } = state.options.reopen
      ? { preview: null, reconciliation: null }
      : await this.reconcileVisualMoveAfterSave({
          bytes,
          pageNumber,
          preview: commitPreview,
        });
    return {
      ok: true,
      bytes,
      plan,
      preview,
      reconciliation,
    };
  }

  async commitXObjectFormEdit(
    textDivOrParams = null,
    replacementText = null,
    options = null
  ) {
    let params;
    const isTextDiv =
      typeof HTMLElement !== "undefined" &&
      textDivOrParams instanceof HTMLElement;
    if (typeof textDivOrParams === "string") {
      params = {
        replacementText: textDivOrParams,
        ...(options || null),
      };
    } else if (
      textDivOrParams &&
      typeof textDivOrParams === "object" &&
      !isTextDiv
    ) {
      params = textDivOrParams;
    } else {
      params = {
        textDiv: textDivOrParams,
        replacementText,
        ...(options || null),
      };
    }
    const textDiv =
      params.textDiv ||
      (params.textEditSource ? null : this.getSelectedTextDiv());
    const source = params.textEditSource || this.getSource(textDiv);
    const pageNumber =
      params.pageNumber || this.app.pdfViewer?.currentPageNumber || 1;

    if (typeof params.replacementText !== "string") {
      throw new Error("pdfjs-native-text-edit-replacement-text-missing");
    }
    if (!source) {
      throw new Error("pdfjs-native-text-edit-source-missing");
    }
    if (textDiv) {
      this.recordTextEditHit(textDiv, "xobject-form-commit");
    }

    const plan = await this.plan({
      textDiv,
      textEditSource: source,
      expectedSourceText:
        params.expectedSourceText ??
        getSourceText(source) ??
        textDiv?.textContent ??
        "",
      visibleText: params.visibleText ?? textDiv?.textContent ?? null,
      replacementText: params.replacementText,
      pageNumber,
      storePatch: false,
    });
    const patch = plan.xObjectFormStreamPatch;
    if (!plan.ok || !patch?.ok) {
      const unsupportedSummary = getNativeTextEditUnsupportedSummary(plan);
      const result = {
        ok: false,
        reason:
          plan.reason ||
          patch?.reason ||
          "pdfjs-native-text-edit-xobject-form-stream-patch-missing",
        plan,
        ...(unsupportedSummary?.ok === false
          ? { unsupported: unsupportedSummary }
          : null),
      };
      this.recordDiagnostic(result, "xobject-form-commit-plan");
      if (unsupportedSummary?.ok !== false) {
        this.lastUnsupported = null;
      }
      return result;
    }

    try {
      const bytes = await this.save({
        patches: [patch],
        download: params.download === true,
        filename: params.filename || "pdfjs-native-text-edit-xobject-form.pdf",
        reopen: params.reopen === true,
        validate: params.validate !== false,
        validateOptions: {
          allowXObjectFormReplacementAnchor: true,
          pageNumber,
          replacementText: params.replacementText,
        },
      });
      let reconciliation = null;
      if (params.reconcile === true && params.reopen !== true) {
        reconciliation = await this.reconcilePageTextLayer({
          bytes,
          pageNumber,
          redrawPage: params.redrawPage === true,
        });
      }
      return {
        ok: true,
        bytes,
        patch,
        plan,
        reconciliation,
        validation: this.lastValidation,
      };
    } catch (reason) {
      this.recordDiagnostic(reason, "xobject-form-commit-save");
      throw reason;
    }
  }

  async commitSelectedXObjectFormEdit(replacementText, options = null) {
    const textDiv = this.getSelectedTextDiv();
    const source = textDiv ? this.getSource(textDiv) : null;
    if (!textDiv || !source) {
      const result = {
        ok: false,
        reason: textDiv
          ? "pdfjs-native-text-edit-source-missing"
          : "pdfjs-native-text-edit-selection-missing",
      };
      this.recordDiagnostic(result, "xobject-form-selected-commit");
      return result;
    }

    const hit = this.recordTextEditHit(textDiv, "xobject-form-selected-commit");
    const status = getNativeTextEditXObjectFormTargetStatus(source);
    if (!status.devCommitEligible) {
      const unsupported = getNativeTextEditSourceUnsupportedSummary(source);
      const result = {
        ok: false,
        reason: "pdfjs-native-text-edit-xobject-form-target-not-eligible",
        hit,
        targetStatus: status,
        ...(unsupported ? { unsupported } : null),
      };
      this.recordDiagnostic(result, "xobject-form-selected-commit");
      return result;
    }

    return this.commitXObjectFormEdit({
      textDiv,
      textEditSource: source,
      replacementText,
      ...(options || null),
    });
  }

  async planBlock({ blockCandidate, replacementText }) {
    if (!isNativeTextEditBlockSupported(blockCandidate)) {
      const result = {
        ok: false,
        reason:
          blockCandidate?.editPolicy?.unsupportedReason ||
          "text-edit-block-unsupported",
      };
      this.lastPlan = result;
      this.recordDiagnostic(result, "block-plan");
      return result;
    }

    const replacements = getLinePreservingBlockReplacements(
      blockCandidate,
      replacementText
    );
    if (!replacements.ok) {
      this.lastPlan = replacements;
      return replacements;
    }

    const linePlans = [];
    for (const {
      line,
      replacementText: lineReplacementText,
    } of replacements.lines) {
      const linePlan = await this.plan({
        textDiv: line.textDiv,
        textEditSource: line.textEditSource,
        expectedSourceText: line.sourceText,
        visibleText: line.visibleText,
        replacementText: lineReplacementText,
        storePatch: false,
      });
      if (!linePlan.ok) {
        const result = {
          ok: false,
          reason: "text-edit-block-line-plan-failed",
          lineIndex: line.index,
          lineReason: linePlan.reason || null,
          linePlan,
        };
        this.lastPlan = result;
        this.recordDiagnostic(result, "block-line-plan");
        return result;
      }
      if (!linePlan.contentStreamPatch?.ok) {
        const result = {
          ok: false,
          reason: "text-edit-block-content-stream-patch-missing",
          lineIndex: line.index,
          patchReason: linePlan.contentStreamPatch?.reason || null,
          linePlan,
        };
        this.lastPlan = result;
        this.recordDiagnostic(result, "block-content-stream-patch");
        return result;
      }
      linePlans.push(linePlan);
    }

    const combined = combineLinePreservingBlockContentStreamPatches(linePlans);
    if (!combined.ok) {
      this.lastPlan = combined;
      this.recordDiagnostic(combined, "block-combine");
      return combined;
    }

    const result = {
      ok: true,
      kind: "PdfTextEditBlockPlan",
      blockId: blockCandidate.blockId,
      editPolicy: blockCandidate.editPolicy,
      lineCount: blockCandidate.lines.length,
      replacementText,
      linePlans,
      contentStreamPatches: combined.patches,
    };
    this.lastPlan = result;
    this.lastReplacementText = replacementText;
    this.lastError = null;
    this.lastUnsupported = null;
    return result;
  }

  async layout(textDivOrParams = null, replacementText = null, options = null) {
    const params =
      textDivOrParams &&
      !(textDivOrParams instanceof HTMLElement) &&
      typeof textDivOrParams === "object"
        ? textDivOrParams
        : {
            textDiv: textDivOrParams,
            replacementText,
            ...(options || null),
          };
    const textDiv = params.textDiv || this.getSelectedTextDiv();
    const pageNumber =
      params.pageNumber || this.app.pdfViewer?.currentPageNumber || 1;
    const pageView =
      this.getPageViewForTextDiv(textDiv) || this.getPageView(pageNumber);
    const source = params.textEditSource || this.getSource(textDiv);

    if (!pageView?.pdfPage) {
      throw new Error("pdfjs-native-text-edit-page-not-ready");
    }
    if (!source) {
      throw new Error("pdfjs-native-text-edit-source-missing");
    }

    return pageView.pdfPage.beginTextEditLayout({
      textEditSource: source,
      expectedSourceText:
        params.expectedSourceText ??
        getSourceText(source) ??
        textDiv?.textContent ??
        "",
      visibleText: params.visibleText ?? textDiv?.textContent ?? null,
      replacementText: params.replacementText ?? null,
      editGeneration: params.editGeneration ?? null,
      viewport: pageView.viewport,
    });
  }

  beginTextEditPreviewSession(state, textEditSource) {
    const pageView = this.getPageViewForTextDiv(state.textDiv);
    return {
      expectedSourceText: state.expectedSourceText,
      lastResult: null,
      pageView,
      pending: null,
      running: false,
      textEditSource,
    };
  }

  scheduleVisualEditPreview(state = this.activeVisualEdit) {
    if (!state?.preview || !state.previewSession) {
      return;
    }
    if (state.previewTimer) {
      clearTimeout(state.previewTimer);
    }
    const generation = ++state.previewGeneration;
    const scheduledAt = nowMs();
    const previewDelay = Math.max(
      0,
      Number.isFinite(state.options.livePreviewDelay)
        ? state.options.livePreviewDelay
        : DEFAULT_NATIVE_TEXT_EDIT_LIVE_PREVIEW_DELAY
    );
    state.previewTimer = setTimeout(() => {
      state.previewTimer = null;
      this.updateVisualEditPreview(state, generation, {
        previewDelay,
        scheduledAt,
      }).catch(reason =>
        console.warn(
          "PDFJSNativeTextEditDebug.updateVisualEditPreview:",
          reason
        )
      );
    }, previewDelay);
  }

  restoreVisualEditPreview(state = this.activeVisualEdit) {
    const preview = state?.preview;
    if (!preview?.originalImageData) {
      return false;
    }
    if (preview.targetCanvas && preview.targetCanvas !== preview.canvas) {
      preview.targetContext.putImageData(preview.originalImageData, 0, 0);
      return true;
    }
    preview.context.putImageData(
      preview.originalImageData,
      preview.rect.x,
      preview.rect.y
    );
    return true;
  }

  refreshVisualEditPreviewGeometry(state = this.activeVisualEdit) {
    const preview = state?.preview;
    if (!preview?.canvas || !state?.inputDiv) {
      return preview || null;
    }

    const rectElement = state.galley?.element || state.inputDiv;
    const rect = getCanvasPixelRectForElement(rectElement, preview.canvas, {
      padding: !state.galley,
    });
    if (!rect?.width || !rect?.height) {
      return preview;
    }
    if (
      preview.rect?.x === rect.x &&
      preview.rect?.y === rect.y &&
      preview.rect?.width === rect.width &&
      preview.rect?.height === rect.height
    ) {
      return preview;
    }

    this.restoreVisualEditPreview(state);
    preview.rect = rect;
    if (preview.targetCanvas && preview.targetCanvas !== preview.canvas) {
      preview.targetCanvas.width = rect.width;
      preview.targetCanvas.height = rect.height;
      const cssRect = rectElement.getBoundingClientRect();
      preview.targetCanvas.style.width = `${cssRect.width}px`;
      preview.targetCanvas.style.height = `${cssRect.height}px`;
    }
    preview.originalImageData = preview.context.getImageData(
      rect.x,
      rect.y,
      rect.width,
      rect.height
    );
    return preview;
  }

  async updateVisualEditPreview(
    state = this.activeVisualEdit,
    generation = state?.previewGeneration,
    timing = null
  ) {
    if (!state || state !== this.activeVisualEdit || state.committing) {
      return null;
    }

    const replacementText = this.visualEditController.getReplacementText(state);
    const session = state.previewSession;
    if (!session) {
      return null;
    }
    session.pending = {
      generation,
      replacementText,
      previewDelay: timing?.previewDelay ?? null,
      scheduledAt: timing?.scheduledAt ?? null,
    };
    if (session.running) {
      return null;
    }

    session.running = true;
    try {
      let result = null;
      while (session.pending) {
        const job = session.pending;
        session.pending = null;
        result = await this.renderTextEditPreviewJob(state, session, job);
        session.lastResult = result;
      }
      return result;
    } finally {
      session.running = false;
      if (session.pending && state === this.activeVisualEdit) {
        this.updateVisualEditPreview(state, session.pending.generation).catch(
          reason =>
            console.warn(
              "PDFJSNativeTextEditDebug.updateVisualEditPreview:",
              reason
            )
        );
      }
    }
  }

  async renderTextEditPreviewJob(
    state,
    session,
    { generation, previewDelay = null, replacementText, scheduledAt = null }
  ) {
    const jobStartedAt = nowMs();
    const jobTiming = {
      debounceMs: roundMs(previewDelay),
      queueMs:
        typeof scheduledAt === "number"
          ? roundMs(Math.max(0, jobStartedAt - scheduledAt - previewDelay))
          : null,
      startDelayMs:
        typeof scheduledAt === "number"
          ? roundMs(jobStartedAt - scheduledAt)
          : null,
    };
    if (!state || state !== this.activeVisualEdit || state.committing) {
      return null;
    }
    if (replacementText === state.originalText) {
      this.restoreVisualEditPreview(state);
      this.clearDraftState();
      this.lastPreview = {
        ok: false,
        draftStale: false,
        draftValid: false,
        generation,
        reason: "pdfjs-native-text-edit-preview-unchanged",
        replacementText,
        timing: {
          ...jobTiming,
          totalMs: roundMs(nowMs() - jobStartedAt),
        },
      };
      return {
        ok: false,
        reason: "pdfjs-native-text-edit-preview-unchanged",
      };
    }

    const draft = await this.createVisualEditDraft({
      generation,
      replacementText,
      state,
    });
    session.lastDraftResult = draft;
    if (!draft.ok) {
      const timing = {
        ...jobTiming,
        draft: draft.timing || null,
        totalMs: roundMs(nowMs() - jobStartedAt),
      };
      this.handleRejectedVisualEditDraft({
        generation,
        reason: draft.reason,
        replacementText,
        result: {
          ...draft,
          timing,
        },
        state,
      });
      return {
        ...draft,
        timing,
      };
    }

    const renderStartedAt = nowMs();
    const useContentStreamPreviewPatch = canPreviewWithContentStreamPatch(
      draft.contentStreamPatches
    );
    await this.updateVisualEditPreviewLayout(state);
    const previewResult = await this.previewVisualEditRect({
      bytes: useContentStreamPreviewPatch ? null : draft.bytes,
      isCurrent: () =>
        generation === state.previewGeneration &&
        state === this.activeVisualEdit,
      preview: this.refreshVisualEditPreviewGeometry(state),
      previewMetadata: {
        draftStale: false,
        draftValid: true,
        generation,
        patches: draft.contentStreamPatches.length,
        reason: null,
        replacementText,
      },
      textEditContentStreamPatch: useContentStreamPreviewPatch
        ? draft.contentStreamPatches[0]
        : null,
    });
    const timing = {
      ...jobTiming,
      draft: draft.timing || null,
      preview: {
        ...(previewResult.previewTiming || null),
        totalMs: roundMs(nowMs() - renderStartedAt),
      },
      totalMs: roundMs(nowMs() - jobStartedAt),
    };
    if (!previewResult.ok) {
      const result = {
        ...previewResult,
        timing,
      };
      this.recordDraftDiagnostic(
        result,
        "preview",
        generation,
        replacementText
      );
      return result;
    }
    if (
      generation !== state.previewGeneration ||
      state !== this.activeVisualEdit
    ) {
      const result = {
        ok: false,
        draftStale: true,
        draftValid: false,
        generation,
        reason: "pdfjs-native-text-edit-preview-stale",
        replacementText,
        timing,
      };
      this.recordDraftDiagnostic(
        result,
        "preview",
        generation,
        replacementText
      );
      this.lastPreview = result;
      return result;
    }
    this.promoteDraftState({
      bytes: draft.bytes,
      generation,
      patches: draft.contentStreamPatches,
      plan: draft.plan,
      replacementText,
      timing: draft.timing,
      validation: draft.validation,
    });
    this.lastPreview = {
      ...previewResult,
      draftValid: true,
      committable: true,
      timing,
    };
    return this.lastPreview;
  }

  async createVisualEditDraft({ generation, replacementText, state }) {
    const draftStartedAt = nowMs();
    const timing = {
      patchCount: 0,
      planMs: null,
      saveMs: null,
      validateMs: null,
      totalMs: null,
    };
    const planStartedAt = nowMs();
    const editPlan = await this.planVisualEditCommit({
      replacementText,
      state,
      textDiv: state.textDiv,
    });
    timing.planMs = roundMs(nowMs() - planStartedAt);
    const { contentStreamPatches, plan } = editPlan;
    timing.patchCount = contentStreamPatches?.length || 0;
    if (
      !plan.ok ||
      !contentStreamPatches?.length ||
      generation !== state.previewGeneration ||
      state !== this.activeVisualEdit
    ) {
      let reason = "pdfjs-native-text-edit-preview-stale";
      if (!plan.ok) {
        reason = plan.reason;
      } else if (!contentStreamPatches?.length) {
        reason = "pdfjs-native-text-edit-content-stream-patch-missing";
      }
      return {
        ok: false,
        draftStale: reason.endsWith("-stale"),
        generation,
        plan,
        reason,
        replacementText,
        timing: {
          ...timing,
          totalMs: roundMs(nowMs() - draftStartedAt),
        },
      };
    }

    let bytes;
    try {
      const saveStartedAt = nowMs();
      bytes = await this.getCurrentPdfDocument().saveDocument({
        textEditPatches: contentStreamPatches,
      });
      timing.saveMs = roundMs(nowMs() - saveStartedAt);
    } catch (reason) {
      return {
        ok: false,
        generation,
        plan,
        reason: reason?.message || String(reason),
        replacementText,
        timing: {
          ...timing,
          totalMs: roundMs(nowMs() - draftStartedAt),
        },
      };
    }
    if (
      generation !== state.previewGeneration ||
      state !== this.activeVisualEdit
    ) {
      return {
        ok: false,
        draftStale: true,
        generation,
        plan,
        reason: "pdfjs-native-text-edit-preview-stale",
        replacementText,
        timing: {
          ...timing,
          totalMs: roundMs(nowMs() - draftStartedAt),
        },
      };
    }

    let validation = null;
    if (state.options.liveValidate === true) {
      try {
        const validateStartedAt = nowMs();
        validation = await this.validate(clonePdfBytes(bytes), {
          pageNumber:
            this.getPageViewForTextDiv(state.textDiv)?.id ||
            this.app.pdfViewer?.currentPageNumber ||
            1,
          replacementText,
        });
        timing.validateMs = roundMs(nowMs() - validateStartedAt);
      } catch (reason) {
        return {
          ok: false,
          generation,
          plan,
          reason: reason?.message || String(reason),
          replacementText,
          timing: {
            ...timing,
            totalMs: roundMs(nowMs() - draftStartedAt),
          },
        };
      }
      if (!validation.ok) {
        return {
          ok: false,
          generation,
          plan,
          reason:
            validation.reason ||
            "pdfjs-native-text-edit-draft-validation-failed",
          replacementText,
          timing: {
            ...timing,
            totalMs: roundMs(nowMs() - draftStartedAt),
          },
          validation,
        };
      }
    }
    if (
      generation !== state.previewGeneration ||
      state !== this.activeVisualEdit
    ) {
      return {
        ok: false,
        draftStale: true,
        generation,
        plan,
        reason: "pdfjs-native-text-edit-preview-stale",
        replacementText,
        timing: {
          ...timing,
          totalMs: roundMs(nowMs() - draftStartedAt),
        },
      };
    }

    timing.bytesLength = bytes?.length ?? bytes?.byteLength ?? null;
    timing.totalMs = roundMs(nowMs() - draftStartedAt);
    return {
      ok: true,
      bytes: clonePdfBytes(bytes),
      contentStreamPatches,
      generation,
      plan,
      replacementText,
      timing,
      validation,
    };
  }

  handleRejectedVisualEditDraft({
    generation,
    reason,
    replacementText,
    result,
    state,
  }) {
    this.recordDiagnostic(result, "draft");
    this.recordDraftDiagnostic(result, "draft", generation, replacementText);
    const status = this.getLastDraftCommitStatus(
      null,
      this.lastDraftReplacementText
    );
    const fallbackText = status.ok
      ? this.lastDraftReplacementText
      : state.originalText;
    const keepRejectedInput = shouldKeepRejectedReplacementInInput(result);
    if (
      generation === state.previewGeneration &&
      state === this.activeVisualEdit
    ) {
      if (
        !keepRejectedInput &&
        fallbackText !== replacementText &&
        !state.composing
      ) {
        this.visualEditController.setReplacementText(state, fallbackText, {
          caretIndex: fallbackText.length,
        });
        if (status.ok) {
          state.previewGeneration = this.lastDraftGeneration;
        }
      }
      if (!status.ok) {
        this.restoreVisualEditPreview(state);
      }
    }
    this.lastPreview = {
      ok: false,
      draftStale: result?.draftStale === true,
      draftValid: false,
      generation,
      reason,
      replacementText,
      timing: result?.timing || null,
    };
  }

  async previewVisualEditRect({
    bytes = this.lastBytes,
    isCurrent = null,
    preview = null,
    previewMetadata = null,
    textEditContentStreamPatch = null,
    textDiv = this.activeVisualEdit?.textDiv,
    pageNumber = this.getPageViewForTextDiv(textDiv)?.id ||
      this.app.pdfViewer?.currentPageNumber ||
      1,
  } = {}) {
    if (!bytes && !textEditContentStreamPatch) {
      throw new Error("pdfjs-native-text-edit-bytes-missing");
    }
    const pageView =
      preview?.pageView ||
      this.getPageViewForTextDiv(textDiv) ||
      this.getPageView(pageNumber);
    const visibleCanvas = preview?.canvas || pageView?.canvas;
    const targetCanvas = preview?.targetCanvas || visibleCanvas;
    if (!pageView?.viewport || !visibleCanvas) {
      throw new Error("pdfjs-native-text-edit-visible-canvas-missing");
    }
    const rect =
      preview?.rect || getCanvasPixelRectForElement(textDiv, visibleCanvas);
    if (!rect?.width || !rect?.height) {
      throw new Error("pdfjs-native-text-edit-preview-rect-missing");
    }

    const offscreen = document.createElement("canvas");
    offscreen.width = rect.width;
    offscreen.height = rect.height;
    const previewStartedAt = nowMs();
    const previewTiming = {
      destroyMs: null,
      documentLoadMs: null,
      drawMs: null,
      pageLoadMs: null,
      renderMs: null,
      totalMs: null,
    };
    try {
      const transform = [
        visibleCanvas.width / pageView.viewport.width,
        0,
        0,
        visibleCanvas.height / pageView.viewport.height,
        -rect.x,
        -rect.y,
      ];
      if (textEditContentStreamPatch) {
        const renderStartedAt = nowMs();
        await pageView.pdfPage.render({
          canvas: offscreen,
          textEditContentStreamPatch,
          transform,
          viewport: pageView.viewport,
        }).promise;
        previewTiming.renderMs = roundMs(nowMs() - renderStartedAt);
      } else {
        const loadingTask = getDocument({
          ...AppOptions.getAll(OptionKind.API),
          data: clonePdfBytes(bytes),
        });
        try {
          const documentLoadStartedAt = nowMs();
          const pdfDocument = await loadingTask.promise;
          previewTiming.documentLoadMs = roundMs(
            nowMs() - documentLoadStartedAt
          );
          const pageLoadStartedAt = nowMs();
          const pdfPage = await pdfDocument.getPage(pageView.id);
          previewTiming.pageLoadMs = roundMs(nowMs() - pageLoadStartedAt);
          const renderStartedAt = nowMs();
          await pdfPage.render({
            canvas: offscreen,
            transform,
            viewport: pageView.viewport,
          }).promise;
          previewTiming.renderMs = roundMs(nowMs() - renderStartedAt);
        } finally {
          const destroyStartedAt = nowMs();
          await loadingTask.destroy();
          previewTiming.destroyMs = roundMs(nowMs() - destroyStartedAt);
        }
      }
      previewTiming.totalMs = roundMs(nowMs() - previewStartedAt);
      if (isCurrent && !isCurrent()) {
        return (this.lastPreview = {
          ok: false,
          ...(previewMetadata || null),
          draftStale: true,
          draftValid: false,
          previewTiming,
          reason: "pdfjs-native-text-edit-preview-stale",
        });
      }

      const context =
        preview?.targetContext ||
        targetCanvas.getContext("2d", {
          alpha: targetCanvas !== visibleCanvas,
        });
      const drawStartedAt = nowMs();
      if (targetCanvas === visibleCanvas) {
        context.drawImage(
          offscreen,
          0,
          0,
          rect.width,
          rect.height,
          rect.x,
          rect.y,
          rect.width,
          rect.height
        );
      } else {
        context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        context.drawImage(
          offscreen,
          0,
          0,
          rect.width,
          rect.height,
          0,
          0,
          targetCanvas.width,
          targetCanvas.height
        );
      }
      previewTiming.drawMs = roundMs(nowMs() - drawStartedAt);
      previewTiming.totalMs = roundMs(nowMs() - previewStartedAt);
      return (this.lastPreview = {
        ok: true,
        ...(previewMetadata || null),
        pageNumber: pageView.id,
        previewTiming,
        rect,
        target: targetCanvas === visibleCanvas ? "page" : "galley",
      });
    } finally {
      offscreen.width = offscreen.height = 0;
    }
  }

  async renderSavedPageRectAndReconcileTextLayer({
    bytes = this.lastBytes,
    pageNumber = this.app.pdfViewer?.currentPageNumber || 1,
    preview = null,
  } = {}) {
    if (!bytes) {
      throw new Error("pdfjs-native-text-edit-bytes-missing");
    }

    const pageView = preview?.pageView || this.getPageView(pageNumber);
    const visibleCanvas = preview?.canvas || pageView?.canvas;
    const rect = normalizeCanvasPixelRect(preview?.rect, visibleCanvas);
    if (!pageView?.viewport || !visibleCanvas) {
      throw new Error("pdfjs-native-text-edit-visible-canvas-missing");
    }
    if (!rect?.width || !rect?.height) {
      throw new Error("pdfjs-native-text-edit-partial-redraw-rect-missing");
    }
    if (!pageView.textLayer) {
      throw new Error("pdfjs-native-text-edit-text-layer-missing");
    }

    const timing = {
      destroyMs: null,
      documentLoadMs: null,
      drawMs: null,
      pageLoadMs: null,
      renderMs: null,
      textLayerMs: null,
      totalMs: null,
    };
    const startedAt = nowMs();
    const loadingTask = getDocument({
      ...AppOptions.getAll(OptionKind.API),
      data: clonePdfBytes(bytes),
    });
    const previousLoadingTask = this.currentLoadingTask;
    const previousPdfDocument = this.currentPdfDocument;
    const previousPdfPage = pageView.pdfPage;
    const previousPdfPageRotate = pageView.pdfPageRotate;
    const offscreen = document.createElement("canvas");
    let promotedSavedDocument = false;
    try {
      const documentLoadStartedAt = nowMs();
      const pdfDocument = await loadingTask.promise;
      timing.documentLoadMs = roundMs(nowMs() - documentLoadStartedAt);

      const pageLoadStartedAt = nowMs();
      const pdfPage = await pdfDocument.getPage(pageNumber);
      timing.pageLoadMs = roundMs(nowMs() - pageLoadStartedAt);

      offscreen.width = rect.width;
      offscreen.height = rect.height;
      const transform = [
        visibleCanvas.width / pageView.viewport.width,
        0,
        0,
        visibleCanvas.height / pageView.viewport.height,
        -rect.x,
        -rect.y,
      ];
      const renderStartedAt = nowMs();
      await pdfPage.render({
        canvas: offscreen,
        transform,
        viewport: pageView.viewport,
      }).promise;
      timing.renderMs = roundMs(nowMs() - renderStartedAt);

      const context = visibleCanvas.getContext("2d", { alpha: false });
      const drawStartedAt = nowMs();
      context.drawImage(
        offscreen,
        0,
        0,
        rect.width,
        rect.height,
        rect.x,
        rect.y,
        rect.width,
        rect.height
      );
      timing.drawMs = roundMs(nowMs() - drawStartedAt);

      this.currentLoadingTask = loadingTask;
      this.currentPdfDocument = pdfDocument;
      promotedSavedDocument = true;
      pageView.pdfPage = pdfPage;
      pageView.textLayer.pdfPage = pdfPage;

      const textLayerStartedAt = nowMs();
      this.clearEditableTextDivs(pageNumber);
      pageView.textLayer.cancel();
      await pageView.textLayer.render({
        viewport: pageView.viewport,
        images: null,
        textContentParams: {
          disableNormalization: true,
          includeTextEditSourceRefs: true,
        },
      });
      this.markEditableTextDivs(pageNumber);
      timing.textLayerMs = roundMs(nowMs() - textLayerStartedAt);

      const destroyStartedAt = nowMs();
      await previousLoadingTask?.destroy();
      timing.destroyMs = roundMs(nowMs() - destroyStartedAt);
      timing.totalMs = roundMs(nowMs() - startedAt);
      return {
        ok: true,
        pageNumber,
        rect,
        timing,
      };
    } catch (reason) {
      if (promotedSavedDocument && this.currentLoadingTask === loadingTask) {
        this.currentLoadingTask = previousLoadingTask;
        this.currentPdfDocument = previousPdfDocument;
        pageView.pdfPage = previousPdfPage;
        pageView.pdfPageRotate = previousPdfPageRotate;
      }
      await loadingTask.destroy();
      throw reason;
    } finally {
      offscreen.width = offscreen.height = 0;
    }
  }

  async save({
    patches = this.patches,
    download = false,
    filename = "pdfjs-native-text-edit.pdf",
    reopen = false,
    validate = true,
    validateOptions = null,
  } = {}) {
    if (!patches?.length) {
      throw new Error("pdfjs-native-text-edit-patches-missing");
    }
    let bytes;
    try {
      bytes = await this.getCurrentPdfDocument().saveDocument({
        textEditPatches: patches,
      });
    } catch (reason) {
      this.recordDiagnostic(
        {
          reason: reason?.message || String(reason),
          unsupported: getNativeTextEditUnsupportedSummary({
            contentStreamPatch: patches[0],
          }),
        },
        "save"
      );
      throw reason;
    }
    this.lastBytes = clonePdfBytes(bytes);
    if (validate) {
      const validation = await this.validate(
        clonePdfBytes(this.lastBytes),
        validateOptions || undefined
      );
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
    }
    if (download) {
      this.download(filename);
    }
    if (reopen) {
      await this.destroyCurrentPdfDocument();
      await this.app.open({ data: clonePdfBytes(this.lastBytes), filename });
    }
    return clonePdfBytes(this.lastBytes);
  }

  async reconcilePageTextLayer({
    bytes = this.lastBytes,
    pageNumber = this.app.pdfViewer?.currentPageNumber || 1,
    redrawPage = false,
  } = {}) {
    if (!bytes) {
      throw new Error("pdfjs-native-text-edit-bytes-missing");
    }

    const pageView = this.getPageView(pageNumber);
    if (!pageView || (!redrawPage && !pageView.textLayer)) {
      throw new Error("pdfjs-native-text-edit-text-layer-missing");
    }

    const loadingTask = getDocument({
      ...AppOptions.getAll(OptionKind.API),
      data: clonePdfBytes(bytes),
    });
    const previousLoadingTask = this.currentLoadingTask;
    const previousPdfDocument = this.currentPdfDocument;
    const previousPdfPage = pageView.pdfPage;
    const previousPdfPageRotate = pageView.pdfPageRotate;
    try {
      const pdfDocument = await loadingTask.promise;
      const pdfPage = await pdfDocument.getPage(pageNumber);

      this.currentLoadingTask = loadingTask;
      this.currentPdfDocument = pdfDocument;
      if (redrawPage) {
        pageView.setPdfPage(pdfPage);
        await pageView.draw();
        this.markEditableTextDivs(pageNumber);
      } else {
        pageView.pdfPage = pdfPage;
        pageView.textLayer.pdfPage = pdfPage;

        this.clearEditableTextDivs(pageNumber);
        pageView.textLayer.cancel();
        await pageView.textLayer.render({
          viewport: pageView.viewport,
          images: null,
          textContentParams: {
            disableNormalization: true,
            includeTextEditSourceRefs: true,
          },
        });
        this.markEditableTextDivs(pageNumber);
      }
      await previousLoadingTask?.destroy();
      return {
        ok: true,
        pageNumber,
        redrawPage,
      };
    } catch (reason) {
      if (this.currentLoadingTask === loadingTask) {
        this.currentLoadingTask = previousLoadingTask;
        this.currentPdfDocument = previousPdfDocument;
        if (redrawPage && previousPdfPage) {
          pageView.setPdfPage(previousPdfPage);
        } else {
          pageView.pdfPage = previousPdfPage;
        }
        pageView.pdfPageRotate = previousPdfPageRotate;
      }
      await loadingTask.destroy();
      throw reason;
    }
  }

  async validate(
    bytes = this.lastBytes,
    {
      allowXObjectFormReplacementAnchor = false,
      pageNumber = this.app.pdfViewer?.currentPageNumber || 1,
      replacementText = this.lastReplacementText,
    } = {}
  ) {
    if (!bytes) {
      throw new Error("pdfjs-native-text-edit-bytes-missing");
    }
    if (typeof replacementText !== "string") {
      throw new Error("pdfjs-native-text-edit-replacement-text-missing");
    }

    const loadingTask = getDocument({
      ...AppOptions.getAll(OptionKind.API),
      data: clonePdfBytes(bytes),
    });
    try {
      const pdfDocument = await loadingTask.promise;
      const pdfPage = await pdfDocument.getPage(pageNumber);
      const textContent = await pdfPage.getTextContent({
        disableNormalization: true,
        includeTextEditSourceRefs: true,
      });
      const text = textContent.items.map(({ str = "" }) => str).join("");
      const replacementLines = normalizeBlockReplacementText(replacementText)
        .split("\n")
        .filter(line => line.length > 0);
      const searchableReplacementText =
        replacementText.replaceAll(/\s+$/g, "") || replacementText;
      const findReplacementItem = value => {
        const searchableValue = value.replaceAll(/\s+$/g, "") || value;
        return textContent.items.find(
          item => item.str === value || item.str === searchableValue
        );
      };
      const replacementItem = findReplacementItem(replacementText);
      const replacementPresent =
        text.includes(replacementText) ||
        text.includes(searchableReplacementText) ||
        (replacementLines.length > 1 &&
          replacementLines.every(line => {
            const searchableLine = line.replaceAll(/\s+$/g, "") || line;
            return text.includes(line) || text.includes(searchableLine);
          }));
      const replacementAnchorEditable =
        replacementLines.length > 1
          ? replacementLines.every(line =>
              isNativeTextEditReplacementAnchorEditable(
                findReplacementItem(line),
                { allowXObjectFormReplacementAnchor }
              )
            )
          : isNativeTextEditReplacementAnchorEditable(replacementItem, {
              allowXObjectFormReplacementAnchor,
            });
      let reason = null;
      if (!replacementPresent) {
        reason = "pdfjs-native-text-edit-replacement-text-missing-after-save";
      } else if (!replacementAnchorEditable) {
        reason = "pdfjs-native-text-edit-replacement-anchor-not-editable";
      }
      return (this.lastValidation = {
        ok: replacementPresent && replacementAnchorEditable,
        reason,
        text,
      });
    } finally {
      await loadingTask.destroy();
    }
  }

  download(filename = "pdfjs-native-text-edit.pdf") {
    if (!this.lastBytes) {
      throw new Error("pdfjs-native-text-edit-bytes-missing");
    }
    this.app.downloadManager.downloadData(
      clonePdfBytes(this.lastBytes),
      filename,
      "application/pdf"
    );
  }

  async reopen(filename = "pdfjs-native-text-edit.pdf") {
    if (!this.lastBytes) {
      throw new Error("pdfjs-native-text-edit-bytes-missing");
    }
    await this.destroyCurrentPdfDocument();
    await this.app.open({ data: clonePdfBytes(this.lastBytes), filename });
  }

  refreshTextLayers() {
    for (let i = 0, ii = this.app.pdfViewer?.pagesCount || 0; i < ii; i++) {
      const pageView = this.app.pdfViewer.getPageView(i);
      pageView?.reset({
        keepAnnotationLayer: true,
        keepAnnotationEditorLayer: true,
        keepXfaLayer: true,
        keepCanvasWrapper: true,
      });
    }
    this.app.pdfViewer?.forceRendering();
  }

  refreshPageTextLayer(pageNumber = this.visualOptions.pageNumber) {
    const pageView = this.getPageView(pageNumber);
    if (!pageView) {
      return;
    }
    this.clearEditableTextDivs(pageNumber);
    pageView.reset({
      keepAnnotationLayer: true,
      keepAnnotationEditorLayer: true,
      keepXfaLayer: true,
      keepCanvasWrapper: true,
    });
    this.app.pdfViewer?.forceRendering();
  }

  captureVisualEditCanvasState(textDiv, blockCandidate = null) {
    const pageView = this.getPageViewForTextDiv(textDiv);
    const canvas = pageView?.canvas;
    if (!canvas) {
      return null;
    }
    const blockRect = getBlockClientRect(blockCandidate);
    const rect = blockRect
      ? getCanvasPixelRectForClientRect(blockRect, canvas)
      : getCanvasPixelRectForElement(textDiv, canvas);
    if (!rect?.width || !rect?.height) {
      return null;
    }
    return this.captureVisualEditCanvasRect({ canvas, pageView, rect });
  }

  captureVisualEditElementCanvasState({
    element,
    padding = true,
    textDiv = this.activeVisualEdit?.textDiv,
  } = {}) {
    const pageView = this.getPageViewForTextDiv(textDiv);
    const canvas = pageView?.canvas;
    if (!canvas || !element) {
      return null;
    }
    return captureNativeTextEditPagePreviewSurface({
      canvas,
      element,
      pageView,
      padding,
    });
  }

  captureVisualEditCanvasRect({ canvas, pageView, rect }) {
    if (!canvas || !rect?.width || !rect?.height) {
      return null;
    }
    const context = canvas.getContext("2d", { alpha: false });
    return {
      canvas,
      context,
      originalImageData: context.getImageData(
        rect.x,
        rect.y,
        rect.width,
        rect.height
      ),
      pageView,
      rect,
    };
  }

  captureVisualEditGalleyCanvasState(state = this.activeVisualEdit) {
    const pageView = this.getPageViewForTextDiv(state?.textDiv);
    const canvas = pageView?.canvas;
    const targetCanvas = state?.galley?.canvas;
    const targetElement = state?.galley?.element;
    return captureNativeTextEditOverlayPreviewSurface({
      canvas,
      pageView,
      targetCanvas,
      targetElement,
    });
  }
}

export {
  combineLinePreservingBlockContentStreamPatches,
  getLinePreservingBlockReplacements,
  isNativeTextEditBlockInteractive,
  NativeTextEditService,
  shouldRenderNativeTextEditBlockMarker,
};
