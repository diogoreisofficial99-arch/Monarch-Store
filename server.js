"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { neon } = require("@neondatabase/serverless");
const { get: getBlob, put: putBlob } = require("@vercel/blob");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");

const ROOT = __dirname;
const SITE_DIR = path.join(ROOT, "site");
const ASSETS_DIR = path.join(ROOT, "assets");
const IMAGE_UPLOADS_DIR = path.join(ASSETS_DIR, "imgs", "uploads");
const PRIVATE_DIR = path.join(SITE_DIR, "protected");
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS_DIR = IMAGE_UPLOADS_DIR;
const PRODUCT_DOWNLOADS_DIR = path.join(PRIVATE_DIR, "product-downloads");
const DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || path.join(DATA_DIR, "store.sqlite"));
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_VERCEL = process.env.VERCEL === "1";
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_POSTGRES_URL;
const USE_NEON = Boolean(DATABASE_URL);
const PUBLIC_BLOB_TOKEN = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN || "";
const PRIVATE_BLOB_TOKEN = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN || "";
const USE_BLOB = IS_VERCEL || Boolean(PUBLIC_BLOB_TOKEN && PRIVATE_BLOB_TOKEN);
const DISCORD_REDIRECT_URI = process.env.REDIRECT_URI || process.env.DISCORD_REDIRECT_URI;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
if (IS_VERCEL && !USE_NEON) {
  throw new Error("Set DATABASE_URL or the Neon integration variable DATABASE_URL_POSTGRES_URL in Vercel.");
}
if (IS_VERCEL && (!PUBLIC_BLOB_TOKEN || !PRIVATE_BLOB_TOKEN)) {
  throw new Error("Set separate public and private Vercel Blob read-write tokens in Vercel.");
}
const seedProducts = JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, "seed-products.json"), "utf8"));
let database;
let DatabaseSync;
let neonSql;
let databaseInitialization;

const sqliteSchema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    discord_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_hash TEXT,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    banned INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    category_name TEXT NOT NULL,
    name TEXT NOT NULL,
    price_label TEXT NOT NULL,
    price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
    image TEXT NOT NULL,
    description TEXT NOT NULL,
    details_json TEXT NOT NULL,
    download_key TEXT,
    download_name TEXT,
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_method TEXT NOT NULL DEFAULT 'paypal',
    payment_url TEXT NOT NULL,
    payment_reference TEXT,
    paypal_order_id TEXT,
    paypal_capture_id TEXT,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_image TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    PRIMARY KEY (order_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS user_products (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS user_product_revocations (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    revoked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const postgresSchema = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    discord_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_hash TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, category_name TEXT NOT NULL,
    name TEXT NOT NULL, price_label TEXT NOT NULL, price_cents INTEGER,
    image TEXT NOT NULL, description TEXT NOT NULL, details_json TEXT NOT NULL,
    download_key TEXT, download_name TEXT, video_url TEXT, download_url TEXT,
    featured INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL, payment_method TEXT NOT NULL DEFAULT 'paypal',
    payment_url TEXT NOT NULL, payment_reference TEXT, paypal_order_id TEXT, paypal_capture_id TEXT,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL,
    product_name TEXT NOT NULL, product_image TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    PRIMARY KEY (order_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_products (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id), assigned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_product_revocations (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id), revoked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  "ALTER TABLE products ADD COLUMN IF NOT EXISTS download_key TEXT",
  "ALTER TABLE products ADD COLUMN IF NOT EXISTS download_name TEXT",
  "ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url TEXT",
  "ALTER TABLE products ADD COLUMN IF NOT EXISTS download_url TEXT",
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT",
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_capture_id TEXT"
];

function loadSuperAdminId() {
  if (process.env.FOUNDER_DISCORD_ID) {
    if (!/^\d{17,20}$/.test(process.env.FOUNDER_DISCORD_ID)) {
      throw new Error("FOUNDER_DISCORD_ID must contain a valid Discord user ID.");
    }
    return process.env.FOUNDER_DISCORD_ID;
  }
  if (IS_VERCEL) {
    throw new Error("Set FOUNDER_DISCORD_ID in the Vercel project environment variables.");
  }
  const configPath = path.join(PRIVATE_DIR, "super-admin.json");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn("site/protected/super-admin.json is missing; admin access is disabled until it is created.");
      return null;
    }
    throw new Error(`Could not read the protected super-admin configuration: ${error.message}`);
  }

  if (config.discordId === "") {
    console.warn("Set discordId in site/protected/super-admin.json to enable the founder account.");
    return null;
  }
  if (typeof config.discordId !== "string" || !/^\d{17,20}$/.test(config.discordId)) {
    throw new Error("site/protected/super-admin.json must contain a valid Discord user ID in discordId.");
  }
  return config.discordId;
}

const superAdminDiscordId = loadSuperAdminId();
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("base64url");
if (IS_PRODUCTION && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("Set SESSION_SECRET to a random value of at least 32 characters in production.");
}
if (!process.env.SESSION_SECRET) {
  console.warn("Using a temporary development session secret; sessions will expire when the server restarts.");
}

async function initializeDatabase() {
  if (databaseInitialization) return databaseInitialization;
  databaseInitialization = (async () => {
    if (USE_NEON) {
      neonSql = neon(DATABASE_URL);
      for (const statement of postgresSchema) await neonSql.query(statement);
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.mkdirSync(PRODUCT_DOWNLOADS_DIR, { recursive: true });
      fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
      ({ DatabaseSync } = require("node:sqlite"));
      database = new DatabaseSync(DATABASE_PATH);
      database.exec(sqliteSchema);
      const orderColumns = new Set(database.prepare("PRAGMA table_info(orders)").all().map((column) => column.name));
      if (!orderColumns.has("paypal_order_id")) database.exec("ALTER TABLE orders ADD COLUMN paypal_order_id TEXT");
      if (!orderColumns.has("paypal_capture_id")) database.exec("ALTER TABLE orders ADD COLUMN paypal_capture_id TEXT");
      const productColumns = new Set(database.prepare("PRAGMA table_info(products)").all().map((column) => column.name));
      if (!productColumns.has("download_key")) database.exec("ALTER TABLE products ADD COLUMN download_key TEXT");
      if (!productColumns.has("download_name")) database.exec("ALTER TABLE products ADD COLUMN download_name TEXT");
      if (!productColumns.has("video_url")) database.exec("ALTER TABLE products ADD COLUMN video_url TEXT");
      if (!productColumns.has("download_url")) database.exec("ALTER TABLE products ADD COLUMN download_url TEXT");
    } 
    const count = await get("SELECT COUNT(*) AS count FROM products");
    if (Number(count.count) === 0) {
      const timestamp = new Date().toISOString();
      const seedQueries = seedProducts.map((product) => ({
        text: `INSERT INTO products (
          id, category, category_name, name, price_label, price_cents, image,
          description, details_json, download_key, download_name, featured, active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          product.id, product.category, product.categoryName, product.name, product.priceLabel,
          product.priceCents, product.image, product.description, JSON.stringify(product.details),
          product.downloadKey || null, product.downloadName || null, Number(product.featured),
          Number(product.active), product.sortOrder, timestamp, timestamp
        ]
      }));
      await runTransaction(seedQueries);
    }
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", ["siteName", "Monarch Store"]);
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", ["logoUrl", "/assets/imgs/logomonarch.png"]);
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", ["faviconUrl", "/assets/imgs/favicon-monarch.png"]);
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", ["paypalMethod", "manual"]);
    await run("UPDATE products SET image = replace(image, '/uploads/', '/assets/imgs/uploads/') WHERE image LIKE '/uploads/%'");
    await run("UPDATE settings SET value = replace(value, '/uploads/', '/assets/imgs/uploads/') WHERE key IN ('logoUrl', 'faviconUrl') AND value LIKE '/uploads/%'");
  })();
  try {
    await databaseInitialization;
  } catch (error) {
    databaseInitialization = null;
    throw error;
  }
}

function prepareSql(text) {
  let index = 0;
  return text.replace(/\?/g, () => `$${++index}`);
}

async function all(text, params = []) {
  if (USE_NEON) return neonSql.query(prepareSql(text), params);
  return database.prepare(text).all(...params);
}

async function get(text, params = []) {
  if (USE_NEON) return (await neonSql.query(prepareSql(text), params))[0];
  return database.prepare(text).get(...params);
}

async function run(text, params = []) {
  if (USE_NEON) {
    const result = await neonSql.query(prepareSql(text), params, { fullResults: true });
    return { changes: result.rowCount };
  }
  return database.prepare(text).run(...params);
}

async function runTransaction(queries) {
  if (USE_NEON) {
    const prepared = queries.map(({ text, params = [] }) => neonSql.query(prepareSql(text), params));
    return neonSql.transaction(prepared);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const { text, params = [] } of queries) database.prepare(text).run(...params);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

class SQLiteSessionStore extends session.Store {
  get(sessionId, callback) {
    get("SELECT data, expires_at FROM sessions WHERE sid = ?", [sessionId]).then(async (row) => {
      if (!row) return callback(null, null);
      if (Number(row.expires_at) <= Date.now()) {
        await run("DELETE FROM sessions WHERE sid = ?", [sessionId]);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    }).catch(callback);
  }

  set(sessionId, sessionData, callback) {
    const expiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + SESSION_MAX_AGE;
    run(`
        INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
      `, [sessionId, JSON.stringify(sessionData), expiry]).then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  destroy(sessionId, callback) {
    run("DELETE FROM sessions WHERE sid = ?", [sessionId]).then(() => callback?.(null)).catch((error) => callback?.(error));
  }

  touch(sessionId, sessionData, callback) {
    const expiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + SESSION_MAX_AGE;
    run("UPDATE sessions SET expires_at = ? WHERE sid = ?", [expiry, sessionId])
      .then(() => callback?.(null)).catch((error) => callback?.(error));
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const app = express();
app.disable("x-powered-by");
if (IS_PRODUCTION) app.set("trust proxy", 1);
app.use((request, response, next) => {
  initializeDatabase().then(() => next()).catch(next);
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://cdn.discordapp.com", "https://media.discordapp.net", "https://*.public.blob.vercel-storage.com"],
      connectSrc: ["'self'", "https://discord.com"],
      formAction: ["'self'", "https://discord.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "64kb" }));
app.use(session({
  name: "monarch.sid",
  secret: sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: SESSION_MAX_AGE
  }
}));

const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3.5 * 1024 * 1024, files: 1 },
  fileFilter: (request, file, callback) => {
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    callback(allowedTypes.has(file.mimetype) ? null : new HttpError(415, "Usa uma imagem PNG, JPG ou WebP."), allowedTypes.has(file.mimetype));
  }
});
const productFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3.5 * 1024 * 1024, files: 1 },
  fileFilter: (request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = new Set([".zip", ".lua", ".json", ".txt", ".pdf", ".rar", ".7z"]);
    callback(allowedExtensions.has(extension) ? null : new HttpError(415, "Usa um ficheiro ZIP, Lua, JSON, TXT, PDF, RAR ou 7z."), allowedExtensions.has(extension));
  }
});

function now() {
  return new Date().toISOString();
}

async function setting(key) {
  return (await get("SELECT value FROM settings WHERE key = ?", [key]))?.value;
}

async function publicSettings() {
  return {
    siteName: await setting("siteName"),
    logoUrl: await setting("logoUrl"),
    faviconUrl: await setting("faviconUrl")
  };
}

function toProduct(row) {
  return {
    id: row.id,
    category: row.category,
    categoryName: row.category_name,
    name: row.name,
    priceLabel: row.price_label,
    priceCents: row.price_cents,
    image: row.image,
    description: row.description,
    details: JSON.parse(row.details_json),
    videoUrl: row.video_url || null,
    featured: Boolean(row.featured),
    active: Boolean(row.active),
    sortOrder: row.sort_order
  };
}

function productRows({ includeInactive = false } = {}) {
  return all(`
    SELECT * FROM products
    ${includeInactive ? "" : "WHERE active = 1"}
    ORDER BY sort_order ASC, created_at ASC
  `);
}

function isValidAssetPath(value) {
  if (typeof value !== "string" || value.includes("..")) return false;
  if (value.startsWith("/assets/imgs/") || value.startsWith("/imgs/") || value.startsWith("/uploads/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function validateOptionalHttpsUrl(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) {
    throw new HttpError(400, `O campo ${field} deve ser um URL HTTPS válido.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `O campo ${field} deve ser um URL HTTPS válido.`);
  }
  if (url.protocol !== "https:" || !url.hostname) {
    throw new HttpError(400, `O campo ${field} deve ser um URL HTTPS válido.`);
  }
  return url.toString();
}

function requireCsrf(request, response, next) {
  const expected = request.session.csrfToken;
  const actual = request.get("x-csrf-token");
  if (!expected || !actual) return next(new HttpError(403, "Sessão desatualizada. Atualiza a página e tenta novamente."));
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return next(new HttpError(403, "Token de segurança inválido. Atualiza a página e tenta novamente."));
  }
  next();
}

async function requireAuth(request, response, next) {
  if (!request.session.userId) return next(new HttpError(401, "Inicia sessão com o Discord para continuar."));
  let user;
  try {
    user = await get("SELECT * FROM users WHERE id = ?", [request.session.userId]);
  } catch (error) {
    return next(error);
  }
  if (!user || user.banned) {
    request.session.destroy(() => {});
    return next(new HttpError(403, "Esta conta não tem acesso à loja. Contacta o suporte."));
  }
  request.user = user;
  request.isSuperAdmin = user.discord_id === superAdminDiscordId && Boolean(superAdminDiscordId);
  next();
}

async function requireAdmin(request, response, next) {
  await requireAuth(request, response, (error) => {
    if (error) return next(error);
    if (!request.isSuperAdmin && request.user.role !== "admin") {
      return next(new HttpError(403, "Esta área está reservada aos administradores."));
    }
    next();
  });
}

async function requireSuperAdmin(request, response, next) {
  await requireAdmin(request, response, (error) => {
    if (error) return next(error);
    if (!request.isSuperAdmin) return next(new HttpError(403, "Só o fundador pode alterar esta configuração."));
    next();
  });
}

function publicUser(user, isSuperAdmin = false) {
  return {
    id: user.id,
    discordId: user.discord_id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_hash
      ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar_hash}.png`
      : null,
    role: isSuperAdmin ? "super_admin" : user.role,
    banned: Boolean(user.banned),
    createdAt: user.created_at
  };
}

function isSameToken(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireOAuthConfig(response) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    response.status(503).send("Discord OAuth ainda não está configurado no servidor.");
    return false;
  }
  return true;
}

function encryptSecret(value) {
  const key = crypto.createHash("sha256").update(sessionSecret).update("monarch-paypal-config").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value) {
  const [version, iv, tag, encrypted] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("A configuração encriptada do PayPal é inválida.");
  const key = crypto.createHash("sha256").update(sessionSecret).update("monarch-paypal-config").digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

async function paypalConfig() {
  const [method, environment, clientId, clientSecret, webhookId, paypalMeUrl] = await Promise.all([
    setting("paypalMethod"),
    setting("paypalEnvironment"),
    setting("paypalClientId"),
    setting("paypalClientSecret"),
    setting("paypalWebhookId"),
    setting("paypalMeUrl")
  ]);
  return {
    method: method === "manual"
      ? "manual"
      : method === "paypal_me" && paypalMeUrl
        ? "paypal_me"
        : method === "checkout" && clientId && clientSecret
          ? "checkout"
          : "manual",
    environment: environment === "live" ? "live" : "sandbox",
    clientId,
    clientSecret: clientSecret ? decryptSecret(clientSecret) : null,
    webhookId,
    paypalMeUrl
  };
}

function normalizePaypalMeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Indica um link PayPal.me válido, por exemplo https://paypal.me/nomedaconta.");
  }
  const username = url.pathname.replace(/^\/|\/$/g, "");
  if (
    url.protocol !== "https:" ||
    !["paypal.me", "www.paypal.me"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[A-Za-z0-9._-]+$/.test(username)
  ) {
    throw new HttpError(400, "Indica apenas o link HTTPS do perfil PayPal.me, sem valor ou parâmetros.");
  }
  return `https://paypal.me/${username}`;
}

function paypalApiBase(environment) {
  return environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new HttpError(503, "O PayPal Checkout ainda não está configurado pelo fundador.");
  }
  const response = await fetch(`${paypalApiBase(config.environment)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    console.error(`PayPal token request failed with HTTP ${response.status}.`);
    throw new HttpError(502, "Não foi possível iniciar o pagamento PayPal. Tenta novamente.");
  }
  const token = (await response.json()).access_token;
  if (typeof token !== "string" || !token) throw new HttpError(502, "O PayPal devolveu uma credencial inválida.");
  return token;
}

function getApplicationOrigin(request) {
  if (process.env.APP_URL) {
    let configuredUrl;
    try {
      configuredUrl = new URL(process.env.APP_URL);
    } catch {
      throw new HttpError(503, "A configuração APP_URL do site é inválida.");
    }
    if (configuredUrl.protocol !== "https:" && IS_PRODUCTION) {
      throw new HttpError(503, "APP_URL tem de usar HTTPS em produção.");
    }
    return configuredUrl.origin;
  }
  if (IS_VERCEL && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (IS_PRODUCTION) throw new HttpError(503, "Define APP_URL com o endereço HTTPS público da loja.");
  return `${request.protocol}://${request.get("host")}`;
}

async function paypalApiRequest(config, route, options = {}) {
  const token = await paypalAccessToken(config);
  const response = await fetch(`${paypalApiBase(config.environment)}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`PayPal API request failed with HTTP ${response.status}.`);
    throw new HttpError(502, "O PayPal não conseguiu processar o pedido. Tenta novamente.");
  }
  return payload;
}

async function confirmPaypalPayment(orderId, captureId, paidAmount, currency) {
  const order = await get("SELECT * FROM orders WHERE paypal_order_id = ?", [orderId]);
  if (!order) throw new HttpError(404, "Encomenda PayPal não encontrada.");
  if (currency !== "EUR" || Number(paidAmount) !== Number((order.total_cents / 100).toFixed(2))) {
    throw new HttpError(400, "O valor ou a moeda do pagamento não corresponde à encomenda.");
  }
  if (order.status === "paid") return order;
  if (order.status !== "pending") throw new HttpError(409, "Esta encomenda já não está pendente.");
  const timestamp = now();
  await run(
    "UPDATE orders SET status = 'paid', paypal_capture_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    [captureId, timestamp, order.id]
  );
  return get("SELECT * FROM orders WHERE id = ?", [order.id]);
}

function validateProductInput(input) {
  const product = input && typeof input === "object" ? input : {};
  const details = product.details;
  if (typeof product.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.id) || product.id.length > 80) {
    throw new HttpError(400, "O identificador do produto deve usar letras minúsculas, números e hífen.");
  }
  for (const field of ["category", "categoryName", "name", "priceLabel", "image", "description"]) {
    if (typeof product[field] !== "string" || product[field].trim().length === 0 || product[field].length > 500) {
      throw new HttpError(400, `O campo ${field} é obrigatório e tem um limite de 500 caracteres.`);
    }
  }
  if (!isValidAssetPath(product.image)) throw new HttpError(400, "A imagem tem de ser um caminho local de /assets/imgs/.");
  if (product.priceCents !== null && (!Number.isSafeInteger(product.priceCents) || product.priceCents < 1)) {
    throw new HttpError(400, "O preço deve ser de pelo menos um cêntimo ou null para orçamento sob consulta.");
  }
  if (typeof product.featured !== "boolean" || typeof product.active !== "boolean") {
    throw new HttpError(400, "Define os campos featured e active como verdadeiro ou falso.");
  }
  if (!Number.isSafeInteger(product.sortOrder) || product.sortOrder < 0 || product.sortOrder > 10000) {
    throw new HttpError(400, "A ordem do produto deve ser um número entre 0 e 10000.");
  }
  if (!Array.isArray(details) || details.length > 30 || details.some((detail) => typeof detail !== "string" || detail.length > 500)) {
    throw new HttpError(400, "A lista de detalhes do produto é inválida.");
  }
  if (product.downloadKey !== undefined && product.downloadKey !== null &&
      (typeof product.downloadKey !== "string" || !/^[0-9a-f-]{36}\.(zip|lua|json|txt|pdf|rar|7z)$/.test(product.downloadKey))) {
    throw new HttpError(400, "O ficheiro do produto é inválido.");
  }
  if (product.downloadName !== undefined && product.downloadName !== null &&
      (typeof product.downloadName !== "string" || product.downloadName.length > 120 || /[\\/\r\n]/.test(product.downloadName))) {
    throw new HttpError(400, "O nome do ficheiro do produto é inválido.");
  }
  return {
    ...product,
    category: product.category.trim(),
    categoryName: product.categoryName.trim(),
    name: product.name.trim(),
    priceLabel: product.priceLabel.trim(),
    image: product.image.trim(),
    description: product.description.trim(),
    videoUrl: validateOptionalHttpsUrl(product.videoUrl, "videoUrl"),
    downloadUrl: validateOptionalHttpsUrl(product.downloadUrl, "downloadUrl"),
    details: details.map((detail) => detail.trim())
  };
}

const saveProductSql = `
  INSERT INTO products (
    id, category, category_name, name, price_label, price_cents, image,
    description, details_json, download_key, download_name, video_url, download_url,
    featured, active, sort_order, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    category = excluded.category,
    category_name = excluded.category_name,
    name = excluded.name,
    price_label = excluded.price_label,
    price_cents = excluded.price_cents,
    image = excluded.image,
    description = excluded.description,
    details_json = excluded.details_json,
    download_key = COALESCE(excluded.download_key, products.download_key),
    download_name = COALESCE(excluded.download_name, products.download_name),
    video_url = excluded.video_url,
    download_url = excluded.download_url,
    featured = excluded.featured,
    active = excluded.active,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at
`;

async function saveProductToDatabase(product, isNew) {
  if (isNew && await get("SELECT 1 FROM products WHERE id = ?", [product.id])) {
    throw new HttpError(409, "Já existe um produto com esse identificador.");
  }
  const timestamp = now();
  await run(saveProductSql, [
    product.id,
    product.category,
    product.categoryName,
    product.name,
    product.priceLabel,
    product.priceCents,
    product.image,
    product.description,
    JSON.stringify(product.details),
    product.downloadKey || null,
    product.downloadName || null,
    product.videoUrl,
    product.downloadUrl,
    Number(product.featured),
    Number(product.active),
    product.sortOrder,
    timestamp,
    timestamp
  ]);
}

async function serializeOrder(order) {
  const items = await all(`
    SELECT order_items.*, products.download_key, products.download_url
    FROM order_items
    LEFT JOIN products ON products.id = order_items.product_id
    WHERE order_items.order_id = ?
  `, [order.id]);
  return {
    id: order.id,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentUrl: order.payment_url,
    paymentReference: order.payment_reference,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.product_name,
      image: item.product_image,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      downloadAvailable: order.status === "paid" && Boolean(item.download_key || item.download_url)
    }))
  };
}

app.get("/api/health", (request, response) => response.json({ status: "ok" }));
app.get("/api/products", asyncRoute(async (request, response) => response.json((await productRows()).map(toProduct))));
app.get("/api/settings", asyncRoute(async (request, response) => response.json(await publicSettings())));

app.get("/api/session", asyncRoute(async (request, response) => {
  if (!request.session.csrfToken) request.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  const user = request.session.userId
    ? await get("SELECT * FROM users WHERE id = ?", [request.session.userId])
    : null;
  response.json({
    csrfToken: request.session.csrfToken,
    user: user && !user.banned
      ? publicUser(user, user.discord_id === superAdminDiscordId && Boolean(superAdminDiscordId))
      : null
  });
}));

app.post("/api/admin/product-files", requireAdmin, requireCsrf, (request, response, next) => {
  productFileUpload.single("file")(request, response, async (error) => {
    try {
      if (error) throw error;
      if (!request.file) throw new HttpError(400, "Seleciona um ficheiro para o produto.");
      const extension = path.extname(request.file.originalname).toLowerCase();
      const baseName = path.basename(request.file.originalname, extension)
        .replace(/[^a-zA-Z0-9._ -]/g, "")
        .trim()
        .slice(0, 100) || "ficheiro-produto";
      const key = `${crypto.randomUUID()}${extension}`;
      if (USE_BLOB) {
        await putBlob(`product-downloads/${key}`, request.file.buffer, {
          access: "private",
          contentType: request.file.mimetype,
          addRandomSuffix: false,
          token: PRIVATE_BLOB_TOKEN
        });
      } else {
        await fs.promises.writeFile(path.join(PRODUCT_DOWNLOADS_DIR, key), request.file.buffer, { flag: "wx" });
      }
      response.status(201).json({ key, name: `${baseName}${extension}` });
    } catch (uploadError) {
      next(uploadError);
    }
  });
});

app.get("/auth/discord", authLimiter, (request, response, next) => {
  if (!requireOAuthConfig(response)) return;
  const state = crypto.randomBytes(32).toString("base64url");
  request.session.oauthState = state;
  request.session.save((error) => {
    if (error) return next(error);
    const parameters = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: "code",
      scope: "identify",
      state
    });
    response.redirect(`https://discord.com/oauth2/authorize?${parameters.toString()}`);
  });
});

app.get("/auth/discord/callback", authLimiter, asyncRoute(async (request, response, next) => {
  if (!requireOAuthConfig(response)) return;
  const { code, state, error } = request.query;
  if (error || typeof code !== "string" || !isSameToken(request.session.oauthState, state)) {
    delete request.session.oauthState;
    return response.status(400).send("Não foi possível validar o início da sessão Discord. Tenta novamente.");
  }
  delete request.session.oauthState;

  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: DISCORD_REDIRECT_URI
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!tokenResponse.ok) {
    console.error(`Discord OAuth token exchange failed with HTTP ${tokenResponse.status}.`);
    return response.status(502).send("O Discord não conseguiu validar a sessão. Tenta novamente.");
  }
  const tokenData = await tokenResponse.json();
  const profileResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!profileResponse.ok) {
    console.error(`Discord profile lookup failed with HTTP ${profileResponse.status}.`);
    return response.status(502).send("Não foi possível carregar a conta Discord. Tenta novamente.");
  }
  const profile = await profileResponse.json();
  if (typeof profile.id !== "string" || !/^\d{17,20}$/.test(profile.id) || typeof profile.username !== "string") {
    return response.status(502).send("O Discord devolveu um perfil inválido.");
  }

  const timestamp = now();
  await run(`
    INSERT INTO users (discord_id, username, display_name, avatar_hash, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      avatar_hash = excluded.avatar_hash,
      updated_at = excluded.updated_at,
      last_login_at = excluded.last_login_at
  `, [
    profile.id,
    profile.username.slice(0, 100),
    String(profile.global_name || profile.username).slice(0, 100),
    typeof profile.avatar === "string" ? profile.avatar : null,
    timestamp,
    timestamp,
    timestamp
  ]);
  const user = await get("SELECT id, discord_id, role, banned FROM users WHERE discord_id = ?", [profile.id]);
  if (user.banned) return response.status(403).send("Esta conta não tem acesso à loja. Contacta o suporte.");

  request.session.regenerate((sessionError) => {
    if (sessionError) return next(sessionError);
    request.session.userId = user.id;
    request.session.csrfToken = crypto.randomBytes(32).toString("base64url");
    request.session.save((saveError) => {
      if (saveError) return next(saveError);
      response.redirect(user.discord_id === superAdminDiscordId || user.role === "admin" ? "/admin.html" : "/conta.html");
    });
  });
}));

app.post("/auth/logout", requireCsrf, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie("monarch.sid", { httpOnly: true, sameSite: "lax", secure: IS_PRODUCTION });
    response.json({ ok: true });
  });
});

app.get("/api/customer/orders", requireAuth, asyncRoute(async (request, response) => {
  const orders = await all("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", [request.user.id]);
  const paidProductIds = (await all(`
    SELECT DISTINCT product_id FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    WHERE orders.user_id = ? AND orders.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM user_product_revocations
        WHERE user_product_revocations.user_id = orders.user_id
          AND user_product_revocations.product_id = order_items.product_id
      )
  `, [request.user.id])).map((row) => row.product_id);
  const revokedProductIds = new Set((await all(
    "SELECT product_id FROM user_product_revocations WHERE user_id = ?"
  , [request.user.id])).map((row) => row.product_id));
  const visibleOrders = (await Promise.all(orders.map(serializeOrder))).map((order) => ({
    ...order,
    items: order.items.filter((item) => !revokedProductIds.has(item.productId))
  })).filter((order) => order.items.length > 0);
  response.json({ orders: visibleOrders, purchasedProductIds: paidProductIds });
}));

app.get("/api/customer/products", requireAuth, asyncRoute(async (request, response) => {
  const products = await all(`
    SELECT products.*, MAX(access.acquired_at) AS acquired_at,
      MAX(access.is_assigned) AS manually_assigned
    FROM (
      SELECT user_id, product_id, assigned_at AS acquired_at, 1 AS is_assigned
      FROM user_products
      WHERE user_id = ?
      UNION ALL
      SELECT orders.user_id, order_items.product_id, orders.updated_at AS acquired_at, 0 AS is_assigned
      FROM orders
      JOIN order_items ON order_items.order_id = orders.id
      WHERE orders.user_id = ? AND orders.status = 'paid'
    ) AS access
    JOIN products ON products.id = access.product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM user_product_revocations
      WHERE user_product_revocations.user_id = access.user_id
        AND user_product_revocations.product_id = access.product_id
    )
    GROUP BY products.id
    ORDER BY acquired_at DESC
  `, [request.user.id, request.user.id]);
  response.json(products.map((product) => ({
    ...toProduct(product),
    acquiredAt: product.acquired_at,
    manuallyAssigned: Boolean(product.manually_assigned),
    downloadAvailable: Boolean(product.download_key || product.download_url)
  })));
}));

app.get("/api/customer/products/:id/download", requireAuth, asyncRoute(async (request, response, next) => {
  const purchase = await get(`
    SELECT products.download_key, products.download_name, products.download_url
    FROM products
    WHERE products.id = ? AND NOT EXISTS (
      SELECT 1 FROM user_product_revocations
      WHERE user_product_revocations.user_id = ? AND user_product_revocations.product_id = products.id
    ) AND (
      EXISTS (
        SELECT 1 FROM user_products
        WHERE user_products.user_id = ? AND user_products.product_id = products.id
      ) OR EXISTS (
        SELECT 1 FROM order_items
        JOIN orders ON orders.id = order_items.order_id
        WHERE orders.user_id = ? AND orders.status = 'paid'
          AND order_items.product_id = products.id
      )
    )
      AND (products.download_key IS NOT NULL OR products.download_url IS NOT NULL)
    LIMIT 1
  `, [request.params.id, request.user.id, request.user.id, request.user.id]);
  if (!purchase) return next(new HttpError(404, "Este download não está disponível. Abre um ticket no Discord para obter ajuda."));
  if (purchase.download_url) return response.redirect(302, purchase.download_url);
  if (USE_BLOB) {
    const blob = await getBlob(`product-downloads/${purchase.download_key}`, {
      access: "private",
      token: PRIVATE_BLOB_TOKEN
    });
    if (!blob) return next(new HttpError(404, "O ficheiro do produto já não está disponível. Abre um ticket no Discord para obter ajuda."));
    response.setHeader("Content-Type", blob.blob.contentType || "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(purchase.download_name || "download")}`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    await pipeline(Readable.fromWeb(blob.stream), response);
    return;
  }
  response.download(path.join(PRODUCT_DOWNLOADS_DIR, path.basename(purchase.download_key)), purchase.download_name, (error) => {
    if (error && !response.headersSent) {
      if (error.code === "ENOENT") return next(new HttpError(404, "O ficheiro do produto já não está disponível. Abre um ticket no Discord para obter ajuda."));
      next(error);
    }
  });
}));

app.post("/api/orders", orderLimiter, requireCsrf, requireAuth, asyncRoute(async (request, response) => {
  const entries = request.body?.items;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 25) {
    throw new HttpError(400, "O pedido tem de incluir entre 1 e 25 produtos.");
  }
  const quantities = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.productId !== "string" || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 20) {
      throw new HttpError(400, "Um dos produtos ou a respetiva quantidade é inválida.");
    }
    const quantity = (quantities.get(entry.productId) || 0) + entry.quantity;
    if (quantity > 20) throw new HttpError(400, "A quantidade máxima de cada produto é 20.");
    quantities.set(entry.productId, quantity);
  }
  const productIds = [...quantities.keys()];
  const products = await Promise.all(productIds.map((id) => get("SELECT * FROM products WHERE id = ? AND active = 1", [id])));
  if (products.some((product) => !product)) throw new HttpError(400, "Um ou mais produtos já não estão disponíveis.");
  if (products.some((product) => product.price_cents === null || product.price_cents < 1)) {
    throw new HttpError(400, "Produtos com orçamento sob consulta não podem ser encomendados pelo carrinho.");
  }
  const orderItems = products.map((product) => ({ product, quantity: quantities.get(product.id) }));
  const totalCents = orderItems.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  if (!Number.isSafeInteger(totalCents)) throw new HttpError(400, "O total do pedido excede o limite permitido.");
  const orderId = crypto.randomUUID();
  const config = await paypalConfig();
  let paymentUrl = "";
  let paypalOrderId = null;
  let paymentMethod = "manual";
  if (config.method === "paypal_me" && config.paypalMeUrl) {
    const paypalMeUrl = normalizePaypalMeUrl(config.paypalMeUrl);
    paymentUrl = `${paypalMeUrl}/${(totalCents / 100).toFixed(2)}EUR`;
    paymentMethod = "paypal_me";
  } else if (config.method === "checkout" && config.clientId && config.clientSecret) {
    const origin = getApplicationOrigin(request);
    const paypalOrder = await paypalApiRequest(config, "/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: orderId,
          custom_id: orderId,
          amount: { currency_code: "EUR", value: (totalCents / 100).toFixed(2) }
        }],
        application_context: {
          user_action: "PAY_NOW",
          return_url: `${origin}/api/paypal/return?order=${encodeURIComponent(orderId)}`,
          cancel_url: `${origin}/api/paypal/cancel?order=${encodeURIComponent(orderId)}`
        }
      })
    });
    paymentUrl = paypalOrder.links?.find((link) => link.rel === "approve")?.href;
    if (!paypalOrder.id || !paymentUrl) throw new HttpError(502, "O PayPal não devolveu um link de pagamento válido.");
    paypalOrderId = paypalOrder.id;
    paymentMethod = "paypal";
  }

  const timestamp = now();
  const orderQueries = [{
    text: `INSERT INTO orders (
      id, user_id, status, payment_method, payment_url, paypal_order_id, total_cents, created_at, updated_at
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    params: [orderId, request.user.id, paymentMethod, paymentUrl, paypalOrderId, totalCents, timestamp, timestamp]
  }, ...orderItems.map(({ product, quantity }) => ({
    text: `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?, ?, ?)`,
    params: [orderId, product.id, product.name, product.image, quantity, product.price_cents]
  }))];
  await runTransaction(orderQueries);
  response.status(201).json({
    order: await serializeOrder(await get("SELECT * FROM orders WHERE id = ?", [orderId])),
    message: paymentMethod === "paypal_me"
      ? "Pedido criado. Paga pelo PayPal.me e aguarda a confirmação da equipa."
      : paymentMethod === "manual"
        ? "Pedido criado. Abre um ticket no Discord para concluir o pagamento."
        : "Pedido criado. Continua no PayPal para concluir o pagamento."
  });
}));

app.get("/api/paypal/return", requireAuth, asyncRoute(async (request, response) => {
  const orderId = typeof request.query.order === "string" ? request.query.order : "";
  const order = await get("SELECT * FROM orders WHERE id = ? AND user_id = ?", [orderId, request.user.id]);
  if (!order) throw new HttpError(404, "Encomenda não encontrada.");
  if (order.payment_method !== "paypal" || !order.paypal_order_id) {
    throw new HttpError(400, "Esta encomenda requer confirmação manual da equipa.");
  }
  if (order.status === "pending") {
    const config = await paypalConfig();
    const capture = await paypalApiRequest(config, `/v2/checkout/orders/${encodeURIComponent(order.paypal_order_id)}/capture`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const payment = capture.purchase_units?.[0]?.payments?.captures?.[0];
    if (capture.status !== "COMPLETED" || payment?.status !== "COMPLETED") {
      throw new HttpError(402, "O PayPal ainda não confirmou este pagamento.");
    }
    await confirmPaypalPayment(order.paypal_order_id, payment.id, payment.amount?.value, payment.amount?.currency_code);
  }
  response.redirect(303, "/conta.html?pagamento=confirmado");
}));

app.get("/api/paypal/cancel", requireAuth, asyncRoute(async (request, response) => {
  const orderId = typeof request.query.order === "string" ? request.query.order : "";
  const order = await get("SELECT id FROM orders WHERE id = ? AND user_id = ?", [orderId, request.user.id]);
  if (!order) throw new HttpError(404, "Encomenda não encontrada.");
  response.redirect(303, "/loja.html?pagamento=cancelado");
}));

app.post("/api/paypal/webhook", asyncRoute(async (request, response) => {
  const config = await paypalConfig();
  if (!config.webhookId) throw new HttpError(503, "O webhook PayPal ainda não está configurado.");
  const verification = await paypalApiRequest(config, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      "PayPal-Transmission-Id": request.get("paypal-transmission-id") || "",
      "PayPal-Transmission-Time": request.get("paypal-transmission-time") || "",
      "PayPal-Cert-Url": request.get("paypal-cert-url") || "",
      "PayPal-Auth-Algo": request.get("paypal-auth-algo") || "",
      "PayPal-Transmission-Sig": request.get("paypal-transmission-sig") || ""
    },
    body: JSON.stringify({
      auth_algo: request.get("paypal-auth-algo"),
      cert_url: request.get("paypal-cert-url"),
      transmission_id: request.get("paypal-transmission-id"),
      transmission_sig: request.get("paypal-transmission-sig"),
      transmission_time: request.get("paypal-transmission-time"),
      webhook_id: config.webhookId,
      webhook_event: request.body
    })
  });
  if (verification.verification_status !== "SUCCESS") throw new HttpError(400, "Assinatura do webhook PayPal inválida.");
  if (request.body?.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const event = request.body.resource;
    const paypalOrderId = event?.supplementary_data?.related_ids?.order_id;
    if (paypalOrderId && event?.status === "COMPLETED") {
      await confirmPaypalPayment(paypalOrderId, event.id, event.amount?.value, event.amount?.currency_code);
    }
  }
  response.status(200).json({ received: true });
}));

app.get("/api/admin/products", requireAdmin, asyncRoute(async (request, response) => {
  response.json((await productRows({ includeInactive: true })).map((row) => ({
    ...toProduct(row),
    downloadUrl: row.download_url || "",
    downloadAvailable: Boolean(row.download_key || row.download_url),
    downloadName: row.download_name || null
  })));
}));

app.post("/api/admin/products", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const product = validateProductInput(request.body);
  product.downloadKey = product.downloadKey || null;
  product.downloadName = product.downloadName || null;
  await saveProductToDatabase(product, true);
  response.status(201).json(toProduct(await get("SELECT * FROM products WHERE id = ?", [product.id])));
}));

app.put("/api/admin/products/:id", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const product = validateProductInput({ ...request.body, id: request.params.id });
  const existing = await get("SELECT download_key, download_name FROM products WHERE id = ?", [product.id]);
  if (!existing) {
    throw new HttpError(404, "Produto não encontrado.");
  }
  product.downloadKey = product.downloadKey || existing.download_key;
  product.downloadName = product.downloadName || existing.download_name;
  await saveProductToDatabase(product, false);
  response.json(toProduct(await get("SELECT * FROM products WHERE id = ?", [product.id])));
}));

app.delete("/api/admin/products/:id", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const result = await run("UPDATE products SET active = 0, updated_at = ? WHERE id = ?", [now(), request.params.id]);
  if (result.changes === 0) throw new HttpError(404, "Produto não encontrado.");
  response.json({ ok: true });
}));

app.get("/api/admin/users", requireAdmin, asyncRoute(async (request, response) => {
  const users = await all("SELECT * FROM users ORDER BY created_at DESC");
  const accessProducts = await all(`
    SELECT access.user_id, products.id AS product_id, products.name, products.active,
      MAX(access.assigned_at) AS assigned_at, MAX(access.is_assigned) AS is_assigned,
      MAX(access.is_paid) AS is_paid
    FROM (
      SELECT user_id, product_id, assigned_at, 1 AS is_assigned, 0 AS is_paid
      FROM user_products
      UNION ALL
      SELECT orders.user_id, order_items.product_id, orders.updated_at, 0 AS is_assigned, 1 AS is_paid
      FROM orders
      JOIN order_items ON order_items.order_id = orders.id
      WHERE orders.status = 'paid'
    ) AS access
    JOIN products ON products.id = access.product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM user_product_revocations
      WHERE user_product_revocations.user_id = access.user_id
        AND user_product_revocations.product_id = access.product_id
    )
    GROUP BY access.user_id, products.id
    ORDER BY lower(products.name)
  `);
  const productsByUser = new Map();
  for (const product of accessProducts) {
    if (!productsByUser.has(product.user_id)) productsByUser.set(product.user_id, []);
    productsByUser.get(product.user_id).push({
      productId: product.product_id,
      name: product.name,
      active: Boolean(product.active),
      assignedAt: product.assigned_at,
      manuallyAssigned: Boolean(product.is_assigned),
      purchased: Boolean(product.is_paid)
    });
  }
  response.json(users.map((user) => publicUser(
    user,
    user.discord_id === superAdminDiscordId && Boolean(superAdminDiscordId)
  )).map((user) => ({
    ...user,
    accessProducts: productsByUser.get(user.id) || []
  })));
}));

app.put("/api/admin/users/:id/products/:productId", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const targetId = Number(request.params.id);
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(400, "Conta inválida.");
  const target = await get("SELECT id FROM users WHERE id = ?", [targetId]);
  if (!target) throw new HttpError(404, "Conta não encontrada.");
  const product = await get("SELECT id FROM products WHERE id = ? AND active = 1", [request.params.productId]);
  if (!product) throw new HttpError(404, "Produto ativo não encontrado.");
  await run(`
    INSERT INTO user_products (user_id, product_id, assigned_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, product_id) DO NOTHING
  `, [target.id, product.id, now()]);
  await run("DELETE FROM user_product_revocations WHERE user_id = ? AND product_id = ?", [target.id, product.id]);
  response.status(204).end();
}));

app.delete("/api/admin/users/:id/products/:productId", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const targetId = Number(request.params.id);
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(400, "Conta inválida.");
  const target = await get("SELECT id FROM users WHERE id = ?", [targetId]);
  if (!target) throw new HttpError(404, "Conta não encontrada.");
  const product = await get("SELECT id FROM products WHERE id = ?", [request.params.productId]);
  if (!product) throw new HttpError(404, "Produto não encontrado.");
  const hasAccess = await get(`
    SELECT 1 FROM user_products WHERE user_id = ? AND product_id = ?
    UNION ALL
    SELECT 1 FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    WHERE orders.user_id = ? AND orders.status = 'paid' AND order_items.product_id = ?
    LIMIT 1
  `, [target.id, product.id, target.id, product.id]);
  if (!hasAccess) throw new HttpError(404, "O produto não está disponível nesta conta.");
  await run("DELETE FROM user_products WHERE user_id = ? AND product_id = ?", [target.id, product.id]);
  await run(`
    INSERT INTO user_product_revocations (user_id, product_id, revoked_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET revoked_at = excluded.revoked_at
  `, [target.id, product.id, now()]);
  response.status(204).end();
}));

app.patch("/api/admin/users/:id", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const targetId = Number(request.params.id);
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new HttpError(400, "Conta inválida.");
  const target = await get("SELECT * FROM users WHERE id = ?", [targetId]);
  if (!target) throw new HttpError(404, "Conta não encontrada.");
  const targetIsSuperAdmin = target.discord_id === superAdminDiscordId && Boolean(superAdminDiscordId);
  if (targetIsSuperAdmin) throw new HttpError(403, "A conta do fundador não pode ser alterada pelo painel.");
  if (target.id === request.user.id && request.body.banned === true) {
    throw new HttpError(400, "Não podes bloquear a tua própria conta.");
  }
  if (Object.hasOwn(request.body, "role")) {
    if (!request.isSuperAdmin) throw new HttpError(403, "Só o fundador pode alterar cargos.");
    if (!["admin", "customer"].includes(request.body.role)) throw new HttpError(400, "Cargo inválido.");
    if (target.role === "admin" && target.id === request.user.id) {
      throw new HttpError(400, "Não podes remover o teu próprio acesso de administrador.");
    }
    await run("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [request.body.role, now(), target.id]);
  }
  if (Object.hasOwn(request.body, "banned")) {
    if (typeof request.body.banned !== "boolean") throw new HttpError(400, "O estado da conta é inválido.");
    await run("UPDATE users SET banned = ?, updated_at = ? WHERE id = ?", [Number(request.body.banned), now(), target.id]);
  }
  const updated = await get("SELECT * FROM users WHERE id = ?", [target.id]);
  response.json(publicUser(updated));
}));

app.get("/api/admin/orders", requireAdmin, asyncRoute(async (request, response) => {
  const orders = await all(`
    SELECT orders.*, users.discord_id, users.username, users.display_name
    FROM orders JOIN users ON users.id = orders.user_id
    ORDER BY orders.created_at DESC
  `);
  response.json(await Promise.all(orders.map(async (order) => ({
    ...await serializeOrder(order),
    user: {
      id: order.user_id,
      discordId: order.discord_id,
      username: order.username,
      displayName: order.display_name
    }
  }))));
}));

app.patch("/api/admin/orders/:id", requireAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const order = await get("SELECT * FROM orders WHERE id = ?", [request.params.id]);
  if (!order) throw new HttpError(404, "Encomenda não encontrada.");
  if (request.body?.status === "paid") {
    if (!["paypal_me", "manual"].includes(order.payment_method)) {
      throw new HttpError(400, "Só podes confirmar manualmente pagamentos PayPal.me ou combinados no Discord.");
    }
    if (order.status !== "pending") throw new HttpError(409, "Só podes confirmar encomendas pendentes.");
    const result = await run(
      "UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'pending'",
      [now(), order.id]
    );
    if (result.changes !== 1) throw new HttpError(409, "A encomenda já foi atualizada.");
    return response.json(await serializeOrder(await get("SELECT * FROM orders WHERE id = ?", [order.id])));
  }
  if (request.body?.status !== "cancelled") throw new HttpError(400, "Só podes confirmar PayPal.me ou cancelar uma encomenda pendente.");
  if (order.status !== "pending") throw new HttpError(409, "Só podes cancelar encomendas pendentes.");
  await run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'", [now(), order.id]);
  response.json(await serializeOrder(await get("SELECT * FROM orders WHERE id = ?", [order.id])));
}));

const imageUpload = upload.single("image");
app.post("/api/admin/uploads", requireAdmin, requireCsrf, (request, response, next) => {
  imageUpload(request, response, async (error) => {
    try {
      if (error) throw error;
      const kind = request.query.kind;
      if (!["product", "logo", "favicon"].includes(kind)) throw new HttpError(400, "Tipo de imagem inválido.");
      if (kind !== "product" && !request.isSuperAdmin) throw new HttpError(403, "Só o fundador pode alterar a identidade visual.");
      if (!request.file) throw new HttpError(400, "Seleciona uma imagem.");
      const buffer = request.file.buffer;
      let extension;
      let contentType;
      if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        extension = ".png";
        contentType = "image/png";
      } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        extension = ".jpg";
        contentType = "image/jpeg";
      } else if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        extension = ".webp";
        contentType = "image/webp";
      } else {
        throw new HttpError(415, "O ficheiro não é uma imagem PNG, JPG ou WebP válida.");
      }
      const originalName = path.win32.basename(request.file.originalname);
      const originalBase = path.basename(originalName, path.extname(originalName))
        .replace(/[^\p{L}\p{N}._ -]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 100) || "imagem";
      if (USE_BLOB) {
        const blob = await putBlob(`uploads/${originalBase}${extension}`, buffer, {
          access: "public",
          addRandomSuffix: true,
          contentType,
          token: PUBLIC_BLOB_TOKEN
        });
        response.status(201).json({ url: blob.url });
        return;
      }
      const writeNamedUpload = (suffix = "") => {
        const filename = `${originalBase}${suffix}${extension}`;
        fs.writeFile(path.join(UPLOADS_DIR, filename), buffer, { flag: "wx" }, (writeError) => {
          if (writeError?.code === "EEXIST") return writeNamedUpload(`-${crypto.randomUUID().slice(0, 8)}`);
          if (writeError) return next(writeError);
          response.status(201).json({ url: `/assets/imgs/uploads/${filename}` });
        });
      };
      writeNamedUpload();
    } catch (uploadError) {
      next(uploadError);
    }
  });
});

app.get("/api/admin/settings", requireSuperAdmin, asyncRoute(async (request, response) => {
  const [settings, config] = await Promise.all([publicSettings(), paypalConfig()]);
  response.json({
    ...settings,
    paypalMethod: config.method,
    paypalEnvironment: config.environment,
    paypalClientId: config.clientId || "",
    paypalMeUrl: config.paypalMeUrl || "",
    paypalHasSecret: Boolean(config.clientSecret)
  });
}));

app.put("/api/admin/settings", requireSuperAdmin, requireCsrf, asyncRoute(async (request, response) => {
  const {
    siteName, logoUrl, faviconUrl,
    paypalMethod, paypalEnvironment, paypalClientId, paypalClientSecret, paypalMeUrl
  } = request.body || {};
  if (typeof siteName !== "string" || siteName.trim().length < 2 || siteName.trim().length > 60) {
    throw new HttpError(400, "O nome do site deve ter entre 2 e 60 caracteres.");
  }
  if (!isValidAssetPath(logoUrl) || !isValidAssetPath(faviconUrl)) {
    throw new HttpError(400, "A logo e o favicon devem apontar para uma imagem carregada no site.");
  }
  if (!["checkout", "paypal_me", "manual"].includes(paypalMethod)) {
    throw new HttpError(400, "Escolhe PayPal Checkout, PayPal.me ou pagamento manual.");
  }
  if (!["sandbox", "live"].includes(paypalEnvironment)) {
    throw new HttpError(400, "Escolhe o ambiente Sandbox ou Live do PayPal.");
  }
  if (typeof paypalClientId !== "string" || paypalClientId.length > 256 ||
      typeof paypalClientSecret !== "string" || paypalClientSecret.length > 512 ||
      typeof paypalMeUrl !== "string" || paypalMeUrl.length > 500) {
    throw new HttpError(400, "A configuração do PayPal contém um campo inválido.");
  }
  const normalizedPaypalMeUrl = paypalMethod === "paypal_me" && paypalMeUrl.trim()
    ? normalizePaypalMeUrl(paypalMeUrl.trim())
    : "";
  const storedClientId = await setting("paypalClientId");
  const existingSecret = await setting("paypalClientSecret");
  const clientId = paypalClientId.trim() || storedClientId || "";
  const secret = paypalClientSecret.trim();
  if (paypalMethod === "checkout" && (!clientId || (!secret && !existingSecret))) {
    throw new HttpError(400, "Para usar PayPal Checkout, indica o Client ID e o Client Secret.");
  }
  if (paypalMethod === "paypal_me" && !normalizedPaypalMeUrl) {
    throw new HttpError(400, "Indica o link do perfil PayPal.me.");
  }
  const settings = [
    ["siteName", siteName.trim()],
    ["logoUrl", logoUrl],
    ["faviconUrl", faviconUrl],
    ["paypalMethod", paypalMethod],
    ["paypalEnvironment", paypalEnvironment]
  ];
  if (paypalMethod === "checkout" && clientId) {
    settings.push(["paypalClientId", clientId]);
    if (secret) settings.push(["paypalClientSecret", encryptSecret(secret)]);
  }
  if (paypalMethod === "paypal_me") settings.push(["paypalMeUrl", normalizedPaypalMeUrl]);
  await runTransaction(settings.map(([key, value]) => ({
    text: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [key, value]
  })));
  const [branding, config] = await Promise.all([publicSettings(), paypalConfig()]);
  response.json({
    ...branding,
    paypalMethod: config.method,
    paypalEnvironment: config.environment,
    paypalClientId: config.clientId || "",
    paypalMeUrl: config.paypalMeUrl || "",
    paypalHasSecret: Boolean(config.clientSecret)
  });
}));

app.get("/uploads", (request, response) => response.status(404).end());
app.use("/uploads", express.static(UPLOADS_DIR, { dotfiles: "deny", index: false, fallthrough: false, maxAge: "1d" }));
app.use("/assets", express.static(ASSETS_DIR, {
  dotfiles: "deny",
  index: false,
  fallthrough: false,
  maxAge: "1d",
  setHeaders(response, filePath) {
    if (path.resolve(filePath) === path.join(ASSETS_DIR, "imgs", "hero-graffiti-wall-cpx-v36.png")) {
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  }
}));
app.use("/imgs", express.static(path.join(ASSETS_DIR, "imgs"), { dotfiles: "deny", index: false, fallthrough: false, maxAge: "1d" }));
app.use("/fonts", express.static(path.join(ASSETS_DIR, "fonts"), { dotfiles: "deny", index: false, fallthrough: false, maxAge: "1d" }));
app.use("/script", express.static(path.join(SITE_DIR, "script"), { dotfiles: "deny", index: false, fallthrough: false, maxAge: "0" }));
app.get("/style.css", (request, response) => response.sendFile(path.join(SITE_DIR, "style.css")));
app.get("/admin/admin.js", (request, response, next) => {
  response.sendFile(path.join(SITE_DIR, "admin", "admin.js"), (error) => {
    if (error) next(error);
  });
});
app.get("/cliente/cliente.js", (request, response, next) => {
  response.sendFile(path.join(SITE_DIR, "cliente", "cliente.js"), (error) => {
    if (error) next(error);
  });
});
app.get("/entrar.html", (request, response) => response.redirect(302, "/auth/discord"));

const publicPages = new Map([
  ["/", "Monarch.html"],
  ["/Monarch.html", "Monarch.html"],
  ["/loja.html", "loja.html"],
  ["/produto.html", "produto.html"],
  ["/regras.html", "regras.html"],
  ["/termos.html", "termos.html"],
  ["/conta.html", path.join("cliente", "index.html")],
  ["/cliente", path.join("cliente", "index.html")],
  ["/cliente/", path.join("cliente", "index.html")],
  ["/admin.html", path.join("admin", "index.html")],
  ["/admin", path.join("admin", "index.html")],
  ["/admin/", path.join("admin", "index.html")]
]);
app.get([...publicPages.keys()], (request, response, next) => {
  response.sendFile(path.join(SITE_DIR, publicPages.get(request.path)), (error) => {
    if (error) next(error);
  });
});

app.use((request, response) => {
  if (request.path.startsWith("/api/")) return response.status(404).json({ error: "Endpoint não encontrado." });
  response.status(404).send("Página não encontrada.");
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error(`${request.method} ${request.path} failed: ${error.message}`);
  const message = status >= 500 ? "Ocorreu um erro interno. Tenta novamente mais tarde." : error.message;
  if (request.path.startsWith("/api/") || request.path.startsWith("/auth/")) {
    return response.status(status).json({ error: message });
  }
  response.status(status).send(message);
});

module.exports = app;

if (!IS_VERCEL) {
  const server = app.listen(PORT, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : PORT;
    console.log(`Monarch Store disponível em http://localhost:${port}`);
  });
}
