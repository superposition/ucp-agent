import { z, type ZodError, type ZodSchema } from "zod";
import {
  MoneySchema,
  AddressSchema,
  CartSchema,
  CustomerSchema,
  type Money,
  type Address,
  type Cart,
  type Customer,
} from "./schemas/common";
import {
  CreateCheckoutRequestSchema,
  CheckoutSessionSchema,
  type CreateCheckoutRequest,
  type CheckoutSession,
} from "./schemas/checkout";
import {
  UCPDiscoveryResponseSchema,
  type UCPDiscoveryResponse,
} from "./schemas/discovery";
import { OrderSchema, type Order } from "./schemas/order";

// ============================================
// VALIDATION RESULT TYPES
// ============================================

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  errors: FormattedError[];
  rawErrors: ZodError;
}

export interface FormattedError {
  path: string;
  message: string;
  code: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

// ============================================
// ERROR FORMATTING
// ============================================

/**
 * Format Zod errors into user-friendly error messages
 */
export function formatZodErrors(error: ZodError): FormattedError[] {
  return error.issues.map((err) => ({
    path: err.path.length > 0 ? err.path.join(".") : "(root)",
    message: formatErrorMessage(err),
    code: err.code,
  }));
}

/**
 * Format a single Zod error into a readable message
 */
function formatErrorMessage(error: z.ZodIssue): string {
  switch (error.code) {
    case "invalid_type":
      if (error.received === "undefined") {
        return `Required field is missing`;
      }
      return `Expected ${error.expected}, received ${error.received}`;

    case "invalid_string":
      if (error.validation === "email") {
        return "Invalid email address format";
      }
      if (error.validation === "url") {
        return "Invalid URL format";
      }
      return `Invalid string: ${error.validation}`;

    case "too_small":
      if (error.type === "string") {
        return `Must be at least ${error.minimum} characters`;
      }
      if (error.type === "number") {
        return `Must be at least ${error.minimum}`;
      }
      if (error.type === "array") {
        return `Must have at least ${error.minimum} item(s)`;
      }
      return error.message;

    case "too_big":
      if (error.type === "string") {
        return `Must be at most ${error.maximum} characters`;
      }
      if (error.type === "number") {
        return `Must be at most ${error.maximum}`;
      }
      if (error.type === "array") {
        return `Must have at most ${error.maximum} item(s)`;
      }
      return error.message;

    case "invalid_enum_value":
      return `Must be one of: ${error.options.join(", ")}`;

    case "invalid_literal":
      return `Must be exactly: ${String(error.expected)}`;

    case "custom":
      return error.message;

    default:
      return error.message;
  }
}

/**
 * Format validation errors as a human-readable string
 */
export function formatErrorsAsString(errors: FormattedError[]): string {
  if (errors.length === 0) return "No errors";

  if (errors.length === 1) {
    const err = errors[0];
    return err.path === "(root)"
      ? err.message
      : `${err.path}: ${err.message}`;
  }

  return errors
    .map((err) =>
      err.path === "(root)" ? `• ${err.message}` : `• ${err.path}: ${err.message}`
    )
    .join("\n");
}

// ============================================
// GENERIC VALIDATOR
// ============================================

/**
 * Generic validation function that wraps Zod schemas
 */
export function validate<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
    rawErrors: result.error,
  };
}

// ============================================
// CHECKOUT VALIDATORS
// ============================================

/**
 * Validate a checkout creation request
 */
export function validateCheckoutRequest(
  data: unknown
): ValidationResult<CreateCheckoutRequest> {
  return validate(CreateCheckoutRequestSchema, data);
}

/**
 * Validate a checkout session object
 */
export function validateCheckoutSession(
  data: unknown
): ValidationResult<CheckoutSession> {
  return validate(CheckoutSessionSchema, data);
}

// ============================================
// DISCOVERY VALIDATORS
// ============================================

/**
 * Validate a UCP discovery response
 */
export function validateDiscoveryResponse(
  data: unknown
): ValidationResult<UCPDiscoveryResponse> {
  return validate(UCPDiscoveryResponseSchema, data);
}

/**
 * Check if a merchant supports a specific capability
 */
export function hasCapability(
  discovery: UCPDiscoveryResponse,
  capabilityId: string
): boolean {
  return discovery.services.some((service) =>
    service.capabilities.some((cap) => cap.id === capabilityId)
  );
}

/**
 * Get a specific binding type from discovery
 */
export function getBinding(
  discovery: UCPDiscoveryResponse,
  bindingType: "REST" | "MCP" | "A2A" | "EMBEDDED"
): string | undefined {
  for (const service of discovery.services) {
    const binding = service.bindings.find((b) => b.type === bindingType);
    if (binding) return binding.endpoint;
  }
  return undefined;
}

// ============================================
// ORDER VALIDATORS
// ============================================

/**
 * Validate an order object
 */
export function validateOrder(data: unknown): ValidationResult<Order> {
  return validate(OrderSchema, data);
}

// ============================================
// MONEY VALIDATORS
// ============================================

// Common ISO 4217 currency codes
const COMMON_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CNY", "INR", "CAD", "AUD", "CHF", "HKD",
  "SGD", "SEK", "KRW", "NOK", "NZD", "MXN", "BRL", "ZAR", "RUB", "TRY",
]);

/**
 * Validate a Money object
 */
export function validateMoney(data: unknown): ValidationResult<Money> {
  return validate(MoneySchema, data);
}

/**
 * Check if a value is a valid Money object
 */
export function isValidMoney(data: unknown): data is Money {
  return MoneySchema.safeParse(data).success;
}

/**
 * Check if a currency code is valid (ISO 4217 format)
 */
export function isValidCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency);
}

/**
 * Check if a currency code is a known common currency
 */
export function isKnownCurrency(currency: string): boolean {
  return COMMON_CURRENCIES.has(currency);
}

/**
 * Validate money amount format (non-negative decimal string)
 */
export function isValidMoneyAmount(amount: string): boolean {
  // Must be a valid decimal number string
  if (!/^-?\d+(\.\d+)?$/.test(amount)) {
    return false;
  }

  // Parse and check if non-negative
  const num = parseFloat(amount);
  return !isNaN(num) && num >= 0;
}

/**
 * Parse a money amount string to a number
 */
export function parseMoneyAmount(amount: string): number | null {
  if (!isValidMoneyAmount(amount)) {
    return null;
  }
  return parseFloat(amount);
}

/**
 * Format a number as a money amount string with 2 decimal places
 */
export function formatMoneyAmount(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Add two Money values (must have same currency)
 */
export function addMoney(a: Money, b: Money): Money | null {
  if (a.currency !== b.currency) {
    return null;
  }

  const amountA = parseMoneyAmount(a.amount);
  const amountB = parseMoneyAmount(b.amount);

  if (amountA === null || amountB === null) {
    return null;
  }

  return {
    amount: formatMoneyAmount(amountA + amountB),
    currency: a.currency,
  };
}

/**
 * Subtract Money values (must have same currency)
 */
export function subtractMoney(a: Money, b: Money): Money | null {
  if (a.currency !== b.currency) {
    return null;
  }

  const amountA = parseMoneyAmount(a.amount);
  const amountB = parseMoneyAmount(b.amount);

  if (amountA === null || amountB === null) {
    return null;
  }

  return {
    amount: formatMoneyAmount(amountA - amountB),
    currency: a.currency,
  };
}

/**
 * Compare two Money values
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b, null if incompatible
 */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 | null {
  if (a.currency !== b.currency) {
    return null;
  }

  const amountA = parseMoneyAmount(a.amount);
  const amountB = parseMoneyAmount(b.amount);

  if (amountA === null || amountB === null) {
    return null;
  }

  if (amountA < amountB) return -1;
  if (amountA > amountB) return 1;
  return 0;
}

// ============================================
// ADDRESS VALIDATORS
// ============================================

/**
 * Validate an address object
 */
export function validateAddress(data: unknown): ValidationResult<Address> {
  return validate(AddressSchema, data);
}

/**
 * Check if a value is a valid Address object
 */
export function isValidAddress(data: unknown): data is Address {
  return AddressSchema.safeParse(data).success;
}

/**
 * Check if a country code is valid (ISO 3166-1 alpha-2)
 */
export function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
}

// ============================================
// CART VALIDATORS
// ============================================

/**
 * Validate a cart object
 */
export function validateCart(data: unknown): ValidationResult<Cart> {
  return validate(CartSchema, data);
}

/**
 * Check if a cart is valid
 */
export function isValidCart(data: unknown): data is Cart {
  return CartSchema.safeParse(data).success;
}

/**
 * Validate cart totals are consistent
 */
export function validateCartTotals(cart: Cart): FormattedError[] {
  const errors: FormattedError[] = [];

  // Calculate expected subtotal from line items
  let expectedSubtotal = 0;
  for (const item of cart.items) {
    const itemTotal = parseMoneyAmount(item.totalPrice.amount);
    if (itemTotal === null) {
      errors.push({
        path: `items[${item.id}].totalPrice`,
        message: "Invalid total price amount",
        code: "invalid_amount",
      });
      continue;
    }
    expectedSubtotal += itemTotal;
  }

  const actualSubtotal = parseMoneyAmount(cart.subtotal.amount);
  if (actualSubtotal !== null) {
    // Allow for small floating point differences
    if (Math.abs(expectedSubtotal - actualSubtotal) > 0.01) {
      errors.push({
        path: "subtotal",
        message: `Subtotal (${cart.subtotal.amount}) does not match sum of line items (${formatMoneyAmount(expectedSubtotal)})`,
        code: "subtotal_mismatch",
      });
    }
  }

  // Validate total calculation
  const actualTotal = parseMoneyAmount(cart.total.amount);
  if (actualSubtotal !== null && actualTotal !== null) {
    let expectedTotal = actualSubtotal;

    if (cart.tax) {
      const tax = parseMoneyAmount(cart.tax.amount);
      if (tax !== null) expectedTotal += tax;
    }

    if (cart.shipping) {
      const shipping = parseMoneyAmount(cart.shipping.amount);
      if (shipping !== null) expectedTotal += shipping;
    }

    if (cart.discount) {
      const discount = parseMoneyAmount(cart.discount.amount);
      if (discount !== null) expectedTotal -= discount;
    }

    if (Math.abs(expectedTotal - actualTotal) > 0.01) {
      errors.push({
        path: "total",
        message: `Total (${cart.total.amount}) does not match calculated total (${formatMoneyAmount(expectedTotal)})`,
        code: "total_mismatch",
      });
    }
  }

  return errors;
}

// ============================================
// CUSTOMER VALIDATORS
// ============================================

/**
 * Validate a customer object
 */
export function validateCustomer(data: unknown): ValidationResult<Customer> {
  return validate(CustomerSchema, data);
}

/**
 * Check if a value is a valid Customer object
 */
export function isValidCustomer(data: unknown): data is Customer {
  return CustomerSchema.safeParse(data).success;
}
