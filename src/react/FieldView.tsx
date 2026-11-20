import type { ReactNode } from "react";
import { fieldId, type CheckState, type Field, type Values } from "../engine";

type Leaf = Exclude<Field, { type: "group" }>;

interface Props {
  field: Leaf;
  path: string;
  value: unknown;
  error: string | undefined;
  check: CheckState | undefined;
  onChange: (path: string, value: unknown) => void;
}

export function formatComputed(field: Extract<Field, { type: "computed" }>, value: unknown) {
  if (typeof value !== "number") return "Not available yet";
  return field.format === "currency"
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value)
    : String(value);
}

export function FieldView({ field, path, value, error, check, onChange }: Props) {
  const id = fieldId(path);
  const errId = `${id}-err`;
  const statusId = `${id}-status`;
  const describedBy = [error ? errId : null, check ? statusId : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": "required" in field && field.required ? true : undefined,
  } as const;

  let control: ReactNode;
  switch (field.type) {
    case "checkbox":
      control = (
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(path, e.target.checked)}
        />
      );
      break;
    case "select":
      control = (
        <select {...common} value={String(value ?? "")} onChange={(e) => onChange(path, e.target.value)}>
          <option value="">Choose</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "number":
      control = (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(path, e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
      break;
    case "computed":
      return (
        <div className="field">
          <span id={`${id}-label`}>{field.label}</span>
          <output id={id} aria-labelledby={`${id}-label`}>
            {formatComputed(field, value)}
          </output>
        </div>
      );
    default:
      control = (
        <input
          {...common}
          type={field.type === "email" ? "email" : "text"}
          autoComplete="off"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(path, e.target.value)}
        />
      );
  }

  return (
    <div className={`field field-${field.type}`}>
      <label htmlFor={id}>{field.label}</label>
      {control}
      {check && (
        <p id={statusId} className={`status status-${check.status}`}>
          {check.status === "pending" && `Checking ${field.label.toLowerCase()}`}
          {check.status === "valid" && `${field.label} is available`}
          {check.status === "failed" && check.message}
        </p>
      )}
      {error && (
        <p id={errId} className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export type { Values };
