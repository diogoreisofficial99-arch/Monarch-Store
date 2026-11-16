"use strict";

const accountStatus = document.querySelector("[data-account-status]");
const DISCORD_INVITE = "https://discord.gg/BCyb4UcTR";

function formatPrice(cents) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function appendText(parent, tagName, text, className = "") {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function renderOrders(orders) {
  const list = document.querySelector("[data-account-orders]");
  const empty = document.querySelector("[data-orders-empty]");
  list.replaceChildren();
  empty.hidden = orders.length > 0;
  for (const order of orders) {
    const card = document.createElement("article");
    card.className = "account-order-card";
    const heading = document.createElement("div");
    appendText(heading, "strong", `Pedido ${order.id.slice(0, 8)}`);
    const date = new Date(order.createdAt);
    appendText(heading, "span", Number.isNaN(date.getTime()) ? order.createdAt : date.toLocaleString("pt-PT"));
    card.append(heading);
    appendText(card, "p", order.items.map((item) => `${item.name} × ${item.quantity}`).join(" · "));
    const footer = document.createElement("div");
    appendText(footer, "strong", formatPrice(order.totalCents));
    appendText(footer, "span", order.status === "paid" ? "Pago" : order.status === "cancelled" ? "Cancelado" : "Pendente", `order-status order-status-${order.status}`);
    card.append(footer);
    if (order.status === "pending") {
      const paymentLink = document.createElement("a");
      paymentLink.className = "account-payment-link";
      const manualOrder = order.paymentMethod === "manual";
      paymentLink.href = manualOrder ? DISCORD_INVITE : order.paymentUrl;
      paymentLink.target = "_blank";
      paymentLink.rel = "noopener noreferrer";
      paymentLink.textContent = manualOrder
        ? "Abrir ticket no Discord para concluir o pagamento"
        : order.paymentMethod === "paypal_me" ? "Abrir pagamento PayPal.me" : "Abrir pagamento PayPal";
      card.append(paymentLink);
    }
    list.append(card);
  }
}

function renderPurchasedProducts(items) {
  const products = document.querySelector("[data-purchased-products]");
  const empty = document.querySelector("[data-purchased-empty]");
  products.replaceChildren();
  empty.hidden = items.length > 0;
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "account-product-card";
    const image = document.createElement("img");
    image.src = window.MonarchAPI.normalizeAssetUrl(item.image);
    image.alt = "";
    image.loading = "lazy";
    card.append(image);
    appendText(card, "h3", item.name);
    const acquired = new Date(item.acquiredAt);
    appendText(card, "p", item.manuallyAssigned ? "Acesso atribuído pela administração" : "Produto disponível na tua conta");
    if (!Number.isNaN(acquired.getTime())) {
      appendText(card, "p", `Disponível desde ${acquired.toLocaleDateString("pt-PT")}`);
    }
    const download = item.downloadAvailable
      ? document.createElement("a")
      : document.createElement("button");
    download.className = "account-payment-link account-download-button";
    download.textContent = "Descarregar produto";
    if (item.downloadAvailable) {
      download.href = `/api/customer/products/${encodeURIComponent(item.id)}/download`;
    } else {
      download.type = "button";
      download.addEventListener("click", () => {
        if (card.querySelector("[data-download-error]")) return;
        const message = document.createElement("p");
        message.className = "account-download-error";
        message.dataset.downloadError = "";
        message.setAttribute("role", "alert");
        message.append("Não foi possível descarregar este produto. Abre um ");
        const supportLink = document.createElement("a");
        supportLink.href = DISCORD_INVITE;
        supportLink.target = "_blank";
        supportLink.rel = "noopener noreferrer";
        supportLink.textContent = "ticket no Discord";
        message.append(supportLink, " para obter ajuda.");
        card.append(message);
      });
    }
    card.append(download);
    products.append(card);
  }
}

const accountTabs = [...document.querySelectorAll("[data-account-tab]")];
for (const tab of accountTabs) {
  tab.addEventListener("click", () => selectAccountTab(tab));
}

function selectAccountTab(selectedTab) {
  for (const tab of accountTabs) {
    const active = tab === selectedTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (panel) panel.hidden = !active;
  }
}

document.querySelector('[role="tablist"][aria-orientation="vertical"]')?.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const currentTab = event.target.closest("[data-account-tab]");
  const currentIndex = accountTabs.indexOf(currentTab);
  if (currentIndex < 0) return;
  event.preventDefault();
  const offset = event.key === "ArrowDown" ? 1 : -1;
  const nextTab = accountTabs[(currentIndex + offset + accountTabs.length) % accountTabs.length];
  nextTab.focus();
  selectAccountTab(nextTab);
});

window.MonarchAPI.sessionPromise.then(async (session) => {
  if (!session.user) {
    window.location.replace("/auth/discord");
    return;
  }
  document.querySelector("[data-account-welcome]").textContent = `Olá, ${session.user.displayName}.`;
  document.querySelectorAll("[data-account-sidebar-name]").forEach((element) => {
    element.textContent = session.user.displayName;
  });
  document.querySelectorAll("[data-account-profile-name]").forEach((element) => {
    element.textContent = session.user.displayName;
  });
  if (session.user.avatarUrl) {
    document.querySelectorAll("[data-account-avatar]").forEach((image) => {
      image.src = session.user.avatarUrl;
      image.hidden = false;
      image.addEventListener("error", () => {
        image.hidden = true;
        const fallback = image.parentElement.querySelector("[data-account-avatar-fallback], [data-account-profile-fallback]");
        if (fallback) fallback.hidden = false;
      }, { once: true });
    });
    document.querySelectorAll("[data-account-avatar-fallback], [data-account-profile-fallback]").forEach((fallback) => {
      fallback.hidden = true;
    });
  }
  const [result, products] = await Promise.all([
    window.MonarchAPI.request("/api/customer/orders"),
    window.MonarchAPI.request("/api/customer/products")
  ]);
  renderOrders(result.orders);
  renderPurchasedProducts(products);
}).catch((error) => {
  console.error("Não foi possível carregar a área cliente.", error);
  accountStatus.textContent = error.message || "Não foi possível carregar a tua conta.";
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    await window.MonarchAPI.request("/auth/logout", { method: "POST" });
    window.location.replace("/auth/discord");
  } catch (error) {
    console.error("Não foi possível terminar a sessão.", error);
    accountStatus.textContent = error.message;
  }
});
