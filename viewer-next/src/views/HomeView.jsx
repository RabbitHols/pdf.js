import { useRef } from "react";
import { shouldShowUnimplementedTools } from "../app/debugSettings.js";
import { getVisibleTools } from "../app/toolData.js";
import { Icon } from "../components/Icon.jsx";
import { useTranslation } from "../i18n/index.js";
import { formatBytes } from "../pdf/pdfStorage.js";

export function HomeView({
  activePdfTabId,
  hasDocument,
  navigate,
  onClosePdfTab,
  onOpenFile,
  onRunEditorAction,
  onSelectPdfTab,
  pdfTabs,
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
    <main className="workspace home-workspace">
      <section className="recommended-tools-panel">
        <div className="home-panel-header">
          <h1>{t("Apri o riprendi un PDF")}</h1>
        </div>
        <div className="tools-document-prompt" role="status">
          <Icon>upload_file</Icon>
          <span>
            <strong>{t("Lavora con un PDF")}</strong>
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
        <div className="recommended-tools-grid all-tools-grid">
          {visibleTools.map(tool => {
            const needsDocument = tool.requiresDocument && !hasDocument;
            return (
              <button
                className={needsDocument ? "needs-document" : ""}
                disabled={!tool.target}
                key={tool.id}
                onClick={() => {
                  if (!tool.target) {
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
                    ? t("Scegli un PDF per iniziare")
                    : tool.target
                      ? t(tool.titleKey)
                      : `${t(tool.titleKey)} non ancora disponibile`
                }
              >
                <Icon>{tool.icon}</Icon>
                <span>
                  <strong>{t(tool.titleKey)}</strong>
                  <small>{t(tool.descriptionKey)}</small>
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
      <section className="current-files-panel">
        <div className="home-panel-header">
          <h2>{t("File in modifica")}</h2>
          <div className="view-toggle">
            <button className="active" title={t("Vista lista")}>
              <Icon>view_list</Icon>
            </button>
            <button title={t("Vista griglia")}>
              <Icon>grid_view</Icon>
            </button>
          </div>
        </div>
        <div className="current-files-table">
          <div className="current-files-head">
            <span>{t("Nome")}</span>
            <span>{t("Stato")}</span>
            <span>{t("Dimensione")}</span>
          </div>
          {pdfTabs.length > 0 ? (
            pdfTabs.map(tab => (
              <div
                className={
                  tab.id === activePdfTabId
                    ? "current-file-row active"
                    : "current-file-row"
                }
                key={tab.id}
              >
                <button
                  onClick={() => {
                    onSelectPdfTab(tab.id);
                    navigate("edit");
                  }}
                >
                  <span>
                    <Icon>picture_as_pdf</Icon>
                    <strong>{tab.name}</strong>
                    <small>PDF</small>
                  </span>
                  <span>
                    {tab.id === activePdfTabId ? t("In modifica") : t("Aperto")}
                  </span>
                  <span>{formatBytes(tab.size)}</span>
                </button>
                <button
                  aria-label={t("Chiudi {{name}}", { name: tab.name })}
                  className="current-file-close"
                  onClick={() => onClosePdfTab(tab.id)}
                  title={t("Chiudi {{name}}", { name: tab.name })}
                >
                  <Icon>close</Icon>
                </button>
              </div>
            ))
          ) : (
            <div className="empty-current-files">
              <Icon>picture_as_pdf</Icon>
              <span>{t("Nessun file aperto")}</span>
              <button onClick={() => inputRef.current?.click()}>
                {t("Apri un PDF")}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
