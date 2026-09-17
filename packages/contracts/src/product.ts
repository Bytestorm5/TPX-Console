import { z } from "zod";

/** Every product the console can light up. The shell hides what isn't enabled. */
export const PRODUCT_IDS = ["workspace", "connections", "operator", "dispatcher", "integrator"] as const;
export const ProductIdSchema = z.enum(PRODUCT_IDS);
export type ProductId = z.infer<typeof ProductIdSchema>;

/**
 * What a service tells the shell about itself. Nav entries whose `requires`
 * feature isn't listed don't render; a disabled product renders nothing.
 */
export const ProductCapabilitiesSchema = z.object({
  product: ProductIdSchema,
  enabled: z.boolean(),
  /** Feature flags a nav entry may `require` (e.g. "audit"). */
  features: z.array(z.string()),
  version: z.string(),
});
export type ProductCapabilities = z.infer<typeof ProductCapabilitiesSchema>;
