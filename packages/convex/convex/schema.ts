/**
 * One Convex deployment for the whole console. Each service owns a folder of
 * functions and a table map here, and its tables carry the service as a
 * prefix (`auth_tenants`, `connections_secrets`) — Convex table names cannot
 * contain a dot, so `service_table` stands in for `service.table`. A service
 * only ever touches its own prefix; nothing in Convex is public.
 */
import { defineSchema } from "convex/server";
import { authTables } from "./auth/schema";
import { connectionsTables } from "./connections/schema";

export default defineSchema({ ...authTables, ...connectionsTables });
