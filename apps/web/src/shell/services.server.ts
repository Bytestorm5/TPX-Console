/**
 * The services the Worker mounts, and how loaders and actions call them.
 *
 * One Worker, several services: each is a library (`services/<name>`) that
 * the Worker entry constructs with the Worker's env, and every call is an
 * in-process method call. Typed failures a service throws become HTTP-shaped
 * responses here (403 → the 403 section, 404 → not found); actions get a
 * `{ error }` result to render inline instead.
 */
import { data } from "react-router";
import { AuthService } from "@tpx/auth-service";
import { ConnectionsService } from "@tpx/connections-service";
import { isTpxError } from "@tpx/identity";
import type { WebEnv } from "./env.ts";
import type { ServiceId } from "./manifest.ts";

/** Every service the console mounts, by the id a product manifest names. */
export interface Services extends Record<ServiceId, unknown> {
  auth: AuthService;
  connections: ConnectionsService;
}

const byEnv = new WeakMap<WebEnv, Services>();

/**
 * The services for this env — one set per env object, which workerd keeps
 * for the life of the isolate, so each service's own caches (its store, the
 * Alfiz runtime) live as long as the isolate does.
 */
export function servicesFor(env: WebEnv): Services {
  let services = byEnv.get(env);
  if (!services) {
    services = { auth: new AuthService(env), connections: new ConnectionsService(env) };
    byEnv.set(env, services);
  }
  return services;
}

/** Awaits a service call from a loader; a typed failure becomes the matching error response. */
export async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isTpxError(error)) throw data({ error: error.detail, code: error.code }, { status: error.status });
    throw error;
  }
}

export interface ActionFailure {
  ok: false;
  error: string;
  code: string;
}

/** Awaits a service call from an action; a typed failure becomes an inline `{ error }` result. */
export async function attempt<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | ActionFailure> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    if (isTpxError(error)) return { ok: false, error: error.detail, code: error.code };
    console.error(error);
    return { ok: false, error: "Something went wrong. Try again.", code: "unknown" };
  }
}
