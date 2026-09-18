/**
 * The connections service — credentials, connector implementations,
 * capability contracts, scope resolution, audit log. A library, not a Worker:
 * the console's Worker entry constructs `ConnectionsService` with its env and
 * calls it in-process.
 */
export { ConnectionsService, __setStoreForTests, __setFetchForTests, type ConnectionsEnv } from "./service.ts";
export { memoryStore } from "./store/memory-store.ts";
