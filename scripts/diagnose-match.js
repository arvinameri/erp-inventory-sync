// Path: scripts/diagnose-match.js
import "dotenv/config";
import { SyncService } from "../src/services/sync.service.js";

const TARGETS = ["000466", "000365"];

const toEnglishDigits = (v) =>
  String(v).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const norm = (v) =>
  toEnglishDigits(
    v === null || v === undefined ? "" : String(v).trim(),
  ).replace(/\s+/g, "");
const hit = (target, ...vals) =>
  vals.filter(Boolean).some((x) => norm(x).includes(target));

const svc = new SyncService();
const portal = svc.portalService;
const hesabfa = svc.hesabfaService;

(async () => {
  // ── 1) خام پورتال ────────────────────────────────────────
  const variants = await portal.getAllVariants({ pageSize: 100 });
  console.log("\n>>> total portal variants:", variants.length);

  for (const t of TARGETS) {
    const m = variants.filter((v) =>
      hit(t, v.sku, v.barcode, v.normalizedBarcode, v.title),
    );
    console.log(`\n=== PORTAL "${t}" -> ${m.length} match`);
    m.forEach((v) =>
      console.log({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        normalizedSku: norm(v.sku),
        barcode: v.barcode,
        stock: v.stock ?? v.inventory ?? v.inventoryQuantity ?? v.qty,
        price: v.price,
        title: v.title,
      }),
    );
  }

  // ── 2) خام حسابفا ────────────────────────────────────────
  const rawItems = await hesabfa.getAllItems({ pageSize: 100 });
  console.log("\n>>> total hesabfa items:", rawItems.length);

  for (const t of TARGETS) {
    const found = rawItems
      .map((r) => hesabfa.normalizeItem(r))
      .filter(Boolean)
      .filter((i) => hit(t, i.code, i.barcode, i.name));
    console.log(`\n=== HESABFA "${t}" -> ${found.length} match`);
    found.forEach((i) =>
      console.log({
        code: i.code,
        normalizedCode: norm(i.code),
        barcode: i.barcode,
        name: i.name,
        stock: i.stock,
        nodeFamily: i.nodeFamily,
        excluded: i.excluded,
      }),
    );
  }

  // ── 3) نتیجهٔ منطق واقعی ربات ────────────────────────────
  const { summary, matchedEntries, unmatchedEntries } =
    await svc.buildInventorySyncPreview();

  console.log("\n>>> preview summary:", {
    matched: summary.matchedCount,
    unmatched: summary.unmatchedCount,
    excluded: summary.excludedCount,
  });

  for (const t of TARGETS) {
    const inMatched = matchedEntries.filter((e) =>
      hit(t, e.variant?.sku, e.variant?.normalizedBarcode, e.item?.code),
    );
    const inUnmatched = unmatchedEntries.filter((e) =>
      hit(t, e.barcode, e.title),
    );
    const inExcluded = (summary.excluded || []).filter((e) =>
      hit(t, e.barcode, e.title),
    );

    console.log(`\n### VERDICT "${t}"`);
    console.log(
      "  matched:",
      inMatched.length,
      inMatched.map((e) => ({
        sku: e.variant?.sku,
        code: e.item?.code,
        hStock: e.item?.stock,
        pStock: e.variant?.stock,
      })),
    );
    console.log("  unmatched:", inUnmatched);
    console.log("  excluded:", inExcluded);
  }

  process.exit(0);
})().catch((e) => {
  console.error("DIAGNOSE ERROR:", e);
  process.exit(1);
});
