"use strict";

const adminStatus = document.querySelector("[data-admin-status]");
const productForm = document.querySelector("[data-admin-product-form]");
const productRows = document.querySelector("[data-admin-products]");
const accountProductsDialog = document.querySelector("[data-account-products-dialog]");
const accountProductForm = document.querySelector("[data-account-product-form]");
const accountProductSelect = document.querySelector("[data-account-product-select]");
const accountProductAdd = document.querySelector("[data-account-product-add]");
const accountProductPicker = document.querySelector("[data-account-product-picker]");
const accountProductPickerTrigger = document.querySelector(".admin-product-picker-trigger");
const accountProductPickerLabel = document.querySelector("[data-account-product-select-label]");
const accountProductPickerOptions = document.querySelector(".admin-product-picker-options");
const accountProductList = document.querySelector("[data-account-products-list]");
const accountProductEmpty = document.querySelector("[data-account-products-empty]");
const accountProductStatus = document.querySelector("[data-account-products-status]");
const accountProductHint = document.querySelector("[data-account-product-hint]");
let currentUser = null;
let products = [];
let adminUsers = [];
let selectedAccountId = null;
let adminStatusTimer;

function setAdminStatus(message, variant = "success") {
  window.clearTimeout(adminStatusTimer);
  adminStatus.textContent = message;
  adminStatus.dataset.state = variant;
  adminStatus.hidden = !message;
  if (message) {
    adminStatusTimer = window.setTimeout(() => {
      adminStatus.hidden = true;
    }, 5000);
  }
}

function createAdminTable(container, headings) {
  const wrapper = document.createElement("div");
  wrapper.className = "admin-table-wrap";
  const table = document.createElement("table");
  table.className = "admin-table";
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const heading of headings) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = heading;
    headingRow.append(cell);
  }
  head.append(headingRow);
  const body = document.createElement("tbody");
  table.append(head, body);
  wrapper.append(table);
  container.replaceChildren(wrapper);
  return body;
}

function slugifyProductName(value) {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function addCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function addActionContainer(row) {
  const cell = document.createElement("td");
  cell.className = "admin-table-actions-cell";
  const actions = document.createElement("div");
  actions.className = "admin-table-actions";
  cell.append(actions);
  row.append(cell);
  return actions;
}

function addButton(parent, text, action, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `store-button admin-table-button ${className}`.trim();
  button.textContent = text;
  button.addEventListener("click", action);
  parent.append(button);
  return button;
}

function formField(name) {
  return productForm.elements.namedItem(name);
}

function resetProductForm() {
  productForm.reset();
  document.querySelector("[data-product-form-title]").textContent = "Novo produto";
  formField("originalId").value = "";
  formField("id").value = "";
  formField("id").readOnly = false;
  formField("categoryName").value = "";
  formField("priceLabel").value = "";
  formField("active").checked = true;
  formField("sortOrder").value = "0";
  document.querySelector("[data-download-status]").textContent = "Sem ficheiro ou link de entrega configurado.";
  productForm.hidden = true;
}

function editProduct(product) {
  productForm.hidden = false;
  document.querySelector("[data-product-form-title]").textContent = "Editar produto";
  formField("originalId").value = product.id;
  formField("id").value = product.id;
  formField("id").readOnly = true;
  formField("name").value = product.name;
  formField("category").value = product.category;
  formField("categoryName").value = product.categoryName;
  formField("priceEuros").value = product.priceCents === null ? "" : (product.priceCents / 100).toFixed(2);
  formField("priceLabel").value = product.priceLabel;
  formField("sortOrder").value = product.sortOrder;
  formField("image").value = product.image;
  formField("videoUrl").value = product.videoUrl || "";
  formField("downloadUrl").value = product.downloadUrl || "";
  formField("description").value = product.description;
  formField("details").value = product.details.join("\n");
  formField("imageFile").value = "";
  formField("productFile").value = "";
  formField("featured").checked = product.featured;
  formField("active").checked = product.active;
  document.querySelector("[data-download-status]").textContent = product.downloadAvailable
    ? `Entrega configurada${product.downloadName ? `: ${product.downloadName}` : ""}.`
    : "Sem ficheiro ou link de entrega configurado.";
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderProducts() {
  const empty = document.querySelector("[data-admin-products-empty]");
  empty.hidden = products.length > 0;
  if (!products.length) {
    productRows.replaceChildren();
    return;
  }
  const tbody = createAdminTable(productRows, ["Produto", "Preço", "Estado", "Ações"]);
  for (const product of products) {
    const row = document.createElement("tr");
    const nameCell = addCell(row, "");
    const name = document.createElement("strong");
    name.textContent = product.name;
    const identity = document.createElement("span");
    identity.textContent = product.id;
    nameCell.append(name, identity);
    addCell(row, product.priceLabel);
    addCell(row, product.active ? "Ativo" : "Inativo");
    const actions = addActionContainer(row);
    addButton(actions, "Editar", () => editProduct(product), "admin-action-primary");
    if (product.active) {
      addButton(actions, "Remover", async () => {
        if (!window.confirm(`Desativar o produto "${product.name}"?`)) return;
        try {
          await window.MonarchAPI.request(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
          await loadProducts();
          setAdminStatus("Produto desativado.");
        } catch (error) {
          setAdminStatus(error.message, "error");
        }
      }, "admin-action-danger");
    }
    tbody.append(row);
  }
}

async function loadProducts() {
  products = await window.MonarchAPI.request("/api/admin/products");
  for (const product of products) {
    product.image = window.MonarchAPI.normalizeAssetUrl(product.image);
  }
  document.querySelector("[data-count-products]").textContent = String(products.filter((product) => product.active).length);
  renderProducts();
}

async function uploadImage(file, kind) {
  if (!file || file.size === 0) return null;
  const body = new FormData();
  body.append("image", file);
  const result = await window.MonarchAPI.request(`/api/admin/uploads?kind=${kind}`, { method: "POST", body });
  return result.url;
}

async function uploadProductFile(file) {
  if (!file || file.size === 0) return null;
  const body = new FormData();
  body.append("file", file);
  return window.MonarchAPI.request("/api/admin/product-files", { method: "POST", body });
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = productForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const imageUrl = await uploadImage(formField("imageFile").files[0], "product");
    const productFile = await uploadProductFile(formField("productFile").files[0]);
    const originalId = formField("originalId").value;
    const name = formField("name").value.trim();
    const category = formField("category").value.trim();
    const euros = formField("priceEuros").value;
    const priceCents = euros === "" ? null : Math.round(Number(euros) * 100);
    const product = {
      id: originalId || formField("id").value.trim() || slugifyProductName(name),
      category,
      categoryName: formField("categoryName").value.trim() || category,
      name,
      priceLabel: priceCents === null
        ? formField("priceLabel").value.trim() || "Orçamento sob consulta"
        : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(priceCents / 100),
      priceCents,
      image: imageUrl || formField("image").value.trim(),
      videoUrl: formField("videoUrl").value.trim() || null,
      downloadUrl: formField("downloadUrl").value.trim() || null,
      description: formField("description").value.trim(),
      details: formField("details").value.split(/\r?\n/).map((detail) => detail.trim()).filter(Boolean),
      featured: formField("featured").checked,
      active: formField("active").checked,
      sortOrder: Number(formField("sortOrder").value || 0),
      downloadKey: productFile?.key,
      downloadName: productFile?.name
    };
    await window.MonarchAPI.request(
      originalId ? `/api/admin/products/${encodeURIComponent(originalId)}` : "/api/admin/products",
      { method: originalId ? "PUT" : "POST", body: JSON.stringify(product) }
    );
    resetProductForm();
    await loadProducts();
    setAdminStatus("Produto guardado.");
  } catch (error) {
    console.error("Não foi possível guardar o produto.", error);
    setAdminStatus(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

function openNewProductForm() {
  resetProductForm();
  formField("active").checked = true;
  formField("sortOrder").value = "0";
  productForm.hidden = false;
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll("[data-admin-add-product], [data-admin-empty-add]").forEach((button) => {
  button.addEventListener("click", openNewProductForm);
});
document.querySelectorAll("[data-admin-cancel-product]").forEach((button) => {
  button.addEventListener("click", resetProductForm);
});

function renderOrders(orders) {
  const container = document.querySelector("[data-admin-orders]");
  const empty = document.querySelector("[data-admin-orders-empty]");
  empty.hidden = orders.length > 0;
  if (!orders.length) {
    container.replaceChildren();
    return;
  }
  const tbody = createAdminTable(container, ["Cliente", "Produtos", "Total", "Ações"]);
  for (const order of orders) {
    const row = document.createElement("tr");
    const userCell = addCell(row, "");
    const user = document.createElement("strong");
    user.textContent = order.user.displayName;
    const orderId = document.createElement("span");
    orderId.textContent = `${order.id.slice(0, 8)} · ${order.createdAt}`;
    userCell.append(user, orderId);
    addCell(row, order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "));
    addCell(row, new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(order.totalCents / 100));
    const actions = addActionContainer(row);
    if (order.status === "pending") {
      if (["paypal_me", "manual"].includes(order.paymentMethod)) {
        addButton(actions, "Confirmar pagamento", async () => {
          if (!window.confirm(`Confirmas que recebeste o pagamento da encomenda ${order.id.slice(0, 8)}?`)) return;
          try {
            await window.MonarchAPI.request(`/api/admin/orders/${order.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "paid" })
            });
            await loadOrders();
            setAdminStatus(`Pagamento da encomenda ${order.id.slice(0, 8)} confirmado.`);
          } catch (error) {
            setAdminStatus(error.message, "error");
          }
        }, "admin-action-primary");
      }
      addButton(actions, "Negar pagamento", async () => {
        const action = order.paymentMethod === "manual" ? "Cancelar a encomenda" : "Negar o pagamento";
        if (!window.confirm(`${action} ${order.id.slice(0, 8)}?`)) return;
        try {
          await window.MonarchAPI.request(`/api/admin/orders/${order.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "cancelled" })
          });
          await loadOrders();
          setAdminStatus(`Encomenda ${order.id.slice(0, 8)} cancelada.`);
        } catch (error) {
          setAdminStatus(error.message, "error");
        }
      }, "admin-action-danger");
    } else {
      addCellStatus(actions, order.status === "paid" ? "Pago" : "Cancelado");
      if (order.paymentReference) addCellStatus(actions, `Ref.: ${order.paymentReference}`);
    }
    tbody.append(row);
  }
}

function addCellStatus(parent, text) {
  const label = document.createElement("span");
  label.className = "order-status";
  label.textContent = text;
  parent.append(label);
}

async function loadOrders() {
  const orders = await window.MonarchAPI.request("/api/admin/orders");
  document.querySelector("[data-count-orders]").textContent = String(orders.filter((order) => order.status === "pending").length);
  renderOrders(orders);
}

function renderUsers(users) {
  const container = document.querySelector("[data-admin-users]");
  const empty = document.querySelector("[data-admin-users-empty]");
  empty.hidden = users.length > 0;
  if (!users.length) {
    container.replaceChildren();
    return;
  }
  const tbody = createAdminTable(container, ["Conta", "Acesso", "Estado", "Ações"]);
  for (const user of users) {
    const row = document.createElement("tr");
    const account = addCell(row, "");
    const accountButton = document.createElement("button");
    accountButton.type = "button";
    accountButton.className = "admin-account-open";
    accountButton.setAttribute("aria-haspopup", "dialog");
    accountButton.setAttribute("aria-label", `Gerir produtos de ${user.displayName}`);
    const display = document.createElement("strong");
    display.textContent = user.displayName;
    const id = document.createElement("span");
    id.textContent = user.discordId;
    accountButton.append(display, id);
    accountButton.addEventListener("click", () => openAccountProducts(user.id));
    account.append(accountButton);
    addCell(row, user.role === "super_admin" ? "Fundador" : user.role === "admin" ? "Administrador" : "Cliente");
    addCell(row, user.banned ? "Bloqueada" : "Ativa");
    const actions = addActionContainer(row);
    addButton(actions, `Gerir produtos (${user.accessProducts.length})`, () => openAccountProducts(user.id), "admin-action-primary");
    if (user.role !== "super_admin") {
      if (currentUser.role === "super_admin") {
        const role = document.createElement("select");
        role.className = "admin-role-select";
        role.setAttribute("aria-label", `Cargo de ${user.displayName}`);
        for (const [value, label] of [["customer", "Cliente"], ["admin", "Administrador"]]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          option.selected = user.role === value;
          role.append(option);
        }
        role.addEventListener("change", async () => {
          try {
            await window.MonarchAPI.request(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              body: JSON.stringify({ role: role.value })
            });
            await loadUsers();
            setAdminStatus("Cargo atualizado.");
          } catch (error) {
            setAdminStatus(error.message, "error");
          }
        });
        actions.append(role);
      }
      addButton(actions, user.banned ? "Desbloquear" : "Bloquear", async () => {
        try {
          await window.MonarchAPI.request(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: JSON.stringify({ banned: !user.banned })
          });
          await loadUsers();
          setAdminStatus("Estado da conta atualizado.");
        } catch (error) {
          setAdminStatus(error.message, "error");
        }
      }, user.banned ? "admin-action-primary" : "admin-action-danger");
    }
    tbody.append(row);
  }
}

function setAccountProductsStatus(message, isError = false) {
  accountProductStatus.textContent = message;
  accountProductStatus.hidden = !message;
  accountProductStatus.classList.toggle("is-error", isError);
}

function openAccountProducts(userId) {
  const user = adminUsers.find((item) => item.id === userId);
  if (!user) return;
  selectedAccountId = user.id;
  renderUserProductManager(user);
  setAccountProductsStatus("");
  if (!accountProductsDialog.open) accountProductsDialog.showModal();
}

function renderUserProductManager(user) {
  const title = document.querySelector("[data-account-products-title]");
  const subtitle = document.querySelector("[data-account-products-subtitle]");
  title.textContent = `Produtos de ${user.displayName}`;
  subtitle.textContent = `Discord ID: ${user.discordId}`;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Selecionar produto";
  accountProductSelect.replaceChildren(placeholder);
  accountProductPickerOptions.replaceChildren();
  accountProductPickerLabel.textContent = "Selecionar produto";
  const alreadyAssigned = new Set(user.accessProducts.map((item) => item.productId));
  const activeProducts = products.filter((item) => item.active);
  const availableProducts = activeProducts.filter((item) => !alreadyAssigned.has(item.id));
  for (const product of availableProducts) {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = product.name;
    accountProductSelect.append(option);

    const pickerOption = document.createElement("div");
    pickerOption.className = "admin-product-picker-option";
    pickerOption.dataset.productId = product.id;
    pickerOption.setAttribute("role", "option");
    pickerOption.setAttribute("aria-selected", "false");
    pickerOption.tabIndex = -1;
    pickerOption.textContent = product.name;
    pickerOption.addEventListener("click", () => selectAccountProduct(product.id));
    accountProductPickerOptions.append(pickerOption);
  }
  accountProductSelect.disabled = availableProducts.length === 0;
  accountProductPickerTrigger.disabled = availableProducts.length === 0;
  setAccountProductPickerOpen(false);
  accountProductAdd.disabled = true;
  accountProductHint.hidden = availableProducts.length > 0;
  accountProductHint.textContent = activeProducts.length
    ? "Todos os produtos ativos já estão atribuídos a esta conta."
    : "Não existem produtos ativos para atribuir.";

  accountProductEmpty.hidden = user.accessProducts.length > 0;
  accountProductList.replaceChildren();
  for (const item of user.accessProducts) {
    const entry = document.createElement("div");
    entry.className = "admin-account-product-entry";
    const details = document.createElement("div");
    details.className = "admin-account-product-details";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const sources = [
      item.purchased ? "Comprado" : "",
      item.manuallyAssigned ? "Atribuído manualmente" : "",
      item.active ? "" : "Inativo"
    ].filter(Boolean).join(" · ");
    const meta = document.createElement("span");
    meta.textContent = sources || "Acesso ativo";
    details.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "store-button admin-action-danger";
    remove.textContent = "Remover acesso";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await window.MonarchAPI.request(`/api/admin/users/${user.id}/products/${encodeURIComponent(item.productId)}`, { method: "DELETE" });
        await loadUsers(user.id);
        setAccountProductsStatus(item.purchased
          ? "Acesso removido e produto retirado do histórico desta conta."
          : "Acesso ao produto removido.");
      } catch (error) {
        setAccountProductsStatus(error.message, true);
        remove.disabled = false;
      }
    });
    entry.append(details, remove);
    accountProductList.append(entry);
  }
}

function setAccountProductPickerOpen(open) {
  accountProductPickerTrigger.setAttribute("aria-expanded", String(open));
  accountProductPickerOptions.hidden = !open;
}

function selectAccountProduct(productId) {
  const option = [...accountProductSelect.options].find((item) => item.value === productId);
  if (!option) return;
  accountProductSelect.value = productId;
  accountProductPickerLabel.textContent = option.textContent;
  for (const pickerOption of accountProductPickerOptions.children) {
    const selected = pickerOption.dataset.productId === productId;
    pickerOption.setAttribute("aria-selected", String(selected));
  }
  accountProductAdd.disabled = false;
  setAccountProductPickerOpen(false);
  accountProductPickerTrigger.focus();
}

accountProductPickerTrigger.addEventListener("click", () => {
  setAccountProductPickerOpen(accountProductPickerOptions.hidden);
  if (!accountProductPickerOptions.hidden) {
    const selected = accountProductPickerOptions.querySelector('[aria-selected="true"]');
    (selected || accountProductPickerOptions.firstElementChild)?.focus();
  }
});

accountProductPickerTrigger.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  setAccountProductPickerOpen(true);
  const options = [...accountProductPickerOptions.children];
  (event.key === "ArrowUp" ? options[options.length - 1] : options[0])?.focus();
});

accountProductPickerOptions.addEventListener("keydown", (event) => {
  const options = [...accountProductPickerOptions.children];
  const currentIndex = options.indexOf(event.target);
  if (event.key === "Escape") {
    setAccountProductPickerOpen(false);
    accountProductPickerTrigger.focus();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const offset = event.key === "ArrowDown" ? 1 : -1;
  options[(currentIndex + offset + options.length) % options.length]?.focus();
});

document.addEventListener("click", (event) => {
  if (!accountProductPicker.contains(event.target)) setAccountProductPickerOpen(false);
});
accountProductPicker.addEventListener("focusout", (event) => {
  if (!accountProductPicker.contains(event.relatedTarget)) setAccountProductPickerOpen(false);
});

accountProductForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = adminUsers.find((item) => item.id === selectedAccountId);
  if (!user || !accountProductSelect.value) return;
  accountProductAdd.disabled = true;
  setAccountProductsStatus("A adicionar produto...");
  try {
    await window.MonarchAPI.request(`/api/admin/users/${user.id}/products/${encodeURIComponent(accountProductSelect.value)}`, { method: "PUT" });
    await loadUsers(user.id);
    setAccountProductsStatus("Produto adicionado à conta.");
  } catch (error) {
    setAccountProductsStatus(error.message, true);
    accountProductAdd.disabled = !accountProductSelect.value;
  }
});

document.querySelector("[data-account-products-close]").addEventListener("click", () => accountProductsDialog.close());
accountProductsDialog.addEventListener("click", (event) => {
  if (event.target === accountProductsDialog) accountProductsDialog.close();
});
accountProductsDialog.addEventListener("close", () => {
  selectedAccountId = null;
});

async function loadUsers(selectedUserId = null) {
  adminUsers = await window.MonarchAPI.request("/api/admin/users");
  document.querySelector("[data-count-users]").textContent = String(adminUsers.length);
  renderUsers(adminUsers);
  if (selectedUserId !== null && accountProductsDialog.open) {
    const selectedUser = adminUsers.find((user) => user.id === selectedUserId);
    if (selectedUser) renderUserProductManager(selectedUser);
  }
}

async function uploadBrandImage(file, kind) {
  if (!file) return null;
  return uploadImage(file, kind);
}

const brandingForm = document.querySelector("[data-admin-brand-form]");
const brandPreviewUrls = new Map();
for (const kind of ["logo", "favicon"]) {
  const fileInput = brandingForm.elements.namedItem(`${kind}File`);
  const preview = document.querySelector(`[data-brand-preview="${kind}"]`);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const previousUrl = brandPreviewUrls.get(kind);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const previewUrl = URL.createObjectURL(file);
    brandPreviewUrls.set(kind, previewUrl);
    preview.src = previewUrl;
    preview.hidden = false;
  });
}
brandingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = brandingForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const formData = new FormData(brandingForm);
    const logoUrl = await uploadBrandImage(formData.get("logoFile"), "logo");
    const faviconUrl = await uploadBrandImage(formData.get("faviconFile"), "favicon");
    const settings = {
      siteName: formData.get("siteName").trim(),
      logoUrl: logoUrl || formData.get("logoUrl").trim(),
      faviconUrl: faviconUrl || formData.get("faviconUrl").trim(),
      paypalMethod: formData.get("paypalMethod"),
      paypalEnvironment: formData.get("paypalEnvironment"),
      paypalClientId: formData.get("paypalClientId").trim(),
      paypalClientSecret: formData.get("paypalClientSecret").trim(),
      paypalWebhookId: formData.get("paypalWebhookId").trim(),
      paypalMeUrl: formData.get("paypalMeUrl").trim()
    };
    await window.MonarchAPI.request("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
    document.title = `Admin | ${settings.siteName}`;
    brandingForm.elements.namedItem("paypalClientSecret").value = "";
    brandingForm.elements.namedItem("paypalClientSecret").placeholder = settings.paypalClientId
      ? "Secret armazenado (deixe vazio para manter)"
      : "Introduz para atualizar o secret";
    updatePaypalSettingsFields();
    for (const kind of ["logo", "favicon"]) {
      const preview = document.querySelector(`[data-brand-preview="${kind}"]`);
      preview.src = settings[`${kind}Url`];
      preview.hidden = false;
    }
    setAdminStatus("Identidade visual e forma de pagamento guardadas.");
  } catch (error) {
    console.error("Não foi possível guardar a identidade visual.", error);
    setAdminStatus(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

function updatePaypalSettingsFields() {
  const method = brandingForm.elements.namedItem("paypalMethod").value;
  const checkout = method === "checkout";
  const paypalMe = method === "paypal_me";
  document.querySelectorAll("[data-paypal-checkout-field]").forEach((field) => {
    field.hidden = !checkout;
  });
  document.querySelector("[data-paypal-me-field]").hidden = !paypalMe;
}

brandingForm.elements.namedItem("paypalMethod").addEventListener("change", updatePaypalSettingsFields);

document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const activeTab = tab.dataset.adminTab;
    for (const candidate of document.querySelectorAll("[data-admin-tab]")) {
      const active = candidate === tab;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
    }
    for (const panel of document.querySelectorAll("[data-admin-panel]")) {
      panel.hidden = panel.dataset.adminPanel !== activeTab;
    }
    document.querySelector("[data-admin-page-title]").textContent = tab.dataset.pageTitle;
  });
});

document.querySelector('[role="tablist"][aria-orientation="vertical"]')?.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-admin-tab]")];
  const currentTab = event.target.closest("[data-admin-tab]");
  const currentIndex = tabs.indexOf(currentTab);
  if (currentIndex < 0) return;
  event.preventDefault();
  const offset = event.key === "ArrowDown" ? 1 : -1;
  const nextTab = tabs[(currentIndex + offset + tabs.length) % tabs.length];
  nextTab.focus();
  nextTab.click();
});

document.querySelector("[data-admin-logout]").addEventListener("click", async () => {
  try {
    await window.MonarchAPI.request("/auth/logout", { method: "POST" });
    window.location.replace("/");
  } catch (error) {
    console.error("Não foi possível terminar a sessão.", error);
    setAdminStatus(error.message, "error");
  }
});

window.MonarchAPI.sessionPromise.then(async (session) => {
  currentUser = session.user;
  if (!currentUser) {
    window.location.replace("/auth/discord");
    return;
  }
  if (currentUser.role === "customer") {
    window.location.replace("/conta.html");
    return;
  }
  document.querySelector("[data-admin-welcome]").textContent = `Sessão iniciada como ${currentUser.displayName}.`;
  document.querySelector("[data-admin-sidebar-name]").textContent = currentUser.displayName;
  document.querySelector("[data-admin-sidebar-role]").textContent = currentUser.role === "super_admin"
    ? "Fundador"
    : "Administrador";
  const avatar = document.querySelector("[data-admin-avatar]");
  const avatarFallback = document.querySelector("[data-admin-avatar-fallback]");
  if (currentUser.avatarUrl) {
    avatar.src = currentUser.avatarUrl;
    avatar.hidden = false;
    avatarFallback.hidden = true;
    avatar.addEventListener("error", () => {
      avatar.hidden = true;
      avatarFallback.hidden = false;
    }, { once: true });
  }
  document.querySelector("[data-admin-state]").hidden = true;
  document.querySelector("[data-admin-content]").hidden = false;
  const tasks = [loadProducts(), loadOrders()];
  const settingsRestricted = document.querySelector("[data-admin-settings-restricted]");
  brandingForm.hidden = currentUser.role !== "super_admin";
  settingsRestricted.hidden = currentUser.role === "super_admin";
  if (currentUser.role === "super_admin") {
    const settings = await window.MonarchAPI.request("/api/admin/settings");
    settings.logoUrl = window.MonarchAPI.normalizeAssetUrl(settings.logoUrl);
    settings.faviconUrl = window.MonarchAPI.normalizeAssetUrl(settings.faviconUrl);
    for (const key of ["siteName", "logoUrl", "faviconUrl", "paypalMethod", "paypalEnvironment", "paypalClientId", "paypalMeUrl", "paypalWebhookId"]) {
      brandingForm.elements.namedItem(key).value = settings[key] || "";
    }
    updatePaypalSettingsFields();
    brandingForm.elements.namedItem("paypalClientSecret").placeholder = settings.paypalHasSecret
      ? "Secret armazenado (deixe vazio para manter)"
      : "Introduz o Client Secret";
    for (const kind of ["logo", "favicon"]) {
      const preview = document.querySelector(`[data-brand-preview="${kind}"]`);
      preview.src = settings[`${kind}Url`];
      preview.hidden = false;
    }
  }
  await Promise.all(tasks);
  await loadUsers();
}).catch((error) => {
  console.error("Não foi possível carregar o painel administrativo.", error);
  setAdminStatus(error.message, "error");
});
