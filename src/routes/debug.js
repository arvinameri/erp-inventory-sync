// src/routes/debug.js
import express from "express";
import { hesabfaService } from "../services/hesabfa.js";

const router = express.Router();

router.post("/hesabfa/items", async (req, res, next) => {
  try {
    const result = await hesabfaService.getItems(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
