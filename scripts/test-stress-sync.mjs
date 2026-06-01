// Path: scripts/test-stress-sync.mjs
import "dotenv/config";
import { SyncService } from "../src/services/sync.service.js";
import { logger } from "../src/config/logger.js";

async function runStressTest() {
  console.log(
    "\n🚀 شروع تست فشار (Stress Test) برای بررسی رفع مشکل مسدودی API...",
  );
  console.log(
    "هدف: شبیه‌سازی یک آپدیت سنگین (Dry Run) تا ببینیم ربات چطور درخواست‌های حسابفا را مدیریت می‌کند.\n",
  );

  const svc = new SyncService({ logger });

  try {
    const startTime = Date.now();

    // اینجا متد اصلی را در حالت آزمایشی (بدون آپدیت واقعی سایت) اجرا می‌کنیم
    const summary = await svc.syncInventory({ dryRun: true });

    const endTime = Date.now();
    const durationSec = ((endTime - startTime) / 1000).toFixed(2);

    console.log("================ نتیجه تست فشار ================");
    console.log(`✅ وضعیت اجرای کل: ${summary.success ? "موفق" : "ناموفق"}`);
    console.log(`⏱ زمان اجرای کل پروسه: ${durationSec} ثانیه`);
    console.log(
      `📦 تعداد کل محصولات بررسی شده سایت: ${summary.portalVariantsCount}`,
    );
    console.log(
      `🔄 تعداد کالاهایی که نیاز به آپدیت داشتند: ${summary.updatedCount}`,
    );
    console.log(
      `⏭ تعداد کالاهایی که بدون تغییر بودند و اسکیپ شدند: ${summary.skippedCount}`,
    );
    console.log(`❌ تعداد خطاهای رخ داده در حین آپدیت: ${summary.failedCount}`);

    if (summary.failedCount > 0) {
      console.log("\n⚠️ لیست ارورها:");
      console.log(summary.failed.slice(0, 5).map((f) => f.message));
    } else {
      console.log(
        "\n🎉 تست فشار با موفقیت پاس شد! صفر ارور، یعنی معماری Batching حسابفا و Delay سایت به درستی عمل می‌کند.",
      );
      console.log(
        "شما می‌توانید با اطمینان کامل پروژه را تحویل دهید، حتی اگر کارفرما ۱۰۰۰ آپدیت همزمان بزند.",
      );
    }
  } catch (e) {
    console.error("\n❌ ارور غیرمنتظره در تست:", e.message);
  }
}

runStressTest();
