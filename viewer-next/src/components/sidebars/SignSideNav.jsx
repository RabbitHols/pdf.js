import { shouldShowUnimplementedTools } from "../../app/debugSettings.js";
import { getPdfActionPolicy } from "../../app/pdfActionPolicy.js";
import { useTranslation } from "../../i18n/index.js";
import { SavedSignatureList } from "../editor/SavedSignatureList.jsx";
import { Icon } from "../Icon.jsx";

export function SignSideNav({
  onClose,
  onDeleteSavedSignature,
  onListSavedSignatures,
  onOpenSignatureDialog,
  onUseSavedSignature,
  viewerState,
}) {
  const { t } = useTranslation();
  const showUnimplementedTools = shouldShowUnimplementedTools();
  const signaturePolicy = getPdfActionPolicy(
    "signature",
    {
      hasDocument: Boolean(viewerState?.pagesCount),
      loading: viewerState?.loading,
      pdfSecurity: viewerState?.pdfSecurity,
    },
    t
  );

  return (
    <aside className="sidenav tool-context-sidenav">
      <div className="tool-context-header">
        <h2>{t("Firma elettronica")}</h2>
        <button
          aria-label={t("Chiudi firma elettronica")}
          onClick={onClose}
          title={t("Chiudi firma elettronica")}
        >
          <Icon>close</Icon>
        </button>
      </div>
      <section className="sign-self-card">
        <p>{t("Compila e firma tu stesso/a")}</p>
        {showUnimplementedTools ? (
          <div className="sign-mark-row">
            {[
              "gesture",
              "close",
              "check",
              "fiber_manual_record",
              "crop_square",
              "remove",
            ].map(icon => (
              <button disabled key={icon}>
                <Icon>{icon}</Icon>
              </button>
            ))}
          </div>
        ) : null}
        <button
          disabled={!signaturePolicy.enabled}
          onClick={() => onOpenSignatureDialog("draw")}
          title={
            signaturePolicy.enabled
              ? t("Aggiungi firma")
              : signaturePolicy.reason
          }
        >
          {t("Aggiungi firma")}
          <Icon>add</Icon>
        </button>
        <button
          disabled={!signaturePolicy.enabled}
          onClick={() => onOpenSignatureDialog("image")}
          title={
            signaturePolicy.enabled
              ? t("Aggiungi iniziali")
              : signaturePolicy.reason
          }
        >
          {t("Aggiungi iniziali")}
          <Icon>add</Icon>
        </button>
        <div className="sign-saved-list">
          <strong>{t("Firme salvate")}</strong>
          <SavedSignatureList
            onDeleteSavedSignature={onDeleteSavedSignature}
            onListSavedSignatures={onListSavedSignatures}
            onUseSavedSignature={onUseSavedSignature}
          />
        </div>
      </section>
      {showUnimplementedTools ? (
        <>
          <p className="sign-note">
            {t(
              "Dopo la firma, puoi creare una copia certificata di sola lettura."
            )}
          </p>
          <button className="certified-copy-button" disabled>
            {t("Salva una copia certificata")}
          </button>
        </>
      ) : null}
    </aside>
  );
}
