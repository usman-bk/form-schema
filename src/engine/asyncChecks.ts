export type AsyncValidator = (value: string, signal: AbortSignal) => Promise<string | null>;

export interface CheckState {
  status: "pending" | "valid" | "invalid" | "failed";
  /** The value this state is about. */
  value: string;
  message?: string;
}

export interface AsyncChecks {
  /** False when no validator is registered under `key`, so nothing was started. */
  request(path: string, key: string, value: string): boolean;
  get(path: string): CheckState | undefined;
  clear(path: string): void;
  /** True only when the stored answer is a "valid" for exactly this value. */
  isValidFor(path: string, value: string): boolean;
  /** Drops every state under a prefix and aborts what is in flight there. */
  clearUnder(prefix: string): void;
}

interface Slot {
  state: CheckState;
  controller: AbortController;
}

/**
 * One slot per field. A request owns the slot until a newer request, or a
 * clear, replaces it. An answer is applied only if its own slot is still the
 * current one, so a slow reply for an earlier value cannot overwrite a later
 * value's state, whichever order the network returns them in.
 */
export function createAsyncChecks(
  validators: Record<string, AsyncValidator>,
  onChange: () => void,
): AsyncChecks {
  const slots = new Map<string, Slot>();

  const drop = (path: string) => {
    slots.get(path)?.controller.abort();
    slots.delete(path);
  };

  return {
    request(path, key, value) {
      const validator = validators[key];
      if (!validator) return false;
      drop(path);
      const slot: Slot = { state: { status: "pending", value }, controller: new AbortController() };
      slots.set(path, slot);
      onChange();
      const settle = (state: CheckState) => {
        if (slots.get(path) !== slot) return;
        slot.state = state;
        onChange();
      };
      validator(value, slot.controller.signal).then(
        (message) => settle(message ? { status: "invalid", value, message } : { status: "valid", value }),
        () => settle({ status: "failed", value, message: "Could not check this just now" }),
      );
      return true;
    },
    get: (path) => slots.get(path)?.state,
    clear(path) {
      drop(path);
      onChange();
    },
    isValidFor(path, value) {
      const s = slots.get(path)?.state;
      return s?.status === "valid" && s.value === value;
    },
    clearUnder(prefix) {
      for (const p of [...slots.keys()]) if (p.startsWith(prefix)) drop(p);
      onChange();
    },
  };
}
