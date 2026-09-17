/** tpx-operator contract (skeleton): ops state and actions. */
import type { ProductCapabilities } from "./product.ts";
export interface OperatorServiceContract {
  capabilities(): Promise<ProductCapabilities>;
}
