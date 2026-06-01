// Path: src/server.js

import "dotenv/config";

import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { startSyncJob, stopSyncJob } from "./jobs/sync.job.js";
import { startCustomerJob, stopCustomerJob } from "./jobs/customer.job.js";
import { startInvoiceJob, stopInvoiceJob } from "./jobs/invoice.job.js";

const server = app.listen(env.port, () => {
  logger.info("Server started", {
    service: "inventory-sync",
    port: env.port,
    environment: env.nodeEnv,
  });

  startSyncJob();
  startCustomerJob();
  startInvoiceJob();
});

server.on("error", (error) => {
  logger.error("Server error", {
    message: error.message,
    stack: error.stack,
  });

  process.exit(1);
});

const shutdown = (signal) => {
  logger.warn("Shutdown signal received", { signal });

  try {
    stopSyncJob();
  } catch (error) {
    logger.error("Error while stopping sync job", {
      message: error.message,
      stack: error.stack,
    });
  }

  try {
    stopCustomerJob();
  } catch (error) {
    logger.error("Error while stopping customer job", {
      message: error.message,
      stack: error.stack,
    });
  }

  try {
    stopInvoiceJob();
  } catch (error) {
    logger.error("Error while stopping invoice job", {
      message: error.message,
      stack: error.stack,
    });
  }

  const forceExitTimer = setTimeout(() => {
    logger.error("Forced shutdown because graceful shutdown timed out");
    process.exit(1);
  }, 10000);

  forceExitTimer.unref();

  server.close((error) => {
    if (error) {
      logger.error("Error during server shutdown", {
        message: error.message,
        stack: error.stack,
      });

      process.exit(1);
    }

    logger.info("Server stopped gracefully");
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    message: error.message,
    stack: error.stack,
  });

  process.exit(1);
});
