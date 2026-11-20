export type Condition =
  | { field: string; equals: unknown }
  | { field: string; notEquals: unknown }
  | { field: string; in: unknown[] }
  | { field: string; gt: number }
  | { field: string; lt: number }
  | { field: string; filled: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type Expr =
  | { value: number }
  | { ref: string }
  | { op: "add" | "sub" | "mul" | "div" | "min" | "max"; args: Expr[] }
  | { op: "round"; args: [Expr] }
  | { op: "count"; ref: string }
  | { op: "pick"; ref: string; map: Record<string, number>; otherwise: number };

interface Base {
  name: string;
  label: string;
  showIf?: Condition;
  /** Never written to the autosaved draft. */
  sensitive?: boolean;
}

export interface TextField extends Base {
  type: "text" | "email";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: { source: string; message: string };
  /** Key into the async validators handed to the engine. */
  asyncCheck?: string;
}

export interface NumberField extends Base {
  type: "number";
  required?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface SelectField extends Base {
  type: "select";
  required?: boolean;
  options: { value: string; label: string }[];
}

export interface CheckboxField extends Base {
  type: "checkbox";
  /** Must be ticked, as for terms and conditions. */
  required?: boolean;
}

export interface ComputedField extends Base {
  type: "computed";
  expr: Expr;
  format?: "currency" | "number";
}

export interface GroupField extends Base {
  type: "group";
  itemLabel: string;
  min?: number;
  max?: number;
  fields: Field[];
}

export type Field =
  | TextField
  | NumberField
  | SelectField
  | CheckboxField
  | ComputedField
  | GroupField;

export interface Step {
  id: string;
  title: string;
  fields: Field[];
}

export interface FormSchema {
  id: string;
  /** Bump on any change that makes an old draft unsafe to load as is. */
  version: number;
  steps: Step[];
}

export type Values = Record<string, unknown>;
