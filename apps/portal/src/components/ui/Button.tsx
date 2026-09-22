import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Visual variants mapped onto the existing `.btn*` classes. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(
  variant: ButtonVariant = "primary",
  compact = false,
): string {
  const parts = ["btn"];
  if (variant === "secondary") parts.push("btn-secondary");
  if (variant === "ghost") parts.push("btn-ghost");
  if (variant === "danger") parts.push("btn-danger");
  if (compact) parts.push("btn-compact");
  return parts.join(" ");
}

/**
 * Button — thin wrapper over the existing `.btn` / `.btn-secondary` /
 * `.btn-ghost` / `.btn-danger` classes. Defaults to `type="button"` so it is
 * safe inside forms unless a submit type is passed explicitly.
 */
export function Button({
  variant = "primary",
  compact = false,
  className,
  type = "button",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  compact?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [buttonClass(variant, compact), className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} type={type} {...rest}>
      {children}
    </button>
  );
}
