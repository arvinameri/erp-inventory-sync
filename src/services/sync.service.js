// Path: src/services/sync.service.js
import { env } from "../config/env.js";
import { HesabfaService } from "./hesabfa.service.js";
import { PortalService } from "./portal.service.js";

// تابع تاخیر برای جلوگیری از Rate-Limit پورتال
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toSafeString = (value) =>
  value === null || value === undefined ? "" : String(value).trim();

const toEnglishDigits = (value) =>
  String(value).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));

const normalizeBarcode = (value) =>
  toEnglishDigits(toSafeString(value)).replace(/\s+/g, "");

const toSafeStock = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const toSafePrice = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const escapeCsv = (value) => {
  const s = value === null || value === undefined ? "" : String(value);
  if (
    s.includes(",") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r")
  )
    return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const toCsv = (rows, columns) => {
  const header = columns.map((col) => escapeCsv(col.header)).join(",");
  const body = rows.map((row) =>
    columns.map((col) => escapeCsv(row[col.key])).join(","),
  );
  return [header, ...body].join("\n");
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

const getExcludedBarcodes = (config) => {
  const raw = config?.sync?.excludedBarcodes ?? "";
  if (Array.isArray(raw))
    return new Set(raw.map(normalizeBarcode).filter(Boolean));
  return new Set(
    String(raw)
      .split(",")
      .map((item) => normalizeBarcode(item))
      .filter(Boolean),
  );
};

const getAllowedBarcodes = (config) => {
  const raw = config?.portal?.allowedBarcodes ?? new Set();
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw))
    return new Set(raw.map(normalizeBarcode).filter(Boolean));
  return new Set();
};

const getBlockedBarcodes = (config) => {
  const raw = config?.portal?.blockedBarcodes ?? new Set();
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw))
    return new Set(raw.map(normalizeBarcode).filter(Boolean));
  return new Set();
};

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

const getPortalVariantBarcode = (variant) =>
  normalizeBarcode(variant?.sku || "");

const getPortalVariantLabel = (variant) =>
  variant?.title ?? variant?.name ?? variant?.productTitle ?? null;

const getHesabfaPrice = (item, priceDivisor = 1) => {
  const raw = toSafePrice(
    item?.SellPrice ??
      item?.sellPrice ??
      item?.raw?.SellPrice ??
      item?.raw?.sellPrice ??
      0,
  );
  if (!priceDivisor || priceDivisor <= 0) return raw;
  return Math.floor(raw / priceDivisor);
};

const getHesabfaName = (item) =>
  toSafeString(
    item?.Name ?? item?.name ?? item?.raw?.Name ?? item?.raw?.name ?? "",
  );

const getHesabfaCode = (item) =>
  normalizeBarcode(
    item?.Code ?? item?.code ?? item?.raw?.Code ?? item?.raw?.code ?? "",
  );

const isExcludedByNodeFamily = (item, excludedNodeFamilies) => {
  if (excludedNodeFamilies.size === 0) return false;
  const nodeFamily = toSafeString(item?.nodeFamily ?? "");
  if (!nodeFamily) return false;
  return [...excludedNodeFamilies].some((f) => nodeFamily.includes(f));
};

export class SyncService {
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

  buildInventorySummarySkeleton({ dryRun }) {
    return {
      success: true,
      dryRun,
      startedAt: null,
      finishedAt: null,
      durationMs: 0,
      portalVariantsCount: 0,
      portalVariantsWithBarcodeCount: 0,
      portalVariantsWithoutBarcodeCount: 0,
      hesabfaItemsCount: 0,
      hesabfaItemsWithBarcodeCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      excludedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      warnings: [],
      updates: [],
      skipped: [],
      failed: [],
      unmatched: [],
      excluded: [],
    };
  }

  async buildHesabfaMaps() {
    const allRaw = await this.hesabfaService.getAllItems({
      pageSize: this.config.sync.pageSize || 100,
    });

    const byCode = new Map();
    const byBarcode = new Map();

    for (const raw of allRaw) {
      const item = this.hesabfaService.normalizeItem(raw);
      if (!item) continue;
      if (item.code) byCode.set(item.code, item);
      if (item.barcode) byBarcode.set(item.barcode, item);
    }

    return { allRaw, byCode, byBarcode };
  }

  async buildInventorySyncPreview() {
    const summary = this.buildInventorySummarySkeleton({ dryRun: true });

    const excludedBarcodes = getExcludedBarcodes(this.config);
    const allowedBarcodes = getAllowedBarcodes(this.config);
    const blockedBarcodes = getBlockedBarcodes(this.config);
    const excludedNodeFamilies = getExcludedNodeFamilies(this.config);

    const portalVariants = await this.portalService.getAllVariants({
      pageSize: this.config.sync.pageSize || 100,
    });
    summary.portalVariantsCount = Array.isArray(portalVariants)
      ? portalVariants.length
      : 0;

    const { allRaw, byCode, byBarcode } = await this.buildHesabfaMaps();
    summary.hesabfaItemsCount = allRaw.length;
    summary.hesabfaItemsWithBarcodeCount = byBarcode.size;

    const portalVariantsWithBarcode = [];
    const portalBarcodeSet = new Set();
    const duplicatePortalBarcodes = new Set();

    for (const variant of portalVariants) {
      const normalizedBarcode = getPortalVariantBarcode(variant);

      if (!normalizedBarcode) {
        summary.portalVariantsWithoutBarcodeCount += 1;
        summary.warnings.push({
          type: "portal-variant-without-barcode",
          variantId: variant?.id ?? null,
          productId: variant?.productId ?? null,
          title: getPortalVariantLabel(variant),
        });
        continue;
      }

      if (
        excludedBarcodes.has(normalizedBarcode) ||
        blockedBarcodes.has(normalizedBarcode)
      ) {
        summary.excludedCount += 1;
        summary.excluded.push({
          type: "excluded-by-barcode",
          variantId: variant?.id ?? null,
          productId: variant?.productId ?? null,
          title: getPortalVariantLabel(variant),
          barcode: normalizedBarcode,
        });
        continue;
      }

      if (allowedBarcodes.size > 0 && !allowedBarcodes.has(normalizedBarcode)) {
        summary.excludedCount += 1;
        summary.excluded.push({
          type: "not-allowed-by-barcode",
          variantId: variant?.id ?? null,
          productId: variant?.productId ?? null,
          title: getPortalVariantLabel(variant),
          barcode: normalizedBarcode,
        });
        continue;
      }

      if (portalBarcodeSet.has(normalizedBarcode)) {
        duplicatePortalBarcodes.add(normalizedBarcode);
        summary.warnings.push({
          type: "duplicate-portal-barcode",
          barcode: normalizedBarcode,
          variantId: variant?.id ?? null,
          productId: variant?.productId ?? null,
          title: getPortalVariantLabel(variant),
        });
        // 🛑 CONTINUE REMOVED: Allow duplicates to be matched and processed
      }

      portalBarcodeSet.add(normalizedBarcode);
      portalVariantsWithBarcode.push({ ...variant, normalizedBarcode });
    }

    summary.portalVariantsWithBarcodeCount = portalVariantsWithBarcode.length;

    const matchedEntries = [];
    const unmatchedEntries = [];

    for (const variant of portalVariantsWithBarcode) {
      const item = byCode.get(variant.normalizedBarcode) ?? null;

      if (!item) {
        unmatchedEntries.push({
          variantId: variant?.id ?? null,
          productId: variant?.productId ?? null,
          title: getPortalVariantLabel(variant),
          barcode: variant.normalizedBarcode,
          reason: "barcode-not-found-in-hesabfa",
        });
        continue;
      }

      if (isExcludedByNodeFamily(item, excludedNodeFamilies) || item.excluded) {
        summary.excludedCount += 1;
        summary.excluded.push({
          type: "excluded-by-node-family",
          variantId: variant?.id ?? null,
          productId: variant?.productId ?? null,
          title: getPortalVariantLabel(variant),
          barcode: variant.normalizedBarcode,
          nodeFamily: toSafeString(item?.nodeFamily ?? ""),
        });
        continue;
      }

      matchedEntries.push({ variant, item });
    }

    summary.matchedCount = matchedEntries.length;
    summary.unmatchedCount = unmatchedEntries.length;
    summary.unmatched = unmatchedEntries;

    return { summary, matchedEntries, unmatchedEntries };
  }

  async cleanupFilteredProducts({ dryRun = true } = {}) {
    const startedAt = new Date();
    const excludedNodeFamilies = getExcludedNodeFamilies(this.config);
    const result = {
      success: true,
      dryRun,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: 0,
      totalPortalProducts: 0,
      checkedCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      noMatchCount: 0,
      deleted: [],
      skipped: [],
      failed: [],
    };

    const { byCode, byBarcode } = await this.buildHesabfaMaps();
    const portalVariants = await this.portalService.getAllVariants({
      pageSize: this.config.sync.pageSize || 100,
    });

    const productMap = new Map();
    for (const variant of portalVariants) {
      const pid = variant?.productId ?? variant?.id;
      if (!pid) continue;
      if (!productMap.has(pid)) {
        productMap.set(pid, {
          productId: pid,
          title: getPortalVariantLabel(variant),
          barcode: getPortalVariantBarcode(variant),
          variant,
        });
      }
    }

    result.totalPortalProducts = productMap.size;
    const limit = createLimiter(this.config.sync.maxConcurrency || 3);

    await Promise.all(
      [...productMap.values()].map((entry) =>
        limit(async () => {
          result.checkedCount += 1;
          const { productId, title, barcode, variant } = entry;

          const item = byCode.get(barcode) ?? byBarcode.get(barcode) ?? null;

          if (!item) {
            result.noMatchCount += 1;
            result.skipped.push({
              reason: "no-hesabfa-match",
              productId,
              title,
              barcode,
            });
            return;
          }

          const shouldDelete =
            isExcludedByNodeFamily(item, excludedNodeFamilies) || item.excluded;

          if (!shouldDelete) {
            result.skippedCount += 1;
            result.skipped.push({
              reason: "not-in-excluded-category",
              productId,
              title,
              barcode,
              nodeFamily: toSafeString(item?.nodeFamily ?? ""),
            });
            return;
          }

          const deleteEntry = {
            productId,
            title,
            barcode,
            nodeFamily: toSafeString(item?.nodeFamily ?? ""),
          };

          if (dryRun) {
            result.deletedCount += 1;
            result.deleted.push({ ...deleteEntry, dryRun: true });
            return;
          }

          try {
            await this.portalService.deleteProduct(productId);
            result.deletedCount += 1;
            result.deleted.push(deleteEntry);
          } catch (error) {
            result.failedCount += 1;
            result.failed.push({
              ...deleteEntry,
              message: error?.message || "Unknown error",
            });
          }
        }),
      ),
    );

    const finishedAt = new Date();
    result.finishedAt = finishedAt.toISOString();
    result.durationMs = finishedAt.getTime() - startedAt.getTime();
    result.success = result.failedCount === 0;
    return result;
  }

  buildUnmatchedCsv(unmatchedEntries) {
    const rows = (Array.isArray(unmatchedEntries) ? unmatchedEntries : []).map(
      (item) => ({
        variantId: item?.variantId ?? "",
        productId: item?.productId ?? "",
        title: item?.title ?? "",
        barcode: item?.barcode ?? "",
        reason: item?.reason ?? "",
      }),
    );

    return toCsv(rows, [
      { key: "variantId", header: "variantId" },
      { key: "productId", header: "productId" },
      { key: "title", header: "title" },
      { key: "barcode", header: "barcode" },
      { key: "reason", header: "reason" },
    ]);
  }

  async getUnmatchedInventoryReport({ format = "json" } = {}) {
    const startedAt = new Date();
    const { summary, unmatchedEntries } =
      await this.buildInventorySyncPreview();
    const finishedAt = new Date();

    summary.startedAt = startedAt.toISOString();
    summary.finishedAt = finishedAt.toISOString();
    summary.durationMs = finishedAt.getTime() - startedAt.getTime();

    if (format === "csv") {
      return {
        contentType: "text/csv; charset=utf-8",
        fileName: `unmatched-inventory-${Date.now()}.csv`,
        body: "\uFEFF" + this.buildUnmatchedCsv(unmatchedEntries),
      };
    }

    return {
      contentType: "application/json; charset=utf-8",
      fileName: `unmatched-inventory-${Date.now()}.json`,
      body: JSON.stringify(
        {
          success: true,
          generatedAt: finishedAt.toISOString(),
          summary: {
            portalVariantsCount: summary.portalVariantsCount,
            portalVariantsWithBarcodeCount:
              summary.portalVariantsWithBarcodeCount,
            portalVariantsWithoutBarcodeCount:
              summary.portalVariantsWithoutBarcodeCount,
            hesabfaItemsCount: summary.hesabfaItemsCount,
            hesabfaItemsWithBarcodeCount: summary.hesabfaItemsWithBarcodeCount,
            matchedCount: summary.matchedCount,
            unmatchedCount: summary.unmatchedCount,
            excludedCount: summary.excludedCount,
          },
          unmatched: unmatchedEntries,
        },
        null,
        2,
      ),
    };
  }

  async syncInventory({ dryRun = this.config.sync.dryRun } = {}) {
    const startedAt = new Date();
    const summary = this.buildInventorySummarySkeleton({ dryRun });
    summary.startedAt = startedAt.toISOString();

    const { summary: previewSummary, matchedEntries } =
      await this.buildInventorySyncPreview();

    Object.assign(summary, previewSummary, {
      dryRun,
      startedAt: startedAt.toISOString(),
      updates: [],
      skipped: [],
      failed: [],
    });

    if (matchedEntries.length === 0) {
      const finishedAt = new Date();
      summary.finishedAt = finishedAt.toISOString();
      summary.durationMs = finishedAt.getTime() - startedAt.getTime();
      return summary;
    }

    const limit = createLimiter(this.config.sync.maxConcurrency || 3);
    const useQuantity2 = this.config.sync.useHesabfaQuantity2 !== false;
    const syncName = this.config.sync.syncName === true;

    // 🛑 شروع BATCHING: گرفتن موجودی کل انبار با ریکوئست‌های تکه‌تکه‌ (Chunk) برای رفع مشکل API Limit حسابفا
    const hesabfaInventoryMap = new Map();
    if (useQuantity2) {
      const allCodesToFetch = [
        ...new Set(
          matchedEntries.map((m) => getHesabfaCode(m.item)).filter(Boolean),
        ),
      ];

      try {
        const chunkSize = 100; // حسابفا برای GetQuantity آرایه قبول می‌کند
        for (let i = 0; i < allCodesToFetch.length; i += chunkSize) {
          const chunk = allCodesToFetch.slice(i, i + chunkSize);
          const inventoryRows = await this.hesabfaService.getInventory({
            codes: chunk,
            warehouseCode: this.config.hesabfa.warehouseCode || undefined,
          });

          const rows = Array.isArray(inventoryRows)
            ? inventoryRows
            : (inventoryRows?.List ??
              inventoryRows?.list ??
              inventoryRows?.Items ??
              inventoryRows?.items ??
              []);

          for (const row of rows) {
            const normalizedRow = this.hesabfaService.normalizeQuantity(row);
            if (normalizedRow && normalizedRow.code) {
              hesabfaInventoryMap.set(
                normalizedRow.code,
                toSafeStock(normalizedRow.quantity),
              );
            }
          }
          await sleep(50); // استراحت کوچک بین ریکوئست‌های دسته‌ای حسابفا
        }
      } catch (error) {
        this.logger.warn(
          "Batch inventory fetch failed, falling back to base stock",
          { message: error.message },
        );
      }
    }

    await Promise.all(
      matchedEntries.map(({ variant, item }) =>
        limit(async () => {
          const currentStock = toSafeStock(
            variant?.stock ??
              variant?.inventory ??
              variant?.inventoryQuantity ??
              variant?.qty,
          );
          const currentPrice = toSafePrice(variant?.price ?? 0);
          const currentTitle = toSafeString(variant?.title ?? "");

          const code = getHesabfaCode(item);
          const barcode = variant.normalizedBarcode;

          // 🛑 اختصاص موجودیِ پیدا شده از Map (یا استفاده از موجودی پایه)
          let nextStock = toSafeStock(
            item?.stock ?? item?.raw?.Stock ?? item?.raw?.stock ?? 0,
          );

          if (useQuantity2 && code && hesabfaInventoryMap.has(code)) {
            nextStock = hesabfaInventoryMap.get(code);
          }

          const nextPrice = getHesabfaPrice(item, this.priceDivisor);
          const nextName = getHesabfaName(item);

          const stockChanged = currentStock !== nextStock;
          const priceChanged = nextPrice >= 0 && currentPrice !== nextPrice;
          const nameChanged =
            syncName && nextName.length > 0 && currentTitle !== nextName;

          if (!stockChanged && !priceChanged && !nameChanged) {
            summary.skippedCount += 1;
            summary.skipped.push({
              type: "no-change",
              variantId: variant?.id ?? null,
              productId: variant?.productId ?? null,
              title: currentTitle,
              barcode,
              itemCode: code,
              stock: currentStock,
              price: currentPrice,
            });
            return;
          }

          const change = {
            variantId: variant?.id ?? null,
            productId: variant?.productId ?? null,
            title: currentTitle,
            barcode,
            itemCode: code,
            previousStock: currentStock,
            nextStock,
            previousPrice: currentPrice,
            nextPrice,
            previousName: currentTitle,
            nextName,
            stockChanged,
            priceChanged,
            nameChanged,
          };

          if (dryRun) {
            summary.updatedCount += 1;
            summary.updates.push({ ...change, dryRun: true });
            return;
          }

          try {
            await this.portalService.updateVariantStockAndPrice(
              variant.id,
              nextStock,
              nextPrice >= 0 ? nextPrice : undefined,
            );

            if (nameChanged && variant?.productId) {
              await this.portalService.http.request({
                method: "PUT",
                url: `/site/api/v1/manage/store/products/${variant.productId}`,
                data: { title: nextName },
              });
            }

            // 🛑 تاخیر در آپدیت‌های سنگین پورتال برای رفع ارور Rate Limit سایت فروشگاهی
            await sleep(150);

            summary.updatedCount += 1;
            summary.updates.push(change);
          } catch (error) {
            summary.failedCount += 1;
            summary.failed.push({
              ...change,
              message: error?.message || "Unknown error",
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
