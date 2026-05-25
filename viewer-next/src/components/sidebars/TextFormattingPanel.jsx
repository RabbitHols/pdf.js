import { useEffect, useState } from "react";
import {
  freeTextCharSpacings,
  freeTextCustomFonts,
  freeTextFontSizes,
  freeTextHorizontalScales,
  freeTextIndents,
  freeTextLineSpacings,
} from "../../app/toolData.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

export function TextFormattingPanel({
  onTextStyleChange,
  textStyle,
  viewerState,
}) {
  const { t } = useTranslation();
  const [fontSizeDraft, setFontSizeDraft] = useState(String(textStyle.fontSize));
  const [isFontSizeMenuOpen, setIsFontSizeMenuOpen] = useState(false);
  const internalFonts = viewerState?.freeTextFonts?.internal || [];
  const customFontValues = new Set(freeTextCustomFonts.map(([value]) => value));
  const internalFontValues = new Set(internalFonts.map(font => font.value));
  const selectedFontIsKnown =
    customFontValues.has(textStyle.fontFamily) ||
    internalFontValues.has(textStyle.fontFamily);

  function updateStyle(name, value) {
    onTextStyleChange(name, value);
  }

  useEffect(() => {
    setFontSizeDraft(String(textStyle.fontSize));
  }, [textStyle.fontSize]);

  function updateFontSize(value) {
    setFontSizeDraft(value);
    const fontSize = Number(value);
    if (Number.isFinite(fontSize) && fontSize >= 5 && fontSize <= 100) {
      updateStyle("fontSize", fontSize);
    }
  }

  function commitFontSize(value) {
    const fontSize = Number(value);
    if (Number.isFinite(fontSize)) {
      const clamped = Math.min(100, Math.max(5, Math.round(fontSize)));
      setFontSizeDraft(String(clamped));
      updateStyle("fontSize", clamped);
      setIsFontSizeMenuOpen(false);
      return;
    }
    setFontSizeDraft(String(textStyle.fontSize));
    setIsFontSizeMenuOpen(false);
  }

  function selectFontSize(size) {
    setFontSizeDraft(String(size));
    updateStyle("fontSize", size);
    setIsFontSizeMenuOpen(false);
  }

  function toggleStyle(name, activeValue, inactiveValue = false) {
    updateStyle(
      name,
      textStyle[name] === activeValue ? inactiveValue : activeValue
    );
  }

  function cycleTextAlign() {
    const alignments = ["left", "center", "right"];
    const currentIndex = alignments.indexOf(textStyle.textAlign);
    updateStyle("textAlign", alignments[(currentIndex + 1) % alignments.length]);
  }

  const alignIcon =
    textStyle.textAlign === "center"
      ? "format_align_center"
      : textStyle.textAlign === "right"
        ? "format_align_right"
        : "format_align_left";

  return (
    <section className="text-format-panel">
      <p>{t("Formatta il testo")}</p>
      <select
        aria-label="Font"
        onChange={event => updateStyle("fontFamily", event.target.value)}
        value={textStyle.fontFamily}
      >
        {internalFonts.length > 0 ? (
          <optgroup label="Internal">
            {internalFonts.map(font => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label="Custom">
          {freeTextCustomFonts.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {!selectedFontIsKnown ? (
            <option value={textStyle.fontFamily}>{textStyle.fontFamily}</option>
          ) : null}
        </optgroup>
      </select>
      <div className="text-format-row">
        <div className="text-size-combobox">
          <input
            aria-label={t("Dimensione testo")}
            className="text-size-input"
            inputMode="numeric"
            onBlur={event => commitFontSize(event.target.value)}
            onChange={event => updateFontSize(event.target.value)}
            onFocus={event => event.target.select()}
            pattern="[0-9]*"
            type="text"
            value={fontSizeDraft}
          />
          <button
            aria-expanded={isFontSizeMenuOpen}
            aria-label={t("Mostra dimensioni testo")}
            className="text-size-menu-button"
            onMouseDown={event => event.preventDefault()}
            onClick={() => setIsFontSizeMenuOpen(open => !open)}
            type="button"
          >
            <Icon>keyboard_arrow_down</Icon>
          </button>
          {isFontSizeMenuOpen ? (
            <div className="text-size-menu" role="listbox">
              {freeTextFontSizes.map(size => (
                <button
                  aria-selected={Number(textStyle.fontSize) === size}
                  key={size}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectFontSize(size)}
                  role="option"
                  type="button"
                >
                  {size}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label className="text-color-control" title={t("Colore testo")}>
          <span style={{ backgroundColor: textStyle.color }}></span>
          <input
            aria-label={t("Colore testo")}
            onChange={event => updateStyle("color", event.target.value)}
            type="color"
            value={textStyle.color}
          />
        </label>
        <button
          aria-pressed={textStyle.listStyle === "bullet"}
          className={textStyle.listStyle === "bullet" ? "active" : ""}
          onClick={() => toggleStyle("listStyle", "bullet", "none")}
          title={t("Elenco puntato")}
        >
          <Icon>format_list_bulleted</Icon>
        </button>
        <button
          aria-pressed={textStyle.listStyle === "number"}
          className={textStyle.listStyle === "number" ? "active" : ""}
          onClick={() => toggleStyle("listStyle", "number", "none")}
          title={t("Elenco numerato")}
        >
          <Icon>format_list_numbered</Icon>
        </button>
        <button
          aria-pressed={textStyle.textAlign !== "left"}
          className={textStyle.textAlign !== "left" ? "active" : ""}
          onClick={cycleTextAlign}
          title={t("Allineamento")}
        >
          <Icon>{alignIcon}</Icon>
        </button>
      </div>
      <div className="text-format-buttons">
        <button
          aria-pressed={textStyle.bold}
          className={textStyle.bold ? "active" : ""}
          onClick={() => updateStyle("bold", !textStyle.bold)}
          title={t("Grassetto")}
        >
          <Icon>format_bold</Icon>
        </button>
        <button
          aria-pressed={textStyle.italic}
          className={textStyle.italic ? "active" : ""}
          onClick={() => updateStyle("italic", !textStyle.italic)}
          title={t("Corsivo")}
        >
          <Icon>format_italic</Icon>
        </button>
        <button
          aria-pressed={textStyle.underline}
          className={textStyle.underline ? "active" : ""}
          onClick={() => updateStyle("underline", !textStyle.underline)}
          title={t("Sottolineato")}
        >
          <Icon>format_underlined</Icon>
        </button>
        <button
          aria-pressed={textStyle.script === "super"}
          className={textStyle.script === "super" ? "active" : ""}
          onClick={() => toggleStyle("script", "super", "normal")}
          title={t("Apice")}
        >
          <Icon>superscript</Icon>
        </button>
        <button
          aria-pressed={textStyle.script === "sub"}
          className={textStyle.script === "sub" ? "active" : ""}
          onClick={() => toggleStyle("script", "sub", "normal")}
          title={t("Pedice")}
        >
          <Icon>subscript</Icon>
        </button>
      </div>
      <div className="text-format-metrics">
        <label>
          <Icon>format_line_spacing</Icon>
          <select
            aria-label={t("Interlinea")}
            onChange={event => updateStyle("lineSpacing", Number(event.target.value))}
            value={textStyle.lineSpacing}
          >
            {freeTextLineSpacings.map(value => (
              <option key={value} value={value}>
                {String(value).replace(".", ",")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Icon>format_indent_increase</Icon>
          <select
            aria-label={t("Rientro")}
            onChange={event => updateStyle("indent", Number(event.target.value))}
            value={textStyle.indent}
          >
            {freeTextIndents.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Icon>text_fields</Icon>
          <select
            aria-label={t("Scala orizzontale")}
            onChange={event =>
              updateStyle("horizontalScale", Number(event.target.value))
            }
            value={textStyle.horizontalScale}
          >
            {freeTextHorizontalScales.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Icon>swap_horiz</Icon>
          <select
            aria-label={t("Spaziatura caratteri")}
            onChange={event =>
              updateStyle("charSpacing", Number(event.target.value))
            }
            value={textStyle.charSpacing}
          >
            {freeTextCharSpacings.map(value => (
              <option key={value} value={value}>
                {String(value).replace(".", ",")}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
