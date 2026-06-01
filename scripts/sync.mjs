// scripts/sync.mjs
import { env } from "../src/config/env.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";
import { PortalService } from "../src/services/portal.service.js";
import fs from "fs";

// ─── کلمات ممنوعه ─────────────────────────────────────────────
const FORBIDDEN_KEYWORDS = [
  "قاب",
  "بک کاور",
  "کیف",
  "گلس",
  "باتری",
  "قطعات",
  "سخت افزار",
  "نرم افزار",
  "سرمایه گذاری",
  "خدمات",
  "گرین",
  "بند ساعت",
  "بند و قاب",
];

const IS_DRY_RUN = process.argv.includes("--dry-run");

// ─── تبدیل اعداد فارسی به انگلیسی ─────────────────────────────
function normalizeDigits(str) {
  if (!str) return "";
  return String(str)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .trim();
}

function isForbidden(name = "", nodeFamily = "") {
  return FORBIDDEN_KEYWORDS.some(
    (kw) => name.includes(kw) || nodeFamily.includes(kw),
  );
}

// ─── سرویس‌ها ─────────────────────────────────────────────────
const hesabfa = new HesabfaService({
  baseURL: env.hesabfa.baseUrl,
  apiKey: env.hesabfa.apiKey,
  loginToken: env.hesabfa.loginToken,
  userId: env.hesabfa.userId,
  password: env.hesabfa.password,
  yearId: env.hesabfa.yearId,
  timeout: env.sync.requestTimeoutMs,
  retries: env.sync.retryCount,
});

const portal = new PortalService({
  baseURL: env.portal.baseUrl,
  authHeaderName: env.portal.authHeaderName,
  authHeaderValue: env.portal.authHeaderValue,
  timeout: env.sync.requestTimeoutMs,
  retries: env.sync.retryCount,
  config: { portal: env.portal },
});

// ─── آمار ─────────────────────────────────────────────────────
const stats = {
  stockUpdated: 0,
  stockSkippedZero: 0,
  deleted: 0,
  forbidden: 0,
  notFound: 0,
  errors: [],
};

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log(
    IS_DRY_RUN
      ? "   🔍 SYNC — حالت DRY-RUN (بدون تغییر واقعی)"
      : "   🚀 SYNC — اجرای واقعی",
  );
  console.log("═══════════════════════════════════════════\n");

  // ── ۱. دریافت variants سایت (با barcode از fields)
  console.log("📦 دریافت محصولات سایت...");
  const variants = await portal.getAllVariants({ pageSize: 100 });
  console.log(`   → ${variants.length} variant\n`);

  // ── ۲. دریافت آیتم‌های حسابفا
  console.log("📦 دریافت آیتم‌های حسابفا...");
  const hesabfaItems = await hesabfa.getAllItems({ pageSize: 100 });
  console.log(`   → ${hesabfaItems.length} آیتم\n`);

  // ── ۳. ساخت Map از barcode حسابفا
  const byBarcode = new Map();
  const byCode = new Map();
  for (const item of hesabfaItems) {
    const n = hesabfa.normalizeItem(item);
    if (n.barcode) byBarcode.set(n.barcode, n);
    if (n.code) byCode.set(n.code, n);
  }

  // ── ۴. پردازش هر variant
  console.log("⚙️  پردازش variants...\n");

  for (const v of variants) {
    const siteName = v.title || "";
    const nodeFamily = v.nodeFamily || "";
    const rawBarcode = normalizeDigits(v.barcode);
    const rawSku = normalizeDigits(v.sku);

    // ─ ممنوعه؟ → حذف از سایت
    if (isForbidden(siteName, nodeFamily)) {
      stats.forbidden++;
      console.log(`❌ ممنوعه  [${v.productId}] ${siteName || rawBarcode}`);

      if (!IS_DRY_RUN) {
        try {
          await portal.deleteProduct(v.productId);
          stats.deleted++;
          console.log(`   └─ ✅ حذف شد`);
        } catch (err) {
          stats.errors.push({
            productId: v.productId,
            action: "delete",
            error: err.message,
          });
          console.log(`   └─ ⚠️  خطا در حذف: ${err.message}`);
        }
      } else {
        console.log(`   └─ [dry-run] حذف می‌شد`);
      }
      continue;
    }

    // ─ جستجو در حسابفا
    const hesabfaItem =
      byBarcode.get(rawBarcode) ||
      byCode.get(rawBarcode) ||
      byCode.get(rawSku) ||
      null;

    if (!hesabfaItem) {
      stats.notFound++;
      console.log(
        `⚠️  پیدا نشد [${v.productId}] sku: ${rawSku} | barcode: ${rawBarcode}`,
      );
      continue;
    }

    const stock = hesabfaItem.stock ?? 0;

    // ─ موجودی صفر → از سایت حذف شود (و وقتی دوباره موجود شد sync می‌شود)
    if (stock <= 0) {
      stats.stockSkippedZero++;
      console.log(
        `📭 ناموجود [${v.productId}] barcode: ${rawBarcode} | موجودی: ${stock} → حذف از سایت`,
      );

      if (!IS_DRY_RUN) {
        try {
          await portal.deleteProduct(v.productId);
          stats.deleted++;
          console.log(`   └─ ✅ حذف شد`);
        } catch (err) {
          stats.errors.push({
            productId: v.productId,
            action: "delete-zero-stock",
            error: err.message,
          });
          console.log(`   └─ ⚠️  خطا در حذف: ${err.message}`);
        }
      } else {
        console.log(`   └─ [dry-run] حذف می‌شد`);
      }
      continue;
    }

    // ─ موجودی > 0 → آپدیت موجودی در سایت
    console.log(
      `✅ sync     [${v.productId}] barcode: ${rawBarcode} → موجودی: ${stock}`,
    );

    if (!IS_DRY_RUN) {
      try {
        await portal.updateVariantStock(v.id, stock);
        stats.stockUpdated++;
      } catch (err) {
        stats.errors.push({
          productId: v.productId,
          variantId: v.id,
          action: "update-stock",
          error: err.message,
        });
        console.log(`   └─ ⚠️  خطا در آپدیت: ${err.message}`);
      }
    }
  }

  // ── ۵. گزارش نهایی
  console.log("\n═══════════════════════════════════════════");
  console.log("📊 نتیجه:");
  console.log(
    `   ✅ موجودی آپدیت شد:   ${IS_DRY_RUN ? "(dry-run) " : ""}${stats.stockUpdated}`,
  );
  console.log(
    `   📭 ناموجود (حذف شد):  ${IS_DRY_RUN ? "(dry-run) " : ""}${stats.stockSkippedZero}`,
  );
  console.log(
    `   ❌ ممنوعه (حذف شد):   ${IS_DRY_RUN ? "(dry-run) " : ""}${stats.forbidden}`,
  );
  console.log(`   ⚠️  پیدا نشد:          ${stats.notFound}`);
  if (stats.errors.length > 0) {
    console.log(`   🔴 خطا:              ${stats.errors.length}`);
    stats.errors.forEach((e) =>
      console.log(`      - [${e.productId}] ${e.action}: ${e.error}`),
    );
  }
  console.log("═══════════════════════════════════════════");

  // ── ۶. ذخیره log
  const log = {
    mode: IS_DRY_RUN ? "dry-run" : "live",
    ...stats,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync("sync-log.json", JSON.stringify(log, null, 2), "utf8");
  console.log("📄 لاگ در sync-log.json ذخیره شد");
}

main().catch(console.error);
