import { z } from "zod";
import { MoneySchema } from "./common";

// UCP Product Catalog Schemas

export const ProductCategorySchema = z.object({
  id: z.string().describe("Unique category identifier"),
  name: z.string().describe("Category display name"),
  description: z.string().optional().describe("Category description"),
  parentId: z.string().optional().describe("Parent category ID for hierarchical categories"),
});

export const ProductSchema = z.object({
  id: z.string().describe("Unique product identifier"),
  name: z.string().describe("Product display name"),
  description: z.string().optional().describe("Product description"),
  price: MoneySchema.describe("Product price"),
  sku: z.string().optional().describe("Stock keeping unit"),
  category: z.string().optional().describe("Category ID"),
  imageUrl: z.string().url().optional().describe("Product image URL"),
  images: z.array(z.string().url()).optional().describe("Additional product images"),
  inStock: z.boolean().default(true).describe("Whether the product is in stock"),
  stockQuantity: z.number().int().nonnegative().optional().describe("Available stock quantity"),
  attributes: z.record(z.string(), z.string()).optional().describe("Product attributes (color, size, etc.)"),
});

export const ProductListResponseSchema = z.object({
  products: z.array(ProductSchema),
  total: z.number().int().nonnegative().describe("Total number of products matching query"),
  page: z.number().int().positive().optional().describe("Current page number"),
  pageSize: z.number().int().positive().optional().describe("Number of products per page"),
});

export const CategoryListResponseSchema = z.object({
  categories: z.array(ProductCategorySchema),
  total: z.number().int().nonnegative(),
});

// Type exports
export type Product = z.infer<typeof ProductSchema>;
export type ProductCategory = z.infer<typeof ProductCategorySchema>;
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;
