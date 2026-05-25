import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";
import { StampContextPanel } from "./StampContextPanel.jsx";

export function StampSideNav({ onClose, onSetStampSelection }) {
  const { t } = useTranslation();

  return (
    <aside className="sidenav page-organizer-options stamp-options" aria-label={t("Stamp palette")}>
      <div className="page-organizer-options-header">
        <button
          aria-label={t("Torna agli strumenti modifica")}
          onClick={onClose}
          type="button"
        >
          <Icon>arrow_back</Icon>
        </button>
        <h2>{t("Stamp palette")}</h2>
      </div>
      <StampContextPanel onSetStampSelection={onSetStampSelection} />
    </aside>
  );
}
