// Path: src/app.js

import express from "express";
import syncRoutes from "./routes/sync.routes.js";
import debugRoutes from "./routes/debug.routes.js";
import debugPortalRoutes from "./routes/debugPortal.routes.js";
import { NotFoundError } from "./utils/errors.js";
import importRoutes from "./routes/import.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";

const app = express();

app.disable("x-powered-by");

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "inventory-sync",
    message: "Server is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "inventory-sync",
    environment: process.env.NODE_ENV || "development",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/debug/ping", (req, res) => {
  res.json({ success: true, message: "debug root works" });
});

// ─── Routes ───────────────────────────────────────────────────────
app.use("/sync", syncRoutes);
app.use("/debug", debugRoutes);
app.use("/debug/portal", debugPortalRoutes);
app.use("/import", importRoutes); // ✅ جابجا شد — قبل از 404
app.use("/customer", customerRoutes);
app.use("/invoice", invoiceRoutes);

// ─── 404 ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
});

// ─── Error Handler ────────────────────────────────────────────────
app.use((error, req, res, next) => {
  const statusCode = error.statusCode || error.status || 500;

  res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
    ...(error.code && { code: error.code }),
    ...(process.env.NODE_ENV !== "production" && {
      error: {
        name: error.name,
        details: error.details || null,
        stack: error.stack,
      },
    }),
  });
});

export default app;
