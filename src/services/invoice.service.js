import { env } from "../config/env.js";
import fs from "fs";
import path from "path";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toSafeString = (v) =>
  v === null || v === undefined ? "" : String(v).trim();

const hasValue = (v) => v !== null && v !== undefined && v !== "";
const pad2 = (v) => String(v).padStart(2, "0");

const toHesabfaDateTime = (raw) => {
  let d;
  if (!raw) d = new Date();
  else if (typeof raw === "number") d = new Date(raw * 1000);
  else if (raw instanceof Date) d = raw;
  else d = new Date(raw);
  if (isNaN(d.getTime())) d = new Date();
  return [
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
  ].join(" ");
};

const toHesabfaDate = (raw) => toHesabfaDateTime(raw).slice(0, 10);
const todayIso = () => toHesabfaDate(new Date());

const normalizeApiDateToIso = (raw) => {
  const s = toSafeString(raw);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const toHesabfaItemName = (raw) => {
  if (!raw) return "کالای ناشناس";
  return String(raw)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 200);
};

const PAID_STATUSES = new Set([
  "completed",
  "fulfilled",
  "paid",
  "approved",
  "انجام شده",
  "تکمیل شده",
]);

const isOrderPaid = (order) => {
  const raw =
    order?.status ??
    order?.order_status ??
    order?.payment_status ??
    order?.statuses ??
    [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.some((s) => PAID_STATUSES.has(toSafeString(s).toLowerCase()));
};

const extractOrderDate = (order) =>
  order?.created?.timestamp ||
  order?.created?.universal ||
  order?.paid_at ||
  order?.created_at ||
  order?.date ||
  null;

const extractOrderId = (order) =>
  order?.id ??
  order?.order_id ??
  order?.reference ??
  order?.number ??
  "unknown";

// ─── Persistent storage ────────────────────────────────────────────────────────
// FIX: به‌جای Map در RAM، از فایل JSON استفاده می‌کنیم تا بین restart/cycle باقی بماند

const PROCESSED_FILE = path.resolve(
  process.env.PROCESSED_ORDERS_FILE ?? "./data/processed-orders.json",
);

function _loadProcessedOrders() {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      const raw = fs.readFileSync(PROCESSED_FILE, "utf8");
      return new Map(Object.entries(JSON.parse(raw)));
    }
  } catch (err) {
    console.warn(
      "[InvoiceService] Could not load processed-orders.json:",
      err?.message,
    );
  }
  return new Map();
}

function _saveProcessedOrders(map) {
  try {
    const dir = path.dirname(PROCESSED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      PROCESSED_FILE,
      JSON.stringify(Object.fromEntries(map), null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn(
      "[InvoiceService] Could not save processed-orders.json:",
      err?.message,
    );
  }
}

// singleton در سطح module — یک بار load می‌شود
const _processedOrders = _loadProcessedOrders();
const _itemCodeCache = new Map();

// ─── Constants ─────────────────────────────────────────────────────────────────
const HESABFA_CASH_CODE = process.env.HESABFA_CASH_CODE ?? "0009";
const HESABFA_WAREHOUSE_CODE = process.env.HESABFA_WAREHOUSE_CODE ?? "11";
const DEFAULT_ITEM_TYPE = Number(process.env.HESABFA_DEFAULT_ITEM_TYPE ?? 0);

// ─── InvoiceService ────────────────────────────────────────────────────────────

export class InvoiceService {
  constructor({ portalService, hesabfaService, customerService, config }) {
    if (!portalService) throw new Error("portalService is required");
    if (!hesabfaService) throw new Error("hesabfaService is required");
    if (!customerService) throw new Error("customerService is required");

    this.portal = portalService;
    this.hesabfa = hesabfaService;
    this.customer = customerService;
    this.config = config ?? {};
    this._fiscalPeriodCache = null;
  }

  get priceDivisor() {
    const v = Number(
      this.config?.hesabfa?.priceDivisor ??
        process.env.HESABFA_PRICE_DIVISOR ??
        1,
    );
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  get autoCreateItems() {
    return Boolean(
      this.config?.hesabfa?.allowAutoCreateItems ??
      env?.hesabfa?.allowAutoCreateItems ??
      false,
    );
  }

  get enableWarehouseReceipt() {
    return (
      this.config?.hesabfa?.enableWarehouseReceipt ??
      env?.hesabfa?.enableWarehouseReceipt ??
      true
    );
  }

  get enablePaymentReceipt() {
    return (
      this.config?.hesabfa?.enablePaymentReceipt ??
      env?.hesabfa?.enablePaymentReceipt ??
      true
    );
  }

  get invoiceType() {
    // FIX: باید 0 باشد (فروش)، نه 1 (خرید)
    const v = Number(this.config?.hesabfa?.invoiceType ?? 0);
    if (v !== 0) {
      console.warn(
        `[InvoiceService] WARNING: invoiceType=${v} — expected 0 for sales invoice!`,
      );
    }
    return v;
  }

  convertPortalMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * this.priceDivisor);
  }

  _extractList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.List)) return result.List;
    if (Array.isArray(result?.list)) return result.list;
    if (Array.isArray(result?.Items)) return result.Items;
    if (Array.isArray(result?.items)) return result.items;
    return [];
  }

  _extractInvoiceNumber(result) {
    return toSafeString(
      result?.Number ??
        result?.number ??
        result?.InvoiceNumber ??
        result?.invoiceNumber ??
        "",
    );
  }

  // ─── Persistent state management ──────────────────────────────────────────

  _getProcessedState(orderId) {
    return _processedOrders.get(String(orderId)) ?? null;
  }

  _setProcessedState(orderId, patch) {
    const key = String(orderId);
    const current = this._getProcessedState(key) ?? {
      orderId: key,
      invoiceCreated: false,
      warehouseIssued: false,
      paymentSaved: false,
      invoiceNumber: null,
      updatedAt: null,
    };
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    _processedOrders.set(key, next);
    // FIX: بلافاصله روی دیسک ذخیره می‌کنیم
    _saveProcessedOrders(_processedOrders);
    return next;
  }

  // ─── Portal API ────────────────────────────────────────────────────────────

  async getPortalOrders({ page = 1, size = 50, status } = {}) {
    let path = `/site/api/v1/manage/store/orders?page=${page}&size=${size}`;
    if (status) path += `&status=${encodeURIComponent(status)}`;
    const response = await this.portal.http.get(path);
    if (Array.isArray(response))
      return { orders: response, total: response.length };
    if (Array.isArray(response?.orders))
      return {
        orders: response.orders,
        total: response.total ?? response.orders.length,
      };
    if (Array.isArray(response?.data))
      return {
        orders: response.data,
        total: response.total ?? response.data.length,
      };
    return { orders: [], total: 0 };
  }

  async getPortalOrder(orderId) {
    const response = await this.portal.http.get(
      `/site/api/v1/manage/store/orders/${encodeURIComponent(String(orderId))}`,
    );
    return response?.order ?? response?.data ?? response;
  }

  // ─── Hesabfa duplicate detection ──────────────────────────────────────────

  async findInvoicesByOrderId(orderId) {
    const ref = `order_${orderId}`;
    const tag = `portal_order_${orderId}`;

    const checks = [
      {
        type: this.invoiceType,
        queryInfo: {
          take: 10,
          skip: 0,
          sortBy: "Date",
          sortDesc: true,
          filters: [{ property: "Reference", operator: "=", value: ref }],
        },
      },
      {
        type: this.invoiceType,
        queryInfo: {
          take: 10,
          skip: 0,
          sortBy: "Date",
          sortDesc: true,
          filters: [{ property: "Tag", operator: "=", value: tag }],
        },
      },
    ];

    const found = [];

    for (const payload of checks) {
      try {
        const result = await this.hesabfa.call("/invoice/getInvoices", payload);
        const list = this._extractList(result);
        for (const invoice of list) {
          const invoiceNumber = this._extractInvoiceNumber(invoice);
          if (!invoiceNumber) continue;
          if (
            !found.some((x) => this._extractInvoiceNumber(x) === invoiceNumber)
          ) {
            found.push(invoice);
          }
        }
      } catch (err) {
        // FIX: خطا را log می‌کنیم اما ادامه می‌دهیم — نتیجه خالی باقی می‌ماند
        console.warn(
          `[InvoiceService] findInvoicesByOrderId warning for ${orderId}:`,
          err?.message ?? err,
        );
      }
    }

    return found;
  }

  async isOrderAlreadyInvoiced(orderId) {
    // FIX: مرحله اول — چک فایل persistent (نه RAM که ممکن بود پاک شود)
    const local = this._getProcessedState(orderId);
    if (local?.invoiceCreated && hasValue(local?.invoiceNumber)) {
      console.log(
        `[InvoiceService] Order ${orderId} found in persistent cache — skipping`,
      );
      return { Number: local.invoiceNumber, Source: "persistent-cache" };
    }

    // FIX: مرحله دوم — با retry به حسابفا query می‌زنیم
    let found = [];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        found = await this.findInvoicesByOrderId(orderId);
        break; // موفق شد
      } catch (err) {
        if (attempts >= maxAttempts) {
          // FIX: بعد از همه retry ها هنوز خطا → SAFE ABORT (ثبت نمی‌کنیم)
          throw new Error(
            `[InvoiceService] Cannot verify invoice existence for order ${orderId} after ${maxAttempts} attempts. Aborting to prevent duplicate. Last error: ${err?.message}`,
          );
        }
        console.warn(
          `[InvoiceService] Retry ${attempts}/${maxAttempts} for order ${orderId}:`,
          err?.message,
        );
        await new Promise((r) => setTimeout(r, 1000 * attempts)); // backoff
      }
    }

    if (found.length > 0) {
      const invoiceNumber = this._extractInvoiceNumber(found[0]);
      // FIX: نتیجه را در persistent cache ذخیره می‌کنیم
      this._setProcessedState(orderId, { invoiceCreated: true, invoiceNumber });
      return found[0];
    }

    return null;
  }

  // ─── Fiscal period ─────────────────────────────────────────────────────────

  async _getActiveFiscalPeriod() {
    if (this._fiscalPeriodCache) return this._fiscalPeriodCache;
    try {
      const fiscal = await this.hesabfa.call("/setting/getFiscalYear", {});
      const start = normalizeApiDateToIso(
        fiscal?.StartDate ?? fiscal?.startDate ?? fiscal?.start,
      );
      const end = normalizeApiDateToIso(
        fiscal?.EndDate ?? fiscal?.endDate ?? fiscal?.end,
      );
      if (start && end) {
        this._fiscalPeriodCache = { start, end };
        return this._fiscalPeriodCache;
      }
    } catch (err) {
      console.warn(
        "[InvoiceService] getFiscalYear failed:",
        err?.message ?? err,
      );
    }
    try {
      const business = await this.hesabfa.call("/setting/getBusinessInfo", {});
      const start = normalizeApiDateToIso(
        business?.StartDate ?? business?.startDate,
      );
      const end = normalizeApiDateToIso(business?.EndDate ?? business?.endDate);
      if (start && end) {
        this._fiscalPeriodCache = { start, end };
        return this._fiscalPeriodCache;
      }
    } catch (err) {
      console.warn(
        "[InvoiceService] getBusinessInfo failed:",
        err?.message ?? err,
      );
    }
    return null;
  }

  async _safeInvoiceDate(raw) {
    const today = todayIso();
    const candidate = raw ? toHesabfaDate(raw) : today;
    const period = await this._getActiveFiscalPeriod();
    if (period) {
      if (candidate < period.start) return period.start;
      if (candidate > period.end) return today;
    }
    if (candidate > today) return today;
    return candidate;
  }

  // ─── Item code ─────────────────────────────────────────────────────────────

  async resolveItemCode(sku, productName, unitPrice) {
    const safeSku = toSafeString(sku);
    const safeName = toHesabfaItemName(productName);
    const cacheKey = (safeSku || safeName).toLowerCase().trim();

    if (_itemCodeCache.has(cacheKey)) return _itemCodeCache.get(cacheKey);
    if (!hasValue(safeSku)) {
      throw new Error(
        `[InvoiceService] sku is required for item "${safeName}"`,
      );
    }

    try {
      const res = await this.hesabfa.call("/item/getItems", {
        queryInfo: {
          take: 10,
          skip: 0,
          filters: [{ property: "Code", operator: "=", value: safeSku }],
        },
      });
      const list = this._extractList(res);
      const found = list.find(
        (x) => toSafeString(x?.Code ?? x?.code) === safeSku,
      );
      if (found) {
        const itemType = Number(
          found?.ItemType ?? found?.itemType ?? found?.Type ?? -1,
        );
        if (itemType !== 0) {
          throw new Error(
            `[InvoiceService] item with code ${safeSku} exists but is not goods. itemType=${itemType}`,
          );
        }
        _itemCodeCache.set(cacheKey, safeSku);
        return safeSku;
      }
    } catch (err) {
      if (String(err?.message || "").includes("not goods")) throw err;
      console.warn(
        `[InvoiceService] item search failed sku=${safeSku}:`,
        err?.message,
      );
    }

    if (!this.autoCreateItems) {
      throw new Error(
        `[InvoiceService] item with sku=${safeSku} not found in Hesabfa and auto-create is disabled`,
      );
    }

    const createItemType = Number.isFinite(DEFAULT_ITEM_TYPE)
      ? DEFAULT_ITEM_TYPE
      : 0;
    if (createItemType !== 0) {
      throw new Error(
        `[InvoiceService] invalid default item type. expected 0, got ${createItemType}`,
      );
    }

    const createResult = await this.hesabfa.call("/item/save", {
      item: {
        code: safeSku,
        name: safeName,
        itemType: 0,
        sellPrice: Math.max(0, Math.round(Number(unitPrice) || 0)),
        unit: "عدد",
        active: true,
      },
    });

    const createdCode = toSafeString(createResult?.Code);
    if (createdCode !== safeSku) {
      throw new Error(
        `[InvoiceService] created item code mismatch. expected=${safeSku} actual=${createdCode}`,
      );
    }
    _itemCodeCache.set(cacheKey, createdCode);
    return createdCode;
  }

  // ─── Order normalization ───────────────────────────────────────────────────

  normalizeOrderItems(order) {
    const rawItems =
      order?.items ??
      order?.order_items ??
      order?.products ??
      order?.line_items ??
      [];
    if (!Array.isArray(rawItems)) return [];

    return rawItems
      .map((item, idx) => {
        const quantity = Number(
          item?.quantity ?? item?.qty ?? item?.count ?? 1,
        );
        const unitPriceRaw = Number(
          item?.unit_price ?? item?.price ?? item?.single_price ?? 0,
        );
        const discountRaw = Number(item?.discount ?? item?.discount_price ?? 0);
        const taxRaw = Number(item?.tax ?? item?.vat ?? 0);

        return {
          variantId: item?.variant_id ?? null,
          sku: toSafeString(
            item?.sku ??
              item?.product_sku ??
              item?.code ??
              item?.product_code ??
              "",
          ),
          description: toHesabfaItemName(
            item?.title ??
              item?.name ??
              item?.product_name ??
              item?.product_title ??
              `آیتم ${idx + 1}`,
          ),
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          unitPrice: this.convertPortalMoney(unitPriceRaw),
          discount: this.convertPortalMoney(discountRaw),
          tax: this.convertPortalMoney(taxRaw),
        };
      })
      .filter((item) => item.quantity > 0 && item.sku);
  }

  // ─── Invoice payload ───────────────────────────────────────────────────────

  async buildInvoicePayload({ order, contactCode, items }) {
    const orderId = extractOrderId(order);
    const invoiceDate = await this._safeInvoiceDate(extractOrderDate(order));

    const freight = this.convertPortalMoney(
      order?.shipping_price ??
        order?.shipping ??
        order?.delivery_price ??
        order?.freight ??
        0,
    );

    const invoiceItems = await Promise.all(
      items.map(async (item, idx) => {
        const itemCode = await this.resolveItemCode(
          item.sku,
          item.description,
          item.unitPrice,
        );
        return {
          rowNumber: idx + 1,
          itemCode,
          description: item.description,
          unit: "عدد",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          tax: item.tax,
        };
      }),
    );

    // FIX: عنوان فاکتور کامل
    const customerName = toSafeString(
      order?.contact?.name ?? order?.customer_name ?? order?.user?.name ?? "",
    );
    const invoiceNote =
      `سفارش آنلاین ${orderId}` +
      (customerName ? ` - مشتری: ${customerName}` : "");

    return {
      invoice: {
        invoiceType: this.invoiceType, // FIX: باید 0 باشد
        status: 1,
        date: `${invoiceDate} 00:00:00`,
        dueDate: `${invoiceDate} 00:00:00`,
        contactCode: toSafeString(contactCode),
        reference: `order_${orderId}`,
        note: invoiceNote,
        tag: `portal_order_${orderId}`,
        freight: Number.isFinite(freight) ? freight : 0,
        invoiceItems,
      },
    };
  }

  // ─── Hesabfa saves ─────────────────────────────────────────────────────────

  async saveInvoice(payload) {
    return this.hesabfa.call("/invoice/save", payload);
  }

  async saveWarehouseReceipt({ invoiceNumber, items, date, note }) {
    // FIX: deleteOldReceipts: false — از پاک‌کردن حواله قبلی جلوگیری می‌کند
    // و ابتدا چک می‌کنیم که آیا حواله قبلاً ثبت شده
    return this.hesabfa.call("/invoice/SaveWarehouseReceipt", {
      deleteOldReceipts: false, // FIX: قبلاً true بود و مشکل ایجاد می‌کرد
      receipt: {
        warehouseCode: Number(HESABFA_WAREHOUSE_CODE),
        invoiceNumber: Number(invoiceNumber),
        invoiceType: this.invoiceType, // FIX: باید 0 باشد (خروج فروش، نه ورود خرید)
        date: toHesabfaDate(date),
        note:
          note ||
          `حواله خروج انبار ${HESABFA_WAREHOUSE_CODE} برای فاکتور ${invoiceNumber}`,
        items: items.map((item) => ({
          itemCode: item.itemCode,
          quantity: item.quantity,
          reference: `INV-${invoiceNumber}`,
          note: item.description,
        })),
      },
    });
  }

  async saveInvoicePayment({ invoiceNumber, orderId, amount, date, note }) {
    const transactionNumber = `WEB-ORDER-${orderId}-INV-${invoiceNumber}`;
    return this.hesabfa.call("/invoice/savePayment", {
      type: this.invoiceType,
      number: Number(invoiceNumber),
      cashCode: HESABFA_CASH_CODE,
      amount: Math.max(0, Math.round(Number(amount) || 0)),
      date: toHesabfaDateTime(date),
      transactionNumber,
      description: note || `دریافت بابت فاکتور ${invoiceNumber}`,
    });
  }

  // ─── Order total ───────────────────────────────────────────────────────────

  calcOrderTotal(order, items) {
    const direct =
      order?.total_price ?? order?.total ?? order?.price ?? order?.amount;
    if (hasValue(direct) && Number(direct) >= 0) {
      return this.convertPortalMoney(direct);
    }
    const itemTotal = items.reduce(
      (sum, item) =>
        sum + item.unitPrice * item.quantity - item.discount + item.tax,
      0,
    );
    const freight = this.convertPortalMoney(
      order?.shipping_price ?? order?.shipping ?? order?.freight ?? 0,
    );
    return itemTotal + freight;
  }

  // ─── User extraction ───────────────────────────────────────────────────────

  _extractUserFromOrder(order) {
    const contact = order?.contact ?? order?.billing ?? order;
    let firstName = "";
    let lastName = "";

    const fullName = toSafeString(
      contact?.name ?? order?.customer_name ?? order?.user?.name ?? "",
    );
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ") || parts[0];
    }
    if (!firstName)
      firstName = toSafeString(
        contact?.first_name ??
          contact?.firstName ??
          order?.customer_first_name ??
          "",
      );
    if (!lastName)
      lastName = toSafeString(
        contact?.last_name ??
          contact?.lastName ??
          order?.customer_last_name ??
          "",
      );

    const email = toSafeString(
      contact?.email ?? order?.email ?? order?.customer_email ?? "",
    );
    const mobile = toSafeString(
      contact?.mobile ??
        contact?.phone ??
        order?.mobile ??
        order?.customer_phone ??
        order?.user?.mobile ??
        "",
    );
    const userId =
      order?.user?.id ??
      order?.user_id ??
      order?.customer_id ??
      order?.userId ??
      null;

    if (!firstName && !lastName && !email && !mobile) return null;
    return {
      id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      mobile,
    };
  }

  // ─── Mark order processed ──────────────────────────────────────────────────

  async _markOrderProcessed(orderId, invoiceNumber, existingOrder = {}) {
    // FIX: این تابع فقط description را آپدیت می‌کند و status را دست نمی‌زند
    // تا از reset شدن وضعیت سفارش جلوگیری شود
    try {
      if (typeof this.portal.http.put === "function") {
        // FIX: فقط description را می‌فرستیم، نه کل body — تا status سفارش تغییر نکند
        await this.portal.http.put(
          `/site/api/v1/manage/store/orders/${encodeURIComponent(String(orderId))}`,
          {
            description: `synced_hesabfa_invoice_${invoiceNumber}`,
          },
        );
        console.log(
          `[InvoiceService] Order ${orderId} marked as processed (invoice: ${invoiceNumber})`,
        );
      }
    } catch (err) {
      // FIX: خطا را log می‌کنیم اما چون state در فایل ذخیره شده، مشکل نیست
      console.warn(
        `[InvoiceService] mark processed warning for order ${orderId} (non-fatal — persisted in file):`,
        err?.message,
      );
    }
  }

  // ─── Process single order ──────────────────────────────────────────────────

  async processOrder(order, { dryRun = false } = {}) {
    const orderId = extractOrderId(order);

    if (!isOrderPaid(order)) {
      return { action: "skipped", reason: "not_paid", orderId };
    }

    // FIX: چک persistent cache اول
    const existing = await this.isOrderAlreadyInvoiced(orderId);
    if (existing) {
      return {
        action: "already_invoiced",
        orderId,
        invoiceNumber: this._extractInvoiceNumber(existing),
        source: existing?.Source ?? "hesabfa",
      };
    }

    if (dryRun) return { action: "dry_run", orderId };

    let contactCode = null;
    try {
      const userInfo = this._extractUserFromOrder(order);
      if (userInfo) {
        const contactResult = await this.customer.ensureContact(userInfo);
        contactCode = contactResult?.contactCode ?? null;
      }
    } catch (err) {
      console.error(
        `[InvoiceService] ensureContact error for order ${orderId}:`,
        err,
      );
    }

    if (!hasValue(contactCode)) {
      return {
        action: "failed",
        reason: "no_contact",
        orderId,
        hint: "اطلاعات مشتری ناقص است",
      };
    }

    const items = this.normalizeOrderItems(order);
    if (items.length === 0) {
      return { action: "failed", reason: "no_items", orderId };
    }

    const invoicePayload = await this.buildInvoicePayload({
      order,
      contactCode,
      items,
    });
    const safeInvoiceDate = invoicePayload?.invoice?.date ?? null;

    const invoiceResult = await this.saveInvoice(invoicePayload);
    const invoiceNumber = this._extractInvoiceNumber(invoiceResult);

    if (!hasValue(invoiceNumber)) {
      throw new Error(
        `[InvoiceService] invoice saved but no invoiceNumber returned for order ${orderId}. Response: ${JSON.stringify(invoiceResult)}`,
      );
    }

    // FIX: بلافاصله بعد از ثبت فاکتور، در فایل ذخیره می‌کنیم
    this._setProcessedState(orderId, { invoiceCreated: true, invoiceNumber });

    let warehouseResult = null;
    let warehouseError = null;
    if (this.enableWarehouseReceipt) {
      try {
        warehouseResult = await this.saveWarehouseReceipt({
          invoiceNumber,
          items: invoicePayload.invoice.invoiceItems,
          date: safeInvoiceDate,
          note: `حواله خروج انبار ${HESABFA_WAREHOUSE_CODE} برای سفارش ${orderId}`,
        });
        this._setProcessedState(orderId, {
          warehouseIssued: true,
          invoiceNumber,
        });
      } catch (err) {
        warehouseError = err?.message ?? String(err);
        console.error(
          `[InvoiceService] warehouse receipt error for order ${orderId}:`,
          warehouseError,
        );
      }
    }

    let receiptResult = null;
    let receiptError = null;
    if (this.enablePaymentReceipt) {
      try {
        const total = this.calcOrderTotal(order, items);
        receiptResult = await this.saveInvoicePayment({
          invoiceNumber,
          orderId,
          amount: total,
          date: safeInvoiceDate,
          note: `دریافت بابت سفارش ${orderId}`,
        });
        this._setProcessedState(orderId, { paymentSaved: true, invoiceNumber });
      } catch (err) {
        receiptError = err?.message ?? String(err);
        console.error(
          `[InvoiceService] payment receipt error for order ${orderId}:`,
          receiptError,
        );
      }
    }

    await this._markOrderProcessed(orderId, invoiceNumber, order);

    return {
      action: "invoiced",
      orderId,
      invoiceNumber,
      contactCode,
      invoice: invoiceResult,
      warehouse: warehouseResult,
      warehouseError,
      receipt: receiptResult,
      receiptError,
    };
  }

  // ─── Sync all paid orders ──────────────────────────────────────────────────

  async syncPaidOrders({ pageSize = 50, dryRun = false } = {}) {
    const stats = {
      total: 0,
      invoiced: 0,
      already_invoiced: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    let page = 1;

    while (true) {
      const { orders } = await this.getPortalOrders({
        page,
        size: pageSize,
        status: "completed",
      });

      if (!orders || orders.length === 0) break;
      stats.total += orders.length;

      for (const summary of orders) {
        const orderId = summary?.id ?? summary?.order_id;

        try {
          const order = await this.getPortalOrder(orderId);
          if (!order) {
            stats.failed++;
            stats.errors.push({ orderId, error: "order_not_found" });
            continue;
          }

          const result = await this.processOrder(order, { dryRun });

          if (result.action === "invoiced") stats.invoiced++;
          else if (result.action === "already_invoiced")
            stats.already_invoiced++;
          else if (result.action === "dry_run") stats.skipped++;
          else if (result.action === "failed") {
            stats.failed++;
            stats.errors.push({
              orderId: result.orderId,
              error: result.reason ?? "unknown",
              hint: result.hint ?? "",
            });
          } else {
            stats.skipped++;
          }
        } catch (err) {
          stats.failed++;
          stats.errors.push({ orderId, error: err?.message ?? String(err) });
        }
      }

      if (orders.length < pageSize) break;
      page += 1;
    }

    return stats;
  }
}
