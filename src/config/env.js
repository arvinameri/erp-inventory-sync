// Path: src/config/env.js
import { config } from "dotenv";

config();

const toBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "")
    return defaultValue;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};

const toNumber = (value, defaultValue) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const toCsvSet = (value) => {
  if (!value) return new Set();
  return new Set(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
};

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toNumber(process.env.PORT, 3000),

  hesabfa: {
    baseUrl: process.env.HESABFA_BASE_URL || "https://api.hesabfa.com/v1",
    apiKey: process.env.HESABFA_API_KEY || "",
    loginToken: process.env.HESABFA_LOGIN_TOKEN || "",
    userId: process.env.HESABFA_USER_ID || "",
    password: process.env.HESABFA_PASSWORD || "",
    yearId: process.env.HESABFA_YEAR_ID || "",
    warehouseCode: process.env.HESABFA_WAREHOUSE_CODE || "",
    priceDivisor: toNumber(process.env.HESABFA_PRICE_DIVISOR, 10),
    // ── کد صندوق برای ثبت دریافت ──────────────────────────
    cashCode: process.env.HESABFA_CASH_CODE || "",
  },

  portal: {
    baseUrl: process.env.PORTAL_BASE_URL || "",
    authHeaderName: process.env.PORTAL_AUTH_HEADER_NAME || "Authorization",
    authHeaderValue:
      process.env.PORTAL_AUTH_HEADER_VALUE ||
      (process.env.PORTAL_API_KEY
        ? `Bearer ${process.env.PORTAL_API_KEY}`
        : ""),
    productListPath:
      process.env.PORTAL_PRODUCT_LIST_PATH || "/site/api/v1/store/products",
    productDetailPathTemplate:
      process.env.PORTAL_PRODUCT_DETAIL_PATH_TEMPLATE ||
      "/site/api/v1/manage/store/products/{id}",
    variantStockUpdatePathTemplate:
      process.env.PORTAL_VARIANT_STOCK_UPDATE_PATH_TEMPLATE ||
      "/site/api/v1/manage/store/products/variants/{id}",
    allowedBarcodes: toCsvSet(process.env.PORTAL_ALLOWED_BARCODES),
    blockedBarcodes: toCsvSet(process.env.PORTAL_BLOCKED_BARCODES),
  },

  sync: {
    jobEnabled: toBoolean(process.env.SYNC_JOB_ENABLED, false),
    cron: process.env.SYNC_CRON || "*/15 * * * *",
    dryRun: toBoolean(process.env.SYNC_DRY_RUN, true),
    maxConcurrency: toNumber(process.env.SYNC_MAX_CONCURRENCY, 3),
    requestTimeoutMs: toNumber(process.env.SYNC_REQUEST_TIMEOUT_MS, 30000),
    retryCount: toNumber(process.env.SYNC_RETRY_COUNT, 2),
    pageSize: toNumber(process.env.SYNC_PAGE_SIZE, 100),
    updateZeroStock: toBoolean(process.env.SYNC_UPDATE_ZERO_STOCK, true),
    onlyActiveHesabfaItems: toBoolean(
      process.env.SYNC_ONLY_ACTIVE_HESABFA_ITEMS,
      true,
    ),
    sourceOfTruth: process.env.SYNC_SOURCE_OF_TRUTH || "hesabfa",
    useHesabfaQuantity2: toBoolean(
      process.env.SYNC_USE_HESABFA_QUANTITY2,
      true,
    ),
    excludedBarcodes: process.env.SYNC_EXCLUDED_BARCODES || "",
    excludedNodeFamilies: toCsvSet(process.env.SYNC_EXCLUDED_NODE_FAMILIES),
    syncName: toBoolean(process.env.SYNC_NAME, false),
  },
};
