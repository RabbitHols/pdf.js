import { useRef } from "react";
import { shouldShowUnimplementedTools } from "../app/debugSettings.js";
import {
  getPdfActionPolicy,
  inferPdfActionId,
} from "../app/pdfActionPolicy.js";
import { getVisibleTools } from "../app/toolData.js";
import { Icon } from "../components/Icon.jsx";
import { useTranslation } from "../i18n/index.js";

export function AllToolsView({
  hasDocument,
  navigate,
  onOpenFile,
  onRunEditorAction,
  viewerState,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const pendingToolRef = useRef(null);
  const showUnimplementedTools = shouldShowUnimplementedTools();
  const visibleTools = getVisibleTools({
    hasDocument,
    showDebug: showUnimplementedTools,
    surface: "all-tools",
  });

  function continueToTool(tool) {
    if (tool.target === "edit" && tool.editAction && onRunEditorAction) {
      onRunEditorAction(tool.editAction);
      return;
    }
    navigate(tool.target);
  }

  async function onFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      pendingToolRef.current = null;
      return;
    }
    const pendingTool = pendingToolRef.current;
    pendingToolRef.current = null;
    await onOpenFile(file);
    if (pendingTool) {
      continueToTool(pendingTool);
    }
  }

  return (
    <main className="workspace tools-workspace">
      <section className="recommended-tools-panel all-tools-panel">
        <div className="home-panel-header">
          <h1>{t("Tutti gli strumenti")}</h1>
        </div>
        {!hasDocument ? (
          <div className="tools-document-prompt" role="status">
            <Icon>upload_file</Icon>
            <span>
              <strong>
                {t("Apri un PDF per usare gli strumenti documento")}
              </strong>
              <small>
                {t(
                  "Modifica, firma e strumenti pagina si attivano sul file aperto."
                )}
              </small>
            </span>
            <button onClick={() => inputRef.current?.click()} type="button">
              {t("Apri PDF")}
            </button>
          </div>
        ) : null}
        <div className="recommended-tools-grid all-tools-grid">
          {visibleTools.map(tool => {
            const needsDocument = !hasDocument && tool.requiresDocument;
            const actionId = inferPdfActionId(tool.editAction || tool.id);
            const policy =
              hasDocument && actionId
                ? getPdfActionPolicy(
                    actionId,
                    {
                      hasDocument,
                      loading: viewerState?.loading,
                      pdfSecurity: viewerState?.pdfSecurity,
                    },
                    t
                  )
                : null;
            const isBlocked = Boolean(policy && !policy.enabled);
            return (
              <button
                className={
                  [needsDocument ? "needs-document" : "", isBlocked ? "blocked" : ""]
                    .filter(Boolean)
                    .join(" ")
                }
                disabled={!tool.target || isBlocked}
                key={tool.id}
                onClick={() => {
                  if (!tool.target || isBlocked) {
                    return;
                  }
                  if (needsDocument) {
                    pendingToolRef.current = tool;
                    inputRef.current?.click();
                    return;
                  }
                  continueToTool(tool);
                }}
                title={
                  needsDocument
                    ? t("Apri un PDF per usare {{label}}", {
                        label: t(tool.titleKey),
                      })
                    : isBlocked
                      ? policy.reason
                      : tool.target
                      ? t(tool.titleKey)
                      : `${t(tool.titleKey)} non ancora disponibile`
                }
              >
                <Icon>{tool.icon}</Icon>
                <span>
                  <strong>{t(tool.titleKey)}</strong>
                  <small>{t(tool.descriptionKey)}</small>
                  {tool.id === "protect-pdf" ? (
                    <span className="tool-card-tags">
                      <span>{t("Password di apertura")}</span>
                      <span>{t("Restrizioni file")}</span>
                    </span>
                  ) : null}
                  <em>
                    {needsDocument
                      ? t("Scegli un PDF per iniziare")
                      : t("Usa ora")}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
        <input
          accept="application/pdf,.pdf"
          className="hidden-input"
          onChange={onFileChange}
          ref={inputRef}
          type="file"
        />
      </section>
    </main>
  );
}
