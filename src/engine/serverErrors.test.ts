import { describe, expect, it } from "vitest";
import { firstStepWithError, mapServerErrors, resolveServerPath, splitPath } from "./serverErrors";
import { quoteV2 } from "./fixtures";
import type { Values } from "./schema";

const row = (extra: Values = {}) => ({ name: "A", licenceYears: 1, claims: false, claimNote: "", ...extra });
const values = (rows: Values[] = [row(), row({ claims: true })]): Values => ({ fullName: "x", niNumber: "", plan: "basic", drivers: rows });

describe("server error paths", () => {
  it("splits bracket, dot and pointer notation the same way", () => {
    expect(splitPath("drivers[1].licence_years")).toEqual(["drivers", "1", "licence_years"]);
    expect(splitPath("/drivers/1/licenceYears")).toEqual(["drivers", "1", "licenceYears"]);
    expect(splitPath("$.drivers.1.name")).toEqual(["drivers", "1", "name"]);
  });

  it("maps snake_case, camelCase and pointer paths onto the same input", () => {
    for (const raw of ["drivers[1].licence_years", "drivers.1.licenceYears", "/drivers/1/licence-years"]) {
      expect(resolveServerPath(quoteV2, values(), raw)).toBe("drivers.1.licenceYears");
    }
  });

  it("maps a top-level field and a whole-group message", () => {
    expect(resolveServerPath(quoteV2, values(), "full_name")).toBe("fullName");
    expect(resolveServerPath(quoteV2, values(), "drivers")).toBe("drivers");
  });

  it("refuses a row that does not exist, a field that does not exist and a bare row", () => {
    expect(resolveServerPath(quoteV2, values(), "drivers[5].name")).toBeNull();
    expect(resolveServerPath(quoteV2, values(), "drivers[0].shoeSize")).toBeNull();
    expect(resolveServerPath(quoteV2, values(), "drivers[0]")).toBeNull();
    expect(resolveServerPath(quoteV2, values(), "fullName.first")).toBeNull();
  });

  it("refuses a field that is hidden right now, since there is no input to show it on", () => {
    expect(resolveServerPath(quoteV2, values(), "drivers[0].claimNote")).toBeNull();
    expect(resolveServerPath(quoteV2, values(), "drivers[1].claimNote")).toBe("drivers.1.claimNote");
  });

  it("keeps what could not be placed, with the path the server used", () => {
    const m = mapServerErrors(quoteV2, values(), [
      { field: "drivers[1].licence_years", message: "Must be 17 or over" },
      { field: "drivers[0].claimNote", message: "Too long" },
      { field: "", message: "Quote service is down" },
    ]);
    expect(m.byPath).toEqual({ "drivers.1.licenceYears": "Must be 17 or over" });
    expect(m.unmapped).toEqual(["drivers[0].claimNote: Too long", "Quote service is down"]);
  });

  it("joins two messages for one input", () => {
    const m = mapServerErrors(quoteV2, values(), [
      { field: "fullName", message: "Too short." },
      { field: "full_name", message: "No digits." },
    ]);
    expect(m.byPath.fullName).toBe("Too short. No digits.");
  });

  it("finds the first step that holds an error", () => {
    expect(firstStepWithError(quoteV2, ["drivers.1.name", "fullName"])).toBe(0);
    expect(firstStepWithError(quoteV2, ["drivers.1.name"])).toBe(1);
    expect(firstStepWithError(quoteV2, [])).toBe(-1);
  });
});
