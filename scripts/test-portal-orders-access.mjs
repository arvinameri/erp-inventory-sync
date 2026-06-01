import axios from "axios";

const baseURL = process.env.PORTAL_BASE_URL || "https://emobiran.ir";
const token = process.env.PORTAL_TOKEN || "a28f29c17f78404593f4676973b84b2c";

const orderId = process.env.TEST_ORDER_ID || "";

const client = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
});

async function probe(name, fn) {
  try {
    const res = await fn();
    console.log(
      JSON.stringify({
        ok: true,
        name,
        status: res.status,
        sample:
          typeof res.data === "object"
            ? JSON.stringify(res.data).slice(0, 500)
            : String(res.data).slice(0, 500),
      }),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        ok: false,
        name,
        status: err?.response?.status ?? null,
        data: err?.response?.data ?? null,
        message: err?.message ?? String(err),
      }),
    );
  }
}

await probe("orders-list-completed", () =>
  client.get("/site/api/v1/manage/store/orders?page=1&size=2&status=completed"),
);

await probe("orders-list-no-status", () =>
  client.get("/site/api/v1/manage/store/orders?page=1&size=2"),
);

if (orderId) {
  await probe("order-detail", () =>
    client.get(
      `/site/api/v1/manage/store/orders/${encodeURIComponent(orderId)}`,
    ),
  );
}
