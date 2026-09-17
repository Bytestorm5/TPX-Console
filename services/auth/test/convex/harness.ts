/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { convexStore } from "../../src/store/convex-store";
import type { ConvexCaller } from "@tpx/convex-client";

/** convex-test locates the functions root from the `_generated` entry in this map. */
export const modules = import.meta.glob("../../convex/**/*.*s");

export function freshStore() {
  const t = convexTest(schema, modules);
  const call = (fn: (...a: never[]) => Promise<unknown>) => (ref: unknown, args: unknown) =>
    fn(ref as never, args as never);
  const caller: ConvexCaller = {
    query: call(t.query as never) as ConvexCaller["query"],
    mutation: call(t.mutation as never) as ConvexCaller["mutation"],
  };
  return { t, store: convexStore(caller) };
}
