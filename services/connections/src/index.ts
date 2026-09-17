/**
 * tpx-connections — credentials, connector implementations, capability
 * contracts, scope resolution, audit log. Reachable only by service binding.
 */
import { ConnectionsService } from "./service.ts";

export { ConnectionsService, __setStoreForTests, __setFetchForTests, type ConnectionsEnv } from "./service.ts";
export { memoryStore } from "./store/memory-store.ts";
export default ConnectionsService;
