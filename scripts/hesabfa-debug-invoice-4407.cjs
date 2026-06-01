const fs = require("fs");
const path = require("path");

const BASE = process.env.HESABFA_BASE_URL || "https://api.hesabfa.com/v1";

async function post(pathName, body) {
  const res = await fetch(`${BASE}${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: process.env.HESABFA_API_KEY,
      loginToken: process.env.HESABFA_LOGIN_TOKEN,
      ...body,
    }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    ok: res.ok,
    status: res.status,
    url: `${BASE}${pathName}`,
    body: json,
  };
}

async function main() {
  const result = {
    invoice_get: await post("/invoice/get", {
      type: 0,
      number: 4407,
    }),
    save_payment_sample_shape: await post("/invoice/savePayment", {
      type: 0,
      number: 4407,
      cashCode: process.env.HESABFA_CASH_CODE || "0009",
      amount: 1,
      date: "2026-05-25 00:00:00",
      transactionNumber: `DEBUG-${Date.now()}`,
      description: "debug",
    }),
  };

  const out = path.resolve("output/hesabfa-debug-invoice-4407.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
