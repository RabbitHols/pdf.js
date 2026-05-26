import * as pdfjsLib from "@rewirepdf/pdfjs";

globalThis.pdfjsLib ||= pdfjsLib;

const viewerCore = await import("../../../build/components/pdf_viewer.mjs");

export const {
  DownloadManager,
  EventBus,
  FindState,
  NativeRedactController,
  NativeTextEditController,
  NativeTextEditService,
  PDFFindController,
  PDFLinkService,
  PDFRenderingQueue,
  PDFViewer,
  PagesMapper,
  normalize,
  normalizeWheelEventDirection,
  setNativeRedactModeForApplication,
  setNativeTextEditModeForApplication,
  syncNativeRedactModePageForApplication,
  syncNativeTextEditModePageForApplication,
} = viewerCore;
