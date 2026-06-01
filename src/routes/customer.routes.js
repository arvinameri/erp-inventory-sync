// Path: src/routes/customer.routes.js

import { Router } from "express";
import { env } from "../config/env.js";
import { PortalService } from "../services/portal.service.js";
import { HesabfaService } from "../services/hesabfa.service.js";
import { CustomerService } from "../services/customer.service.js";
import { runCustomerSync, getCustomerJobStatus } from "../jobs/customer.job.js";

const router = Router();

function buildCustomerService() {
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

  return new CustomerService({ portalService, hesabfaService });
}

// ─────────────────────────────────────────────────────────────────
// GET /customer
// ─────────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.json({
    success: true,
    service: "customer-sync",
    routes: [
      "GET  /customer                   — این صفحه",
      "POST /customer/sync              — sync همه کاربران",
      "GET  /customer/status            — وضعیت آخرین اجرا",
      "GET  /customer/portal-users      — پیش‌نمایش کاربران پورتال",
      "POST /customer/single            — sync یک کاربر { userId }",
      "POST /customer/deduplicate       — حذف تکراری‌ها { mobile }",
      "POST /customer/debug-search      — دیباگ جستجو در حسابفا { mobile }",
    ],
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /customer/sync
// ─────────────────────────────────────────────────────────────────
router.post("/sync", async (req, res, next) => {
  try {
    const dryRun = req.body?.dryRun ?? env.sync.dryRun;
    const result = await runCustomerSync({ dryRun });
    res.json({ success: true, action: "customerSync", dryRun, result });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /customer/status
// ─────────────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  res.json({ success: true, ...getCustomerJobStatus() });
});

// ─────────────────────────────────────────────────────────────────
// GET /customer/portal-users?page=1&size=10
// ─────────────────────────────────────────────────────────────────
router.get("/portal-users", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(req.query.size ?? 10)));

    const customerService = buildCustomerService();
    const { users, total } = await customerService.getPortalUsers({
      page,
      size,
    });

    res.json({
      success: true,
      page,
      size,
      total,
      count: users.length,
      users: users.map((u) => ({
        id: u.id ?? u.user_id,
        name: [
          u.first_name ?? u.firstName ?? "",
          u.last_name ?? u.lastName ?? "",
        ]
          .filter(Boolean)
          .join(" "),
        email: u.email ?? "",
        mobile: u.mobile ?? u.phone ?? "",
        createdAt: u.created_at ?? u.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /customer/single
// Body: { userId: 123 }
// ─────────────────────────────────────────────────────────────────
router.post("/single", async (req, res, next) => {
  try {
    const userId = req.body?.userId;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required in body" });
    }

    const customerService = buildCustomerService();

    let user;
    try {
      user = await customerService.getPortalUser(userId);
    } catch (err) {
      return res.status(404).json({
        success: false,
        message: `User ${userId} not found on portal`,
        detail: err?.message,
      });
    }

    if (!user?.id && !user?.user_id) {
      return res
        .status(404)
        .json({ success: false, message: `User ${userId} not found` });
    }

    const result = await customerService.ensureContact(user);
    res.json({ success: true, action: result.action, userId, result });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /customer/deduplicate — حذف contact‌های تکراری با همان mobile
// Body: { mobile: "09175000231" }
// ─────────────────────────────────────────────────────────────────
router.post("/deduplicate", async (req, res, next) => {
  try {
    const { mobile } = req.body ?? {};
    if (!mobile) {
      return res
        .status(400)
        .json({ success: false, message: "mobile is required" });
    }
    const customerService = buildCustomerService();
    const result = await customerService.deduplicateByMobile(mobile);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /customer/debug-search — ببین حسابفا چه جوابی می‌دهد
// Body: { mobile: "09175000231" }
// ─────────────────────────────────────────────────────────────────
router.post("/debug-search", async (req, res, next) => {
  try {
    const { mobile } = req.body ?? {};

    const { HesabfaService } = await import("../services/hesabfa.service.js");
    const hesabfa = new HesabfaService({
      baseURL: env.hesabfa.baseUrl,
      apiKey: env.hesabfa.apiKey,
      loginToken: env.hesabfa.loginToken,
      userId: env.hesabfa.userId,
      password: env.hesabfa.password,
      yearId: env.hesabfa.yearId,
    });

    // تست ۱: filter با Mobile = مقدار دقیق
    const byMobileEq = await hesabfa
      .call("/contact/getContacts", {
        queryInfo: {
          take: 10,
          skip: 0,
          sortBy: "Code",
          sortDesc: false,
          filters: [{ property: "Mobile", operator: "=", value: mobile }],
        },
      })
      .catch((e) => ({ error: e.message }));

    // تست ۲: filter با Mobile * (contains)
    const byMobileContains = await hesabfa
      .call("/contact/getContacts", {
        queryInfo: {
          take: 10,
          skip: 0,
          sortBy: "Code",
          sortDesc: false,
          filters: [{ property: "Mobile", operator: "*", value: mobile }],
        },
      })
      .catch((e) => ({ error: e.message }));

    // تست ۳: بدون فیلتر — آخرین ۵ contact
    const allRecent = await hesabfa
      .call("/contact/getContacts", {
        queryInfo: { take: 5, skip: 0, sortBy: "Code", sortDesc: true },
      })
      .catch((e) => ({ error: e.message }));

    // تست ۴: جستجوی نام
    const byName = mobile
      ? await hesabfa
          .call("/contact/getContacts", {
            queryInfo: {
              take: 5,
              skip: 0,
              sortBy: "Code",
              sortDesc: false,
              filters: [{ property: "Name", operator: "*", value: "امیر" }],
            },
          })
          .catch((e) => ({ error: e.message }))
      : null;

    res.json({
      success: true,
      rawResponses: {
        byMobileEq: byMobileEq,
        byMobileContains: byMobileContains,
        allRecent: allRecent,
        byName: byName,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
