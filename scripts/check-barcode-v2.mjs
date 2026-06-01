// scripts/check-barcode-v2.mjs
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

async function main() {
  console.log("🔍 دریافت ۵ آیتم اول از حسابفا...\n");

  try {
    const result = await hesabfa.getItems({ take: 5, skip: 0 });
    const items = Array.isArray(result)
      ? result
      : result?.Items || result?.items || result?.List || [];

    if (items.length === 0) {
      console.log("❌ هیچ آیتمی برنگشت");
      return;
    }

    console.log(`✅ ${items.length} آیتم دریافت شد:\n`);
    items.forEach((item) => {
      const n = hesabfa.normalizeItem(item);
      console.log(
        `  کد: ${n.code} | بارکد: ${n.barcode} | نام: ${n.name} | nodeFamily: ${n.nodeFamily}`,
      );
    });
  } catch (err) {
    console.error("❌ خطا:", err.message, err.context || "");
  }
}

main().catch(console.error);
