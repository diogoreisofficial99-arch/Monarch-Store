"use strict";

window.CPX_PRODUCTS_READY = window.MonarchAPI.request("/api/products").then((products) => {
  if (!Array.isArray(products) || products.some((product) =>
    !product ||
    typeof product.id !== "string" ||
    typeof product.categoryName !== "string" ||
    typeof product.name !== "string" ||
    typeof product.priceLabel !== "string" ||
    typeof product.image !== "string" ||
    typeof product.description !== "string" ||
    typeof product.featured !== "boolean" ||
    typeof product.active !== "boolean" ||
    !Array.isArray(product.details) ||
    product.details.some((detail) => typeof detail !== "string")
  )) {
    throw new TypeError("O servidor devolveu um catálogo inválido.");
  }
  for (const product of products) {
    product.image = window.MonarchAPI.normalizeAssetUrl(product.image);
  }
  window.CPX_PRODUCTS = products;
  return products;
});
