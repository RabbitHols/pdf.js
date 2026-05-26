const unrestrictedPolicy = {
  blocked: false,
  disabled: false,
  enabled: true,
  hidden: false,
  reason: "",
  state: "enabled",
  warning: "",
};

const pdfActionAliases = {
  delete: "delete-annotation",
  draw: "draw",
  image: "add-image",
  ink: "draw",
  line: "draw",
  arrow: "draw",
  rectangle: "draw",
  circle: "draw",
  callout: "draw",
  polygon: "draw",
  cloud: "draw",
  polyline: "draw",
  "stamp-palette": "draw",
  stamp: "draw",
  text: "add-text",
  textbox: "add-text",
  rotate: "rotate-page",
  "rotate-pages": "rotate-page",
  "pages-panel": "organize-pages",
  "pages-organizer": "organize-pages",
  "comments-panel": "comment",
  "fill-sign": "signature",
  "add-bookmark": "bookmark",
  bookmarks: "bookmark",
  "bookmarks-panel": "bookmark",
  "search-pdf": "search",
};

const actionRequirements = {
  comment: {
    permission: "annotations",
    reason: "annotations",
  },
  highlight: {
    permission: "annotations",
    reason: "annotations",
  },
  draw: {
    permission: "annotations",
    reason: "annotations",
  },
  signature: {
    permission: "annotations",
    reason: "signature",
  },
  "delete-annotation": {
    permission: "annotations",
    reason: "delete-annotation",
  },
  "add-text": {
    permission: "modify",
    reason: "content",
  },
  "add-image": {
    permission: "modify",
    reason: "content",
  },
  "native-text-edit": {
    permission: "modify",
    reason: "content",
  },
  "native-redact": {
    permission: "modify",
    reason: "content",
  },
  "protect-pdf": {
    permission: "modify",
    reason: "content",
  },
  "rotate-page": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "delete-page": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "extract-pages": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "organize-pages": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "insert-pages": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "replace-pages": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "split-pages": {
    permission: ["assemble", "modify"],
    reason: "pages",
  },
  "copy-text": {
    permission: "copy",
    reason: "copy",
  },
  print: {
    permission: "print",
    reason: "print",
  },
  "fill-form": {
    permission: "forms",
    reason: "forms",
  },
};

const documentActions = new Set([
  ...Object.keys(actionRequirements),
  "download",
  "save",
]);

function identity(value) {
  return value;
}

function getPermissionDetail(pdfSecurity, key) {
  return (pdfSecurity?.permissions?.details || []).find(
    detail => detail.key === key
  );
}

function permissionAllows(pdfSecurity, permission) {
  const permissions = pdfSecurity?.permissions;
  if (!permissions?.isAvailable || !permissions.hasRestrictions) {
    return true;
  }
  const permissionKeys = Array.isArray(permission) ? permission : [permission];
  return permissionKeys.some(
    key => getPermissionDetail(pdfSecurity, key)?.allowed === true
  );
}

function getBlockedReason(reason, t) {
  const messages = {
    annotations: t(
      "Il PDF non consente commenti, evidenziazioni o modifiche alle annotazioni."
    ),
    content: t("Il PDF non consente modifiche al contenuto."),
    "delete-annotation": t(
      "Il PDF non consente di modificare o rimuovere annotazioni."
    ),
    document: t("Apri un PDF per usare questa azione."),
    forms: t("Il PDF non consente la compilazione dei moduli."),
    loading: t("Il documento e' ancora in caricamento."),
    pages: t("Il PDF non consente operazioni sulle pagine."),
    print: t("Il PDF non consente la stampa."),
    copy: t("Il PDF non consente la copia del testo."),
    signature: t("Il PDF non consente firme o modifiche alle annotazioni."),
  };
  return messages[reason] || t("Azione disabilitata dai permessi del PDF.");
}

function toBlockedPolicy(actionId, reason, t) {
  return {
    actionId,
    blocked: true,
    disabled: true,
    enabled: false,
    hidden: false,
    reason: getBlockedReason(reason, t),
    state: "disabled",
    warning: "",
  };
}

function hasSignedDocumentEdits(facts) {
  const security = facts?.pdfSecurity || {};
  if (!security.signatures?.hasDigitalSignatures) {
    return false;
  }
  if (facts?.hasRuntimeEdits) {
    return true;
  }
  const nativeEditing = facts?.nativeEditing || {};
  const editing = facts?.editing || {};
  return Boolean(
    editing.runtimeHistory?.entries?.length ||
      nativeEditing.redactionPatches ||
      nativeEditing.textEditCommitted ||
      facts?.hasPageDraftChanges
  );
}

export function normalizePdfActionId(actionId) {
  if (!actionId) {
    return "";
  }
  return pdfActionAliases[actionId] || actionId;
}

export function inferPdfActionId(value) {
  return normalizePdfActionId(value);
}

export function getPdfActionPolicy(actionId, facts = {}, translate = identity) {
  const t = typeof translate === "function" ? translate : identity;
  const normalizedActionId = normalizePdfActionId(actionId);
  if (!normalizedActionId) {
    return { ...unrestrictedPolicy, actionId: normalizedActionId };
  }

  const requiresDocument = documentActions.has(normalizedActionId);
  if (requiresDocument && facts.hasDocument === false) {
    return toBlockedPolicy(normalizedActionId, "document", t);
  }
  if (requiresDocument && facts.loading) {
    return toBlockedPolicy(normalizedActionId, "loading", t);
  }

  const requirement = actionRequirements[normalizedActionId];
  if (
    requirement &&
    !permissionAllows(facts.pdfSecurity, requirement.permission)
  ) {
    return toBlockedPolicy(normalizedActionId, requirement.reason, t);
  }

  const policy = {
    ...unrestrictedPolicy,
    actionId: normalizedActionId,
    requiresDocument,
  };
  if (
    (normalizedActionId === "save" || normalizedActionId === "download") &&
    hasSignedDocumentEdits(facts)
  ) {
    return {
      ...policy,
      state: "warning",
      warning: t("Le modifiche possono invalidare la firma digitale."),
    };
  }
  return policy;
}

export function getPdfActionPermission(actionId, pdfSecurity, translate) {
  const policy = getPdfActionPolicy(
    actionId,
    {
      hasDocument: true,
      pdfSecurity,
    },
    translate
  );
  return {
    allowed: policy.enabled,
    reason: policy.reason,
  };
}
