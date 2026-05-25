import { Icon } from "../Icon.jsx";
import { ColorPickerButton } from "../editor/ColorPickerButton.jsx";
import { useTranslation } from "../../i18n/index.js";

const drawStrokeColors = [
  ["#1f2937", "Charcoal"],
  ["#b91c1c", "Red"],
  ["#1d4ed8", "Blue"],
  ["#15803d", "Green"],
];

const drawFillColors = [
  ["#fef3c7", "Amber"],
  ["#fee2e2", "Light red"],
  ["#dbeafe", "Light blue"],
  ["#dcfce7", "Light green"],
];

const fillCapableTools = new Set([
  "rectangle",
  "circle",
  "callout",
  "polygon",
  "cloud",
]);

function getSelectedDrawToolId(viewerState) {
  const interactionState = viewerState?.viewerInteractionState || {};
  const details =
    interactionState.selectedEditorDetails ||
    interactionState.contextTarget?.editorDetails ||
    [];
  const drawDetail = details.find(
    detail =>
      detail?.drawTool ||
      detail?.editorType === "ink" ||
      detail?.editorType === "shape" ||
      detail?.historyType === "shape"
  );
  return drawDetail?.drawTool || null;
}

export function isDrawTargetSelected(viewerState) {
  return Boolean(getSelectedDrawToolId(viewerState));
}

export function DrawFormattingPanel({
  drawStyle,
  onDrawStyleChange,
  viewerState,
}) {
  const { t } = useTranslation();
  const selectedDrawToolId = getSelectedDrawToolId(viewerState);
  const showFillControls = fillCapableTools.has(selectedDrawToolId);
  const style = {
    color: drawStyle?.color ?? "#1f2937",
    fillColor: drawStyle?.fillColor || "",
    strokeWidth: Number(drawStyle?.strokeWidth || 2),
  };
  const isCustomStrokeColorSelected =
    Boolean(style.color) &&
    !drawStrokeColors.some(([color]) => color === style.color);
  const isCustomFillColorSelected =
    Boolean(style.fillColor) &&
    !drawFillColors.some(([color]) => color === style.fillColor);

  function updateDrawStyle(nextStyle) {
    onDrawStyleChange?.({
      ...style,
      ...nextStyle,
    });
  }

  return (
    <section className="text-format-panel draw-format-panel">
      <p>{t("Draw style")}</p>
      <div className="draw-format-section">
        <span>{t("Outline color")}</span>
        <div className="draw-color-swatches">
          <button
            aria-label={t("No outline")}
            aria-pressed={!style.color}
            className={!style.color ? "selected no-fill-swatch" : "no-fill-swatch"}
            onClick={() => updateDrawStyle({ color: "" })}
            title={t("No outline")}
            type="button"
          >
            <Icon>format_color_reset</Icon>
          </button>
          {drawStrokeColors.map(([color, label]) => (
            <button
              aria-label={t(label)}
              aria-pressed={style.color === color}
              className={style.color === color ? "selected" : ""}
              key={color}
              onClick={() => updateDrawStyle({ color })}
              title={t(label)}
              type="button"
            >
              <span style={{ backgroundColor: color }}></span>
            </button>
          ))}
          <ColorPickerButton
            color={style.color || "#1f2937"}
            label={t("Custom outline color")}
            onChange={color => updateDrawStyle({ color })}
            selected={isCustomStrokeColorSelected}
          />
        </div>
      </div>
      {showFillControls ? (
        <div className="draw-format-section">
          <span>{t("Fill color")}</span>
          <div className="draw-color-swatches">
            <button
              aria-label={t("No fill")}
              aria-pressed={!style.fillColor}
              className={
                !style.fillColor ? "selected no-fill-swatch" : "no-fill-swatch"
              }
              onClick={() => updateDrawStyle({ fillColor: "" })}
              title={t("No fill")}
              type="button"
            >
              <Icon>format_color_reset</Icon>
            </button>
            {drawFillColors.map(([color, label]) => (
              <button
                aria-label={t(label)}
                aria-pressed={style.fillColor === color}
                className={style.fillColor === color ? "selected" : ""}
                key={color}
                onClick={() => updateDrawStyle({ fillColor: color })}
                title={t(label)}
                type="button"
              >
                <span style={{ backgroundColor: color }}></span>
              </button>
            ))}
            <ColorPickerButton
              color={style.fillColor || "#fef3c7"}
              label={t("Custom fill color")}
              onChange={color => updateDrawStyle({ fillColor: color })}
              selected={isCustomFillColorSelected}
            />
          </div>
        </div>
      ) : null}
      <label className="draw-format-width">
        <span>{t("Outline width")}</span>
        <input
          aria-label={t("Outline width")}
          max="12"
          min="1"
          onChange={event =>
            updateDrawStyle({ strokeWidth: Number(event.target.value) })
          }
          step="1"
          type="range"
          value={style.strokeWidth}
        />
        <output>{style.strokeWidth}px</output>
      </label>
    </section>
  );
}
