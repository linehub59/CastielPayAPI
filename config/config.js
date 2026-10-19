import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4242),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  DEFAULT_APP_ID: z.string().default('castiel-demo'),
  MERCHANTS_JSON: z.string().default('{}'),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYPAL_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYPAL_CURRENCY: z.string().default('USD'),
  INTASEND_ENV: z.enum(['test', 'live']).default('test')
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${parsed.error.message}`
  );
}

export const config = parsed.data;

export const origins = config.ALLOWED_ORIGINS
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let merchants;

try {
  merchants = JSON.parse(config.MERCHANTS_JSON);
} catch {
  throw new Error('MERCHANTS_JSON must be valid JSON');
}

export function getProduct(appId, productId) {
  const app = merchants[appId];
  const product = app?.products?.[productId];

  if (
    !app ||
    !product ||
    !Number.isFinite(product.amount) ||
    product.amount <= 0
  ) {
    return null;
  }

  return {
    appId,
    appName: app.name || appId,
    productId,
    name: product.name || productId,
    amount: product.amount,
    currency: product.currency || 'KES',
    paypalAmount: Number.isFinite(product.paypalAmount)
      ? product.paypalAmount
      : null
  };
}

export function publicConfig() {
  return {
    defaultAppId: config.DEFAULT_APP_ID,
    apps: Object.entries(merchants).map(([appId, app]) => ({
      appId,
      name: app.name || appId,
      products: Object.entries(app.products || {}).map(([productId, p]) => ({
        productId,
        name: p.name || productId,
        amount: p.amount,
        currency: p.currency || 'KES',
        paypalAmount: Number.isFinite(p.paypalAmount)
          ? p.paypalAmount
          : null
      }))
    }))
  };
}