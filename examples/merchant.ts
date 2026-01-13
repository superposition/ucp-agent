#!/usr/bin/env bun
/**
 * Example UCP Merchant Server
 *
 * A reference implementation showing how to run a UCP-compliant merchant.
 *
 * Usage:
 *   bun run examples/merchant.ts
 *   # Or with options:
 *   PORT=4000 MERCHANT_NAME="My Store" bun run examples/merchant.ts
 */

import { createUCPServer } from "../src/server";

// Sample product catalog
const PRODUCTS = [
  {
    id: "prod-001",
    name: "Wireless Bluetooth Headphones",
    description: "Premium noise-cancelling headphones with 30-hour battery life",
    price: { amount: "149.99", currency: "USD" },
    category: "Electronics",
    inStock: true,
  },
  {
    id: "prod-002",
    name: "Organic Cotton T-Shirt",
    description: "Comfortable everyday t-shirt made from 100% organic cotton",
    price: { amount: "29.99", currency: "USD" },
    category: "Clothing",
    inStock: true,
  },
  {
    id: "prod-003",
    name: "Stainless Steel Water Bottle",
    description: "32oz insulated bottle keeps drinks cold for 24 hours",
    price: { amount: "34.99", currency: "USD" },
    category: "Home",
    inStock: true,
  },
  {
    id: "prod-004",
    name: "Mechanical Keyboard",
    description: "RGB backlit keyboard with Cherry MX switches",
    price: { amount: "129.99", currency: "USD" },
    category: "Electronics",
    inStock: true,
  },
  {
    id: "prod-005",
    name: "Running Shoes",
    description: "Lightweight performance running shoes with responsive cushioning",
    price: { amount: "119.99", currency: "USD" },
    category: "Sports",
    inStock: false,
  },
];

// Configuration from environment
const PORT = parseInt(process.env.PORT || "3000");
const MERCHANT_ID = process.env.MERCHANT_ID || "example-store";
const MERCHANT_NAME = process.env.MERCHANT_NAME || "Example UCP Store";

// Create server
const app = createUCPServer({
  merchantId: MERCHANT_ID,
  merchantName: MERCHANT_NAME,
  port: PORT,
  security: {
    rateLimit: {
      maxRequests: 100,
      windowMs: 60000,
    },
  },
});

// Add product catalog endpoint
app.get("/api/products", (c) => {
  const category = c.req.query("category");
  const inStock = c.req.query("inStock");

  let products = PRODUCTS;

  if (category) {
    products = products.filter((p) => p.category.toLowerCase() === category.toLowerCase());
  }

  if (inStock === "true") {
    products = products.filter((p) => p.inStock);
  }

  return c.json({ products, total: products.length });
});

app.get("/api/products/:id", (c) => {
  const product = PRODUCTS.find((p) => p.id === c.req.param("id"));
  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }
  return c.json(product);
});

// Start server
console.log(`
╔═══════════════════════════════════════════════════╗
║           Example UCP Merchant Server              ║
╠═══════════════════════════════════════════════════╣
║  Merchant: ${MERCHANT_NAME.padEnd(38)}║
║  ID: ${MERCHANT_ID.padEnd(44)}║
║  Port: ${String(PORT).padEnd(42)}║
╠═══════════════════════════════════════════════════╣
║  Endpoints:                                        ║
║  • Discovery:  GET /.well-known/ucp               ║
║  • Products:   GET /api/products                  ║
║  • Checkout:   POST /ucp/checkout                 ║
║  • Orders:     GET /ucp/orders                    ║
╠═══════════════════════════════════════════════════╣
║  Discount Codes: SAVE10, SAVE20, FLAT5, WELCOME   ║
╚═══════════════════════════════════════════════════╝

Server running at http://localhost:${PORT}
Press Ctrl+C to stop
`);

Bun.serve({
  port: PORT,
  fetch: app.fetch,
});