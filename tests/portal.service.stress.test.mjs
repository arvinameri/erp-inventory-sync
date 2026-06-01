// D:\hesabfa\inventory-sync\tests\portal.service.stress.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PortalService } from "../src/services/portal.service.js";

class MockHttpClient {
  constructor({ totalProducts = 468, networkDelayMs = 5 } = {}) {
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
          id: 200000 + i + 1,
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

test("getAllVariants keeps request rate under safe burst threshold for 468 products", async () => {
  const service = createService({
    portal: {
      detailRequestDelayMs: 250,
      pageRequestDelayMs: 500,
    },
  });

  const http = new MockHttpClient({
    totalProducts: 468,
    networkDelayMs: 5,
  });
  service.http = http;

  const startedAt = performance.now();
  const variants = await service.getAllVariants({ pageSize: 100 });
  const endedAt = performance.now();

  const durationMs = endedAt - startedAt;
  const durationSec = durationMs / 1000;

  const listCalls = http.getListCalls();
  const detailCalls = http.getDetailCalls();
  const detailGaps = http.getDetailGaps();

  const detailReqPerSec = detailCalls.length / durationSec;
  const minGap = Math.min(...detailGaps);
  const avgGap = detailGaps.reduce((sum, x) => sum + x, 0) / detailGaps.length;

  assert.equal(variants.length, 468);
  assert.equal(listCalls.length, 5);
  assert.equal(detailCalls.length, 468);

  assert.ok(
    minGap >= 240,
    `expected min detail gap >= 240ms, got ${minGap.toFixed(2)}ms`,
  );

  assert.ok(
    avgGap >= 245,
    `expected avg detail gap >= 245ms, got ${avgGap.toFixed(2)}ms`,
  );

  assert.ok(
    detailReqPerSec < 5,
    `expected detail req/sec < 5, got ${detailReqPerSec.toFixed(2)}`,
  );
});
