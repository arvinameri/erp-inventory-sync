// D:\hesabfa\inventory-sync\src\routes\debugPortal.routes.js
import { Router } from "express";
import { PortalService } from "../services/portal.service.js";
import { env } from "../config/env.js";

const router = Router();

const normalize = (value) => String(value ?? "").trim();
const normalizeDigits = (value) =>
  normalize(value)
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/\s+/g, "");

const portalService = new PortalService({
  baseURL: env.portal.baseUrl,
  authHeaderName: env.portal.authHeaderName,
  authHeaderValue: env.portal.authHeaderValue,
  timeout: env.sync.requestTimeoutMs,
  retries: env.sync.retryCount,
  config: env,
});

// GET /debug/portal/product/:sku
router.get("/product/:sku", async (req, res, next) => {
  try {
    const sku = normalizeDigits(req.params.sku);
    const variants = await portalService.getAllVariants({ pageSize: 100 });

    const found =
      variants.find((v) => normalizeDigits(v?.sku) === sku) ||
      variants.find((v) => normalizeDigits(v?.barcode) === sku) ||
      variants.find((v) => normalizeDigits(v?.id) === sku) ||
      variants.find((v) => normalizeDigits(v?.productId) === sku) ||
      null;

    return res.json({
      success: true,
      input: sku,
      count: variants.length,
      found: Boolean(found),
      product: found
        ? {
            id: found.id ?? null,
            productId: found.productId ?? null,
            title: found.title ?? null,
            sku: found.sku ?? null,
            barcode: found.barcode ?? null,
            stock: found.stock ?? null,
            price: found.price ?? null,
            raw: found,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /debug/portal/test-create
router.post("/test-create", async (req, res) => {
  try {
    const payload = req.body?.payload ?? {
      title: "debug تست موقت",
      variants: [
        {
          status: [
            "approved",
            "bank_payment",
            "online_payment",
            "cash_on_delivery",
            "shipping_required",
          ],
          price: 1000,
          compare_price: null,
          stock: 1,
          sku: "debug-test-001",
          minimum: null,
          maximum: null,
          weight: null,
          width: null,
          length: null,
          height: null,
          title: "primary",
          type: "commodity",
        },
      ],
      status: ["approved"],
    };

    const result = await portalService.http.request({
      method: "POST",
      url: "/site/api/v1/manage/store/products",
      data: payload,
    });

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
      details: err.details ?? null,
      axiosStatus: err.details?.httpStatus ?? null,
      axiosResponse: err.details?.response ?? null,
      stack: err.stack,
    });
  }
});

// POST /debug/portal/test-create-real
// ?dryRun=true  → فقط payload رو نشون بده، ارسال نکن
router.post("/test-create-real", async (req, res) => {
  try {
    const { ImportService } = await import("../services/import.service.js");
    const svc = new ImportService({ config: env });

    const fakeItem = {
      Name: "remax fc-12 20000mAh شش ماه حتی بادکردگی 22.5w",
      Barcode: "100000",
      Code: "000001",
      SellPrice: 63000000,
      Stock: 7,
      NodeFamily: "کالاها : موبایل : سامسونگ", // ✅ تغییر داده شد
      Active: true,
    };

    let productPayload;
    try {
      productPayload = svc.buildPortalProduct(fakeItem);
    } catch (buildErr) {
      return res.status(500).json({
        success: false,
        stage: "buildPortalProduct",
        message: buildErr.message,
        stack: buildErr.stack,
      });
    }

    // اگه dryRun=true فقط payload رو برگردون
    if (req.query.dryRun === "true") {
      return res.json({ success: true, dryRun: true, payload: productPayload });
    }

    const result = await portalService.http.request({
      method: "POST",
      url: "/site/api/v1/manage/store/products",
      data: productPayload,
    });

    res.json({ success: true, payload: productPayload, result });
  } catch (err) {
    res.status(500).json({
      success: false,
      stage: "http_request",
      message: err.message,
      details: err.details ?? null,
      axiosResponse: err.details?.response ?? null,
    });
  }
});

export default router;
