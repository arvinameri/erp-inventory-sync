// scripts/check-barcode-match.mjs
// یک محصول را از هر دو طرف چک می‌کند

import { env } from "../src/config/env.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";
import { HttpClient } from "../src/clients/http.client.js";

// ← اینجا barcode یک محصول تست را بنویس
const TEST_BARCODE_SITE = "000001";

async function main() {
  // سرویس حسابفا
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

  console.log(`🔍 جستجوی barcode "${TEST_BARCODE_SITE}" در حسابفا...\n`);

  try {
    const item = await hesabfa.getItemByBarcode(TEST_BARCODE_SITE);
    if (item) {
      const normalized = hesabfa.normalizeItem(item);
      console.log("✅ در حسابفا پیدا شد:");
      console.log(`  - کد حسابفا: ${normalized.code}`);
      console.log(`  - بارکد حسابفا: ${normalized.barcode}`);
      console.log(`  - نام: ${normalized.name}`);
      console.log(`  - nodeFamily: ${normalized.nodeFamily}`);
      console.log(`  - موجودی: ${normalized.stock}`);
    } else {
      console.log("❌ با این barcode در حسابفا پیدا نشد");
      console.log("👉 یعنی barcode سایت با حسابفا متفاوت است");
      console.log("👉 باید product-mapping.json پر شود");
    }
  } catch (err) {
    console.log("❌ خطا:", err.message);
  }
}

main().catch(console.error);
