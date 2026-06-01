// Path: src/services/hesabfa.service.js
import { HttpClient } from "../clients/http.client.js";
import { ExternalApiError, ValidationError } from "../utils/errors.js";
import { uniqueStrings } from "../utils/validators.js";

const readField = (object, names, defaultValue = undefined) => {
  if (!object || typeof object !== "object") return defaultValue;
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null)
      return object[name];
  }
  return defaultValue;
};

const toSafeString = (value) =>
  value === null || value === undefined ? "" : String(value).trim();

const toEnglishDigits = (value) =>
  String(value).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));

const normalizeCode = (value) =>
  toEnglishDigits(toSafeString(value)).replace(/\s+/g, "");

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const hasValue = (value) =>
  value !== null && value !== undefined && value !== "";

// ─── helper: extract items array from any hesabfa response shape ──────────────
const extractItems = (result) => {
  if (Array.isArray(result)) return result;
  // حسابفا گاهی هم Items هم items دارد؛ اولی که آرایه باشد برنده است
  for (const key of ["Items", "items", "List", "list"]) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  return [];
};

const EXCLUDED_NODE_FAMILIES = new Set([
  "کالاها : قطعات نو و استوک سخت افزار",
  "کالاها : لوازم جانبی : انواع بک کاور و کیف",
  "کالاها : لوازم جانبی : انواع باتری",
  "کالاها : محصولات گرین",
  "کالاها : لوازم جانبی : انواع گلس",
  "کالاها : لوازم جانبی : انواع گلس : گلس بوف",
  "کالاها : لوازم جانبی : انواع گلس : تقویت",
  "کالاها : لوازم جانبی : انواع قاب گوشی",
  "کالاها : نرم افزار",
  "کالاها : سرمایه گذاری",
  "خدمات : نرم افزار : خدمت نرم افزار",
  "خدمات",
]);

export class HesabfaService {
  constructor({
    baseURL,
    apiKey,
    loginToken,
    userId,
    password,
    yearId,
    timeout,
    retries,
  }) {
    if (!baseURL) throw new ValidationError("HESABFA_BASE_URL is required");
    if (!apiKey) throw new ValidationError("HESABFA_API_KEY is required");
    if (!loginToken && (!userId || !password)) {
      throw new ValidationError(
        "Either HESABFA_LOGIN_TOKEN or HESABFA_USER_ID/HESABFA_PASSWORD is required",
      );
    }

    this.apiKey = apiKey;
    this.loginToken = loginToken;
    this.userId = userId;
    this.password = password;
    this.yearId = yearId;

    this.http = new HttpClient({
      baseURL,
      timeout,
      retries,
      serviceName: "hesabfa",
    });
  }

  buildAuthPayload() {
    const payload = { apiKey: this.apiKey };
    if (this.loginToken) {
      payload.loginToken = this.loginToken;
    } else {
      payload.userId = this.userId;
      payload.password = this.password;
    }
    if (this.yearId) payload.yearId = this.yearId;
    return payload;
  }

  async call(endpoint, payload = {}) {
    const response = await this.http.post(endpoint, {
      ...this.buildAuthPayload(),
      ...payload,
    });

    if (!response || typeof response !== "object") {
      throw new ExternalApiError("Invalid Hesabfa response", "hesabfa", 502, {
        endpoint,
        response,
      });
    }

    if (response.Success !== true) {
      throw new ExternalApiError(
        response.ErrorMessage || "Hesabfa API returned an error",
        "hesabfa",
        502,
        {
          endpoint,
          errorCode: response.ErrorCode,
          errorMessage: response.ErrorMessage,
          response,
          payload,
        },
      );
    }

    return response.Result;
  }

  // --------------------------------------------------
  // FILTER HELPERS
  // بدون فیلتر در getItems/getAllItems — فیلتر فقط اینجاست
  // --------------------------------------------------

  isItemExcluded(item) {
    if (!item || typeof item !== "object") return false;
    const nodeFamily = toSafeString(
      readField(item, ["NodeFamily", "nodeFamily"], ""),
    );
    return EXCLUDED_NODE_FAMILIES.has(nodeFamily);
  }

  filterExcludedItems(items) {
    return ensureArray(items).filter((item) => !this.isItemExcluded(item));
  }

  // --------------------------------------------------
  // ITEM METHODS
  // --------------------------------------------------

  async getItemByCode(code) {
    if (!hasValue(code))
      throw new ValidationError("Hesabfa item code is required");
    return this.call("/item/get", { code: String(code) });
  }

  async getItemByBarcode(barcode) {
    if (!hasValue(barcode))
      throw new ValidationError("Hesabfa item barcode is required");
    return this.call("/item/getByBarcode", { barcode: String(barcode) });
  }

  async getItems({
    take = 100,
    skip = 0,
    filters = [],
    sortBy = "Code",
    sortDesc = false,
    search,
    searchFields,
  } = {}) {
    const queryInfo = { take, skip, sortBy, sortDesc, filters };
    if (hasValue(search)) queryInfo.search = search;
    if (hasValue(searchFields)) queryInfo.searchFields = searchFields;
    // ⚠️ بدون فیلتر — raw data برگشت داده می‌شود
    return this.call("/item/getItems", { queryInfo });
  }

  async getAllItems({
    pageSize = 100,
    filters = [],
    sortBy = "Code",
    sortDesc = false,
    search,
    searchFields,
  } = {}) {
    const allItems = [];
    let skip = 0;

    while (true) {
      const result = await this.call("/item/getItems", {
        queryInfo: {
          take: pageSize,
          skip,
          sortBy,
          sortDesc,
          filters,
          ...(hasValue(search) && { search }),
          ...(hasValue(searchFields) && { searchFields }),
        },
      });

      // ✅ استفاده از helper که مشکل Items/items دوگانه را حل می‌کند
      const items = extractItems(result);

      if (items.length === 0) break;

      allItems.push(...items);

      // اگر کمتر از pageSize برگشت، یعنی آخرین صفحه است
      if (items.length < pageSize) break;
      skip += pageSize;
    }

    return allItems;
  }

  async getQuantitiesByCodes(codes) {
    const normalizedCodes = uniqueStrings(codes);
    if (normalizedCodes.length === 0) return [];
    return this.call("/item/GetQuantity2", { codes: normalizedCodes });
  }

  async getQuantitiesByCodesAndWarehouse(codes, warehouseCode) {
    const normalizedCodes = uniqueStrings(codes);
    if (normalizedCodes.length === 0) return [];
    if (!hasValue(warehouseCode) && warehouseCode !== 0) {
      throw new ValidationError("warehouseCode is required");
    }
    return this.call("/item/GetQuantity", {
      warehouseCode,
      codes: normalizedCodes,
    });
  }

  async getInventory({ codes, warehouseCode } = {}) {
    if (hasValue(warehouseCode) || warehouseCode === 0) {
      return this.getQuantitiesByCodesAndWarehouse(codes, warehouseCode);
    }
    return this.getQuantitiesByCodes(codes);
  }

  // --------------------------------------------------
  // WAREHOUSE METHODS
  // --------------------------------------------------

  async getWarehouseReceipt(number) {
    if (!hasValue(number))
      throw new ValidationError("warehouse receipt number is required");
    return this.call("/warehouse/get", { number });
  }

  async getWarehouseReceiptById({ id, idList } = {}) {
    const hasId = hasValue(id);
    const hasIdList = Array.isArray(idList) && idList.length > 0;

    if (!hasId && !hasIdList)
      throw new ValidationError("Either id or idList is required");

    const payload = {};
    if (hasId) payload.id = id;
    if (hasIdList) payload.idList = idList;

    return this.call("/warehouse/GetById", payload);
  }

  async getWarehouseReceipts({
    type,
    take = 20,
    skip = 0,
    sortBy = "Date",
    sortDesc = true,
    filters = [],
    search,
    searchFields,
  } = {}) {
    if (!hasValue(type) && type !== 0)
      throw new ValidationError("warehouse receipt type is required");

    const queryInfo = { sortBy, sortDesc, take, skip, filters };
    if (hasValue(search)) queryInfo.search = search;
    if (hasValue(searchFields)) queryInfo.searchFields = searchFields;

    return this.call("/warehouse/getReceipts", { type, queryInfo });
  }

  async saveWarehouseReceipt({ deleteOldReceipts = false, receipt } = {}) {
    if (!receipt || typeof receipt !== "object") {
      throw new ValidationError("receipt object is required");
    }
    const normalizedReceipt = this.normalizeWarehouseSaveReceiptInput(receipt);
    return this.call("/warehouse/save", {
      deleteOldReceipts: Boolean(deleteOldReceipts),
      receipt: normalizedReceipt,
    });
  }

  async deleteWarehouseReceipt(number) {
    if (!hasValue(number))
      throw new ValidationError("warehouse receipt number is required");
    return this.call("/warehouse/delete", { number });
  }

  normalizeWarehouseSaveReceiptInput(receipt) {
    const invoiceType = toNumberOrNull(
      receipt.invoiceType || receipt.InvoiceType,
    );
    const warehouseCode = toNumberOrNull(
      receipt.warehouseCode || receipt.WarehouseCode,
    );
    const destinationWarehouseCode = toNumberOrNull(
      receipt.destinationWarehouseCode || receipt.DestinationWarehouseCode,
    );

    const items = ensureArray(receipt.items || receipt.Items).map(
      (item, index) => {
        const itemCode = readField(
          item,
          ["itemCode", "ItemCode", "code", "Code"],
          null,
        );
        const quantity = Number(readField(item, ["quantity", "Quantity"], NaN));
        const reference = readField(
          item,
          ["reference", "Reference"],
          undefined,
        );
        const notes = readField(
          item,
          ["notes", "Notes", "note", "Note"],
          undefined,
        );

        if (!hasValue(itemCode) && itemCode !== 0)
          throw new ValidationError(
            `receipt.items[${index}].itemCode is required`,
          );
        if (!Number.isFinite(quantity) || quantity <= 0)
          throw new ValidationError(
            `receipt.items[${index}].quantity must be a number greater than zero`,
          );

        const normalizedItem = { itemCode: String(itemCode), quantity };
        if (reference !== undefined)
          normalizedItem.reference = toSafeString(reference);
        if (notes !== undefined) normalizedItem.notes = toSafeString(notes);
        return normalizedItem;
      },
    );

    if (items.length === 0)
      throw new ValidationError("receipt.items must contain at least one item");

    const number = readField(receipt, ["number", "Number"], undefined);
    const invoiceNumber = readField(
      receipt,
      ["invoiceNumber", "InvoiceNumber"],
      undefined,
    );
    const date = readField(receipt, ["date", "Date"], undefined);
    const notes = readField(
      receipt,
      ["notes", "Notes", "note", "Note"],
      undefined,
    );
    const delivery = readField(receipt, ["delivery", "Delivery"], undefined);
    const freight = readField(receipt, ["freight", "Freight"], undefined);
    const project = readField(receipt, ["project", "Project"], undefined);
    const receiving = readField(receipt, ["receiving", "Receiving"], undefined);

    const normalizedReceipt = { items };
    const isTransfer = destinationWarehouseCode !== null;

    if (isTransfer) {
      normalizedReceipt.destinationWarehouseCode = destinationWarehouseCode;
      if (warehouseCode === null)
        throw new ValidationError(
          "receipt.warehouseCode is required for warehouse transfer",
        );
      normalizedReceipt.warehouseCode = warehouseCode;
    } else {
      if (invoiceType === null)
        throw new ValidationError("receipt.invoiceType is required");
      if (warehouseCode === null)
        throw new ValidationError("receipt.warehouseCode is required");
      normalizedReceipt.invoiceType = invoiceType;
      normalizedReceipt.invoiceNumber = toSafeString(invoiceNumber);
      normalizedReceipt.warehouseCode = warehouseCode;
    }

    if (hasValue(number))
      normalizedReceipt.number = toNumberOrNull(number) ?? number;
    if (date !== undefined) normalizedReceipt.date = toSafeString(date);
    if (notes !== undefined) normalizedReceipt.notes = toSafeString(notes);
    if (delivery !== undefined)
      normalizedReceipt.delivery = toSafeString(delivery);
    if (freight !== undefined && freight !== null && freight !== "")
      normalizedReceipt.freight = Number(freight) || 0;
    if (project !== undefined)
      normalizedReceipt.project = toSafeString(project);
    if (receiving !== undefined && receiving !== null)
      normalizedReceipt.receiving = Boolean(receiving);

    return normalizedReceipt;
  }

  // --------------------------------------------------
  // INVOICE METHODS
  // --------------------------------------------------

  async getInvoice(number, type) {
    if (!hasValue(number))
      throw new ValidationError("invoice number is required");
    if (!hasValue(type) && type !== 0)
      throw new ValidationError("invoice type is required");
    return this.call("/invoice/get", { number, type });
  }

  async getInvoiceById({ id, idList } = {}) {
    const hasId = hasValue(id);
    const hasIdList = Array.isArray(idList) && idList.length > 0;
    if (!hasId && !hasIdList)
      throw new ValidationError("Either id or idList is required");

    const payload = {};
    if (hasId) payload.id = id;
    if (hasIdList) payload.idList = idList;
    return this.call("/invoice/getById", payload);
  }

  async getInvoices({
    type,
    take = 20,
    skip = 0,
    sortBy = "Date",
    sortDesc = true,
    filters = [],
    search,
    searchFields,
  } = {}) {
    if (!hasValue(type) && type !== 0)
      throw new ValidationError("invoice type is required");

    const queryInfo = { sortBy, sortDesc, take, skip, filters };
    if (hasValue(search)) queryInfo.search = search;
    if (hasValue(searchFields)) queryInfo.searchFields = searchFields;

    return this.call("/invoice/getInvoices", { type, queryInfo });
  }

  async deleteInvoice(number, type) {
    if (!hasValue(number))
      throw new ValidationError("invoice number is required");
    if (!hasValue(type) && type !== 0)
      throw new ValidationError("invoice type is required");
    return this.call("/invoice/delete", { number, type });
  }

  async saveInvoiceWarehouseReceipt({
    deleteOldReceipts = false,
    receipt,
  } = {}) {
    if (!receipt || typeof receipt !== "object")
      throw new ValidationError("receipt object is required");
    const normalizedReceipt =
      this.normalizeInvoiceWarehouseReceiptInput(receipt);
    return this.call("/invoice/SaveWarehouseReceipt", {
      deleteOldReceipts: Boolean(deleteOldReceipts),
      receipt: normalizedReceipt,
    });
  }

  normalizeInvoiceWarehouseReceiptInput(receipt) {
    const warehouseCode = toNumberOrNull(
      receipt.warehouseCode || receipt.WarehouseCode,
    );
    const invoiceType = toNumberOrNull(
      receipt.invoiceType || receipt.InvoiceType,
    );
    const invoiceNumberRaw = readField(
      receipt,
      ["invoiceNumber", "InvoiceNumber"],
      null,
    );

    if (warehouseCode === null)
      throw new ValidationError("receipt.warehouseCode is required");
    if (invoiceType === null)
      throw new ValidationError("receipt.invoiceType is required");
    if (!hasValue(invoiceNumberRaw))
      throw new ValidationError("receipt.invoiceNumber is required");

    const items = ensureArray(receipt.items || receipt.Items).map(
      (item, index) => {
        const itemCode = readField(
          item,
          ["itemCode", "ItemCode", "code", "Code"],
          null,
        );
        const quantity = Number(readField(item, ["quantity", "Quantity"], NaN));
        const reference = readField(
          item,
          ["reference", "Reference"],
          undefined,
        );
        const notes = readField(
          item,
          ["notes", "Notes", "note", "Note"],
          undefined,
        );

        if (!hasValue(itemCode) && itemCode !== 0)
          throw new ValidationError(
            `receipt.items[${index}].itemCode is required`,
          );
        if (!Number.isFinite(quantity) || quantity <= 0)
          throw new ValidationError(
            `receipt.items[${index}].quantity must be a number greater than zero`,
          );

        const normalizedItem = { itemCode: String(itemCode), quantity };
        if (reference !== undefined)
          normalizedItem.reference = toSafeString(reference);
        if (notes !== undefined) normalizedItem.notes = toSafeString(notes);
        return normalizedItem;
      },
    );

    if (items.length === 0)
      throw new ValidationError("receipt.items must contain at least one item");

    const normalizedReceipt = {
      warehouseCode,
      invoiceNumber: String(invoiceNumberRaw),
      invoiceType,
      items,
    };

    const date = readField(receipt, ["date", "Date"], undefined);
    const notes = readField(
      receipt,
      ["notes", "Notes", "note", "Note"],
      undefined,
    );
    const freight = readField(receipt, ["freight", "Freight"], undefined);
    const delivery = readField(receipt, ["delivery", "Delivery"], undefined);
    const project = readField(receipt, ["project", "Project"], undefined);

    if (date !== undefined) normalizedReceipt.date = toSafeString(date);
    if (notes !== undefined) normalizedReceipt.notes = toSafeString(notes);
    if (freight !== undefined && freight !== null && freight !== "")
      normalizedReceipt.freight = Number(freight) || 0;
    if (delivery !== undefined)
      normalizedReceipt.delivery = toSafeString(delivery);
    if (project !== undefined)
      normalizedReceipt.project = toSafeString(project);

    return normalizedReceipt;
  }

  // --------------------------------------------------
  // NORMALIZERS
  // --------------------------------------------------

  normalizeItem(item) {
    if (!item || typeof item !== "object") return null;

    const code = normalizeCode(readField(item, ["Code", "code"], ""));
    const barcode = normalizeCode(readField(item, ["Barcode", "barcode"], ""));
    const name = toSafeString(readField(item, ["Name", "name"], ""));
    const nodeFamily = toSafeString(
      readField(item, ["NodeFamily", "nodeFamily"], ""),
    );

    return {
      raw: item,
      code,
      barcode,
      name,
      active: readField(item, ["Active", "active"], true) !== false,
      itemType: readField(item, ["ItemType", "itemType"], null),
      nodeFamily: nodeFamily || null,
      excluded: EXCLUDED_NODE_FAMILIES.has(nodeFamily),
      stock: Number(readField(item, ["Stock", "stock"], 0)) || 0,
    };
  }

  normalizeQuantity(row) {
    const code = normalizeCode(
      readField(row, ["Code", "code", "ItemCode", "itemCode"], ""),
    );
    const barcode = normalizeCode(readField(row, ["Barcode", "barcode"], ""));
    const quantityRaw = readField(
      row,
      [
        "Quantity",
        "quantity",
        "Stock",
        "stock",
        "Remain",
        "remain",
        "Inventory",
        "inventory",
        "TotalQuantity",
        "totalQuantity",
      ],
      0,
    );

    const quantity = Number(quantityRaw);
    return {
      raw: row,
      code,
      barcode,
      quantity: Number.isFinite(quantity) ? quantity : 0,
    };
  }

  normalizeWarehouseReceipt(receipt) {
    if (!receipt || typeof receipt !== "object") return null;

    return {
      raw: receipt,
      id: readField(receipt, ["Id", "id"], null),
      number: readField(receipt, ["Number", "number"], null),
      invoiceNumber: readField(
        receipt,
        ["InvoiceNumber", "invoiceNumber"],
        null,
      ),
      invoiceType: readField(receipt, ["InvoiceType", "invoiceType"], null),
      warehouseCode: readField(
        receipt,
        ["WarehouseCode", "warehouseCode"],
        null,
      ),
      destinationWarehouseCode: readField(
        receipt,
        ["DestinationWarehouseCode", "destinationWarehouseCode"],
        null,
      ),
      date: readField(receipt, ["Date", "date"], null),
      notes: readField(receipt, ["Notes", "notes", "Note", "note"], ""),
      delivery: readField(receipt, ["Delivery", "delivery"], ""),
      freight: readField(receipt, ["Freight", "freight"], 0),
      project: readField(receipt, ["Project", "project"], ""),
      receiving: readField(receipt, ["Receiving", "receiving"], null),
      items: ensureArray(readField(receipt, ["Items", "items"], [])).map(
        (item) => ({
          raw: item,
          itemCode: readField(item, ["ItemCode", "itemCode"], null),
          quantity: Number(readField(item, ["Quantity", "quantity"], 0)) || 0,
          reference: readField(item, ["Reference", "reference"], ""),
          notes: readField(item, ["Notes", "notes", "Note", "note"], ""),
        }),
      ),
    };
  }

  normalizeInvoice(invoice) {
    if (!invoice || typeof invoice !== "object") return null;

    return {
      raw: invoice,
      id: readField(invoice, ["Id", "id"], null),
      number: readField(invoice, ["Number", "number"], null),
      reference: readField(invoice, ["Reference", "reference"], ""),
      date: readField(invoice, ["Date", "date"], null),
      dueDate: readField(invoice, ["DueDate", "dueDate"], null),
      contactCode: readField(invoice, ["ContactCode", "contactCode"], null),
      contactTitle: readField(invoice, ["ContactTitle", "contactTitle"], ""),
      note: readField(invoice, ["Note", "note"], ""),
      sent: readField(invoice, ["Sent", "sent"], false),
      invoiceType: readField(invoice, ["InvoiceType", "invoiceType"], null),
      status: readField(invoice, ["Status", "status"], null),
      warehouseReceiptStatus: readField(
        invoice,
        ["WarehouseReceiptStatus", "warehouseReceiptStatus"],
        null,
      ),
      project: readField(invoice, ["Project", "project"], ""),
      freight: Number(readField(invoice, ["Freight", "freight"], 0)) || 0,
      items: ensureArray(
        readField(invoice, ["InvoiceItems", "invoiceItems"], []),
      ).map((item) => ({
        raw: item,
        id: readField(item, ["Id", "id"], null),
        rowNumber: readField(item, ["RowNumber", "rowNumber"], null),
        description: readField(item, ["Description", "description"], ""),
        itemCode: readField(item, ["ItemCode", "itemCode"], null),
        quantity: Number(readField(item, ["Quantity", "quantity"], 0)) || 0,
        unit: readField(item, ["Unit", "unit"], ""),
        unitPrice: Number(readField(item, ["UnitPrice", "unitPrice"], 0)) || 0,
        discount: Number(readField(item, ["Discount", "discount"], 0)) || 0,
        tax: Number(readField(item, ["Tax", "tax"], 0)) || 0,
      })),
    };
  }
}
