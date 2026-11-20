# form-schema

_Built with AI assistance._

A multi-step form driven by a JSON schema: conditional fields, repeatable
groups, computed fields, a username check that runs in the background, a draft
that survives a reload, and API errors that land on the right input. The demo
is a four-step motor insurance quote.

React 18, TypeScript strict, Zod 4 for the per-field rules, Vite, Vitest and
Testing Library. 72 tests (M), about 4.5 s for the whole run (M). The demo
bundle is 236 kB, 74 kB gzipped (M).

```
src/engine/   no React: schema types, conditions, validation, computed fields,
              async checks, draft storage, server error mapping
src/react/    FormEngine (focus, live region, steps) and the reducer behind it
src/demo/     the quote schema, a fake API with out-of-order replies, styles
```

    npm ci && npm test      # 72 tests
    npm run dev             # the demo

## What a schema looks like

A step holds fields. A field can carry `showIf`, a condition on another field.
Inside a repeatable group a name means "this row", and `/name` reaches the root.

```ts
{ name: "claimCount", type: "number", min: 1, required: true,
  showIf: { field: "hasClaims", equals: true } }
```

A computed field is an expression tree over other fields. The quote price is
`round((value * 0.0025 + drivers * 14 + max(40 - age, 0)) * cover factor)`.
The schema has a `version`. Bump it when a saved draft would no longer fit.

## Problems the tests found

Each of these was a failing test before it was a fix, and each has its own
commit apart from the first two.

**A slow reply for an earlier username marked the newer one valid.** The first
version applied whichever answer arrived last. Type `sam`, then `samuel`: if
`samuel` comes back "taken" and the older `sam` comes back "free" afterwards,
the field ended up valid. 4 of the 7 async tests failed on that version. Each
field now owns one slot, a new request aborts and replaces it, and an answer is
applied only if its own slot is still the current one. A pending check also
blocks Next, and "valid" counts only when it was recorded for exactly the text
that is in the box.
`a slow reply for an earlier username cannot let a taken name through` presses
through the UI with promises the test resolves in the wrong order.

**A blank age priced the quote at 0.** `Number("")` is 0, so an unfilled input
produced a confident price. Division by zero gave `Infinity`. A computed field
now returns `null`, shown as "Not available yet", when any input is blank or
the result is not finite.

**A field that names a check nobody registered blocked Next for ever.** Found
because 10 of the 18 component tests on the first run failed on step 1: the
schema asked for a `username` check, the test passed no validators, and the
engine waited for an answer that was never coming. `request` now reports
whether it started anything, and only a started check blocks.

**Under StrictMode the discard notice vanished.** React builds the initial state
twice. Reading an out-of-date draft deleted it, so the second read said "no
draft" and the user was never told theirs had been dropped. Reading is now free
of side effects, and the next autosave replaces the old draft.

**Removing a driver left its error on the next driver.** Errors are keyed by
path, `drivers.2.name`, and the index is part of the key. Remove row 0 and the
message for row 2 stayed on a path that no longer exists, so row 1 showed none
and the form still refused to submit. Errors under the group are now moved down
with the rows.

**`count` read through the `ref` branch.** A one-line ordering mistake in the
expression evaluator turned `count(drivers)` into `Number([...])`, which is
`NaN`. The first run of the engine tests caught it, before the first commit
that held tests.

## Behaviour worth knowing

- Fields that are hidden keep their value in memory, so ticking a box off and
  on again gives back what was typed. They are removed from what is sent, and
  they are never required.
- The draft is versioned. At the same version it is re-fitted to the schema:
  unknown keys dropped, wrong types blanked, a select value that is no longer
  an option blanked, rows beyond the group maximum cut. At an older version the
  migrations you supply run in order. A missing or throwing migration, a newer
  version than the code knows, and corrupt JSON all discard the draft and show
  a notice.
- Fields marked `sensitive` are never written to storage.
- A full or blocked `localStorage` does not stop the form. It says once that
  the draft could not be saved.
- On a failed Next the first invalid input takes focus and a polite live region
  says how many errors there are and reads the first. Changing step moves focus
  to the step heading. Adding a row focuses its first input, removing one
  focuses the Add button.
- API errors can name a field as `drivers[1].licence_years`,
  `drivers.1.licenceYears` or `/drivers/1/licence-years`. All three reach the
  same input. Anything that names a hidden field, a missing row or an unknown
  field goes into a form-level alert with the path the server used. The form
  jumps to the first step that holds an error.
- Submit is guarded against a second press while the first is in flight.

## What this does not do

- There is no debounce. Every keystroke past the minimum length asks the server
  again, so `sam_rao` sends 5 requests (M). Older ones are aborted through the
  `AbortSignal`, and a validator that ignores the signal still cannot win.
- Pressing Next while a check is pending is refused with "Still checking",
  not held until the answer arrives.
- Computed fields live at the top level and are evaluated in declaration order.
  A field reading one declared below it sees `null`. There are no per-row
  computed values.
- The draft is written on every change, and two tabs on the same form overwrite
  each other. `storage` events are not listened to.
- Accessibility is checked with Testing Library queries, focus assertions and
  accessible descriptions in jsdom. It has not been run through a screen reader
  or axe, and nothing here measures contrast or reflow.
- Only text, email, number, select, checkbox and groups exist. No dates, files
  or multi-select.
- A draft is per browser. It is not an account-level save.
