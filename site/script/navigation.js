"use strict";

const headerPlaceholder = document.querySelector("[data-site-header]");

if (headerPlaceholder) {
  const links = [
    { label: "Início", page: "inicio", href: "./Monarch.html#inicio", icon: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="m3 10 9-8 9 8v9a2 2 0 0 1-2 2h-4v-8H9v8H5a2 2 0 0 1-2-2z"></path>' },
    { label: "Loja", page: "loja", href: "./loja.html", icon: '<path d="m2 3 2 1 2.5 12h12l3-9H5"></path><circle cx="9" cy="20" r="1"></circle><circle cx="18" cy="20" r="1"></circle>' },
    { label: "Sobre", page: "sobre", href: "./Monarch.html#sobre", icon: '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>' },
    { label: "Suporte", page: "regras", href: "./regras.html", icon: '<path d="M12 18h.01"></path><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"></path><circle cx="12" cy="12" r="10"></circle>' }
  ];
  const page = document.body.dataset.page;
  const header = document.createElement("header");
  header.className = "local-header";
  const nav = document.createElement("nav");
  nav.className = "local-nav";
  nav.setAttribute("aria-label", "Navegação principal");

  const brand = document.createElement("a");
  brand.className = "local-brand";
  brand.href = page === "inicio" ? "#inicio" : "./Monarch.html#inicio";
  brand.setAttribute("aria-label", "Monarch Store - Início");
  brand.dataset.siteBrand = "";
  const logo = document.createElement("img");
  logo.src = "../assets/imgs/logomonarch.png";
  logo.alt = "Monarch Store";
  logo.dataset.siteLogo = "";
  brand.append(logo);
  nav.append(brand);

  const list = document.createElement("ul");
  list.className = "local-nav-links";
  for (const item of links) {
    const listItem = document.createElement("li");
    const link = document.createElement("a");
    link.className = "nav-category";
    link.href = page === "inicio" ? item.href.replace("./Monarch.html", "") : item.href;
    link.dataset.navPage = item.page;
    link.textContent = item.label;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("nav-glyph");
    icon.innerHTML = item.icon;
    link.prepend(icon);

    listItem.append(link);
    list.append(listItem);
  }

  const accountItem = document.createElement("li");
  accountItem.className = "account-nav-item";
  const accountLink = document.createElement("a");
  accountLink.className = "nav-category";
  accountLink.href = "/auth/discord";
  accountLink.dataset.authLink = "";
  accountLink.dataset.authLabel = "";
  accountLink.textContent = "Entrar";
  accountItem.append(accountLink);
  list.append(accountItem);

  const adminItem = document.createElement("li");
  adminItem.className = "admin-nav-item";
  const adminLink = document.createElement("a");
  adminLink.className = "nav-category";
  adminLink.href = "/admin.html";
  adminLink.textContent = "Painel admin";
  adminItem.append(adminLink);

  const mobileLogoutItem = document.createElement("li");
  mobileLogoutItem.className = "admin-nav-item";
  const mobileLogoutButton = document.createElement("button");
  mobileLogoutButton.type = "button";
  mobileLogoutButton.className = "nav-category nav-category-button";
  mobileLogoutButton.textContent = "Sair";
  mobileLogoutItem.append(mobileLogoutButton);

  window.MonarchAPI.sessionPromise.then((session) => {
    if (session.user && session.user.role !== "customer") {
      list.append(adminItem, mobileLogoutItem);
    }
    accountLink.href = session.user ? "/conta.html" : "/auth/discord";
    const displayName = session.user?.displayName?.trim();
    accountLink.textContent = session.user ? `Conta: ${displayName || "Utilizador"}` : "Entrar";
    accountLink.setAttribute(
      "aria-label",
      session.user ? `Abrir a conta de ${displayName || "Utilizador"}` : "Entrar com Discord"
    );
    if (session.user && session.user.role === "customer") list.append(mobileLogoutItem);
  }).catch((error) => console.error("Não foi possível carregar os acessos da conta.", error));

  function setActivePage(activePage, isSection = false) {
    for (const link of list.querySelectorAll(".nav-category")) {
      const active = link.dataset.navPage === activePage;
      link.classList.toggle("is-current", active);
      link.querySelector(".nav-current-bg")?.remove();
      link.removeAttribute("aria-current");
      if (!active) continue;

      const activeBackground = document.createElement("span");
      activeBackground.className = "nav-current-bg";
      activeBackground.setAttribute("aria-hidden", "true");
      link.prepend(activeBackground);
      link.setAttribute("aria-current", isSection ? "location" : "page");
    }
  }

  const currentPage = page === "produto" ? "loja" : page === "termos" ? "regras" : page;
  setActivePage(currentPage);
  if (page === "inicio") {
    const aboutSection = document.querySelector("#sobre");
    if (aboutSection) {
      list.querySelector('[data-nav-page="inicio"]').addEventListener("click", () => {
        setActivePage("inicio");
      });
      list.querySelector('[data-nav-page="sobre"]').addEventListener("click", () => {
        setActivePage("sobre", true);
      });
      const updateHomeActivePage = () => {
        const activeLine = window.innerHeight * 0.42;
        const aboutBounds = aboutSection.getBoundingClientRect();
        const isAboutActive = aboutBounds.top <= activeLine && aboutBounds.bottom > activeLine;
        setActivePage(isAboutActive ? "sobre" : "inicio", isAboutActive);
      };
      window.addEventListener("scroll", updateHomeActivePage, { passive: true });
      window.addEventListener("resize", updateHomeActivePage);
      window.addEventListener("hashchange", updateHomeActivePage);
      window.addEventListener("pageshow", updateHomeActivePage);
      requestAnimationFrame(updateHomeActivePage);
    }
  }

  nav.append(list);

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "nav-menu-trigger";
  menuButton.setAttribute("aria-label", "Abrir menu");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"></path></svg>';
  nav.append(menuButton);
  header.append(nav);

  const authMenu = document.createElement("div");
  authMenu.className = "auth-menu";
  const desktopAccountLink = document.createElement("a");
  desktopAccountLink.className = "auth-entry";
  desktopAccountLink.href = "/auth/discord";
  desktopAccountLink.textContent = "Entrar";
  desktopAccountLink.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.07.07 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.07.07 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.08.08 0 0 0 .084-.027 14 14 0 0 0 1.226-1.994.07.07 0 0 0-.041-.104 13.1 13.1 0 0 1-1.872-.892.07.07 0 0 1-.008-.117c.126-.094.252-.192.372-.291a.07.07 0 0 1 .074-.01c3.928 1.793 8.18 1.793 12.062 0a.07.07 0 0 1 .075.009c.12.098.246.198.373.292a.07.07 0 0 1-.006.117 12.3 12.3 0 0 1-1.873.891.07.07 0 0 0-.041.105c.36.698.772 1.362 1.225 1.993a.08.08 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.08.08 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"></path></svg><span>Entrar</span>';
  const profileButton = document.createElement("button");
  profileButton.type = "button";
  profileButton.className = "profile-trigger";
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.setAttribute("aria-label", "Abrir menu da conta");
  profileButton.hidden = true;
  const avatar = document.createElement("img");
  avatar.className = "profile-avatar";
  avatar.alt = "";
  avatar.hidden = true;
  const avatarFallback = document.createElement("span");
  avatarFallback.className = "profile-avatar-fallback";
  avatarFallback.setAttribute("aria-hidden", "true");
  avatarFallback.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>';
  const profileName = document.createElement("span");
  profileName.className = "profile-name";
  const profileCaret = document.createElement("span");
  profileCaret.className = "profile-caret";
  profileCaret.setAttribute("aria-hidden", "true");
  profileCaret.textContent = "⌄";
  profileButton.append(avatar, avatarFallback, profileName, profileCaret);

  const profileMenu = document.createElement("div");
  profileMenu.className = "profile-dropdown";
  profileMenu.hidden = true;
  const clientLink = document.createElement("a");
  clientLink.href = "/conta.html";
  clientLink.textContent = "Área Cliente";
  const adminPanelLink = document.createElement("a");
  adminPanelLink.href = "/admin.html";
  adminPanelLink.textContent = "Área Admin";
  adminPanelLink.hidden = true;
  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.textContent = "Sair";
  profileMenu.append(clientLink, adminPanelLink, logoutButton);
  authMenu.append(desktopAccountLink, profileButton, profileMenu);

  window.MonarchAPI.sessionPromise.then((session) => {
    if (!session.user) return;
    desktopAccountLink.hidden = true;
    profileButton.hidden = false;
    profileName.textContent = session.user.displayName;
    profileButton.setAttribute("aria-label", `Menu da conta ${session.user.displayName}`);
    if (session.user.avatarUrl) {
      avatar.src = session.user.avatarUrl;
      avatar.hidden = false;
      avatarFallback.hidden = true;
      avatar.addEventListener("error", () => {
        avatar.hidden = true;
        avatarFallback.hidden = false;
      }, { once: true });
    }
    if (session.user.role !== "customer") adminPanelLink.hidden = false;
  }).catch((error) => console.error("Não foi possível carregar o acesso à conta.", error));
  header.append(authMenu);
  headerPlaceholder.replaceWith(header);

  function closeProfileMenu() {
    profileMenu.hidden = true;
    profileButton.setAttribute("aria-expanded", "false");
  }

  profileButton.addEventListener("click", () => {
    const opening = profileMenu.hidden;
    profileMenu.hidden = !opening;
    profileButton.setAttribute("aria-expanded", String(opening));
  });
  function openProfileMenu() {
    if (profileButton.hidden) return;
    profileMenu.hidden = false;
    profileButton.setAttribute("aria-expanded", "true");
  }

  authMenu.addEventListener("mouseenter", openProfileMenu);
  authMenu.addEventListener("mouseleave", closeProfileMenu);
  authMenu.addEventListener("focusin", openProfileMenu);
  authMenu.addEventListener("focusout", (event) => {
    if (!authMenu.contains(event.relatedTarget)) closeProfileMenu();
  });
  logoutButton.addEventListener("click", async () => {
    try {
      await window.MonarchAPI.request("/auth/logout", { method: "POST" });
      window.location.assign("/");
    } catch (error) {
      console.error("Não foi possível terminar a sessão.", error);
    }
  });
  mobileLogoutButton.addEventListener("click", async () => {
    try {
      await window.MonarchAPI.request("/auth/logout", { method: "POST" });
      window.location.assign("/");
    } catch (error) {
      console.error("Não foi possível terminar a sessão.", error);
    }
  });

  function closeMenu() {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Abrir menu");
    list.classList.remove("is-open");
    header.classList.remove("mobile-menu-open");
  }

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Fechar menu" : "Abrir menu");
    list.classList.toggle("is-open", isOpen);
    header.classList.toggle("mobile-menu-open", isOpen);
  });
  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1024px)").matches) closeMenu();
  });
  list.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, [data-open-cart]")) closeMenu();
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !header.contains(event.target)) {
      closeMenu();
      closeProfileMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      closeProfileMenu();
    }
  });
}

const pageFooter = document.querySelector("footer");
if (pageFooter) {
  const footer = document.createElement("footer");
  footer.className = "shared-footer";

  const main = document.createElement("div");
  main.className = "shared-footer-main";
  const brand = document.createElement("div");
  brand.className = "shared-footer-brand";
  const brandLink = document.createElement("a");
  brandLink.href = "./Monarch.html#inicio";
  brandLink.setAttribute("aria-label", "Monarch Store - Início");
  brandLink.dataset.siteBrand = "";
  const brandImage = document.createElement("img");
  brandImage.src = "../assets/imgs/logomonarch.png";
  brandImage.alt = "Monarch Store";
  brandImage.dataset.siteLogo = "";
  brandLink.append(brandImage);
  const description = document.createElement("p");
  description.textContent = "Scripts para MTA:SA, bots para Discord e desenvolvimento personalizado.";
  brand.append(brandLink, description);

  const footerNav = document.createElement("nav");
  footerNav.className = "shared-footer-links";
  footerNav.setAttribute("aria-label", "Navegação do rodapé");
  const footerLinks = [
    ["Início", "./Monarch.html#inicio"],
    ["Loja", "./loja.html"],
    ["Sobre", "./Monarch.html#sobre"],
    ["Suporte", "./regras.html"],
    ["Entrar", "/auth/discord"],
    ["Discord", "https://discord.gg/BCyb4UcTR"]
  ];
  for (const [label, href] of footerLinks) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    if (href.startsWith("https:")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    if (label === "Entrar") {
      link.dataset.authLink = "";
      link.dataset.authLabel = "";
    }
    footerNav.append(link);
  }
  main.append(brand, footerNav);

  const bottom = document.createElement("div");
  bottom.className = "shared-footer-bottom";
  const copyright = document.createElement("span");
  copyright.textContent = `© ${new Date().getFullYear()} Monarch Store`;
  copyright.dataset.brandingCopyright = "";
  bottom.append(copyright);
  footer.append(main, bottom);
  pageFooter.replaceWith(footer);
}