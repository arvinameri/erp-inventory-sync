// D:\hesabfa\inventory-sync\src\jobs\sync.job.js
import cron from "node-cron";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { SyncService } from "../services/sync.service.js";
import { ImportService } from "../services/import.service.js"; // وارد کردن سرویس Import

let isRunning = false;
let task = null;

export const startSyncJob = () => {
  if (!env.sync.jobEnabled) {
    logger.info("Inventory sync cron job is disabled");
    return null;
  }

  if (!cron.validate(env.sync.cron)) {
    logger.error("Invalid SYNC_CRON expression", { syncCron: env.sync.cron });
    return null;
  }

  task = cron.schedule(env.sync.cron, async () => {
    if (isRunning) {
      logger.warn(
        "Previous inventory sync job is still running; skipping this run",
      );
      return;
    }

    isRunning = true;

    try {
      // مرحله اول: ساختن اتوماتیک محصولات جدیدی که در حسابفا تعریف شده‌اند در سایت
      logger.info(
        "[Auto-Import] Starting to fetch new products from Hesabfa...",
      );
      const importService = new ImportService({ config: env, logger });
      const importSummary = await importService.importFromHesabfa({
        dryRun: false,
      });
      logger.info(
        `[Auto-Import] Completed. New products created: ${importSummary.importedCount}`,
      );

      // مرحله دوم: همگام‌سازی قیمت و موجودی (برای محصولات قدیمی و جدید)
      logger.info(
        "[Inventory-Sync] Starting stock and price synchronization...",
      );
      const syncService = new SyncService({ config: env, logger });
      const syncSummary = await syncService.syncInventory();
      logger.info(
        `[Inventory-Sync] Completed. Updates: ${syncSummary.updatedCount}`,
      );
    } catch (error) {
      logger.error("Inventory sync job failed", {
        message: error.message,
        details: error.details || null,
        stack: env.nodeEnv === "development" ? error.stack : undefined,
      });
    } finally {
      isRunning = false;
    }
  });

  logger.info("Inventory sync cron job started", {
    cron: env.sync.cron,
    dryRun: env.sync.dryRun,
  });

  return task;
};

export const stopSyncJob = () => {
  if (task) {
    task.stop();
    task = null;
    logger.info("Inventory sync cron job stopped");
  }
};
