export function Icon({ children, className = "" }) {
  return <span className={`symbol ${className}`}>{children}</span>;
}
