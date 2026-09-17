import type { HTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Badge({
  tone = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight",
        tone === "neutral" && "bg-surface-raised text-ink-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "success" && "bg-success/15 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "danger" && "bg-danger/15 text-danger",
        className,
      )}
      {...rest}
    />
  );
}
