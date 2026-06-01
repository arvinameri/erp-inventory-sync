# Inventory Sync

Middleware service for syncing product inventory from Hesabfa to Portal.

## هدف پروژه

این پروژه یک سرویس واسط بین حسابفا و سایت پرتال است.

هدف اصلی:

- دریافت موجودی کالاها از حسابفا
- تطبیق کالاهای حسابفا با محصولات/تنوع‌های سایت پرتال
- به‌روزرسانی موجودی سایت بر اساس حسابفا
- سینک فقط کالاهای قابل فروش در سایت
- جلوگیری از سینک کالاهای غیرمرتبط مثل قطعات تعمیرات یا کالاهای داخلی
- امکان اجرای دستی و زمان‌بندی‌شده سینک

## ساختار کلی

````text
inventory-sync
├── src
│   ├── clients
│   ├── config
│   ├── controllers
│   ├── data
│   ├── jobs
│   ├── routes
│   ├── services
│   └── utils
├── logs
├── package.json
├── .env
├── .env.example
└── README.md

## نصب وابستگی‌ها

bash
npm install

## اجرای پروژه در حالت توسعه

bash
npm run dev

## اجرای پروژه در حالت production

bash
npm start

## تست سلامت سرویس

بعد از اجرای پروژه:

text
GET http://localhost:3000/health

## اجرای دستی سینک

text
POST http://localhost:3000/sync/run

## فایل تنظیمات

اطلاعات حساس مثل API Key و Token باید داخل فایل `.env` قرار بگیرند.

نمونه فایل تنظیمات در `.env.example` قرار دارد.

## مپینگ محصولات

فایل مپینگ محصولات:

text
src/data/product-mapping.json

در این فایل مشخص می‌شود که هر SKU سایت پرتال به کدام کد محصول در حسابفا وصل است.

نمونه:

json
[
  {
"portalSku": "IPHONE-13-BLACK-128",
"hesabfaCode": "1001",
"enabled": true
  }
]

فقط محصولاتی که `enabled` آن‌ها برابر `true` باشد سینک می‌شوند.

## نکات امنیتی

- فایل `.env` نباید commit شود.
- API Key و Token نباید داخل سورس‌کد نوشته شوند.
- فقط از مسیرهای مشخص‌شده برای اجرای عملیات استفاده شود.


---

### `D:\hesabfa\inventory-sync\src\app.js`

```js
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import healthRoutes from './routes/health.routes.js';
import syncRoutes from './routes/sync.routes.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.use('/health', healthRoutes);
app.use('/sync', syncRoutes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Inventory Sync API is running',
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

export default app;
````
