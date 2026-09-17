/**
 * Typed failures that survive an RPC boundary. Workers RPC carries an Error's
 * message but not custom properties, so the status and code ride in the
 * message (`TPX[403:forbidden] ...`) and `decodeRpcError` restores them at the
 * other end.
 */
const PREFIX = /^TPX\[(\d{3}):([a-z_]+)\] (.*)$/s;

export class TpxError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(status: number, code: string, detail: string) {
    super(`TPX[${status}:${code}] ${detail}`);
    this.name = "TpxError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export class UnauthenticatedError extends TpxError {
  constructor(detail = "sign in to continue") {
    super(401, "unauthenticated", detail);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends TpxError {
  readonly permission: string | undefined;
  constructor(detail: string, permission?: string) {
    super(403, "forbidden", detail);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

export class NotFoundError extends TpxError {
  constructor(detail = "not found") {
    super(404, "not_found", detail);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends TpxError {
  constructor(detail: string) {
    super(409, "conflict", detail);
    this.name = "ConflictError";
  }
}

export class ValidationError extends TpxError {
  constructor(detail: string) {
    super(400, "validation", detail);
    this.name = "ValidationError";
  }
}

export function isTpxError(error: unknown): error is TpxError {
  return error instanceof TpxError;
}

/** Restores a `TpxError` from an error that crossed an RPC boundary; other errors pass through. */
export function decodeRpcError(error: unknown): unknown {
  if (error instanceof TpxError) return error;
  if (error instanceof Error) {
    const m = PREFIX.exec(error.message);
    if (m) {
      const status = Number(m[1]);
      const code = m[2] ?? "error";
      const detail = m[3] ?? "";
      switch (code) {
        case "unauthenticated":
          return new UnauthenticatedError(detail);
        case "forbidden":
          return new ForbiddenError(detail);
        case "not_found":
          return new NotFoundError(detail);
        case "conflict":
          return new ConflictError(detail);
        case "validation":
          return new ValidationError(detail);
        default:
          return new TpxError(status, code, detail);
      }
    }
  }
  return error;
}
