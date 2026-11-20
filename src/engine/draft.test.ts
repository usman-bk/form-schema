import { describe, expect, it } from "vitest";
import { clearDraft, draftKey, loadDraft, saveDraft, type StorageLike } from "./draft";
import { quoteV2 } from "./fixtures";
import { emptyValues } from "./values";
import type { FormSchema, Values } from "./schema";

const mem = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const filled = (): Values => ({
  ...emptyValues(quoteV2),
  fullName: "Sam Rao",
  niNumber: "QQ123456C",
  plan: "plus",
  drivers: [{ name: "Sam", licenceYears: 4, claims: true, claimNote: "2021 windscreen" }],
});

describe("draft round trip", () => {
  it("restores values and the step at the same version", () => {
    const s = mem();
    saveDraft(quoteV2, s, filled(), 1);
    const r = loadDraft(quoteV2, s);
    expect(r).toMatchObject({ outcome: "restored", step: 1 });
    if (r.outcome !== "restored") throw new Error("unreachable");
    expect(r.values.fullName).toBe("Sam Rao");
    expect(r.values.drivers).toEqual(filled().drivers);
  });

  it("never writes a sensitive field to storage", () => {
    const s = mem();
    saveDraft(quoteV2, s, filled(), 0);
    expect(s.data.get(draftKey(quoteV2))).not.toContain("QQ123456C");
  });

  it("reports nothing when there is no draft", () => {
    expect(loadDraft(quoteV2, mem())).toEqual({ outcome: "none" });
  });

  it("survives storage that throws", () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(saveDraft(quoteV2, broken, filled(), 0)).toBe(false);
    expect(loadDraft(quoteV2, broken)).toEqual({ outcome: "none" });
    expect(() => clearDraft(quoteV2, broken)).not.toThrow();
  });
});

describe("draft after the schema changed", () => {
  const v1Draft = (extra: Partial<Values> = {}) =>
    JSON.stringify({
      format: 1,
      schemaVersion: 1,
      step: 1,
      savedAt: "2026-11-20T10:00:00Z",
      values: { fullName: "Sam Rao", plan: "gold", driverName: "Sam", ...extra },
    });

  it("discards a draft from an older version when no migration is given", () => {
    const s = mem();
    s.setItem(draftKey(quoteV2), v1Draft());
    const r = loadDraft(quoteV2, s);
    expect(r).toEqual({ outcome: "discarded", reason: "no migration from version 1" });
    // Reading is free of side effects, so a second read says the same thing.
    expect(loadDraft(quoteV2, s)).toEqual(r);
  });

  it("migrates, then drops what the new schema does not know and blanks a removed option", () => {
    const s = mem();
    s.setItem(draftKey(quoteV2), v1Draft());
    const r = loadDraft(quoteV2, s, {
      1: (v) => ({ ...v, drivers: [{ name: v.driverName, licenceYears: "", claims: false, claimNote: "" }] }),
    });
    expect(r.outcome).toBe("migrated");
    if (r.outcome !== "migrated") throw new Error("unreachable");
    expect(r.values.fullName).toBe("Sam Rao");
    expect(r.values.plan).toBe(""); // "gold" is no longer an option
    expect("driverName" in r.values).toBe(false);
    expect(r.values.drivers).toEqual([{ name: "Sam", licenceYears: "", claims: false, claimNote: "" }]);
  });

  it("discards when a migration throws", () => {
    const s = mem();
    s.setItem(draftKey(quoteV2), v1Draft());
    const r = loadDraft(quoteV2, s, { 1: () => { throw new Error("boom"); } });
    expect(r.outcome).toBe("discarded");
  });

  it("discards a draft written by a newer version of the form", () => {
    const s = mem();
    s.setItem(draftKey(quoteV2), JSON.stringify({ format: 1, schemaVersion: 3, step: 0, values: {}, savedAt: "x" }));
    expect(loadDraft(quoteV2, s)).toMatchObject({ outcome: "discarded" });
  });

  it("chains migrations across more than one version", () => {
    const v4: FormSchema = { ...quoteV2, version: 4 };
    const s = mem();
    s.setItem(draftKey(v4), v1Draft());
    const seen: number[] = [];
    const r = loadDraft(v4, s, {
      1: (v) => (seen.push(1), v),
      2: (v) => (seen.push(2), v),
      3: (v) => (seen.push(3), v),
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(r.outcome).toBe("migrated");
  });

  it("discards corrupt JSON and unknown envelopes", () => {
    const s = mem();
    s.setItem(draftKey(quoteV2), "{not json");
    expect(loadDraft(quoteV2, s)).toMatchObject({ outcome: "discarded" });
    s.setItem(draftKey(quoteV2), JSON.stringify({ hello: "world" }));
    expect(loadDraft(quoteV2, s)).toMatchObject({ outcome: "discarded", reason: "unknown draft format" });
  });

  it("repairs wrong types at the current version and clamps the step", () => {
    const s = mem();
    s.setItem(draftKey(quoteV2), JSON.stringify({
      format: 1, schemaVersion: 2, step: 99, savedAt: "x",
      values: { fullName: 42, plan: "plus", drivers: [{ name: "A", licenceYears: "many", claims: "yes" }], niNumber: "leak" },
    }));
    const r = loadDraft(quoteV2, s);
    if (r.outcome !== "restored") throw new Error("expected restored");
    expect(r.step).toBe(1);
    expect(r.values.fullName).toBe("");
    expect(r.values.niNumber).toBe("");
    expect(r.values.drivers).toEqual([{ name: "A", licenceYears: "", claims: false, claimNote: "" }]);
  });

  it("does not restore more rows than the group allows", () => {
    const s = mem();
    const row = { name: "A", licenceYears: 1, claims: false, claimNote: "" };
    s.setItem(draftKey(quoteV2), JSON.stringify({ format: 1, schemaVersion: 2, step: 0, savedAt: "x", values: { drivers: [row, row, row, row, row] } }));
    const r = loadDraft(quoteV2, s);
    if (r.outcome !== "restored") throw new Error("expected restored");
    expect((r.values.drivers as unknown[]).length).toBe(3);
  });
});
