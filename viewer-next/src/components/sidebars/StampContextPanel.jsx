import { useEffect, useMemo, useState } from "react";
import {
  defaultStampIdentity,
  stampIdentityStorageKey,
  stampPresets,
} from "../../app/stampData.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

function readStoredIdentity() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(stampIdentityStorageKey) || "null"
    );
    return {
      ...defaultStampIdentity,
      ...(stored || {}),
    };
  } catch {
    return defaultStampIdentity;
  }
}

function persistIdentity(identity) {
  try {
    localStorage.setItem(stampIdentityStorageKey, JSON.stringify(identity));
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

function buildIdentityLines(identity, enabled) {
  if (!enabled) {
    return [];
  }
  return [
    identity.name,
    identity.title,
    identity.includeDate === false ? "" : identity.date,
  ].filter(Boolean);
}

export function StampContextPanel({ onSetStampSelection }) {
  const { t } = useTranslation();
  const [customStamp, setCustomStamp] = useState(null);
  const [identity, setIdentity] = useState(readStoredIdentity);
  const [selectedStampId, setSelectedStampId] = useState(stampPresets[0].id);
  const selectedStamp = useMemo(
    () =>
      selectedStampId === "custom"
        ? customStamp
        : stampPresets.find(stamp => stamp.id === selectedStampId) ||
          stampPresets[0],
    [customStamp, selectedStampId]
  );
  const identityLines = buildIdentityLines(
    identity,
    selectedStamp?.requiresIdentity
  );

  useEffect(() => {
    persistIdentity(identity);
  }, [identity]);

  useEffect(() => {
    if (!selectedStamp) {
      return undefined;
    }
    const stampSelection = {
      asset: selectedStamp.asset,
      id: selectedStamp.id,
      identity: selectedStamp.requiresIdentity ? identity : null,
      label: selectedStamp.label,
      requiresIdentity: selectedStamp.requiresIdentity,
      type: selectedStamp.type,
    };
    onSetStampSelection?.(stampSelection);
    const retryIds = [120, 420, 900].map(delay =>
      window.setTimeout(() => onSetStampSelection?.(stampSelection), delay)
    );
    return () => {
      retryIds.forEach(id => window.clearTimeout(id));
    };
  }, [identity, onSetStampSelection, selectedStamp]);

  function updateIdentity(name, value) {
    setIdentity(current => ({
      ...current,
      [name]: value,
    }));
  }

  function onUploadCustomStamp(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const stamp = {
        asset: String(reader.result || ""),
        id: "custom",
        label: file.name.replace(/\.[^.]+$/, "") || t("Custom stamp"),
        requiresIdentity: true,
        type: "custom",
      };
      setCustomStamp(stamp);
      setSelectedStampId("custom");
    });
    reader.readAsDataURL(file);
  }

  return (
    <div className="editor-context-content stamp-context-panel">
      <section className="stamp-panel-section">
        <p>{t("Preset stamps")}</p>
        <div className="stamp-preset-grid">
          {stampPresets.map(stamp => {
            const isSelected = selectedStamp?.id === stamp.id;
            return (
              <button
                aria-pressed={isSelected}
                className={isSelected ? "selected" : ""}
                key={stamp.id}
                onClick={() => setSelectedStampId(stamp.id)}
                type="button"
              >
                <img alt="" src={stamp.asset} />
                <span>{stamp.label}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="stamp-panel-section">
        <p>{t("Custom stamp")}</p>
        <label className="stamp-upload-control">
          <Icon>upload</Icon>
          <span>{customStamp ? customStamp.label : t("Upload stamp image")}</span>
          <input
            accept="image/svg+xml,image/png,image/jpeg,image/webp"
            aria-label={t("Upload custom stamp")}
            onChange={onUploadCustomStamp}
            type="file"
          />
        </label>
      </section>
      <section className="stamp-panel-section stamp-identity-section">
        <p>{t("Identity")}</p>
        <label>
          <span>{t("Name")}</span>
          <input
            name="name"
            onChange={event => updateIdentity("name", event.target.value)}
            type="text"
            value={identity.name}
          />
        </label>
        <label>
          <span>{t("Title or role")}</span>
          <input
            name="title"
            onChange={event => updateIdentity("title", event.target.value)}
            type="text"
            value={identity.title}
          />
        </label>
        <label>
          <span>{t("Date")}</span>
          <input
            disabled={identity.includeDate === false}
            name="date"
            onChange={event => updateIdentity("date", event.target.value)}
            type="date"
            value={identity.date}
          />
        </label>
        <label className="stamp-date-toggle">
          <input
            checked={identity.includeDate !== false}
            name="includeDate"
            onChange={event =>
              updateIdentity("includeDate", event.target.checked)
            }
            type="checkbox"
          />
          <span>{t("Include date")}</span>
        </label>
      </section>
      <section className="stamp-panel-section">
        <p>{t("Preview")}</p>
        <div className="stamp-preview-card" data-stamp-preview={selectedStamp?.id || ""}>
          {selectedStamp ? <img alt="" src={selectedStamp.asset} /> : null}
          {identityLines.length ? (
            <div className="stamp-preview-identity">
              {identityLines.map(line => (
                <span key={line}>{line}</span>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
