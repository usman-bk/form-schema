import { z } from "zod";
import type { Field, Step, Values } from "./schema";
import { stepLeaves, type Leaf } from "./values";

export type Errors = Record<string, string>;

type Leafish = Leaf["field"];

function schemaFor(f: Leafish): z.ZodType | null {
  const label = f.label;
  switch (f.type) {
    case "computed":
      return null;
    case "checkbox":
      return f.required
        ? z.literal(true, { error: `${label} must be ticked` })
        : z.boolean();
    case "select":
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]], {
        error: `Choose a ${label.toLowerCase()}`,
      });
    case "number": {
      let n = z.number({ error: `${label} must be a number` });
      if (f.integer) n = n.int(`${label} must be a whole number`);
      if (f.min !== undefined) n = n.min(f.min, `${label} must be at least ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `${label} must be at most ${f.max}`);
      return n;
    }
    case "email":
    case "text": {
      let s = z.string();
      if (f.type === "email") {
        s = s.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, `${label} must be an email address`);
      }
      if (f.minLength) s = s.min(f.minLength, `${label} needs at least ${f.minLength} characters`);
      if (f.maxLength) s = s.max(f.maxLength, `${label} can have at most ${f.maxLength} characters`);
      if (f.pattern) s = s.regex(new RegExp(f.pattern.source), f.pattern.message);
      return s;
    }
  }
}

const isEmpty = (v: unknown) => v === "" || v === undefined || v === null;

export function validateLeaf(f: Leafish, value: unknown): string | null {
  const schema = schemaFor(f);
  if (!schema) return null;
  if (f.type !== "checkbox" && isEmpty(value)) {
    return "required" in f && f.required ? `${f.label} is required` : null;
  }
  const res = schema.safeParse(value);
  return res.success ? null : (res.error.issues[0]?.message ?? `${f.label} is not valid`);
}

export function validateStep(step: Step, values: Values): Errors {
  const errors: Errors = {};
  const { leaves, groups } = stepLeaves(step, values);
  for (const g of groups) {
    const { min = 0, max = Infinity, itemLabel } = g.field;
    if (g.rows.length < min) errors[g.path] = `Add at least ${min} ${itemLabel.toLowerCase()}`;
    if (g.rows.length > max) errors[g.path] = `No more than ${max} ${itemLabel.toLowerCase()}`;
  }
  for (const leaf of leaves) {
    const msg = validateLeaf(leaf.field, leaf.value);
    if (msg) errors[leaf.path] = msg;
  }
  return errors;
}

export type { Field };
