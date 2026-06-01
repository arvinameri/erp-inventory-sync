// D:\hesabfa\inventory-sync\tests\test-portal-service-optimization.mjs
//
// هدف: تست READ-ONLY بهینه‌سازی getAllVariants()
// هیچ داده‌ای در سایت تغییر نمی‌کند
// فقط GET می‌زند + نتیجه را گزارش می‌دهد

import "dotenv/config";
import { PortalService } from "../src/services/portal.service.js";

// ─── رنگ برای خروجی ───────────────────────────────────────────
const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const pass = (msg) => console.log(C.green(`  ✅ PASS  ${msg}`));
const fail = (msg) => {
  console.log(C.red(`  ❌ FAIL  ${msg}`));
  failures++;
};
const info = (msg) => console.log(C.cyan(`  ℹ️  ${msg}`));
const warn = (msg) => console.log(C.yellow(`  ⚠️  ${msg}`));
const title = (msg) => console.log(C.bold(`\n━━━ ${msg} ━━━`));

let failures = 0;

// ─── ساخت instance (فقط read، بدون mutation) ─────────────────
function buildPortalService() {
  const baseURL = process.env.PORTAL_BASE_URL;
  const authHeaderName = process.env.PORTAL_AUTH_HEADER_NAME;
  const authHeaderValue = process.env.PORTAL_AUTH_HEADER_VALUE;

  if (!baseURL || !authHeaderName || !authHeaderValue) {
    console.error(
      C.red(
        "\nERROR: متغیرهای محیطی PORTAL_BASE_URL / PORTAL_AUTH_HEADER_NAME / PORTAL_AUTH_HEADER_VALUE تنظیم نشده‌اند.\n",
      ),
    );
    process.exit(1);
  }

  return new PortalService({
    baseURL,
    authHeaderName,
    authHeaderValue,
    timeout: 30000,
    retries: 1,
  });
}

// ─── MONKEY-PATCH: شمردن تعداد بار فراخوانی getProductById ──
function patchAndCountDetailCalls(service) {
  let count = 0;
  const original = service.getProductById.bind(service);
  service.getProductById = async (id) => {
    count++;
    warn(`fallback getProductById فراخوانی شد برای id=${id}`);
    return original(id);
  };
  return { getCount: () => count };
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log(C.bold("\n╔══════════════════════════════════════════════════╗"));
  console.log(C.bold("║  تست بهینه‌سازی portal.service.js  (READ-ONLY)   ║"));
  console.log(C.bold("╚══════════════════════════════════════════════════╝"));

  const portal = buildPortalService();

  // ────────────────────────────────────────────────────────────
  title("TEST 1 — getProducts() با include=variants,fields");
  // ────────────────────────────────────────────────────────────
  let firstPageItems = [];
  let totalProducts = 0;

  try {
    const result = await portal.getProducts({ page: 1, size: 5 });
    firstPageItems = result.items;
    totalProducts = result.total;

    info(
      `total=${totalProducts}, count=${result.count}, items دریافت شدند=${firstPageItems.length}`,
    );

    if (firstPageItems.length > 0) {
      pass("getProducts() آیتم برگرداند");
    } else {
      fail("getProducts() آرایه خالی برگرداند");
    }

    const firstItem = firstPageItems[0];
    const hasVariants = Array.isArray(firstItem?.variants);
    const hasFields = Array.isArray(firstItem?.fields);

    if (hasVariants || hasFields) {
      pass(
        `embedded data موجود است — variants=${hasVariants}, fields=${hasFields}`,
      );
    } else {
      warn(
        "محصول اول نه variants دارد نه fields — شاید API آن‌ها را بازنگرداند",
      );
    }
  } catch (err) {
    fail(`getProducts() خطا داد: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  title("TEST 2 — شمارش fallback calls در getAllVariants()");
  // ────────────────────────────────────────────────────────────
  let variants = [];
  const { getCount } = patchAndCountDetailCalls(portal);

  const t0 = Date.now();
  try {
    variants = await portal.getAllVariants({ pageSize: 100 });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    info(
      `getAllVariants() تمام شد — ${variants.length} variant در ${elapsed} ثانیه`,
    );

    if (variants.length > 0) {
      pass("getAllVariants() آرایه غیرخالی برگرداند");
    } else {
      fail("getAllVariants() آرایه خالی برگرداند");
    }

    const fallbackCount = getCount();
    info(`تعداد فراخوانی getProductById (fallback): ${fallbackCount}`);

    if (fallbackCount === 0) {
      pass("هیچ fallback detail-call نزده شد — N+1 کاملاً حذف شده است");
    } else if (fallbackCount <= 5) {
      warn(`${fallbackCount} fallback زده شد — قابل قبول (موارد استثنا)`);
    } else {
      fail(`${fallbackCount} بار fallback زده شد — N+1 هنوز باقی است`);
    }
  } catch (err) {
    fail(`getAllVariants() خطا داد: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  title("TEST 3 — shape خروجی هر variant");
  // ────────────────────────────────────────────────────────────
  const REQUIRED_FIELDS = [
    "id",
    "productId",
    "title",
    "sku",
    "barcode",
    "nodeFamily",
    "stock",
    "price",
    "fields",
    "product",
  ];

  if (variants.length > 0) {
    const sample = variants[0];
    let allPresent = true;

    for (const field of REQUIRED_FIELDS) {
      if (!(field in sample)) {
        fail(`فیلد "${field}" در variant موجود نیست`);
        allPresent = false;
      }
    }

    if (allPresent) {
      pass("همه فیلدهای لازم در variant وجود دارند");
    }

    info(
      `نمونه variant: id=${sample.id}, sku="${sample.sku}", barcode="${sample.barcode}", stock=${sample.stock}`,
    );
  } else {
    warn("variants خالی است — نمی‌توان shape را بررسی کرد");
  }

  // ────────────────────────────────────────────────────────────
  title("TEST 4 — تخمین کاهش request");
  // ────────────────────────────────────────────────────────────
  const pageSize = 100;
  const pageCount = Math.ceil(totalProducts / pageSize);
  const oldRequests = pageCount + totalProducts;
  const newRequests = pageCount + getCount();
  const saved = oldRequests - newRequests;
  const pct = oldRequests > 0 ? ((saved / oldRequests) * 100).toFixed(0) : 0;

  info(`تعداد محصولات: ${totalProducts}`);
  info(`قبل از بهینه‌سازی: ~${oldRequests} درخواست`);
  info(`بعد از بهینه‌سازی: ~${newRequests} درخواست`);
  info(`کاهش: ${saved} درخواست (${pct}%)`);

  if (saved > 0) {
    pass("کاهش واقعی درخواست تأیید شد");
  } else {
    warn("کاهش قابل‌توجهی مشاهده نشد");
  }

  // ─── گزارش نهایی ─────────────────────────────────────────
  console.log(C.bold("\n╔══════════════════════════════════╗"));
  console.log(C.bold("║       نتیجه نهایی                ║"));
  console.log(C.bold("╚══════════════════════════════════╝"));

  if (failures === 0) {
    console.log(C.green(C.bold("  🎉 همه تست‌ها PASS — آماده deploy است")));
  } else {
    console.log(
      C.red(C.bold(`  ⛔  ${failures} تست FAIL شد — بررسی لازم است`)),
    );
  }

  console.log("");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(C.red(`\nERROR کلی: ${err.message}`));
  process.exit(1);
});
