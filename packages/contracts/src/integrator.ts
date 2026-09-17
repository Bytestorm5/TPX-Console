/** tpx-integrator contract (skeleton): contract monitoring and change detection. Emits `integrator.contract.changed`. */
import type { ProductCapabilities } from "./product.ts";
export interface IntegratorServiceContract {
  capabilities(): Promise<ProductCapabilities>;
}
