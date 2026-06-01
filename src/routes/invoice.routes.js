// Path: src/routes/invoice.routes.js

import { Router } from "express";
import { env } from "../config/env.js";
import { PortalService } from "../services/portal.service.js";
import { HesabfaService } from "../services/hesabfa.service.js";
import { CustomerService } from "../services/customer.service.js";
import { InvoiceService } from "../services/invoice.service.js";
import { runInvoiceSync, getInvoiceJobStatus } from "../jobs/invoice.job.js";

const router = Router();

function buildInvoiceService() {
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

  const customerService = new CustomerService({
    portalService,
    hesabfaService,
  });

  return new InvoiceService({
    portalService,
    hesabfaService,
    customerService,
    config: env,
  });
}

// ─── helper: خطای حسابفا یا هر سرویس را به شکل خوانا برگردان ───
function extractErrorDetail(err) {
  // پاسخ axios با status غیر 2xx
  if (err?.response) {
    return {
      httpStatus: err.response.status,
      hesabfaError: err.response.data ?? null,
    };
  }
  // خطای ساختاریافته داخلی
  if (err?.code || err?.errorCode) {
    return { code: err.code ?? err.errorCode, message: err.message };
  }
  return { message: err?.message ?? String(err) };
}

// ─────────────────────────────────────────────────────────────────
// GET /invoice
// ─────────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.json({
    success: true,
    service: "invoice-sync",
    routes: [
      "GET  /invoice                       — این صفحه",
      "POST /invoice/sync                  — اجرای دستی sync همه سفارشات پرداخت‌شده",
      "GET  /invoice/status                — وضعیت آخرین اجرا",
      "GET  /invoice/portal-orders         — پیش‌نمایش سفارشات پورتال",
      "POST /invoice/single                — پردازش یک سفارش { orderId, dryRun }",
      "GET  /invoice/check/:orderId        — چک ثبت یک سفارش در حسابفا",
      "GET  /invoice/debug-order/:orderId  — [DEBUG] داده خام سفارش از پورتال",
    ],
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /invoice/sync
// ─────────────────────────────────────────────────────────────────
router.post("/sync", async (req, res) => {
  const dryRun = req.body?.dryRun ?? env.sync.dryRun;
  try {
    const result = await runInvoiceSync({ dryRun });
    res.json({ success: true, action: "invoiceSync", dryRun, result });
  } catch (err) {
    console.error("[/invoice/sync] error:", err);
    res.status(502).json({
      success: false,
      message: "invoice sync failed",
      detail: extractErrorDetail(err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /invoice/status
// ─────────────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  res.json({ success: true, ...getInvoiceJobStatus() });
});

// ─────────────────────────────────────────────────────────────────
// GET /invoice/portal-orders?page=1&size=20&status=paid
// ─────────────────────────────────────────────────────────────────
router.get("/portal-orders", async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const size = Math.min(100, Math.max(1, Number(req.query.size ?? 20)));
  const status = req.query.status ?? "paid";

  try {
    const invoiceService = buildInvoiceService();
    const { orders, total } = await invoiceService.getPortalOrders({
      page,
      size,
      status,
    });

    res.json({
      success: true,
      page,
      size,
      total,
      count: orders.length,
      orders: orders.map((o) => ({
        id: o.id ?? o.order_id,
        status: o.status ?? o.order_status,
        total: o.price ?? o.total_price ?? o.total ?? o.amount,
        subtotal: o.subtotal,
        shipping: o.shipping,
        contact: o.contact ?? null,
        createdAt: o.created?.universal ?? o.created_at ?? null,
        userId: o.user?.id ?? o.user_id ?? o.customer_id ?? null,
      })),
    });
  } catch (err) {
    console.error("[/invoice/portal-orders] error:", err);
    res.status(502).json({
      success: false,
      message: "failed to fetch portal orders",
      detail: extractErrorDetail(err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /invoice/debug-order/:orderId
// ─────────────────────────────────────────────────────────────────
router.get("/debug-order/:orderId", async (req, res) => {
  try {
    const invoiceService = buildInvoiceService();
    const order = await invoiceService.getPortalOrder(req.params.orderId);
    res.json({ success: true, order });
  } catch (err) {
    console.error("[/invoice/debug-order] error:", err);
    res.status(502).json({
      success: false,
      message: "failed to fetch order from portal",
      detail: extractErrorDetail(err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /invoice/single
// Body: { orderId: 123, dryRun: false }
// ─────────────────────────────────────────────────────────────────
router.post("/single", async (req, res) => {
  const orderId = req.body?.orderId;
  const dryRun = req.body?.dryRun ?? false;

  if (!orderId) {
    return res
      .status(400)
      .json({ success: false, message: "orderId is required in body" });
  }

  // 1. دریافت سفارش از پورتال
  let order;
  try {
    const invoiceService = buildInvoiceService();
    order = await invoiceService.getPortalOrder(orderId);
  } catch (err) {
    console.error(`[/invoice/single] getPortalOrder(${orderId}) error:`, err);
    return res.status(404).json({
      success: false,
      message: `Order ${orderId} not found on portal`,
      detail: extractErrorDetail(err),
    });
  }

  // 2. پردازش و ثبت در حسابفا — خطا را کامل لاگ کن و به client برگردان
  try {
    const invoiceService = buildInvoiceService();
    const result = await invoiceService.processOrder(order, { dryRun });

    // اگر action=failed بود، با 422 برگردان تا در تست دیده شود
    if (result.action === "failed") {
      return res.status(422).json({
        success: false,
        action: result.action,
        orderId,
        reason: result.reason,
        hint: result.hint ?? null,
        result,
      });
    }

    res.json({ success: true, action: result.action, orderId, result });
  } catch (err) {
    // ✅ خطای کامل حسابفا را لاگ کن و به client بفرست
    console.error(`[/invoice/single] processOrder(${orderId}) error:`, err);
    console.error(
      "[/invoice/single] hesabfa response:",
      JSON.stringify(err?.response?.data ?? err?.message, null, 2),
    );
    res.status(502).json({
      success: false,
      message: "invoice processing failed",
      orderId,
      detail: extractErrorDetail(err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /invoice/check/:orderId
// ─────────────────────────────────────────────────────────────────
router.get("/check/:orderId", async (req, res) => {
  const orderId = req.params.orderId;
  try {
    const invoiceService = buildInvoiceService();
    const existing = await invoiceService.isOrderAlreadyInvoiced(orderId);
    res.json({
      success: true,
      orderId,
      invoiced: Boolean(existing),
      invoice: existing || null,
    });
  } catch (err) {
    console.error(`[/invoice/check] error for ${orderId}:`, err);
    res.status(502).json({
      success: false,
      message: "failed to check invoice status",
      detail: extractErrorDetail(err),
    });
  }
});

export default router;
