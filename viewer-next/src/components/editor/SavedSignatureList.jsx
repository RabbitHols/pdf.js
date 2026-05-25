import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

export function SavedSignatureList({
  onDeleteSavedSignature,
  onListSavedSignatures,
  onUseSavedSignature,
}) {
  const { t } = useTranslation();
  const [savedSignatures, setSavedSignatures] = useState([]);

  const refreshSavedSignatures = useCallback(async () => {
    const signatures = await onListSavedSignatures?.();
    setSavedSignatures(Array.isArray(signatures) ? signatures : []);
  }, [onListSavedSignatures]);

  useEffect(() => {
    refreshSavedSignatures();
    window.addEventListener(
      "viewer-next-saved-signatures-changed",
      refreshSavedSignatures
    );
    return () => {
      window.removeEventListener(
        "viewer-next-saved-signatures-changed",
        refreshSavedSignatures
      );
    };
  }, [refreshSavedSignatures]);

  async function deleteSavedSignature(uuid) {
    await onDeleteSavedSignature?.(uuid);
    refreshSavedSignatures();
  }

  return (
    <div className="viewer-next-saved-signatures">
      {savedSignatures.length ? (
        savedSignatures.map(signature => (
          <div className="saved-signature-row" key={signature.uuid}>
            <button
              aria-label={t("Use saved signature")}
              className="saved-signature-button"
              onClick={() => onUseSavedSignature?.(signature.uuid)}
              title={signature.description || t("Use saved signature")}
              type="button"
            >
              <svg
                aria-hidden="true"
                preserveAspectRatio="xMidYMid meet"
                viewBox={signature.viewBox}
              >
                <path
                  className={signature.areContours ? "contours" : ""}
                  d={signature.path}
                />
              </svg>
              <span>{signature.description || t("Signature")}</span>
            </button>
            <button
              aria-label={t("Delete saved signature")}
              className="saved-signature-delete"
              onClick={() => deleteSavedSignature(signature.uuid)}
              title={t("Delete saved signature")}
              type="button"
            >
              <Icon>delete</Icon>
            </button>
          </div>
        ))
      ) : (
        <p>{t("No saved signatures")}</p>
      )}
    </div>
  );
}
