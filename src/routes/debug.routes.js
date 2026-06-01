// Path: src/routes/debug.routes.js
import { Router } from "express";
import { env } from "../config/env.js";
import { PortalService } from "../services/portal.service.js";
import { HesabfaService } from "../services/hesabfa.service.js";

const router = Router();

const portalService = new PortalService({
  baseURL: env.portal.baseUrl,
  authHeaderName: env.portal.authHeaderName,
  authHeaderValue: env.portal.authHeaderValue,
  timeout: env.sync.requestTimeoutMs,
  retries: env.sync.retryCount,
  config: env,
});

const hesabfaService = new HesabfaService({
  baseURL: env.hesabfa.baseUrl,
  apiKey: env.hesabfa.apiKey,
  loginToken: env.hesabfa.loginToken,
  userId: env.hesabfa.userId,
  password: env.hesabfa.password,
  yearId: env.hesabfa.yearId,
  timeout: env.sync.requestTimeoutMs,
  retries: env.sync.retryCount,
});

const mask = (value) => {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 8) return "****";
  return `${str.slice(0, 3)}...${str.slice(-3)}`;
};

const normalize = (value) => String(value ?? "").trim();

const normalizeBarcode = (value) =>
  normalize(value)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, "");

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toPositiveNumberOrNull = (value) => {
  const num = toNumberOrNull(value);
  if (num === null) return null;
  return num > 0 ? num : null;
};

const detectArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.Items)) return payload.Items;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.Result)) return payload.Result;
  if (Array.isArray(payload?.variants)) return payload.variants;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.List)) return payload.List;
  if (Array.isArray(payload?.list)) return payload.list;
  return null;
};

const extractHesabfaItems = (raw) => {
  const arr = detectArray(raw);
  if (Array.isArray(arr)) return arr;
  if (Array.isArray(raw?.Result?.List)) return raw.Result.List;
  if (Array.isArray(raw?.result?.list)) return raw.result.list;
  if (Array.isArray(raw?.List)) return raw.List;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
};

const normalizeInventoryRows = (rows) => {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((row) => hesabfaService.normalizeQuantity(row));
};

const findMatchedInventoryRow = ({ normalizedRows, rawRows, code }) => {
  const normalizedCode = normalize(code);
  return (
    normalizedRows.find((x) => normalize(x?.code) === normalizedCode) ||
    normalizedRows.find((x) => normalize(x?.itemCode) === normalizedCode) ||
    normalizedRows.find((x) => normalize(x?.raw?.Code) === normalizedCode) ||
    normalizedRows.find((x) => normalize(x?.raw?.code) === normalizedCode) ||
    normalizedRows.find(
      (x) => normalize(x?.raw?.ItemCode) === normalizedCode,
    ) ||
    normalizedRows.find(
      (x) => normalize(x?.raw?.itemCode) === normalizedCode,
    ) ||
    rawRows.find((x) => normalize(x?.Code) === normalizedCode) ||
    rawRows.find((x) => normalize(x?.code) === normalizedCode) ||
    rawRows.find((x) => normalize(x?.ItemCode) === normalizedCode) ||
    rawRows.find((x) => normalize(x?.itemCode) === normalizedCode) ||
    normalizedRows[0] ||
    null
  );
};

const requireMethod = (service, methodName, res) => {
  if (typeof service?.[methodName] !== "function") {
    res.status(501).json({
      success: false,
      message: `${methodName} is not implemented on service`,
    });
    return false;
  }
  return true;
};

const getFirstImplementedMethod = (service, methodNames = []) => {
  return methodNames.find((m) => typeof service?.[m] === "function") || null;
};

const normalizeInvoiceResult = (result) => {
  if (!result) return null;
  if (Array.isArray(result))
    return result.map((x) => hesabfaService.normalizeInvoice(x));
  if (Array.isArray(result?.Items))
    return result.Items.map((x) => hesabfaService.normalizeInvoice(x));
  if (Array.isArray(result?.items))
    return result.items.map((x) => hesabfaService.normalizeInvoice(x));
  if (Array.isArray(result?.List))
    return result.List.map((x) => hesabfaService.normalizeInvoice(x));
  if (Array.isArray(result?.list))
    return result.list.map((x) => hesabfaService.normalizeInvoice(x));
  return hesabfaService.normalizeInvoice(result);
};

const normalizeWarehouseReceiptResult = (result) => {
  if (!result) return null;
  if (Array.isArray(result))
    return result.map((x) => hesabfaService.normalizeWarehouseReceipt(x));
  if (Array.isArray(result?.Items))
    return result.Items.map((x) => hesabfaService.normalizeWarehouseReceipt(x));
  if (Array.isArray(result?.items))
    return result.items.map((x) => hesabfaService.normalizeWarehouseReceipt(x));
  if (Array.isArray(result?.List))
    return result.List.map((x) => hesabfaService.normalizeWarehouseReceipt(x));
  if (Array.isArray(result?.list))
    return result.list.map((x) => hesabfaService.normalizeWarehouseReceipt(x));
  return hesabfaService.normalizeWarehouseReceipt(result);
};

const extractIdListFromBody = (body) => {
  const source = Array.isArray(body?.idList)
    ? body.idList
    : Array.isArray(body?.ids)
      ? body.ids
      : Array.isArray(body?.Ids)
        ? body.Ids
        : [];
  return source.map((x) => toNumberOrNull(x)).filter((x) => x !== null);
};

const findItemByCodeFallback = async (code) => {
  const raw = await hesabfaService.getItems({
    take: 20,
    skip: 0,
    sortBy: "Code",
    sortDesc: false,
    filters: [{ property: "Code", operator: "=", value: code }],
  });
  const items = extractHesabfaItems(raw);
  return (
    items.find((item) => normalize(item?.Code) === code) ||
    items.find((item) => normalize(item?.code) === code) ||
    items[0] ||
    null
  );
};

const findItemByBarcodeFallback = async (barcode) => {
  const raw = await hesabfaService.getItems({
    take: 20,
    skip: 0,
    sortBy: "Code",
    sortDesc: false,
    filters: [{ property: "Barcode", operator: "=", value: barcode }],
  });
  const items = extractHesabfaItems(raw);
  return (
    items.find((item) => normalizeBarcode(item?.Barcode) === barcode) ||
    items.find((item) => normalizeBarcode(item?.barcode) === barcode) ||
    items[0] ||
    null
  );
};

const getItemByCodeSafe = async (code) => {
  const m = getFirstImplementedMethod(hesabfaService, [
    "getItemByCode",
    "findItemByCode",
  ]);
  if (m) return hesabfaService[m](code);
  if (typeof hesabfaService.getItems === "function")
    return findItemByCodeFallback(code);
  return null;
};

const getItemByBarcodeSafe = async (barcode) => {
  const m = getFirstImplementedMethod(hesabfaService, [
    "getItemByBarcode",
    "findItemByBarcode",
  ]);
  if (m) return hesabfaService[m](barcode);
  if (typeof hesabfaService.getItems === "function")
    return findItemByBarcodeFallback(barcode);
  return null;
};

const normalizeApiDateToIso = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];

  const d = new Date(s);
  if (isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// ─────────────────────────────────────────────
//  Root Debug
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  res.json({
    success: true,
    service: "inventory-sync",
    section: "debug",
    routes: {
      health: ["GET    /debug", "GET    /debug/ping"],
      portal: [
        "GET    /debug/portal",
        "GET    /debug/portal/variants",
        "GET    /debug/portal/manage-product/:id",
        "GET    /debug/portal/product/:sku",
        "POST   /debug/portal/variant-stock",
      ],
      hesabfaItems: [
        "GET    /debug/hesabfa/items",
        "GET    /debug/hesabfa/node-families",
        "GET    /debug/hesabfa/item/by-code/:code",
        "GET    /debug/hesabfa/item/by-barcode/:barcode",
        "GET    /debug/hesabfa/find-by-code/:code",
        "GET    /debug/hesabfa/find-by-barcode/:barcode",
      ],
      hesabfaStock: [
        "GET    /debug/hesabfa/stock/by-code/:code",
        "GET    /debug/hesabfa/stock/by-code/:code?warehouseCode=1",
        "GET    /debug/hesabfa/stock/:code",
        "GET    /debug/hesabfa/stock/:warehouseCode/:code",
      ],
      hesabfaInvoices: [
        "GET    /debug/hesabfa/invoices?type=0&take=10&skip=0",
        "GET    /debug/hesabfa/invoice/:type/:number",
        "GET    /debug/hesabfa/invoice-by-id/:id",
        "POST   /debug/hesabfa/invoice-by-ids",
        "DELETE /debug/hesabfa/invoice/:type/:number",
      ],
      hesabfaWarehouseReceipts: [
        "GET    /debug/hesabfa/warehouse/receipts?type=0&take=10&skip=0",
        "GET    /debug/hesabfa/warehouse/receipt/:number",
        "GET    /debug/hesabfa/warehouse/receipt-by-id/:id",
        "POST   /debug/hesabfa/warehouse/receipt-by-ids",
        "POST   /debug/hesabfa/warehouse/receipt",
        "DELETE /debug/hesabfa/warehouse/receipt/:number",
        "POST   /debug/hesabfa/invoice/warehouse-receipt",
      ],
      legacy: [
        "POST   /debug/hesabfa/test-add/:code",
        "GET    /debug/hesabfa/probe",
        "POST   /debug/hesabfa/test-add-probe/:code",
        "GET    /debug/hesabfa/invoices-test",
      ],
    },
  });
});

router.get("/ping", async (req, res) => {
  res.json({
    success: true,
    message: "debug routes are loaded",
    time: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
//  Portal Routes
// ─────────────────────────────────────────────
router.get("/portal", async (req, res, next) => {
  try {
    const raw = await portalService.http.get(
      "/site/api/v1/store/products?page=1&size=3",
    );
    const arr = detectArray(raw);
    res.json({
      success: true,
      info: "Portal public API test",
      config: {
        baseURL: env.portal.baseUrl,
        authHeaderName: env.portal.authHeaderName,
        authHeaderValueMasked: mask(env.portal.authHeaderValue),
      },
      rawType: Array.isArray(raw) ? "array" : typeof raw,
      detectedArrayLength: arr ? arr.length : 0,
      preview: Array.isArray(arr) ? arr.slice(0, 3) : raw,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/portal/variants", async (req, res, next) => {
  try {
    if (!requireMethod(portalService, "getAllVariants", res)) return;
    const pageSize = Number(req.query.pageSize || 20);
    const variants = await portalService.getAllVariants({ pageSize });
    res.json({
      success: true,
      count: variants.length,
      withBarcodeCount: variants.filter((v) => normalizeBarcode(v.barcode))
        .length,
      withoutBarcodeCount: variants.filter((v) => !normalizeBarcode(v.barcode))
        .length,
      preview: variants.slice(0, 20).map((v) => ({
        id: v.id,
        productId: v.productId,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        normalizedBarcode: normalizeBarcode(v.barcode),
        stock: v.stock,
        price: v.price,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/portal/manage-product/:id", async (req, res, next) => {
  try {
    const id = normalize(req.params.id);
    const raw = await portalService.http.get(
      `/site/api/v1/manage/store/products/${id}`,
    );
    const product = raw?.product ?? raw;
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    res.json({
      success: true,
      productId: id,
      variantCount: variants.length,
      skuCount: variants.filter((v) => normalize(v?.sku)).length,
      preview: {
        id: product?.id,
        title: product?.title,
        variants: variants.map((v) => ({
          id: v.id,
          productId: v.product_id ?? v.productId,
          title: v.title,
          sku: v.sku ?? null,
          barcode: v.barcode ?? null,
          stock: v.stock ?? null,
        })),
      },
      raw,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/portal/product/:sku", async (req, res, next) => {
  try {
    const sku = normalize(req.params.sku);
    const normalizedSku = normalizeBarcode(sku);

    if (typeof portalService.getProductBySku === "function") {
      const result = await portalService.getProductBySku(sku);
      return res.json({
        success: true,
        action: "getProductBySku",
        sku,
        result,
      });
    }

    if (!requireMethod(portalService, "getAllVariants", res)) return;
    const variants = await portalService.getAllVariants({ pageSize: 100 });
    const matches = variants.filter((v) => {
      const vSku = normalize(v?.sku);
      const vBarcode = normalizeBarcode(v?.barcode);
      return (
        vSku === sku ||
        normalizeBarcode(vSku) === normalizedSku ||
        vBarcode === normalizedSku
      );
    });

    res.json({
      success: true,
      action: "fallback_find_variant_by_sku_or_barcode",
      sku,
      normalizedSku,
      count: matches.length,
      matches,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/portal/variant-stock", async (req, res, next) => {
  try {
    const variantId = toNumberOrNull(req.body?.variantId);
    const stock = toNumberOrNull(req.body?.stock);

    if (!variantId)
      return res.status(400).json({
        success: false,
        message: "variantId is required and must be a valid number",
      });
    if (stock === null)
      return res.status(400).json({
        success: false,
        message: "stock is required and must be a valid number",
      });

    if (!requireMethod(portalService, "updateVariantStock", res)) return;
    const result = await portalService.updateVariantStock(variantId, stock);

    res.json({
      success: true,
      action: "updateVariantStock",
      input: { variantId, stock },
      result,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  Hesabfa Item Routes
// ─────────────────────────────────────────────
router.get("/hesabfa/items", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getItems", res)) return;

    const take = Number(req.query.take || 5);
    const skip = Number(req.query.skip || 0);
    const sortBy = normalize(req.query.sortBy || "Code");
    const sortDesc =
      String(req.query.sortDesc ?? "false").toLowerCase() === "true";

    const raw = await hesabfaService.getItems({
      take,
      skip,
      sortBy,
      sortDesc,
      filters: [],
    });
    const items = extractHesabfaItems(raw);
    const normalized = items.map((item) => hesabfaService.normalizeItem(item));

    res.json({
      success: true,
      count: items.length,
      preview: items.slice(0, take),
      normalizedPreview: normalized.slice(0, take),
      config: {
        baseURL: env.hesabfa.baseUrl,
        apiKeyMasked: mask(env.hesabfa.apiKey),
      },
      raw,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  ★ NODE FAMILIES — endpoint جدید
// ─────────────────────────────────────────────
router.get("/hesabfa/node-families", async (req, res, next) => {
  try {
    const pageSize = 100;
    const familyMap = {};
    const nodeNameSet = new Set();
    let skip = 0;
    let totalFetched = 0;

    while (true) {
      const raw = await hesabfaService.getItems({
        take: pageSize,
        skip,
        sortBy: "Code",
        sortDesc: false,
        filters: [],
      });

      // استخراج آیتم‌ها از هر فرمت ممکن
      const items =
        (Array.isArray(raw?.List) ? raw.List : null) ||
        (Array.isArray(raw?.Items) ? raw.Items : null) ||
        (Array.isArray(raw?.items) ? raw.items : null) ||
        (Array.isArray(raw) ? raw : []);

      if (!items.length) break;

      for (const item of items) {
        const family = String(
          item?.NodeFamily || item?.nodeFamily || "",
        ).trim();
        const nodeName = String(item?.NodeName || item?.nodeName || "").trim();
        if (family) {
          familyMap[family] = (familyMap[family] || 0) + 1;
        }
        if (nodeName) nodeNameSet.add(nodeName);
      }

      totalFetched += items.length;
      if (items.length < pageSize) break;
      skip += pageSize;
    }

    const families = Object.entries(familyMap)
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => a.family.localeCompare(b.family, "fa"));

    const nodeNames = [...nodeNameSet].sort((a, b) => a.localeCompare(b, "fa"));

    res.json({
      success: true,
      totalItems: totalFetched,
      uniqueFamiliesCount: families.length,
      uniqueNodeNamesCount: nodeNames.length,
      families,
      nodeNames,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/item/by-code/:code", async (req, res, next) => {
  try {
    const code = normalize(req.params.code);
    const item = await getItemByCodeSafe(code);
    const normalized = item ? hesabfaService.normalizeItem(item) : null;
    res.json({
      success: true,
      route: "/hesabfa/item/by-code/:code",
      inputCode: code,
      found: Boolean(item),
      item: item || null,
      normalized,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/item/by-barcode/:barcode", async (req, res, next) => {
  try {
    const barcode = normalizeBarcode(req.params.barcode);
    const item = await getItemByBarcodeSafe(barcode);
    const normalized = item ? hesabfaService.normalizeItem(item) : null;
    res.json({
      success: true,
      route: "/hesabfa/item/by-barcode/:barcode",
      inputBarcode: barcode,
      found: Boolean(item),
      item: item || null,
      normalized,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/find-by-code/:code", async (req, res, next) => {
  try {
    const code = normalize(req.params.code);
    const item = await getItemByCodeSafe(code);
    const normalized = item ? hesabfaService.normalizeItem(item) : null;
    res.json({
      success: true,
      route: "/hesabfa/find-by-code/:code",
      inputCode: code,
      found: Boolean(item),
      item: item || null,
      normalized,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/find-by-barcode/:barcode", async (req, res, next) => {
  try {
    const barcode = normalizeBarcode(req.params.barcode);
    const item = await getItemByBarcodeSafe(barcode);
    const normalized = item ? hesabfaService.normalizeItem(item) : null;
    res.json({
      success: true,
      route: "/hesabfa/find-by-barcode/:barcode",
      inputBarcode: barcode,
      found: Boolean(item),
      item: item || null,
      normalized,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  Hesabfa Stock Routes
// ─────────────────────────────────────────────
router.get("/hesabfa/stock/by-code/:code", async (req, res, next) => {
  try {
    const code = normalize(req.params.code);
    const warehouseCodeRaw = req.query.warehouseCode;
    if (!requireMethod(hesabfaService, "getInventory", res)) return;

    let warehouseCode = null;
    if (
      warehouseCodeRaw !== undefined &&
      warehouseCodeRaw !== null &&
      String(warehouseCodeRaw).trim() !== ""
    ) {
      warehouseCode = toNumberOrNull(warehouseCodeRaw);
      if (warehouseCode === null)
        return res.status(400).json({
          success: false,
          message: "warehouseCode must be a valid number",
        });
    }

    const rows = await hesabfaService.getInventory({
      ...(warehouseCode !== null ? { warehouseCode } : {}),
      codes: [code],
    });
    const rawRows = Array.isArray(rows) ? rows : [];
    const normalizedRows = normalizeInventoryRows(rawRows);
    const matched = findMatchedInventoryRow({ normalizedRows, rawRows, code });
    const item = await getItemByCodeSafe(code);
    const normalizedItem = item ? hesabfaService.normalizeItem(item) : null;

    res.json({
      success: true,
      route: "/hesabfa/stock/by-code/:code",
      input: { code, warehouseCode },
      itemStock: item?.Stock ?? item?.stock ?? normalizedItem?.stock ?? null,
      inventoryMatched: matched,
      count: rawRows.length,
      normalizedRows,
      rows: rawRows,
      item: item || null,
      normalizedItem,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/stock/:code", async (req, res, next) => {
  try {
    const code = normalize(req.params.code);
    if (!requireMethod(hesabfaService, "getInventory", res)) return;

    const rows = await hesabfaService.getInventory({ codes: [code] });
    const rawRows = Array.isArray(rows) ? rows : [];
    const normalizedRows = normalizeInventoryRows(rawRows);
    const matched = findMatchedInventoryRow({ normalizedRows, rawRows, code });
    const item = await getItemByCodeSafe(code);
    const normalizedItem = item ? hesabfaService.normalizeItem(item) : null;

    res.json({
      success: true,
      route: "/hesabfa/stock/:code",
      input: { code },
      itemStock: item?.Stock ?? item?.stock ?? normalizedItem?.stock ?? null,
      inventoryMatched: matched,
      count: rawRows.length,
      normalizedRows,
      rows: rawRows,
      item: item || null,
      normalizedItem,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/stock/:warehouseCode/:code", async (req, res, next) => {
  try {
    const warehouseCode = toNumberOrNull(req.params.warehouseCode);
    const code = normalize(req.params.code);

    if (warehouseCode === null)
      return res.status(400).json({
        success: false,
        message: "warehouseCode must be a valid number",
      });
    if (!requireMethod(hesabfaService, "getInventory", res)) return;

    const rows = await hesabfaService.getInventory({
      warehouseCode,
      codes: [code],
    });
    const rawRows = Array.isArray(rows) ? rows : [];
    const normalizedRows = normalizeInventoryRows(rawRows);
    const matched = findMatchedInventoryRow({ normalizedRows, rawRows, code });
    const item = await getItemByCodeSafe(code);
    const normalizedItem = item ? hesabfaService.normalizeItem(item) : null;

    res.json({
      success: true,
      route: "/hesabfa/stock/:warehouseCode/:code",
      input: { warehouseCode, code },
      itemStock: item?.Stock ?? item?.stock ?? normalizedItem?.stock ?? null,
      inventoryMatched: matched,
      count: rawRows.length,
      normalizedRows,
      rows: rawRows,
      item: item || null,
      normalizedItem,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  Hesabfa Invoice Routes
// ─────────────────────────────────────────────
router.get("/hesabfa/invoices", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getInvoices", res)) return;

    const type = toNumberOrNull(req.query.type);
    const take = Number(req.query.take || 20);
    const skip = Number(req.query.skip || 0);
    const sortBy = normalize(req.query.sortBy || "Date");
    const sortDesc =
      String(req.query.sortDesc ?? "true").toLowerCase() !== "false";

    if (type === null)
      return res.status(400).json({
        success: false,
        message: "type query param is required and must be a valid number",
      });

    const result = await hesabfaService.getInvoices({
      type,
      take,
      skip,
      sortBy,
      sortDesc,
      filters: [],
    });
    const rawList = Array.isArray(result)
      ? result
      : result?.Items || result?.items || result?.List || result?.list || [];
    const normalizedList = rawList.map((x) =>
      hesabfaService.normalizeInvoice(x),
    );

    res.json({
      success: true,
      input: { type, take, skip, sortBy, sortDesc },
      count: rawList.length,
      preview: rawList.slice(0, take),
      normalizedPreview: normalizedList.slice(0, take),
      raw: result,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/invoice/:type/:number", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getInvoice", res)) return;
    const type = toNumberOrNull(req.params.type);
    const number = normalize(req.params.number);
    if (type === null)
      return res
        .status(400)
        .json({ success: false, message: "type must be a valid number" });
    const result = await hesabfaService.getInvoice(number, type);
    const normalized = normalizeInvoiceResult(result);
    res.json({ success: true, input: { type, number }, result, normalized });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/invoice-by-id/:id", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getInvoiceById", res)) return;
    const id = toNumberOrNull(req.params.id);
    if (id === null)
      return res
        .status(400)
        .json({ success: false, message: "id must be a valid number" });
    const result = await hesabfaService.getInvoiceById({ id });
    const normalized = normalizeInvoiceResult(result);
    res.json({ success: true, input: { id }, result, normalized });
  } catch (err) {
    next(err);
  }
});

router.post("/hesabfa/invoice-by-ids", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getInvoiceById", res)) return;
    const idList = extractIdListFromBody(req.body);
    if (!idList.length)
      return res.status(400).json({
        success: false,
        message: "body.idList or body.ids must be a non-empty array of numbers",
      });
    const result = await hesabfaService.getInvoiceById({ idList });
    const normalized = normalizeInvoiceResult(result);
    res.json({ success: true, input: { idList }, result, normalized });
  } catch (err) {
    next(err);
  }
});

router.delete("/hesabfa/invoice/:type/:number", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "deleteInvoice", res)) return;
    const type = toNumberOrNull(req.params.type);
    const number = normalize(req.params.number);
    if (type === null)
      return res
        .status(400)
        .json({ success: false, message: "type must be a valid number" });
    const result = await hesabfaService.deleteInvoice(number, type);
    res.json({
      success: true,
      action: "deleteInvoice",
      input: { type, number },
      result,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  Hesabfa Warehouse Routes
// ─────────────────────────────────────────────
router.get("/hesabfa/warehouse/receipts", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getWarehouseReceipts", res)) return;

    const type = toNumberOrNull(req.query.type);
    const take = Number(req.query.take || 20);
    const skip = Number(req.query.skip || 0);
    const sortBy = normalize(req.query.sortBy || "Date");
    const sortDesc =
      String(req.query.sortDesc ?? "true").toLowerCase() !== "false";

    if (type === null)
      return res.status(400).json({
        success: false,
        message: "type query param is required and must be a valid number",
      });

    const result = await hesabfaService.getWarehouseReceipts({
      type,
      take,
      skip,
      sortBy,
      sortDesc,
      filters: [],
    });
    const rawList = Array.isArray(result)
      ? result
      : result?.Items || result?.items || result?.List || result?.list || [];
    const normalizedList = rawList.map((x) =>
      hesabfaService.normalizeWarehouseReceipt(x),
    );

    res.json({
      success: true,
      input: { type, take, skip, sortBy, sortDesc },
      count: rawList.length,
      preview: rawList.slice(0, take),
      normalizedPreview: normalizedList.slice(0, take),
      raw: result,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/warehouse/receipt/:number", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getWarehouseReceipt", res)) return;
    const number = normalize(req.params.number);
    const result = await hesabfaService.getWarehouseReceipt(number);
    const normalized = normalizeWarehouseReceiptResult(result);
    res.json({
      success: true,
      action: "getWarehouseReceipt",
      number,
      result,
      normalized,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/warehouse/receipt-by-id/:id", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getWarehouseReceiptById", res)) return;
    const id = toNumberOrNull(req.params.id);
    if (id === null)
      return res
        .status(400)
        .json({ success: false, message: "id must be a valid number" });
    const result = await hesabfaService.getWarehouseReceiptById({ id });
    const normalized = normalizeWarehouseReceiptResult(result);
    res.json({ success: true, input: { id }, result, normalized });
  } catch (err) {
    next(err);
  }
});

router.post("/hesabfa/warehouse/receipt-by-ids", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "getWarehouseReceiptById", res)) return;
    const idList = extractIdListFromBody(req.body);
    if (!idList.length)
      return res.status(400).json({
        success: false,
        message: "body.idList or body.ids must be a non-empty array of numbers",
      });
    const result = await hesabfaService.getWarehouseReceiptById({ idList });
    const normalized = normalizeWarehouseReceiptResult(result);
    res.json({ success: true, input: { idList }, result, normalized });
  } catch (err) {
    next(err);
  }
});

router.post("/hesabfa/warehouse/receipt", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "saveWarehouseReceipt", res)) return;
    const payload =
      req.body?.receipt !== undefined
        ? req.body
        : {
            receipt: req.body,
            deleteOldReceipts: Boolean(req.body?.deleteOldReceipts),
          };
    const result = await hesabfaService.saveWarehouseReceipt(payload);
    res.json({
      success: true,
      action: "saveWarehouseReceipt",
      requestBody: req.body,
      result,
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/hesabfa/warehouse/receipt/:number", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "deleteWarehouseReceipt", res)) return;
    const number = normalize(req.params.number);
    const result = await hesabfaService.deleteWarehouseReceipt(number);
    res.json({
      success: true,
      action: "deleteWarehouseReceipt",
      number,
      result,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/hesabfa/invoice/warehouse-receipt", async (req, res, next) => {
  try {
    if (!requireMethod(hesabfaService, "saveInvoiceWarehouseReceipt", res))
      return;
    const payload =
      req.body?.receipt !== undefined
        ? req.body
        : {
            receipt: req.body,
            deleteOldReceipts: Boolean(req.body?.deleteOldReceipts),
          };
    const result = await hesabfaService.saveInvoiceWarehouseReceipt(payload);
    res.json({
      success: true,
      action: "saveInvoiceWarehouseReceipt",
      requestBody: req.body,
      result,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  Legacy / Probe Routes
// ─────────────────────────────────────────────
router.post("/hesabfa/test-add/:code", async (req, res, next) => {
  try {
    const code = normalize(req.params.code);
    const warehouseCode = toPositiveNumberOrNull(req.body?.warehouseCode) || 11;
    const quantity = toNumberOrNull(req.body?.quantity) ?? 1;
    const description = normalize(req.body?.description || "Sync test +1");

    const result = await hesabfaService.call("/warehouse/enter", {
      document: {
        WarehouseCode: warehouseCode,
        Description: description,
        Items: [{ ItemCode: code, Quantity: quantity, UnitPrice: 0 }],
      },
    });

    res.json({
      success: true,
      warning:
        "This is a legacy test route. Prefer POST /debug/hesabfa/warehouse/receipt",
      input: { code, warehouseCode, quantity, description },
      result,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/probe", async (req, res, next) => {
  try {
    const paths = [
      "/item/getItems",
      "item/getItems",
      "/invoice/getInvoices",
      "invoice/getInvoices",
      "/warehouse/getReceipts",
      "warehouse/getReceipts",
      "/warehouse/save",
      "/warehouse/enter",
      "warehouse/enter",
    ];
    const results = [];

    for (const path of paths) {
      try {
        const response = await hesabfaService.http.client.post(path, {
          apiKey: env.hesabfa.apiKey,
          loginToken: env.hesabfa.loginToken,
          queryInfo: { take: 1, skip: 0 },
          type: 0,
          number: 1,
        });
        results.push({
          path,
          ok: true,
          status: response.status,
          dataPreview: response.data,
        });
      } catch (error) {
        results.push({
          path,
          ok: false,
          status: error?.response?.status || null,
          dataPreview: error?.response?.data || null,
          message: error.message,
        });
      }
    }

    res.json({ success: true, baseURL: env.hesabfa.baseUrl, results });
  } catch (err) {
    next(err);
  }
});

router.get("/hesabfa/invoices-test", (req, res) => {
  res.json({ success: true, message: "invoices route file is loaded" });
});

router.post("/hesabfa/test-add-probe/:code", async (req, res, next) => {
  try {
    const code = normalize(req.params.code);
    const candidates = [
      "/warehouse/enter",
      "warehouse/enter",
      "/api/warehouse/enter",
      "api/warehouse/enter",
    ];
    const warehouseCode = toPositiveNumberOrNull(req.body?.warehouseCode) || 11;
    const quantity = toNumberOrNull(req.body?.quantity) ?? 1;
    const description = normalize(req.body?.description || "Sync test +1");
    const body = {
      apiKey: env.hesabfa.apiKey,
      loginToken: env.hesabfa.loginToken,
      document: {
        WarehouseCode: warehouseCode,
        Description: description,
        Items: [{ ItemCode: code, Quantity: quantity, UnitPrice: 0 }],
      },
    };
    const results = [];

    for (const path of candidates) {
      try {
        const response = await hesabfaService.http.client.post(path, body);
        results.push({
          path,
          ok: true,
          status: response.status,
          data: response.data,
        });
      } catch (error) {
        results.push({
          path,
          ok: false,
          status: error?.response?.status || null,
          data: error?.response?.data || null,
          message: error.message,
        });
      }
    }

    res.json({
      success: true,
      baseURL: env.hesabfa.baseUrl,
      input: { code, warehouseCode, quantity, description },
      results,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/hesabfa/set-opening-quantity", async (req, res, next) => {
  try {
    const code = String(req.body?.code ?? "").trim();
    const quantity = Number(req.body?.quantity);
    const warehouseCode = toNumberOrNull(req.body?.warehouseCode) ?? 11;
    const unitPrice = Number(req.body?.unitPrice ?? 0);

    if (!code)
      return res
        .status(400)
        .json({ success: false, message: "code is required" });
    if (!Number.isFinite(quantity) || quantity < 0)
      return res.status(400).json({
        success: false,
        message: "quantity must be a non-negative number",
      });

    const result = await hesabfaService.call("/item/UpdateOpeningQuantity", {
      items: [{ code, quantity, unitPrice, warehouseCode }],
    });
    res.json({
      success: true,
      action: "UpdateOpeningQuantity",
      input: { code, quantity, warehouseCode, unitPrice },
      result,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/portal/variant/:variantId/set-stock/:stock",
  async (req, res, next) => {
    try {
      const variantId = Number(req.params.variantId);
      const stock = Number(req.params.stock);

      if (!Number.isFinite(variantId) || variantId <= 0)
        return res
          .status(400)
          .json({ success: false, message: "invalid variantId" });
      if (!Number.isFinite(stock) || stock < 0)
        return res
          .status(400)
          .json({ success: false, message: "invalid stock value" });

      const result = await portalService.updateVariantStock(variantId, stock);
      res.json({ success: true, variantId, stock, result });
    } catch (err) {
      next(err);
    }
  },
);
// در فایل src/routes/debug.routes.js اضافه کن:
router.get("/cash-accounts", async (req, res, next) => {
  try {
    const result = await hesabfaService.call("/setting/getAccounts", {});

    const raw = Array.isArray(result)
      ? result
      : (result?.Items ?? result?.items ?? result?.List ?? result?.list ?? []);

    // فیلتر فقط صندوق‌ها — DetailType=3
    const cashAccounts = raw.filter(
      (a) => a.DetailType === 3 || String(a.Name ?? "").includes("صندوق"),
    );

    res.json({
      success: true,
      hint: "حساب‌های صندوق در cashAccounts هستند — Code را در HESABFA_CASH_CODE بگذار",
      cashAccounts,
      allCount: raw.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
// Hesabfa Fiscal Debug
// ─────────────────────────────────────────────

router.get("/hesabfa/fiscal", async (req, res) => {
  try {
    const [businessInfoResult, fiscalYearResult] = await Promise.allSettled([
      hesabfaService.call("/setting/getBusinessInfo", {}),
      hesabfaService.call("/setting/getFiscalYear", {}),
    ]);

    const businessInfo =
      businessInfoResult.status === "fulfilled"
        ? businessInfoResult.value
        : {
            error:
              businessInfoResult.reason?.message ??
              String(businessInfoResult.reason),
          };

    const fiscalYear =
      fiscalYearResult.status === "fulfilled"
        ? fiscalYearResult.value
        : {
            error:
              fiscalYearResult.reason?.message ??
              String(fiscalYearResult.reason),
          };

    const fyRaw =
      fiscalYear?.Result ??
      fiscalYear?.result ??
      fiscalYear?.FiscalYear ??
      fiscalYear ??
      null;

    const startDate = normalizeApiDateToIso(
      fyRaw?.StartDate ?? fyRaw?.startDate ?? fyRaw?.start,
    );

    const endDate = normalizeApiDateToIso(
      fyRaw?.EndDate ?? fyRaw?.endDate ?? fyRaw?.end,
    );

    const probeDate = String(req.query.date || "2026-04-08").trim();

    return res.json({
      success: true,
      probeDate,
      inRange:
        !!startDate &&
        !!endDate &&
        probeDate >= startDate &&
        probeDate <= endDate,
      fiscalRange: {
        startDate,
        endDate,
      },
      raw: {
        fiscalYear,
        businessInfo,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message ?? "fiscal debug failed",
      details: err?.details ?? null,
    });
  }
});

router.post("/hesabfa/invoice-probe", async (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || !payload.invoice) {
      return res.status(400).json({
        success: false,
        message: "payload.invoice is required",
      });
    }

    const result = await hesabfaService.call("/invoice/save", payload);

    return res.json({
      success: true,
      result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message ?? "invoice probe failed",
      details: err?.details ?? null,
    });
  }
});
export default router;
