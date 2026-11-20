import { describe, expect, it } from "vitest";
import { shiftRowErrors } from "./state";

describe("shiftRowErrors", () => {
  const errors = {
    fullName: "kept",
    drivers: "group level, kept",
    "drivers.0.name": "row 0",
    "drivers.1.name": "row 1",
    "drivers.2.licenceYears": "row 2",
    "other.2.name": "different group, kept",
  };

  it("drops the removed row and moves later rows down", () => {
    expect(shiftRowErrors(errors, "drivers", 1)).toEqual({
      fullName: "kept",
      drivers: "group level, kept",
      "drivers.0.name": "row 0",
      "drivers.1.licenceYears": "row 2",
      "other.2.name": "different group, kept",
    });
  });

  it("leaves earlier rows alone when the last row goes", () => {
    const out = shiftRowErrors(errors, "drivers", 2);
    expect(out["drivers.0.name"]).toBe("row 0");
    expect(out["drivers.1.name"]).toBe("row 1");
    expect(Object.keys(out).some((k) => k.startsWith("drivers.2"))).toBe(false);
  });

  it("does not confuse drivers with a group whose name starts the same way", () => {
    expect(shiftRowErrors({ "driversExtra.1.x": "kept" }, "drivers", 0)).toEqual({ "driversExtra.1.x": "kept" });
  });
});
