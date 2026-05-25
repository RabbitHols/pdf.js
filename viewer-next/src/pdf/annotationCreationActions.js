export function createAnnotationCreationActions({
  annotationEditorBridge,
  eventBus,
  getSignatureUi,
  pdfjsLib,
}) {
  async function waitForSignatureDialogOpen(signatureUi) {
    if (!signatureUi) {
      return;
    }
    const startedAt = performance.now();
    while (!signatureUi.dialog.open && performance.now() - startedAt < 1000) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  function dispatchCreateAnnotation(value = {}) {
    eventBus.dispatch("switchannotationeditorparams", {
      source: window,
      type: pdfjsLib.AnnotationEditorParamsType.CREATE,
      value,
    });
  }

  return {
    addImage: async () => {
      const mode = pdfjsLib.AnnotationEditorType.STAMP;
      annotationEditorBridge.setTool("image");
      await annotationEditorBridge.waitForAnnotationMode(mode);
      dispatchCreateAnnotation({ historyType: "image" });
    },
    openSignatureDialog: async tabName => {
      const signatureUi = await getSignatureUi?.();
      if (!signatureUi) {
        return;
      }
      const mode = pdfjsLib.AnnotationEditorType.SIGNATURE;
      annotationEditorBridge.setTool("signature");
      await annotationEditorBridge.waitForAnnotationMode(mode);
      dispatchCreateAnnotation({ historyType: "signature" });
      await waitForSignatureDialogOpen();
      if (tabName === "image") {
        signatureUi.buttons.imageButton.click();
      } else if (tabName === "draw") {
        signatureUi.buttons.drawButton.click();
      }
    },
  };
}
