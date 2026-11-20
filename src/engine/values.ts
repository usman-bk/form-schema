import type { Field, FormSchema, Step, Values } from "./schema";
import { evalCondition } from "./conditions";

export function emptyRow(fields: Field[]): Values {
  const row: Values = {};
  for (const f of fields) row[f.name] = emptyValue(f);
  return row;
}

function emptyValue(f: Field): unknown {
  switch (f.type) {
    case "checkbox":
      return false;
    case "computed":
      return null;
    case "group":
      return Array.from({ length: f.min ?? 0 }, () => emptyRow(f.fields));
    default:
      return "";
  }
}

export function emptyValues(schema: FormSchema): Values {
  return emptyRow(schema.steps.flatMap((s) => s.fields));
}

export interface Leaf {
  path: string;
  field: Exclude<Field, { type: "group" }>;
  value: unknown;
}

export interface GroupNode {
  path: string;
  field: Extract<Field, { type: "group" }>;
  rows: Values[];
}

export function isVisible(f: Field, row: Values, root: Values): boolean {
  return !f.showIf || evalCondition(f.showIf, row, root);
}

/** Visible leaves and groups of a step, in the order they are drawn. */
export function walkVisible(
  fields: Field[],
  root: Values,
  row: Values = root,
  base = "",
  out: { leaves: Leaf[]; groups: GroupNode[] } = { leaves: [], groups: [] },
) {
  for (const f of fields) {
    if (!isVisible(f, row, root)) continue;
    const path = base + f.name;
    if (f.type === "group") {
      const rows = (Array.isArray(row[f.name]) ? row[f.name] : []) as Values[];
      out.groups.push({ path, field: f, rows });
      rows.forEach((r, i) => walkVisible(f.fields, root, r, `${path}.${i}.`, out));
    } else {
      out.leaves.push({ path, field: f, value: row[f.name] });
    }
  }
  return out;
}

export const stepLeaves = (step: Step, root: Values) =>
  walkVisible(step.fields, root);

/** The values that are sent: hidden fields are dropped, whatever they hold. */
export function pruneHidden(fields: Field[], root: Values, row: Values = root): Values {
  const out: Values = {};
  for (const f of fields) {
    if (!isVisible(f, row, root)) continue;
    if (f.type === "group") {
      const rows = (Array.isArray(row[f.name]) ? row[f.name] : []) as Values[];
      out[f.name] = rows.map((r) => pruneHidden(f.fields, root, r));
    } else {
      out[f.name] = row[f.name];
    }
  }
  return out;
}
