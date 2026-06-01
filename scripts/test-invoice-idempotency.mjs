import { env } from "../src/config/env.js";
import { PortalService } from "../src/services/portal.service.js";
import { HesabfaService } from "../src/services/hesabfa.service.js";
import { CustomerService } from "../src/services/customer.service.js";
import { InvoiceService } from "../src/services/invoice.service.js";

const orderId = process.env.TEST_ORDER_ID;
if (!orderId) {
  console.error("TEST_ORDER_ID is required");
  process.exit(1);
}

function pickInvoiceNumber(v) {
  return (
    v?.invoiceNumber ??
    v?.Number ??
    v?.number ??
    v?.Result?.Number ??
    v?.Result?.number ??
    null
  );
}

function toSafeString(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function extractOrderSkus(order) {
  const rawItems =
    order?.items ??
    order?.order_items ??
    order?.products ??
    order?.line_items ??
    [];

  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((x) =>
      toSafeString(
        x?.sku ?? x?.product_sku ?? x?.code ?? x?.product_code ?? "",
      ),
    )
    .filter(Boolean);
}

async function main() {
  const portalService = new PortalService({
    baseURL: env.portal.baseUrl,
    authHeaderName: env.portal.authHeaderName,
    authHeaderValue: env.portal.authHeaderValue,
    timeout: env.sync.requestTimeoutMs,
    retries: env.sync.retryCount,
    config: env,
  });

  const hesabfaService = new HesabfaService({
    baseURL: env.hesabfa.baseUrl,
    apiKey: env.hesabfa.apiKey,
    loginToken: env.hesabfa.loginToken,
    userId: env.hesabfa.userId,
    password: env.hesabfa.password,
    yearId: env.hesabfa.yearId,
    timeout: env.sync.requestTimeoutMs,
    retries: env.sync.retryCount,
  });

  const customerService = new CustomerService({
    portalService,
    hesabfaService,
  });

  const invoiceService = new InvoiceService({
    portalService,
    hesabfaService,
    customerService,
    config: env,
  });

  const report = {
    orderId,
    step: "start",
    precheck: {},
    firstRun: null,
    secondRun: null,
    success: false,
  };

  try {
    report.step = "get-order";
    const order = await invoiceService.getPortalOrder(orderId);
    report.precheck.orderFound = !!order;
    report.precheck.orderStatus =
      order?.status ?? order?.order_status ?? order?.payment_status ?? null;

    const skus = extractOrderSkus(order);
    report.precheck.skus = skus;

    report.step = "precheck-existing-invoice";
    const existingBefore = await invoiceService.isOrderAlreadyInvoiced(orderId);
    report.precheck.invoiceBefore = pickInvoiceNumber(existingBefore);

    report.step = "first-run";
    const first = await invoiceService.processOrder(order, { dryRun: false });
    report.firstRun = {
      action: first?.action,
      invoiceNumber: pickInvoiceNumber(first),
      warehouseError: first?.warehouseError ?? null,
      receiptError: first?.receiptError ?? null,
      reason: first?.reason ?? null,
      hint: first?.hint ?? null,
    };

    report.step = "second-run";
    const second = await invoiceService.processOrder(order, { dryRun: false });
    report.secondRun = {
      action: second?.action,
      invoiceNumber: pickInvoiceNumber(second),
      warehouseError: second?.warehouseError ?? null,
      receiptError: second?.receiptError ?? null,
      reason: second?.reason ?? null,
      hint: second?.hint ?? null,
    };

    report.success =
      report.firstRun?.action === "invoiced" &&
      report.secondRun?.action === "already_invoiced";

    report.step = "done";
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    report.success = false;
    report.error = {
      message: err?.message ?? String(err),
      statusCode: err?.statusCode ?? null,
      details: err?.details ?? null,
      stack: err?.stack ?? null,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();
