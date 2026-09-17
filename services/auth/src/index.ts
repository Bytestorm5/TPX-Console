/**
 * tpx-auth — tenants, projects, environments, membership, grants, audit.
 * Reachable only by service binding. The default export is the RPC entrypoint.
 */
import { AuthService } from "./service.ts";

export { AuthService, __setStoreForTests, type AuthEnv } from "./service.ts";
export { getAlfiz } from "./alfiz.ts";
export { memoryStore } from "./store/memory-store.ts";
export default AuthService;
