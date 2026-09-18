/**
 * Typed failures. Services throw these; the shell, in the same Worker, turns
 * them into HTTP-shaped responses (`status`, `code`) or inline action errors
 * (`detail`), and the `/api/<product>/*` surface serialises them as
 * `{ error: detail, code }` with the status.
 */
export class TpxError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
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
