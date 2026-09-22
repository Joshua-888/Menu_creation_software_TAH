import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

/** Scroll + rounding container for wide tables. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="ui-table-wrap">{children}</div>;
}

/**
 * Table — thin styled wrapper over the existing look and feel. Adds a small
 * amount of CSS (`.ui-table*` in globals.css); does not introduce a new
 * framework or restyle the portal.
 */
export function Table({
  children,
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLTableElement>) {
  return (
    <table className="ui-table" {...rest}>
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="ui-table-head">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({
  children,
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className="ui-table-row" {...rest}>
      {children}
    </tr>
  );
}

export function Th({
  children,
  ...rest
}: { children: ReactNode } & ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...rest}>{children}</th>;
}

export function Td({
  children,
  ...rest
}: { children: ReactNode } & TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...rest}>{children}</td>;
}
