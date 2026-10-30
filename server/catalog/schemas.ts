import { z } from "zod";

export const COLOR_KEYS = [
  "black",
  "brown",
  "tortoise",
  "olive",
  "amber",
  "rose",
  "gold",
  "silver",
  "clear",
  "orange",
] as const;
export const FRAME_SHAPES = ["round", "square", "aviator", "cat-eye", "sport"] as const;

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and hyphens")
  .max(80);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const translationInput = z.object({
  name: z.string().trim().min(1).max(120),
  subtitle: optionalText(200),
  description: optionalText(4000),
  slug,
  seoTitle: optionalText(160),
  seoDescription: optionalText(320),
});

export const productInput = z.object({
  categoryKey: z.string().trim().min(1).max(40),
  brandKey: z.string().trim().max(40).nullish(),
  frameShape: z.enum(FRAME_SHAPES).nullish(),
  featured: z.boolean().default(false),
  ar: translationInput,
  en: translationInput,
});
export type ProductInput = z.infer<typeof productInput>;

/** Prices are integer piasters, capped well below anything plausible for eyewear to catch unit mistakes. */
export const variantInput = z
  .object({
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, "SKU: A–Z, 0–9, hyphen"),
    colorKey: z.enum(COLOR_KEYS),
    pricePiasters: z.number().int().min(0).max(10_000_000),
    compareAtPiasters: z.number().int().min(1).max(10_000_000).nullish(),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => v.compareAtPiasters == null || v.compareAtPiasters > v.pricePiasters, {
    message: "Compare-at price must be higher than the price",
    path: ["compareAtPiasters"],
  });
export type VariantInput = z.infer<typeof variantInput>;

export const ALLOWED_IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
