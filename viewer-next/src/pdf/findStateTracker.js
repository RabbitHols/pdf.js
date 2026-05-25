import {
  FindState,
  normalize,
} from "@rewirepdf/pdfjs/viewer-core";

const findStateLabels = new Map([
  [FindState.FOUND, "found"],
  [FindState.NOT_FOUND, "not-found"],
  [FindState.WRAPPED, "wrapped"],
  [FindState.PENDING, "pending"],
]);

const initialFindState = {
  entireWord: null,
  matchesCount: {
    current: 0,
    total: 0,
  },
  previous: false,
  queryIsRegex: false,
  rawQuery: null,
  results: [],
  state: "idle",
  stateCode: null,
};

function normalizeSnippetText(text = "") {
  return text.replaceAll(/\s+/g, " ").trim();
}

function getFindResults(findController, rawQuery) {
  if (!rawQuery) {
    return [];
  }
  const query = findController?.state?.queryIsRegex
    ? rawQuery
    : normalize(rawQuery)[0];
  const pageContents = findController?._pageContents || [];
  const results = [];
  let resultIndex = 0;

  pageContents.forEach((content = "", pageIndex) => {
    if (!content) {
      return;
    }
    const matches = findController?.match(query, content, pageIndex) || [];
    if (!matches.length) {
      return;
    }
    matches.forEach(({ index: position, length }, matchIndex) => {
      const beforeStart = Math.max(0, position - 44);
      const afterEnd = Math.min(content.length, position + length + 58);
      resultIndex += 1;
      results.push({
        after: normalizeSnippetText(content.slice(position + length, afterEnd)),
        before: normalizeSnippetText(content.slice(beforeStart, position)),
        id: `${pageIndex + 1}-${matchIndex}-${position}`,
        index: resultIndex,
        match: normalizeSnippetText(content.slice(position, position + length)),
        matchIndex,
        pageNumber: pageIndex + 1,
      });
    });
  });

  return results;
}

export function createFindStateTracker({ emitState, eventBus, findController }) {
  let findState = initialFindState;

  function setFindState(nextState) {
    findState = {
      ...findState,
      ...nextState,
    };
    emitState();
  }

  function onUpdateFindControlState({
    entireWord,
    matchesCount,
    previous,
    queryIsRegex,
    rawQuery,
    state,
  }) {
    setFindState({
      entireWord,
      matchesCount,
      previous,
      queryIsRegex: Boolean(queryIsRegex),
      rawQuery,
      results: getFindResults(findController, rawQuery),
      state: findStateLabels.get(state) || "unknown",
      stateCode: state,
    });
  }

  function onUpdateFindMatchesCount({ matchesCount }) {
    setFindState({
      matchesCount,
      results: getFindResults(findController, findState.rawQuery),
    });
  }

  eventBus.on("updatefindcontrolstate", onUpdateFindControlState);
  eventBus.on("updatefindmatchescount", onUpdateFindMatchesCount);

  return {
    destroy() {
      eventBus.off("updatefindcontrolstate", onUpdateFindControlState);
      eventBus.off("updatefindmatchescount", onUpdateFindMatchesCount);
    },
    getState() {
      return findState;
    },
  };
}
