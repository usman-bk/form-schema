import { ApiError } from "../react/FormEngine";

const TAKEN = new Set(["admin", "sam_rao", "taken_name"]);
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export async function checkUsername(value: string, signal: AbortSignal): Promise<string | null> {
  // Shorter names answer slower here, so replies often arrive out of order.
  await wait(Math.max(100, 700 - value.length * 120), signal);
  return TAKEN.has(value) ? "That username is taken" : null;
}

export async function submitQuote(values: Record<string, unknown>): Promise<{ reference: string }> {
  await wait(500);
  const drivers = (values.drivers ?? []) as { licenceYears?: number }[];
  const errors = drivers
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => typeof d.licenceYears === "number" && d.licenceYears < 1)
    .map(({ i }) => ({ field: `drivers[${i}].licence_years`, message: "We need at least one year of licence history" }));
  if (errors.length > 0) throw new ApiError(422, errors);
  return { reference: `Q-${Math.floor(100000 + Math.random() * 899999)}` };
}
