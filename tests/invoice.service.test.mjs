// D:\hesabfa\inventory-sync\tests\invoice.service.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TMP_DIR = path.resolve("./tests/.tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

async function importFreshInvoiceService(uniqueKey) {
  const mod = await import(
    `../src/services/invoice.service.js?test=${uniqueKey}`
  );
  return mod.InvoiceService;
}

function makeProcessedFile() {
  return path.join(TMP_DIR, `processed-orders-${crypto.randomUUID()}.json`);
}

function cleanupFile(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function createOrder(overrides = {}) {
  return {
    id: 9001,
    status: "completed",
    created: { timestamp: 1716710400 },
    contact: { name: "Ali Ahmadi", mobile: "09120000000" },
    items: [
      {
        sku: "SKU-1",
        title: "گوشی سامسونگ",
        quantity: 1,
        unit_price: 225000000,
      },
    ],
    total_price: 225000000,
    ...overrides,
  };
}

function createDeps(overrides = {}) {
  const calls = {
    ensureContact: 0,
    saveInvoice: 0,
    saveWarehouseReceipt: 0,
    savePayment: 0,
    markProcessedPut: 0,
    getInvoices: 0,
    getItems: 0,
    itemSave: 0,
  };

  const portalService = {
    http: {
      async get(url) {
        if (url.includes("/orders/")) {
          return createOrder();
        }
        return { orders: [] };
      },
      async put() {
        calls.markProcessedPut += 1;
        return { success: true };
      },
    },
  };

  const hesabfaService = {
    async call(path, payload) {
      if (path === "/invoice/getInvoices") {
        calls.getInvoices += 1;
        return { List: [] };
      }

      if (path === "/item/getItems") {
        calls.getItems += 1;
        return {
          List: [{ Code: "SKU-1", ItemType: 0 }],
        };
      }

      if (path === "/item/save") {
        calls.itemSave += 1;
        return { Code: payload.item.code };
      }

      if (path === "/invoice/save") {
        calls.saveInvoice += 1;
        return { Number: "10001" };
      }

      if (path === "/invoice/SaveWarehouseReceipt") {
        calls.saveWarehouseReceipt += 1;
        return { Result: "ok" };
      }

      if (path === "/invoice/savePayment") {
        calls.savePayment += 1;
        return { Result: "ok" };
      }

      if (path === "/setting/getFiscalYear") {
        return {
          StartDate: "2026-01-01",
          EndDate: "2026-12-31",
        };
      }

      return {};
    },
  };

  const customerService = {
    async ensureContact() {
      calls.ensureContact += 1;
      return { contactCode: "CUST-1" };
    },
  };

  return {
    calls,
    portalService: overrides.portalService ?? portalService,
    hesabfaService: overrides.hesabfaService ?? hesabfaService,
    customerService: overrides.customerService ?? customerService,
  };
}

async function createServiceForTest(config = {}, overrides = {}) {
  const processedFile = makeProcessedFile();
  process.env.PROCESSED_ORDERS_FILE = processedFile;
  process.env.HESABFA_CASH_CODE = "0009";
  process.env.HESABFA_WAREHOUSE_CODE = "11";
  process.env.HESABFA_DEFAULT_ITEM_TYPE = "0";

  const InvoiceService = await importFreshInvoiceService(crypto.randomUUID());
  const deps = createDeps(overrides);

  const service = new InvoiceService({
    portalService: deps.portalService,
    hesabfaService: deps.hesabfaService,
    customerService: deps.customerService,
    config,
  });

  return { service, deps, processedFile };
}

test("processOrder creates invoice only once for a paid order", async () => {
  const { service, deps, processedFile } = await createServiceForTest({
    hesabfa: {
      invoiceType: 0,
      allowAutoCreateItems: false,
      enableWarehouseReceipt: true,
      enablePaymentReceipt: true,
    },
  });

  try {
    const result = await service.processOrder(createOrder());

    assert.equal(result.action, "invoiced");
    assert.equal(deps.calls.saveInvoice, 1);
    assert.equal(deps.calls.saveWarehouseReceipt, 1);
    assert.equal(deps.calls.savePayment, 1);
    assert.equal(deps.calls.markProcessedPut, 1);

    const persisted = JSON.parse(fs.readFileSync(processedFile, "utf8"));
    assert.ok(persisted["9001"]);
    assert.equal(persisted["9001"].invoiceCreated, true);
    assert.equal(persisted["9001"].invoiceNumber, "10001");
  } finally {
    cleanupFile(processedFile);
  }
});

test("processOrder does not create duplicate invoice on second run in same service instance", async () => {
  const { service, deps, processedFile } = await createServiceForTest({
    hesabfa: {
      invoiceType: 0,
      allowAutoCreateItems: false,
      enableWarehouseReceipt: true,
      enablePaymentReceipt: true,
    },
  });

  try {
    const first = await service.processOrder(createOrder());
    const second = await service.processOrder(createOrder());

    assert.equal(first.action, "invoiced");
    assert.equal(second.action, "already_invoiced");
    assert.equal(deps.calls.saveInvoice, 1);
    assert.equal(deps.calls.saveWarehouseReceipt, 1);
    assert.equal(deps.calls.savePayment, 1);
  } finally {
    cleanupFile(processedFile);
  }
});

test("processOrder does not create duplicate invoice after service/module reload", async () => {
  const processedFile = makeProcessedFile();

  process.env.PROCESSED_ORDERS_FILE = processedFile;
  process.env.HESABFA_CASH_CODE = "0009";
  process.env.HESABFA_WAREHOUSE_CODE = "11";
  process.env.HESABFA_DEFAULT_ITEM_TYPE = "0";

  const InvoiceService1 = await importFreshInvoiceService(crypto.randomUUID());
  const deps1 = createDeps();
  const service1 = new InvoiceService1({
    portalService: deps1.portalService,
    hesabfaService: deps1.hesabfaService,
    customerService: deps1.customerService,
    config: { hesabfa: { invoiceType: 0 } },
  });

  try {
    const first = await service1.processOrder(createOrder());
    assert.equal(first.action, "invoiced");
    assert.equal(deps1.calls.saveInvoice, 1);

    const InvoiceService2 = await importFreshInvoiceService(
      crypto.randomUUID(),
    );
    const deps2 = createDeps();
    const service2 = new InvoiceService2({
      portalService: deps2.portalService,
      hesabfaService: deps2.hesabfaService,
      customerService: deps2.customerService,
      config: { hesabfa: { invoiceType: 0 } },
    });

    const second = await service2.processOrder(createOrder());

    assert.equal(second.action, "already_invoiced");
    assert.equal(deps2.calls.saveInvoice, 0);
    assert.equal(deps2.calls.saveWarehouseReceipt, 0);
    assert.equal(deps2.calls.savePayment, 0);
  } finally {
    cleanupFile(processedFile);
  }
});

test("existing Hesabfa invoice prevents duplicate save", async () => {
  const { service, processedFile } = await createServiceForTest(
    { hesabfa: { invoiceType: 0 } },
    {
      hesabfaService: {
        async call(path) {
          if (path === "/invoice/getInvoices") {
            return { List: [{ Number: "10077" }] };
          }
          if (path === "/setting/getFiscalYear") {
            return {
              StartDate: "2026-01-01",
              EndDate: "2026-12-31",
            };
          }
          if (path === "/item/getItems") {
            return { List: [{ Code: "SKU-1", ItemType: 0 }] };
          }
          return {};
        },
      },
    },
  );

  try {
    const result = await service.processOrder(createOrder());
    assert.equal(result.action, "already_invoiced");
    assert.equal(result.invoiceNumber, "10077");
  } finally {
    cleanupFile(processedFile);
  }
});

test("invoiceType must stay 0 for sales flow", async () => {
  const { service, processedFile } = await createServiceForTest({
    hesabfa: { invoiceType: 0 },
  });

  try {
    assert.equal(service.invoiceType, 0);
  } finally {
    cleanupFile(processedFile);
  }
});
