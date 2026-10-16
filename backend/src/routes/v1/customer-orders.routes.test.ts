import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { SupabaseFactory } from "../../repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001, customerOrderHmacSecret: "x".repeat(40) };
const token = () => `header.${Buffer.from(JSON.stringify({ iss: `${env.supabaseUrl}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.signature`;

function fixture(role = "owner") {
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_public_customer_catalog") return { data: [{ price_type: "retail", supplier: "secret" }], error: null };
    if (name === "create_customer_order_request") return { data: { request_id: "id-1", reference: "DH-1234ABCD", subtotal: 15000, status: "pending_confirmation", item_count: 1 }, error: null };
    return { data: null, error: null };
  });
  const order = vi.fn(async () => ({ data: [], error: null }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  const factory = vi.fn(() => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => table === "profiles" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role }, error: null }) }) }) } : from(table), rpc,
  })) as unknown as SupabaseFactory;
  return { app: buildApp({ env, supabaseFactory: factory }), rpc, factory, from };
}

describe("customer order routes", () => {
  it("serves safe public catalog without authentication", async () => {
    const { app, factory, rpc } = fixture();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/public/catalog" });
      expect(response.statusCode).toBe(200);
      expect(rpc).toHaveBeenCalledWith("get_public_customer_catalog");
      expect(factory).toHaveBeenCalledWith();
      expect(response.body).not.toContain("secret");
    } finally { await app.close(); }
  });

  it("creates an anonymous request from item IDs and quantities", async () => {
    const { app, rpc } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/public/order-requests", payload: {
        customerName: "Lan Nguyễn", phone: "0901234567", items: [{ priceId: 9, version: 2, quantity: 1 }],
      } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: "pending_confirmation", subtotal: 15000, reference: "DH-1234ABCD" });
      expect(rpc).toHaveBeenCalledWith("create_customer_order_request", expect.objectContaining({
        p_items: [{ price_id: 9, version: 2, quantity: 1 }],
        p_nonce: expect.any(String),
        p_timestamp: expect.any(Number),
        p_signature: expect.stringMatching(/^[0-9a-f]{64}$/),
      }));
    } finally { await app.close(); }
  });

  it("fails closed when the database submission signing secret is not configured", async () => {
    const { app, rpc } = fixture();
    app.customerOrderHmacSecret = undefined;
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/public/order-requests", payload: {
        customerName: "Lan Nguyễn", phone: "0901234567", items: [{ priceId: 9, version: 2, quantity: 1 }],
      } });
      expect(response.statusCode).toBe(503);
      expect(rpc).not.toHaveBeenCalledWith("create_customer_order_request", expect.anything());
    } finally { await app.close(); }
  });

  it.each([
    { customerName: " ", phone: "0901234567", items: [{ priceId: 9, version: 2, quantity: 1 }] },
    { customerName: "Lan", phone: "abc", items: [{ priceId: 9, version: 2, quantity: 1 }] },
    { customerName: "Lan", phone: "0901234567", items: [{ priceId: 9, version: 2, quantity: 0 }] },
  ])("rejects invalid anonymous order fields before calling Supabase", async payload => {
    const { app, rpc } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/public/order-requests", payload });
      expect(response.statusCode).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rate limits repeated anonymous submissions", async () => {
    const { app } = fixture();
    try {
      const payload = { customerName: "Lan", phone: "0901234567", items: [{ priceId: 9, version: 2, quantity: 1 }] };
      const responses = [];
      for (let index = 0; index < 6; index += 1) responses.push(await app.inject({ method: "POST", url: "/api/v1/public/order-requests", payload }));
      expect(responses.slice(0, 5).every(response => response.statusCode === 201)).toBe(true);
      expect(responses[5].statusCode).toBe(429);
    } finally { await app.close(); }
  });

  it("does not expose request data to anonymous or viewer users", async () => {
    const anonymous = fixture();
    try { expect((await anonymous.app.inject({ method: "GET", url: "/api/v1/customer-order-requests" })).statusCode).toBe(401); }
    finally { await anonymous.app.close(); }
    const viewer = fixture("viewer");
    try {
      const response = await viewer.app.inject({ method: "GET", url: "/api/v1/customer-order-requests", headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(403);
      expect(viewer.from).not.toHaveBeenCalled();
    } finally { await viewer.app.close(); }
  });

  it("allows owner and editor to read the request inbox", async () => {
    for (const role of ["owner", "editor"]) {
      const { app, from } = fixture(role);
      try {
        const response = await app.inject({ method: "GET", url: "/api/v1/customer-order-requests", headers: { authorization: `Bearer ${token()}` } });
        expect(response.statusCode).toBe(200);
        expect(from).toHaveBeenCalledWith("customer_order_requests");
      } finally { await app.close(); }
    }
  });

  it("lets an editor update order status through the audited status RPC", async () => {
    const { app, rpc } = fixture("editor");
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/v1/customer-order-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status", headers: { authorization: `Bearer ${token()}` }, payload: { status: "contacted" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ updated: true });
      expect(rpc).toHaveBeenCalledWith("update_customer_order_request_status", { p_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", p_status: "contacted" });
    } finally { await app.close(); }
  });

  it("denies status updates from viewer employees", async () => {
    const { app, rpc } = fixture("viewer");
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/v1/customer-order-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status", headers: { authorization: `Bearer ${token()}` }, payload: { status: "contacted" } });
      expect(response.statusCode).toBe(403);
      expect(rpc).not.toHaveBeenCalledWith("update_customer_order_request_status", expect.anything());
    } finally { await app.close(); }
  });
});
