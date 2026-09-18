/**
 * The auth service — tenants, projects, environments, membership, grants,
 * audit. A library, not a Worker: the console's Worker entry constructs
 * `AuthService` with its env and calls it in-process.
 */
export { AuthService, __setStoreForTests, type AuthEnv } from "./service.ts";
export { getAlfiz } from "./alfiz.ts";
export { memoryStore } from "./store/memory-store.ts";
