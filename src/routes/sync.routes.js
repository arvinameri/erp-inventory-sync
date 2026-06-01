// Path: src/routes/sync.routes.js
import { Router } from "express";
import {
  exportUnmatchedInventory,
  getSyncStatus,
  runInventorySync,
  runCleanupFilteredProducts,
} from "../controllers/sync.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// GET /sync/status
router.get("/status", asyncHandler(getSyncStatus));

// POST /sync/inventory
router.post("/inventory", asyncHandler(runInventorySync));

// GET /sync/inventory/unmatched
router.get("/inventory/unmatched", asyncHandler(exportUnmatchedInventory));

// POST /sync/cleanup?dryRun=true|false
router.post("/cleanup", asyncHandler(runCleanupFilteredProducts));

export default router;
