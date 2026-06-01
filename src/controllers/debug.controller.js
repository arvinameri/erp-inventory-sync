// src/controllers/debug.controller.js
const hesabfaService = require("../services/hesabfa.service");

exports.getHesabfaItems = async (req, res) => {
  try {
    const take = parseInt(req.query.take) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const result = await hesabfaService.getItems(take, skip);

    // فقط آمار برگردان
    res.json({
      success: true,
      stats: {
        returned: result.Items?.length || 0,
        total: result.Total || 0,
        take,
        skip,
        hasMore: skip + take < (result.Total || 0),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
