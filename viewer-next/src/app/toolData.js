export const editPageActions = [
  ["grid_view", "Organizza pagine", "pages-organizer"],
];

export const editPageQuickActions = [
  {
    action: "rotate",
    icon: "rotate_right",
    label: "Ruota pagina",
    title: "Ruota pagina nel viewer",
  },
  {
    action: null,
    debugOnly: true,
    disabled: true,
    icon: "crop",
    label: "Ritaglia pagina",
    title: "Ritaglia pagina non ancora collegato a una action PDF reale",
  },
  {
    action: "delete-page",
    icon: "delete",
    label: "Elimina pagina",
    title: "Elimina pagina",
  },
  {
    action: "extract-pages",
    icon: "ios_share",
    label: "Estrai pagina",
    title: "Estrai pagine",
  },
];

export function getVisibleEditPageQuickActions({ showDebug = false } = {}) {
  return editPageQuickActions.filter(action => {
    if (!showDebug && (action.debugOnly || action.disabled || !action.action)) {
      return false;
    }
    return true;
  });
}

export const editContentActions = [
  ["edit_note", "Modifica testo PDF", "native-text-edit", { debugOnly: true }],
  ["text_fields", "Testo", "textbox"],
  ["image", "Immagine", "image"],
  ["comment", "Commenti", "comments-panel"],
  ["approval", "Palette timbri", "stamp-palette"],
];

export function getVisibleEditContentActions({ showDebug = false } = {}) {
  return editContentActions.filter(([, , , options]) => {
    if (!showDebug && options?.debugOnly) {
      return false;
    }
    return true;
  });
}

export const editOptionActions = [
  ["library_add", "Combina più file", "combine-files"],
  ["bookmark", "Segnalibri", "bookmarks-panel"],
  ["ink_highlighter", "Redigi un PDF", "native-redact", { debugOnly: true }],
];

export function getVisibleEditOptionActions({ showDebug = false } = {}) {
  return editOptionActions.filter(([, , , options]) => {
    if (!showDebug && options?.debugOnly) {
      return false;
    }
    return true;
  });
}

export const defaultTextStyle = {
  bold: false,
  charSpacing: 0,
  color: "#000000",
  fontFamily: "Helvetica",
  fontSize: 12,
  horizontalScale: 100,
  indent: 0,
  italic: false,
  lineSpacing: 1.35,
  listStyle: "none",
  script: "normal",
  textAlign: "left",
  underline: false,
};

export const freeTextCustomFonts = [
  ["Helvetica", "Helvetica"],
  ["Times-Roman", "Times"],
  ["Courier", "Courier"],
];

export const freeTextFontSizes = [8, 9, 10, 11, 12, 14, 18, 24, 36, 48];

export const freeTextLineSpacings = [1, 1.15, 1.35, 1.5, 2];

export const freeTextIndents = [0, 1, 2, 3];

export const freeTextHorizontalScales = [75, 90, 100, 110, 125];

export const freeTextCharSpacings = [0, 0.5, 1, 2, 4];

export const pageToolRegistry = [
  {
    id: "edit-pdf",
    category: "edit",
    debugOnly: true,
    descriptionKey: "Modifica il testo sorgente del PDF quando supportato.",
    editAction: "native-text-edit",
    icon: "edit_note",
    implemented: false,
    requiresDocument: true,
    surfaces: ["home", "all-tools", "side"],
    target: "edit",
    titleKey: "Modifica testo PDF",
  },
  {
    id: "create-pdf",
    category: "create",
    debugOnly: true,
    descriptionKey: "Crea PDF da immagini, documenti e altri file.",
    icon: "note_add",
    implemented: false,
    requiresDocument: false,
    surfaces: ["all-tools", "side"],
    target: "home",
    titleKey: "Crea PDF",
  },
  {
    id: "combine-files",
    category: "combine",
    descriptionKey: "Unisci più file in un unico PDF.",
    icon: "library_add",
    implemented: true,
    requiresDocument: false,
    surfaces: ["home", "all-tools", "side"],
    target: "combine",
    titleKey: "Combina più file",
  },
  {
    id: "request-signatures",
    category: "sign",
    debugOnly: true,
    descriptionKey: "Invia un documento per richiedere una firma.",
    icon: "approval",
    implemented: false,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "sign",
    titleKey: "Richiedi firme elettr.",
  },
  {
    id: "fill-sign",
    category: "sign",
    descriptionKey: "Aggiungi la tua firma o iniziali.",
    editAction: "signature",
    icon: "gesture",
    implemented: true,
    requiresDocument: true,
    surfaces: ["home", "all-tools"],
    target: "sign",
    titleKey: "Compila e firma",
  },
  {
    id: "organize-pages",
    category: "page",
    descriptionKey: "Elimina, ruota, estrai e riordina le pagine.",
    editAction: "pages-organizer",
    icon: "grid_view",
    implemented: true,
    requiresDocument: true,
    surfaces: ["home", "all-tools", "side"],
    target: "edit",
    titleKey: "Organizza pagine",
  },
  {
    id: "export-pdf",
    category: "convert",
    debugOnly: true,
    descriptionKey: "Converti il PDF in formati modificabili.",
    icon: "ios_share",
    implemented: false,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: "convert",
    titleKey: "Esporta un PDF",
  },
  {
    id: "comments",
    category: "review",
    descriptionKey: "Aggiungi note, evidenziazioni e commenti.",
    editAction: "comments-panel",
    icon: "comment",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: "edit",
    titleKey: "Commenti",
  },
  {
    id: "compress-pdf",
    category: "optimize",
    debugOnly: true,
    descriptionKey: "Riduci la dimensione del file PDF.",
    icon: "compress",
    implemented: false,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: null,
    titleKey: "Comprimi un PDF",
  },
  {
    id: "protect-pdf",
    category: "protect",
    debugOnly: true,
    descriptionKey: "Proteggi il PDF con password o certificato.",
    icon: "shield",
    implemented: false,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: null,
    titleKey: "Proteggi un PDF",
  },
  {
    id: "draw",
    category: "edit",
    descriptionKey: "Aggiungi disegni e tratti a mano libera.",
    editAction: "ink",
    icon: "draw",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Disegna",
  },
  {
    id: "stamp-palette",
    category: "edit",
    descriptionKey: "Aggiungi timbri predefiniti o personalizzati.",
    editAction: "stamp-palette",
    icon: "approval",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: "edit",
    titleKey: "Palette timbri",
  },
  {
    id: "highlight",
    category: "edit",
    descriptionKey: "Evidenzia testo e passaggi importanti.",
    editAction: "highlight",
    icon: "border_color",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Evidenzia",
  },
  {
    id: "add-image",
    category: "edit",
    descriptionKey: "Inserisci immagini nel documento.",
    editAction: "image",
    icon: "image",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Immagine",
  },
  {
    id: "add-text",
    category: "edit",
    descriptionKey: "Inserisci testo libero nel PDF.",
    editAction: "textbox",
    icon: "text_fields",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Testo",
  },
  {
    id: "rotate-pages",
    category: "page",
    descriptionKey: "Ruota rapidamente le pagine del documento.",
    editAction: "pages-panel",
    icon: "rotate_right",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Ruota pagina",
  },
  {
    id: "extract-pages",
    category: "page",
    descriptionKey: "Estrai pagine dal PDF aperto.",
    editAction: "extract-pages",
    icon: "ios_share",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Estrai pagine",
  },
  {
    id: "bookmarks",
    category: "review",
    descriptionKey: "Gestisci i segnalibri del PDF aperto.",
    editAction: "bookmarks-panel",
    icon: "bookmark",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: "edit",
    titleKey: "Segnalibri",
  },
  {
    id: "native-redact",
    category: "protect",
    debugOnly: true,
    descriptionKey: "Oscura contenuti sensibili nel PDF.",
    editAction: "native-redact",
    icon: "ink_eraser",
    implemented: false,
    requiresDocument: true,
    surfaces: ["all-tools", "side"],
    target: "edit",
    titleKey: "Redigi un PDF",
  },
  {
    id: "search-pdf",
    category: "review",
    descriptionKey: "Trova testo nel documento aperto.",
    icon: "search",
    implemented: true,
    requiresDocument: true,
    surfaces: ["all-tools"],
    target: "edit",
    titleKey: "Cerca nel PDF",
  },
  {
    id: "convert-word",
    category: "convert",
    debugOnly: true,
    icon: "description",
    implemented: false,
    requiresDocument: true,
    surfaces: ["convert"],
    target: null,
    titleKey: "Microsoft Word",
  },
  {
    id: "convert-powerpoint",
    category: "convert",
    debugOnly: true,
    icon: "slideshow",
    implemented: false,
    requiresDocument: true,
    surfaces: ["convert"],
    target: null,
    titleKey: "PowerPoint",
  },
  {
    id: "convert-excel",
    category: "convert",
    debugOnly: true,
    icon: "table",
    implemented: false,
    requiresDocument: true,
    surfaces: ["convert"],
    target: null,
    titleKey: "Microsoft Excel",
  },
  {
    id: "convert-image",
    category: "convert",
    debugOnly: true,
    icon: "image",
    implemented: false,
    requiresDocument: true,
    surfaces: ["convert"],
    target: null,
    titleKey: "Formato immagine",
  },
  {
    id: "convert-html",
    category: "convert",
    debugOnly: true,
    icon: "html",
    implemented: false,
    requiresDocument: true,
    surfaces: ["convert"],
    target: null,
    titleKey: "Pagina web HTML",
  },
];

export function getVisibleTools({
  showDebug = false,
  surface = "all-tools",
} = {}) {
  return pageToolRegistry.filter(tool => {
    if (!tool.surfaces?.includes(surface)) {
      return false;
    }
    if (!showDebug && (tool.debugOnly || !tool.implemented)) {
      return false;
    }
    return true;
  });
}

function toLegacyToolTuple(tool) {
  return [
    tool.icon,
    tool.titleKey,
    tool.descriptionKey,
    tool.target,
    tool.editAction,
  ];
}

export const allToolsSideActions = getVisibleTools({
  showDebug: true,
  surface: "side",
}).map(tool => [tool.icon, tool.titleKey, tool.target, tool.editAction]);

export const convertSideActions = getVisibleTools({
  showDebug: true,
  surface: "convert",
}).map(tool => [tool.icon, tool.titleKey, tool.target, tool.editAction]);

export const recommendedTools = getVisibleTools({
  showDebug: true,
  surface: "home",
}).map(toLegacyToolTuple);

export const allTools = getVisibleTools({
  showDebug: true,
  surface: "all-tools",
}).map(toLegacyToolTuple);

export const editorTools = [
  ["select", "near_me", "Select"],
  ["native-text-edit", "edit_note", "Modifica testo PDF", { debugOnly: true }],
  ["textbox", "text_fields", "Testo"],
  ["ink", "draw", "Draw"],
  ["image", "image", "Immagine"],
  ["highlight", "border_color", "Highlight"],
  ["signature", "gesture", "Firma"],
  ["comment", "comment", "Commenti"],
  ["native-redact", "ink_eraser", "Redigi un PDF", { debugOnly: true }],
];

export function getVisibleEditorTools({ showDebug = false } = {}) {
  return editorTools.filter(([, , , options]) => {
    if (!showDebug && options?.debugOnly) {
      return false;
    }
    return true;
  });
}

export const drawToolOptions = [
  ["draw", "gesture", "Disegna"],
  ["line", "horizontal_rule", "Linea"],
  ["arrow", "arrow_right_alt", "Freccia"],
  ["checkmark", "check", "Spunta"],
  ["cross", "close", "X"],
  ["rectangle", "crop_square", "Rettangolo"],
  ["circle", "radio_button_unchecked", "Cerchio"],
  ["callout", "add_comment", "Callout testo"],
  ["polygon", "hexagon", "Poligono"],
  ["cloud", "cloud", "Fumetto"],
  ["polyline", "polyline", "Linee connesse"],
  ["stamp-palette", "approval", "Palette timbri"],
];

export const highlightColors = [
  ["#ffea00", "Yellow"],
  ["#ff5a1f", "Orange"],
  ["#22c55e", "Green"],
  ["#38bdf8", "Blue"],
  ["#d946ef", "Pink"],
];
