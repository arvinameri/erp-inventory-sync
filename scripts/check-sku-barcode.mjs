// scripts/check-sku-barcode.mjs
import { env } from "../src/config/env.js";
import { HttpClient } from "../src/clients/http.client.js";

const http = new HttpClient({
  baseURL: env.portal.baseUrl,
  timeout: 30000,
  retries: 1,
  serviceName: "portal",
});

async function main() {
  const res = await http.get(env.portal.productListPath, {
    headers: { [env.portal.authHeaderName]: env.portal.authHeaderValue },
    params: { page: 1, per_page: 5 },
  });

  const products = res?.data || res?.products || res || [];

  console.log("🔍 بررسی فیلدهای اولین ۵ محصول سایت:\n");
  products.slice(0, 5).forEach((p) => {
    console.log(`ID: ${p.id} | نام: ${p.name || p.title}`);
    console.log(`  → sku:     "${p.sku || ""}"`);
    console.log(`  → barcode: "${p.barcode || ""}"`);
    console.log(`  → code:    "${p.code || ""}"`);
    console.log(`  → همه فیلدها: ${Object.keys(p).join(", ")}`);
    console.log("---");
  });
}

main().catch(console.error);
