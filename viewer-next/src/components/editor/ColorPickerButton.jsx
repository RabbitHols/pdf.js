import { Icon } from "../Icon.jsx";

export function ColorPickerButton({
  className = "",
  color,
  label,
  onChange,
  selected = false,
}) {
  return (
    <label
      className={`editor-color-picker-button${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
      title={label}
    >
      <Icon>palette</Icon>
      <span
        className="editor-color-picker-preview"
        style={{ backgroundColor: color }}
      ></span>
      <input
        aria-label={label}
        onChange={event => onChange(event.target.value)}
        title={label}
        type="color"
        value={color}
      />
    </label>
  );
}
