import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const themeStorageKey = "rewirepdf.viewerNext.theme";

export const supportedThemes = [
  { code: "system", labelKey: "Sistema" },
  { code: "light", labelKey: "Chiaro" },
  { code: "dark", labelKey: "Scuro" },
];

const fallbackTheme = "light";
const supportedThemeCodes = new Set(supportedThemes.map(theme => theme.code));
const ThemeContext = createContext(null);

function normalizeTheme(theme) {
  return supportedThemeCodes.has(theme) ? theme : fallbackTheme;
}

function getSystemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(theme) {
  return theme === "system" ? getSystemTheme() : normalizeTheme(theme);
}

function getInitialTheme() {
  return normalizeTheme(localStorage.getItem(themeStorageKey));
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    resolveTheme(getInitialTheme())
  );

  const setTheme = nextTheme => {
    const normalized = normalizeTheme(nextTheme);
    localStorage.setItem(themeStorageKey, normalized);
    setThemeState(normalized);
  };

  const resetTheme = () => {
    localStorage.removeItem(themeStorageKey);
    setThemeState(fallbackTheme);
  };

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const updateResolvedTheme = () => {
      setResolvedTheme(resolveTheme(theme));
    };
    updateResolvedTheme();
    media?.addEventListener?.("change", updateResolvedTheme);
    return () => media?.removeEventListener?.("change", updateResolvedTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.viewerNextTheme = resolvedTheme;
    document.documentElement.dataset.viewerNextThemePreference = theme;
  }, [resolvedTheme, theme]);

  const value = useMemo(
    () => ({
      resolvedTheme,
      resetTheme,
      setTheme,
      theme,
    }),
    [resolvedTheme, theme]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
