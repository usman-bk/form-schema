import { describe, expect, it, vi } from "vitest";
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

  it("a slow answer for an older value must not mark the newer value valid", async () => {
    const { calls, validator } = controlled();
    const onChange = vi.fn();
    const checks = createAsyncChecks({ username: validator }, onChange);

    checks.request("username", "username", "sam");      // call 0, slow
    checks.request("username", "username", "samuel");   // call 1, fast
    calls[1]!.resolve("That username is taken");
    await tick();
    expect(checks.get("username")).toEqual({ status: "invalid", value: "samuel", message: "That username is taken" });

    calls[0]!.resolve(null);                             // the old answer lands last
    await tick();
    expect(checks.get("username")).toEqual({ status: "invalid", value: "samuel", message: "That username is taken" });
  });

  it("a slow answer for an older value does not clear the pending state of the newer one", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "sam");
    checks.request("username", "username", "samuel");
    calls[0]!.resolve(null);
    await tick();
    expect(checks.get("username")).toEqual({ status: "pending", value: "samuel" });
  });

  it("an answer arriving after the field was cleared is dropped", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "sam");
    checks.clear("username");
    calls[0]!.resolve(null);
    await tick();
    expect(checks.get("username")).toBeUndefined();
  });

  it("reports a failed lookup as failed, not valid", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "sam");
    calls[0]!.reject(new Error("503"));
    await tick();
    expect(checks.get("username")?.status).toBe("failed");
  });

  it("an old failure does not replace a newer pending check", async () => {
    const { calls, validator } = controlled();
    const checks = createAsyncChecks({ username: validator }, () => {});
    checks.request("username", "username", "sam");
    checks.request("username", "username", "samuel");
    calls[0]!.reject(new Error("503"));
    await tick();
    expect(checks.get("username")?.status).toBe("pending");
  });
});
