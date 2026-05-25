const DEFAULT_PAGE_SIZE = {
  height: 842,
  width: 595,
};

function normalizeDimension(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 72 || number > 14400) {
    return fallback;
  }
  return Math.round(number * 100) / 100;
}

function normalizePageCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    return 1;
  }
  return Math.min(count, 100);
}

function formatOffset(offset) {
  return String(offset).padStart(10, "0");
}

export function createBlankPdf({
  pageCount = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const count = normalizePageCount(pageCount);
  const width = normalizeDimension(pageSize?.width, DEFAULT_PAGE_SIZE.width);
  const height = normalizeDimension(pageSize?.height, DEFAULT_PAGE_SIZE.height);
  const objects = [];
  const kids = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  for (let index = 0; index < count; index += 1) {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    kids.push(`${pageObjectNumber} 0 R`);
    objects[pageObjectNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber] = "<< /Length 0 >>\nstream\n\nendstream";
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${count} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = pdf.length;
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    pdf += `${formatOffset(offsets[objectNumber])} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
