export const toolTabs = [
  { id: "all-tools", label: "Tutti gli strumenti" },
  { id: "edit", label: "Modifica", requiresDocument: true },
  { id: "convert", label: "Converti", requiresDocument: true },
  { id: "sign", label: "Firma elettronica", requiresDocument: true },
];

export const toolViewIds = new Set(toolTabs.map(item => item.id));
export const documentViewIds = new Set(
  toolTabs.filter(item => item.requiresDocument).map(item => item.id)
);

export function getVisibleToolTabs({ hasDocument = false, showDebug = false }) {
  return toolTabs.filter(item => {
    if (item.requiresDocument && !hasDocument) {
      return false;
    }
    if (item.id === "convert" && !showDebug) {
      return false;
    }
    return true;
  });
}

export function requiresDocumentView(view) {
  return documentViewIds.has(view);
}

export const initialToolByView = {
  edit: "select",
  sign: "signature",
};

export function getInitialView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") || "home";
}

export function normalizeView(view) {
  if (view === "combine" || view === "merge") {
    return "combine";
  }
  if (view === "all" || view === "tools") {
    return "all-tools";
  }
  if (
    view === "home" ||
    view === "combine" ||
    view === "edit" ||
    view === "convert" ||
    view === "options" ||
    view === "sign"
  ) {
    return view;
  }
  if (view === "all-tools") {
    return view;
  }
  return "home";
}

export function updateUrl(view, { replace = false } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ view }, "", url);
}
