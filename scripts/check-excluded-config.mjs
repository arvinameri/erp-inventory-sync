// scripts/check-excluded-config.mjs
// نشان می‌دهد الان چه چیزی فیلتر می‌شود

import { env } from "../src/config/env.js";

console.log("📋 تنظیمات فعلی فیلتر:\n");
console.log("SYNC_EXCLUDED_NODE_FAMILIES:");

if (env.sync.excludedNodeFamilies.size === 0) {
  console.log("  ⚠️  خالی است! هیچ دسته‌ای فیلتر نمی‌شود");
  console.log("\n👉 در .env این را اضافه کن:");
  console.log(`
SYNC_EXCLUDED_NODE_FAMILIES=قاب,بک کاور,گلس,باتری,قطعات,سخت افزار,نرم افزار,سرمایه گذاری,خدمات,گرین,کیف
  `);
} else {
  env.sync.excludedNodeFamilies.forEach((f) => {
    console.log(`  ✅ "${f}"`);
  });
}

console.log("\nSYNC_DRY_RUN:", env.sync.dryRun);
console.log("SYNC_JOB_ENABLED:", env.sync.jobEnabled);
console.log("SYNC_SOURCE_OF_TRUTH:", env.sync.sourceOfTruth);
