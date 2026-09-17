/** tpx-dispatcher contract (skeleton): tickets, classification, agent dispatch. One sink among several. */
import type { ProductCapabilities } from "./product.ts";
export interface DispatcherServiceContract {
  capabilities(): Promise<ProductCapabilities>;
}
