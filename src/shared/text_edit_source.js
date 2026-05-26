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

function getTextEditSourceTextSegments(textEditSource) {
  const segments = textEditSource?.segments;
  if (!Array.isArray(segments)) {
    return [];
  }
  return segments.filter(segment => segment.kind === "text");
}

function getSourceTextFromTextEditSource(textEditSource) {
  if (
    textEditSource?.grouped === true &&
    typeof textEditSource.sourceText === "string"
  ) {
    return textEditSource.sourceText;
  }
  if (
    textEditSource?.grouped === true &&
    Array.isArray(textEditSource.sources)
  ) {
    let text = "";
    for (const source of textEditSource.sources) {
      const sourceText = getSourceTextFromTextEditSource(source);
      if (typeof sourceText !== "string") {
        return null;
      }
      text += sourceText;
    }
    return text;
  }

  const segments = textEditSource?.segments;
  if (!Array.isArray(segments)) {
    return null;
  }

  const textSegments = getTextEditSourceTextSegments(textEditSource);
  if (textSegments.length === 0) {
    return null;
  }

  if (textEditSource.operatorName === "Tj") {
    if (textSegments.length !== 1 || textSegments.length !== segments.length) {
      return null;
    }
  } else if (
    textEditSource.operatorName !== "TJ" ||
    segments.some(
      segment => segment.kind !== "text" && segment.kind !== "spacing"
    )
  ) {
    return null;
  }

  return textSegments
    .map(segment => segment.text ?? segment.byteString ?? "")
    .join("");
}

export { getSourceTextFromTextEditSource, getTextEditSourceTextSegments };
