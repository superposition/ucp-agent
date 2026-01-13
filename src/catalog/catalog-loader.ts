import * as yaml from "js-yaml";
import { z } from "zod";
import {
  ProductSchema,
  ProductCategorySchema,
  type Product,
  type ProductCategory,
} from "../sdk/schemas/product";

// Schema for the YAML file structure
const CatalogFileSchema = z.object({
  categories: z.array(ProductCategorySchema).default([]),
  products: z.array(ProductSchema).default([]),
});

type CatalogData = {
  products: Product[];
  categories: ProductCategory[];
};

let catalogCache: CatalogData | null = null;

/**
 * Load and parse the product catalog from YAML file
 */
export async function loadCatalog(
  filePath = "data/products.yaml"
): Promise<CatalogData> {
  if (catalogCache) {
    return catalogCache;
  }

  const file = Bun.file(filePath);
  const content = await file.text();
  const parsed = yaml.load(content);

  const result = CatalogFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid catalog file: ${result.error.message}`);
  }

  catalogCache = {
    products: result.data.products,
    categories: result.data.categories,
  };

  return catalogCache;
}

/**
 * Get all products, optionally filtered
 */
export async function getProducts(options?: {
  category?: string;
  search?: string;
  inStock?: boolean;
}): Promise<Product[]> {
  const catalog = await loadCatalog();
  let products = catalog.products;

  if (options?.category) {
    products = products.filter((p) => p.category === options.category);
  }

  if (options?.search) {
    const searchLower = options.search.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(searchLower) ||
        p.description?.toLowerCase().includes(searchLower)
    );
  }

  if (options?.inStock !== undefined) {
    products = products.filter((p) => p.inStock === options.inStock);
  }

  return products;
}

/**
 * Get a single product by ID
 */
export async function getProductById(
  productId: string
): Promise<Product | undefined> {
  const catalog = await loadCatalog();
  return catalog.products.find((p) => p.id === productId);
}

/**
 * Get all categories
 */
export async function getCategories(): Promise<ProductCategory[]> {
  const catalog = await loadCatalog();
  return catalog.categories;
}

/**
 * Clear the catalog cache (useful for testing or hot-reloading)
 */
export function clearCatalogCache(): void {
  catalogCache = null;
}
