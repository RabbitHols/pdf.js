import { useState } from "react";
import {
  setShowUnimplementedTools,
  shouldShowUnimplementedTools,
} from "../app/debugSettings.js";
import { useViewerNextPreferences } from "../app/preferences.js";
import {
  supportedLocales,
  useTranslation,
} from "../i18n/index.js";
import {
  clearLocalPdfData,
  disablePersistentPdfSession,
} from "../pdf/pdfStorage.js";
import {
  supportedThemes,
  useTheme,
} from "../theme/index.js";

function SettingStatus({ state, t }) {
  if (!state?.message) {
    return null;
  }
  return (
    <p className={`options-setting-status ${state.kind}`} role="status">
      {t(state.message)}
    </p>
  );
}

export function OptionsView() {
  const { locale, resetLocale, setLocale, t } = useTranslation();
  const { resetTheme, setTheme, theme } = useTheme();
  const { preferences, resetPreferences, updatePreferences } =
    useViewerNextPreferences();
  const [storageStatus, setStorageStatus] = useState(null);
  const [settingsStatus, setSettingsStatus] = useState(null);
  const [showDebugTools, setShowDebugTools] = useState(
    shouldShowUnimplementedTools
  );

  async function clearPdfData() {
    setStorageStatus({ kind: "pending", message: "Pulizia dati PDF locali..." });
    try {
      await clearLocalPdfData();
      setStorageStatus({
        kind: "success",
        message: "Dati PDF locali cancellati.",
      });
    } catch {
      setStorageStatus({
        kind: "error",
        message: "Impossibile cancellare i dati PDF locali.",
      });
    }
  }

  function resetSettings() {
    if (!window.confirm(t("Ripristinare le impostazioni predefinite?"))) {
      return;
    }
    resetLocale();
    resetTheme();
    resetPreferences();
    setSettingsStatus({
      kind: "success",
      message: "Impostazioni ripristinate.",
    });
  }

  function updateRememberRecentDocuments(enabled) {
    updatePreferences({ rememberRecentDocuments: enabled });
    if (!enabled) {
      disablePersistentPdfSession();
    }
  }

  return (
    <main className="workspace options-workspace">
      <section className="options-panel" aria-labelledby="viewer-next-options-title">
        <div className="home-panel-header">
          <h1 id="viewer-next-options-title">{t("Opzioni")}</h1>
        </div>
        <div className="options-setting-row">
          <div>
            <h2>{t("Aspetto")}</h2>
            <p>
              {t("Usa la modalita di visualizzazione piu comoda per modificare i PDF.")}
            </p>
          </div>
          <label className="options-select theme-select">
            <span>{t("Tema")}</span>
            <select
              aria-label={t("Tema")}
              onChange={event => setTheme(event.target.value)}
              value={theme}
            >
              {supportedThemes.map(item => (
                <option
                  key={item.code}
                  value={item.code}
                >
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="options-setting-row">
          <div>
            <h2>{t("Lingua interfaccia")}</h2>
            <p>
              {t("Seleziona una lingua per Viewer Next. La modifica si applica subito e resta salvata in questo browser.")}
            </p>
          </div>
          <label className="options-select language-select">
            <span>{t("Lingua")}</span>
            <select
              aria-label={t("Lingua")}
              onChange={event => setLocale(event.target.value)}
              value={locale}
            >
              {supportedLocales.map(item => (
                <option
                  key={item.code}
                  value={item.code}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="options-section-header">
          <h2>{t("Files & Storage")}</h2>
        </div>
        <div className="options-setting-row">
          <div>
            <h3>{t("Remember recent documents")}</h3>
            <p>
              {t("Mantiene i PDF e le schede recenti nello storage locale del browser. Se disattivato, Viewer Next usa solo la sessione corrente.")}
            </p>
          </div>
          <label className="options-toggle">
            <input
              aria-label={t("Remember recent documents")}
              checked={preferences.rememberRecentDocuments}
              onChange={event =>
                updateRememberRecentDocuments(event.target.checked)
              }
              type="checkbox"
            />
            <span>{preferences.rememberRecentDocuments ? t("On") : t("Off")}</span>
          </label>
        </div>
        <div className="options-setting-row">
          <div>
            <h3>{t("Clear local PDF data")}</h3>
            <p>
              {t("Cancella PDF recenti, schede salvate, caricamenti in sospeso e cronologia locale dei PDF da questo browser.")}
            </p>
            <SettingStatus state={storageStatus} t={t} />
          </div>
          <button
            className="options-secondary-button"
            onClick={clearPdfData}
            title={t("Clear local PDF data")}
            type="button"
          >
            {t("Clear local PDF data")}
          </button>
        </div>
        <div className="options-setting-row">
          <div>
            <h3>{t("Default export filename")}</h3>
            <p>
              {t("Usa un pattern per il nome dei PDF salvati o esportati. Puoi usare {name} e {date}.")}
            </p>
          </div>
          <label className="options-select options-text-field">
            <span>{t("Filename pattern")}</span>
            <input
              aria-label={t("Default export filename")}
              onChange={event =>
                updatePreferences({
                  defaultExportFilename: event.target.value,
                })
              }
              placeholder={t("{name}-edited.pdf")}
              type="text"
              value={preferences.defaultExportFilename}
            />
          </label>
        </div>

        <div className="options-section-header">
          <h2>{t("Privacy / Local Data")}</h2>
        </div>
        <div className="options-info-block">
          <h3>{t("Where recent PDFs are stored")}</h3>
          <p>
            {t("Quando un PDF appare nei recenti, Viewer Next lo salva localmente in questo browser, di solito tramite IndexedDB, localStorage o sessionStorage. Non viene caricato su un server.")}
          </p>
          <p>
            {t("I file possono restare disponibili nei recenti finche non li rimuovi, cancelli i dati del sito o usi Clear local PDF data.")}
          </p>
          <details>
            <summary>{t("Learn about local storage")}</summary>
            <p>
              {t("IndexedDB conserva i bytes dei PDF, mentre localStorage e sessionStorage possono conservare schede, sessioni e preferenze. Cancellare i dati del browser o del sito rimuove queste informazioni locali.")}
            </p>
          </details>
        </div>
        <div className="options-setting-row">
          <div>
            <h3>{t("Reset settings")}</h3>
            <p>
              {t("Ripristina lingua, aspetto e preferenze di Viewer Next ai valori predefiniti.")}
            </p>
            <SettingStatus state={settingsStatus} t={t} />
          </div>
          <button
            className="options-secondary-button"
            onClick={resetSettings}
            title={t("Reset settings")}
            type="button"
          >
            {t("Reset settings")}
          </button>
        </div>

        <div className="options-section-header">
          <h2>{t("Advanced")}</h2>
        </div>
        <div className="options-setting-row">
          <div>
            <h3>{t("Show unfinished tools")}</h3>
            <p>
              {t("Mostra strumenti di debug e smoke test durante lo sviluppo locale.")}
            </p>
          </div>
          <label className="options-toggle">
            <input
              aria-label={t("Show unfinished tools")}
              checked={showDebugTools}
              onChange={event => {
                const enabled = event.target.checked;
                setShowDebugTools(enabled);
                setShowUnimplementedTools(enabled);
              }}
              type="checkbox"
            />
            <span>{showDebugTools ? t("On") : t("Off")}</span>
          </label>
        </div>
      </section>
    </main>
  );
}
