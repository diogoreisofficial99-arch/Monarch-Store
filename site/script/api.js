"use strict";

async function requestJson(url, options = {}) {
  const session = await window.MonarchAPI.sessionPromise;
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", session.csrfToken);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...options, method, headers, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof body === "object" && body ? body.error || "O pedido não foi concluído." : body || "O pedido não foi concluído.");
    error.status = response.status;
    throw error;
  }
  return body;
}

async function loadSession() {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Não foi possível verificar a sessão.");
  return response.json();
}

async function loadSiteSettings() {
  const response = await fetch("/api/settings", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Não foi possível carregar as definições do site.");
  return response.json();
}

function normalizeAssetUrl(url) {
  return typeof url === "string" && url.startsWith("/uploads/")
    ? url.replace(/^\/uploads\//, "/assets/imgs/uploads/")
    : url;
}

window.MonarchAPI = {
  sessionPromise: loadSession(),
  settingsPromise: loadSiteSettings(),
  request: requestJson,
  normalizeAssetUrl,
  async refreshSession() {
    this.sessionPromise = loadSession();
    return this.sessionPromise;
  }
};

Promise.all([window.MonarchAPI.sessionPromise, window.MonarchAPI.settingsPromise]).then(([session, settings]) => {
  settings.logoUrl = normalizeAssetUrl(settings.logoUrl);
  settings.faviconUrl = normalizeAssetUrl(settings.faviconUrl);
  window.MonarchAPI.currentSession = session;
  window.MonarchAPI.currentSettings = settings;
  document.querySelectorAll("[data-site-logo]").forEach((image) => {
    image.src = settings.logoUrl;
    image.alt = settings.siteName;
  });
  document.querySelectorAll("[data-site-favicon]").forEach((image) => {
    image.src = settings.faviconUrl;
  });
  document.querySelectorAll("[data-site-brand]").forEach((element) => {
    element.setAttribute("aria-label", `${settings.siteName} - Início`);
  });
  document.querySelectorAll("[data-branding-copyright]").forEach((element) => {
    element.textContent = `© ${new Date().getFullYear()} ${settings.siteName}`;
  });
  document.querySelectorAll('link[rel="icon"]').forEach((link) => {
    link.href = settings.faviconUrl;
    const extension = settings.faviconUrl.split("?")[0].split(".").pop().toLowerCase();
    link.type = extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "webp" ? "image/webp" : "image/png";
  });
  const pathname = window.location.pathname.toLowerCase();
  document.title = /^\/admin(?:\.html|\/|$)/.test(pathname)
    ? `Admin | ${settings.siteName}`
    : /^\/(?:cliente(?:\/|$)|conta\.html$)/.test(pathname)
      ? `Cliente | ${settings.siteName}`
      : settings.siteName;
  document.querySelectorAll("[data-auth-label]").forEach((element) => {
    element.textContent = session.user ? "Área cliente" : "Entrar";
  });
  document.querySelectorAll("[data-auth-link]").forEach((link) => {
    link.href = session.user ? "/conta.html" : "/auth/discord";
  });
}).catch((error) => {
  console.error("Não foi possível inicializar a sessão ou as definições do site.", error);
});
