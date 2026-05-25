import { AnnotationEditorParamsType } from "@rewirepdf/pdfjs";
import { de } from "../i18n/locales/de.js";
import { en } from "../i18n/locales/en.js";
import { es } from "../i18n/locales/es.js";
import { fr } from "../i18n/locales/fr.js";
import { it } from "../i18n/locales/it.js";
import { GenericL10n } from "./nullL10n.js";
import { OverlayManager } from "./nativeOverlayManager.js";
import { SignatureManager } from "./nativeSignatureManager.js";
import { ViewerNextSignatureStorage } from "./savedSignatureStorage.js";

const localeStorageKey = "rewirepdf.viewerNext.locale";
const signatureDictionaries = { de, en, es, fr, it };

function getSignatureLocale() {
  const locale =
    localStorage.getItem(localeStorageKey) ||
    document.documentElement.lang ||
    navigator.language ||
    "en";
  const language = locale.toLowerCase().split("-")[0];
  return signatureDictionaries[language] ? language : "en";
}

function createSignatureTranslator() {
  const dictionary = signatureDictionaries[getSignatureLocale()] || en;
  return key => dictionary[key] ?? en[key] ?? key;
}

export function createSignatureDialogElements(eventBus) {
  const t = createSignatureTranslator();
  const root = document.createElement("div");
  root.className = "viewer-next-signature-root";
  const fileInputId = `viewer-next-signature-file-${crypto.randomUUID()}`;
  root.innerHTML = `
    <dialog class="dialog signatureDialog viewer-next-signature-dialog" aria-label="${t("Add signature")}">
      <div class="mainContainer">
        <header class="viewer-next-signature-header">
          <div>
            <span>${t("Fill and sign")}</span>
            <h2>${t("Add signature")}</h2>
          </div>
          <button type="button" class="viewer-next-signature-close" aria-label="${t("Close")}">
            <span class="symbol">close</span>
          </button>
        </header>
        <div class="viewer-next-signature-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="true">${t("Type")}</button>
          <button type="button" role="tab" aria-selected="false">${t("Draw")}</button>
          <button type="button" role="tab" aria-selected="false">${t("Image")}</button>
        </div>
        <div class="viewer-next-signature-panels" data-selected="type">
          <div role="tabpanel" class="signature-type-panel">
            <label>
              <span>${t("Signature")}</span>
              <input type="text" placeholder="${t("Type your signature")}" tabindex="0" />
            </label>
          </div>
          <div role="tabpanel" class="signature-draw-panel" tabindex="-1">
            <svg xmlns="http://www.w3.org/2000/svg"></svg>
            <span>${t("Draw your signature")}</span>
            <div class="signature-thickness">
              <label>${t("Thickness")}</label>
              <input type="range" min="1" max="5" step="1" value="1" tabindex="0" />
            </div>
          </div>
          <div role="tabpanel" class="signature-image-panel" tabindex="-1">
            <svg xmlns="http://www.w3.org/2000/svg"></svg>
            <div class="signature-image-placeholder">
              <span>${t("Drop an image here or")}</span>
              <label for="${fileInputId}" tabindex="0"><a>${t("browse your computer")}</a></label>
              <input id="${fileInputId}" type="file" />
            </div>
          </div>
          <div class="signature-controls">
            <label class="signature-description">
              <span>${t("Description")}</span>
              <span class="inputWithClearButton">
                <input type="text" placeholder="${t("Signature description")}" tabindex="0" />
                <button class="clearInputButton" type="button" tabindex="0" aria-hidden="true"></button>
              </span>
            </label>
            <button type="button" class="signature-clear">${t("Clear")}</button>
          </div>
          <label class="signature-save">
            <input type="checkbox" checked />
            <span>${t("Saved for reuse")}</span>
            <span></span>
            <span class="signature-save-warning"></span>
          </label>
          <div hidden class="messageBar signature-error">
            <div>
              <div>
                <span class="title">${t("Unable to use this image")}</span>
                <span class="description">${t("Choose another image with a visible signature.")}</span>
              </div>
              <button class="closeButton" type="button" tabindex="0"><span>${t("Close")}</span></button>
            </div>
          </div>
          <div class="dialogButtonsGroup">
            <button type="button" class="secondaryButton" tabindex="0"><span>${t("Cancel")}</span></button>
            <button type="button" class="primaryButton" disabled tabindex="0"><span>${t("Add")}</span></button>
          </div>
        </div>
      </div>
    </dialog>
    <dialog class="dialog signatureDialog viewer-next-signature-dialog" aria-label="${t("Edit signature description")}">
      <div class="mainContainer">
        <header class="viewer-next-signature-header">
          <div>
            <span>${t("Fill and sign")}</span>
            <h2>${t("Edit signature description")}</h2>
          </div>
          <button type="button" class="viewer-next-signature-close" aria-label="${t("Close")}">
            <span class="symbol">close</span>
          </button>
        </header>
        <div class="signature-edit-description">
          <label class="signature-description">
            <span>${t("Description")}</span>
            <span class="inputWithClearButton">
              <input type="text" placeholder="${t("Signature description")}" tabindex="0" />
              <button class="clearInputButton" type="button" tabindex="0" aria-hidden="true"></button>
            </span>
          </label>
          <svg xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
        <div class="dialogButtonsGroup">
          <button type="button" class="secondaryButton" tabindex="0"><span>${t("Cancel")}</span></button>
          <button type="button" class="primaryButton" disabled tabindex="0"><span>${t("Update")}</span></button>
        </div>
      </div>
    </dialog>
    <div class="viewer-next-signature-storage" hidden>
      <button type="button" class="viewer-next-signature-add-new">
        <span class="symbol">add</span>
        <span>${t("Add new signature")}</span>
      </button>
    </div>
  `;

  document.body.append(root);

  const [dialog, editDialog] = root.querySelectorAll("dialog");
  const [closeButton, editCloseButton] = root.querySelectorAll(
    ".viewer-next-signature-close"
  );
  const [typeButton, drawButton, imageButton] = root.querySelectorAll(
    ".viewer-next-signature-tabs button"
  );
  const panels = root.querySelector(".viewer-next-signature-panels");
  const typeInput = root.querySelector(".signature-type-panel input");
  const drawSVG = root.querySelector(".signature-draw-panel svg");
  const drawPlaceholder = root.querySelector(".signature-draw-panel span");
  const drawThickness = root.querySelector(".signature-thickness input");
  const imageSVG = root.querySelector(".signature-image-panel svg");
  const imagePlaceholder = root.querySelector(".signature-image-placeholder");
  const imagePicker = root.querySelector(`#${fileInputId}`);
  const imagePickerLink = root.querySelector(
    ".signature-image-placeholder label"
  );
  const description = root.querySelector(
    ".signature-controls .inputWithClearButton"
  );
  const clearButton = root.querySelector(".signature-clear");
  const saveContainer = root.querySelector(".signature-save");
  const saveCheckbox = root.querySelector(".signature-save input");
  const errorBar = root.querySelector(".signature-error");
  const errorTitle = root.querySelector(".signature-error .title");
  const errorDescription = root.querySelector(".signature-error .description");
  const errorCloseButton = root.querySelector(".signature-error .closeButton");
  const [cancelButton, addButton] = root.querySelectorAll(
    ".viewer-next-signature-panels .dialogButtonsGroup button"
  );
  const editDescription = root.querySelector(
    ".signature-edit-description .inputWithClearButton"
  );
  const editSignatureView = root.querySelector(
    ".signature-edit-description svg"
  );
  const [editCancelButton, editUpdateButton] = editDialog.querySelectorAll(
    ".dialogButtonsGroup button"
  );
  const addSignatureToolbarButton = root.querySelector(
    ".viewer-next-signature-storage button"
  );
  const storage = root.querySelector(".viewer-next-signature-storage");
  const overlayManager = new OverlayManager();
  const abortController = new AbortController();
  const signatureStorage = new ViewerNextSignatureStorage(
    eventBus,
    abortController.signal
  );

  const manager = new SignatureManager(
    {
      dialog,
      panels,
      typeButton,
      typeInput,
      drawButton,
      drawPlaceholder,
      drawSVG,
      drawThickness,
      imageButton,
      imageSVG,
      imagePlaceholder,
      imagePicker,
      imagePickerLink,
      description,
      clearButton,
      cancelButton,
      addButton,
      errorCloseButton,
      errorBar,
      errorTitle,
      errorDescription,
      saveCheckbox,
      saveContainer,
    },
    {
      dialog: editDialog,
      description: editDescription,
      editSignatureView,
      cancelButton: editCancelButton,
      updateButton: editUpdateButton,
    },
    addSignatureToolbarButton,
    overlayManager,
    new GenericL10n(),
    signatureStorage,
    eventBus
  );
  closeButton.addEventListener("click", () => cancelButton.click());
  editCloseButton.addEventListener("click", () => editCancelButton.click());
  addSignatureToolbarButton.addEventListener("click", () => {
    eventBus.dispatch("switchannotationeditorparams", {
      source: window,
      type: AnnotationEditorParamsType.CREATE,
      value: { historyType: "signature" },
    });
  });

  return {
    buttons: { drawButton, imageButton },
    dialog,
    destroy() {
      abortController.abort();
      manager.destroy();
      storage.remove();
      root.remove();
    },
    manager,
    root,
    storage,
    signatureStorage,
  };
}
