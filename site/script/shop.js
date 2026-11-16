"use strict";

const CART_STORAGE_KEY = "monarch-store-cart-v1";
const DISCORD_INVITE = "https://discord.gg/BCyb4UcTR";
let products = [];
const productsById = new Map();
const cart = new Map();
let cartMessage = "";
let cartClosing = false;

const cartDialog = document.createElement("dialog");
cartDialog.className = "store-dialog cart-dialog";
cartDialog.setAttribute("aria-labelledby", "cart-title");
cartDialog.innerHTML = `
  <div class="dialog-heading">
    <div>
      <p class="store-eyebrow">O TEU PEDIDO</p>
      <h2 id="cart-title">Carrinho</h2>
      <p class="cart-subtitle">Itens guardados neste navegador</p>
    </div>
    <button class="dialog-close" type="button" data-close-dialog aria-label="Fechar carrinho">×</button>
  </div>
  <p class="cart-status" data-cart-status role="status" aria-live="polite" hidden></p>
  <div class="cart-items" data-cart-items></div>
  <div class="cart-empty" data-cart-empty>
    <span class="cart-empty-icon" aria-hidden="true">▣</span>
    <p>O teu carrinho está vazio.</p>
    <a class="store-button" href="./loja.html">Explorar a loja</a>
  </div>
  <div class="cart-summary">
    <span>Itens no carrinho</span>
    <strong data-cart-total>0</strong>
  </div>
  <button class="store-button store-button-primary" type="button" data-checkout>Continuar para pagamento</button>
  <a class="store-button cart-discord-link" data-checkout-link target="_blank" rel="noopener noreferrer" hidden>Concluir pagamento</a>
  <a class="store-button cart-discord-link" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">Pedir orçamento no Discord</a>
`;
document.body.append(cartDialog);

function openCart() {
  if (cartClosing || cartDialog.open) return;
  cartDialog.showModal();
}

function closeCart() {
  if (!cartDialog.open || cartClosing) return;
  cartClosing = true;
  cartDialog.classList.add("is-closing");
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
  window.setTimeout(() => {
    cartDialog.close();
    cartDialog.classList.remove("is-closing");
    cartClosing = false;
  }, duration);
}

function showProductError(message) {
  console.error(message);
  const error = document.querySelector("[data-product-error]");
  if (error) {
    error.hidden = false;
    error.textContent = message;
    const content = document.querySelector("[data-product-content]");
    if (content) content.hidden = true;
  }
  const empty = document.querySelector("[data-catalog-empty]");
  if (empty) {
    empty.hidden = false;
    empty.textContent = message;
  }
}

function setCartMessage(message) {
  cartMessage = message;
  const status = cartDialog.querySelector("[data-cart-status]");
  status.textContent = cartMessage;
  status.hidden = !cartMessage;
}

function loadCart() {
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored === null) return;

    const entries = JSON.parse(stored);
    if (!Array.isArray(entries) || entries.some((entry) =>
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !productsById.has(entry[0]) ||
      productsById.get(entry[0]).priceCents === null ||
      !Number.isSafeInteger(entry[1]) ||
      entry[1] < 1 ||
      entry[1] > 20
    )) {
      throw new TypeError("O carrinho guardado contém dados inválidos.");
    }

    for (const [id, quantity] of entries) cart.set(id, quantity);
  } catch (error) {
    console.error("Não foi possível restaurar o carrinho guardado.", error);
    setCartMessage("Não foi possível ler o carrinho guardado. Podes adicionar os itens novamente.");
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([...cart]));
    setCartMessage("");
  } catch (error) {
    console.error("Não foi possível guardar o carrinho neste navegador.", error);
    setCartMessage("O carrinho funciona nesta sessão, mas não pôde ser guardado neste navegador.");
  }
}

function renderCart() {
  const items = cartDialog.querySelector("[data-cart-items]");
  const empty = cartDialog.querySelector("[data-cart-empty]");
  const total = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);

  items.replaceChildren();
  document.querySelectorAll("[data-cart-count]").forEach((count) => {
    count.textContent = String(total);
    count.closest("[data-open-cart]")?.setAttribute(
      "aria-label",
      `Abrir carrinho, ${total} ${total === 1 ? "item" : "itens"}`
    );
  });

  for (const [id, quantity] of cart) {
    const product = productsById.get(id);
    if (!product) continue;

    const item = document.createElement("article");
    item.className = "cart-item";
    const image = document.createElement("img");
    image.className = "cart-item-image";
    image.src = product.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      console.error(`Não foi possível carregar a imagem do produto ${product.id} no carrinho.`);
    }, { once: true });

    const details = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = product.name;
    const price = document.createElement("p");
    price.textContent = product.priceLabel;
    const controls = document.createElement("div");
    controls.className = "cart-quantity";

    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.className = "quantity-button";
    decrease.textContent = "−";
    decrease.setAttribute("aria-label", `Diminuir quantidade de ${product.name}`);
    decrease.addEventListener("click", () => changeQuantity(id, -1));

    const quantityLabel = document.createElement("span");
    quantityLabel.textContent = String(quantity);
    quantityLabel.setAttribute("aria-label", `Quantidade: ${quantity}`);

    const increase = document.createElement("button");
    increase.type = "button";
    increase.className = "quantity-button";
    increase.textContent = "+";
    increase.setAttribute("aria-label", `Aumentar quantidade de ${product.name}`);
    increase.addEventListener("click", () => changeQuantity(id, 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cart-remove";
    remove.textContent = "Remover";
    remove.setAttribute("aria-label", `Remover ${product.name} do carrinho`);
    remove.addEventListener("click", () => {
      cart.delete(id);
      saveCart();
      renderCart();
    });

    controls.append(decrease, quantityLabel, increase, remove);
    details.append(name, price, controls);
    const count = document.createElement("strong");
    count.textContent = `×${quantity}`;
    item.append(image, details, count);
    items.append(item);
  }

  empty.hidden = cart.size > 0;
  cartDialog.querySelector("[data-cart-total]").textContent = String(total);
  cartDialog.querySelector("[data-checkout]").disabled = total === 0;
  setCartMessage(cartMessage);
}

function changeQuantity(id, adjustment) {
  const nextQuantity = (cart.get(id) ?? 0) + adjustment;
  if (nextQuantity < 1) cart.delete(id);
  else cart.set(id, nextQuantity);
  saveCart();
  renderCart();
}

function addToCart(product) {
  const quantity = (cart.get(product.id) ?? 0) + 1;
  if (quantity > 20) {
    setCartMessage("A quantidade máxima por produto é 20.");
    openCart();
    return;
  }
  cart.set(product.id, quantity);
  saveCart();
  renderCart();
  openCart();
}

function renderProductCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";

  const imageFrame = document.createElement("div");
  imageFrame.className = "product-image-frame";
  const imageLink = document.createElement("a");
  imageLink.className = "product-preview-button";
  imageLink.href = `./produto.html?produto=${encodeURIComponent(product.id)}`;
  imageLink.setAttribute("aria-label", `Ver detalhes de ${product.name}`);
  const image = document.createElement("img");
  image.src = product.image;
  image.alt = product.name;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    console.error(`Não foi possível carregar a imagem do produto ${product.id}.`);
    imageFrame.classList.add("image-unavailable");
    image.alt = `Imagem indisponível: ${product.name}`;
  }, { once: true });
  imageLink.append(image);
  imageFrame.append(imageLink);

  const details = document.createElement("div");
  details.className = "product-details";
  const category = document.createElement("p");
  category.className = "product-category";
  category.textContent = product.categoryName;
  const heading = document.createElement("h3");
  const nameLink = document.createElement("a");
  nameLink.className = "product-name-link";
  nameLink.href = imageLink.href;
  nameLink.textContent = product.name;
  heading.append(nameLink);
  const summary = document.createElement("p");
  summary.className = "product-summary";
  summary.textContent = product.description;
  const price = document.createElement("div");
  price.className = "product-prices";
  const priceLabel = document.createElement("strong");
  priceLabel.textContent = product.priceLabel;
  price.append(priceLabel);
  if (product.priceCents === null) {
    const quoteLink = document.createElement("a");
    quoteLink.className = "store-button store-button-primary";
    quoteLink.href = DISCORD_INVITE;
    quoteLink.target = "_blank";
    quoteLink.rel = "noopener noreferrer";
    quoteLink.textContent = "Pedir orçamento";
    details.append(category, heading, summary, price, quoteLink);
  } else {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "store-button store-button-primary";
    addButton.textContent = "Adicionar ao carrinho";
    addButton.addEventListener("click", () => addToCart(product));
    details.append(category, heading, summary, price, addButton);
  }
  card.append(imageFrame, details);
  return card;
}

function renderProductDetails(product) {
  document.querySelectorAll("[data-product-category]").forEach((label) => {
    label.textContent = product.categoryName;
  });
  document.querySelector("[data-product-title]").textContent = product.name;
  const image = document.querySelector("[data-product-image]");
  image.src = product.image;
  image.alt = product.name;
  image.addEventListener("error", () => {
    console.error(`Não foi possível carregar a imagem do produto ${product.id}.`);
  }, { once: true });
  document.querySelector("[data-product-price]").textContent = product.priceLabel;
  document.querySelector("[data-product-description]").textContent = product.description;
  const videoLink = document.querySelector("[data-product-video]");
  if (product.videoUrl) {
    videoLink.href = product.videoUrl;
    videoLink.hidden = false;
  }

  const details = document.querySelector("[data-product-details]");
  details.replaceChildren();
  for (const text of product.details) {
    const item = document.createElement("li");
    item.textContent = text;
    details.append(item);
  }

  const addButton = document.querySelector("[data-product-add]");
  if (product.priceCents === null) {
    addButton.textContent = "Pedir orçamento no Discord";
    addButton.addEventListener("click", () => window.open(DISCORD_INVITE, "_blank", "noopener,noreferrer"));
  } else {
    addButton.addEventListener("click", () => addToCart(product));
  }
}

function initializeCart() {
  document.querySelectorAll("[data-open-cart]").forEach((button) => {
    button.addEventListener("click", openCart);
  });
  cartDialog.querySelector("[data-close-dialog]").addEventListener("click", closeCart);
  cartDialog.addEventListener("click", (event) => {
    if (event.target === cartDialog) closeCart();
  });
  cartDialog.addEventListener("cancel", (event) => event.preventDefault());
  cartDialog.querySelector("[data-checkout]").addEventListener("click", async () => {
    const checkoutButton = cartDialog.querySelector("[data-checkout]");
    const checkoutLink = cartDialog.querySelector("[data-checkout-link]");
    checkoutButton.disabled = true;
    checkoutLink.hidden = true;
    setCartMessage("A criar o pedido...");
    try {
      const session = await window.MonarchAPI.sessionPromise;
      if (!session.user) {
        window.location.href = "/auth/discord";
        return;
      }
      const result = await window.MonarchAPI.request("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: [...cart].map(([productId, quantity]) => ({ productId, quantity }))
        })
      });
      cart.clear();
      saveCart();
      renderCart();
      const manualOrder = result.order.paymentMethod === "manual";
      const manualPaypalMe = result.order.paymentMethod === "paypal_me";
      if (manualOrder) {
        const total = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" })
          .format(result.order.totalCents / 100);
        setCartMessage(`Pedido ${result.order.id.slice(0, 8)} criado (${total}). Para concluir o pagamento, abre um ticket no Discord e indica o número do pedido.`);
        checkoutLink.href = DISCORD_INVITE;
        checkoutLink.textContent = "Abrir ticket no Discord";
      } else {
        setCartMessage(manualPaypalMe
          ? `Pedido ${result.order.id.slice(0, 8)} criado. Paga pelo PayPal.me e aguarda a confirmação da equipa.`
          : `Pedido ${result.order.id.slice(0, 8)} criado. Continua para concluir o pagamento.`);
        checkoutLink.href = result.order.paymentUrl;
        checkoutLink.textContent = manualPaypalMe ? "Pagar pelo PayPal.me" : "Concluir pagamento";
      }
      checkoutLink.hidden = false;
      checkoutLink.focus();
    } catch (error) {
      console.error("Não foi possível criar o pedido.", error);
      setCartMessage(error.message);
    } finally {
      checkoutButton.disabled = cart.size === 0;
    }
  });
}

window.CPX_PRODUCTS_READY.then((loadedProducts) => {
  products = loadedProducts;
  for (const product of products) productsById.set(product.id, product);
  initializeCart();
  loadCart();
  renderCart();
  const productGrid = document.querySelector("[data-product-grid]");
  if (productGrid) {
    const featuredOnly = productGrid.hasAttribute("data-featured-products");
    const visibleProducts = featuredOnly
      ? products.filter((product) => product.featured).slice(0, 3)
      : products;
    productGrid.classList.toggle("product-grid--single", visibleProducts.length === 1);
    productGrid.replaceChildren(...visibleProducts.map(renderProductCard));
    const count = document.querySelector("[data-result-count]");
    if (count) {
      count.textContent = featuredOnly
        ? `${visibleProducts.length} ${visibleProducts.length === 1 ? "produto" : "produtos"} em destaque`
        : `${visibleProducts.length} ${visibleProducts.length === 1 ? "produto" : "produtos"}`;
    }
    const empty = document.querySelector("[data-catalog-empty]");
    if (empty) {
      empty.hidden = visibleProducts.length > 0;
      if (featuredOnly && visibleProducts.length === 0) {
        empty.textContent = "Ainda não há produtos em destaque.";
      }
    }
  }

  if (document.querySelector("#product-page")) {
    const requestedId = new URLSearchParams(window.location.search).get("produto");
    const product = products.find((item) => item.id === requestedId);
    if (!product) {
      showProductError("Este produto não está disponível no catálogo.");
    } else {
      renderProductDetails(product);
    }
  }
}).catch((error) => {
  console.error("Não foi possível carregar o catálogo.", error);
  showProductError("Não foi possível carregar o catálogo. Tenta novamente mais tarde.");
  initializeCart();
  renderCart();
});
