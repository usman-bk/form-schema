import type { Condition, Values } from "./schema";
import { getAt } from "./paths";

/**
 * A field name inside a repeatable group is looked up on that row.
 * A leading slash reaches the root values instead: "/coverLevel".
 */
export function resolve(name: string, row: Values, root: Values): unknown {
  return name.startsWith("/") ? getAt(root, name.slice(1)) : getAt(row, name);
}

export function evalCondition(c: Condition, row: Values, root: Values): boolean {
  if ("all" in c) return c.all.every((x) => evalCondition(x, row, root));
  if ("any" in c) return c.any.some((x) => evalCondition(x, row, root));
  if ("not" in c) return !evalCondition(c.not, row, root);
  const v = resolve(c.field, row, root);
  if ("equals" in c) return v === c.equals;
  if ("notEquals" in c) return v !== c.notEquals;
  if ("in" in c) return c.in.includes(v);
  if ("gt" in c) return typeof v === "number" && v > c.gt;
  if ("lt" in c) return typeof v === "number" && v < c.lt;
  return v !== "" && v !== undefined && v !== null && v !== false;
}
