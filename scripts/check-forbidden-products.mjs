// scripts/check-forbidden-products.mjs
// چک می‌کند آیا محصولات ممنوعه الان در سایت وجود دارند

import { env } from "../src/config/env.js";
import { HttpClient } from "../src/clients/http.client.js";

// دسته‌بندی‌هایی که نباید در سایت باشند
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
];

async function main() {
  const http = new HttpClient({
    baseURL: env.portal.baseUrl,
    timeout: 30000,
    retries: 1,
    serviceName: "portal",
  });

  console.log("🔍 در حال دریافت محصولات از سایت...\n");

  let page = 1;
  let allProducts = [];

  while (true) {
    const response = await http.get(env.portal.productListPath, {
      headers: { [env.portal.authHeaderName]: env.portal.authHeaderValue },
      params: { page, per_page: 100 },
    });

    const products = response?.data || response?.products || response || [];
    if (!Array.isArray(products) || products.length === 0) break;

    allProducts.push(...products);
    if (products.length < 100) break;
    page++;
  }

  console.log(`✅ کل محصولات سایت: ${allProducts.length}\n`);

  // فیلتر محصولات ممنوعه
  const forbidden = allProducts.filter((p) => {
    const name = (p.name || p.title || "").toLowerCase();
    const category = (p.category || p.nodeFamily || "").toLowerCase();
    return FORBIDDEN_KEYWORDS.some(
      (kw) => name.includes(kw) || category.includes(kw),
    );
  });

  if (forbidden.length === 0) {
    console.log("✅ هیچ محصول ممنوعه‌ای در سایت پیدا نشد!\n");
  } else {
    console.log(`❌ ${forbidden.length} محصول ممنوعه در سایت پیدا شد:\n`);
    forbidden.forEach((p) => {
      console.log(
        `  - ID: ${p.id} | نام: ${p.name || p.title} | دسته: ${p.category || "-"}`,
      );
    });
  }
}

main().catch(console.error);
