/// <reference types="vite/client" />
/**
 * The function modules for convex-test, globbed here (where the files live)
 * so every service's Convex tests share one map. convex-test locates the
 * functions root from the `_generated` entry.
 */
export const modules = import.meta.glob("./convex/**/*.*s");
