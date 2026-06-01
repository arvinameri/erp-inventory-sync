// Path: scripts/export-unmatched-inventory.mjs
import fs from "node:fs/promises";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUT_JSON = process.env.OUT_JSON || "unmatched-inventory.json";
const OUT_CSV = process.env.OUT_CSV || "unmatched-inventory.csv";

const toCsv = (rows) => {
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const headers = ["variantId", "productId", "title", "barcode", "reason"];
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((k) => escape(row[k])).join(","));
  }

  return "\uFEFF" + lines.join("\n");
};

const main = async () => {
  const res = await fetch(`${BASE_URL}/sync/inventory/unmatched?format=json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch unmatched report: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  await fs.writeFile(OUT_JSON, JSON.stringify(data, null, 2), "utf8");
  await fs.writeFile(OUT_CSV, toCsv(data.unmatched || []), "utf8");

  console.log(`Saved: ${OUT_JSON}`);
  console.log(`Saved: ${OUT_CSV}`);
  console.log(`Unmatched: ${(data.unmatched || []).length}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
