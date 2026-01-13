import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createUCPServer } from "../src/server/ucp-server";
import {
  loadCatalog,
  getProducts,
  getProductById,
  getCategories,
  clearCatalogCache,
} from "../src/catalog/catalog-loader";

const TEST_PORT = 3457;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe("Catalog Loader", () => {
  beforeAll(() => {
    clearCatalogCache();
  });

  test("loadCatalog returns products and categories", async () => {
    const catalog = await loadCatalog();
    expect(catalog.products).toBeArray();
    expect(catalog.products.length).toBeGreaterThan(0);
    expect(catalog.categories).toBeArray();
    expect(catalog.categories.length).toBeGreaterThan(0);
  });

  test("getProducts returns all products", async () => {
    const products = await getProducts();
    expect(products.length).toBeGreaterThan(0);
    expect(products[0].id).toBeDefined();
    expect(products[0].name).toBeDefined();
    expect(products[0].price).toBeDefined();
  });

  test("getProducts filters by category", async () => {
    const products = await getProducts({ category: "labubu" });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.category === "labubu")).toBe(true);
  });

  test("getProducts filters by search term", async () => {
    const products = await getProducts({ search: "pistachio" });
    expect(products.length).toBeGreaterThan(0);
    expect(
      products.some(
        (p) =>
          p.name.toLowerCase().includes("pistachio") ||
          p.description?.toLowerCase().includes("pistachio")
      )
    ).toBe(true);
  });

  test("getProducts filters by inStock", async () => {
    const inStockProducts = await getProducts({ inStock: true });
    expect(inStockProducts.every((p) => p.inStock === true)).toBe(true);

    const outOfStockProducts = await getProducts({ inStock: false });
    expect(outOfStockProducts.every((p) => p.inStock === false)).toBe(true);
  });

  test("getProductById returns correct product", async () => {
    const product = await getProductById("choc-001");
    expect(product).toBeDefined();
    expect(product?.id).toBe("choc-001");
    expect(product?.name).toBeDefined();
  });

  test("getProductById returns undefined for non-existent product", async () => {
    const product = await getProductById("non-existent-id");
    expect(product).toBeUndefined();
  });

  test("getCategories returns all categories", async () => {
    const categories = await getCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories[0].id).toBeDefined();
    expect(categories[0].name).toBeDefined();
  });
});

describe("Catalog API Endpoints", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    const app = createUCPServer({
      merchantId: "test-merchant",
      merchantName: "Test Store",
      port: TEST_PORT,
    });

    server = Bun.serve({
      port: TEST_PORT,
      fetch: app.fetch,
    });
  });

  afterAll(() => {
    server.stop();
  });

  describe("Products Endpoint", () => {
    test("GET /ucp/products returns product list", async () => {
      const response = await fetch(`${BASE_URL}/ucp/products`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.products).toBeArray();
      expect(data.products.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);
    });

    test("GET /ucp/products filters by category", async () => {
      const response = await fetch(`${BASE_URL}/ucp/products?category=dubai-chocolate`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.products.every((p: { category: string }) => p.category === "dubai-chocolate")).toBe(
        true
      );
    });

    test("GET /ucp/products filters by search", async () => {
      const response = await fetch(`${BASE_URL}/ucp/products?search=labubu`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.products.length).toBeGreaterThan(0);
    });

    test("GET /ucp/products filters by inStock", async () => {
      const response = await fetch(`${BASE_URL}/ucp/products?inStock=true`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.products.every((p: { inStock: boolean }) => p.inStock === true)).toBe(true);
    });

    test("GET /ucp/products/:productId returns single product", async () => {
      const response = await fetch(`${BASE_URL}/ucp/products/choc-001`);
      expect(response.status).toBe(200);

      const product = await response.json();
      expect(product.id).toBe("choc-001");
      expect(product.name).toBeDefined();
      expect(product.price).toBeDefined();
    });

    test("GET /ucp/products/:productId returns 404 for non-existent", async () => {
      const response = await fetch(`${BASE_URL}/ucp/products/non-existent`);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe("Product not found");
    });
  });

  describe("Categories Endpoint", () => {
    test("GET /ucp/categories returns category list", async () => {
      const response = await fetch(`${BASE_URL}/ucp/categories`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.categories).toBeArray();
      expect(data.categories.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);
    });
  });

  describe("Discovery includes catalog capability", () => {
    test("GET /.well-known/ucp includes catalog capability", async () => {
      const response = await fetch(`${BASE_URL}/.well-known/ucp`);
      expect(response.status).toBe(200);

      const data = await response.json();
      const shoppingService = data.services.find((s: { name: string }) => s.name === "Shopping");
      expect(shoppingService).toBeDefined();

      const catalogCap = shoppingService.capabilities.find(
        (c: { id: string }) => c.id === "dev.ucp.catalog.products"
      );
      expect(catalogCap).toBeDefined();
      expect(catalogCap.version).toBe("1.0.0");
    });
  });
});
