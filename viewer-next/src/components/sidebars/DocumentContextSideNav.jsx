import { useRef } from "react";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

export function DocumentContextSideNav({
  activePdfTabId,
  navigate,
  onClose,
  onClosePdfTab,
  onCreateFile,
  onSelectPdfTab,
  pdfTabs,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const activePdfTab = pdfTabs.find(tab => tab.id === activePdfTabId);

  return (
    <aside className="sidenav tool-context-sidenav document-context-sidenav">
      <div className="tool-context-header">
        <h2>{t("Documenti")}</h2>
        <button
          aria-label={t("Chiudi Documenti")}
          onClick={onClose}
          title={t("Chiudi Documenti")}
        >
          <Icon>close</Icon>
        </button>
      </div>
      {activePdfTab ? (
        <div className="document-context-current" title={activePdfTab.name}>
          <Icon>picture_as_pdf</Icon>
          <strong>{activePdfTab.name}</strong>
        </div>
      ) : null}
      <div className="tool-context-list">
        <button onClick={() => inputRef.current?.click()} type="button">
          <Icon>add</Icon>
          {t("Apri PDF")}
        </button>
        <input
          accept="application/pdf,.pdf"
          className="hidden-input"
          onChange={event => {
            onClose();
            onCreateFile(event);
          }}
          ref={inputRef}
          type="file"
        />
      </div>
      <div className="document-context-section">
        <p>{t("File aperti")}</p>
        {pdfTabs.length > 0 ? (
          pdfTabs.map(tab => (
            <div
              className={
                tab.id === activePdfTabId
                  ? "document-context-item active"
                  : "document-context-item"
              }
              key={tab.id}
            >
              <button
                className="document-context-main"
                onClick={() => {
                  onSelectPdfTab(tab.id);
                  onClose();
                  navigate("edit");
                }}
                title={tab.name}
                type="button"
              >
                <Icon>description</Icon>
                <span>{tab.name}</span>
              </button>
              <button
                aria-label={t("Chiudi {{name}}", { name: tab.name })}
                className="document-context-close"
                onClick={() => onClosePdfTab(tab.id)}
                title={t("Chiudi {{name}}", { name: tab.name })}
                type="button"
              >
                <Icon>close</Icon>
              </button>
            </div>
          ))
        ) : (
          <div className="document-context-empty">
            <Icon>picture_as_pdf</Icon>
            <span>{t("Nessun PDF aperto")}</span>
            <small>{t("Apri un PDF per iniziare.")}</small>
          </div>
        )}
      </div>
    </aside>
  );
}
