import { useTranslation } from "../../i18n/index.js";

export function CapabilityPanel({ viewerInteractionState = null, viewerState }) {
  const { t } = useTranslation();
  const nativeEditing = viewerState.nativeEditing || {};
  const capabilities = viewerState.capabilities || {};
  const interactionCapabilities = viewerInteractionState?.capabilities || {};
  const nativeTextSupported =
    capabilities.nativeTextEdit?.supported !== false &&
    (viewerInteractionState?.activeTool === "native-text-edit" ||
      interactionCapabilities.canStyle);
  const nativeRedactSupported =
    capabilities.nativeRedact?.supported !== false &&
    (viewerInteractionState?.activeTool === "native-redact" ||
      interactionCapabilities.canRedact);
  const showTextEdit =
    viewerInteractionState?.activeTool === "native-text-edit" ||
    nativeEditing.textEditActive;
  const showRedact =
    viewerInteractionState?.activeTool === "native-redact" ||
    nativeEditing.redactActive;

  if (!showTextEdit && !showRedact) {
    return null;
  }

  return (
    <aside className="capability-panel" aria-label={t("Diagnostica PDF")}>
      {showTextEdit ? (
        <div>
          <strong>Native text edit</strong>
          <span>
            {nativeTextSupported
              ? t("{{editable}} editabili, {{unsupported}} unsupported", {
                  editable: nativeEditing.textEditEditableCount || 0,
                  unsupported: nativeEditing.textEditUnsupportedCount || 0,
                })
              : t("Non supportato")}
          </span>
        </div>
      ) : null}
      {showRedact ? (
        <div>
          <strong>Native redact</strong>
          <span>
            {nativeRedactSupported
              ? t("{{count}} patch export", {
                  count: nativeEditing.redactionPatches || 0,
                })
              : t("Non supportato")}
          </span>
        </div>
      ) : null}
    </aside>
  );
}
