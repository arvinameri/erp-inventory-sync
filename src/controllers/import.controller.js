// D:\hesabfa\inventory-sync\src\controllers\import.controller.js
import { ImportService } from "../services/import.service.js";

export async function runImport(req, res) {
  const dryRun = req.body?.dryRun === true;
  const pageSize = req.body?.pageSize || 100;

  const importService = new ImportService();
  const result = await importService.importFromHesabfa({ dryRun, pageSize });

  res.json(result);
}
