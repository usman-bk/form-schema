import type { Expr, Field, FormSchema, Values } from "./schema";
import { resolve } from "./conditions";

export function evalExpr(e: Expr, row: Values, root: Values): number {
  if ("value" in e) return e.value;
  if (!("op" in e)) return Number(resolve(e.ref, row, root));
  if (e.op === "count") {
    const v = resolve(e.ref, row, root);
    return Array.isArray(v) ? v.length : 0;
  }
  if (e.op === "pick") {
    const key = String(resolve(e.ref, row, root));
    return e.map[key] ?? e.otherwise;
  }
  const a = e.args.map((x) => evalExpr(x, row, root));
  const [first = 0, second = 0] = a;
  switch (e.op) {
    case "add":
      return a.reduce((s, n) => s + n, 0);
    case "mul":
      return a.reduce((s, n) => s * n, 1);
    case "sub":
      return first - second;
    case "div":
      return first / second;
    case "min":
      return Math.min(...a);
    case "max":
      return Math.max(...a);
    case "round":
      return Math.round(first);
  }
}

/**
 * Fills every computed field, in declaration order, so a computed field may
 * read one declared above it and not one declared below.
 */
export function applyComputed(schema: FormSchema, values: Values): Values {
  const next: Values = { ...values };
  const fields: Field[] = schema.steps.flatMap((s) => s.fields);
  for (const f of fields) {
    if (f.type === "computed") next[f.name] = evalExpr(f.expr, next, next);
  }
  return next;
}
