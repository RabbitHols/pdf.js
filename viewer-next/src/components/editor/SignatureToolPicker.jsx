import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import { SavedSignatureList } from "./SavedSignatureList.jsx";

export function SignatureToolPicker({
  onDeleteSavedSignature,
  onListSavedSignatures,
  onOpenSignatureDialog,
  onUseSavedSignature,
}) {
  const { t } = useTranslation();

  return (
    <div
      className="signature-tool-picker"
      role="group"
      aria-label={t("Signature options")}
    >
      <SavedSignatureList
        onDeleteSavedSignature={onDeleteSavedSignature}
        onListSavedSignatures={onListSavedSignatures}
        onUseSavedSignature={onUseSavedSignature}
      />
      <div className="signature-tool-picker-actions">
        <button
          aria-label={t("Draw signature")}
          onClick={() => onOpenSignatureDialog("draw")}
          title={t("Draw signature")}
          type="button"
        >
          <Icon>signature</Icon>
          <span>{t("Draw signature")}</span>
        </button>
        <button
          aria-label={t("Upload signature image")}
          onClick={() => onOpenSignatureDialog("image")}
          title={t("Upload signature image")}
          type="button"
        >
          <Icon>add_photo_alternate</Icon>
          <span>{t("Upload signature image")}</span>
        </button>
      </div>
    </div>
  );
}
