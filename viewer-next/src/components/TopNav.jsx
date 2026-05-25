import { shouldShowUnimplementedTools } from "../app/debugSettings.js";
import { getVisibleToolTabs } from "../app/viewRouting.js";
import { useTranslation } from "../i18n/index.js";
import { Icon } from "./Icon.jsx";

export function TopNav({
  activeToolView,
  activePdfTabId,
  canRunDocumentActions,
  documentActionStatus,
  hasDocument,
  isDocumentPanelOpen,
  navigate,
  onDownload,
  onToggleTheme,
  onToggleDocumentPanel,
  pdfTabs,
  resolvedTheme = "light",
  view,
}) {
  const { t } = useTranslation();
  const actionRunning = documentActionStatus?.state === "running";
  const activePdfTab = pdfTabs.find(tab => tab.id === activePdfTabId);
  const activeDocumentName = activePdfTab?.name || t("Documenti");
  const showDocumentActions = canRunDocumentActions;
  const showUnimplementedTools = shouldShowUnimplementedTools();
  const nextThemeLabel =
    resolvedTheme === "dark"
      ? t("Passa al tema chiaro")
      : t("Passa al tema scuro");
  const visibleToolTabs = getVisibleToolTabs({
    hasDocument,
    showDebug: showUnimplementedTools,
  });

  return (
    <header className="topbar">
      <div className="topbar-row">
        <button
          aria-expanded={isDocumentPanelOpen}
          className="document-switcher-button"
          onClick={onToggleDocumentPanel}
          title={activeDocumentName}
          type="button"
        >
          <Icon>menu</Icon>
        </button>
        <nav className="tool-tabs">
          {visibleToolTabs.map(item => (
            <button
              className={activeToolView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              {t(item.label)}
            </button>
          ))}
        </nav>
        <div className="topbar-divider"></div>
        <div className="topbar-spacer"></div>
        {documentActionStatus?.message ? (
          <span
            className={`document-action-status ${documentActionStatus.state}`}
            role="status"
          >
            {documentActionStatus.message}
          </span>
        ) : null}
        {showDocumentActions ? (
          <button
            className="download-button"
            disabled={actionRunning}
            onClick={onDownload}
            title={t("Save")}
          >
            {t("Save")}
          </button>
        ) : null}
        <button
          aria-label={nextThemeLabel}
          className="icon-button theme-toggle-button"
          onClick={onToggleTheme}
          title={nextThemeLabel}
          type="button"
        >
          <Icon>{resolvedTheme === "dark" ? "light_mode" : "dark_mode"}</Icon>
        </button>
        <button
          aria-label={t("Opzioni")}
          className={view === "options" ? "icon-button active" : "icon-button"}
          onClick={() => navigate("options")}
          title={t("Opzioni")}
          type="button"
        >
          <Icon>settings</Icon>
        </button>
      </div>
    </header>
  );
}
