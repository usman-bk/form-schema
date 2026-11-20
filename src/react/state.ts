import {
  applyComputed,
  emptyRow,
  getAt,
  setAt,
  type Errors,
  type FormSchema,
  type GroupField,
  type Values,
} from "../engine";

export interface FocusRequest {
  n: number;
  /** A field path, "heading" or "formError". */
  target: string | null;
}

export interface Announcement {
  n: number;
  text: string;
}

export interface State {
  values: Values;
  step: number;
  errors: Errors;
  formErrors: string[];
  submitting: boolean;
  done: unknown;
  notice: string | null;
  focus: FocusRequest;
  announcement: Announcement;
}

export type Action =
  | { type: "change"; schema: FormSchema; path: string; value: unknown }
  | { type: "addRow"; schema: FormSchema; path: string; group: GroupField }
  | { type: "removeRow"; schema: FormSchema; path: string; index: number; group: GroupField }
  | { type: "go"; step: number; text: string }
  | { type: "invalid"; step: number; errors: Errors; formErrors: string[]; focus: string | null; text: string }
  | { type: "submitting"; on: boolean }
  | { type: "failed"; formErrors: string[]; text: string }
  | { type: "done"; result: unknown }
  | { type: "announce"; text: string };

export function init(
  schema: FormSchema,
  values: Values,
  step: number,
  notice: string | null,
): State {
  return {
    values: applyComputed(schema, values),
    step,
    errors: {},
    formErrors: [],
    submitting: false,
    done: null,
    notice,
    focus: { n: 0, target: null },
    announcement: { n: 0, text: notice ?? "" },
  };
}

const say = (s: State, text: string): Announcement => ({ n: s.announcement.n + 1, text });
const focus = (s: State, target: string | null): FocusRequest => ({ n: s.focus.n + 1, target });

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "change": {
      const values = applyComputed(a.schema, setAt(s.values, a.path, a.value));
      const errors = { ...s.errors };
      delete errors[a.path];
      return { ...s, values, errors };
    }
    case "addRow": {
      const rows = (getAt(s.values, a.path) ?? []) as Values[];
      if (rows.length >= (a.group.max ?? Infinity)) {
        return { ...s, announcement: say(s, `At most ${a.group.max} ${a.group.itemLabel.toLowerCase()}`) };
      }
      const values = applyComputed(a.schema, setAt(s.values, a.path, [...rows, emptyRow(a.group.fields)]));
      const errors = { ...s.errors };
      delete errors[a.path];
      const first = a.group.fields.find((f) => f.type !== "group" && f.type !== "computed");
      return {
        ...s,
        values,
        errors,
        focus: focus(s, first ? `${a.path}.${rows.length}.${first.name}` : null),
        announcement: say(s, `${a.group.itemLabel} ${rows.length + 1} added`),
      };
    }
    case "removeRow": {
      const rows = (getAt(s.values, a.path) ?? []) as Values[];
      const next = rows.filter((_, i) => i !== a.index);
      const values = applyComputed(a.schema, setAt(s.values, a.path, next));
      return {
        ...s,
        values,
        focus: focus(s, a.path),
        announcement: say(s, `${a.group.itemLabel} ${a.index + 1} removed. ${next.length} left`),
      };
    }
    case "go":
      return { ...s, step: a.step, formErrors: [], focus: focus(s, "heading"), announcement: say(s, a.text) };
    case "invalid":
      return {
        ...s,
        step: a.step,
        errors: a.errors,
        formErrors: a.formErrors,
        submitting: false,
        focus: focus(s, a.focus),
        announcement: say(s, a.text),
      };
    case "submitting":
      return { ...s, submitting: a.on, formErrors: a.on ? [] : s.formErrors };
    case "failed":
      return {
        ...s,
        submitting: false,
        formErrors: a.formErrors,
        focus: focus(s, "formError"),
        announcement: say(s, a.text),
      };
    case "done":
      return { ...s, submitting: false, done: a.result ?? true, focus: focus(s, "heading"), announcement: say(s, "Quote submitted") };
    case "announce":
      return { ...s, announcement: say(s, a.text) };
  }
}
