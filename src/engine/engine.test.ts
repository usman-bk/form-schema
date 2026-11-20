import { describe, expect, it } from "vitest";
import {
  applyComputed,
  emptyValues,
  getAt,
  pruneHidden,
  setAt,
  stepLeaves,
  validateStep,
  type FormSchema,
  type Values,
} from "./index";

const schema: FormSchema = {
  id: "t",
  version: 1,
  steps: [
    {
      id: "a",
      title: "A",
      fields: [
        { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "car", label: "Car" }, { value: "van", label: "Van" }] },
        { name: "plate", label: "Plate", type: "text", required: true, showIf: { field: "kind", equals: "van" } },
        { name: "age", label: "Age", type: "number", required: true, min: 18, max: 99, integer: true },
        { name: "terms", label: "Terms", type: "checkbox", required: true },
        {
          name: "drivers", label: "Drivers", type: "group", itemLabel: "Driver", min: 1, max: 2,
          fields: [
            { name: "name", label: "Name", type: "text", required: true },
            { name: "claims", label: "Claims", type: "checkbox" },
            { name: "claimCount", label: "Claim count", type: "number", required: true, min: 1, showIf: { field: "claims", equals: true } },
            { name: "vanOnly", label: "Van note", type: "text", showIf: { field: "/kind", equals: "van" } },
          ],
        },
      ],
    },
  ],
};

describe("paths", () => {
  it("reads and writes nested arrays without mutating", () => {
    const v = { drivers: [{ name: "a" }] };
    const w = setAt(v, "drivers.0.name", "b");
    expect(getAt(w, "drivers.0.name")).toBe("b");
    expect(v.drivers[0]?.name).toBe("a");
  });
});

describe("conditional fields", () => {
  it("only walks fields whose condition holds", () => {
    const v = { ...emptyValues(schema), kind: "car" };
    expect(stepLeaves(schema.steps[0]!, v).leaves.map((l) => l.path)).not.toContain("plate");
    const w = { ...v, kind: "van" };
    expect(stepLeaves(schema.steps[0]!, w).leaves.map((l) => l.path)).toContain("plate");
  });

  it("resolves a slash-prefixed name against the root from inside a row", () => {
    const v = { ...emptyValues(schema), kind: "van" };
    const paths = stepLeaves(schema.steps[0]!, v).leaves.map((l) => l.path);
    expect(paths).toContain("drivers.0.vanOnly");
  });

  it("does not require a hidden field", () => {
    const v: Values = { ...emptyValues(schema), kind: "car", age: 30, terms: true };
    v.drivers = [{ name: "Sam", claims: false, claimCount: "", vanOnly: "" }];
    expect(validateStep(schema.steps[0]!, v)).toEqual({});
  });

  it("drops hidden values from what is sent but keeps them in state", () => {
    const v = { ...emptyValues(schema), kind: "car", plate: "LEB-1" };
    const sent = pruneHidden(schema.steps[0]!.fields, v);
    expect("plate" in sent).toBe(false);
    expect(v.plate).toBe("LEB-1");
  });
});

describe("validation", () => {
  it("reports each rule once, on the right path", () => {
    const v = { ...emptyValues(schema), kind: "car", age: 17, drivers: [{ name: "", claims: true, claimCount: "", vanOnly: "" }] };
    const e = validateStep(schema.steps[0]!, v);
    expect(e.age).toBe("Age must be at least 18");
    expect(e.terms).toBe("Terms must be ticked");
    expect(e["drivers.0.name"]).toBe("Name is required");
    expect(e["drivers.0.claimCount"]).toBe("Claim count is required");
  });

  it("enforces group bounds", () => {
    const v = { ...emptyValues(schema), drivers: [] };
    expect(validateStep(schema.steps[0]!, v).drivers).toBe("Add at least 1 driver");
    const row = { name: "x", claims: false, claimCount: "", vanOnly: "" };
    const w = { ...emptyValues(schema), drivers: [row, row, row] };
    expect(validateStep(schema.steps[0]!, w).drivers).toBe("No more than 2 driver");
  });

  it("rejects a non-integer age", () => {
    const v = { ...emptyValues(schema), age: 30.5 };
    expect(validateStep(schema.steps[0]!, v).age).toBe("Age must be a whole number");
  });
});

describe("computed fields", () => {
  const priced: FormSchema = {
    id: "p",
    version: 1,
    steps: [
      {
        id: "s",
        title: "S",
        fields: [
          { name: "value", label: "Value", type: "number" },
          { name: "cover", label: "Cover", type: "select", options: [{ value: "full", label: "Full" }, { value: "basic", label: "Basic" }] },
          { name: "drivers", label: "Drivers", type: "group", itemLabel: "Driver", fields: [] },
          {
            name: "monthly", label: "Monthly", type: "computed",
            expr: { op: "round", args: [{ op: "mul", args: [
              { op: "add", args: [{ op: "mul", args: [{ ref: "value" }, { value: 0.02 }] }, { op: "mul", args: [{ op: "count", ref: "drivers" }, { value: 10 }] }] },
              { op: "pick", ref: "cover", map: { full: 1.5 }, otherwise: 1 },
            ] }] },
          },
          { name: "yearly", label: "Yearly", type: "computed", expr: { op: "mul", args: [{ ref: "monthly" }, { value: 12 }] } },
        ],
      },
    ],
  };

  it("computes from other fields, a group count and a lookup", () => {
    const v = applyComputed(priced, { value: 10000, cover: "full", drivers: [{}, {}], monthly: null, yearly: null });
    expect(v.monthly).toBe(330);
  });

  it("lets a later computed field read an earlier one", () => {
    const v = applyComputed(priced, { value: 10000, cover: "basic", drivers: [{}], monthly: null, yearly: null });
    expect(v.yearly).toBe(210 * 12);
  });
});
