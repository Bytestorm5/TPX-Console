import type { ProviderDescriptor } from "@tpx/contracts/connections";

export interface ProviderCallInput {
  credential: Record<string, string>;
  config: Record<string, string>;
  fetch: typeof globalThis.fetch;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export interface ProviderImpl {
  descriptor: ProviderDescriptor;
  /** A live, read-only call proving the credential works. */
  test?(input: ProviderCallInput): Promise<ProviderTestResult>;
  /** Provider operations products may execute through `execute()`. */
  execute?(op: string, args: unknown, input: ProviderCallInput): Promise<unknown>;
}

export const REQUEST_TIMEOUT_MS = 10_000;

export async function probe(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  okMessage: string,
): Promise<ProviderTestResult> {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.ok) return { ok: true, message: okMessage };
    return { ok: false, message: `HTTP ${response.status} from ${new URL(url).host}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "request failed" };
  }
}
