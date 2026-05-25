import { useMemo } from "react";

export function usePdfViewerActions(pdfHandleRef) {
  return useMemo(
    () => ({
      addImage: () => pdfHandleRef.current?.addImage(),
      addBookmarkFromSelection: () =>
        pdfHandleRef.current?.addBookmarkFromSelection(),
      addCommentToSelection: () => pdfHandleRef.current?.addCommentToSelection(),
      cancelPendingComment: () => pdfHandleRef.current?.cancelPendingComment(),
      clearHistory: () => pdfHandleRef.current?.clearHistory(),
      deleteSelectedAnnotation: () =>
        pdfHandleRef.current?.deleteSelectedAnnotation(),
      deleteBookmark: bookmarkId =>
        pdfHandleRef.current?.deleteBookmark(bookmarkId),
      deleteSavedSignature: uuid =>
        pdfHandleRef.current?.deleteSavedSignature?.(uuid),
      download: () => pdfHandleRef.current?.download(),
      exportData: options => pdfHandleRef.current?.exportData(options),
      exportRedacted: () => pdfHandleRef.current?.exportRedacted(),
      find: (query, options) => pdfHandleRef.current?.find(query, options),
      fitPageWidth: () => pdfHandleRef.current?.fitPageWidth(),
      goToComment: id => pdfHandleRef.current?.goToComment(id),
      goToBookmark: bookmark => pdfHandleRef.current?.goToBookmark(bookmark),
      goToHistoryDestination: destination =>
        pdfHandleRef.current?.goToHistoryDestination(destination),
      goToPage: pageNumber => pdfHandleRef.current?.goToPage(pageNumber),
      goToSearchResult: result => pdfHandleRef.current?.goToSearchResult(result),
      listSavedSignatures: () =>
        pdfHandleRef.current?.listSavedSignatures?.() || [],
      nextPage: () => pdfHandleRef.current?.nextPage(),
      openSignatureDialog: tabName =>
        pdfHandleRef.current?.openSignatureDialog(tabName),
      organizePages: options => pdfHandleRef.current?.organizePages(options),
      print: () => pdfHandleRef.current?.print(),
      previousPage: () => pdfHandleRef.current?.previousPage(),
      redo: () => pdfHandleRef.current?.redo(),
      rotateClockwise: () => pdfHandleRef.current?.rotateClockwise(),
      refreshComments: () => pdfHandleRef.current?.refreshComments(),
      save: () => pdfHandleRef.current?.save(),
      savePendingComment: text => pdfHandleRef.current?.savePendingComment(text),
      setNativeRedactMode: enabled =>
        pdfHandleRef.current?.setNativeRedactMode(enabled),
      setNativeTextEditMode: enabled =>
        pdfHandleRef.current?.setNativeTextEditMode(enabled),
      setFreeTextStyle: (name, value) =>
        pdfHandleRef.current?.setFreeTextStyle(name, value),
      setDrawTool: toolName => pdfHandleRef.current?.setDrawTool(toolName),
      setDrawStyle: style => pdfHandleRef.current?.setDrawStyle(style),
      setHighlightColor: color => pdfHandleRef.current?.setHighlightColor(color),
      setScale: scaleValue => pdfHandleRef.current?.setScale(scaleValue),
      setStampSelection: stamp =>
        pdfHandleRef.current?.setStampSelection(stamp),
      setTool: toolName => pdfHandleRef.current?.setTool(toolName),
      undo: () => pdfHandleRef.current?.undo(),
      updateBookmarkTitle: (bookmarkId, title) =>
        pdfHandleRef.current?.updateBookmarkTitle(bookmarkId, title),
      useSavedSignature: uuid =>
        pdfHandleRef.current?.useSavedSignature?.(uuid),
      zoomIn: () => pdfHandleRef.current?.zoomIn(),
      zoomOut: () => pdfHandleRef.current?.zoomOut(),
    }),
    [pdfHandleRef]
  );
}
