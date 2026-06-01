<div align="center">
  <h1>ERP-ECommerce Sync Middleware 🔄</h1>

  <p><b>Automated Inventory, Invoicing, and Customer Sync Engine</b></p>

  <p>
    A robust, asynchronous Node.js middleware designed to bidirectionally synchronize a high-traffic e-commerce portal with <b>Hesabfa</b> (cloud accounting/ERP software).
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white" alt="Express" />
    <img src="https://img.shields.io/badge/REST_API-005571?style=flat&logo=routing&logoColor=white" alt="REST API" />
    <img src="https://img.shields.io/badge/Axios-5A29E4?style=flat&logo=axios&logoColor=white" alt="Axios" />
    <img src="https://img.shields.io/badge/Cron-0C0C0C?style=flat" alt="Node Cron" />
  </p>

  <p>
    <a href="#-getting-started">Getting Started</a>
    ·
    <a href="https://github.com/arvinameri/erp-inventory-sync/issues">Report Bug</a>
    ·
    <a href="https://www.linkedin.com/in/arvinameri">Connect on LinkedIn</a>
  </p>
</div>

---

## 🧭 Overview

This middleware acts as an intelligent bridge between an online store and corporate accounting software. It eliminates manual data entry, prevents overselling of out-of-stock items, and ensures fiscal compliance by automatically generating accounting invoices the moment a customer makes a purchase online.

The system is highly resilient, featuring exponential backoff for API rate limits (HTTP 429), Idempotency keys to prevent duplicate invoices, and automated currency conversions (Tomans to Rials).

|                         |                                                                               |
| ----------------------- | ----------------------------------------------------------------------------- |
| 📦 **Inventory Sync**   | Bi-directional SKU matching to update stock levels and pricing every 15 mins. |
| 🧾 **Auto-Invoicing**   | Automatically creates Approved sales invoices & registers cashbox receipts.   |
| 👥 **Customer Mapping** | Creates or links portal users to accounting contacts instantly.               |
| 🛡️ **Rate-Limit Safe**  | Built-in queue management, staggered cron jobs, and jitter to avoid API bans. |
| 🧪 **E2E Test Suite**   | Extensive PowerShell and Node.js test scripts ensuring zero data loss.        |

---

## 🧱 Architecture & Tech Stack

| Layer                   | Technologies & Patterns                                      |
| ----------------------- | ------------------------------------------------------------ |
| **Runtime & Framework** | Node.js (ES Modules), Express.js                             |
| **HTTP Clients**        | Axios with custom interceptors for retries & logging         |
| **Job Scheduling**      | `node-cron` with overlapping execution prevention            |
| **Error Handling**      | Centralized asynchronous error handler, HTTP status parsing  |
| **Scripting / Testing** | Comprehensive automated scripts `.mjs` & PowerShell (`.ps1`) |

---

## ✨ Key Technical Achievements

### 1. Robust Invoice & Receipt Generation

The system dynamically maps Portal Orders to Hesabfa accounting standards:

- **Currency Conversion:** Automatically converts frontend pricing to accounting base currency.
- **Fiscal Year Alignment:** Detects and shifts mismatched order dates to fit within the valid corporate fiscal year constraints to prevent `DateTime-Outside-Range` errors.
- **Idempotency:** Checks existing references to completely prevent duplicate invoice generation.

### 2. Algorithmic Rate-Limiting Prevention

Addressed sudden API bursts (causing HTTP 429 errors) by optimizing the data-fetching architecture:

- Implemented a unified `getAllVariants()` cache instead of generating $N+1$ requests per product.
- Applied staggered cron schedules to prevent job collision.

### 3. SKU-Based Smart Mapping

Inventory sync relies strictly on exact `itemCode` matches, actively ignoring non-inventory families (e.g., Services, Software) based on pre-defined exclusion lists to keep the portal catalog clean.

---

## 📁 Repository Structure

```text
inventory-sync/
├── src/
│   ├── app.js & server.js    # Express application setup and entry points
│   ├── config/               # Environment variable parsers & Winston loggers
│   ├── controllers/          # Express route controllers
│   ├── jobs/                 # Cron jobs (Sync, Invoice, Customer)
│   ├── routes/               # API endpoint definitions
│   ├── services/             # Core business logic (HesabfaService, PortalService)
│   └── utils/                # Async handlers, custom error classes, validators
│
├── scripts/                  # Ad-hoc audit, debugging, and data export scripts
├── tests/                    # End-to-End PowerShell and Node.js testing suite
└── output/ & logs/           # Ignored log directories for sync reports
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 18
- Access to Hesabfa API (API Key, Username, Password)
- Access to E-Commerce Portal API (JWT/Bearer Token)

### 1 — Clone the Repository

```bash
git clone https://github.com/arvinameri/erp-inventory-sync.git
cd erp-inventory-sync
```

### 2 — Environment Setup

Rename the template and provide the required credentials:

```bash
cp .env.example .env
```

### 3 — Installation

```bash
npm install
```

### 4 — Running the Server

**Development Mode:**

```bash
npm run dev
```

**Production Mode:**

```bash
npm start
```

### 5 — Automated Testing

Run the comprehensive test suite to ensure connectivity and logic validity:

```powershell
# Run the end-to-end invoice creation test (PowerShell)
.\tests\test-invoice-full.ps1 -SkipFullSync
```

---

## 🛡️ Security

- **Credential Isolation:** All API keys and portal tokens are managed strictly via `.env`.
- **Private Deployment:** Designed to be run securely on localized Windows/Linux environments within the corporate network.

---

<div align="center">
  <h3>Built by Arvin Ameri</h3>
  <p>📍 Amsterdam, Netherlands &nbsp;|&nbsp; Backend & Integration Engineer</p>
  <p>
    <a href="https://www.linkedin.com/in/arvinameri">
      <img src="https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" />
    </a>
    <a href="https://github.com/arvinameri">
      <img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" />
    </a>
  </p>
</div>
