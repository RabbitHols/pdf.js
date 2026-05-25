const drivePdfMimeType = "application/pdf";
const driveScope = "https://www.googleapis.com/auth/drive.file";
const gisScriptUrl = "https://accounts.google.com/gsi/client";
const googleApiScriptUrl = "https://apis.google.com/js/api.js";

let googleAccessToken = null;
let gisScriptPromise = null;
let pickerApiPromise = null;

export function getGoogleDriveConfig() {
  return {
    apiKey: import.meta.env.VITE_GOOGLE_DRIVE_API_KEY || "",
    appId: import.meta.env.VITE_GOOGLE_DRIVE_APP_ID || "",
    clientId: import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID || "",
  };
}

export function isGoogleDriveConfigured(config = getGoogleDriveConfig()) {
  return Boolean(config.apiKey && config.appId && config.clientId);
}

export async function preloadGoogleDriveApis() {
  if (!isGoogleDriveConfigured()) {
    return;
  }
  await Promise.all([
    loadGoogleIdentityServices(),
    loadGooglePickerApi(),
  ]);
}

function loadScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "true") {
    return Promise.resolve();
  }
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error("google-script-load-failed")));
    document.head.append(script);
  });
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  gisScriptPromise ||= loadScript(gisScriptUrl).catch(reason => {
    gisScriptPromise = null;
    throw reason;
  });
  return gisScriptPromise;
}

async function loadGooglePickerApi() {
  if (window.google?.picker) {
    return;
  }
  if (!pickerApiPromise) {
    pickerApiPromise = loadScript(googleApiScriptUrl)
      .then(() =>
        new Promise((resolve, reject) => {
          if (!window.gapi?.load) {
            reject(new Error("google-picker-loader-unavailable"));
            return;
          }
          window.gapi.load("picker", {
            callback: resolve,
            onerror: () => reject(new Error("google-picker-load-failed")),
            timeout: 10000,
            ontimeout: () => reject(new Error("google-picker-load-timeout")),
          });
        })
      )
      .catch(reason => {
        pickerApiPromise = null;
        throw reason;
      });
  }
  return pickerApiPromise;
}

async function requestGoogleDriveAccessToken(config) {
  await loadGoogleIdentityServices();
  if (!window.google?.accounts?.oauth2?.initTokenClient) {
    throw new Error("google-identity-unavailable");
  }

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: driveScope,
      callback: response => {
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        googleAccessToken = response.access_token;
        resolve(googleAccessToken);
      },
    });
    tokenClient.requestAccessToken({
      prompt: googleAccessToken ? "" : "consent",
    });
  });
}

function getPickerDocumentValue(document, key) {
  return document?.[key] || "";
}

async function pickGoogleDrivePdf(accessToken, config) {
  await loadGooglePickerApi();
  const { google } = window;
  const docsView = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setMimeTypes(drivePdfMimeType)
    .setMode(google.picker.DocsViewMode.LIST);

  return new Promise((resolve, reject) => {
    const pickerBuilder = new google.picker.PickerBuilder()
      .addView(docsView)
      .setAppId(config.appId)
      .setDeveloperKey(config.apiKey)
      .setOAuthToken(accessToken)
      .setCallback(data => {
        if (data[google.picker.Response.ACTION] === google.picker.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) {
          return;
        }
        const document = data[google.picker.Response.DOCUMENTS]?.[0];
        const fileId = getPickerDocumentValue(document, google.picker.Document.ID);
        if (!fileId) {
          reject(new Error("google-drive-file-missing"));
          return;
        }
        resolve({
          id: fileId,
          mimeType: getPickerDocumentValue(document, google.picker.Document.MIME_TYPE),
          name: getPickerDocumentValue(document, google.picker.Document.NAME) || "Drive PDF.pdf",
          url: getPickerDocumentValue(document, google.picker.Document.URL),
        });
      });

    if (google.picker.Feature?.SUPPORT_DRIVES) {
      pickerBuilder.enableFeature(google.picker.Feature.SUPPORT_DRIVES);
    }

    const picker = pickerBuilder.build();

    picker.setVisible(true);
  });
}

async function fetchGoogleDrivePdfFile(accessToken, driveFile) {
  if (driveFile.mimeType && driveFile.mimeType !== drivePdfMimeType) {
    throw new Error("google-drive-unsupported-file");
  }
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.id)}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error("google-drive-download-failed");
  }
  const blob = await response.blob();
  const name = driveFile.name.toLowerCase().endsWith(".pdf")
    ? driveFile.name
    : `${driveFile.name}.pdf`;
  return new File([blob], name, { type: drivePdfMimeType });
}

export async function openGoogleDrivePdf() {
  const config = getGoogleDriveConfig();
  if (!isGoogleDriveConfigured(config)) {
    throw new Error("google-drive-not-configured");
  }
  const accessToken = await requestGoogleDriveAccessToken(config);
  const driveFile = await pickGoogleDrivePdf(accessToken, config);
  if (!driveFile) {
    return null;
  }
  const file = await fetchGoogleDrivePdfFile(accessToken, driveFile);
  return {
    driveFile,
    file,
  };
}
