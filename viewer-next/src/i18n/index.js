import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { en } from "./locales/en.js";
import { de } from "./locales/de.js";
import { es } from "./locales/es.js";
import { fr } from "./locales/fr.js";
import { it } from "./locales/it.js";

export const localeStorageKey = "rewirepdf.viewerNext.locale";

export const supportedLocales = [
  { code: "en", label: "English" },
  { code: "it", label: "Italiano" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

const dictionaries = { de, en, es, fr, it };
const fallbackLocale = "en";
const I18nContext = createContext(null);
const supportedLocaleCodes = new Set(supportedLocales.map(locale => locale.code));

function normalizeLocale(locale) {
  const language = locale?.toLowerCase().split("-")[0];
  return supportedLocaleCodes.has(language) ? language : fallbackLocale;
}

function getBrowserLocale() {
  const browserLocales = navigator.languages?.length
    ? navigator.languages
    : [navigator.language || ""];
  for (const browserLocale of browserLocales) {
    const normalized = normalizeLocale(browserLocale);
    if (normalized !== fallbackLocale || browserLocale.toLowerCase().startsWith("en")) {
      return normalized;
    }
  }
  return fallbackLocale;
}

function getInitialLocale() {
  const storedLocale = localStorage.getItem(localeStorageKey);
  if (storedLocale) {
    return normalizeLocale(storedLocale);
  }
  return getBrowserLocale();
}

function interpolate(message, values) {
  if (!values) {
    return message;
  }
  return message.replaceAll(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    String(values[key] ?? "")
  );
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocale);

  const setLocale = nextLocale => {
    const normalized = normalizeLocale(nextLocale);
    localStorage.setItem(localeStorageKey, normalized);
    setLocaleState(normalized);
  };

  const resetLocale = () => {
    localStorage.removeItem(localeStorageKey);
    setLocaleState(getBrowserLocale());
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => {
    const t = (key, values) => {
      const message =
        dictionaries[locale]?.[key] ??
        (locale === fallbackLocale
          ? dictionaries[fallbackLocale]?.[key] ?? key
          : key);
      return interpolate(message, values);
    };
    return { locale, resetLocale, setLocale, t };
  }, [locale]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useTranslation() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return value;
}
