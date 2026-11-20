import { describe, expect, it } from "vitest";
import { createAsyncChecks } from "./asyncChecks";

function controlled() {
  const calls: { value: string; resolve: (m: string | null) => void; reject: (e: Error) => void }[] = [];
  const validator = (value: string) =>
    new Promise<string | null>((resolve, reject) => calls.push({ value, resolve, reject }));
  return { calls, validator };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("async checks", () => {
  it("is pending until the validator answers, then valid", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "sam");
    expect(checks.get("username")?.status).toBe("pending");
    calls[0]!.resolve(null);
    await tick();
    expect(checks.get("username")).toEqual({ status: "valid", value: "sam" });
  });

  it("keeps the message when the name is taken", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "admin");
    calls[0]!.resolve("That username is taken");
    await tick();
    expect(checks.get("username")).toEqual({ status: "invalid", value: "admin", message: "That username is taken" });
  });

  it("reports a failed lookup as failed, not valid", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "sam");
    calls[0]!.reject(new Error("503"));
    await tick();
    expect(checks.get("username")?.status).toBe("failed");
  });
});
