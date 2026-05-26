const serviceWorkerProtocols = new Set(["http:", "https:"]);

function canRegisterServiceWorker() {
  return (
    import.meta.env.PROD &&
    "serviceWorker" in navigator &&
    serviceWorkerProtocols.has(window.location.protocol)
  );
}

export function registerViewerNextServiceWorker() {
  if (!canRegisterServiceWorker()) {
    return;
  }

  const register = () => {
    const workerUrl = new URL(
      /* @vite-ignore */ "../service-worker.js",
      import.meta.url
    );
    const scopeUrl = new URL(/* @vite-ignore */ "../", import.meta.url);

    navigator.serviceWorker
      .register(workerUrl, { scope: scopeUrl.pathname })
      .catch(reason => {
        console.warn("Viewer Next service worker registration failed.", reason);
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
