import { highlightColors } from "../../app/toolData.js";
import { useTranslation } from "../../i18n/index.js";
import { ColorPickerButton } from "./ColorPickerButton.jsx";

const quickHighlightColors = highlightColors.filter(([color]) =>
  ["#ffea00", "#22c55e", "#38bdf8"].includes(color)
);

export function HighlightColorPicker({
  highlightColor,
  onHighlightColorChange,
  onSetTool,
}) {
  const { t } = useTranslation();
  const isCustomColorSelected = !quickHighlightColors.some(
    ([color]) => color === highlightColor
  );

  return (
    <div className="highlight-color-picker" role="group" aria-label={t("Highlight color")}>
      {quickHighlightColors.map(([color, name]) => (
        <button
          aria-label={t(name)}
          className={color === highlightColor ? "selected" : ""}
          key={color}
          onClick={() => {
            onHighlightColorChange(color);
            onSetTool("highlight");
          }}
          title={t(name)}
          type="button"
        >
          <span style={{ backgroundColor: color }}></span>
        </button>
      ))}
      <ColorPickerButton
        color={highlightColor}
        label={t("Custom highlight color")}
        onChange={color => {
          onHighlightColorChange(color);
          onSetTool("highlight");
        }}
        selected={isCustomColorSelected}
      />
    </div>
  );
}
