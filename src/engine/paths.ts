import type { Values } from "./schema";

export function getAt(source: unknown, path: string): unknown {
  if (path === "") return source;
  let cur: unknown = source;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Returns a copy of `source` with the value at `path` replaced. */
export function setAt<T>(source: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const write = (node: unknown, i: number): unknown => {
    const key = parts[i] as string;
    const isArray = Array.isArray(node);
    const copy: unknown = isArray
      ? [...(node as unknown[])]
      : { ...((node ?? {}) as Values) };
    const slot = isArray ? Number(key) : key;
    const bag = copy as Record<string | number, unknown>;
    bag[slot] = i === parts.length - 1 ? value : write(bag[slot], i + 1);
    return copy;
  };
  return write(source, 0) as T;
}

export const fieldId = (path: string) => `f-${path.replace(/\./g, "-")}`;
