import type { FormSchema } from "../engine";

/** Bump `version` when a change would make a saved draft unsafe to load. */
export const quoteSchema: FormSchema = {
  id: "motor-quote",
  version: 2,
  steps: [
    {
      id: "you",
      title: "About you",
      fields: [
        { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 80 },
        { name: "email", label: "Email", type: "email", required: true },
        {
          name: "username",
          label: "Username",
          type: "text",
          required: true,
          minLength: 3,
          pattern: { source: "^[a-z0-9_]+$", message: "Username may use lower case letters, digits and underscores" },
          asyncCheck: "username",
        },
        { name: "age", label: "Age", type: "number", required: true, min: 18, max: 99, integer: true },
        { name: "niNumber", label: "National insurance number", type: "text", sensitive: true },
      ],
    },
    {
      id: "vehicle",
      title: "Vehicle",
      fields: [
        {
          name: "vehicleType",
          label: "Vehicle type",
          type: "select",
          required: true,
          options: [
            { value: "car", label: "Car" },
            { value: "van", label: "Van" },
            { value: "motorbike", label: "Motorbike" },
          ],
        },
        { name: "vehicleValue", label: "Vehicle value", type: "number", required: true, min: 500, max: 200000 },
        { name: "businessUse", label: "Used for business", type: "checkbox", showIf: { field: "vehicleType", equals: "van" } },
        { name: "hasMods", label: "Modified from standard", type: "checkbox" },
        { name: "mods", label: "Describe the modifications", type: "text", required: true, showIf: { field: "hasMods", equals: true } },
      ],
    },
    {
      id: "drivers",
      title: "Drivers",
      fields: [
        {
          name: "drivers",
          label: "Drivers",
          type: "group",
          itemLabel: "Driver",
          min: 1,
          max: 4,
          fields: [
            { name: "name", label: "Driver name", type: "text", required: true },
            { name: "licenceYears", label: "Years licensed", type: "number", required: true, min: 0, max: 80, integer: true },
            { name: "hasClaims", label: "Claims in the last 5 years", type: "checkbox" },
            { name: "claimCount", label: "Number of claims", type: "number", required: true, min: 1, max: 20, integer: true, showIf: { field: "hasClaims", equals: true } },
          ],
        },
      ],
    },
    {
      id: "cover",
      title: "Cover",
      fields: [
        {
          name: "cover",
          label: "Cover level",
          type: "select",
          required: true,
          options: [
            { value: "third_party", label: "Third party" },
            { value: "comprehensive", label: "Comprehensive" },
          ],
        },
        { name: "terms", label: "I accept the terms", type: "checkbox", required: true },
        {
          name: "monthly",
          label: "Monthly price",
          type: "computed",
          format: "currency",
          expr: {
            op: "round",
            args: [
              {
                op: "mul",
                args: [
                  {
                    op: "add",
                    args: [
                      { op: "mul", args: [{ ref: "vehicleValue" }, { value: 0.0025 }] },
                      { op: "mul", args: [{ op: "count", ref: "drivers" }, { value: 14 }] },
                      { op: "max", args: [{ op: "sub", args: [{ value: 40 }, { ref: "age" }] }, { value: 0 }] },
                    ],
                  },
                  { op: "pick", ref: "cover", map: { comprehensive: 1.35 }, otherwise: 1 },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

/** What a version 1 draft held: one driver as flat fields. */
export const quoteMigrations = {
  1: (v: Record<string, unknown>) => ({
    ...v,
    drivers: [
      {
        name: v.driverName ?? "",
        licenceYears: v.licenceYears ?? "",
        hasClaims: false,
        claimCount: "",
      },
    ],
  }),
};
