import { useTranslation } from "../../i18n/index.js";

export function NativeEditingStatus({ nativeEditing }) {
  const { t } = useTranslation();
  if (!nativeEditing?.textEditActive && !nativeEditing?.redactActive) {
    return null;
  }

  const label = nativeEditing.textEditActive
    ? t("Modifica testo sorgente")
    : t("Redazione nativa");
  const detail = nativeEditing.redactActive
    ? t("{{count}} selezioni pronte", {
        count: nativeEditing.redactionPatches || 0,
      })
    : nativeEditing.textEditCommitted
      ? t("Modifiche salvabili")
      : t("{{count}} blocchi modificabili", {
          count: nativeEditing.textEditEditableCount || 0,
        });

  return (
    <div className="native-editing-status" role="status">
      <strong>{label}</strong>
      <span>{nativeEditing.message || detail}</span>
    </div>
  );
}
