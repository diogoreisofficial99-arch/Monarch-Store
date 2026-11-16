"use strict";

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      requestAnimationFrame(() => entry.target.classList.add("is-revealed"));
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" })
  : null;

function observeScrollReveals(root = document) {
  const targets = [...root.querySelectorAll(
    '[data-scroll-reveal], [style*="opacity: 0"], [style*="opacity:0"]'
  )].filter((element) => getComputedStyle(element).opacity === "0");

  for (const element of targets) {
    if (revealObserver) {
      element.classList.add("scroll-reveal");
      revealObserver.observe(element);
    } else {
      element.style.opacity = "1";
      element.style.transform = "none";
    }
  }
}

function revealVisibleElements() {
  const viewportHeight = document.documentElement.clientHeight;
  const viewportWidth = document.documentElement.clientWidth;

  for (const element of document.querySelectorAll(".scroll-reveal:not(.is-revealed)")) {
    const bounds = element.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= viewportHeight || bounds.right <= 0 || bounds.left >= viewportWidth) continue;
    revealObserver?.unobserve(element);
    element.classList.add("is-revealed");
  }
}

observeScrollReveals();
revealVisibleElements();
document.addEventListener("visibilitychange", revealVisibleElements);
window.addEventListener("pageshow", revealVisibleElements);

const heroGraffitiImage = document.querySelector("[data-hero-graffiti]");
if (heroGraffitiImage || document.querySelector(".store-hero, .rules-hero")) {
  const heroGraffitiUrl = new URL("../assets/imgs/hero-graffiti-wall-cpx-v36.png", document.baseURI);
  if (["http:", "https:"].includes(window.location.protocol)) {
    let currentVersion = "";
    let checkingVersion = false;
    let checkFailed = false;

    async function refreshHeroGraffiti() {
      if (checkingVersion || document.visibilityState === "hidden") return;
      checkingVersion = true;
      try {
        const response = await fetch(heroGraffitiUrl, { method: "HEAD", cache: "no-store" });
        if (!response.ok) throw new Error(`O servidor respondeu com HTTP ${response.status}.`);
        const version = response.headers.get("etag") || response.headers.get("last-modified");
        if (!version) throw new Error("O servidor não enviou uma versão para a imagem.");

        if (version !== currentVersion) {
          currentVersion = version;
          const currentImageUrl = new URL(heroGraffitiUrl);
          currentImageUrl.searchParams.set("v", version);
          const imageUrl = currentImageUrl.href;
          document.documentElement.style.setProperty("--hero-graffiti-image", `url("${imageUrl}")`);
          if (heroGraffitiImage) heroGraffitiImage.src = imageUrl;
        }
        checkFailed = false;
      } catch (error) {
        if (!checkFailed) console.error("Não foi possível verificar a imagem do hero graffiti.", error);
        checkFailed = true;
      } finally {
        checkingVersion = false;
      }
    }

    refreshHeroGraffiti();
    window.setInterval(refreshHeroGraffiti, 5000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshHeroGraffiti();
    });
  }
}

document.querySelectorAll('[role="tablist"]').forEach((tabList) => {
  const tabs = [...tabList.querySelectorAll('[role="tab"]')];

  function selectTab(selectedTab) {
    for (const tab of tabs) {
      const active = tab === selectedTab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("bg-primary", active);
      tab.classList.toggle("text-white", active);
      tab.classList.toggle("text-fg-secondary", !active);
      tab.classList.toggle("hover:text-fg-primary", !active);
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.hidden = !active;
    }
  }

  tabList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const selectedTab = event.target.closest('[role="tab"]');
    if (selectedTab && tabs.includes(selectedTab)) selectTab(selectedTab);
  });

  tabList.addEventListener("keydown", (event) => {
    const currentTab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (!currentTab || !tabs.includes(currentTab)) return;
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextTab = tabs[(tabs.indexOf(currentTab) + direction + tabs.length) % tabs.length];
    nextTab.focus();
    selectTab(nextTab);
  });
});

document.querySelectorAll('button[aria-label="Copiar resumo do pedido"]').forEach((button) => {
  button.addEventListener("click", async () => {
    const summary = button.querySelector(".font-mono")?.textContent.trim();
    if (!summary) return;

    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(summary);
          copied = true;
        } catch (error) {
          console.warn("Clipboard API unavailable; using the browser copy fallback.", error);
        }
      }

      if (!copied) {
        const field = document.createElement("textarea");
        field.value = summary;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        copied = document.execCommand("copy");
        field.remove();
      }

      let feedback = button.querySelector("[data-copy-feedback]");
      if (!feedback) {
        feedback = document.createElement("span");
        feedback.dataset.copyFeedback = "";
        feedback.setAttribute("role", "status");
        feedback.setAttribute("aria-live", "polite");
        button.append(feedback);
      }
      feedback.textContent = copied ? "Copiado!" : "Não foi possível copiar. Selecione o resumo manualmente.";
      if (!copied) console.error("The browser could not copy the request summary.");
    } catch (error) {
      console.error("Could not copy the request summary.", error);
    }
  });
});
