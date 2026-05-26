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

import { bytesToString } from "../shared/util.js";

const CONTENT_STREAM_OPERATORS = new Set([
  "b",
  "B",
  "b*",
  "B*",
  "BDC",
  "BI",
  "BMC",
  "BT",
  "BX",
  "c",
  "cm",
  "CS",
  "cs",
  "d",
  "d0",
  "d1",
  "Do",
  "DP",
  "EI",
  "EMC",
  "ET",
  "EX",
  "f",
  "F",
  "f*",
  "G",
  "g",
  "gs",
  "h",
  "i",
  "ID",
  "j",
  "J",
  "K",
  "k",
  "l",
  "m",
  "M",
  "MP",
  "n",
  "q",
  "Q",
  "re",
  "RG",
  "rg",
  "ri",
  "s",
  "S",
  "SC",
  "sc",
  "SCN",
  "scn",
  "sh",
  "T*",
  "Tc",
  "Td",
  "TD",
  "Tf",
  "Tj",
  "TJ",
  "TL",
  "Tm",
  "Tr",
  "Ts",
  "Tw",
  "Tz",
  "v",
  "w",
  "W",
  "W*",
  "y",
  "'",
  '"',
]);

const SPECIAL_CHARS = new Set([
  0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x25, 0x28, 0x29, 0x2f, 0x3c, 0x3e, 0x5b,
  0x5d, 0x7b, 0x7d,
]);

function isWhiteSpace(ch) {
  return (
    ch === 0x00 ||
    ch === 0x09 ||
    ch === 0x0a ||
    ch === 0x0c ||
    ch === 0x0d ||
    ch === 0x20
  );
}

function isDelimiter(ch) {
  return SPECIAL_CHARS.has(ch);
}

function isHexDigit(ch) {
  return (
    (ch >= 0x30 && ch <= 0x39) ||
    (ch >= 0x41 && ch <= 0x46) ||
    (ch >= 0x61 && ch <= 0x66)
  );
}

function hexValue(ch) {
  if (ch >= 0x30 && ch <= 0x39) {
    return ch - 0x30;
  }
  if (ch >= 0x41 && ch <= 0x46) {
    return ch - 0x41 + 10;
  }
  if (ch >= 0x61 && ch <= 0x66) {
    return ch - 0x61 + 10;
  }
  return -1;
}

function toBytes(data) {
  if (typeof data === "string") {
    const bytes = new Uint8Array(data.length);
    for (let i = 0, ii = data.length; i < ii; i++) {
      bytes[i] = data.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return data.getBytes();
}

function bytesSliceToString(bytes, start, end) {
  return bytesToString(bytes.subarray(start, end));
}

function hashString(str) {
  let hash = 0;
  for (let i = 0, ii = str.length; i < ii; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function decodeName(raw) {
  const result = [];
  for (let i = 1, ii = raw.length; i < ii; i++) {
    const ch = raw.charCodeAt(i);
    if (ch === 0x23 && i + 2 < ii) {
      const x = hexValue(raw.charCodeAt(i + 1));
      const y = hexValue(raw.charCodeAt(i + 2));
      if (x !== -1 && y !== -1) {
        result.push(String.fromCharCode((x << 4) | y));
        i += 2;
        continue;
      }
    }
    result.push(raw.charAt(i));
  }
  return result.join("");
}

function createToken(type, start, end, bytes, extra = null) {
  return {
    type,
    start,
    end,
    raw: bytesSliceToString(bytes, start, end),
    ...(extra || null),
  };
}

class PdfContentTokenizer {
  constructor(data, { knownOperators = CONTENT_STREAM_OPERATORS } = {}) {
    this.bytes = toBytes(data);
    this.pos = 0;
    this.knownOperators = knownOperators;
  }

  get length() {
    return this.bytes.length;
  }

  nextToken() {
    const bytes = this.bytes;
    let pos = this.pos;
    if (pos >= bytes.length) {
      return null;
    }

    const ch = bytes[pos];
    if (isWhiteSpace(ch)) {
      const start = pos++;
      while (pos < bytes.length && isWhiteSpace(bytes[pos])) {
        pos++;
      }
      this.pos = pos;
      return createToken("whitespace", start, pos, bytes);
    }
    if (ch === 0x25) {
      const start = pos++;
      while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) {
        pos++;
      }
      this.pos = pos;
      return createToken("comment", start, pos, bytes);
    }
    if (ch === 0x28) {
      return this.#readLiteralString();
    }
    if (ch === 0x2f) {
      return this.#readName();
    }
    if (ch === 0x3c) {
      if (bytes[pos + 1] === 0x3c) {
        this.pos = pos + 2;
        return createToken("dictStart", pos, pos + 2, bytes);
      }
      return this.#readHexString();
    }
    if (ch === 0x3e) {
      if (bytes[pos + 1] === 0x3e) {
        this.pos = pos + 2;
        return createToken("dictEnd", pos, pos + 2, bytes);
      }
      this.pos = pos + 1;
      return createToken("operator", pos, pos + 1, bytes, {
        value: ">",
        diagnostics: ["unexpected-dict-end-delimiter"],
      });
    }
    if (ch === 0x5b) {
      this.pos = pos + 1;
      return createToken("arrayStart", pos, pos + 1, bytes);
    }
    if (ch === 0x5d) {
      this.pos = pos + 1;
      return createToken("arrayEnd", pos, pos + 1, bytes);
    }
    if (ch === 0x7b) {
      this.pos = pos + 1;
      return createToken("braceStart", pos, pos + 1, bytes);
    }
    if (ch === 0x7d) {
      this.pos = pos + 1;
      return createToken("braceEnd", pos, pos + 1, bytes);
    }

    return this.#readRegularToken();
  }

  tokenize() {
    const tokens = [];
    let token;
    while ((token = this.nextToken())) {
      tokens.push(token);
    }
    return tokens;
  }

  #readLiteralString() {
    const bytes = this.bytes;
    const start = this.pos;
    const value = [];
    const diagnostics = [];
    let pos = start + 1,
      depth = 1;

    while (pos < bytes.length && depth > 0) {
      let ch = bytes[pos++];
      if (ch === 0x28) {
        depth++;
        value.push("(");
        continue;
      }
      if (ch === 0x29) {
        if (--depth === 0) {
          break;
        }
        value.push(")");
        continue;
      }
      if (ch !== 0x5c) {
        value.push(String.fromCharCode(ch));
        continue;
      }
      if (pos >= bytes.length) {
        diagnostics.push("unterminated-string-escape");
        break;
      }
      ch = bytes[pos++];
      switch (ch) {
        case 0x6e:
          value.push("\n");
          break;
        case 0x72:
          value.push("\r");
          break;
        case 0x74:
          value.push("\t");
          break;
        case 0x62:
          value.push("\b");
          break;
        case 0x66:
          value.push("\f");
          break;
        case 0x28:
        case 0x29:
        case 0x5c:
          value.push(String.fromCharCode(ch));
          break;
        case 0x0d:
          if (bytes[pos] === 0x0a) {
            pos++;
          }
          break;
        case 0x0a:
          break;
        default:
          if (ch >= 0x30 && ch <= 0x37) {
            let code = ch & 0x0f;
            for (let i = 0; i < 2; i++) {
              ch = bytes[pos];
              if (ch < 0x30 || ch > 0x37) {
                break;
              }
              pos++;
              code = (code << 3) + (ch & 0x0f);
            }
            value.push(String.fromCharCode(code));
          } else {
            value.push(String.fromCharCode(ch));
          }
          break;
      }
    }
    if (depth !== 0) {
      diagnostics.push("unterminated-literal-string");
    }
    this.pos = pos;
    return createToken("literalString", start, pos, bytes, {
      byteString: value.join(""),
      contentRange: [start + 1, Math.max(start + 1, pos - 1)],
      ...(diagnostics.length ? { diagnostics } : null),
    });
  }

  #readHexString() {
    const bytes = this.bytes;
    const start = this.pos++;
    const value = [];
    const diagnostics = [];
    let firstDigit = -1;

    while (this.pos < bytes.length) {
      const ch = bytes[this.pos++];
      if (ch === 0x3e) {
        break;
      }
      if (isWhiteSpace(ch)) {
        continue;
      }
      if (!isHexDigit(ch)) {
        diagnostics.push("invalid-hex-string-character");
        continue;
      }
      const digit = hexValue(ch);
      if (firstDigit === -1) {
        firstDigit = digit;
      } else {
        value.push(String.fromCharCode((firstDigit << 4) | digit));
        firstDigit = -1;
      }
    }
    if (firstDigit !== -1) {
      value.push(String.fromCharCode(firstDigit << 4));
    }
    if (this.bytes[this.pos - 1] !== 0x3e) {
      diagnostics.push("unterminated-hex-string");
    }
    const byteString = value.join("");
    return createToken("hexString", start, this.pos, bytes, {
      byteString,
      contentRange: [start + 1, Math.max(start + 1, this.pos - 1)],
      ...(diagnostics.length ? { diagnostics } : null),
    });
  }

  #readName() {
    const bytes = this.bytes;
    const start = this.pos++;
    while (this.pos < bytes.length && !isDelimiter(bytes[this.pos])) {
      this.pos++;
    }
    const raw = bytesSliceToString(bytes, start, this.pos);
    return createToken("name", start, this.pos, bytes, {
      value: decodeName(raw),
    });
  }

  #readRegularToken() {
    const bytes = this.bytes;
    const start = this.pos++;
    while (this.pos < bytes.length && !isDelimiter(bytes[this.pos])) {
      this.pos++;
    }
    const raw = bytesSliceToString(bytes, start, this.pos);
    if (raw === "BI") {
      return this.#readInlineImage(start);
    }
    if (this.knownOperators.has(raw)) {
      return createToken("operator", start, this.pos, bytes, { value: raw });
    }
    if (raw === "true" || raw === "false") {
      return createToken("boolean", start, this.pos, bytes, {
        value: raw === "true",
      });
    }
    if (raw === "null") {
      return createToken("null", start, this.pos, bytes, { value: null });
    }
    const number = Number(raw);
    if (!Number.isNaN(number) && /[.\d+-]/.test(raw[0])) {
      return createToken("number", start, this.pos, bytes, { value: number });
    }
    return createToken("keyword", start, this.pos, bytes, { value: raw });
  }

  #readInlineImage(start) {
    const bytes = this.bytes;
    const diagnostics = [];
    const dictionaryStart = this.pos;
    let pos = this.pos;
    let idStart = -1,
      idEnd = -1;

    while (pos < bytes.length) {
      if (
        bytes[pos] === 0x49 &&
        bytes[pos + 1] === 0x44 &&
        (pos === 0 || isWhiteSpace(bytes[pos - 1])) &&
        (pos + 2 >= bytes.length || isWhiteSpace(bytes[pos + 2]))
      ) {
        idStart = pos;
        idEnd = pos + 2;
        pos = idEnd;
        break;
      }
      pos++;
    }

    if (idStart === -1) {
      diagnostics.push("unterminated-inline-image-dictionary");
      this.pos = bytes.length;
      return createToken("inlineImage", start, bytes.length, bytes, {
        value: "BI",
        opaque: true,
        diagnostics,
      });
    }

    let imageDataStart = pos;
    if (imageDataStart < bytes.length && isWhiteSpace(bytes[imageDataStart])) {
      imageDataStart++;
    }
    let eiStart = -1,
      eiEnd = -1,
      eiCandidates = 0;
    while (pos < bytes.length) {
      if (
        bytes[pos] === 0x45 &&
        bytes[pos + 1] === 0x49 &&
        (pos === 0 || isWhiteSpace(bytes[pos - 1])) &&
        (pos + 2 >= bytes.length || isWhiteSpace(bytes[pos + 2]))
      ) {
        eiCandidates++;
        if (eiStart === -1) {
          eiStart = pos;
          eiEnd = pos + 2;
        }
      }
      pos++;
    }

    if (eiStart === -1) {
      diagnostics.push("unterminated-inline-image-data");
      this.pos = bytes.length;
      return createToken("inlineImage", start, bytes.length, bytes, {
        value: "BI",
        opaque: true,
        dictionaryRange: [dictionaryStart, idStart],
        idRange: [idStart, idEnd],
        imageDataRange: [imageDataStart, bytes.length],
        diagnostics,
      });
    }
    if (eiCandidates > 1) {
      diagnostics.push("inline-image-ei-marker-ambiguous");
    }
    this.pos = eiEnd;
    return createToken("inlineImage", start, eiEnd, bytes, {
      value: "BI",
      opaque: true,
      dictionaryRange: [dictionaryStart, idStart],
      idRange: [idStart, idEnd],
      imageDataRange: [imageDataStart, Math.max(imageDataStart, eiStart - 1)],
      eiRange: [eiStart, eiEnd],
      ...(diagnostics.length ? { diagnostics } : null),
    });
  }
}

function finishOperation({
  operations,
  operationTokens,
  operands,
  operatorToken,
  operatorIndex,
}) {
  const firstOperand = operands[0];
  const lastOperand = operands.at(-1);
  const firstToken = operationTokens[0] || operatorToken;
  const triviaTokens = operationTokens.filter(isPreservedToken);

  operations.push({
    operatorName: operatorToken.value,
    operatorIndex,
    operatorToken,
    operands,
    tokens: [...operationTokens, operatorToken],
    triviaTokens,
    byteRange: [firstOperand?.start ?? operatorToken.start, operatorToken.end],
    fullByteRange: [firstToken.start, operatorToken.end],
    operatorRange: [operatorToken.start, operatorToken.end],
    operandRange: [
      firstOperand?.start ?? operatorToken.start,
      lastOperand?.end ?? operatorToken.start,
    ],
    fingerprint: {
      operatorName: operatorToken.value,
      operandCount: operands.length,
      rawHash: hashString(
        operationTokens.map(token => token.raw).join("") + operatorToken.raw
      ),
    },
  });
}

function buildInlineImageOperation({ operations, token, operatorIndex }) {
  operations.push({
    operatorName: "BI",
    operatorIndex,
    operatorToken: token,
    operands: [],
    tokens: [token],
    triviaTokens: [],
    byteRange: [token.start, token.end],
    fullByteRange: [token.start, token.end],
    operatorRange: [token.start, token.end],
    operandRange: [token.start, token.start],
    opaque: true,
    diagnostics: token.diagnostics,
    fingerprint: {
      operatorName: "BI",
      operandCount: 0,
      rawHash: hashString(token.raw),
    },
  });
}

function getTokenByteString(token) {
  return token.byteString ?? token.value ?? "";
}

function makeTextSegment(token, logicalOffset) {
  const byteString = getTokenByteString(token);
  return {
    kind: "text",
    rawKind: token.type === "hexString" ? "hex" : "literal",
    rawRange: [token.start, token.end],
    contentRange: token.contentRange,
    logicalRange: [logicalOffset, logicalOffset + byteString.length],
    byteString,
    text: byteString,
  };
}

function appendTokenDiagnostics(token, diagnostics) {
  if (!token.diagnostics?.length) {
    return;
  }
  diagnostics.push(...token.diagnostics);
}

function buildOperatorFingerprint(operation, segments) {
  return {
    operatorName: operation.operatorName,
    operatorIndex: operation.operatorIndex,
    rawHash: operation.fingerprint?.rawHash,
    segmentHash: hashString(
      segments
        .map(segment =>
          segment.kind === "text"
            ? `${segment.rawKind}:${segment.byteString}`
            : ""
        )
        .join("|")
    ),
  };
}

function isTextStringToken(token) {
  return token?.type === "literalString" || token?.type === "hexString";
}

function tokenDiagnosticReason(token) {
  return token?.diagnostics?.[0] || null;
}

function buildUnsupportedTextSource(reason, operation, extra = null) {
  return {
    editable: false,
    reason,
    operatorName: operation?.operatorName,
    operatorIndex: operation?.operatorIndex,
    operatorRange: operation?.operatorRange,
    ...(extra || null),
  };
}

function sourceDiagnosticsFromTokens(tokens) {
  const diagnostics = [];
  for (const token of tokens) {
    appendTokenDiagnostics(token, diagnostics);
  }
  return diagnostics;
}

function tokenArrayHasNestedArray(tokens, start, end) {
  for (let i = start + 1; i < end; i++) {
    const token = tokens[i];
    if (token.type === "arrayStart" || token.type === "arrayEnd") {
      return true;
    }
  }
  return false;
}

function operatorHasOpaqueToken(operation) {
  return operation.tokens?.some(token => token.opaque);
}

function operatorHasBadToken(operation) {
  return operation.tokens?.some(
    token => token.diagnostics?.length && !isTextStringToken(token)
  );
}

function buildTextSourceBase(operation, segments) {
  return {
    operatorName: operation.operatorName,
    operatorIndex: operation.operatorIndex,
    operatorRange: operation.operatorRange,
    operandRange: operation.operandRange,
    fullByteRange: operation.fullByteRange,
    operatorFingerprint: buildOperatorFingerprint(operation, segments),
  };
}

function diagnoseOperationTokens(operation) {
  if (operatorHasOpaqueToken(operation)) {
    return "inline-image-near-edit-range";
  }
  if (operatorHasBadToken(operation)) {
    return "content-tokenizer-bad-token-near-edit";
  }
  return null;
}

function ensureSupportedOperationTokens(operation) {
  const reason = diagnoseOperationTokens(operation);
  if (!reason) {
    return null;
  }
  return buildUnsupportedTextSource(reason, operation, {
    diagnostics: sourceDiagnosticsFromTokens(operation.tokens || []),
  });
}

function tokenizeContentStream(data, options = null) {
  return new PdfContentTokenizer(data, options || undefined).tokenize();
}

function isPreservedToken(token) {
  return token.type === "whitespace" || token.type === "comment";
}

function collectContentStreamOperations(tokens) {
  const operations = [];
  let operands = [],
    operationTokens = [],
    operatorIndex = 0;

  for (const token of tokens) {
    if (token.type === "inlineImage") {
      if (operationTokens.length > 0) {
        operationTokens.length = 0;
        operands = [];
      }
      buildInlineImageOperation({ operations, token, operatorIndex });
      operatorIndex++;
      continue;
    }
    if (token.type === "operator") {
      finishOperation({
        operations,
        operationTokens,
        operands,
        operatorToken: token,
        operatorIndex,
      });
      operatorIndex++;
      operands = [];
      operationTokens = [];
      continue;
    }
    operationTokens.push(token);
    if (!isPreservedToken(token)) {
      operands.push(token);
    }
  }
  return operations;
}

function buildTextOperatorSource(operation) {
  if (!operation) {
    return null;
  }
  const tokenUnsupported = ensureSupportedOperationTokens(operation);
  if (tokenUnsupported) {
    return tokenUnsupported;
  }
  if (operation.operatorName === "Tj") {
    const operand = operation.operands.at(-1);
    if (!isTextStringToken(operand)) {
      return buildUnsupportedTextSource(
        "text-operator-missing-string-operand",
        operation
      );
    }
    const diagnostics = sourceDiagnosticsFromTokens([operand]);
    const segment = makeTextSegment(operand, 0);
    return {
      editable: !diagnostics.length,
      ...buildTextSourceBase(operation, [segment]),
      operandRange: [operand.start, operand.end],
      segments: [segment],
      ...(diagnostics.length
        ? { reason: tokenDiagnosticReason(operand), diagnostics }
        : null),
    };
  }

  if (operation.operatorName !== "TJ") {
    return null;
  }
  const operands = operation.operands;
  const arrayStart = operands.findIndex(token => token.type === "arrayStart");
  const arrayEnd = operands.findLastIndex(token => token.type === "arrayEnd");
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd < arrayStart) {
    return buildUnsupportedTextSource(
      "text-operator-missing-array-operand",
      operation
    );
  }
  if (tokenArrayHasNestedArray(operands, arrayStart, arrayEnd)) {
    return buildUnsupportedTextSource(
      "text-operator-array-has-nested-array",
      operation
    );
  }

  const segments = [];
  const diagnostics = [];
  let logicalOffset = 0,
    editable = true,
    reason = null;
  for (let i = arrayStart + 1; i < arrayEnd; i++) {
    const token = operands[i];
    if (isTextStringToken(token)) {
      appendTokenDiagnostics(token, diagnostics);
      if (token.diagnostics?.length) {
        editable = false;
        reason ||= token.diagnostics[0];
      }
      const segment = makeTextSegment(token, logicalOffset);
      segments.push(segment);
      logicalOffset = segment.logicalRange[1];
    } else if (token.type === "number") {
      segments.push({
        kind: "spacing",
        rawRange: [token.start, token.end],
        value: token.value,
      });
    } else {
      editable = false;
      reason ||= "text-operator-array-has-unsupported-token";
      segments.push({
        kind: "unsupported",
        rawRange: [token.start, token.end],
        tokenType: token.type,
      });
    }
  }
  return {
    editable,
    ...buildTextSourceBase(operation, segments),
    operandRange: [operands[arrayStart].start, operands[arrayEnd].end],
    arrayRange: [operands[arrayStart].start, operands[arrayEnd].end],
    segments,
    ...(reason ? { reason } : null),
    ...(diagnostics.length ? { diagnostics } : null),
  };
}

export {
  buildTextOperatorSource,
  collectContentStreamOperations,
  PdfContentTokenizer,
  tokenizeContentStream,
};
