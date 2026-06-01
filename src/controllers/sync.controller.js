// D:\hesabfa\inventory-sync\src\controllers\sync.controller.js
import { env } from "../config/env.js";
import { SyncService } from "../services/sync.service.js";
import { optionalBoolean } from "../utils/validators.js";
import fs from "fs";
import path from "path";
export const getSyncStatus = async (req, res) => {
  res.json({
    success: true,
    status: "ready",
    service: "inventory-sync",
    syncJobEnabled: env.sync.jobEnabled,
    syncCron: env.sync.cron,
    dryRun: env.sync.dryRun,
    sourceOfTruth: env.sync.sourceOfTruth,
    timestamp: new Date().toISOString(),
  });
};

export const runInventorySync = async (req, res) => {
  const dryRun =
    req.query.dryRun !== undefined
      ? optionalBoolean(req.query.dryRun, env.sync.dryRun)
      : req.body?.dryRun !== undefined
        ? optionalBoolean(req.body.dryRun, env.sync.dryRun)
        : env.sync.dryRun;

  const syncService = new SyncService({ config: env });
  const result = await syncService.syncInventory({ dryRun });
  res.status(result.success ? 200 : 207).json(result);
};

export const exportUnmatchedInventory = async (req, res) => {
  const format =
    String(req.query.format || "json").toLowerCase() === "csv" ? "csv" : "json";
  const syncService = new SyncService({ config: env });
  const report = await syncService.getUnmatchedInventoryReport({ format });

  res.setHeader("Content-Type", report.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${report.fileName}"`,
  );
  res.status(200).send(report.body);
};

export const runCleanupFilteredProducts = async (req, res) => {
  const dryRun =
    req.query.dryRun !== undefined
      ? optionalBoolean(req.query.dryRun, true)
      : req.body?.dryRun !== undefined
        ? optionalBoolean(req.body.dryRun, true)
        : true;

  const syncService = new SyncService({ config: env });
  const result = await syncService.cleanupFilteredProducts({ dryRun });

  // ذخیره نتیجه در فایل
  try {
    const outputPath = "D:\\hesabfa\\deletproducts.json";
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  } catch (e) {
    result.fileSaveError = e.message;
  }

  res.status(result.success ? 200 : 207).json(result);
};
