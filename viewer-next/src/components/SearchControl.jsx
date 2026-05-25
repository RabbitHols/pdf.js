import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/index.js";
import { Icon } from "./Icon.jsx";

function formatMatchStatus(findState, t) {
  const current = findState?.matchesCount?.current ?? 0;
  const total = findState?.matchesCount?.total ?? 0;
  if (findState?.state === "pending") {
    return t("Cercando");
  }
  if (findState?.state === "not-found") {
    return "0/0";
  }
  if (total > 0) {
    return `${current || 1}/${total}`;
  }
  return "0/0";
}

export function SearchControl({ disabled, findState, onSearch }) {
  const { t } = useTranslation();
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [entireWord, setEntireWord] = useState(false);
  const [highlightAll, setHighlightAll] = useState(true);
  const [queryIsRegex, setQueryIsRegex] = useState(false);
  const [query, setQuery] = useState("");
  const lastSyncedFindQueryRef = useRef("");
  const trimmedQuery = query.trim();
  const findQuery = findState?.rawQuery || "";
  const total = findState?.matchesCount?.total ?? 0;
  const canNavigate = !disabled && trimmedQuery.length > 0 && total > 0;

  useEffect(() => {
    if (findQuery && findQuery !== lastSyncedFindQueryRef.current) {
      lastSyncedFindQueryRef.current = findQuery;
      setQuery(findQuery);
    }
  }, [findQuery]);

  useEffect(() => {
    if (disabled) {
      return undefined;
    }
    if (trimmedQuery === findQuery) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      onSearch(trimmedQuery, {
        caseSensitive,
        entireWord,
        highlightAll,
        queryIsRegex,
      });
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [
    caseSensitive,
    disabled,
    entireWord,
    findQuery,
    highlightAll,
    onSearch,
    queryIsRegex,
    trimmedQuery,
  ]);

  function runSearch(options = {}) {
    if (disabled) {
      return;
    }
    onSearch(trimmedQuery, {
      caseSensitive,
      entireWord,
      highlightAll,
      queryIsRegex,
      ...options,
    });
  }

  return (
    <div className="search-control" data-find-state={findState?.state || "idle"}>
      <div className="search-options" aria-label={t("Opzioni ricerca")}>
        <button
          aria-label={t("Maiuscole/minuscole")}
          aria-pressed={caseSensitive}
          className={caseSensitive ? "active" : ""}
          disabled={disabled}
          onClick={() => {
            setCaseSensitive(current => !current);
            if (trimmedQuery) {
              runSearch({ caseSensitive: !caseSensitive });
            }
          }}
          title={t("Maiuscole/minuscole")}
          type="button"
        >
          Aa
        </button>
        <button
          aria-label={t("Parola intera")}
          aria-pressed={entireWord}
          className={entireWord ? "active" : ""}
          disabled={disabled}
          onClick={() => {
            setEntireWord(current => !current);
            if (trimmedQuery) {
              runSearch({ entireWord: !entireWord });
            }
          }}
          title={t("Parola intera")}
          type="button"
        >
          ab
        </button>
        <button
          aria-label={t("Espressione regolare")}
          aria-pressed={queryIsRegex}
          className={queryIsRegex ? "active" : ""}
          disabled={disabled}
          onClick={() => {
            setQueryIsRegex(current => !current);
            runSearch({ queryIsRegex: !queryIsRegex });
          }}
          title={t("Espressione regolare")}
          type="button"
        >
          .*
        </button>
        <button
          aria-label={t("Evidenzia tutti")}
          aria-pressed={highlightAll}
          className={highlightAll ? "active" : ""}
          disabled={disabled}
          onClick={() => {
            setHighlightAll(current => !current);
            if (trimmedQuery) {
              runSearch({ highlightAll: !highlightAll });
            }
          }}
          title={t("Evidenzia tutti")}
          type="button"
        >
          <Icon>border_color</Icon>
        </button>
      </div>
      <div className="search-entry-row">
        <Icon>search</Icon>
        <input
          aria-label={t("Cerca nel PDF")}
          disabled={disabled}
          onChange={event => setQuery(event.target.value)}
          placeholder={queryIsRegex ? t("Regex") : t("Cerca")}
          type="search"
          value={query}
        />
      </div>
      <div className="search-input-row">
        <span className="search-count" aria-live="polite">
          {formatMatchStatus(findState, t)}
        </span>
        <button
          aria-label={t("Risultato precedente")}
          disabled={!canNavigate}
          onClick={() => runSearch({ type: "again", findPrevious: true })}
          title={t("Risultato precedente")}
          type="button"
        >
          <Icon>keyboard_arrow_up</Icon>
        </button>
        <button
          aria-label={t("Risultato successivo")}
          disabled={!canNavigate}
          onClick={() => runSearch({ type: "again", findPrevious: false })}
          title={t("Risultato successivo")}
          type="button"
        >
          <Icon>keyboard_arrow_down</Icon>
        </button>
      </div>
    </div>
  );
}
