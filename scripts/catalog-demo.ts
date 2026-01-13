#!/usr/bin/env bun
/**
 * Catalog Integration Demo
 *
 * This script demonstrates the full product catalog flow:
 * 1. Discover merchant capabilities
 * 2. List categories
 * 3. Browse products (with filters)
 * 4. Get product details
 * 5. Create checkout with catalog products
 * 6. Complete the purchase
 *
 * Usage: bun run scripts/catalog-demo.ts [--base-url http://localhost:3000]
 */

const BASE_URL = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://localhost:3000";

// ANSI colors for output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function header(title: string) {
  console.log();
  log(`${"=".repeat(60)}`, colors.cyan);
  log(`  ${title}`, colors.bright + colors.cyan);
  log(`${"=".repeat(60)}`, colors.cyan);
}

function subheader(title: string) {
  console.log();
  log(`--- ${title} ---`, colors.yellow);
}

function json(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

async function api(
  endpoint: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${BASE_URL}${endpoint}`;
  log(`${options?.method || "GET"} ${url}`, colors.dim);

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function main() {
  log(`\n🛒 UCP Catalog Integration Demo`, colors.bright + colors.green);
  log(`   Base URL: ${BASE_URL}`, colors.dim);

  // ============================================
  // Step 1: Discover Merchant
  // ============================================
  header("Step 1: Discover Merchant Capabilities");

  const discovery = await api("/.well-known/ucp");
  if (!discovery.ok) {
    log(`❌ Failed to discover merchant. Is the server running?`, colors.red);
    process.exit(1);
  }

  const disc = discovery.data as {
    merchantName: string;
    merchantId: string;
    services: Array<{
      name: string;
      capabilities: Array<{ id: string; version: string }>;
    }>;
  };

  log(`✅ Connected to: ${disc.merchantName} (${disc.merchantId})`, colors.green);

  const shoppingService = disc.services.find((s) => s.name === "Shopping");
  const catalogCap = shoppingService?.capabilities.find(
    (c) => c.id === "dev.ucp.catalog.products"
  );

  if (catalogCap) {
    log(`✅ Catalog capability found: ${catalogCap.id} v${catalogCap.version}`, colors.green);
  } else {
    log(`❌ Catalog capability not found!`, colors.red);
    process.exit(1);
  }

  // ============================================
  // Step 2: List Categories
  // ============================================
  header("Step 2: List Product Categories");

  const categories = await api("/ucp/categories");
  const cats = categories.data as {
    categories: Array<{ id: string; name: string; description?: string }>;
    total: number;
  };

  log(`Found ${cats.total} categories:`, colors.green);
  for (const cat of cats.categories) {
    log(`  • ${cat.name} (${cat.id})${cat.description ? ` - ${cat.description}` : ""}`, colors.reset);
  }

  // ============================================
  // Step 3: Browse Products
  // ============================================
  header("Step 3: Browse Products");

  subheader("All Products");
  const allProducts = await api("/ucp/products");
  const all = allProducts.data as {
    products: Array<{
      id: string;
      name: string;
      price: { amount: string; currency: string };
      category?: string;
      inStock: boolean;
    }>;
    total: number;
  };

  log(`Found ${all.total} products:`, colors.green);
  for (const p of all.products.slice(0, 5)) {
    const stock = p.inStock ? "✓" : "✗";
    log(`  ${stock} ${p.name} - $${p.price.amount} [${p.category || "uncategorized"}]`, colors.reset);
  }
  if (all.total > 5) {
    log(`  ... and ${all.total - 5} more`, colors.dim);
  }

  subheader("Filter by Category: electronics");
  const electronics = await api("/ucp/products?category=electronics");
  const elec = electronics.data as { products: typeof all.products; total: number };

  log(`Found ${elec.total} electronics:`, colors.green);
  for (const p of elec.products) {
    log(`  • ${p.name} - $${p.price.amount}`, colors.reset);
  }

  subheader("Search for: bluetooth");
  const search = await api("/ucp/products?search=bluetooth");
  const searchResults = search.data as { products: typeof all.products; total: number };

  log(`Found ${searchResults.total} products matching "bluetooth":`, colors.green);
  for (const p of searchResults.products) {
    log(`  • ${p.name} - $${p.price.amount}`, colors.reset);
  }

  subheader("Filter: In Stock Only");
  const inStock = await api("/ucp/products?inStock=true");
  const inStockResults = inStock.data as { products: typeof all.products; total: number };
  log(`Found ${inStockResults.total} products in stock`, colors.green);

  // ============================================
  // Step 4: Get Product Details
  // ============================================
  header("Step 4: Get Product Details");

  const productId = all.products[0].id;
  const productDetails = await api(`/ucp/products/${productId}`);
  const product = productDetails.data as {
    id: string;
    name: string;
    description?: string;
    price: { amount: string; currency: string };
    sku?: string;
    category?: string;
    inStock: boolean;
    stockQuantity?: number;
    attributes?: Record<string, string>;
  };

  log(`Product: ${product.name}`, colors.green);
  log(`  ID: ${product.id}`, colors.reset);
  log(`  Price: $${product.price.amount} ${product.price.currency}`, colors.reset);
  if (product.description) log(`  Description: ${product.description}`, colors.reset);
  if (product.sku) log(`  SKU: ${product.sku}`, colors.reset);
  if (product.category) log(`  Category: ${product.category}`, colors.reset);
  log(`  In Stock: ${product.inStock ? "Yes" : "No"}${product.stockQuantity ? ` (${product.stockQuantity} available)` : ""}`, colors.reset);
  if (product.attributes) {
    log(`  Attributes:`, colors.reset);
    for (const [key, value] of Object.entries(product.attributes)) {
      log(`    - ${key}: ${value}`, colors.dim);
    }
  }

  // ============================================
  // Step 5: Create Checkout with Catalog Product
  // ============================================
  header("Step 5: Create Checkout with Catalog Products");

  // Pick first two in-stock products
  const cartItems = inStockResults.products.slice(0, 2);

  log(`Adding to cart:`, colors.green);
  let subtotal = 0;
  const lineItems = cartItems.map((p, i) => {
    const qty = i === 0 ? 2 : 1;
    const itemTotal = parseFloat(p.price.amount) * qty;
    subtotal += itemTotal;
    log(`  • ${qty}x ${p.name} @ $${p.price.amount} = $${itemTotal.toFixed(2)}`, colors.reset);
    return {
      id: `item-${i}`,
      productId: p.id,
      name: p.name,
      quantity: qty,
      unitPrice: p.price,
      totalPrice: { amount: itemTotal.toFixed(2), currency: p.price.currency },
    };
  });

  log(`  Subtotal: $${subtotal.toFixed(2)}`, colors.bright);

  const checkoutReq = {
    merchantId: disc.merchantId,
    cart: {
      items: lineItems,
      subtotal: { amount: subtotal.toFixed(2), currency: "USD" },
      total: { amount: subtotal.toFixed(2), currency: "USD" },
    },
    customer: {
      contact: {
        name: "Demo Customer",
        email: "demo@example.com",
      },
    },
  };

  const checkout = await api("/ucp/checkout", {
    method: "POST",
    body: JSON.stringify(checkoutReq),
  });

  if (!checkout.ok) {
    log(`❌ Failed to create checkout`, colors.red);
    json(checkout.data);
    process.exit(1);
  }

  const session = checkout.data as { id: string; status: string };
  log(`✅ Checkout created: ${session.id}`, colors.green);
  log(`   Status: ${session.status}`, colors.reset);

  // ============================================
  // Step 6: Add Shipping & Complete
  // ============================================
  header("Step 6: Complete the Purchase");

  subheader("Add Shipping Address");
  const updateRes = await api(`/ucp/checkout/${session.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      shippingAddress: {
        line1: "123 Demo Street",
        city: "San Francisco",
        region: "CA",
        postalCode: "94102",
        country: "US",
      },
    }),
  });
  log(`✅ Shipping address added`, colors.green);

  subheader("Select Shipping Option");
  const shippingRes = await api(`/ucp/checkout/${session.id}`, {
    method: "PATCH",
    body: JSON.stringify({ selectedShippingOptionId: "standard" }),
  });
  const updated = shippingRes.data as { cart: { total: { amount: string } } };
  log(`✅ Standard shipping selected`, colors.green);
  log(`   New total: $${updated.cart.total.amount}`, colors.reset);

  subheader("Complete Payment");
  const completeRes = await api(`/ucp/checkout/${session.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      paymentMethod: { type: "card" },
    }),
  });

  if (!completeRes.ok) {
    log(`❌ Payment failed`, colors.red);
    json(completeRes.data);
    process.exit(1);
  }

  const order = completeRes.data as {
    success: boolean;
    orderId: string;
    orderNumber: string;
  };

  log(`✅ Payment successful!`, colors.green);
  log(`   Order ID: ${order.orderId}`, colors.reset);
  log(`   Order Number: ${order.orderNumber}`, colors.bright);

  // ============================================
  // Summary
  // ============================================
  header("Demo Complete!");

  log(`
The catalog integration demo successfully:

  1. ✅ Discovered merchant with catalog capability
  2. ✅ Listed ${cats.total} product categories
  3. ✅ Browsed ${all.total} products with filtering
  4. ✅ Retrieved detailed product information
  5. ✅ Created checkout with catalog products
  6. ✅ Completed purchase (Order: ${order.orderNumber})

Run again with: bun run scripts/catalog-demo.ts
`, colors.green);
}

main().catch((err) => {
  log(`\n❌ Error: ${err.message}`, colors.red);
  process.exit(1);
});
