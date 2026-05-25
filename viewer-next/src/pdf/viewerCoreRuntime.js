import {
  DownloadManager,
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFRenderingQueue,
  PDFViewer,
} from "@rewirepdf/pdfjs/viewer-core";
import { GenericL10n } from "./nullL10n.js";

const DEFAULT_HIGHLIGHT_EDITOR_COLORS =
  "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F," +
  "yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue=#80EBFF,pink_HCM=#F6B8FF,red=#C50043";

export function createViewerCoreEventBus() {
  return new EventBus();
}

export function createViewerCoreRuntime({
  commentManager = null,
  container,
  eventBus = createViewerCoreEventBus(),
  signatureManager = null,
  viewer,
}) {
  const downloadManager = new DownloadManager();
  const linkService = new PDFLinkService({ eventBus });
  const findController = new PDFFindController({
    eventBus,
    linkService,
  });
  const renderingQueue = new PDFRenderingQueue();

  const pdfViewer = new PDFViewer({
    container,
    viewer,
    eventBus,
    linkService,
    findController,
    commentManager,
    downloadManager,
    annotationEditorHighlightColors: DEFAULT_HIGHLIGHT_EDITOR_COLORS,
    l10n: new GenericL10n(),
    renderingQueue,
    signatureManager,
    removePageBorders: true,
  });

  renderingQueue.setViewer(pdfViewer);
  linkService.setViewer(pdfViewer);

  return {
    downloadManager,
    eventBus,
    findController,
    linkService,
    pdfViewer,
    renderingQueue,
  };
}
