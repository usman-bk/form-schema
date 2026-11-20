import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  clearDraft,
  createAsyncChecks,
  defaultStorage,
  fieldId,
  firstStepWithError,
  isVisible,
  loadDraft,
  mapServerErrors,
  pruneHidden,
  saveDraft,
  stepLeaves,
  validateLeaf,
  validateStep,
  type AsyncChecks,
  type AsyncValidator,
  type Errors,
  type Field,
  type FormSchema,
  type GroupField,
  type Migrations,
  type ServerFieldError,
  type StorageLike,
  type Values,
} from "../engine";
import { emptyValues } from "../engine";
import { FieldView } from "./FieldView";
import { init, reducer } from "./state";

/** What an onSubmit rejects with when the API answers 4xx with field errors. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public errors: ServerFieldError[],
    message = "The server rejected the form",
  ) {
    super(message);
  }
}

export interface FormEngineProps {
  schema: FormSchema;
  onSubmit: (values: Values) => Promise<unknown>;
  asyncValidators?: Record<string, AsyncValidator>;
  storage?: StorageLike | null;
  migrations?: Migrations;
  onSubmitted?: (result: unknown) => void;
  submitLabel?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function FormEngine(props: FormEngineProps) {
  const { schema, onSubmit, onSubmitted, submitLabel = "Submit" } = props;
  const storage = useMemo(
    () => (props.storage === undefined ? defaultStorage() : props.storage),
    [props.storage],
  );

  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const draft = loadDraft(schema, storage, props.migrations);
    if (draft.outcome === "restored") return init(schema, draft.values, draft.step, "Draft restored. Carry on where you left off.");
    if (draft.outcome === "migrated") return init(schema, draft.values, draft.step, "Draft restored and updated to the latest form.");
    const notice = draft.outcome === "discarded" ? "An earlier draft no longer fits this form and was cleared." : null;
    return init(schema, emptyValues(schema), 0, notice);
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const validatorsRef = useRef(props.asyncValidators ?? {});
  validatorsRef.current = props.asyncValidators ?? {};
  const [, setTick] = useState(0);
  const checks: AsyncChecks = useMemo(
    () =>
      createAsyncChecks(
        new Proxy({} as Record<string, AsyncValidator>, { get: (_t, key) => validatorsRef.current[key as string] }),
        () => setTick((t) => t + 1),
      ),
    [],
  );

  const step = schema.steps[state.step] as FormSchema["steps"][number];
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  // Autosave after every change, once the form has been put on screen.
  const saveFailed = useRef(false);
  useEffect(() => {
    if (state.done !== null) return;
    const ok = saveDraft(schema, storage, state.values, state.step);
    if (!ok && storage && !saveFailed.current) {
      saveFailed.current = true;
      dispatch({ type: "announce", text: "This draft could not be saved on this device" });
    }
  }, [schema, storage, state.values, state.step, state.done]);

  // Move focus where the last action said it should go.
  useEffect(() => {
    const target = state.focus.target;
    if (state.focus.n === 0 || target === null) return;
    let el: HTMLElement | null;
    if (target === "heading") el = headingRef.current;
    else if (target === "formError") el = formErrorRef.current;
    else if (target === "firstInvalid") el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null;
    else el = document.getElementById(fieldId(target)) ?? document.getElementById(`${fieldId(target)}-add`);
    el?.focus();
  }, [state.focus]);

  // Say when a background check settles, once per answer.
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const leaf of stepLeaves(step, state.values).leaves) {
      const c = checks.get(leaf.path);
      if (!c) continue;
      const sig = `${c.status}:${c.value}`;
      if (seen.current.get(leaf.path) === sig) continue;
      seen.current.set(leaf.path, sig);
      if (c.status === "valid") dispatch({ type: "announce", text: `${leaf.field.label} is available` });
      if (c.status === "invalid" || c.status === "failed") dispatch({ type: "announce", text: c.message ?? "" });
    }
  });

  const onChange = useCallback(
    (path: string, value: unknown, field: Field) => {
      dispatch({ type: "change", schema, path, value });
      if (field.type === "text" && field.asyncCheck) {
        const text = typeof value === "string" ? value.trim() : "";
        if (text !== "" && validateLeaf(field, value) === null) checks.request(path, field.asyncCheck, text);
        else checks.clear(path);
      }
    },
    [schema, checks],
  );

  /** Local rules plus the background checks, for one step of the current values. */
  const stepErrors = useCallback(
    (index: number, values: Values): Errors => {
      const s = schema.steps[index] as FormSchema["steps"][number];
      const errors = validateStep(s, values);
      for (const { path, field, value } of stepLeaves(s, values).leaves) {
        if (field.type !== "text" || !field.asyncCheck || errors[path]) continue;
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") continue;
        const c = checks.get(path);
        const current = c && c.value === text ? c : undefined;
        if (current?.status === "valid") continue;
        if (current?.status === "invalid") errors[path] = current.message ?? `${field.label} is not available`;
        else if (current?.status === "pending") errors[path] = `Still checking ${field.label.toLowerCase()}`;
        else if (checks.request(path, field.asyncCheck, text)) {
          errors[path] =
            current?.status === "failed"
              ? `Could not check ${field.label.toLowerCase()}, trying again. Press once more`
              : `Checking ${field.label.toLowerCase()}, press again in a moment`;
        }
      }
      return errors;
    },
    [schema, checks],
  );

  const summary = (errors: Errors, prefix: string) => {
    const msgs = Object.values(errors);
    return `${prefix}${plural(msgs.length, "error")}: ${msgs[0] ?? ""}`;
  };

  const submit = async () => {
    const values = stateRef.current.values;
    const all: Errors = {};
    const perStep = schema.steps.map((_, i) => stepErrors(i, values));
    perStep.forEach((e) => Object.assign(all, e));
    const firstBad = perStep.findIndex((e) => Object.keys(e).length > 0);
    if (firstBad >= 0) {
      const there = perStep[firstBad] as Errors;
      dispatch({
        type: "invalid",
        step: firstBad,
        errors: all,
        formErrors: [],
        focus: "firstInvalid",
        text: summary(there, `Step ${firstBad + 1} has `),
      });
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "submitting", on: true });
    try {
      const result = await onSubmit(pruneHidden(schema.steps.flatMap((s) => s.fields), values));
      clearDraft(schema, storage);
      dispatch({ type: "done", result });
      onSubmitted?.(result);
    } catch (e) {
      if (e instanceof ApiError && e.errors.length > 0) {
        const mapped = mapServerErrors(schema, values, e.errors);
        const paths = Object.keys(mapped.byPath);
        const at = firstStepWithError(schema, paths);
        const target = at >= 0 ? at : stateRef.current.step;
        dispatch({
          type: "invalid",
          step: target,
          errors: { ...stateRef.current.errors, ...mapped.byPath },
          formErrors: mapped.unmapped,
          focus: paths.length > 0 ? "firstInvalid" : "formError",
          text: paths.length > 0 ? `The server found ${plural(paths.length, "problem")} on step ${target + 1}` : "",
        });
      } else {
        dispatch({
          type: "failed",
          formErrors: [e instanceof ApiError ? e.message : "Could not send the form. Check your connection and try again."],
          text: "",
        });
      }
    } finally {
      inFlight.current = false;
    }
  };

  const next = () => {
    const errors = stepErrors(state.step, state.values);
    if (Object.keys(errors).length > 0) {
      dispatch({
        type: "invalid",
        step: state.step,
        errors: { ...state.errors, ...errors },
        formErrors: [],
        focus: "firstInvalid",
        text: summary(errors, ""),
      });
      return;
    }
    if (state.step === schema.steps.length - 1) {
      void submit();
      return;
    }
    const to = state.step + 1;
    dispatch({ type: "go", step: to, text: `Step ${to + 1} of ${schema.steps.length}: ${schema.steps[to]?.title}` });
  };

  const back = () => {
    const to = state.step - 1;
    if (to < 0) return;
    dispatch({ type: "go", step: to, text: `Step ${to + 1} of ${schema.steps.length}: ${schema.steps[to]?.title}` });
  };

  const renderFields = (fields: Field[], row: Values, base: string): React.ReactNode[] =>
    fields
      .filter((f) => isVisible(f, row, state.values))
      .map((f) => {
        const path = base + f.name;
        if (f.type === "group") return renderGroup(f, path, row);
        const c = checks.get(path);
        const error = state.errors[path] ?? (c?.status === "invalid" ? c.message : undefined);
        return (
          <FieldView
            key={path}
            field={f}
            path={path}
            value={row[f.name]}
            error={error}
            check={c && c.status !== "invalid" ? c : undefined}
            onChange={(p, v) => onChange(p, v, f)}
          />
        );
      });

  const renderGroup = (g: GroupField, path: string, row: Values) => {
    const rows = (Array.isArray(row[g.name]) ? row[g.name] : []) as Values[];
    const err = state.errors[path];
    const atMax = rows.length >= (g.max ?? Infinity);
    return (
      <fieldset key={path} className="group">
        <legend>{g.label}</legend>
        {rows.map((r, i) => (
          <fieldset key={`${path}.${i}`} className="row">
            <legend>{`${g.itemLabel} ${i + 1}`}</legend>
            {renderFields(g.fields, r, `${path}.${i}.`)}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                checks.clearUnder(`${path}.`);
                dispatch({ type: "removeRow", schema, path, index: i, group: g });
              }}
            >
              {`Remove ${g.itemLabel.toLowerCase()} ${i + 1}`}
            </button>
          </fieldset>
        ))}
        {err && (
          <p id={`${fieldId(path)}-err`} className="error">
            {err}
          </p>
        )}
        <button
          type="button"
          id={`${fieldId(path)}-add`}
          className="secondary"
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${fieldId(path)}-err` : undefined}
          disabled={atMax}
          onClick={() => dispatch({ type: "addRow", schema, path, group: g })}
        >
          {`Add ${g.itemLabel.toLowerCase()}`}
        </button>
      </fieldset>
    );
  };

  const last = state.step === schema.steps.length - 1;

  return (
    <form
      ref={formRef}
      noValidate
      className="form-engine"
      onSubmit={(e) => {
        e.preventDefault();
        if (state.done === null) next();
      }}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live">
        <span key={state.announcement.n}>{state.announcement.text}</span>
      </div>

      {state.done !== null ? (
        <section>
          <h2 ref={headingRef} tabIndex={-1}>
            Quote submitted
          </h2>
          {typeof state.done === "object" && state.done !== null && "reference" in state.done && (
            <p>Reference {String((state.done as { reference: unknown }).reference)}</p>
          )}
        </section>
      ) : (
        <>
          {state.notice && <p className="notice">{state.notice}</p>}
          <ol className="steps" aria-label="Progress">
            {schema.steps.map((s, i) => (
              <li key={s.id} aria-current={i === state.step ? "step" : undefined}>
                {s.title}
              </li>
            ))}
          </ol>
          <h2 ref={headingRef} tabIndex={-1}>
            {`Step ${state.step + 1} of ${schema.steps.length}: ${step.title}`}
          </h2>
          {state.formErrors.length > 0 && (
            <div ref={formErrorRef} role="alert" tabIndex={-1} className="form-error">
              {state.formErrors.map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          )}
          {renderFields(step.fields, state.values, "")}
          <div className="actions">
            <button type="button" className="secondary" onClick={back} disabled={state.step === 0}>
              Back
            </button>
            <button type="submit" aria-disabled={state.submitting || undefined} className="primary">
              {last ? (state.submitting ? "Sending" : submitLabel) : "Next"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
