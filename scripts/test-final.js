import "dotenv/config";
import { SyncService } from "../src/services/sync.service.js";

const TARGETS = ["000466", "000365"];

async function runTest() {
  console.log("\n🚀 === شروع تست نهایی برای تایید رفع مشکلات کارفرما ===\n");
  const svc = new SyncService();

  try {
    const { summary, matchedEntries } = await svc.buildInventorySyncPreview();

    // تست 1: رفع مشکل نادیده گرفتن کالاهای تکراری
    console.log(
      "📌 تست ۱: آیا ربات حالا کالاهای تکراری را برای آپدیت پیدا می‌کند؟",
    );
    TARGETS.forEach((target) => {
      const matches = matchedEntries.filter(
        (m) => m.variant.normalizedBarcode === target,
      );
      console.log(
        `   - کد ${target}: تعداد پیدا شده در لیست آپدیت پورتال: ${matches.length}`,
      );
      if (matches.length === 0)
        console.log(`   ❌ خطا: کد ${target} همچنان اسکیپ می‌شود!`);
      if (target === "000466" && matches.length >= 2)
        console.log(
          "   ✅ موفقیت: ربات هر دو نسخه این کالا را در سایت آپدیت خواهد کرد.",
        );
    });
    console.log("---------------------------------------------------");

    // تست 2: بررسی موجودی انبار برای اثبات دلیل 0 شدن
    console.log(
      `📌 تست ۲: بررسی موجودی دقیق در انبار مشخص شده (${svc.config.hesabfa.warehouseCode || "نامشخص"})`,
    );
    console.log(
      "   (اگر مقدار زیر صفر باشد، یعنی کارفرما کالا را در انبار سایت وارد نکرده است!)",
    );

    const inventoryRows = await svc.hesabfaService.getInventory({
      codes: TARGETS,
      warehouseCode: svc.config.hesabfa.warehouseCode || undefined,
    });

    const rows = Array.isArray(inventoryRows)
      ? inventoryRows
      : inventoryRows?.List || inventoryRows?.Items || [];

    TARGETS.forEach((target) => {
      const row = rows.find((r) => (r.Code || r.code) === target);
      const qty = row ? row.Quantity || row.quantity || 0 : "یافت نشد";
      console.log(`   - کد ${target}: موجودی خوانده شده از حسابفا = ${qty}`);
    });
    console.log("---------------------------------------------------");

    // تست 3: تست فرآیند مقایسه قیمت
    console.log("📌 تست ۳: قیمت‌های نهایی قبل از اعمال در سایت");
    TARGETS.forEach((target) => {
      const match = matchedEntries.find(
        (m) => m.variant.normalizedBarcode === target,
      );
      if (match) {
        const sitePrice = match.variant.price || 0;
        const hesabfaRawPrice =
          match.item.raw?.SellPrice || match.item.raw?.sellPrice || 0;
        const hesabfaCalculatedPrice = Math.floor(
          hesabfaRawPrice / svc.priceDivisor,
        );

        console.log(`   - کد ${target}:`);
        console.log(`       قیمت فعلی سایت: ${sitePrice} تومان`);
        console.log(`       قیمت حسابفا: ${hesabfaRawPrice} ریال`);
        console.log(
          `       قیمتی که ربات ثبت میکند (با تبدیل واحد): ${hesabfaCalculatedPrice} تومان`,
        );
      }
    });
  } catch (e) {
    console.error("❌ Error:", e);
  }
}

runTest();
