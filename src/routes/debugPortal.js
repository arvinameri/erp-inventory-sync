const express = require("express");
const router = express.Router();
const axios = require("axios");

const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL;
const PORTAL_TOKEN = process.env.PORTAL_TOKEN;

router.get("/product/:sku", async (req, res) => {
  try {
    const { sku } = req.params;

    if (!PORTAL_BASE_URL || !PORTAL_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "PORTAL_BASE_URL or PORTAL_TOKEN is missing",
      });
    }

    const url = `${PORTAL_BASE_URL.replace(/\/$/, "")}/products`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${PORTAL_TOKEN}`,
        Accept: "application/json",
      },
      params: { sku },
      timeout: 30000,
    });

    const data = response.data;
    const items = Array.isArray(data) ? data : data?.data || data?.items || [];

    const product =
      items.find((x) => String(x.sku) === String(sku)) ||
      items[0] ||
      null;

    return res.json({
      success: true,
      sku,
      product,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

module.exports = router;
