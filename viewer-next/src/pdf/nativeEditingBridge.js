import {
  NativeRedactController,
  NativeTextEditController,
  NativeTextEditService,
  setNativeRedactModeForApplication,
  setNativeTextEditModeForApplication,
  syncNativeRedactModePageForApplication,
  syncNativeTextEditModePageForApplication,
} from "@rewirepdf/pdfjs/viewer-core";

function clonePdfBytes(bytes) {
  if (!bytes) {
    return null;
  }
  if (bytes instanceof Uint8Array) {
    return bytes.slice();
  }
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }
  return new Uint8Array(bytes);
}

function createInitialNativeState() {
  return {
    message: "",
    redactionPatches: 0,
    redactActive: false,
    redactPageNumber: null,
    textEditEditableCount: 0,
    textEditActive: false,
    textEditCommitted: false,
    textEditPageNumber: null,
    textEditUnsupportedCount: 0,
  };
}

export function createNativeEditingBridge({
  downloadManager,
  emitState,
  eventBus,
  filename,
  getPdfDocument,
  openDocument,
  pdfViewer,
}) {
  const previousNativeTextEditDebug = globalThis.PDFJSNativeTextEditDebug;
  globalThis.PDFJSNativeTextEditDebug = {
    ...(previousNativeTextEditDebug || null),
    enabled: true,
  };

  let nativeTextEditController = null;
  let nativeTextEditService = null;
  let nativeRedactController = null;
  let nativeRedactExportPatch = null;
  let nativeRedactExportPatches = null;
  let nativeRedactRegionsByPage = null;
  let state = createInitialNativeState();

  function readNativeTextEditCounts() {
    const pageView = state.textEditPageNumber
      ? pdfViewer?.getPageView(state.textEditPageNumber - 1)
      : null;
    const textLayerDiv = pageView?.textLayer?.div;
    if (!textLayerDiv) {
      return {
        textEditEditableCount: 0,
        textEditUnsupportedCount: 0,
      };
    }
    return {
      textEditEditableCount: textLayerDiv.querySelectorAll(
        "[data-pdfjs-native-text-editable='true']"
      ).length,
      textEditUnsupportedCount: textLayerDiv.querySelectorAll(
        "[data-pdfjs-native-text-edit-unsupported-reason]"
      ).length,
    };
  }

  function updateState(nextState = {}) {
    state = {
      ...state,
      ...nextState,
      redactionPatches: getNativeRedactExportPatches().length,
      textEditCommitted:
        nativeTextEditService?.hasCommittedBytes?.() === true ||
        Boolean(nextState.textEditCommitted),
    };
    emitState();
  }

  function refreshNativeTextEditCapabilityState(message = null) {
    const counts = readNativeTextEditCounts();
    updateState({
      ...counts,
      ...(message !== null ? { message } : null),
    });
  }

  const app = {
    downloadManager,
    eventBus,
    pdfViewer,
    get pdfDocument() {
      return getPdfDocument();
    },
    get _nativeTextEditPageNumber() {
      return state.textEditPageNumber;
    },
    set _nativeTextEditPageNumber(pageNumber) {
      updateState({
        textEditActive: pageNumber !== null,
        textEditPageNumber: pageNumber,
      });
    },
    get _nativeRedactPageNumber() {
      return state.redactPageNumber;
    },
    set _nativeRedactPageNumber(pageNumber) {
      updateState({
        redactActive: pageNumber !== null,
        redactPageNumber: pageNumber,
      });
    },
    ensureNativeTextEditController(services) {
      if (nativeTextEditController) {
        return nativeTextEditController.setServices(services);
      }
      return (nativeTextEditController = new NativeTextEditController(services));
    },
    ensureNativeTextEditService() {
      return (
        nativeTextEditService ||
        (nativeTextEditService = new NativeTextEditService(app))
      );
    },
    ensureNativeRedactController() {
      const services = {
        getPageView: pageNumber => pdfViewer?.getPageView(pageNumber - 1),
        onRegionSelected: report => planNativeRedactRegion(report),
      };
      if (nativeRedactController) {
        return nativeRedactController.setServices(services);
      }
      return (nativeRedactController = new NativeRedactController(services));
    },
    getNativeRedactExportPatches,
    async open({ data, filename: nextFilename }) {
      await openDocument({
        data: clonePdfBytes(data),
        filename: nextFilename || filename,
      });
    },
    setNativeRedactMode,
    setNativeTextEditMode,
    setTitle() {
      updateState({
        message: "Native text edit changes are ready to save.",
      });
    },
    updateNativeRedactButton() {
      updateState({
        redactActive: state.redactPageNumber === pdfViewer?.currentPageNumber,
      });
    },
    updateNativeTextEditButton() {
      updateState({
        textEditActive:
          state.textEditPageNumber === pdfViewer?.currentPageNumber,
      });
      refreshNativeTextEditCapabilityState();
    },
  };

  function getNativeRedactExportPatches() {
    if (nativeRedactExportPatches?.size > 0) {
      return Array.from(nativeRedactExportPatches.values()).sort(
        (a, b) => a.pageIndex - b.pageIndex
      );
    }
    return nativeRedactExportPatch ? [nativeRedactExportPatch] : [];
  }

  function getCommittedBytes() {
    return nativeTextEditService?.getCommittedBytes?.() || null;
  }

  async function getRedactedBytes() {
    const pdfDocument = getPdfDocument();
    const redactionPatches = getNativeRedactExportPatches();
    if (!pdfDocument || redactionPatches.length === 0) {
      return null;
    }
    return pdfDocument.exportRedactedDocument(redactionPatches);
  }

  function getState() {
    return state;
  }

  async function planNativeRedactRegion(selection) {
    const pdfDocument = getPdfDocument();
    try {
      nativeRedactExportPatches ||= new Map();
      nativeRedactRegionsByPage ||= new Map();
      if (!selection.regions?.length) {
        nativeRedactExportPatches.delete(selection.pageNumber - 1);
        nativeRedactRegionsByPage.delete(selection.pageNumber);
        nativeRedactExportPatch = null;
        updateState({
          message: "Native redact selection cleared.",
        });
        return;
      }
      nativeRedactRegionsByPage.set(selection.pageNumber, {
        regions: selection.regions,
        viewportRegions: selection.viewportRegions || [],
      });
      const page = await pdfDocument.getPage(selection.pageNumber);
      const result = await page.planRedaction({
        regions: selection.regions,
        includeDecodedStreamPatch: true,
      });
      if (result.ok && result.decodedStreamPatch?.decodedBytes) {
        const patch = {
          pageIndex: selection.pageNumber - 1,
          decodedBytes: result.decodedStreamPatch.decodedBytes,
        };
        nativeRedactExportPatches.set(patch.pageIndex, patch);
        nativeRedactExportPatch = patch;
      } else {
        nativeRedactExportPatches.delete(selection.pageNumber - 1);
        nativeRedactExportPatch = null;
      }
      updateState({
        message: result.ok
          ? "Native redact preview ready for download."
          : `Native redact unavailable: ${result.reason || "unknown"}.`,
      });
    } catch (reason) {
      console.error("ViewerNextNativeEditing.planNativeRedactRegion:", reason);
      updateState({
        message: `Native redact failed: ${reason?.message || "unknown"}.`,
      });
    }
  }

  function setNativeRedactMode(enabled) {
    if (enabled) {
      setNativeTextEditMode(false);
    }
    setNativeRedactModeForApplication(app, enabled);
  }

  function setNativeTextEditMode(enabled) {
    if (enabled) {
      setNativeRedactMode(false);
    }
    setNativeTextEditModeForApplication(app, enabled);
    requestAnimationFrame(() => {
      if (!enabled) {
        updateState({
          textEditEditableCount: 0,
          textEditUnsupportedCount: 0,
        });
        return;
      }
      const counts = readNativeTextEditCounts();
      refreshNativeTextEditCapabilityState(
        counts.textEditEditableCount > 0
          ? ""
          : "Native text edit has no editable source refs on this page."
      );
    });
    setTimeout(() => {
      if (enabled && state.textEditActive) {
        const counts = readNativeTextEditCounts();
        refreshNativeTextEditCapabilityState(
          counts.textEditEditableCount > 0
            ? ""
            : "Native text edit has no editable source refs on this page."
        );
      }
    }, 600);
  }

  function syncPage(pageNumber = pdfViewer.currentPageNumber) {
    syncNativeTextEditModePageForApplication(app, pageNumber);
    syncNativeRedactModePageForApplication(app, pageNumber);
  }

  function onPageChanging(event) {
    syncPage(event.pageNumber);
  }

  function onTextLayerRendered(event) {
    if (event.pageNumber === state.textEditPageNumber) {
      requestAnimationFrame(() => {
        const counts = readNativeTextEditCounts();
        updateState({
          ...counts,
          ...(counts.textEditEditableCount > 0 ? { message: "" } : null),
        });
      });
    }
  }

  eventBus.on("pagechanging", onPageChanging);
  eventBus.on("textlayerrendered", onTextLayerRendered);

  return {
    disable() {
      setNativeTextEditMode(false);
      setNativeRedactMode(false);
    },
    getCommittedBytes,
    getRedactedBytes,
    getRedactionPatches: getNativeRedactExportPatches,
    getState,
    setNativeRedactMode,
    setNativeTextEditMode,
    toggleNativeRedactMode() {
      setNativeRedactMode(
        state.redactPageNumber !== pdfViewer.currentPageNumber
      );
    },
    toggleNativeTextEditMode() {
      setNativeTextEditMode(
        state.textEditPageNumber !== pdfViewer.currentPageNumber
      );
    },
    destroy() {
      eventBus.off("pagechanging", onPageChanging);
      eventBus.off("textlayerrendered", onTextLayerRendered);
      nativeTextEditService?.disableVisualEditing?.();
      nativeTextEditService?.clear?.();
      nativeRedactController?.disable?.();
      if (previousNativeTextEditDebug === undefined) {
        delete globalThis.PDFJSNativeTextEditDebug;
      } else {
        globalThis.PDFJSNativeTextEditDebug = previousNativeTextEditDebug;
      }
    },
  };
}
