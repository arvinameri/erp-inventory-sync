// scripts/check-product-detail.mjs
import { env } from "../src/config/env.js";
import { HttpClient } from "../src/clients/http.client.js";

const http = new HttpClient({
  baseURL: env.portal.baseUrl,
  timeout: 30000,
  retries: 1,
  serviceName: "portal",
});

// ID اولین محصول سایت
const TEST_ID = 179009828;

async function main() {
  const url = env.portal.productDetailPathTemplate.replace("{id}", TEST_ID);
  console.log(`🔍 دریافت detail محصول ${TEST_ID}`);
  console.log(`   URL: ${url}\n`);

  const res = await http.get(url, {
    headers: { [env.portal.authHeaderName]: env.portal.authHeaderValue },
  });

  // نمایش همه فیلدها
  console.log("همه فیلدهای detail:");
  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error);
