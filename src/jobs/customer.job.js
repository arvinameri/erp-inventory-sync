// Path: src/jobs/customer.job.js
// Purpose: Scheduled job — sync portal users to hesabfa contacts

import cron from "node-cron";
import { env } from "../config/env.js";
import { PortalService } from "../services/portal.service.js";
import { HesabfaService } from "../services/hesabfa.service.js";
import { CustomerService } from "../services/customer.service.js";
import { logger } from "../config/logger.js";

// ─── Job state ────────────────────────────────────────────────────
let _task = null;
let _lastRun = null;
let _lastResult = null;
let _isRunning = false;

function buildCustomerService() {
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

  return new CustomerService({ portalService, hesabfaService });
}

// ─── Core runner ─────────────────────────────────────────────────
export async function runCustomerSync({ dryRun } = {}) {
  if (_isRunning) {
    logger.warn("[customer-job] Already running — skipped");
    return { skipped: true, reason: "already_running" };
  }

  _isRunning = true;
  _lastRun = new Date().toISOString();

  const isDryRun = dryRun ?? env.sync.dryRun;

  logger.info(`[customer-job] Starting customer sync (dryRun=${isDryRun})`);

  try {
    const customerService = buildCustomerService();
    const result = await customerService.syncAllUsers({
      pageSize: env.sync.pageSize,
      dryRun: isDryRun,
    });

    _lastResult = {
      success: true,
      ...result,
      completedAt: new Date().toISOString(),
    };
    logger.info("[customer-job] Done", _lastResult);
    return _lastResult;
  } catch (err) {
    _lastResult = {
      success: false,
      error: err?.message ?? String(err),
      completedAt: new Date().toISOString(),
    };
    logger.error("[customer-job] Failed", {
      error: err?.message,
      stack: err?.stack,
    });
    return _lastResult;
  } finally {
    _isRunning = false;
  }
}

// ─── Status getter ────────────────────────────────────────────────
export function getCustomerJobStatus() {
  return {
    isRunning: _isRunning,
    lastRun: _lastRun,
    lastResult: _lastResult,
  };
}

// ─── Start scheduled job ──────────────────────────────────────────
// Default cron: every 10 minutes — configurable via CUSTOMER_SYNC_CRON env var
export function startCustomerJob() {
  const cronExpr = process.env.CUSTOMER_SYNC_CRON || "*/10 * * * *";

  if (!env.sync.jobEnabled) {
    logger.info(
      "[customer-job] SYNC_JOB_ENABLED=false — scheduled job not started. Use POST /customer/sync for manual trigger.",
    );
    return;
  }

  if (_task) {
    logger.warn("[customer-job] Already started");
    return;
  }

  logger.info(`[customer-job] Scheduled with cron: ${cronExpr}`);

  _task = cron.schedule(cronExpr, async () => {
    await runCustomerSync();
  });
}

export function stopCustomerJob() {
  if (_task) {
    _task.stop();
    _task = null;
    logger.info("[customer-job] Stopped");
  }
}
