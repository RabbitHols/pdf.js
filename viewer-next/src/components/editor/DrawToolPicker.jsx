import { drawMenuToolOptions } from "../../app/toolData.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import { ColorPickerButton } from "./ColorPickerButton.jsx";

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

const maxDrawColorSwatches = 6;

export function DrawToolPicker({
  drawStyle,
  onDrawStyleChange,
  onSelectDrawTool,
  selectedDrawTool,
}) {
  const { t } = useTranslation();
  const selectedToolId = selectedDrawTool[0];
  const showDrawStyleControls = selectedToolId !== "stamp-palette";
  const showFillControls = fillCapableTools.has(selectedToolId);
  const strokeWidth = Number(drawStyle?.strokeWidth || 2);
  const strokeColor = drawStyle?.color ?? "#1f2937";
  const fillColor = drawStyle?.fillColor || "";
  const isCustomStrokeColorSelected =
    Boolean(strokeColor) &&
    !drawStrokeColors.some(([color]) => color === strokeColor);
  const isCustomFillColorSelected =
    Boolean(fillColor) && !drawFillColors.some(([color]) => color === fillColor);
  const visibleStrokeColors = drawStrokeColors.slice(
    0,
    maxDrawColorSwatches - 2
  );
  const visibleFillColors = drawFillColors.slice(0, maxDrawColorSwatches - 2);

  return (
    <div className="draw-tool-picker" role="menu" aria-label={t("Draw type")}>
      {drawMenuToolOptions.map(option => {
        const [id, optionIcon, optionLabel] = option;
        const isSelected = selectedDrawTool[0] === id;
        return (
          <button
            aria-checked={isSelected}
            className={isSelected ? "selected" : ""}
            key={id}
            onClick={() => {
              onSelectDrawTool(option);
            }}
            role="menuitemradio"
            title={t(optionLabel)}
            type="button"
          >
            <Icon>{optionIcon}</Icon>
            <span>{t(optionLabel)}</span>
            {isSelected ? <Icon className="draw-check">check</Icon> : null}
          </button>
        );
      })}
      {showDrawStyleControls ? (
        <div className="draw-style-controls" role="group" aria-label={t("Draw style")}>
          <div className="draw-style-row">
            <span>{t("Outline color")}</span>
            <div className="draw-color-swatches">
              <button
                aria-label={t("No outline")}
                aria-pressed={!strokeColor}
                className={
                  !strokeColor ? "selected no-fill-swatch" : "no-fill-swatch"
                }
                onClick={() => onDrawStyleChange({ color: "" })}
                title={t("No outline")}
                type="button"
              >
                <Icon>format_color_reset</Icon>
              </button>
              {visibleStrokeColors.map(([color, label]) => (
                <button
                  aria-label={t(label)}
                  aria-pressed={strokeColor === color}
                  className={strokeColor === color ? "selected" : ""}
                  key={color}
                  onClick={() => onDrawStyleChange({ color })}
                  title={t(label)}
                  type="button"
                >
                  <span style={{ backgroundColor: color }}></span>
                </button>
              ))}
              <ColorPickerButton
                color={strokeColor || "#1f2937"}
                label={t("Custom outline color")}
                onChange={color => onDrawStyleChange({ color })}
                selected={isCustomStrokeColorSelected}
              />
            </div>
          </div>
          {showFillControls ? (
            <div className="draw-style-row">
              <span>{t("Fill color")}</span>
              <div className="draw-color-swatches">
                <button
                  aria-label={t("No fill")}
                  aria-pressed={!fillColor}
                  className={!fillColor ? "selected no-fill-swatch" : "no-fill-swatch"}
                  onClick={() => onDrawStyleChange({ fillColor: "" })}
                  title={t("No fill")}
                  type="button"
                >
                  <Icon>format_color_reset</Icon>
                </button>
                {visibleFillColors.map(([color, label]) => (
                  <button
                    aria-label={t(label)}
                    aria-pressed={fillColor === color}
                    className={fillColor === color ? "selected" : ""}
                    key={color}
                    onClick={() => onDrawStyleChange({ fillColor: color })}
                    title={t(label)}
                    type="button"
                  >
                    <span style={{ backgroundColor: color }}></span>
                  </button>
                ))}
                <ColorPickerButton
                  color={fillColor || "#fef3c7"}
                  label={t("Custom fill color")}
                  onChange={color => onDrawStyleChange({ fillColor: color })}
                  selected={isCustomFillColorSelected}
                />
              </div>
            </div>
          ) : null}
          <label className="draw-style-row draw-width-control">
            <span>{t("Outline width")}</span>
            <input
              aria-label={t("Outline width")}
              max="12"
              min="1"
              onChange={event =>
                onDrawStyleChange({ strokeWidth: Number(event.target.value) })
              }
              step="1"
              type="range"
              value={strokeWidth}
            />
            <output>{strokeWidth}px</output>
          </label>
        </div>
      ) : null}
    </div>
  );
}
