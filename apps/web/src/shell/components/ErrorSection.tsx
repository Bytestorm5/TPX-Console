import { TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button, buttonClasses } from "@tpx/ui";

/**
 * Every product route subtree gets its own error boundary: a failing service
 * renders a broken section, not a broken console.
 */
export function ErrorSection({ title = "This section is unavailable" }: { title?: string }) {
  const error = useRouteError();
  let detail = "Something went wrong while loading this section.";
  let status: number | null = null;
  if (isRouteErrorResponse(error)) {
    status = error.status;
    const body = error.data as { error?: string } | string | undefined;
    detail = typeof body === "string" ? body : (body?.error ?? error.statusText ?? detail);
  } else if (error instanceof Error) {
    detail = import.meta.env.DEV ? error.message : detail;
  }
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-6">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 shrink-0 text-danger" size={20} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {status ? `${status} · ` : ""}
            {status === 404 ? "Not found" : status === 403 ? "Not allowed" : title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{detail}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Link to="/" className={buttonClasses("ghost", "sm")}>
              Back to the console
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
