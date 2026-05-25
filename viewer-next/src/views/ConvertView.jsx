import { PdfViewerSurface } from "../components/PdfViewerSurface.jsx";
import { useTranslation } from "../i18n/index.js";

export function ConvertView({ documentInfo, pageInfo, pdfHandleRef }) {
  const { t } = useTranslation();

  return (
    <main className="convert-shell">
      <section className="convert-preview">
        {documentInfo ? (
          <>
            <PdfViewerSurface ref={pdfHandleRef} documentInfo={documentInfo} />
            <div className="page-pill">
              {t("Page 1 of {{count}} ({{name}})", {
                count: pageInfo.pagesCount || "?",
                name: documentInfo.name,
              })}
            </div>
          </>
        ) : (
          <div className="mock-page">
            <div></div>
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
      </section>
    </main>
  );
}
