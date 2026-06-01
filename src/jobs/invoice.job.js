// Path: src/jobs/invoice.job.js
// Purpose: Scheduled job — process paid portal orders → hesabfa invoice + receipt

import cron from "node-cron";
import { env } from "../config/env.js";
import { PortalService } from "../services/portal.service.js";
import { HesabfaService } from "../services/hesabfa.service.js";
import { CustomerService } from "../services/customer.service.js";
import { InvoiceService } from "../services/invoice.service.js";
import { logger } from "../config/logger.js";

// ─── Job state ────────────────────────────────────────────────────
let _task = null;
let _lastRun = null;
let _lastResult = null;
let _isRunning = false;

// FIX: InvoiceService به عنوان singleton نگه داشته می‌شود
// تا _processedOrders module-level Map بین cycle‌ها باقی بماند
let _invoiceServiceInstance = null;

function getInvoiceService() {
  if (_invoiceServiceInstance) return _invoiceServiceInstance;

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

  _invoiceServiceInstance = new InvoiceService({
    portalService,
    hesabfaService,
    customerService,
    config: env,
  });

  logger.info("[invoice-job] InvoiceService singleton created");
  return _invoiceServiceInstance;
}

// ─── Core runner ─────────────────────────────────────────────────
export async function runInvoiceSync({ dryRun } = {}) {
  if (_isRunning) {
    logger.warn("[invoice-job] Already running — skipped");
    return { skipped: true, reason: "already_running" };
  }

  _isRunning = true;
  _lastRun = new Date().toISOString();

  const isDryRun = dryRun ?? env.sync.dryRun;

  logger.info(`[invoice-job] Starting invoice sync (dryRun=${isDryRun})`);

  try {
    // FIX: از singleton استفاده می‌کنیم — هر بار new نمی‌سازیم
    const invoiceService = getInvoiceService();

    const result = await invoiceService.syncPaidOrders({
      pageSize: env.sync.pageSize,
      dryRun: isDryRun,
    });

    _lastResult = {
      success: true,
      ...result,
      completedAt: new Date().toISOString(),
    };
    logger.info("[invoice-job] Done", _lastResult);
    return _lastResult;
  } catch (err) {
    _lastResult = {
      success: false,
      error: err?.message ?? String(err),
      completedAt: new Date().toISOString(),
    };
    logger.error("[invoice-job] Failed", {
      error: err?.message,
      stack: err?.stack,
    });
    return _lastResult;
  } finally {
    _isRunning = false;
  }
}

// ─── Status getter ────────────────────────────────────────────────
export function getInvoiceJobStatus() {
  return {
    isRunning: _isRunning,
    lastRun: _lastRun,
    lastResult: _lastResult,
  };
}

// ─── Start scheduled job ──────────────────────────────────────────
export function startInvoiceJob() {
  const cronExpr = process.env.INVOICE_SYNC_CRON || "*/5 * * * *";

  if (!env.sync.jobEnabled) {
    logger.info(
      "[invoice-job] SYNC_JOB_ENABLED=false — scheduled job not started.",
    );
    return;
  }

  if (_task) {
    logger.warn("[invoice-job] Already started");
    return;
  }

  // FIX: Singleton از قبل ساخته می‌شود تا در اولین اجرا آماده باشد
  getInvoiceService();

  logger.info(`[invoice-job] Scheduled with cron: ${cronExpr}`);

  _task = cron.schedule(cronExpr, async () => {
    await runInvoiceSync();
  });
}

export function stopInvoiceJob() {
  if (_task) {
    _task.stop();
    _task = null;
    logger.info("[invoice-job] Stopped");
  }
}

// FIX: برای تست و reset دستی
export function resetInvoiceServiceInstance() {
  _invoiceServiceInstance = null;
  logger.warn("[invoice-job] InvoiceService instance reset");
}
