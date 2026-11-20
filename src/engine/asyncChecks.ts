export type AsyncValidator = (value: string) => Promise<string | null>;

export interface CheckState {
  status: "pending" | "valid" | "invalid" | "failed";
  /** The value this state is about. */
  value: string;
  message?: string;
}

export interface AsyncChecks {
  request(path: string, key: string, value: string): void;
  get(path: string): CheckState | undefined;
  clear(path: string): void;
}

export function createAsyncChecks(
  validators: Record<string, AsyncValidator>,
  onChange: () => void,
): AsyncChecks {
  const states = new Map<string, CheckState>();
  const set = (path: string, s: CheckState) => {
    states.set(path, s);
    onChange();
  };
  return {
    request(path, key, value) {
      const validator = validators[key];
      if (!validator) return;
      set(path, { status: "pending", value });
      validator(value).then(
        (message) =>
          set(path, message ? { status: "invalid", value, message } : { status: "valid", value }),
        () => set(path, { status: "failed", value, message: "Could not check this just now" }),
      );
    },
    get: (path) => states.get(path),
    clear(path) {
      states.delete(path);
      onChange();
    },
  };
}
