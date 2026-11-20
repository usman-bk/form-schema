import type { Field, FormSchema, Values } from "./schema";
import { evalCondition } from "./conditions";

export interface ServerFieldError {
  /** "drivers[1].licence_years", "drivers.1.licenceYears" or "/drivers/1/licenceYears". */
  field: string;
  message: string;
}

export interface MappedErrors {
  byPath: Record<string, string>;
  /** Messages that name no field the form can show, with the name they used. */
  unmapped: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, "");

export function splitPath(raw: string): string[] {
  return raw
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(/[./]/)
    .filter((p) => p !== "");
}

/** Resolves an API path to the path the form uses, or null if it names nothing visible. */
export function resolveServerPath(schema: FormSchema, values: Values, raw: string): string | null {
  const parts = splitPath(raw);
  if (parts.length === 0) return null;
  let fields: Field[] = schema.steps.flatMap((s) => s.fields);
  let row: Values = values;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    const f = fields.find((x) => squash(x.name) === squash(part));
    if (!f || f.type === "computed") return null;
    out.push(f.name);
    if (f.showIf && !isShown(f, row, values)) return null;
    if (f.type !== "group") return i === parts.length - 1 ? out.join(".") : null;
    if (i === parts.length - 1) return out.join(".");
    const rows = (Array.isArray(row[f.name]) ? row[f.name] : []) as Values[];
    const idx = Number(parts[i + 1]);
    const target = rows[idx];
    if (!Number.isInteger(idx) || !target) return null;
    out.push(String(idx));
    row = target;
    fields = f.fields;
    i++;
    if (i === parts.length - 1) return null; // names a row, not a field in it
  }
  return null;
}

function isShown(f: Field, row: Values, root: Values) {
  return !f.showIf || evalCondition(f.showIf, row, root);
}

export function mapServerErrors(
  schema: FormSchema,
  values: Values,
  errors: ServerFieldError[],
): MappedErrors {
  const byPath: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const e of errors) {
    const path = resolveServerPath(schema, values, e.field);
    if (!path) {
      unmapped.push(e.field ? `${e.field}: ${e.message}` : e.message);
    } else if (byPath[path]) {
      byPath[path] += ` ${e.message}`;
    } else {
      byPath[path] = e.message;
    }
  }
  return { byPath, unmapped };
}

/** Index of the first step that holds one of the paths, or -1. */
export function firstStepWithError(schema: FormSchema, paths: string[]): number {
  const top = new Set(paths.map((p) => p.split(".")[0]));
  return schema.steps.findIndex((s) => s.fields.some((f) => top.has(f.name)));
}
