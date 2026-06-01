import { env } from "../src/config/env.js";
import { PortalService } from "../src/services/portal.service.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";
import { CustomerService } from "../src/services/customer.service.js";
import { InvoiceService } from "../src/services/invoice.service.js";

async function runInvoiceStatusTest() {
  console.log("⏳ در حال اتصال به پورتال برای تست وضعیت سفارش‌ها...\n");

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

  try {
    // مرحله ۱: دریافت سفارش‌های سایت با فیلتری که در کد اعمال کردیم (completed)
    // دقت کنید اینجا completed نوشته‌ایم، چون در ووکامرس معمولاً وضعیت تکمیل شده این است.
    console.log(
      "🔍 در حال دریافت سفارش‌های با وضعیت 'completed' (انجام شده) از سایت...",
    );
    const { orders } = await invoiceService.getPortalOrders({
      page: 1,
      size: 50,
      status: "completed",
    });

    if (!orders || orders.length === 0) {
      console.log("❌ هیچ سفارش 'تکمیل شده' ای در 50 سفارش آخر سایت پیدا نشد.");
      return;
    }

    console.log(
      `✅ پیدا شد! تعداد ${orders.length} سفارش با وضعیت 'تکمیل شده' دریافت شد.\n`,
    );

    // مرحله ۲: بررسی ۲ سفارش اول برای تست
    const testCount = Math.min(2, orders.length);
    console.log(
      `🛠️ در حال شبیه‌سازی پردازش ${testCount} سفارش اول (بدون ثبت واقعی در حسابفا)...\n`,
    );

    for (let i = 0; i < testCount; i++) {
      const orderSummary = orders[i];
      const orderId = orderSummary.id || orderSummary.order_id;

      console.log(`=========================================`);
      console.log(`🛒 بررسی سفارش شماره: ${orderId}`);

      // گرفتن دیتای کامل سفارش
      const orderDetails = await invoiceService.getPortalOrder(orderId);
      console.log(
        `- وضعیت فعلی سفارش در سایت: ${orderDetails.status || orderDetails.order_status || "نامشخص"}`,
      );
      console.log(
        `- نام مشتری: ${orderDetails?.billing?.first_name || ""} ${orderDetails?.billing?.last_name || ""}`,
      );

      // استفاده از متد پردازش در حالت dryRun (بدون ثبت فاکتور)
      const result = await invoiceService.processOrder(orderDetails, {
        dryRun: true,
      });

      console.log(`- تصمیم ربات:`);
      if (result.action === "dry_run") {
        console.log(
          `  🟢 تأیید شد. ربات این سفارش را مجاز برای ثبت فاکتور می‌داند.`,
        );
      } else if (result.action === "already_invoiced") {
        console.log(
          `  🟡 قبلاً ثبت شده. (شماره فاکتور در حسابفا: ${result.invoiceNumber})`,
        );
      } else if (result.action === "skipped") {
        console.log(
          `  🔴 رد شد. دلیل: ${result.reason} (وضعیت خوانده شده: ${result.status})`,
        );
      } else {
        console.log(`  ⚠️ وضعیت دیگر: ${result.action}`);
      }
      console.log(`=========================================\n`);
    }

    console.log(
      "🎯 نتیجه تست: اگر ربات تصمیم به ثبت (🟢) یا قبلاً ثبت شده (🟡) گرفت، یعنی فیلتر ما به درستی کار می‌کند و فقط سفارش‌های تکمیل شده را پردازش می‌کند.",
    );
  } catch (err) {
    console.error("خطا در اجرای تست:", err.message);
  }
}

runInvoiceStatusTest();
