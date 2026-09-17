/**
 * Service calls from loaders and actions. Typed errors that crossed the RPC
 * boundary become HTTP-shaped responses (403 → 403 page, 404 → not found),
 * and actions get a `{ error }` result to render inline instead.
 */
import { data } from "react-router";
import { decodeRpcError, isTpxError } from "@tpx/identity";

export async function rpc<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    const decoded = decodeRpcError(error);
    if (isTpxError(decoded)) throw data({ error: decoded.detail, code: decoded.code }, { status: decoded.status });
    throw error;
  }
}

export interface ActionFailure {
  ok: false;
  error: string;
  code: string;
}

export async function attempt<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | ActionFailure> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    const decoded = decodeRpcError(error);
    if (isTpxError(decoded)) return { ok: false, error: decoded.detail, code: decoded.code };
    console.error(error);
    return { ok: false, error: "Something went wrong. Try again.", code: "unknown" };
  }
}
