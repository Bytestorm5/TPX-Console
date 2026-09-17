import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

/**
 * The brand kit shows one button: a solid fill. The console keeps every
 * variant a solid fill too — `secondary` is the raised surface, `ghost` is
 * transparent until hovered — and never an outline.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-sm font-semibold tracking-tight whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-accent text-on-accent hover:brightness-110",
    variant === "secondary" && "bg-surface-raised text-ink hover:bg-border-subtle",
    variant === "danger" && "bg-danger text-white hover:brightness-110",
    variant === "ghost" && "bg-transparent text-ink hover:bg-surface-raised",
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}
