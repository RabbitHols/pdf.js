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

function getNativeTextEditLineCandidate(blockCandidate) {
  const lines = blockCandidate?.lines;
  return Array.isArray(lines) && lines.length === 1 ? lines[0] : null;
}

function isNativeTextEditLineCandidateBlock(blockCandidate) {
  return !!getNativeTextEditLineCandidate(blockCandidate);
}

function getNativeTextEditLineTextDivs(lineCandidate) {
  return (
    lineCandidate?.textDivs ||
    (lineCandidate?.textDiv ? [lineCandidate.textDiv] : [])
  );
}

function isNativeTextEditLineCandidateInteractive(blockCandidate) {
  return (
    isNativeTextEditLineCandidateBlock(blockCandidate) &&
    blockCandidate?.editable !== false &&
    blockCandidate?.editPolicy?.supported !== false &&
    blockCandidate?.confidence === "high" &&
    blockCandidate?.sourceBacked === true
  );
}

export {
  getNativeTextEditLineCandidate,
  getNativeTextEditLineTextDivs,
  isNativeTextEditLineCandidateBlock,
  isNativeTextEditLineCandidateInteractive,
};
