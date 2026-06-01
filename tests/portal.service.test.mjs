// D:\hesabfa\inventory-sync\tests\portal.service.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PortalService } from "../src/services/portal.service.js";

class MockHttpClient {
  constructor({ totalProducts = 5, networkDelayMs = 5 } = {}) {
    this.totalProducts = totalProducts;
    this.networkDelayMs = networkDelayMs;
    this.calls = [];
  }

  async get(url) {
    const at = performance.now();
    this.calls.push({ method: "GET", url, at });

    if (this.networkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.networkDelayMs));
    }

    if (url.includes("/site/api/v1/manage/store/products?")) {
      const parsed = new URL(`https://fake.local${url}`);
      const page = Number(parsed.searchParams.get("page") || 1);
      const size = Number(parsed.searchParams.get("size") || 100);

      const start = (page - 1) * size;
      const end = Math.min(start + size, this.totalProducts);

      const products = [];
      for (let i = start; i < end; i += 1) {
        products.push({
          id: 1000 + i + 1,
          title: `product-${i + 1}`,
        });
      }

      return {
        products,
        total: this.totalProducts,
        count: products.length,
      };
    }

    const detailMatch = url.match(
      /\/site\/api\/v1\/manage\/store\/products\/(\d+)$/,
    );
    if (detailMatch) {
      const id = Number(detailMatch[1]);
      return {
        id,
        title: `product-${id}`,
        fields: [
          { name: "بارکد", value: `BAR-${id}` },
          { name: "دسته‌بندی انبار", value: "mobile" },
        ],
        variants: [
          {
            id: id * 10 + 1,
            productId: id,
            title: `variant-${id}`,
            sku: `SKU-${id}`,
            barcode: `VAR-${id}`,
            stock: 2,
            price: 225000000,
          },
        ],
      };
    }

    throw new Error(`Unexpected GET ${url}`);
  }

  async request({ method, url, data }) {
    const at = performance.now();
    this.calls.push({ method, url, data, at });
    return { success: true };
  }

  getListCalls() {
    return this.calls.filter(
      (c) =>
        c.method === "GET" &&
        c.url.includes("/site/api/v1/manage/store/products?"),
    );
  }

  getDetailCalls() {
    return this.calls.filter(
      (c) =>
        c.method === "GET" &&
        /\/site\/api\/v1\/manage\/store\/products\/\d+$/.test(c.url),
    );
  }

  getDetailGaps() {
    const detailCalls = this.getDetailCalls();
    const gaps = [];
    for (let i = 1; i < detailCalls.length; i += 1) {
      gaps.push(detailCalls[i].at - detailCalls[i - 1].at);
    }
    return gaps;
  }
}

function createService(config = {}) {
  return new PortalService({
    baseURL: "https://fake.local",
    authHeaderName: "X-Test-Auth",
    authHeaderValue: "token",
    timeout: 30000,
    retries: 0,
    config,
  });
}

test("getAllVariants returns normalized variants and expected request counts", async () => {
  const service = createService({
    portal: {
      detailRequestDelayMs: 0,
      pageRequestDelayMs: 0,
    },
  });

  const http = new MockHttpClient({ totalProducts: 5, networkDelayMs: 1 });
  service.http = http;

  const variants = await service.getAllVariants({ pageSize: 2 });

  assert.equal(variants.length, 5);

  assert.deepEqual(
    variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      sku: v.sku,
      barcode: v.barcode,
      nodeFamily: v.nodeFamily,
      stock: v.stock,
      price: v.price,
    })),
    [
      {
        id: 10011,
        productId: 1001,
        sku: "SKU-1001",
        barcode: "VAR-1001",
        nodeFamily: "mobile",
        stock: 2,
        price: 225000000,
      },
      {
        id: 10021,
        productId: 1002,
        sku: "SKU-1002",
        barcode: "VAR-1002",
        nodeFamily: "mobile",
        stock: 2,
        price: 225000000,
      },
      {
        id: 10031,
        productId: 1003,
        sku: "SKU-1003",
        barcode: "VAR-1003",
        nodeFamily: "mobile",
        stock: 2,
        price: 225000000,
      },
      {
        id: 10041,
        productId: 1004,
        sku: "SKU-1004",
        barcode: "VAR-1004",
        nodeFamily: "mobile",
        stock: 2,
        price: 225000000,
      },
      {
        id: 10051,
        productId: 1005,
        sku: "SKU-1005",
        barcode: "VAR-1005",
        nodeFamily: "mobile",
        stock: 2,
        price: 225000000,
      },
    ],
  );

  assert.equal(http.getListCalls().length, 3);
  assert.equal(http.getDetailCalls().length, 5);
});

test("getAllVariants applies delay between detail requests when throttling is enabled", async () => {
  const service = createService({
    portal: {
      detailRequestDelayMs: 40,
      pageRequestDelayMs: 0,
    },
  });

  const http = new MockHttpClient({ totalProducts: 4, networkDelayMs: 1 });
  service.http = http;

  await service.getAllVariants({ pageSize: 4 });

  const gaps = http.getDetailGaps();

  assert.equal(gaps.length, 3);
  for (const gap of gaps) {
    assert.ok(
      gap >= 35,
      `expected detail gap >= 35ms, got ${gap.toFixed(2)}ms`,
    );
  }
});

test("getAllVariants applies delay between pages when page throttling is enabled", async () => {
  const service = createService({
    portal: {
      detailRequestDelayMs: 0,
      pageRequestDelayMs: 50,
    },
  });

  const http = new MockHttpClient({ totalProducts: 5, networkDelayMs: 1 });
  service.http = http;

  await service.getAllVariants({ pageSize: 2 });

  const listCalls = http.getListCalls();
  assert.equal(listCalls.length, 3);

  const pageGap1 = listCalls[1].at - listCalls[0].at;
  const pageGap2 = listCalls[2].at - listCalls[1].at;

  assert.ok(
    pageGap1 >= 45,
    `expected page gap >= 45ms, got ${pageGap1.toFixed(2)}ms`,
  );
  assert.ok(
    pageGap2 >= 45,
    `expected page gap >= 45ms, got ${pageGap2.toFixed(2)}ms`,
  );
});

test("normalizeProductToVariants falls back to product-level data when variants are missing", async () => {
  const service = createService();

  const result = service.normalizeProductToVariants({
    id: 179042571,
    title: "گوشی موبایل استوک مدل سامسونگ samsung s25 ultra 256/12",
    sku: "S25-ULTRA",
    barcode: "1234567890",
    stock: 0,
    price: 225000000,
    fields: [
      { name: "بارکد", value: "۹۸۷۶۵۴۳۲۱۰" },
      { name: "دسته‌بندی انبار", value: "mobile" },
    ],
    variants: [],
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    raw: {
      id: 179042571,
      title: "گوشی موبایل استوک مدل سامسونگ samsung s25 ultra 256/12",
      sku: "S25-ULTRA",
      barcode: "1234567890",
      stock: 0,
      price: 225000000,
      fields: [
        { name: "بارکد", value: "۹۸۷۶۵۴۳۲۱۰" },
        { name: "دسته‌بندی انبار", value: "mobile" },
      ],
      variants: [],
    },
    id: 179042571,
    productId: 179042571,
    title: "گوشی موبایل استوک مدل سامسونگ samsung s25 ultra 256/12",
    sku: "S25-ULTRA",
    barcode: "9876543210",
    nodeFamily: "mobile",
    stock: 0,
    price: 225000000,
    fields: [
      { name: "بارکد", value: "۹۸۷۶۵۴۳۲۱۰" },
      { name: "دسته‌بندی انبار", value: "mobile" },
    ],
    product: {
      id: 179042571,
      title: "گوشی موبایل استوک مدل سامسونگ samsung s25 ultra 256/12",
      sku: "S25-ULTRA",
      barcode: "1234567890",
      stock: 0,
      price: 225000000,
      fields: [
        { name: "بارکد", value: "۹۸۷۶۵۴۳۲۱۰" },
        { name: "دسته‌بندی انبار", value: "mobile" },
      ],
      variants: [],
    },
  });
});

test("updateVariantStockAndPrice sends only valid fields", async () => {
  const service = createService();
  const http = new MockHttpClient();
  service.http = http;

  await service.updateVariantStockAndPrice("555", 7.8, 225000000.9);

  const call = http.calls.at(-1);
  assert.equal(call.method, "PATCH");
  assert.equal(call.url, "/site/api/v1/manage/store/products/variants/555");
  assert.deepEqual(call.data, {
    stock: 7,
    price: 225000000,
  });
});

test("updateVariantStockAndPrice returns null when both values are invalid", async () => {
  const service = createService();
  const http = new MockHttpClient();
  service.http = http;

  const result = await service.updateVariantStockAndPrice("555", "x", -1);

  assert.equal(result, null);
  assert.equal(http.calls.length, 0);
});
