/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  collectContentStreamOperations,
  tokenizeContentStream,
} from "./content_stream_tokenizer.js";
import { Util } from "../shared/util.js";

const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

function cloneTextState(state) {
  return {
    inTextObject: state.inTextObject,
    ctm: state.ctm.slice(),
    fontName: state.fontName,
    fontSize: state.fontSize,
    charSpacing: state.charSpacing,
    wordSpacing: state.wordSpacing,
    horizontalScale: state.horizontalScale,
    leading: state.leading,
    renderingMode: state.renderingMode,
    rise: state.rise,
    textMatrix: state.textMatrix.slice(),
    textLineMatrix: state.textLineMatrix.slice(),
    graphicsStateDepth: state.graphicsStateDepth,
    markedContentDepth: state.markedContentDepth,
    unsupportedContextReasons: state.unsupportedContextReasons.slice(),
  };
}

function createInitialState() {
  return {
    inTextObject: false,
    ctm: IDENTITY_MATRIX.slice(),
    fontName: null,
    fontSize: null,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    renderingMode: 0,
    rise: 0,
    textMatrix: IDENTITY_MATRIX.slice(),
    textLineMatrix: IDENTITY_MATRIX.slice(),
    graphicsStateDepth: 0,
    graphicsStateStack: [],
    markedContentDepth: 0,
    unsupportedContextReasons: [],
  };
}

function nameValue(token) {
  return token?.type === "name" ? token.value : null;
}

function numberValue(token) {
  return token?.type === "number" ? token.value : null;
}

function numberArray(tokens, length) {
  if (tokens.length < length) {
    return null;
  }
  const values = tokens.slice(0, length).map(numberValue);
  return values.every(value => typeof value === "number") ? values : null;
}

function applyTextTranslation(state, x, y) {
  state.textLineMatrix = Util.transform(
    [1, 0, 0, 1, x, y],
    state.textLineMatrix
  );
  state.textMatrix = state.textLineMatrix.slice();
}

function applyNextLine(state) {
  applyTextTranslation(state, 0, -state.leading);
}

function applyTextState(operation, state) {
  const operands = operation.operands;
  switch (operation.operatorName) {
    case "q":
      state.graphicsStateStack.push({
        ctm: state.ctm.slice(),
      });
      state.graphicsStateDepth++;
      break;
    case "Q":
      {
        const snapshot = state.graphicsStateStack.pop();
        if (snapshot) {
          state.ctm = snapshot.ctm.slice();
        }
      }
      state.graphicsStateDepth = Math.max(0, state.graphicsStateDepth - 1);
      break;
    case "cm":
      {
        const matrix = numberArray(operands, 6);
        if (matrix) {
          state.ctm = Util.transform(state.ctm, matrix);
        }
      }
      break;
    case "BT":
      state.inTextObject = true;
      state.textMatrix = IDENTITY_MATRIX.slice();
      state.textLineMatrix = IDENTITY_MATRIX.slice();
      break;
    case "ET":
      state.inTextObject = false;
      break;
    case "Tf":
      state.fontName = nameValue(operands[0]);
      state.fontSize = numberValue(operands[1]);
      break;
    case "Tc":
      state.charSpacing = numberValue(operands[0]) ?? state.charSpacing;
      break;
    case "Tw":
      state.wordSpacing = numberValue(operands[0]) ?? state.wordSpacing;
      break;
    case "Tz":
      state.horizontalScale =
        typeof numberValue(operands[0]) === "number"
          ? numberValue(operands[0]) / 100
          : state.horizontalScale;
      break;
    case "TL":
      state.leading = numberValue(operands[0]) ?? state.leading;
      break;
    case "Td":
      {
        const delta = numberArray(operands, 2);
        if (delta) {
          applyTextTranslation(state, delta[0], delta[1]);
        }
      }
      break;
    case "TD":
      {
        const delta = numberArray(operands, 2);
        if (delta) {
          state.leading = -delta[1];
          applyTextTranslation(state, delta[0], delta[1]);
        }
      }
      break;
    case "T*":
      applyNextLine(state);
      break;
    case "Tr":
      state.renderingMode = numberValue(operands[0]) ?? state.renderingMode;
      break;
    case "Ts":
      state.rise = numberValue(operands[0]) ?? state.rise;
      break;
    case "Tm":
      {
        const matrix = numberArray(operands, 6);
        if (matrix) {
          state.textMatrix = matrix;
          state.textLineMatrix = state.textMatrix.slice();
        }
      }
      break;
    case "'":
      applyNextLine(state);
      break;
    case '"':
      {
        const wordSpacing = numberValue(operands[0]);
        const charSpacing = numberValue(operands[1]);
        state.wordSpacing = wordSpacing ?? state.wordSpacing;
        state.charSpacing = charSpacing ?? state.charSpacing;
        applyNextLine(state);
      }
      break;
    case "BMC":
    case "BDC":
      state.markedContentDepth++;
      break;
    case "EMC":
      state.markedContentDepth = Math.max(0, state.markedContentDepth - 1);
      break;
    case "Do":
      state.unsupportedContextReasons.push("form-xobject-edit-not-enabled");
      break;
  }
}

function buildContentStreamProgram(data, { containerPath = null } = {}) {
  const tokens = tokenizeContentStream(data);
  const operations = collectContentStreamOperations(tokens);
  const state = createInitialState();

  return {
    type: "PdfOperatorProgram",
    containerPath: containerPath || [{ type: "page" }],
    tokens,
    operations: operations.map(operation => {
      const textStateBefore = cloneTextState(state);
      applyTextState(operation, state);
      return {
        ...operation,
        textStateBefore,
        textStateAfter: cloneTextState(state),
      };
    }),
  };
}

export { buildContentStreamProgram };
