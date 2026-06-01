// D:\hesabfa\inventory-sync\src\services\import.service.js
import { HesabfaService } from "./hesabfa.service.js";
import { PortalService } from "./portal.service.js";
import { env } from "../config/env.js";

const toSafeString = (value) =>
  value === null || value === undefined ? "" : String(value).trim();

const toEnglishDigits = (value) =>
  String(value).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));

const normalizeBarcode = (value) =>
  toEnglishDigits(toSafeString(value)).replace(/\s+/g, "");

const toSlug = (text) =>
  toEnglishDigits(toSafeString(text))
    .toLowerCase()
    .replace(/[^\w\u0600-\u06FF\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) +
  "-" +
  Math.random().toString(36).slice(2, 7);

const getExcludedNodeFamilies = (config) => {
  const raw = config?.sync?.excludedNodeFamilies;
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw))
    return new Set(raw.map((s) => String(s).trim()).filter(Boolean));
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
};

const createLimiter = (concurrency = 3) => {
  const limit = Math.max(1, Number(concurrency) || 1);
  let activeCount = 0;
  const queue = [];
  const runNext = () => {
    if (activeCount >= limit) return;
    const nextJob = queue.shift();
    if (!nextJob) return;
    activeCount += 1;
    Promise.resolve()
      .then(nextJob.fn)
      .then(nextJob.resolve)
      .catch(nextJob.reject)
      .finally(() => {
        activeCount -= 1;
        runNext();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
};

export class ImportService {
  constructor({
    portalService,
    hesabfaService,
    config = env,
    logger = console,
  } = {}) {
    this.config = config;
    this.logger = logger;

    this.priceDivisor = Number(
      config?.hesabfa?.priceDivisor ?? config?.sync?.priceDivisor ?? 10,
    );

    this.portalService =
      portalService ||
      new PortalService({
        baseURL: config.portal.baseUrl,
        authHeaderName: config.portal.authHeaderName,
        authHeaderValue: config.portal.authHeaderValue,
        timeout: config.sync.requestTimeoutMs,
        retries: config.sync.retryCount,
        config,
      });

    this.hesabfaService =
      hesabfaService ||
      new HesabfaService({
        baseURL: config.hesabfa.baseUrl,
        apiKey: config.hesabfa.apiKey,
        loginToken: config.hesabfa.loginToken,
        userId: config.hesabfa.userId,
        password: config.hesabfa.password,
        yearId: config.hesabfa.yearId,
        timeout: config.sync.requestTimeoutMs,
        retries: config.sync.retryCount,
      });
  }

  // در اینجا فقط SKU را دریافت می‌کنیم تا محصولات قبلی تکراری نشوند
  async getExistingPortalSKUs() {
    const variants = await this.portalService.getAllVariants({
      pageSize: this.config.sync.pageSize || 100,
    });
    const skuSet = new Set();
    for (const v of variants) {
      const sku = normalizeBarcode(v?.sku || "");
      if (sku) skuSet.add(sku);
    }
    return skuSet;
  }

  buildPortalProduct(item) {
    const price = Math.floor(
      Number(item?.SellPrice || item?.sellPrice || 0) / this.priceDivisor,
    );
    const stock = Math.max(
      0,
      Math.floor(Number(item?.Stock || item?.stock || 0)),
    );
    const code = toSafeString(item?.Code || item?.code || "");
    const name = toSafeString(
      item?.Name || item?.name || `محصول با کد ${code}`,
    );
    const nodeFamily = toSafeString(item?.NodeFamily || item?.nodeFamily || "");

    return {
      title: name,
      caption: nodeFamily || null,
      description: code ? `کد کالا: ${code}` : null,
      image: null,
      images: [],
      commenting_enabled: false,
      fields: [
        ...(code ? [{ name: "کد کالا", value: code }] : []),
        ...(nodeFamily ? [{ name: "دسته‌بندی انبار", value: nodeFamily }] : []),
      ],
      variants: [
        {
          status: [
            "approved",
            "bank_payment",
            "online_payment",
            "cash_on_delivery",
            "shipping_required",
          ],
          price: price > 0 ? price : 0,
          compare_price: null,
          stock,
          sku: code, // فقط از کد حسابفا به عنوان SKU استفاده می‌شود
          barcode: "", // بارکد دیگر ارسال نمی‌شود تا تداخلی ایجاد نکند
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
      slug: toSlug(name),
      published: null,
      expiration: null,
      password: null,
      meta_title: name,
      meta_description: null,
      meta_robots: null,
      redirect: null,
      filters: [],
      categories: [],
      status: ["approved"],
    };
  }

  async importFromHesabfa({ dryRun = false, pageSize = 100 } = {}) {
    const startedAt = new Date();
    const summary = {
      success: true,
      dryRun,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: 0,
      hesabfaItemsTotal: 0,
      hesabfaItemsExcluded: 0,
      alreadyInPortal: 0,
      importedCount: 0,
      failedCount: 0,
      imported: [],
      failed: [],
      skipped: [],
    };

    // گرفتن SKU های سایت
    const existingSKUs = await this.getExistingPortalSKUs();

    const excludedNodeFamilies = getExcludedNodeFamilies(this.config);
    const allItems = await this.hesabfaService.getAllItems({ pageSize });
    summary.hesabfaItemsTotal = allItems.length;

    const toImport = [];
    for (const item of allItems) {
      const code = normalizeBarcode(item?.Code || item?.code || "");
      const nodeFamily = toSafeString(
        item?.NodeFamily || item?.nodeFamily || "",
      );
      const active = item?.Active !== false;
      const stock = Math.floor(Number(item?.Stock || item?.stock || 0));

      if (!code) {
        summary.skipped.push({
          reason: "no-code",
          name: item?.Name || "",
        });
        continue;
      }

      if (!active) {
        summary.hesabfaItemsExcluded += 1;
        summary.skipped.push({
          reason: "inactive",
          code,
          name: item?.Name || "",
        });
        continue;
      }

      // --- تغییر جدید: نادیده گرفتن کالاهای با موجودی صفر یا منفی در زمان Import ---
      if (stock <= 0) {
        summary.hesabfaItemsExcluded += 1;
        summary.skipped.push({
          reason: "out-of-stock",
          code,
          name: item?.Name || "",
          stock,
        });
        continue;
      }
      // ----------------------------------------------------------------------------

      if (
        excludedNodeFamilies.size > 0 &&
        nodeFamily &&
        [...excludedNodeFamilies].some((f) => nodeFamily.includes(f))
      ) {
        summary.hesabfaItemsExcluded += 1;
        summary.skipped.push({
          reason: "excluded-node-family",
          code,
          name: item?.Name || "",
          nodeFamily,
        });
        continue;
      }

      // اینجا بررسی می‌کند که آیا کالا با این SKU از قبل در سایت هست یا خیر
      if (existingSKUs.has(code)) {
        summary.alreadyInPortal += 1;
        summary.skipped.push({
          reason: "already-in-portal",
          code,
          name: item?.Name || "",
        });
        continue;
      }

      toImport.push(item);
    }

    if (toImport.length === 0 || dryRun) {
      summary.importedCount = dryRun ? toImport.length : 0;
      if (dryRun) {
        summary.imported = toImport.map((item) => ({
          dryRun: true,
          code: normalizeBarcode(item?.Code || ""),
          name: item?.Name || "",
          price: Math.floor(Number(item?.SellPrice || 0) / this.priceDivisor),
          stock: Math.max(0, Math.floor(Number(item?.Stock || 0))),
        }));
      }
      const finishedAt = new Date();
      summary.finishedAt = finishedAt.toISOString();
      summary.durationMs = finishedAt.getTime() - startedAt.getTime();
      return summary;
    }

    const limit = createLimiter(this.config.sync.maxConcurrency || 3);

    await Promise.all(
      toImport.map((item) =>
        limit(async () => {
          const code = normalizeBarcode(item?.Code || item?.code || "");
          const productPayload = this.buildPortalProduct(item);
          try {
            const result = await this.portalService.http.request({
              method: "POST",
              url:
                this.config.portal?.productCreatePath ||
                "/site/api/v1/manage/store/products",
              data: productPayload,
            });
            const createdId = result?.id ?? result?.data?.id ?? null;
            summary.importedCount += 1;
            summary.imported.push({
              portalId: createdId,
              code,
              name: item?.Name || "",
              price: productPayload.variants[0].price,
              stock: productPayload.variants[0].stock,
            });
          } catch (error) {
            summary.failedCount += 1;
            summary.failed.push({
              code,
              name: item?.Name || "",
              message: error?.message || "Unknown error",
              details: error?.details ?? null,
            });
          }
        }),
      ),
    );

    const finishedAt = new Date();
    summary.finishedAt = finishedAt.toISOString();
    summary.durationMs = finishedAt.getTime() - startedAt.getTime();
    summary.success = summary.failedCount === 0;
    return summary;
  }
}
