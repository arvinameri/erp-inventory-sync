import { env } from "../src/config/env.js";
import { PortalService } from "../src/services/portal.service.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";
import { CustomerService } from "../src/services/customer.service.js";
import { InvoiceService } from "../src/services/invoice.service.js";
import { ImportService } from "../src/services/import.service.js";
import { SyncService } from "../src/services/sync.service.js";

async function runMasterTest() {
  console.log("🚀 شروع تست جامع سیستم همگام‌سازی...\n");
  console.log("=========================================\n");

  const portalService = new PortalService({
    baseURL: env.portal.baseUrl,
    authHeaderName: env.portal.authHeaderName,
    authHeaderValue: env.portal.authHeaderValue,
    timeout: 30000,
    config: env,
  });

  const hesabfaService = new HesabfaService({
    baseURL: env.hesabfa.baseUrl,
    apiKey: env.hesabfa.apiKey,
    loginToken: env.hesabfa.loginToken,
    userId: env.hesabfa.userId,
    password: env.hesabfa.password,
    yearId: env.hesabfa.yearId,
    timeout: 30000,
  });

  try {
    // ---------------------------------------------------------
    // تست اول: وارد کردن کالای جدید (Import) با بررسی دقیق فیلترها
    // ---------------------------------------------------------
    console.log("🧪 تست ۱: شبیه‌سازی وارد کردن کالای جدید از حسابفا (Dry-Run)");
    const importService = new ImportService({
      portalService,
      hesabfaService,
      config: env,
    });

    // در حالت dryRun: true ربات فقط میگه چی پیدا کرده ولی واقعاً تو سایت نمیسازه
    const importSummary = await importService.importFromHesabfa({
      dryRun: true,
    });

    console.log(`✅ نتیجه بخش ایمپورت:`);
    console.log(
      `   - مجموع کل کالاهای خوانده شده از حسابفا: ${importSummary.hesabfaItemsTotal}`,
    );

    // شمارش دلیل رد شدن کالاها
    let alreadyInPortalCount = 0;
    let outOfStockCount = 0;
    let inactiveOrNoCodeCount = 0;

    importSummary.skipped.forEach((item) => {
      if (item.reason === "already-in-portal") alreadyInPortalCount++;
      else if (item.reason === "out-of-stock") outOfStockCount++;
      else inactiveOrNoCodeCount++;
    });

    console.log(
      `   - 🛑 کالاهای رد شده چون از قبل در سایت (با SKU یکسان) وجود دارند: ${alreadyInPortalCount} عدد`,
    );
    console.log(
      `   - 🛑 کالاهای رد شده چون ناموجود (موجودی صفر) هستند: ${outOfStockCount} عدد`,
    );
    console.log(
      `   - 🛑 کالاهای رد شده به دلایل دیگر (غیرفعال، بدون کد، دسته‌بندی فیلتر شده): ${inactiveOrNoCodeCount} عدد`,
    );

    console.log(
      `\n   🟢 تعداد نهایی کالاهایی که واقعاً "جدید" و "موجود" هستند و در سایت ساخته خواهند شد: ${importSummary.importedCount} کالا\n`,
    );

    if (importSummary.importedCount > 0) {
      console.log(`   نمونه از کالاهایی که ساخته خواهند شد:`);
      importSummary.imported.slice(0, 3).forEach((item) => {
        console.log(
          `      📦 نام: ${item.name} | SKU: ${item.code} | موجودی: ${item.stock}`,
        );
      });
      console.log("\n");
    }

    // ---------------------------------------------------------
    // تست دوم: آپدیت قیمت و موجودی (Sync)
    // ---------------------------------------------------------
    console.log("🧪 تست ۲: شبیه‌سازی آپدیت قیمت و موجودی کالاها (Dry-Run)");
    const syncService = new SyncService({
      portalService,
      hesabfaService,
      config: env,
    });

    const syncSummary = await syncService.syncInventory({ dryRun: true });
    console.log(
      `✅ نتیجه: ربات ${syncSummary.matchedCount} کالا را بین سایت و حسابفا (با SKU) مچ کرد.`,
    );
    console.log(
      `   - از این تعداد، ${syncSummary.updatedCount} کالا نیاز به آپدیت قیمت یا موجودی دارند.\n`,
    );

    // ---------------------------------------------------------
    // تست سوم: صدور فاکتور سفارشات
    // ---------------------------------------------------------
    console.log("🧪 تست ۳: بررسی وضعیت سفارش‌ها برای صدور فاکتور");
    const customerService = new CustomerService({
      portalService,
      hesabfaService,
    });
    const invoiceService = new InvoiceService({
      portalService,
      hesabfaService,
      customerService,
      config: env,
    });

    const { orders } = await invoiceService.getPortalOrders({
      page: 1,
      size: 20,
      status: "completed",
    });
    console.log(
      `✅ نتیجه: ربات ${orders.length} سفارش با وضعیت "انجام شده" در سایت پیدا کرد.`,
    );

    if (orders.length > 0) {
      console.log(
        `   - اولین سفارش در صف پردازش: ${orders[0].id || orders[0].order_id}`,
      );
      // نمایش ضریب تبدیل قیمت برای اطمینان
      console.log(
        `   - 💱 ضریب تبدیل قیمت به حسابفا (ریال): ضربدر ${invoiceService.priceDivisor}\n`,
      );
    } else {
      console.log(
        `   - در حال حاضر سفارش جدیدی برای صدور فاکتور وجود ندارد.\n`,
      );
    }

    console.log("🎯 نتیجه نهایی: تست با موفقیت به پایان رسید.");
  } catch (err) {
    console.error("❌ خطا در اجرای تست جامع:", err.message);
  }
}

runMasterTest();
