export { DownloadManager } from "../../../web/download_manager.js";
export { EventBus } from "../../../web/event_utils.js";
export {
  FindState,
  normalize,
  PDFFindController,
} from "../../../web/pdf_find_controller.js";
export { PDFLinkService } from "../../../web/pdf_link_service.js";
export { PDFRenderingQueue } from "../../../web/pdf_rendering_queue.js";
export { PDFViewer } from "../../../web/pdf_viewer.js";
export { normalizeWheelEventDirection } from "../../../web/ui_utils.js";
export { PagesMapper } from "../../../src/display/pages_mapper.js";

class NativeControllerStub {
  constructor(services = {}) {
    this.services = services;
  }

  setServices(services = {}) {
    this.services = services;
    return this;
  }

  clear() {}

  disable() {}
}

class NativeTextEditServiceStub {
  hasCommittedBytes() {
    return false;
  }

  getCommittedBytes() {
    return null;
  }

  clear() {}

  disableVisualEditing() {}
}

function setNativeTextEditModeForApplication(app, enabled) {
  app._nativeTextEditPageNumber = enabled
    ? app.pdfViewer?.currentPageNumber || null
    : null;
  app.updateNativeTextEditButton?.();
}

function setNativeRedactModeForApplication(app, enabled) {
  app._nativeRedactPageNumber = enabled
    ? app.pdfViewer?.currentPageNumber || null
    : null;
  app.updateNativeRedactButton?.();
}

function syncNativeTextEditModePageForApplication(app, pageNumber) {
  if (app._nativeTextEditPageNumber !== null) {
    app._nativeTextEditPageNumber = pageNumber;
  }
}

function syncNativeRedactModePageForApplication(app, pageNumber) {
  if (app._nativeRedactPageNumber !== null) {
    app._nativeRedactPageNumber = pageNumber;
  }
}

export {
  NativeControllerStub as NativeRedactController,
  NativeControllerStub as NativeTextEditController,
  NativeTextEditServiceStub as NativeTextEditService,
  setNativeRedactModeForApplication,
  setNativeTextEditModeForApplication,
  syncNativeRedactModePageForApplication,
  syncNativeTextEditModePageForApplication,
};
