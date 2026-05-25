const permissionFlags = {
  PRINT: 0x04,
  MODIFY_CONTENTS: 0x08,
  COPY: 0x10,
  MODIFY_ANNOTATIONS: 0x20,
  FILL_INTERACTIVE_FORMS: 0x100,
  COPY_FOR_ACCESSIBILITY: 0x200,
  ASSEMBLE: 0x400,
  PRINT_HIGH_QUALITY: 0x800,
};

const initialPdfSecurityState = {
  error: null,
  metadata: {
    encryptFilterName: null,
    isSignaturesPresent: false,
  },
  permissions: {
    details: [],
    hasRestrictions: false,
    isAvailable: false,
    raw: null,
    summary: "unknown",
  },
  signatures: {
    count: 0,
    details: [],
    hasDigitalSignatures: false,
    status: "none",
    verificationSupported: false,
  },
  status: "idle",
};

function getSourceBytes(source) {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (source?.data instanceof Uint8Array) {
    return source.data;
  }
  if (source?.data instanceof ArrayBuffer) {
    return new Uint8Array(source.data);
  }
  return null;
}

function decodeLatin1(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

function decodePdfLiteral(value = "") {
  return value
    .replaceAll(/\\([nrtbf()\\])/g, (_, escaped) => {
      const replacements = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      return replacements[escaped] ?? escaped;
    })
    .replaceAll(/\\([0-7]{1,3})/g, (_, octal) =>
      String.fromCharCode(Number.parseInt(octal, 8))
    )
    .replaceAll(/[\u0000-\u001f]+/g, " ")
    .trim();
}

function hexToBytes(hex = "") {
  const cleanHex = hex.replaceAll(/\s+/g, "");
  const bytes = new Uint8Array(Math.floor(cleanHex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function decodeHexString(hex = "") {
  const bytes = hexToBytes(hex);
  return decodeLatin1(bytes);
}

function getPrintableStrings(value = "") {
  return Array.from(value.matchAll(/[ -~]{4,}/g), match => match[0].trim())
    .map(text => text.replaceAll(/\s+/g, " "))
    .filter(Boolean);
}

function getAsn1StringsFromHex(hex = "") {
  const bytes = hexToBytes(hex);
  const strings = [];
  for (let i = 0; i < bytes.length - 2; i += 1) {
    const tag = bytes[i];
    if (tag !== 0x0c && tag !== 0x13 && tag !== 0x16) {
      continue;
    }
    let length = bytes[i + 1];
    let offset = i + 2;
    if (length & 0x80) {
      const lengthBytes = length & 0x7f;
      if (!lengthBytes || lengthBytes > 2 || i + 2 + lengthBytes >= bytes.length) {
        continue;
      }
      length = 0;
      for (let j = 0; j < lengthBytes; j += 1) {
        length = (length << 8) | bytes[i + 2 + j];
      }
      offset = i + 2 + lengthBytes;
    }
    if (!length || offset + length > bytes.length) {
      continue;
    }
    const decoded = decodeLatin1(bytes.slice(offset, offset + length))
      .replaceAll(/[\u0000-\u001f]+/g, " ")
      .trim();
    if (/^[ -~]{4,}$/.test(decoded)) {
      strings.push(decoded);
    }
  }
  return strings;
}

function pickSignerName(strings) {
  const excluded = [
    /^Adobe (Systems|Trust|Product|Root)/i,
    /^https?:/i,
    /license certificate/i,
    /certificate/i,
  ];
  return (
    strings.find(
      value =>
        /production|sign|signature/i.test(value) &&
        !excluded.some(pattern => pattern.test(value))
    ) ||
    strings.find(
      value =>
        value.length >= 8 &&
        value.length <= 80 &&
        !excluded.some(pattern => pattern.test(value))
    ) ||
    null
  );
}

function isReadablePdfName(value) {
  if (!value || value.length < 4 || value.length > 120) {
    return false;
  }
  const readableChars = Array.from(value).filter(char => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126;
  }).length;
  return readableChars / value.length > 0.9;
}

function parseUtcDateString(value) {
  if (!value) {
    return null;
  }
  const yearPrefix = Number(value.slice(0, 2)) >= 50 ? "19" : "20";
  const iso = `${yearPrefix}${value.slice(0, 2)}-${value.slice(
    2,
    4
  )}-${value.slice(4, 6)}T${value.slice(6, 8)}:${value.slice(
    8,
    10
  )}:${value.slice(10, 12)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseUtcSigningDate(value) {
  const matches = Array.from(value.matchAll(/\b(\d{12})Z\b/g), match => match[1]);
  return parseUtcDateString(matches.at(-1));
}

function parsePkcs7SigningTime(contentsHex) {
  const cleanHex = contentsHex.replaceAll(/\s+/g, "").toLowerCase();
  const signingTimeOid = "06092a864886f70d010905";
  const oidIndex = cleanHex.indexOf(signingTimeOid);
  if (oidIndex < 0) {
    return null;
  }
  const utcTimeMatch = /170d([0-9a-f]{24})5a/.exec(
    cleanHex.slice(oidIndex + signingTimeOid.length)
  );
  if (!utcTimeMatch) {
    return null;
  }
  const utcTime = decodeHexString(utcTimeMatch[1]);
  return parseUtcDateString(utcTime);
}

function parsePdfDate(value) {
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(
    value || ""
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hours = "00", minutes = "00", seconds = "00"] =
    match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds)
    )
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function scanPdfSignatureBytes(bytes) {
  if (!bytes) {
    return null;
  }
  const text = decodeLatin1(bytes);
  const hasSignatureSyntax =
    /\/Type\s*\/Sig\b/.test(text) ||
    /\/ByteRange\s*\[/.test(text) ||
    /\/SubFilter\s*\/(?:adbe\.pkcs7|ETSI\.)/.test(text);
  if (!hasSignatureSyntax) {
    return null;
  }

  const byteRangeMatch = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(
    text
  );
  const byteRange = byteRangeMatch
    ? byteRangeMatch.slice(1, 5).map(value => Number.parseInt(value, 10))
    : null;
  const byteRangeEndsAtFile =
    byteRange?.length === 4 && byteRange[2] + byteRange[3] === bytes.byteLength;
  const name = decodePdfLiteral(/\/Name\s*\(([^)]*)\)/.exec(text)?.[1] || "");
  const modifiedDate = parsePdfDate(
    decodePdfLiteral(/\/M\s*\(([^)]*)\)/.exec(text)?.[1] || "")
  );
  const contentsHex = /\/Contents\s*<([0-9a-fA-F\s]+)>/.exec(text)?.[1] || "";
  const contentsText = contentsHex ? decodeHexString(contentsHex) : "";
  const printableStrings = [
    ...getAsn1StringsFromHex(contentsHex),
    ...getPrintableStrings(contentsText),
  ];
  const signerName = isReadablePdfName(name) ? name : pickSignerName(printableStrings);

  return {
    byteRange,
    detectionSource: byteRange ? "byte-range" : "signature-dictionary",
    documentModified:
      byteRangeEndsAtFile === true
        ? false
        : byteRange
          ? true
          : null,
    documentModifiedSource: byteRange ? "byte-range-only" : null,
    filter: /\/Filter\s*\/([^\s/>]+)/.exec(text)?.[1] || null,
    signerName,
    signingTime:
      parsePkcs7SigningTime(contentsHex) ||
      parseUtcSigningDate(contentsText) ||
      modifiedDate,
    subFilter: /\/SubFilter\s*\/([^\s/>]+)/.exec(text)?.[1] || null,
    certificate: signerName
      ? {
          subject: signerName,
          source: "embedded-pkcs7",
        }
      : null,
  };
}

function normalizeMetadata(metadataResult) {
  const info = metadataResult?.info || {};
  return {
    encryptFilterName: info.EncryptFilterName || null,
    isSignaturesPresent: info.IsSignaturesPresent === true,
  };
}

function includesPermission(permissions, flag) {
  return permissions?.includes(flag) === true;
}

function normalizePermissions(permissions, flags = permissionFlags) {
  if (!permissions) {
    return {
      details: [],
      hasRestrictions: false,
      isAvailable: true,
      raw: null,
      summary: "unrestricted",
    };
  }

  const details = [
    {
      allowed:
        includesPermission(permissions, flags.PRINT) ||
        includesPermission(permissions, flags.PRINT_HIGH_QUALITY),
      key: "print",
    },
    {
      allowed: includesPermission(permissions, flags.MODIFY_CONTENTS),
      key: "modify",
    },
    {
      allowed: includesPermission(permissions, flags.COPY),
      key: "copy",
    },
    {
      allowed: includesPermission(permissions, flags.MODIFY_ANNOTATIONS),
      key: "annotations",
    },
    {
      allowed: includesPermission(permissions, flags.FILL_INTERACTIVE_FORMS),
      key: "forms",
    },
    {
      allowed: includesPermission(permissions, flags.COPY_FOR_ACCESSIBILITY),
      key: "accessibility",
    },
    {
      allowed: includesPermission(permissions, flags.ASSEMBLE),
      key: "assemble",
    },
  ];
  const hasRestrictions = details.some(detail => !detail.allowed);
  const modificationAllowed = details.some(
    detail =>
      ["modify", "annotations", "forms", "assemble"].includes(detail.key) &&
      detail.allowed
  );

  return {
    details,
    hasRestrictions,
    isAvailable: true,
    modificationAllowed,
    raw: permissions,
    summary: hasRestrictions ? "restricted" : "unrestricted",
  };
}

function normalizeFieldSignatures(fieldObjects) {
  if (!fieldObjects) {
    return [];
  }
  const fields = [];
  for (const [name, entries] of Object.entries(fieldObjects)) {
    for (const field of entries || []) {
      if (field?.type === "signature" || field?.fieldType === "Sig") {
        fields.push({
          detectionSource: "field-objects",
          fieldName: field.name || name,
          signerName: field.value || null,
        });
      }
    }
  }
  return fields;
}

export function createInitialPdfSecurityState() {
  return structuredClone(initialPdfSecurityState);
}

export async function readPdfSecurityState({ pdfDocument, pdfjsLib, source }) {
  if (!pdfDocument) {
    return createInitialPdfSecurityState();
  }

  const [metadataResult, permissionsResult, fieldObjectsResult] =
    await Promise.allSettled([
      pdfDocument.getMetadata(),
      pdfDocument.getPermissions(),
      pdfDocument.getFieldObjects(),
    ]);
  const metadata =
    metadataResult.status === "fulfilled"
      ? normalizeMetadata(metadataResult.value)
      : initialPdfSecurityState.metadata;
  const permissions =
    permissionsResult.status === "fulfilled"
      ? normalizePermissions(
          permissionsResult.value,
          pdfjsLib?.PermissionFlag || permissionFlags
        )
      : {
          ...initialPdfSecurityState.permissions,
          error: permissionsResult.reason?.message || "permissions-unavailable",
        };
  const fieldSignatures =
    fieldObjectsResult.status === "fulfilled"
      ? normalizeFieldSignatures(fieldObjectsResult.value)
      : [];
  const scannedSignature = scanPdfSignatureBytes(getSourceBytes(source));
  const details = [
    ...fieldSignatures,
    scannedSignature,
    metadata.isSignaturesPresent
      ? {
          detectionSource: "metadata",
        }
      : null,
  ].filter(Boolean);
  const hasDigitalSignatures = details.length > 0;

  return {
    error:
      metadataResult.status === "rejected"
        ? metadataResult.reason?.message || "metadata-unavailable"
        : null,
    metadata,
    permissions,
    signatures: {
      count: hasDigitalSignatures ? details.length : 0,
      details,
      hasDigitalSignatures,
      status: hasDigitalSignatures ? "unknown" : "none",
      verificationSupported: false,
    },
    status: "loaded",
  };
}
