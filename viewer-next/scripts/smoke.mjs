import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const pdfjsRepoRoot = path.resolve(appRoot, "..");
const port = Number(process.env.VIEWER_NEXT_SMOKE_PORT || 8765);
const host = "127.0.0.1";
const directViewerPath = "/build/generic/viewer-next/index.html";

function directViewerUrl(view) {
  return `http://${host}:${port}${directViewerPath}?view=${view}`;
}

const contentTypes = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".mjs", "text/javascript"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}

function createStaticServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`);
    const decodedPath = decodeURIComponent(url.pathname);
    const filePath = path.resolve(
      pdfjsRepoRoot,
      decodedPath === "/" ? directViewerPath.slice(1) : decodedPath.slice(1)
    );

    if (!filePath.startsWith(pdfjsRepoRoot)) {
      sendNotFound(response);
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        sendNotFound(response);
        return;
      }
      response.writeHead(200, {
        "Content-Length": fileStat.size,
        "Content-Type":
          contentTypes.get(path.extname(filePath)) ||
          "application/octet-stream",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
    } catch {
      sendNotFound(response);
    }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

async function installBrowserSpies(page) {
  await page.evaluateOnNewDocument(() => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    window.__viewerNextDownloads = [];
    window.__viewerNextPrintCalls = 0;
    URL.createObjectURL = object => {
      if (object instanceof Blob && object.type === "application/pdf") {
        object.arrayBuffer().then(buffer => {
          window.__viewerNextDownloads.push({
            bytes: Array.from(new Uint8Array(buffer)),
            size: object.size,
            type: object.type,
          });
        });
      }
      return originalCreateObjectURL(object);
    };
    window.print = () => {
      window.__viewerNextPrintCalls += 1;
    };
    if (!localStorage.getItem("rewirepdf.viewerNext.locale")) {
      localStorage.setItem("rewirepdf.viewerNext.locale", "en");
    }
    localStorage.removeItem("rewirepdf.viewerNext.stampIdentity");
  });
}

async function waitForDownloadCount(page, count) {
  await page.waitForFunction(
    expectedCount => window.__viewerNextDownloads?.length >= expectedCount,
    { timeout: 15000 },
    count
  );
  return page.evaluate(index => window.__viewerNextDownloads[index], count - 1);
}

async function openPdfBytesInViewer(browser, { bytes, name }) {
  const viewerPage = await browser.newPage();
  await viewerPage.goto(directViewerUrl("home"), { waitUntil: "networkidle0" });
  await viewerPage.evaluate(
    ({ bytes: pdfBytes, name: pdfName }) => {
      localStorage.setItem(
        "rewirepdf.viewerNext.preferences",
        JSON.stringify({
          defaultExportFilename: "{name}-edited.pdf",
          rememberRecentDocuments: false,
        })
      );
      localStorage.removeItem("rewirepdf.viewerNext.pdfTabs");
      localStorage.removeItem("rewirepdf.viewerNext.activePdfTab");

      function bytesToBase64(bytesArray) {
        const chunkSize = 0x8000;
        let binary = "";
        for (let i = 0; i < bytesArray.length; i += chunkSize) {
          binary += String.fromCharCode(...bytesArray.slice(i, i + chunkSize));
        }
        return btoa(binary);
      }

      const metadata = {
        id: `smoke-${Date.now()}`,
        name: pdfName,
        openedAt: Date.now(),
        size: pdfBytes.length,
        type: "application/pdf",
        bytes: bytesToBase64(pdfBytes),
      };
      sessionStorage.setItem(
        "rewirepdf.viewerNext.pdfTabs",
        JSON.stringify([metadata])
      );
      sessionStorage.setItem("rewirepdf.viewerNext.activePdfTab", metadata.id);
      sessionStorage.setItem(
        "rewirepdf.viewerNext.pendingPdf",
        JSON.stringify(metadata)
      );
    },
    { bytes, name }
  );
  await viewerPage.goto(directViewerUrl("edit"), { waitUntil: "networkidle0" });
  await viewerPage.waitForSelector(".pdfViewer .page canvas", {
    timeout: 15000,
  });
  await viewerPage.waitForSelector(".textLayer", { timeout: 15000 });
  return viewerPage;
}

async function openSearchControl(page) {
  const searchInput = await page.$('input[aria-label="Search PDF"]');
  if (searchInput) {
    return;
  }
  await page.click('.edit-right-rail button[aria-label="Search"]');
  await page.waitForSelector(".pdf-search-context-panel", {
    timeout: 5000,
  });
  await page.waitForSelector('input[aria-label="Search PDF"]', {
    timeout: 5000,
  });
  const usesSearchPanel = await page.evaluate(
    () =>
      Boolean(document.querySelector(".pdf-search-context-panel")) &&
      !document.querySelector(".rail-search-popover")
  );
  if (!usesSearchPanel) {
    throw new Error("Viewer Next PDF search did not open in the side panel");
  }
}

async function findTextInViewer(page, query) {
  await openSearchControl(page);
  await page.click('input[aria-label="Search PDF"]');
  const selectModifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(selectModifier);
  await page.keyboard.press("A");
  await page.keyboard.up(selectModifier);
  await page.keyboard.type(query);
  await page.waitForFunction(
    expectedQuery =>
      document.querySelector(".app-shell")?.dataset.findQuery ===
        expectedQuery &&
      document.querySelector(".app-shell")?.dataset.findState !== "pending",
    { timeout: 10000 },
    query
  );
  await new Promise(resolve => setTimeout(resolve, 300));
  return page.evaluate(() => ({
    state: document.querySelector(".app-shell")?.dataset.findState,
    total: Number(document.querySelector(".app-shell")?.dataset.findTotal || 0),
  }));
}

async function clickAllToolsCard(page, label) {
  await page.waitForFunction(
    expectedLabel =>
      Array.from(document.querySelectorAll(".all-tools-grid button")).some(
        button =>
          button.querySelector("strong")?.textContent.trim() === expectedLabel
      ),
    { timeout: 10000 },
    label
  );
  await page.evaluate(expectedLabel => {
    Array.from(document.querySelectorAll(".all-tools-grid button"))
      .find(
        button =>
          button.querySelector("strong")?.textContent.trim() === expectedLabel
      )
      ?.click();
  }, label);
}

async function waitForFileChooserFromAllToolsCard(page, label) {
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 5000 }),
    clickAllToolsCard(page, label),
  ]);
  return fileChooser;
}

async function activateToolbarButton(page, label, expectedMode) {
  const selector = `.floating-toolbar button[aria-label="${label}"]`;
  await page.waitForSelector(selector, { timeout: 10000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const active = await page.evaluate(
      ({ expectedLabel, mode }) =>
        document
          .querySelector(
            `.floating-toolbar button[aria-label="${expectedLabel}"]`
          )
          ?.classList.contains("active") &&
        document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
          mode,
      { expectedLabel: label, mode: expectedMode }
    );
    if (active) {
      return;
    }
    await page.click(selector);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  await page.waitForFunction(
    ({ expectedLabel, mode }) =>
      document
        .querySelector(`.floating-toolbar button[aria-label="${expectedLabel}"]`)
        ?.classList.contains("active") &&
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
        mode,
    { timeout: 15000 },
    { expectedLabel: label, mode: expectedMode }
  );
}

async function getInteractionState(page) {
  return page.evaluate(() => {
    const dataset = document.querySelector(".app-shell")?.dataset || {};
    return {
      activeTool: dataset.interactionActiveTool || "",
      canBookmark: dataset.interactionCanBookmark === "true",
      canComment: dataset.interactionCanComment === "true",
      canDelete: dataset.interactionCanDelete === "true",
      contextKind: dataset.interactionContextKind || "",
      selectedEditorCount: Number(
        dataset.interactionSelectedEditorCount || 0
      ),
      selectionKind: dataset.interactionSelectionKind || "",
    };
  });
}

async function selectFirstPdfText(page) {
  return page.evaluate(() => {
    const span = Array.from(document.querySelectorAll(".textLayer span")).find(
      element => (element.textContent || "").trim().length > 8
    );
    const textNode = span?.firstChild;
    if (!textNode) {
      return null;
    }
    const rawText = textNode.nodeValue || "";
    const start = rawText.search(/\S/);
    if (start < 0) {
      return null;
    }
    const end = Math.min(rawText.length, start + 10);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
}

async function dragSelectFirstPdfText(page) {
  const target = await page.evaluate(() => {
    const selection = getSelection();
    selection?.removeAllRanges();
    const span = Array.from(document.querySelectorAll(".textLayer span")).find(
      element => (element.textContent || "").trim().length > 8
    );
    const textNode = span?.firstChild;
    if (!textNode) {
      return null;
    }
    const rawText = textNode.nodeValue || "";
    const start = rawText.search(/\S/);
    if (start < 0) {
      return null;
    }
    const end = Math.min(rawText.length, start + 10);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    return {
      endX: rect.right - 1,
      startX: rect.left + 1,
      y: rect.top + rect.height / 2,
    };
  });
  if (!target) {
    return "";
  }
  await page.mouse.move(target.startX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.endX, target.y, { steps: 8 });
  await page.mouse.up();
  await new Promise(resolve => setTimeout(resolve, 200));
  return page.evaluate(() => getSelection()?.toString() || "");
}

async function setDrawStyle(page, { colorTitle = "Red", strokeWidth = 6 } = {}) {
  await page.waitForSelector(".draw-tool-picker", { timeout: 5000 });
  await page.waitForSelector(".draw-style-controls", { timeout: 5000 });
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
      "15",
    { timeout: 10000 }
  );
  await page.$eval(
    `.draw-color-swatches button[title="${colorTitle}"]`,
    button => button.click()
  );
  await page.$eval(
    '.draw-style-controls input[aria-label="Outline width"]',
    (input, value) => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    strokeWidth
  );
  const widthInputSelector =
    '.draw-style-controls input[aria-label="Outline width"]';
  await page.focus(widthInputSelector);
  await page.keyboard.press("Home");
  for (let value = 1; value < strokeWidth; value += 1) {
    await page.keyboard.press("ArrowRight");
  }
  try {
    await page.waitForFunction(
      expectedWidth =>
        document.querySelector(".app-shell")?.dataset.drawColor ===
          "#b91c1c" &&
        document.querySelector(".app-shell")?.dataset.drawStrokeWidth ===
          String(expectedWidth),
      { timeout: 10000 },
      strokeWidth
    );
  } catch (error) {
    const drawStyleDebug = await page.evaluate(() => ({
      activeSwatch:
        document
          .querySelector(".draw-color-swatches button.selected")
          ?.getAttribute("title") || "",
      color: document.querySelector(".app-shell")?.dataset.drawColor || "",
      mode:
        document.querySelector(".app-shell")?.dataset.annotationEditorMode ||
        "",
      picker: Boolean(document.querySelector(".draw-tool-picker")),
      strokeWidth:
        document.querySelector(".app-shell")?.dataset.drawStrokeWidth || "",
      widthInput:
        document.querySelector(".draw-style-controls input")?.value || "",
    }));
    throw new Error(
      `Viewer Next draw style did not settle: ${JSON.stringify(drawStyleDebug)}`
    );
  }
}

async function readContextMenuState(page) {
  return page.evaluate(() => {
    const menu = document.querySelector(".viewer-context-menu");
    return {
      buttons: Array.from(menu?.querySelectorAll("button") || []).map(
        button => button.textContent.trim()
      ),
      kind: menu?.dataset.contextMenuKind || "",
      visible: Boolean(menu),
    };
  });
}

const server = createStaticServer();
await listen(server);

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await installBrowserSpies(page);
  await page.goto(directViewerUrl("edit"), { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "home",
    { timeout: 10000 }
  );
  const noDocumentRouteGuard = await page.evaluate(() => ({
    emptyDocument: Boolean(document.querySelector(".empty-document")),
    fileInput: Boolean(document.querySelector('input[type="file"]')),
    homeSideNav: Boolean(document.querySelector(".home-sidenav")),
    toolTabs: Array.from(document.querySelectorAll(".tool-tabs button")).map(
      button => button.textContent.trim()
    ),
    view: new URL(location.href).searchParams.get("view"),
  }));
  if (
    noDocumentRouteGuard.view !== "home" ||
    noDocumentRouteGuard.emptyDocument ||
    noDocumentRouteGuard.homeSideNav ||
    !noDocumentRouteGuard.fileInput ||
    !noDocumentRouteGuard.toolTabs.includes("All tools") ||
    noDocumentRouteGuard.toolTabs.some(label =>
      ["Edit", "Convert", "E-sign"].includes(label)
    )
  ) {
    throw new Error("Viewer Next no-document route guard failed");
  }
  await page.click(".document-switcher-button");
  await page.waitForSelector(".document-context-sidenav", { timeout: 5000 });
  const documentMenuHomeState = await page.evaluate(() => ({
    hasHomeButton: Array.from(
      document.querySelectorAll(".document-context-sidenav button")
    ).some(button => button.textContent.trim() === "Home"),
    hasOpenPdfButton: Array.from(
      document.querySelectorAll(".document-context-sidenav button")
    ).some(button => button.textContent.includes("Open PDF")),
  }));
  if (
    documentMenuHomeState.hasHomeButton ||
    !documentMenuHomeState.hasOpenPdfButton
  ) {
    throw new Error("Viewer Next document menu Home cleanup failed");
  }
  await page.click(
    '.document-context-sidenav button[aria-label="Close Documents"]'
  );
  await page.click('button[aria-label="Options"]');
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "options",
    { timeout: 10000 }
  );
  await page.waitForSelector(".options-panel h1", { timeout: 10000 });
  const optionsEnglish = await page.evaluate(() => ({
    heading: document.querySelector(".options-panel h1")?.textContent.trim(),
    locale: localStorage.getItem("rewirepdf.viewerNext.locale"),
  }));
  if (optionsEnglish.heading !== "Options" || optionsEnglish.locale !== "en") {
    throw new Error("Viewer Next options route did not open in English");
  }
  await page.select(".theme-select select", "dark");
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.theme === "dark" &&
      document.documentElement.dataset.viewerNextTheme === "dark",
    { timeout: 5000 }
  );
  const darkThemeState = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar");
    return {
      background: getComputedStyle(topbar).backgroundColor,
      preference: document.querySelector(".app-shell")?.dataset.themePreference,
      storedTheme: localStorage.getItem("rewirepdf.viewerNext.theme"),
      theme: document.querySelector(".app-shell")?.dataset.theme,
    };
  });
  if (
    darkThemeState.theme !== "dark" ||
    darkThemeState.preference !== "dark" ||
    darkThemeState.storedTheme !== "dark" ||
    darkThemeState.background !== "rgb(24, 27, 32)"
  ) {
    throw new Error("Viewer Next dark theme switch failed");
  }
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".options-panel", { timeout: 10000 });
  const persistedThemeState = await page.evaluate(() => ({
    storedTheme: localStorage.getItem("rewirepdf.viewerNext.theme"),
    theme: document.querySelector(".app-shell")?.dataset.theme,
    view: new URL(location.href).searchParams.get("view"),
  }));
  if (
    persistedThemeState.view !== "options" ||
    persistedThemeState.theme !== "dark" ||
    persistedThemeState.storedTheme !== "dark"
  ) {
    throw new Error("Viewer Next theme persistence failed");
  }
  await page.select(".theme-select select", "light");
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.theme === "light" &&
      localStorage.getItem("rewirepdf.viewerNext.theme") === "light",
    { timeout: 5000 }
  );
  await page.select(".language-select select", "it");
  await page.waitForFunction(
    () =>
      document.querySelector(".options-panel h1")?.textContent.trim() ===
      "Opzioni",
    { timeout: 5000 }
  );
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".options-panel", { timeout: 10000 });
  const optionsItalian = await page.evaluate(() => ({
    heading: document.querySelector(".options-panel h1")?.textContent.trim(),
    locale: localStorage.getItem("rewirepdf.viewerNext.locale"),
    tabLabels: Array.from(document.querySelectorAll(".tool-tabs button")).map(
      button => button.textContent.trim()
    ),
    view: new URL(location.href).searchParams.get("view"),
  }));
  if (
    optionsItalian.view !== "options" ||
    optionsItalian.heading !== "Opzioni" ||
    optionsItalian.locale !== "it" ||
    !optionsItalian.tabLabels.includes("Tutti gli strumenti")
  ) {
    throw new Error("Viewer Next locale persistence failed");
  }
  const extraLocaleChecks = [
    ["de", "Optionen", "Alle Werkzeuge"],
    ["fr", "Options", "Tous les outils"],
    ["es", "Opciones", "Todas las herramientas"],
  ];
  for (const [locale, heading, allToolsLabel] of extraLocaleChecks) {
    await page.select(".language-select select", locale);
    await page.waitForFunction(
      expectedHeading =>
        document.querySelector(".options-panel h1")?.textContent.trim() ===
        expectedHeading,
      { timeout: 5000 },
      heading
    );
    const localeState = await page.evaluate(() => ({
      locale: localStorage.getItem("rewirepdf.viewerNext.locale"),
      tabLabels: Array.from(document.querySelectorAll(".tool-tabs button")).map(
        button => button.textContent.trim()
      ),
    }));
    if (
      localeState.locale !== locale ||
      !localeState.tabLabels.includes(allToolsLabel)
    ) {
      throw new Error(`Viewer Next ${locale} locale switch failed`);
    }
  }
  await page.select(".language-select select", "en");
  await page.waitForFunction(
    () =>
      document.querySelector(".options-panel h1")?.textContent.trim() ===
      "Options",
    { timeout: 5000 }
  );
  await page.goto(directViewerUrl("all-tools"), { waitUntil: "networkidle0" });
  await page.waitForSelector(".all-tools-grid", { timeout: 10000 });
  const allToolsNoDocument = await page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll(".all-tools-grid button")).map(
      button => button.querySelector("strong")?.textContent.trim()
    ),
    prompt: Boolean(document.querySelector(".tools-document-prompt")),
    sideNav: Boolean(document.querySelector(".tool-context-sidenav")),
    toolTabs: Array.from(document.querySelectorAll(".tool-tabs button")).map(
      button => button.textContent.trim()
    ),
    usesChoosePdfCta: Array.from(
      document.querySelectorAll(".all-tools-grid button.needs-document em")
    ).some(
      element => element.textContent.trim() === "Choose a PDF to get started"
    ),
  }));
  if (
    !allToolsNoDocument.prompt ||
    allToolsNoDocument.sideNav ||
    !allToolsNoDocument.usesChoosePdfCta ||
    allToolsNoDocument.cards.includes("Export a PDF") ||
    allToolsNoDocument.cards.includes("Compress a PDF") ||
    allToolsNoDocument.toolTabs.some(label =>
      ["Edit", "Convert", "E-sign"].includes(label)
    )
  ) {
    throw new Error("Viewer Next no-document All Tools guard failed");
  }
  await page.evaluate(() => {
    localStorage.setItem(
      "rewirepdf.viewerNext.showUnimplementedPageTools",
      "true"
    );
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".all-tools-grid", { timeout: 10000 });
  const allToolsDebugState = await page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll(".all-tools-grid button")).map(
      button => button.querySelector("strong")?.textContent.trim()
    ),
  }));
  if (
    !allToolsDebugState.cards.includes("Export a PDF") ||
    !allToolsDebugState.cards.includes("Compress a PDF") ||
    !allToolsDebugState.cards.includes("Create PDF")
  ) {
    throw new Error("Viewer Next debug tool visibility failed");
  }
  await page.evaluate(() => {
    localStorage.removeItem("rewirepdf.viewerNext.showUnimplementedPageTools");
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".all-tools-grid", { timeout: 10000 });
  const allToolsFileChooser = await waitForFileChooserFromAllToolsCard(
    page,
    "Edit PDF text"
  );
  await allToolsFileChooser.accept([
    path.join(pdfjsRepoRoot, "test/pdfs/tracemonkey.pdf"),
  ]);
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "edit",
    { timeout: 10000 }
  );
  await page.waitForSelector(".pdfViewer .page canvas", { timeout: 15000 });
  await page.waitForSelector(".textLayer", { timeout: 15000 });
  const documentToolTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".tool-tabs button")).map(button =>
      button.textContent.trim()
    )
  );
  if (documentToolTabs.includes("Convert")) {
    throw new Error("Viewer Next Convert tab should require debug flag");
  }
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".tool-tabs button"))
      .find(button => button.textContent.trim() === "All tools")
      ?.click();
  });
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "all-tools",
    { timeout: 10000 }
  );
  await page.waitForSelector(".all-tools-grid", { timeout: 10000 });
  const allToolsStampEntryState = await page.evaluate(() => ({
    card: Array.from(document.querySelectorAll(".all-tools-grid button")).some(
      button =>
        button.querySelector("strong")?.textContent.trim() === "Stamp palette"
    ),
  }));
  await clickAllToolsCard(page, "Highlight");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "edit",
    { timeout: 10000 }
  );
  try {
    await activateToolbarButton(page, "Highlight", "9");
  } catch (error) {
    const highlightDebug = await page.evaluate(() => ({
      activeButton:
        document
          .querySelector(".floating-toolbar button.active")
          ?.getAttribute("aria-label") || "",
      annotationEditorMode:
        document.querySelector(".app-shell")?.dataset.annotationEditorMode ||
        "",
      href: location.href,
      tool: document.querySelector(".app-shell")?.dataset.activeTool || "",
    }));
    throw new Error(
      `Viewer Next highlight mode did not settle: ${JSON.stringify(
        highlightDebug
      )}`,
      { cause: error }
    );
  }
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".tool-tabs button"))
      .find(button => button.textContent.trim() === "All tools")
      ?.click();
  });
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "all-tools",
    { timeout: 10000 }
  );
  await page.waitForSelector(".all-tools-grid", { timeout: 10000 });
  await clickAllToolsCard(page, "Stamp palette");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "edit",
    { timeout: 10000 }
  );
  await page.waitForSelector(".stamp-context-panel", { timeout: 10000 });
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.stampSelected ===
      "approved",
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.floating-toolbar button[aria-label="Draw"].active .symbol'
        )
        ?.textContent.trim() === "approval",
    { timeout: 5000 }
  );
  const allToolsStampState = await page.evaluate(() => ({
    drawButtonActive: Boolean(
      document.querySelector(
        '.floating-toolbar button[aria-label="Draw"].active'
      )
    ),
    drawButtonIcon:
      document
        .querySelector('.floating-toolbar button[aria-label="Draw"] .symbol')
        ?.textContent.trim() || "",
    leftHeader:
      document
        .querySelector(".stamp-options .page-organizer-options-header h2")
        ?.textContent.trim() || "",
    panel: Boolean(document.querySelector(".stamp-context-panel")),
    rightPanel: Boolean(document.querySelector(".editor-context-sidenav")),
    selected: document.querySelector(".app-shell")?.dataset.stampSelected,
  }));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".tool-tabs button"))
      .find(button => button.textContent.trim() === "E-sign")
      ?.click();
  });
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get("view") === "sign" &&
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
        "101",
    { timeout: 10000 }
  );
  const signFromStampState = await page.evaluate(() => ({
    certifiedCopyButton: Boolean(
      document.querySelector(".certified-copy-button")
    ),
    drawTool: document.querySelector(".app-shell")?.dataset.drawTool,
    signMarkRow: Boolean(document.querySelector(".sign-mark-row")),
    signNote: Boolean(document.querySelector(".sign-note")),
    signatureButtonActive: Boolean(
      document.querySelector(
        '.floating-toolbar button[aria-label="Signature"].active'
      )
    ),
    stampPanel: Boolean(document.querySelector(".stamp-context-panel")),
    stampSelected: document.querySelector(".app-shell")?.dataset.stampSelected,
  }));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".tool-tabs button"))
      .find(button => button.textContent.trim() === "Edit")
      ?.click();
  });
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get("view") === "edit" &&
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
        "0",
    { timeout: 10000 }
  );
  await page.click('.floating-toolbar button[aria-label="Select"]');
  await page.waitForSelector(
    '.floating-toolbar button[aria-label="Select"].active',
    { timeout: 10000 }
  );
  await page.waitForSelector(".pdfViewer .page canvas", { timeout: 15000 });
  await page.waitForSelector(".textLayer", { timeout: 15000 });
  await page.click('button[aria-label="Draw"]');
  await page.waitForSelector(".draw-tool-picker", { timeout: 5000 });
  await setDrawStyle(page);
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
      "15",
    { timeout: 5000 }
  );
  const inkDragBox = await page.evaluate(() => {
    const layer = Array.from(
      document.querySelectorAll(".annotationEditorLayer:not([hidden])")
    ).find(candidate => {
      const rect = candidate.getBoundingClientRect();
      return (
        rect.width > 260 &&
        rect.height > 180 &&
        rect.bottom > 160 &&
        rect.top < window.innerHeight - 160
      );
    });
    const rect = layer?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) {
      return null;
    }
    return {
      endX: rect.left + Math.min(rect.width - 80, 260),
      endY: rect.top + Math.min(rect.height - 80, 180),
      target:
        document.elementFromPoint(rect.left + 120, rect.top + 120)?.className ||
        document.elementFromPoint(rect.left + 120, rect.top + 120)?.tagName ||
        "",
      startX: rect.left + 120,
      startY: rect.top + 120,
    };
  });
  if (!inkDragBox) {
    throw new Error("Viewer Next smoke could not locate draw layer");
  }
  await page.mouse.move(inkDragBox.startX, inkDragBox.startY);
  await page.mouse.down();
  await page.mouse.move(inkDragBox.endX, inkDragBox.endY, { steps: 12 });
  await page.mouse.up();
  await page.click('.floating-toolbar button[aria-label="Select"]');
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".annotationEditorLayer .inkEditor").length > 0,
    { timeout: 5000 }
  );
  const nativeInkStyleState = await page.evaluate(() => {
    const drawSvg = Array.from(
      document.querySelectorAll(".canvasWrapper svg.draw")
    ).at(-1);
    const path = drawSvg?.querySelector("path");
    const use = drawSvg?.querySelector("use:not(.clip, .mask)");
    const editor = Array.from(
      document.querySelectorAll(".annotationEditorLayer .inkEditor")
    ).at(-1);
    const rect = editor?.getBoundingClientRect();
    return {
      editorCount: document.querySelectorAll(
        ".annotationEditorLayer .inkEditor"
      ).length,
      stroke:
        path?.getAttribute("stroke") ||
        use?.getAttribute("stroke") ||
        drawSvg?.getAttribute("stroke") ||
        "",
      strokeWidth:
        path?.getAttribute("stroke-width") ||
        use?.getAttribute("stroke-width") ||
        drawSvg?.getAttribute("stroke-width") ||
        "",
      x: rect ? rect.left + rect.width / 2 : 0,
      y: rect ? rect.top + rect.height / 2 : 0,
    };
  });
  await page.click('button[aria-label="Draw"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
      "15",
    { timeout: 5000 }
  );
  await page.mouse.click(nativeInkStyleState.x, nativeInkStyleState.y);
  await page.waitForFunction(
    () =>
      !document.querySelector(".floating-toolbar .delete-selection-button")
        ?.disabled,
    { timeout: 5000 }
  );
  const nativeInkSelectionState = await page.evaluate(() => {
    const deleteButton = document.querySelector(
      ".floating-toolbar .delete-selection-button"
    );
    return {
      deleteClass: deleteButton?.classList.contains("delete-selection-button"),
      deleteDisabled: Boolean(deleteButton?.disabled),
      selectedEditors: document.querySelectorAll(
        ".annotationEditorLayer .selectedEditor"
      ).length,
    };
  });
  nativeInkSelectionState.interaction = await getInteractionState(page);
  await page.mouse.click(nativeInkStyleState.x, nativeInkStyleState.y, {
    button: "right",
  });
  await page.waitForSelector(
    '.viewer-context-menu[data-context-menu-kind="ink"]',
    { timeout: 5000 }
  );
  const inkContextMenuState = await readContextMenuState(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector(".viewer-context-menu"),
    { timeout: 5000 }
  );
  await page.click('.floating-toolbar button[aria-label="Select"]');
  await page.waitForSelector(
    '.floating-toolbar button[aria-label="Select"].active',
    { timeout: 10000 }
  );
  const uploadStorageState = await page.evaluate(() => {
    const tabs = JSON.parse(
      sessionStorage.getItem("rewirepdf.viewerNext.pdfTabs") || "[]"
    );
    const pending = JSON.parse(
      sessionStorage.getItem("rewirepdf.viewerNext.pendingPdf") || "null"
    );
    return {
      pendingHasBytes: Boolean(pending?.bytes),
      storageModes: tabs.map(tab => tab.storage),
      tabCount: tabs.length,
      tabsHaveBytes: tabs.some(tab => Boolean(tab.bytes)),
    };
  });
  const editPageActions = await page.evaluate(() => {
    function textWithoutIcons(element) {
      const clone = element.cloneNode(true);
      clone.querySelectorAll(".symbol").forEach(icon => icon.remove());
      return clone.textContent.trim();
    }

    const section = document.querySelector(".edit-page-section");
    const textActions = Array.from(
      section?.querySelectorAll(":scope > button") || []
    )
      .map(button => textWithoutIcons(button))
      .filter(Boolean);
    const quickActions = Array.from(
      section?.querySelectorAll(".edit-page-quick-actions button") || []
    ).map(button => ({
      disabled: button.disabled,
      icon: button.querySelector(".symbol")?.textContent.trim(),
      label: button.getAttribute("aria-label"),
      text: textWithoutIcons(button),
    }));
    const orderedChildren = Array.from(section?.children || []).map(child => {
      if (child.classList.contains("edit-page-quick-actions")) {
        return "quick-actions";
      }
      if (child.tagName === "BUTTON") {
        return textWithoutIcons(child);
      }
      return child.tagName.toLowerCase();
    });
    return {
      addContentActions: Array.from(
        document.querySelectorAll(".edit-tool-section")
      )
        .find(
          section =>
            section.querySelector("p")?.textContent.trim() === "Add content"
        )
        ?.querySelectorAll(":scope > button")
        ? Array.from(
            Array.from(document.querySelectorAll(".edit-tool-section"))
              .find(
                section =>
                  section.querySelector("p")?.textContent.trim() ===
                  "Add content"
              )
              .querySelectorAll(":scope > button")
          ).map(button => ({
            disabled: button.disabled,
            text: textWithoutIcons(button),
          }))
        : [],
      orderedChildren,
      quickActions,
      textActions,
    };
  });
  const commentToolbarVisibleBeforeSelection = await page.evaluate(() =>
    Boolean(
      document.querySelector('.floating-toolbar button[aria-label="Comments"]')
    )
  );
  const interactionBeforeTextSelection = await getInteractionState(page);
  await page.click('.edit-right-rail button[aria-label="Comments"]');
  await page.waitForSelector(".comments-context-panel", { timeout: 10000 });
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.annotationEditorMode ===
      "0",
    { timeout: 10000 }
  );
  const railCommentSelectionText = await dragSelectFirstPdfText(page);
  if (!railCommentSelectionText.trim()) {
    throw new Error(
      "Viewer Next rail comments panel blocked PDF text selection"
    );
  }
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const selectedCommentText = await selectFirstPdfText(page);
  if (!selectedCommentText) {
    throw new Error("Viewer Next smoke could not select text for comment");
  }
  await page.waitForSelector('.floating-toolbar button[aria-label="Comments"]', {
    timeout: 5000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.interactionSelectionKind ===
        "text" &&
      document.querySelector(".app-shell")?.dataset.interactionCanComment ===
        "true",
    { timeout: 5000 }
  );
  const commentToolbarVisibleAfterSelection = await page.evaluate(() =>
    Boolean(
      document.querySelector('.floating-toolbar button[aria-label="Comments"]')
    )
  );
  const interactionAfterTextSelection = await getInteractionState(page);
  await page.waitForSelector(
    '.interaction-target-panel[data-context-target-kind="text"]',
    { timeout: 5000 }
  );
  const textContextMenuPoint = await page.evaluate(() => {
    const selection = getSelection();
    if (!selection?.rangeCount) {
      return null;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return rect.width && rect.height
      ? {
          x: rect.left + Math.min(rect.width - 1, 8),
          y: rect.top + rect.height / 2,
        }
      : null;
  });
  if (!textContextMenuPoint) {
    throw new Error("Viewer Next smoke could not locate selected text menu point");
  }
  await page.mouse.click(textContextMenuPoint.x, textContextMenuPoint.y, {
    button: "right",
  });
  await page.waitForSelector(
    '.viewer-context-menu[data-context-menu-kind="text"]',
    { timeout: 5000 }
  );
  const textContextMenuState = await readContextMenuState(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector(".viewer-context-menu"),
    { timeout: 5000 }
  );
  await page.click('.floating-toolbar button[aria-label="Comments"]');
  await page.waitForSelector(".comment-composer textarea", { timeout: 10000 });
  await page.type(".comment-composer textarea", "Smoke comment");
  await page.click('.comment-composer-actions button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelectorAll(".comment-list-item").length > 0,
    { timeout: 10000 }
  );
  const commentState = await page.evaluate(() => ({
    items: Array.from(document.querySelectorAll(".comment-list-item")).map(
      item => item.textContent.trim()
    ),
    searchInHeader: Boolean(
      document.querySelector(
        '.editor-context-header-actions button[aria-label="Search comments"]'
      )
    ),
    searchInput: Boolean(
      document.querySelector('.comments-context-panel input[type="search"]')
    ),
    pending: Boolean(document.querySelector(".comment-composer")),
    status: document.querySelector(".comment-status")?.textContent.trim() || "",
  }));
  await page.click(
    '.editor-context-header-actions button[aria-label="Search comments"]'
  );
  await page.waitForSelector('.comments-context-panel input[type="search"]', {
    timeout: 5000,
  });
  await page.type('.comments-context-panel input[type="search"]', "Smoke");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".comment-list-item").length === 1 &&
      document
        .querySelector(".comment-search-summary")
        ?.textContent.includes("1"),
    { timeout: 5000 }
  );
  const commentSearchState = await page.evaluate(() => ({
    clearButton: Boolean(
      document.querySelector(
        '.comment-search button[aria-label="Clear search"]'
      )
    ),
    items: Array.from(document.querySelectorAll(".comment-list-item")).map(
      item => item.textContent.trim()
    ),
    summary: document
      .querySelector(".comment-search-summary")
      ?.textContent.trim(),
  }));
  await page.click('.comment-search button[aria-label="Clear search"]');
  await page.click(
    '.editor-context-header-actions button[aria-label="Search comments"]'
  );
  await page.waitForSelector('.comments-context-panel input[type="search"]', {
    timeout: 5000,
  });
  await page.type(
    '.comments-context-panel input[type="search"]',
    "not-in-comments"
  );
  await page.waitForSelector(".comment-empty .symbol", { timeout: 5000 });
  const commentSearchEmptyState = await page.evaluate(() => ({
    empty: document.querySelector(".comment-empty")?.textContent.trim() || "",
    items: document.querySelectorAll(".comment-list-item").length,
    summary: document
      .querySelector(".comment-search-summary")
      ?.textContent.trim(),
  }));
  await page.click('.comment-search button[aria-label="Clear search"]');
  await page.click('button[aria-label="Edit PDF text"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.nativeTextEditActive ===
      "true",
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".app-shell")?.dataset.nativeTextEditEditable ||
          0
      ) > 0,
    { timeout: 5000 }
  );
  const editableClickPoint = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("[data-pdfjs-native-text-editable='true']")
    )
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })
      .filter(rect => rect.width > 2 && rect.height > 2);
    return candidates[0] || null;
  });
  if (!editableClickPoint) {
    throw new Error("Viewer Next smoke could not find editable text");
  }
  await page.mouse.click(editableClickPoint.x, editableClickPoint.y);
  await page.waitForSelector("[data-pdfjs-native-text-edit-input='true']", {
    timeout: 5000,
  });
  await page.focus("[data-pdfjs-native-text-edit-input='true']");
  const selectModifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(selectModifier);
  await page.keyboard.press("A");
  await page.keyboard.up(selectModifier);
  await page.keyboard.type("ViewerNext");
  await new Promise(resolve => setTimeout(resolve, 1200));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.nativeTextEditCommitted ===
      "true",
    { timeout: 15000 }
  );
  const nativeTextActive = await page.evaluate(() => ({
    active:
      document.querySelector(".app-shell")?.dataset.nativeTextEditActive ===
      "true",
    committed:
      document.querySelector(".app-shell")?.dataset.nativeTextEditCommitted ===
      "true",
    capabilityPanel: Boolean(document.querySelector(".capability-panel")),
    editable: Number(
      document.querySelector(".app-shell")?.dataset.nativeTextEditEditable || 0
    ),
  }));
  await page.click('button[title="Save"]');
  const savedDownload = await waitForDownloadCount(page, 1);
  const savedViewerPage = await openPdfBytesInViewer(browser, {
    bytes: savedDownload.bytes,
    name: "viewer-next-saved.pdf",
  });
  const savedTextSearch = await findTextInViewer(savedViewerPage, "ViewerNext");
  await savedViewerPage.close();
  const editedTextBox = await page.evaluate(() => {
    const editable = Array.from(
      document.querySelectorAll("[data-pdfjs-native-text-editable='true']")
    );
    const target =
      editable.find(element => element.textContent?.includes("ViewerNext")) ||
      editable[0];
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    };
  });
  if (!editedTextBox) {
    throw new Error("Viewer Next smoke could not locate edited text box");
  }
  await page.click('button[aria-label="Redact a PDF"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.nativeRedactActive ===
      "true",
    { timeout: 5000 }
  );
  await page.waitForSelector(".nativeRedactLayer", { timeout: 5000 });
  const redactBox = await page.evaluate(textBox => {
    const layer = document.querySelector(".nativeRedactLayer");
    const layerRect = layer.getBoundingClientRect();
    return {
      endX: Math.min(layerRect.right - 4, textBox.right + 40),
      endY: Math.min(layerRect.bottom - 4, textBox.bottom + 20),
      startX: Math.max(layerRect.left + 4, textBox.left - 12),
      startY: Math.max(layerRect.top + 4, textBox.top - 12),
    };
  }, editedTextBox);
  await page.mouse.move(redactBox.startX, redactBox.startY);
  await page.mouse.down();
  await page.mouse.move(redactBox.endX, redactBox.endY, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".app-shell")?.dataset.nativeRedactPatches || 0
      ) > 0,
    { timeout: 15000 }
  );
  const nativeRedact = await page.evaluate(() => ({
    active:
      document.querySelector(".app-shell")?.dataset.nativeRedactActive ===
      "true",
    capabilityPanel: Boolean(document.querySelector(".capability-panel")),
    layer: Boolean(document.querySelector(".nativeRedactLayer")),
    patches: Number(
      document.querySelector(".app-shell")?.dataset.nativeRedactPatches || 0
    ),
  }));
  await page.click('button[title="Save"]');
  const redactedDownload = await waitForDownloadCount(page, 2);
  const redactedViewerPage = await openPdfBytesInViewer(browser, {
    bytes: redactedDownload.bytes,
    name: "viewer-next-redacted.pdf",
  });
  const redactedTextSearch = await findTextInViewer(
    redactedViewerPage,
    "ViewerNext"
  );
  await redactedViewerPage.close();
  const topbarPrintState = await page.evaluate(() => ({
    buttons: document.querySelectorAll('button[title="Print"]').length,
    calls: window.__viewerNextPrintCalls,
  }));
  await page.click('.edit-right-rail button[aria-label="Edit history"]');
  await page.waitForSelector(".history-context-panel", { timeout: 5000 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".history-list-item")).some(item =>
        item.textContent.includes("Source text edit")
      ) &&
      Array.from(document.querySelectorAll(".history-list-item")).some(item =>
        item.textContent.includes("Native redact")
      ),
    { timeout: 10000 }
  );
  const historyAfterNative = await page.evaluate(() => ({
    items: Array.from(document.querySelectorAll(".history-list-item")).map(
      item => item.textContent.trim()
    ),
    revisionCount: Number(
      document.querySelector(".app-shell")?.dataset.editHistoryRevisionCount ||
        0
    ),
    runtimeCount: Number(
      document.querySelector(".app-shell")?.dataset.editHistoryRuntimeCount || 0
    ),
  }));
  await page.click(".editor-context-header > button");
  await page.waitForFunction(
    () => !document.querySelector(".history-context-panel"),
    { timeout: 5000 }
  );
  await openSearchControl(page);
  await page.click('input[aria-label="Search PDF"]');
  await page.type('input[aria-label="Search PDF"]', "TraceMonkey");
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.findQuery ===
        "TraceMonkey" &&
      document.querySelector(".app-shell")?.dataset.findState !== "pending",
    { timeout: 10000 }
  );
  await page.waitForSelector(".textLayer .highlight", { timeout: 10000 });
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".app-shell")?.dataset.findTotal || 0) > 0,
    { timeout: 5000 }
  );
  await page.waitForSelector(".pdf-search-result", { timeout: 5000 });
  const searchResultNavigationTarget = await page.evaluate(() => {
    const currentPage = Number(
      document.querySelector(".app-shell")?.dataset.pageNumber || 1
    );
    const results = Array.from(document.querySelectorAll(".pdf-search-result"));
    const target =
      results.find(
        result => Number(result.dataset.pageNumber || 0) > currentPage
      ) ||
      results.at(-1) ||
      null;
    target?.click();
    return {
      pageNumber: Number(target?.dataset.pageNumber || 0),
      resultIndex: Number(target?.dataset.resultIndex || 0),
    };
  });
  await page.waitForFunction(
    target =>
      Number(document.querySelector(".app-shell")?.dataset.pageNumber || 0) ===
        target.pageNumber &&
      Number(document.querySelector(".app-shell")?.dataset.findCurrent || 0) ===
        target.resultIndex,
    { timeout: 5000 },
    searchResultNavigationTarget
  );
  const initialRenderedFindResults = await page.evaluate(() =>
    Number(
      document.querySelector(".pdf-search-results")?.dataset.renderedCount || 0
    )
  );
  const totalFindResults = await page.evaluate(() =>
    Number(document.querySelector(".app-shell")?.dataset.findTotal || 0)
  );
  if (totalFindResults > initialRenderedFindResults) {
    await page.evaluate(() => {
      const panel = document.querySelector(".pdf-search-context-panel");
      if (panel) {
        panel.scrollTop = panel.scrollHeight;
      }
    });
    await page.waitForFunction(
      previousCount =>
        Number(
          document.querySelector(".pdf-search-results")?.dataset
            .renderedCount || 0
        ) > previousCount,
      { timeout: 5000 },
      initialRenderedFindResults
    );
  }
  const findVisualState = await page.evaluate(
    ({ initialRenderedCount, searchResultNavigationTarget }) => ({
      highlights: document.querySelectorAll(".textLayer .highlight").length,
      initialRenderedCount,
      panel: Boolean(document.querySelector(".pdf-search-context-panel")),
      popover: Boolean(document.querySelector(".rail-search-popover")),
      resultItems: document.querySelectorAll(".pdf-search-result").length,
      resultList: Boolean(document.querySelector(".pdf-search-results")),
      resultMarksMatchQuery: Array.from(
        document.querySelectorAll(".pdf-search-result mark")
      ).every(mark => mark.textContent.toLowerCase().includes("tracemonkey")),
      resultNavigation: {
        current: Number(
          document.querySelector(".app-shell")?.dataset.findCurrent || 0
        ),
        page: Number(
          document.querySelector(".app-shell")?.dataset.pageNumber || 0
        ),
        target: searchResultNavigationTarget,
      },
      renderedCount: Number(
        document.querySelector(".pdf-search-results")?.dataset.renderedCount ||
          0
      ),
      total: Number(
        document.querySelector(".app-shell")?.dataset.findTotal || 0
      ),
    }),
    {
      initialRenderedCount: initialRenderedFindResults,
      searchResultNavigationTarget,
    }
  );
  await page.click('button[aria-label="Use regular expression"]');
  await page.click('input[aria-label="Search PDF"]');
  await page.keyboard.down(selectModifier);
  await page.keyboard.press("A");
  await page.keyboard.up(selectModifier);
  await page.keyboard.type("TraceMonkey|JavaScript");
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.findQuery ===
        "TraceMonkey|JavaScript" &&
      document.querySelector(".app-shell")?.dataset.findState !== "pending",
    { timeout: 10000 }
  );
  const regexSearchState = await page.evaluate(() => ({
    active:
      document.querySelector(
        'button[aria-label="Use regular expression"][aria-pressed="true"]'
      ) !== null,
    markMatches: Array.from(
      document.querySelectorAll(".pdf-search-result mark")
    ).every(mark => /^(TraceMonkey|JavaScript)$/i.test(mark.textContent)),
    total: Number(document.querySelector(".app-shell")?.dataset.findTotal || 0),
  }));
  await page.evaluate(() => {
    document.querySelector(".pdf-search-result")?.click();
  });
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".app-shell")?.dataset.pageNumber || 0) ===
      1,
    { timeout: 5000 }
  );
  await page.click(".editor-context-header > button");
  await page.waitForFunction(
    () => !document.querySelector(".pdf-search-context-panel"),
    { timeout: 5000 }
  );
  await page.click('button[aria-label="Draw"]');
  await page.waitForSelector(".draw-tool-picker", { timeout: 5000 });
  await page.click('.draw-tool-picker button[title="Line"]');
  await page.waitForFunction(
    () => document.querySelector(".app-shell")?.dataset.drawTool === "line",
    { timeout: 5000 }
  );
  await setDrawStyle(page);
  await page.click('.draw-tool-picker button[title="Arrow"]');
  await page.waitForFunction(
    () => document.querySelector(".app-shell")?.dataset.drawTool === "arrow",
    { timeout: 5000 }
  );
  await page.click('.draw-tool-picker button[title="Stamp palette"]');
  await page.waitForSelector(".stamp-context-panel", { timeout: 5000 });
  await page.type('.stamp-identity-section input[name="name"]', "Smoke User");
  await page.type('.stamp-identity-section input[name="title"]', "Reviewer");
  await page.evaluate(() => {
    const dateInput = document.querySelector(
      '.stamp-identity-section input[name="date"]'
    );
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set;
    valueSetter.call(dateInput, "2026-05-24");
    dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    dateInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click('.stamp-date-toggle input[name="includeDate"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.stampSelected ===
        "approved" &&
      JSON.parse(
        localStorage.getItem("rewirepdf.viewerNext.stampIdentity") || "{}"
      ).includeDate === false,
    { timeout: 5000 }
  );
  const drawToolbarState = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const deleteButton = document.querySelector(
      ".floating-toolbar .delete-selection-button"
    );
    const storedIdentity = JSON.parse(
      localStorage.getItem("rewirepdf.viewerNext.stampIdentity") || "{}"
    );
    return {
      color: shell?.dataset.drawColor,
      deleteClass: deleteButton?.classList.contains("delete-selection-button"),
      deleteDisabled: Boolean(deleteButton?.disabled),
      stampPanel: Boolean(document.querySelector(".stamp-context-panel")),
      stampPanelLeftHeader:
        document
          .querySelector(".stamp-options .page-organizer-options-header h2")
          ?.textContent.trim() || "",
      stampPanelRightContext: Boolean(
        document.querySelector(".editor-context-sidenav")
      ),
      stampPresetCount: document.querySelectorAll(".stamp-preset-grid button")
        .length,
      stampSelected: shell?.dataset.stampSelected,
      dateDisabled: Boolean(
        document.querySelector('.stamp-identity-section input[name="date"]')
          ?.disabled
      ),
      styleControlsVisible: Boolean(
        document.querySelector(".draw-style-controls")
      ),
      storedIdentity,
      strokeWidth: shell?.dataset.drawStrokeWidth,
      tool: shell?.dataset.drawTool,
      uploadInput: Boolean(
        document.querySelector(
          '.stamp-upload-control input[aria-label="Upload custom stamp"]'
        )
      ),
    };
  });
  const stampZoomState = await page.evaluate(() => {
    const pageElement = document.querySelector(".pdfViewer .page");
    const rect = pageElement?.getBoundingClientRect();
    return { beforeWidth: rect?.width || 0 };
  });
  await page.click('.edit-right-rail button[aria-label="Zoom in"]');
  await page.waitForFunction(
    previousWidth =>
      (document.querySelector(".pdfViewer .page")?.getBoundingClientRect()
        .width || 0) > previousWidth,
    { timeout: 5000 },
    stampZoomState.beforeWidth
  );
  stampZoomState.afterZoomInWidth = await page.evaluate(
    () =>
      document.querySelector(".pdfViewer .page")?.getBoundingClientRect()
        .width || 0
  );
  await page.click('.edit-right-rail button[aria-label="Zoom out"]');
  await page.waitForFunction(
    zoomedWidth =>
      (document.querySelector(".pdfViewer .page")?.getBoundingClientRect()
        .width || 0) < zoomedWidth,
    { timeout: 5000 },
    stampZoomState.afterZoomInWidth
  );
  stampZoomState.afterZoomOutWidth = await page.evaluate(
    () =>
      document.querySelector(".pdfViewer .page")?.getBoundingClientRect()
        .width || 0
  );
  await new Promise(resolve => setTimeout(resolve, 200));
  await page.evaluate(() => {
    document
      .querySelector(".annotationEditorLayer:not([hidden])")
      ?.scrollIntoView({ block: "center", inline: "center" });
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  const stampPlacementTarget = await page.evaluate(() => {
    const layer = Array.from(
      document.querySelectorAll(".annotationEditorLayer:not([hidden])")
    ).find(candidate => {
      const rect = candidate.getBoundingClientRect();
      return (
        rect.width > 260 &&
        rect.height > 180 &&
        rect.bottom > 160 &&
        rect.top < window.innerHeight - 160
      );
    });
    const rect = layer?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) {
      return null;
    }
    return {
      x: rect.left + Math.min(rect.width - 110, 210),
      y: rect.top + Math.min(rect.height - 95, 155),
    };
  });
  if (!stampPlacementTarget) {
    throw new Error("Viewer Next smoke could not locate stamp placement layer");
  }
  await page.mouse.move(stampPlacementTarget.x, stampPlacementTarget.y);
  await page.waitForSelector(
    ".viewer-next-stamp-cursor-preview:not([hidden])",
    {
      timeout: 5000,
    }
  );
  const stampPreviewState = await page.evaluate(() => {
    const preview = document.querySelector(
      ".viewer-next-stamp-cursor-preview:not([hidden])"
    );
    const rect = preview?.getBoundingClientRect();
    return {
      hasIdentity:
        preview?.textContent.includes("Smoke User") &&
        preview?.textContent.includes("Reviewer"),
      height: rect?.height || 0,
      hidesDate: !preview?.textContent.includes("2026-05-24"),
      visible: Boolean(rect?.width && rect?.height),
      width: rect?.width || 0,
      x: rect ? rect.left + rect.width / 2 : 0,
      y: rect ? rect.top + rect.height / 2 : 0,
    };
  });
  await page.mouse.click(stampPlacementTarget.x, stampPlacementTarget.y);
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".annotationEditorLayer .stampEditor")
          .length > 0,
      { timeout: 10000 }
    );
  } catch (error) {
    const stampDebug = await page.evaluate(() => ({
      annotationMode:
        document.querySelector(".app-shell")?.dataset.annotationEditorMode,
      layers: document.querySelectorAll(".annotationEditorLayer").length,
      stampStatus:
        document.querySelector(".pdfViewer")?.dataset.stampPlacementStatus,
      stamps: document.querySelectorAll(".annotationEditorLayer .stampEditor")
        .length,
    }));
    throw new Error(
      `Viewer Next stamp placement failed: ${JSON.stringify(stampDebug)}`
    );
  }
  await page.waitForFunction(
    () =>
      !document.querySelector(".floating-toolbar .delete-selection-button")
        ?.disabled,
    { timeout: 5000 }
  );
  const stampPlacementState = await page.evaluate(() => {
    const deleteButton = document.querySelector(
      ".floating-toolbar .delete-selection-button"
    );
    const stampEditor = Array.from(
      document.querySelectorAll(".annotationEditorLayer .stampEditor")
    ).at(-1);
    const canvas = stampEditor?.querySelector("canvas");
    const rect = stampEditor?.getBoundingClientRect();
    return {
      canvas: Boolean(canvas?.width && canvas?.height),
      count: document.querySelectorAll(".annotationEditorLayer .stampEditor")
        .length,
      deleteDisabled: Boolean(deleteButton?.disabled),
      height: rect?.height || 0,
      previewHidden: !document.querySelector(
        ".viewer-next-stamp-cursor-preview:not([hidden])"
      ),
      selectedEditors: document.querySelectorAll(
        ".annotationEditorLayer .selectedEditor"
      ).length,
      visible: Boolean(rect?.width && rect?.height),
      width: rect?.width || 0,
    };
  });
  await page.click('.edit-right-rail button[aria-label="Edit history"]');
  await page.waitForSelector(".history-context-panel", { timeout: 5000 });
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".app-shell")?.dataset.editHistoryRuntimeCount ||
          0
      ) > 0,
    { timeout: 5000 }
  );
  const historyBeforeUndo = await page.evaluate(() => ({
    actionLabels: Array.from(
      document.querySelectorAll(".history-actions button")
    ).map(button => button.textContent.trim()),
    items: Array.from(document.querySelectorAll(".history-list-item")).map(
      item => item.textContent.trim()
    ),
    panel: Boolean(document.querySelector(".history-context-panel")),
    position: Number(
      document.querySelector(".app-shell")?.dataset
        .editHistoryRuntimePosition || -1
    ),
    runtimeCount: Number(
      document.querySelector(".app-shell")?.dataset.editHistoryRuntimeCount || 0
    ),
    topbarUndoRedoButtons: Array.from(
      document.querySelectorAll(".topbar .icon-button .symbol")
    ).filter(icon => ["undo", "redo"].includes(icon.textContent.trim())).length,
    undoDisabled: document.querySelector(".history-actions button")?.disabled,
  }));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".history-list-item"))
      .find(item => item.textContent.includes("Stamp"))
      ?.click();
  });
  await page.waitForSelector(".viewer-next-history-target", { timeout: 5000 });
  const historyClickTarget = await page.evaluate(() => {
    const target = document.querySelector(".viewer-next-history-target");
    const rect = target?.getBoundingClientRect();
    return {
      pageNumber: Number(
        target?.closest(".page")?.getAttribute("data-page-number") || 0
      ),
      visible: Boolean(rect?.width && rect?.height),
    };
  });
  await page.click(".history-actions button:nth-child(1)");
  await page.waitForFunction(
    previousPosition =>
      Number(
        document.querySelector(".app-shell")?.dataset
          .editHistoryRuntimePosition || -1
      ) ===
      previousPosition - 1,
    { timeout: 5000 },
    historyBeforeUndo.position
  );
  const historyAfterUndo = await page.evaluate(() => ({
    futureItems: document.querySelectorAll(".history-list-item.future").length,
    position: Number(
      document.querySelector(".app-shell")?.dataset
        .editHistoryRuntimePosition || -1
    ),
    redoDisabled: document.querySelector(".history-actions button:nth-child(2)")
      ?.disabled,
  }));
  await page.click(".history-actions button:nth-child(2)");
  await page.waitForFunction(
    previousPosition =>
      Number(
        document.querySelector(".app-shell")?.dataset
          .editHistoryRuntimePosition || -1
      ) === previousPosition,
    { timeout: 5000 },
    historyBeforeUndo.position
  );
  await page.click(".history-actions button:nth-child(3)");
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".app-shell")?.dataset.editHistoryRuntimeCount ||
          0
      ) === 0 && document.querySelectorAll(".history-list-item").length === 0,
    { timeout: 5000 }
  );
  const historyAfterClear = await page.evaluate(() => ({
    clearDisabled: document.querySelector(
      ".history-actions button:nth-child(3)"
    )?.disabled,
    empty: Boolean(document.querySelector(".history-empty")),
    items: document.querySelectorAll(".history-list-item").length,
    runtimeCount: Number(
      document.querySelector(".app-shell")?.dataset.editHistoryRuntimeCount || 0
    ),
  }));
  await page.click('button[aria-label="Highlight"]');
  await page.waitForSelector(".highlight-color-picker", { timeout: 5000 });
  await page.click('button[aria-label="Signature"]');
  await page.waitForSelector(".signature-tool-picker", { timeout: 5000 });
  await page.click('button[aria-label="Draw signature"]');
  await page.waitForSelector(".viewer-next-signature-dialog[open]", {
    timeout: 5000,
  });
  const signatureDialogInitialState = await page.evaluate(() => {
    const dialog = document.querySelector(
      ".viewer-next-signature-dialog[open]"
    );
    const error = dialog?.querySelector(".signature-error");
    return {
      closeButton: Boolean(
        dialog?.querySelector(".viewer-next-signature-close")
      ),
      errorVisible:
        Boolean(error) &&
        !error.hidden &&
        getComputedStyle(error).display !== "none",
    };
  });
  if (
    !signatureDialogInitialState.closeButton ||
    signatureDialogInitialState.errorVisible
  ) {
    throw new Error("Viewer Next signature dialog initial UX failed");
  }
  await page.click(".viewer-next-signature-close");
  await page.waitForFunction(
    () => !document.querySelector(".viewer-next-signature-dialog[open]"),
    { timeout: 5000 }
  );
  const pageBeforeNext = await page.evaluate(() =>
    Number(document.querySelector(".app-shell")?.dataset.pageNumber || 0)
  );
  await page.click('.edit-right-rail button[aria-label="Next page"]');
  await page.waitForFunction(
    previousPage =>
      Number(document.querySelector(".app-shell")?.dataset.pageNumber || 0) >
      previousPage,
    { timeout: 5000 },
    pageBeforeNext
  );
  const pageAfterNext = await page.evaluate(() =>
    Number(document.querySelector(".app-shell")?.dataset.pageNumber || 0)
  );
  await page.click('.edit-right-rail button[aria-label="Page thumbnails"]');
  await page.waitForSelector(".quick-pages-panel", { timeout: 5000 });
  await page.waitForSelector(
    '.quick-pages-panel article[data-page-number="1"] input[type="checkbox"]',
    {
      timeout: 5000,
    }
  );
  await page.waitForSelector(
    ".quick-pages-panel .page-organizer-preview-image",
    {
      timeout: 5000,
    }
  );
  await page.evaluate(() => {
    document
      .querySelector(
        '.quick-pages-panel article[data-page-number="1"] input[type="checkbox"]'
      )
      ?.click();
    document
      .querySelector(
        '.quick-pages-panel article[data-page-number="2"] input[type="checkbox"]'
      )
      ?.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.dataset.pageOrganizerSelected ===
      "2",
    { timeout: 5000 }
  );
  await page.evaluate(() => {
    const source = document.querySelector(
      '.quick-pages-panel article[data-page-number="1"]'
    );
    const target = document.querySelector(
      '.quick-pages-panel article[data-page-number="2"]'
    );
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
    );
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
    );
    source.dispatchEvent(
      new DragEvent("dragend", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
    );
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".app-shell")
        ?.dataset.pageOrganizerOrder.startsWith("2,1"),
    { timeout: 5000 }
  );
  const quickOrganizerState = await page.evaluate(() => ({
    leftActive: Array.from(
      document.querySelectorAll(".edit-tool-section button.active")
    ).map(button => button.textContent.trim()),
    mode: document.querySelector(".app-shell")?.dataset.pageOrganizerMode,
    order: document.querySelector(".app-shell")?.dataset.pageOrganizerOrder,
    railExpanded: document.querySelectorAll(".edit-right-rail button.expanded")
      .length,
    previewImages: document.querySelectorAll(
      ".quick-pages-panel .page-organizer-preview-image"
    ).length,
    selected: Number(
      document.querySelector(".app-shell")?.dataset.pageOrganizerSelected || 0
    ),
  }));
  await page.click(".quick-pages-full-button");
  await page.waitForSelector(".page-organizer-workspace", { timeout: 5000 });
  await page.evaluate(() => {
    document
      .querySelector(
        '.page-organizer-workspace article[data-page-number="3"] .page-organizer-check input[type="checkbox"]'
      )
      ?.click();
  });
  await page.waitForSelector(
    '.page-organizer-workspace article[data-page-number="3"] .page-organizer-check.checked',
    { timeout: 5000 }
  );
  await page.click(
    '.page-organizer-workspace article[data-page-number="1"] .page-organizer-preview'
  );
  await page.waitForSelector(
    '.page-organizer-workspace article[data-page-number="1"].active',
    { timeout: 5000 }
  );
  await page.evaluate(() => {
    document
      .querySelector(
        '.page-organizer-workspace article[data-page-number="1"] button[aria-label="Rotate page 1"]'
      )
      ?.click();
  });
  await page.waitForSelector(
    '.page-organizer-workspace article[data-page-number="1"] .page-organizer-preview-paper[data-preview-rotation="90"]',
    { timeout: 5000 }
  );
  const fullOrganizerState = await page.evaluate(() => ({
    checkedPageActions: document.querySelectorAll(
      ".page-organizer-workspace .page-organizer-check.checked"
    ).length,
    disabledPageActions: Array.from(
      document.querySelectorAll(
        ".page-organizer-options .page-operation-buttons button:disabled"
      )
    ).map(button => button.getAttribute("aria-label")),
    editToolSections: document.querySelectorAll(".edit-tool-section").length,
    mode: document.querySelector(".app-shell")?.dataset.pageOrganizerMode,
    optionsCount: document.querySelectorAll(".page-organizer-options").length,
    optionsTitle: document
      .querySelector(".page-organizer-options h2")
      ?.textContent.trim(),
    order: document.querySelector(".app-shell")?.dataset.pageOrganizerOrder,
    pageActions: Array.from(
      document.querySelectorAll(
        ".page-organizer-options .page-operation-buttons button"
      )
    ).map(button => ({
      disabled: button.disabled,
      icon: button.querySelector(".symbol")?.textContent.trim(),
      label: button.getAttribute("aria-label"),
    })),
    railExpanded: document.querySelectorAll(".edit-right-rail button.expanded")
      .length,
    previewImages: document.querySelectorAll(
      ".page-organizer-workspace .page-organizer-preview-image"
    ).length,
    previewRotations: Array.from(
      document.querySelectorAll(".page-organizer-workspace article")
    ).map(article => ({
      page: Number(article.getAttribute("data-page-number")),
      rotation: article
        .querySelector(".page-organizer-preview-paper")
        ?.getAttribute("data-preview-rotation"),
    })),
    statusText:
      document.querySelector(".page-organizer-status")?.textContent.trim() ||
      "",
    workspace: Boolean(document.querySelector(".page-organizer-workspace")),
  }));

  const inkCountBeforeOptions = await page.evaluate(
    () => document.querySelectorAll(".annotationEditorLayer .inkEditor").length
  );
  await page.click('button[aria-label="Options"]');
  await page.waitForSelector(".options-panel", { timeout: 10000 });
  await page.select(".language-select select", "it");
  await page.waitForFunction(
    () =>
      document.querySelector(".options-panel h1")?.textContent.trim() ===
      "Opzioni",
    { timeout: 5000 }
  );
  await page.select(".language-select select", "en");
  await page.waitForFunction(
    () =>
      document.querySelector(".options-panel h1")?.textContent.trim() ===
      "Options",
    { timeout: 5000 }
  );
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".tool-tabs button"))
      .find(button => button.textContent.trim() === "Edit")
      ?.click();
  });
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("view") === "edit",
    { timeout: 10000 }
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".annotationEditorLayer .inkEditor").length > 0,
    { timeout: 5000 }
  );
  const settingsPreserveState = await page.evaluate(beforeCount => ({
    afterCount: document.querySelectorAll(".annotationEditorLayer .inkEditor")
      .length,
    beforeCount,
    historyCount:
      document.querySelector(".app-shell")?.dataset.editHistoryRuntimeCount ||
      "",
    locale: localStorage.getItem("rewirepdf.viewerNext.locale"),
    view: new URL(location.href).searchParams.get("view"),
  }), inkCountBeforeOptions);

  const result = await page.evaluate(
    (previousPage, nextPage, nativeText, nativeRedact) => ({
      canvases: document.querySelectorAll(".pdfViewer .page canvas").length,
      documentActionState:
        document.querySelector(".app-shell")?.dataset.documentActionState,
      fileTabs: document.querySelectorAll(".file-tab").length,
      findState: document.querySelector(".app-shell")?.dataset.findState,
      findStatus:
        document.querySelector(".search-count")?.textContent ||
        `${document.querySelector(".app-shell")?.dataset.findCurrent || 0}/${document.querySelector(".app-shell")?.dataset.findTotal || 0}`,
      findTotal: Number(
        document.querySelector(".app-shell")?.dataset.findTotal || 0
      ),
      href: location.href,
      highlights: document.querySelectorAll(".textLayer .highlight").length,
      nativeRedactActive: nativeRedact.active,
      nativeRedactCapabilityPanel: nativeRedact.capabilityPanel,
      nativeRedactLayer: nativeRedact.layer,
      nativeRedactPatches: nativeRedact.patches,
      nativeTextActive: nativeText.active,
      nativeTextCapabilityPanel: nativeText.capabilityPanel,
      nativeTextCommitted: nativeText.committed,
      nativeTextEditable: nativeText.editable,
      pageNumber: Number(
        document.querySelector(".app-shell")?.dataset.pageNumber || 0
      ),
      pageAfterNext: nextPage,
      pageBeforeNext: previousPage,
      pages: document.querySelectorAll(".pdfViewer .page").length,
      pdfSurfaceTitleCount: document.querySelectorAll(
        ".pdf-surface-container [title]"
      ).length,
      signaturePicker: Boolean(
        document.querySelector(".signature-tool-picker")
      ),
      textLayers: document.querySelectorAll(".textLayer").length,
      toolbar: Boolean(document.querySelector(".floating-toolbar")),
    }),
    pageBeforeNext,
    pageAfterNext,
    nativeTextActive,
    nativeRedact
  );
  result.editPageActions = editPageActions;
  result.findVisualState = findVisualState;
  result.regexSearchState = regexSearchState;
  result.allToolsStampEntryState = allToolsStampEntryState;
  result.allToolsStampState = allToolsStampState;
  result.commentState = commentState;
  result.commentSearchEmptyState = commentSearchEmptyState;
  result.commentSearchState = commentSearchState;
  result.interactionBeforeTextSelection = interactionBeforeTextSelection;
  result.interactionAfterTextSelection = interactionAfterTextSelection;
  result.textContextMenuState = textContextMenuState;
  result.commentToolbarVisibleAfterSelection =
    commentToolbarVisibleAfterSelection;
  result.commentToolbarVisibleBeforeSelection =
    commentToolbarVisibleBeforeSelection;
  result.historyAfterClear = historyAfterClear;
  result.historyAfterNative = historyAfterNative;
  result.historyAfterUndo = historyAfterUndo;
  result.historyBeforeUndo = historyBeforeUndo;
  result.historyClickTarget = historyClickTarget;
  result.nativeInkSelectionState = nativeInkSelectionState;
  result.inkContextMenuState = inkContextMenuState;
  result.nativeInkStyleState = nativeInkStyleState;
  result.settingsPreserveState = settingsPreserveState;
  result.signFromStampState = signFromStampState;
  result.drawToolbarState = drawToolbarState;
  result.stampPlacementState = stampPlacementState;
  result.stampPreviewState = stampPreviewState;
  result.stampZoomState = stampZoomState;
  result.uploadStorageState = uploadStorageState;
  result.topbarPrintState = topbarPrintState;
  result.pageOrganizerFull = fullOrganizerState;
  result.pageOrganizerQuick = quickOrganizerState;
  result.redactedDownloadSize = redactedDownload.size;
  result.redactedTextSearch = redactedTextSearch;
  result.savedDownloadSize = savedDownload.size;
  result.savedTextSearch = savedTextSearch;

  console.log(JSON.stringify(result, null, 2));
  const expectedEditPageQuickActions = [
    "Rotate page",
    "Delete page",
    "Extract page",
  ];
  const expectedFullPageQuickActions = [
    "Rotate page",
    "Delete page",
    "Extract page",
  ];
  const expectedPageQuickIcons = [
    "rotate_right",
    "delete",
    "ios_share",
  ];
  const editPageQuickLabels = result.editPageActions.quickActions.map(
    action => action.label
  );
  const editPageQuickIcons = result.editPageActions.quickActions.map(
    action => action.icon
  );
  const fullPageActionLabels = result.pageOrganizerFull.pageActions.map(
    action => action.label
  );
  const fullPageActionIcons = result.pageOrganizerFull.pageActions.map(
    action => action.icon
  );
  const unsupportedEditActions = ["Crop page"];
  const unsupportedFullActions = ["Crop page"];
  const unsupportedEditActionsDisabled = result.editPageActions.quickActions
    .filter(action => unsupportedEditActions.includes(action.label))
    .every(action => action.disabled);
  const unsupportedFullActionsDisabled = result.pageOrganizerFull.pageActions
    .filter(action => unsupportedFullActions.includes(action.label))
    .every(action => action.disabled);
  const pageOrganizerStatusLooksSuccessful =
    /salvat|esportat|pronto|preparat|completat/i.test(
      result.pageOrganizerFull.statusText || ""
    );
  if (
    !result.href.includes(`${directViewerPath}?view=edit`) ||
    result.canvases < 1 ||
    result.textLayers < 1 ||
    result.findVisualState.highlights < 1 ||
    !result.findVisualState.panel ||
    result.findVisualState.popover ||
    !result.findVisualState.resultList ||
    result.findVisualState.resultItems < 1 ||
    !result.findVisualState.resultMarksMatchQuery ||
    result.findVisualState.renderedCount < 1 ||
    (result.findVisualState.total > 24 &&
      result.findVisualState.initialRenderedCount !== 24) ||
    (result.findVisualState.total > 24 &&
      result.findVisualState.renderedCount <=
        result.findVisualState.initialRenderedCount) ||
    result.findVisualState.resultNavigation.page !==
      result.findVisualState.resultNavigation.target.pageNumber ||
    result.findVisualState.resultNavigation.current !==
      result.findVisualState.resultNavigation.target.resultIndex ||
    !result.regexSearchState.active ||
    !result.regexSearchState.markMatches ||
    result.regexSearchState.total <= result.findVisualState.total ||
    !result.findStatus?.includes("/") ||
    result.findTotal < 1 ||
    result.uploadStorageState.tabCount < 1 ||
    result.uploadStorageState.tabsHaveBytes ||
    result.uploadStorageState.pendingHasBytes ||
    !result.uploadStorageState.storageModes.includes("indexeddb") ||
    result.commentState.pending ||
    result.commentState.items.length < 1 ||
    !result.commentState.items.some(item => item.includes("Smoke comment")) ||
    result.commentState.searchInput ||
    !result.commentState.searchInHeader ||
    !result.commentSearchState.clearButton ||
    result.commentSearchState.items.length !== 1 ||
    !result.commentSearchState.items[0].includes("Smoke comment") ||
    !result.commentSearchState.summary?.includes("1") ||
    result.commentSearchEmptyState.items !== 0 ||
    !result.commentSearchEmptyState.empty.includes("No results") ||
    result.commentState.status ||
    !result.historyBeforeUndo.panel ||
    result.historyBeforeUndo.topbarUndoRedoButtons !== 0 ||
    result.historyBeforeUndo.runtimeCount < 1 ||
    result.historyBeforeUndo.position < 0 ||
    result.historyBeforeUndo.undoDisabled ||
    !result.historyBeforeUndo.items.some(item => item.includes("Stamp")) ||
    result.historyBeforeUndo.items.some(item =>
      item.includes("Annotation edit")
    ) ||
    !result.historyClickTarget.visible ||
    result.historyClickTarget.pageNumber !== 1 ||
    !result.historyBeforeUndo.actionLabels.join("|").includes("Undo") ||
    !result.historyBeforeUndo.actionLabels.join("|").includes("Redo") ||
    result.historyAfterUndo.position !==
      result.historyBeforeUndo.position - 1 ||
    result.historyAfterUndo.futureItems < 1 ||
    result.historyAfterUndo.redoDisabled ||
    !result.historyAfterClear.empty ||
    result.historyAfterClear.items !== 0 ||
    result.historyAfterClear.runtimeCount !== 0 ||
    !result.historyAfterClear.clearDisabled ||
    !result.historyAfterNative.items.some(item =>
      item.includes("Source text edit")
    ) ||
    !result.historyAfterNative.items.some(item =>
      item.includes("Native redact")
    ) ||
    result.historyAfterNative.items.some(item =>
      item.includes("Annotation edit")
    ) ||
    !result.allToolsStampEntryState.card ||
    !result.allToolsStampState.drawButtonActive ||
    result.allToolsStampState.drawButtonIcon !== "approval" ||
    result.allToolsStampState.leftHeader !== "Stamp palette" ||
    !result.allToolsStampState.panel ||
    result.allToolsStampState.rightPanel ||
    result.allToolsStampState.selected !== "approved" ||
    result.signFromStampState.drawTool !== "draw" ||
    result.signFromStampState.certifiedCopyButton ||
    result.signFromStampState.signMarkRow ||
    result.signFromStampState.signNote ||
    !result.signFromStampState.signatureButtonActive ||
    result.signFromStampState.stampPanel ||
    result.signFromStampState.stampSelected ||
    result.commentToolbarVisibleBeforeSelection ||
    !result.commentToolbarVisibleAfterSelection ||
    result.interactionBeforeTextSelection.canComment ||
    result.interactionBeforeTextSelection.selectionKind !== "none" ||
    !result.interactionAfterTextSelection.canBookmark ||
    !result.interactionAfterTextSelection.canComment ||
    result.interactionAfterTextSelection.selectionKind !== "text" ||
    !result.textContextMenuState.visible ||
    result.textContextMenuState.kind !== "text" ||
    !result.textContextMenuState.buttons.some(label =>
      label.includes("Add comment")
    ) ||
    !result.textContextMenuState.buttons.some(label =>
      label.includes("Add bookmark")
    ) ||
    !result.textContextMenuState.buttons.some(label =>
      label.includes("Highlight")
    ) ||
    !result.textContextMenuState.buttons.some(label =>
      label.includes("Redact")
    ) ||
    result.nativeInkStyleState.editorCount < 1 ||
    result.nativeInkStyleState.stroke.toLowerCase() !== "#b91c1c" ||
    Number(result.nativeInkStyleState.strokeWidth) < 4.5 ||
    result.settingsPreserveState.view !== "edit" ||
    result.settingsPreserveState.locale !== "en" ||
    result.settingsPreserveState.afterCount <
      result.settingsPreserveState.beforeCount ||
    !result.nativeInkSelectionState.deleteClass ||
    result.nativeInkSelectionState.deleteDisabled ||
    result.nativeInkSelectionState.selectedEditors < 1 ||
    !result.nativeInkSelectionState.interaction.canDelete ||
    result.nativeInkSelectionState.interaction.selectedEditorCount < 1 ||
    result.nativeInkSelectionState.interaction.selectionKind !==
      "annotation-editor" ||
    !result.inkContextMenuState.visible ||
    result.inkContextMenuState.kind !== "ink" ||
    !result.inkContextMenuState.buttons.some(label =>
      label.includes("Delete selection")
    ) ||
    result.drawToolbarState.color !== "#b91c1c" ||
    !result.drawToolbarState.deleteClass ||
    !result.drawToolbarState.deleteDisabled ||
    !result.drawToolbarState.stampPanel ||
    result.drawToolbarState.stampPanelLeftHeader !== "Stamp palette" ||
    result.drawToolbarState.stampPanelRightContext ||
    result.drawToolbarState.stampPresetCount < 6 ||
    result.drawToolbarState.stampSelected !== "approved" ||
    !result.drawToolbarState.dateDisabled ||
    result.drawToolbarState.styleControlsVisible ||
    result.drawToolbarState.storedIdentity.name !== "Smoke User" ||
    result.drawToolbarState.storedIdentity.title !== "Reviewer" ||
    result.drawToolbarState.storedIdentity.date !== "2026-05-24" ||
    result.drawToolbarState.storedIdentity.includeDate !== false ||
    result.drawToolbarState.strokeWidth !== "6" ||
    result.drawToolbarState.tool !== "stamp-palette" ||
    !result.drawToolbarState.uploadInput ||
    result.stampZoomState.afterZoomInWidth <=
      result.stampZoomState.beforeWidth ||
    result.stampZoomState.afterZoomOutWidth >=
      result.stampZoomState.afterZoomInWidth ||
    !result.stampPreviewState.visible ||
    !result.stampPreviewState.hasIdentity ||
    !result.stampPreviewState.hidesDate ||
    result.stampPlacementState.count < 1 ||
    !result.stampPlacementState.canvas ||
    !result.stampPlacementState.visible ||
    Math.abs(
      result.stampPlacementState.width - result.stampPreviewState.width
    ) > 12 ||
    Math.abs(
      result.stampPlacementState.height - result.stampPreviewState.height
    ) > 12 ||
    result.stampPlacementState.previewHidden !== true ||
    result.stampPlacementState.deleteDisabled ||
    result.stampPlacementState.selectedEditors < 1 ||
    !result.nativeTextActive ||
    !result.nativeTextCommitted ||
    result.nativeTextEditable < 1 ||
    result.pdfSurfaceTitleCount !== 0 ||
    !result.nativeRedactActive ||
    !result.nativeTextCapabilityPanel ||
    !result.nativeRedactCapabilityPanel ||
    !result.nativeRedactLayer ||
    result.nativeRedactPatches < 1 ||
    result.savedDownloadSize < 1 ||
    result.savedTextSearch.total < 1 ||
    result.redactedDownloadSize < 1 ||
    result.redactedTextSearch.total !== 0 ||
    result.topbarPrintState.buttons !== 0 ||
    result.topbarPrintState.calls !== 0 ||
    result.editPageActions.textActions.length !== 1 ||
    result.editPageActions.addContentActions
      .map(action => action.text)
      .join("|") !== "Edit PDF text|Text|Image|Comments|Stamp palette" ||
    result.editPageActions.addContentActions.some(action => action.disabled) ||
    result.editPageActions.textActions[0] !== "Organize pages" ||
    result.editPageActions.orderedChildren.indexOf("quick-actions") >
      result.editPageActions.orderedChildren.indexOf("Organize pages") ||
    editPageQuickLabels.join("|") !== expectedEditPageQuickActions.join("|") ||
    editPageQuickIcons.join("|") !== expectedPageQuickIcons.join("|") ||
    result.editPageActions.quickActions.some(action => action.text) ||
    result.editPageActions.quickActions.find(
      action => action.label === "Rotate page"
    )?.disabled ||
    !unsupportedEditActionsDisabled ||
    result.editPageActions.quickActions.find(
      action => action.label === "Extract page"
    )?.disabled ||
    result.pageAfterNext <= result.pageBeforeNext ||
    result.pageOrganizerQuick.mode !== "quick" ||
    result.pageOrganizerQuick.selected !== 2 ||
    !result.pageOrganizerQuick.order?.startsWith("2,1") ||
    result.pageOrganizerQuick.previewImages < 1 ||
    result.pageOrganizerQuick.leftActive.some(label =>
      label.includes("Organize pages")
    ) ||
    result.pageOrganizerQuick.railExpanded !== 1 ||
    result.pageOrganizerFull.mode !== "full" ||
    !result.pageOrganizerFull.workspace ||
    result.pageOrganizerFull.editToolSections !== 0 ||
    result.pageOrganizerFull.optionsCount !== 1 ||
    result.pageOrganizerFull.optionsTitle !== "Organize pages" ||
    fullPageActionLabels.join("|") !== expectedFullPageQuickActions.join("|") ||
    fullPageActionIcons.join("|") !== expectedPageQuickIcons.join("|") ||
    result.pageOrganizerFull.pageActions.find(
      action => action.label === "Rotate page"
    )?.disabled ||
    !unsupportedFullActionsDisabled ||
    result.pageOrganizerFull.pageActions.find(
      action => action.label === "Extract page"
    )?.disabled ||
    result.pageOrganizerFull.checkedPageActions < 1 ||
    result.pageOrganizerFull.previewRotations.find(item => item.page === 1)
      ?.rotation !== "90" ||
    result.pageOrganizerFull.previewRotations.find(item => item.page === 2)
      ?.rotation !== "0" ||
    pageOrganizerStatusLooksSuccessful ||
    result.pageOrganizerFull.previewImages < 1 ||
    result.pageOrganizerFull.railExpanded !== 0 ||
    !result.toolbar ||
    !result.signaturePicker
  ) {
    throw new Error("Viewer Next smoke assertions failed");
  }
} finally {
  await browser.close();
  await close(server);
}
