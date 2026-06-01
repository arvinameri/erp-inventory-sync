import { env } from "../src/config/env.js";
import { PortalService } from "../src/services/portal.service.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";

async function runTestV3() {
  console.log("⏳ در حال دریافت اطلاعات نوت 14 از حسابفا...");

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

    // جستجو با عدد 14 انگلیسی و ۱۴ فارسی
    const note14InHesabfa = hesabfaItems.filter(
      (i) =>
        (i.name || "").toLowerCase().includes("14") ||
        (i.name || "").includes("۱۴"),
    );

    if (note14InHesabfa.length === 0) {
      console.log("❌ در حسابفا هیچ محصولی که در اسمش 14 باشد پیدا نشد!");
      return;
    }

    console.log(
      `✅ تعداد ${note14InHesabfa.length} محصول با عدد 14 در حسابفا پیدا شد:\n`,
    );

    const portalVariants = await portalService.getAllVariants({
      pageSize: 100,
    });

    for (const item of note14InHesabfa) {
      console.log(`=========================================`);
      console.log(`📦 محصول در حسابفا: ${item.name}`);
      console.log(`- کد کالا (Code) در حسابفا: ${item.code || "ندارد"}`);
      console.log(`- موجودی: ${item.stock}`);
      console.log(`- دسته‌بندی: ${item.nodeFamily}`);

      if (item.excluded) {
        console.log(
          `🔴 وضعیت: این دسته‌بندی فیلتر شده است و ربات آن را سینک نمی‌کند!`,
        );
      }

      // جستجو در سایت *فقط* بر اساس Code حسابفا و SKU سایت
      const portalMatch = portalVariants.find(
        (v) => v.sku && v.sku === item.code,
      );

      if (portalMatch) {
        console.log(`🟢 معادل این محصول در سایت پیدا شد: ${portalMatch.title}`);
        console.log(`   - شناسه (SKU) در سایت: ${portalMatch.sku}`);
      } else {
        console.log(
          `❌ معادل این محصول در سایت پیدا نشد! (محصول با SKU "${item.code}" در سایت وجود ندارد)`,
        );
      }
    }
  } catch (err) {
    console.error("خطا:", err.message);
  }
}

runTestV3();
