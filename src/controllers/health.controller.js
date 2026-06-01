import { env } from "../config/env.js";

export const getHealth = async (req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "inventory-sync",
    environment: env.nodeEnv,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
};
