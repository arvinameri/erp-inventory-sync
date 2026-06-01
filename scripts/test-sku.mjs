import { env } from "../src/config/env.js";
import { PortalService } from "../src/services/portal.service.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";

async function runSkuTest() {
  console.log("⏳ در حال دریافت اطلاعات از حسابفا و سایت...");

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
    const allHesabfaRaw = await hesabfaService.getAllItems({ pageSize: 100 });
    const hesabfaItems = allHesabfaRaw
      .map((r) => hesabfaService.normalizeItem(r))
      .filter(Boolean);
    const portalVariants = await portalService.getAllVariants({
      pageSize: 100,
    });

    console.log(
      `✅ دریافت شد: ${hesabfaItems.length} محصول حسابفا | ${portalVariants.length} محصول سایت\n`,
    );

    let errorCount = 0;
    let matchCount = 0;

    for (const pVariant of portalVariants) {
      const siteSku = (pVariant.sku || "").replace(/\s+/g, "");

      if (!siteSku) {
        console.log(
          `⚠️ محصول سایت "${pVariant.title}" دارای SKU خالی است! (نادیده گرفته شد)`,
        );
        continue;
      }

      // جستجو در حسابفا فقط بر اساس Code
      const hItem = hesabfaItems.find(
        (i) => (i.code || "").replace(/\s+/g, "") === siteSku,
      );

      if (hItem) {
        matchCount++;
        // اگر خواستی خروجی شلوغ نشود، این لاگ سبز را پاک کن
        // console.log(`🟢 مچ شد: [سایت: ${pVariant.title}] <==> [حسابفا: ${hItem.name}] | (SKU: ${siteSku})`);
      } else {
        errorCount++;
        console.log(
          `❌ پیدا نشد: محصول سایت "${pVariant.title}" با SKU "${siteSku}" در حسابفا هیچ معادلی ندارد!`,
        );
      }
    }

    console.log(`\n📊 نتیجه‌گیری:`);
    console.log(`تعداد محصولات با موفقیت متصل شده: ${matchCount}`);
    console.log(`تعداد خطاهای تطابق: ${errorCount}`);
  } catch (err) {
    console.error("خطا:", err.message);
  }
}

runSkuTest();
