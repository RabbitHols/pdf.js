import {
  getPdfActionPolicy,
  inferPdfActionId,
} from "../../app/pdfActionPolicy.js";
import { requiresDocumentView } from "../../app/viewRouting.js";
import { useTranslation } from "../../i18n/index.js";
import { Icon } from "../Icon.jsx";

export function ToolContextSideNav({
  title,
  actions,
  hasDocument,
  navigate,
  onClose,
  onRunEditorAction,
  viewerState,
}) {
  const { t } = useTranslation();

  return (
    <aside className="sidenav tool-context-sidenav">
      <div className="tool-context-header">
        <h2>{title}</h2>
        <button
          aria-label={t("Chiudi {{title}}", { title })}
          onClick={onClose}
          title={t("Chiudi {{title}}", { title })}
        >
          <Icon>close</Icon>
        </button>
      </div>
      <div className="tool-context-list">
        {actions.map(([icon, label, target, editAction]) => {
          const needsDocument = !hasDocument && requiresDocumentView(target);
          const actionId = inferPdfActionId(editAction);
          const policy =
            hasDocument && actionId
              ? getPdfActionPolicy(
                  actionId,
                  {
                    hasDocument,
                    loading: viewerState?.loading,
                    pdfSecurity: viewerState?.pdfSecurity,
                  },
                  t
                )
              : null;
          const isBlocked = Boolean(policy && !policy.enabled);
          return (
            <button
              disabled={!target || needsDocument || isBlocked}
              key={label}
              onClick={() => {
                if (!target || isBlocked) {
                  return;
                }
                if (target === "edit" && editAction && onRunEditorAction) {
                  onRunEditorAction(editAction);
                  return;
                }
                navigate(target);
              }}
              title={
                needsDocument
                  ? t("Apri un PDF per usare {{label}}", { label: t(label) })
                  : isBlocked
                    ? policy.reason
                    : target
                    ? t(label)
                    : `${t(label)} non ancora disponibile`
              }
            >
              <Icon>{icon}</Icon>
              {t(label)}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
