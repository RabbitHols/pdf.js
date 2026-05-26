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

function unsupported(reason, extra = null) {
  return {
    ok: false,
    reason,
    ...(extra || null),
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeRedactionRegion(region) {
  let x0, y0, x1, y1;
  if (Array.isArray(region)) {
    [x0, y0, x1, y1] = region;
  } else if (region && typeof region === "object") {
    if (
      finiteNumber(region.x) &&
      finiteNumber(region.y) &&
      finiteNumber(region.width) &&
      finiteNumber(region.height)
    ) {
      x0 = region.x;
      y0 = region.y;
      x1 = region.x + region.width;
      y1 = region.y + region.height;
    } else {
      ({ x0, y0, x1, y1 } = region);
    }
  }

  if (
    !finiteNumber(x0) ||
    !finiteNumber(y0) ||
    !finiteNumber(x1) ||
    !finiteNumber(y1)
  ) {
    return unsupported("redact-region-invalid");
  }

  const minX = Math.min(x0, x1);
  const minY = Math.min(y0, y1);
  const maxX = Math.max(x0, x1);
  const maxY = Math.max(y0, y1);
  if (minX === maxX || minY === maxY) {
    return unsupported("redact-region-empty");
  }
  return {
    ok: true,
    region: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

function normalizeRedactionRegions(regions) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return unsupported("redact-regions-missing");
  }
  const normalized = [];
  for (const region of regions) {
    const result = normalizeRedactionRegion(region);
    if (!result.ok) {
      return result;
    }
    normalized.push(result.region);
  }
  return {
    ok: true,
    regions: normalized,
  };
}

function rectanglesIntersect(a, b) {
  return !(
    a.maxX <= b.minX ||
    b.maxX <= a.minX ||
    a.maxY <= b.minY ||
    b.maxY <= a.minY
  );
}

function rectIntersectsAnyRegion(rect, regions) {
  return regions.some(region => rectanglesIntersect(rect, region));
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function transformRect(matrix, rect) {
  const points = [
    transformPoint(matrix, rect.minX, rect.minY),
    transformPoint(matrix, rect.minX, rect.maxY),
    transformPoint(matrix, rect.maxX, rect.minY),
    transformPoint(matrix, rect.maxX, rect.maxY),
  ];
  return {
    minX: Math.min(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)),
    maxY: Math.max(...points.map(point => point.y)),
  };
}

export {
  normalizeRedactionRegion,
  normalizeRedactionRegions,
  rectanglesIntersect,
  rectIntersectsAnyRegion,
  transformRect,
};
