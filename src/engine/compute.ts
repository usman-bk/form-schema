import type { Expr, Field, FormSchema, Values } from "./schema";
import { resolve } from "./conditions";

/**
 * Null means "cannot be worked out yet": an input is blank or not a number,
 * or the result would be infinite. Blank is not zero. Number("") is 0, which
 * priced a quote at 0 while the age was still empty.
 */
export function evalExpr(e: Expr, row: Values, root: Values): number | null {
  if ("value" in e) return e.value;
  if (!("op" in e)) {
    const v = resolve(e.ref, row, root);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  if (e.op === "count") {
    const v = resolve(e.ref, row, root);
    return Array.isArray(v) ? v.length : 0;
  }
  if (e.op === "pick") {
    const key = String(resolve(e.ref, row, root));
    return e.map[key] ?? e.otherwise;
  }
  const a: number[] = [];
  for (const arg of e.args) {
    const n = evalExpr(arg, row, root);
    if (n === null) return null;
    a.push(n);
  }
  const [first = 0, second = 0] = a;
  let out: number;
  switch (e.op) {
    case "add":
      out = a.reduce((s, n) => s + n, 0);
      break;
    case "mul":
      out = a.reduce((s, n) => s * n, 1);
      break;
    case "sub":
      out = first - second;
      break;
    case "div":
      out = first / second;
      break;
    case "min":
      out = Math.min(...a);
      break;
    case "max":
      out = Math.max(...a);
      break;
    case "round":
      out = Math.round(first);
      break;
  }
  return Number.isFinite(out) ? out : null;
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
