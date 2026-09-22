import type { ReactNode } from "react";

/**
 * Panel — thin wrapper over the existing `.panel` class, with an optional
 * heading rendered as `<h2>` to match `.panel h2` styling.
 */
export function Panel({
  title,
  className,
  children,
}: {
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["panel", className].filter(Boolean).join(" ")}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </div>
  );
}

/** Card is an alias of Panel for generic containers. */
export const Card = Panel;
