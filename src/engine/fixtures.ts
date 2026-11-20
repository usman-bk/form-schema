import type { FormSchema } from "./schema";

export const quoteV2: FormSchema = {
  id: "quote",
  version: 2,
  steps: [
    {
      id: "you",
      title: "About you",
      fields: [
        { name: "fullName", label: "Full name", type: "text", required: true },
        { name: "niNumber", label: "National insurance number", type: "text", sensitive: true },
        { name: "plan", label: "Plan", type: "select", options: [{ value: "basic", label: "Basic" }, { value: "plus", label: "Plus" }] },
      ],
    },
    {
      id: "drivers",
      title: "Drivers",
      fields: [
        {
          name: "drivers", label: "Drivers", type: "group", itemLabel: "Driver", min: 1, max: 3,
          fields: [
            { name: "name", label: "Name", type: "text", required: true },
            { name: "licenceYears", label: "Years licensed", type: "number", min: 0 },
            { name: "claims", label: "Claims", type: "checkbox" },
            { name: "claimNote", label: "Claim note", type: "text", showIf: { field: "claims", equals: true } },
          ],
        },
      ],
    },
  ],
};
