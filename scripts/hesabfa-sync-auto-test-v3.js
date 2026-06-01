const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const ORDER_ID = process.env.TEST_ORDER_ID || process.argv[2] || "";
const WAIT_MS = Number(process.env.TEST_WAIT_MS || 1500);

if (!ORDER_ID) {
  console.error("Usage: node scripts/hesabfa-sync-auto-test-v3.js <orderId>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (v) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function call(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function extractOrder(o) {
  return o?.order || o?.data || o || {};
}

function extractOrderItems(order) {
  const raw =
    order?.items ||
    order?.order_items ||
    order?.products ||
    order?.line_items ||
    [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => ({
    idx,
    sku: safe(
      item?.sku || item?.product_sku || item?.code || item?.product_code || "",
    ),
    title: safe(
      item?.title ||
        item?.name ||
        item?.product_name ||
        item?.product_title ||
        `item_${idx + 1}`,
    ),
    quantity: num(item?.quantity || item?.qty || item?.count || 1),
    unitPrice: num(item?.unit_price || item?.price || item?.single_price || 0),
    discount: num(item?.discount || item?.discount_price || 0),
    tax: num(item?.tax || item?.vat || 0),
  }));
}

async function getOrder() {
  const r = await call(
    `/invoice/debug-order/${encodeURIComponent(String(ORDER_ID))}`,
  );
  if (!r.ok || !r.body?.success)
    throw new Error(`debug-order failed: ${JSON.stringify(r.body)}`);
  return extractOrder(r.body.order);
}

async function checkInvoiced() {
  const r = await call(
    `/invoice/check/${encodeURIComponent(String(ORDER_ID))}`,
  );
  if (!r.ok || !r.body?.success)
    throw new Error(`check failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function runSingle(dryRun = false) {
  const r = await call("/invoice/single", {
    method: "POST",
    body: JSON.stringify({ orderId: ORDER_ID, dryRun }),
  });
  return r;
}

function summarizeSingleResponse(resp) {
  const b = resp.body || {};
  const result = b.result || {};
  return {
    httpStatus: resp.status,
    success: !!b.success,
    action: b.action || result.action || null,
    orderId: b.orderId || result.orderId || ORDER_ID,
    invoiceNumber: result.invoiceNumber || null,
    reason: b.reason || result.reason || null,
    hint: b.hint || result.hint || null,
    warehouseError: result.warehouseError || null,
    receiptError: result.receiptError || null,
  };
}

(async () => {
  const report = {
    baseUrl: BASE_URL,
    orderId: ORDER_ID,
    startedAt: new Date().toISOString(),
    checks: [],
    pass: false,
  };

  try {
    const order = await getOrder();
    const items = extractOrderItems(order);
    report.orderSnapshot = {
      id: order?.id || order?.order_id || null,
      status: order?.status || order?.order_status || null,
      customer: safe(
        order?.contact?.name || order?.customer_name || order?.user?.name || "",
      ),
      total:
        order?.total_price ||
        order?.total ||
        order?.price ||
        order?.amount ||
        null,
      shipping:
        order?.shipping_price ||
        order?.shipping ||
        order?.delivery_price ||
        order?.freight ||
        0,
      itemCount: items.length,
      items,
    };

    const before = await checkInvoiced();
    report.checks.push({
      step: "before_check",
      invoiced: before.invoiced,
      invoice: before.invoice || null,
    });

    const firstRun = await runSingle(false);
    const firstSummary = summarizeSingleResponse(firstRun);
    report.checks.push({
      step: "first_run",
      ...firstSummary,
      raw: firstRun.body,
    });

    await sleep(WAIT_MS);

    const afterFirst = await checkInvoiced();
    report.checks.push({
      step: "after_first_check",
      invoiced: afterFirst.invoiced,
      invoice: afterFirst.invoice || null,
    });

    const secondRun = await runSingle(false);
    const secondSummary = summarizeSingleResponse(secondRun);
    report.checks.push({
      step: "second_run",
      ...secondSummary,
      raw: secondRun.body,
    });

    await sleep(WAIT_MS);

    const afterSecond = await checkInvoiced();
    report.checks.push({
      step: "after_second_check",
      invoiced: afterSecond.invoiced,
      invoice: afterSecond.invoice || null,
    });

    const firstActionOk = ["invoiced", "already_invoiced"].includes(
      firstSummary.action,
    );
    const secondActionOk = secondSummary.action === "already_invoiced";
    const invoiceStable =
      safe(afterFirst?.invoice?.Number || afterFirst?.invoice?.number || "") ===
      safe(afterSecond?.invoice?.Number || afterSecond?.invoice?.number || "");
    const noWarehouseError = !firstSummary.warehouseError;
    const noReceiptError = !firstSummary.receiptError;

    report.assertions = {
      firstRunAccepted: firstActionOk,
      secondRunSkippedAsDuplicate: secondActionOk,
      invoiceNumberStableAfterRepeat: invoiceStable,
      noWarehouseError,
      noReceiptError,
    };

    report.notes = [
      "اگر first_run برابر invoiced باشد و second_run برابر already_invoiced باشد، منطق ضد تکرار درست کار کرده است.",
      "برای تایید نهایی مبلغ و کسر موجودی، خروجی این اسکریپت را با خود حسابفا و سایت روی همین orderId تطبیق بده.",
      "این اسکریپت عمدا سفارش را دو بار اجرا می‌کند تا لوپ و ثبت تکراری را شکار کند.",
    ];

    report.pass = Object.values(report.assertions).every(Boolean);
    report.endedAt = new Date().toISOString();

    console.log(JSON.stringify(report, null, 2));
    process.exit(report.pass ? 0 : 2);
  } catch (err) {
    report.pass = false;
    report.error = err?.message || String(err);
    report.endedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
})();
