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

import { bytesToString, stringToBytes } from "../shared/util.js";

function byteStringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0, ii = str.length; i < ii; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    throw new Error("PdfContentTokenWriter - invalid number.");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  return Number.isInteger(value)
    ? value.toString()
    : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeName(name) {
  const output = ["/"];
  for (let i = 0, ii = name.length; i < ii; i++) {
    const ch = name.charCodeAt(i) & 0xff;
    if (
      ch <= 0x20 ||
      ch >= 0x7f ||
      "#%()/<>[]{}".includes(String.fromCharCode(ch))
    ) {
      output.push("#", ch.toString(16).toUpperCase().padStart(2, "0"));
    } else {
      output.push(String.fromCharCode(ch));
    }
  }
  return output.join("");
}

function escapeLiteralString(byteString) {
  const output = ["("];
  for (let i = 0, ii = byteString.length; i < ii; i++) {
    const ch = byteString.charCodeAt(i) & 0xff;
    switch (ch) {
      case 0x08:
        output.push("\\b");
        break;
      case 0x09:
        output.push("\\t");
        break;
      case 0x0a:
        output.push("\\n");
        break;
      case 0x0c:
        output.push("\\f");
        break;
      case 0x0d:
        output.push("\\r");
        break;
      case 0x28:
      case 0x29:
      case 0x5c:
        output.push("\\", String.fromCharCode(ch));
        break;
      default:
        if (ch < 0x20 || ch >= 0x7f) {
          output.push("\\", ch.toString(8).padStart(3, "0"));
        } else {
          output.push(String.fromCharCode(ch));
        }
        break;
    }
  }
  output.push(")");
  return output.join("");
}

function escapeHexString(byteString) {
  const bytes = byteStringToBytes(byteString);
  const output = ["<"];
  for (const byte of bytes) {
    output.push(byte.toString(16).toUpperCase().padStart(2, "0"));
  }
  output.push(">");
  return output.join("");
}

class PdfContentTokenWriter {
  #chunks = [];

  writeRaw(raw) {
    this.#chunks.push(typeof raw === "string" ? stringToBytes(raw) : raw);
  }

  writeOriginal(token) {
    this.writeRaw(token.raw);
  }

  writeLiteralString(byteString) {
    this.writeRaw(escapeLiteralString(byteString));
  }

  writeHexString(byteString) {
    this.writeRaw(escapeHexString(byteString));
  }

  writeName(name) {
    this.writeRaw(escapeName(name));
  }

  writeNumber(value) {
    this.writeRaw(formatNumber(value));
  }

  writeOperator(name) {
    this.writeRaw(name);
  }

  writeSpace() {
    this.writeRaw(" ");
  }

  toUint8Array() {
    const length = this.#chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  toString() {
    return bytesToString(this.toUint8Array());
  }
}

export {
  escapeHexString,
  escapeLiteralString,
  escapeName,
  formatNumber,
  PdfContentTokenWriter,
};
