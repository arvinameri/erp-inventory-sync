// scripts/full-audit.mjs
import { env } from "../src/config/env.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";
import { PortalService } from "../src/services/portal.service.js";
import fs from "fs";

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

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("         FULL AUDIT گزارش کامل         ");
  console.log("═══════════════════════════════════════\n");

  // ── ۱. دریافت همه variants سایت (با detail کامل — barcode از fields)
  console.log("📦 دریافت محصولات از سایت (با detail کامل)...");
  const portalVariants = await portal.getAllVariants({ pageSize: 100 });
  console.log(`   → ${portalVariants.length} variant در سایت\n`);

  // ── ۲. دریافت همه آیتم‌های حسابفا
  console.log("📦 دریافت آیتم‌های حسابفا...");
  const hesabfaItems = await hesabfa.getAllItems({ pageSize: 100 });
  console.log(`   → ${hesabfaItems.length} آیتم در حسابفا\n`);

  // ── ۳. ساخت map از Barcode حسابفا (منبع اصلی match)
  const hesabfaByBarcode = new Map();
  const hesabfaByCode = new Map();
  for (const item of hesabfaItems) {
    const n = hesabfa.normalizeItem(item);
    if (n.barcode) hesabfaByBarcode.set(n.barcode, n);
    if (n.code) hesabfaByCode.set(n.code, n);
  }

  // ── ۴. بررسی هر variant سایت
  const forbidden = [];
  const matched = [];
  const notFound = [];

  for (const v of portalVariants) {
    const siteName = v.title || "";
    const siteBarcode = v.barcode || ""; // از fields خوانده شده (100478 و...)
    const siteSku = v.sku || ""; // Code حسابفا (000479 و...)
    const siteNodeFamily = v.nodeFamily || "";

    // چک ممنوعه بودن بر اساس نام یا nodeFamily سایت
    const isForbiddenByName = FORBIDDEN_KEYWORDS.some(
      (kw) => siteName.includes(kw) || siteNodeFamily.includes(kw),
    );

    // جستجو در حسابفا: اول با Barcode، بعد با Code
    const hesabfaItem =
      hesabfaByBarcode.get(siteBarcode) ||
      hesabfaByCode.get(siteBarcode) ||
      hesabfaByCode.get(siteSku) ||
      null;

    // چک ممنوعه بودن بر اساس nodeFamily حسابفا
    const isForbiddenByFamily = hesabfaItem
      ? [...env.sync.excludedNodeFamilies].some((ex) =>
          hesabfaItem.nodeFamily?.includes(ex),
        )
      : false;

    if (isForbiddenByName || isForbiddenByFamily) {
      forbidden.push({
        productId: v.productId,
        variantId: v.id,
        name: siteName,
        sku: siteSku,
        barcode: siteBarcode,
        nodeFamily: hesabfaItem?.nodeFamily || siteNodeFamily || "نامشخص",
        reason: isForbiddenByName
          ? "نام/دسته ممنوعه در سایت"
          : "دسته ممنوعه در حسابفا",
      });
    } else if (hesabfaItem) {
      matched.push({
        productId: v.productId,
        variantId: v.id,
        name: siteName,
        sku: siteSku,
        barcode: siteBarcode,
        hesabfaBarcode: hesabfaItem.barcode,
        hesabfaCode: hesabfaItem.code,
        nodeFamily: hesabfaItem.nodeFamily,
        stock: hesabfaItem.stock,
      });
    } else {
      notFound.push({
        productId: v.productId,
        variantId: v.id,
        name: siteName,
        sku: siteSku,
        barcode: siteBarcode,
      });
    }
  }

  // ── ۵. نمایش نتایج
  console.log("═══════════════════════════════════════");

  console.log(`❌ ممنوعه (باید حذف شوند): ${forbidden.length}`);
  forbidden.forEach((p) =>
    console.log(
      `   - [${p.productId}] ${p.name} | barcode: ${p.barcode} | دلیل: ${p.reason}`,
    ),
  );

  console.log(`\n✅ match شده (sync می‌شوند): ${matched.length}`);
  matched.forEach((p) =>
    console.log(
      `   - [${p.productId}] ${p.name} | barcode سایت: ${p.barcode} → حسابفا: ${p.hesabfaBarcode} | موجودی: ${p.stock}`,
    ),
  );

  console.log(`\n⚠️  در حسابفا پیدا نشد: ${notFound.length}`);
  notFound.forEach((p) =>
    console.log(
      `   - [${p.productId}] ${p.name} | sku: ${p.sku} | barcode: ${p.barcode}`,
    ),
  );

  // ── ۶. ذخیره گزارش
  const report = {
    forbidden,
    matched,
    notFound,
    summary: {
      totalVariants: portalVariants.length,
      forbidden: forbidden.length,
      matched: matched.length,
      notFound: notFound.length,
      generatedAt: new Date().toISOString(),
    },
  };

  fs.writeFileSync(
    "audit-report.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log("\n📄 گزارش کامل در audit-report.json ذخیره شد");
  console.log("═══════════════════════════════════════");
}

main().catch(console.error);
