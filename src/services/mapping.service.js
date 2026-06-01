// D:\hesabfa\inventory-sync\src\services\mapping.service.js
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../utils/errors.js";
import { uniqueStrings } from "../utils/validators.js";

export class MappingService {
  constructor(mappingFilePath = path.resolve("src/data/product-mapping.json")) {
    this.mappingFilePath = mappingFilePath;
  }

  async loadMappings() {
    let fileContent;
    try {
      fileContent = await fs.readFile(this.mappingFilePath, "utf8");
    } catch (error) {
      throw new ValidationError("Product mapping file not found", {
        path: this.mappingFilePath,
        message: error.message,
      });
    }

    let mappings;
    try {
      mappings = JSON.parse(fileContent);
    } catch (error) {
      throw new ValidationError("Product mapping file is not valid JSON", {
        path: this.mappingFilePath,
        message: error.message,
      });
    }

    if (!Array.isArray(mappings)) {
      throw new ValidationError("Product mapping must be an array");
    }

    return mappings.map((item, index) => this.validateMappingItem(item, index));
  }

  validateMappingItem(item, index) {
    if (!item || typeof item !== "object") {
      throw new ValidationError(`Invalid mapping item at index ${index}`);
    }

    const portalSku = String(item.portalSku || "").trim();
    const hesabfaBarcode = String(item.hesabfaBarcode || item.hesabfaCode || "").trim();
    const active = item.active !== false && item.enabled !== false;

    if (!portalSku) {
      throw new ValidationError(`portalSku is required at mapping index ${index}`);
    }

    if (!hesabfaBarcode) {
      throw new ValidationError(
        `hesabfaBarcode is required at mapping index ${index}`,
      );
    }

    return {
      active,
      portalSku,
      hesabfaBarcode,
      hesabfaCode: String(item.hesabfaCode || "").trim(),
      title: item.title ? String(item.title).trim() : "",
      notes: item.notes ? String(item.notes).trim() : "",
    };
  }

  async getEnabledMappings() {
    const mappings = await this.loadMappings();
    return mappings.filter((item) => item.active === true);
  }

  async getPortalSkus() {
    const mappings = await this.getEnabledMappings();
    return uniqueStrings(mappings.map((item) => item.portalSku));
  }

  async getHesabfaBarcodes() {
    const mappings = await this.getEnabledMappings();
    return uniqueStrings(mappings.map((item) => item.hesabfaBarcode));
  }
}
