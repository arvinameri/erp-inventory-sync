// scripts/check-product-179009812.mjs
import { env } from "../src/config/env.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";

const hesabfa = new HesabfaService({
  baseURL: env.hesabfa.baseUrl,
  apiKey: env.hesabfa.apiKey,
  loginToken: env.hesabfa.loginToken,
  userId: env.hesabfa.userId,
  password: env.hesabfa.password,
  yearId: env.hesabfa.yearId,
  timeout: env.sync.requestTimeoutMs,
  retries: env.sync.retryCount,
});

// barcode این محصول در سایت را اینجا بنویس
// از unmatched-inventory.json نگاه کن
const BARCODE = "000001"; // ← عوض کن با barcode واقعی این محصول

async function main() {
  try {
    // روش ۱: جستجو با getItems
    const result = await hesabfa.getItems({
      take: 5,
      skip: 0,
      search: "بند و قاب ساعت",
    });
    console.log("نتیجه جستجو:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("خطا:", err.message);
  }
}

main().catch(console.error);
