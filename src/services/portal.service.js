// D:\hesabfa\inventory-sync\src\services\portal.service.js
import { HttpClient } from "../clients/http.client.js";
import { ValidationError } from "../utils/errors.js";

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.Items)) return value.Items;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.Result)) return value.Result;
  if (Array.isArray(value?.variants)) return value.variants;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.List)) return value.List;
  if (Array.isArray(value?.data?.items)) return value.data.items;
  if (Array.isArray(value?.data?.variants)) return value.data.variants;
  if (Array.isArray(value?.data?.products)) return value.data.products;
  return [];
};

const readField = (object, names, defaultValue = undefined) => {
  if (!object || typeof object !== "object") return defaultValue;
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null) {
      return object[name];
    }
  }
  return defaultValue;
};

const toSafeString = (value) =>
  value === null || value === undefined ? "" : String(value).trim();

const normalizeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toEnglishDigits = (value) =>
  String(value).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));

const normalizeBarcode = (value) =>
  toEnglishDigits(toSafeString(value)).replace(/\s+/g, "");

const extractProductPayload = (response) =>
  response?.product && typeof response.product === "object"
    ? response.product
    : response;

const extractBarcodeFromFields = (fields) => {
  if (!Array.isArray(fields)) return "";
  const BARCODE_FIELD_NAMES = [
    "بارکد",
    "barcode",
    "Barcode",
    "BarCode",
    "bar_code",
  ];
  const found = fields.find((f) => BARCODE_FIELD_NAMES.includes(f?.name));
  return found?.value ? normalizeBarcode(found.value) : "";
};

const extractNodeFamilyFromFields = (fields) => {
  if (!Array.isArray(fields)) return "";
  const NODE_FAMILY_FIELD_NAMES = [
    "دسته‌بندی انبار",
    "دسته بندی انبار",
    "nodeFamily",
    "NodeFamily",
    "node_family",
  ];
  const found = fields.find((f) => NODE_FAMILY_FIELD_NAMES.includes(f?.name));
  return found?.value ? toSafeString(found.value) : "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class PortalService {
  constructor({
    baseURL,
    authHeaderName,
    authHeaderValue,
    timeout,
    retries,
    config = {},
  }) {
    if (!baseURL) throw new ValidationError("PORTAL_BASE_URL is required");
    if (!authHeaderName) {
      throw new ValidationError("PORTAL_AUTH_HEADER_NAME is required");
    }
    if (!authHeaderValue) {
      throw new ValidationError("PORTAL_AUTH_HEADER_VALUE is required");
    }

    this.config = config;
    this.http = new HttpClient({
      baseURL,
      timeout,
      retries,
      serviceName: "portal",
      headers: { [authHeaderName]: authHeaderValue },
    });

    this.detailRequestDelayMs =
      Number(this.config.portal?.detailRequestDelayMs) > 0
        ? Number(this.config.portal.detailRequestDelayMs)
        : 250;

    this.pageRequestDelayMs =
      Number(this.config.portal?.pageRequestDelayMs) > 0
        ? Number(this.config.portal.pageRequestDelayMs)
        : 500;
  }

  async getProducts({ page = 1, size = 100 } = {}) {
    const path =
      this.config.portal?.productListPath ||
      "/site/api/v1/manage/store/products";
    const sep = path.includes("?") ? "&" : "?";
    const response = await this.http.get(
      `${path}${sep}page=${page}&size=${size}`,
    );
    const items = asArray(response?.products ?? response);
    const total = normalizeNumber(response?.total) ?? items.length;
    const count = normalizeNumber(response?.count) ?? items.length;
    return { raw: response, items, total, count, page, size };
  }

  async getProductById(id) {
    if (!id) throw new ValidationError("Portal product id is required");
    const template =
      this.config.portal?.productDetailPathTemplate ||
      "/site/api/v1/manage/store/products/{id}";
    const url = template.replace("{id}", encodeURIComponent(String(id)));
    const response = await this.http.get(url);
    return extractProductPayload(response);
  }

  async deleteProduct(id) {
    if (!id) throw new ValidationError("Portal product id is required");
    const url = `/site/api/v1/manage/store/products/${encodeURIComponent(String(id))}`;
    return this.http.request({ method: "DELETE", url });
  }

  async getAllVariants({ pageSize = 100 } = {}) {
    const all = [];
    let page = 1;

    while (true) {
      const { items, total } = await this.getProducts({ page, size: pageSize });
      if (items.length === 0) break;

      for (let index = 0; index < items.length; index += 1) {
        const productSummary = items[index];
        const productId = readField(productSummary, ["id", "Id", "_id"]);
        if (!productId) continue;

        let product;
        try {
          product = await this.getProductById(productId);
        } catch {
          continue;
        }

        all.push(...this.normalizeProductToVariants(product));

        const isLastItemOnPage = index === items.length - 1;
        if (!isLastItemOnPage && this.detailRequestDelayMs > 0) {
          await sleep(this.detailRequestDelayMs);
        }
      }

      const seenProducts = page * pageSize;
      if (seenProducts >= total || items.length < pageSize) break;

      page += 1;

      if (this.pageRequestDelayMs > 0) {
        await sleep(this.pageRequestDelayMs);
      }
    }

    return all;
  }

  async updateVariantStock(id, stock) {
    if (!id) throw new ValidationError("Portal variant id is required");
    const normalizedStock = Number(stock);
    if (!Number.isFinite(normalizedStock)) {
      throw new ValidationError("Portal variant stock must be a valid number");
    }

    const url = this._variantUrl(id);
    return this.http.request({
      method: "PATCH",
      url,
      data: { stock: Math.max(0, Math.floor(normalizedStock)) },
    });
  }

  async updateVariantPrice(id, price) {
    if (!id) throw new ValidationError("Portal variant id is required");
    const normalizedPrice = Number(price);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      throw new ValidationError(
        "Portal variant price must be a valid non-negative number",
      );
    }

    const url = this._variantUrl(id);
    return this.http.request({
      method: "PATCH",
      url,
      data: { price: Math.floor(normalizedPrice) },
    });
  }

  async updateVariantStockAndPrice(id, stock, price) {
    if (!id) throw new ValidationError("Portal variant id is required");

    const payload = {};

    const normalizedStock = Number(stock);
    if (Number.isFinite(normalizedStock)) {
      payload.stock = Math.max(0, Math.floor(normalizedStock));
    }

    const normalizedPrice = Number(price);
    if (Number.isFinite(normalizedPrice) && normalizedPrice >= 0) {
      payload.price = Math.floor(normalizedPrice);
    }

    if (Object.keys(payload).length === 0) return null;

    const url = this._variantUrl(id);
    return this.http.request({ method: "PATCH", url, data: payload });
  }

  _variantUrl(id) {
    const template =
      this.config.portal?.variantStockUpdatePathTemplate ||
      "/site/api/v1/manage/store/products/variants/{id}";
    return template.replace("{id}", encodeURIComponent(String(id)));
  }

  normalizeProductToVariants(product) {
    const safeProduct = extractProductPayload(product);
    const productId = readField(safeProduct, ["id", "Id", "_id"]);
    const productTitle = toSafeString(
      readField(safeProduct, ["title", "Title", "name", "Name"], ""),
    );
    const productFields = Array.isArray(safeProduct?.fields)
      ? safeProduct.fields
      : [];
    const variants = Array.isArray(safeProduct?.variants)
      ? safeProduct.variants
      : [];

    const barcodeFromFields = extractBarcodeFromFields(productFields);
    const nodeFamilyFromFields = extractNodeFamilyFromFields(productFields);

    if (variants.length === 0) {
      const sku = toSafeString(
        readField(safeProduct, ["sku", "Sku", "SKU"], ""),
      );
      const barcodeRaw = normalizeBarcode(
        readField(safeProduct, ["barcode", "Barcode"], ""),
      );

      return [
        {
          raw: safeProduct,
          id: productId,
          productId,
          title: productTitle,
          sku,
          barcode: barcodeFromFields || barcodeRaw || sku,
          nodeFamily: nodeFamilyFromFields,
          stock: normalizeNumber(readField(safeProduct, ["stock", "Stock"])),
          price: normalizeNumber(readField(safeProduct, ["price", "Price"])),
          fields: productFields,
          product: safeProduct,
        },
      ];
    }

    return variants.map((variant) =>
      this.normalizeVariant(
        variant,
        productId,
        productTitle,
        productFields,
        safeProduct,
        barcodeFromFields,
        nodeFamilyFromFields,
      ),
    );
  }

  normalizeVariant(
    variant,
    productId,
    productTitle,
    productFields,
    safeProduct,
    barcodeFromFields = "",
    nodeFamilyFromFields = "",
  ) {
    const id = readField(variant, ["id", "Id", "_id"]);
    const sku = toSafeString(
      readField(variant, ["sku", "Sku", "SKU", "code", "Code"], ""),
    );

    const barcodeRaw = normalizeBarcode(
      readField(
        variant,
        [
          "barcode",
          "Barcode",
          "barCode",
          "BarCode",
          "ean",
          "EAN",
          "upc",
          "UPC",
          "gtin",
          "GTIN",
        ],
        "",
      ),
    );
    const barcode = barcodeRaw || barcodeFromFields || sku;

    const stock = normalizeNumber(readField(variant, ["stock", "Stock"]));
    const price = normalizeNumber(readField(variant, ["price", "Price"]));
    const title = toSafeString(
      readField(variant, ["title", "Title", "name", "Name"], ""),
    );
    const variantId = id ?? readField(variant, ["variantId", "VariantId"]);

    return {
      raw: variant,
      id: variantId,
      productId:
        readField(variant, [
          "productId",
          "ProductId",
          "product_id",
          "storeProductId",
        ]) || productId,
      title: title || productTitle,
      sku,
      barcode,
      nodeFamily: nodeFamilyFromFields,
      stock,
      price,
      fields: productFields,
      product: safeProduct,
    };
  }
}
