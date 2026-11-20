import type { Field, FormSchema, Values } from "./schema";
import { emptyRow } from "./values";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Turns values written under version n into values for version n + 1. */
export type Migrations = Record<number, (values: Values) => Values>;

interface Envelope {
  format: 1;
  schemaVersion: number;
  step: number;
  values: Values;
  savedAt: string;
}

export type DraftResult =
  | { outcome: "none" }
  | { outcome: "restored" | "migrated"; values: Values; step: number }
  | { outcome: "discarded"; reason: string };

export const draftKey = (schema: FormSchema) => `form-schema:draft:${schema.id}`;

export function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // blocked storage throws on access in some browsers
  }
}

/**
 * Re-fits saved values to the current schema. Anything the schema does not
 * describe is dropped, anything of the wrong type or outside a select's
 * options is blanked, and sensitive and computed fields are never restored.
 */
export function fitToSchema(fields: Field[], saved: unknown): Values {
  const src = (saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}) as Values;
  const out = emptyRow(fields);
  for (const f of fields) {
    const v = src[f.name];
    if (f.sensitive || f.type === "computed") continue;
    switch (f.type) {
      case "checkbox":
        if (typeof v === "boolean") out[f.name] = v;
        break;
      case "number":
        if (v === "" || (typeof v === "number" && Number.isFinite(v))) out[f.name] = v;
        break;
      case "select":
        if (typeof v === "string" && f.options.some((o) => o.value === v)) out[f.name] = v;
        break;
      case "group":
        if (Array.isArray(v)) {
          const rows = v.slice(0, f.max ?? v.length).map((r) => fitToSchema(f.fields, r));
          out[f.name] = rows;
        }
        break;
      default:
        if (typeof v === "string") out[f.name] = v;
    }
  }
  return out;
}

export function loadDraft(
  schema: FormSchema,
  storage: StorageLike | null,
  migrations: Migrations = {},
): DraftResult {
  if (!storage) return { outcome: "none" };
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(schema));
  } catch {
    return { outcome: "none" };
  }
  if (raw === null) return { outcome: "none" };

  // Reading must not change storage: React builds the initial state twice in
  // StrictMode, and a read that deleted what it discarded made the second
  // read report "no draft" and lose the notice. The next save replaces it.
  const discard = (reason: string): DraftResult => ({ outcome: "discarded", reason });

  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    return discard("not valid JSON");
  }
  if (!env || env.format !== 1 || typeof env.schemaVersion !== "number" || typeof env.values !== "object" || env.values === null) {
    return discard("unknown draft format");
  }
  if (env.schemaVersion > schema.version) return discard("saved by a newer version of the form");

  let values = env.values;
  for (let v = env.schemaVersion; v < schema.version; v++) {
    const step = migrations[v];
    if (!step) return discard(`no migration from version ${v}`);
    try {
      values = step(values);
    } catch {
      return discard(`migration from version ${v} threw`);
    }
  }

  const fields = schema.steps.flatMap((s) => s.fields);
  const lastStep = schema.steps.length - 1;
  const stepNo = Number.isInteger(env.step) ? env.step : 0;
  return {
    outcome: env.schemaVersion === schema.version ? "restored" : "migrated",
    values: fitToSchema(fields, values),
    step: Math.min(Math.max(stepNo, 0), lastStep),
  };
}

/** Returns false if the browser refused the write (quota, private mode). */
export function saveDraft(
  schema: FormSchema,
  storage: StorageLike | null,
  values: Values,
  step: number,
): boolean {
  if (!storage) return false;
  const env: Envelope = {
    format: 1,
    schemaVersion: schema.version,
    step,
    values: stripSensitive(schema.steps.flatMap((s) => s.fields), values),
    savedAt: new Date().toISOString(),
  };
  try {
    storage.setItem(draftKey(schema), JSON.stringify(env));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(schema: FormSchema, storage: StorageLike | null): void {
  try {
    storage?.removeItem(draftKey(schema));
  } catch {
    /* nothing to do */
  }
}

function stripSensitive(fields: Field[], values: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.sensitive) continue;
    const v = values[f.name];
    out[f.name] =
      f.type === "group" && Array.isArray(v)
        ? v.map((r) => stripSensitive(f.fields, r as Values))
        : v;
  }
  return out;
}
