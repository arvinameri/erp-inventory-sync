// D:\hesabfa\inventory-sync\src\routes\import.routes.js
import { Router } from "express";
import { runImport } from "../controllers/import.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// GET /import/preview - نمایش محصولات قابل import
router.get(
  "/preview",
  asyncHandler(async (req, res) => {
    const { ImportService } = await import("../services/import.service.js");
    const importService = new ImportService();

    const result = await importService.importFromHesabfa(true); // dryRun = true
    res.json(result);
  }),
);

// POST /import/products - اجرای واقعی import
// body: { "dryRun": true/false }
router.post("/products", asyncHandler(runImport));

export default router;
