// scripts/check-barcode-fix.mjs
import { env } from "../src/config/env.js";
import { PortalService } from "../src/services/portal.service.js";

const portal = new PortalService({
  baseURL: env.portal.baseUrl,
  authHeaderName: env.portal.authHeaderName,
  authHeaderValue: env.portal.authHeaderValue,
  timeout: 30000,
  retries: 1,
  config: { portal: env.portal },
});

async function main() {
  console.log("🔍 تست خواندن barcode از fields...\n");

  // detail یک محصول
  const product = await portal.getProductById(179009828);
  const variants = portal.normalizeProductToVariants(product);

  variants.forEach((v) => {
    console.log(`variant: ${v.title}`);
    console.log(`  sku:     "${v.sku}"`);
    console.log(`  barcode: "${v.barcode}"`);
    console.log(
      v.barcode && v.barcode !== v.sku
        ? "  ✅ barcode از fields خوانده شد"
        : "  ⚠️  barcode هنوز از sku می‌آید",
    );
  });
}

main().catch(console.error);
