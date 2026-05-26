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
const allowedExternalLinkProtocols = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

function getExternalLinkInfo(url) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url, window.location.href);
  } catch {}

  if (!parsedUrl) {
    return {
      displayUrl: url,
      isAllowed: false,
      site: url,
      url,
    };
  }

  if (parsedUrl.username || parsedUrl.password) {
    parsedUrl.username = "";
    parsedUrl.password = "";
  }

  const site =
    parsedUrl.protocol === "mailto:"
      ? parsedUrl.pathname
      : parsedUrl.hostname || parsedUrl.protocol.replace(/:$/, "");

  return {
    displayUrl: parsedUrl.href,
    isAllowed: allowedExternalLinkProtocols.has(parsedUrl.protocol),
    site,
    url: parsedUrl.href,
  };
}

class ViewerNextPDFLinkService extends PDFLinkService {
  constructor({ onExternalLinkRequest = null, ...options } = {}) {
    super(options);
    this.onExternalLinkRequest = onExternalLinkRequest;
  }

  addLinkAttributes(link, url) {
    super.addLinkAttributes(link, url, true);

    if (!this.externalLinkEnabled || !this.onExternalLinkRequest) {
      return;
    }

    const linkInfo = getExternalLinkInfo(url);
    link.href = linkInfo.url;
    link.title = linkInfo.displayUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow";
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.onExternalLinkRequest(linkInfo);
    });
  }
}

export function createViewerCoreEventBus() {
  return new EventBus();
}

export function createViewerCoreRuntime({
  commentManager = null,
  container,
  eventBus = createViewerCoreEventBus(),
  onExternalLinkRequest = null,
  signatureManager = null,
  viewer,
}) {
  const downloadManager = new DownloadManager();
  const linkService = new ViewerNextPDFLinkService({
    eventBus,
    onExternalLinkRequest,
  });
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
