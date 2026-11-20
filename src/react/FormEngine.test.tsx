import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, FormEngine, type FormEngineProps } from "./FormEngine";
import { quoteMigrations, quoteSchema } from "../demo/quoteSchema";
import { draftKey, type AsyncValidator, type StorageLike } from "../engine";

function controlledUsername() {
  const calls: { value: string; resolve: (m: string | null) => void }[] = [];
  const validator: AsyncValidator = (value) =>
    new Promise((resolve) => calls.push({ value, resolve }));
  return { calls, validator };
}

const live = () => screen.getByTestId("live").textContent;

function setup(over: Partial<FormEngineProps> = {}) {
  const user = userEvent.setup();
  const onSubmit = over.onSubmit ?? vi.fn().mockResolvedValue({ reference: "Q-1" });
  const ui = (
    <FormEngine
      schema={quoteSchema}
      migrations={quoteMigrations}
      onSubmit={onSubmit}
      {...over}
    />
  );
  const view = render(ui);
  return { user, onSubmit, view, rerender: () => view.rerender(ui) };
}

type User = ReturnType<typeof userEvent.setup>;

async function stepOne(user: User, username = "sam_rao2") {
  await user.type(screen.getByLabelText("Full name"), "Sam Rao");
  await user.type(screen.getByLabelText("Email"), "sam@example.com");
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Age"), "34");
}

async function stepTwo(user: User) {
  await user.selectOptions(screen.getByLabelText("Vehicle type"), "car");
  await user.type(screen.getByLabelText("Vehicle value"), "12000");
}

async function stepThree(user: User) {
  await user.type(screen.getByLabelText("Driver name"), "Sam");
  await user.type(screen.getByLabelText("Years licensed"), "6");
}

const next = (user: User) => user.click(screen.getByRole("button", { name: /^Next$/ }));
const heading = () => screen.getByRole("heading", { level: 2 });

describe("moving between steps", () => {
  it("keeps every field when going back and forward again", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await user.click(screen.getByLabelText("Modified from standard"));
    await user.type(screen.getByLabelText("Describe the modifications"), "Lowered springs");
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(heading()).toHaveTextContent("Step 1 of 4: About you");
    expect(screen.getByLabelText("Full name")).toHaveValue("Sam Rao");
    expect(screen.getByLabelText("Username")).toHaveValue("sam_rao2");
    expect(screen.getByLabelText("Age")).toHaveValue(34);

    await next(user);
    expect(screen.getByLabelText("Vehicle type")).toHaveValue("car");
    expect(screen.getByLabelText("Vehicle value")).toHaveValue(12000);
    expect(screen.getByLabelText("Describe the modifications")).toHaveValue("Lowered springs");
  });

  it("moves focus to the new step heading and announces it", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    expect(heading()).toHaveFocus();
    expect(live()).toBe("Step 2 of 4: Vehicle");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(heading()).toHaveFocus();
    expect(live()).toBe("Step 1 of 4: About you");
  });

  it("Back does not validate, so a half-filled step can be left", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(heading()).toHaveTextContent("Step 1");
  });
});

describe("errors, focus and announcements", () => {
  it("focuses the first invalid input, links its message and announces the count", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await next(user);

    const name = screen.getByLabelText("Full name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Full name is required");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Email must be an email address");
    expect(live()).toBe("4 errors: Full name is required");
    expect(heading()).toHaveTextContent("Step 1");
  });

  it("announces a repeated failure again, not only the first", async () => {
    const { user } = setup();
    await next(user);
    const first = screen.getByTestId("live").firstElementChild;
    await next(user);
    expect(screen.getByTestId("live").firstElementChild).not.toBe(first);
    expect(live()).toBe("4 errors: Full name is required");
  });

  it("clears a field's error when that field is edited, and only that one", async () => {
    const { user } = setup();
    await next(user);
    await user.type(screen.getByLabelText("Full name"), "S");
    expect(screen.getByLabelText("Full name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not require a field that is hidden", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await next(user);
    expect(heading()).toHaveTextContent("Step 3 of 4");
  });
});

describe("background username check", () => {
  it("blocks Next while the check is running", async () => {
    const { calls, validator } = controlledUsername();
    const { user } = setup({ asyncValidators: { username: validator } });
    await stepOne(user, "sam_rao2");
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription("Checking username");
    await next(user);
    expect(heading()).toHaveTextContent("Step 1");
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription(/Still checking username/);
    expect(screen.getByLabelText("Username")).toHaveFocus();
    await act(async () => calls.at(-1)!.resolve(null));
    await next(user);
    expect(heading()).toHaveTextContent("Step 2");
  });

  it("a slow reply for an earlier value cannot let a taken name through", async () => {
    const { calls, validator } = controlledUsername();
    const { user } = setup({ asyncValidators: { username: validator } });
    await stepOne(user, "sam_rao");
    // Every keystroke past the third asked once: "sam", "sam_", "sam_r", "sam_ra", "sam_rao".
    expect(calls.map((c) => c.value)).toEqual(["sam", "sam_", "sam_r", "sam_ra", "sam_rao"]);

    await act(async () => calls[4]!.resolve("That username is taken"));
    for (const early of calls.slice(0, 4)) await act(async () => early.resolve(null));

    const input = screen.getByLabelText("Username");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("That username is taken");
    await next(user);
    expect(heading()).toHaveTextContent("Step 1");
    expect(screen.queryByText("Username is available")).not.toBeInTheDocument();
  });

  it("does not accept an old answer after the text changed to something else", async () => {
    const { calls, validator } = controlledUsername();
    const { user } = setup({ asyncValidators: { username: validator } });
    await user.type(screen.getByLabelText("Username"), "abc");
    await user.type(screen.getByLabelText("Username"), "d");
    await act(async () => calls[0]!.resolve(null)); // answer for "abc"
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription("Checking username");
    expect(screen.queryByText("Username is available")).not.toBeInTheDocument();
  });

  it("announces the result once it arrives", async () => {
    const { calls, validator } = controlledUsername();
    const { user } = setup({ asyncValidators: { username: validator } });
    await user.type(screen.getByLabelText("Username"), "abc");
    await act(async () => calls.at(-1)!.resolve(null));
    expect(live()).toBe("Username is available");
    expect(screen.getByText("Username is available", { selector: "p" })).toBeInTheDocument();
  });

  it("treats a failed lookup as unverified, and only lets the user on once a check succeeds", async () => {
    let n = 0;
    const validator: AsyncValidator = () => (++n === 3 ? Promise.resolve(null) : Promise.reject(new Error("503")));
    const { user } = setup({ asyncValidators: { username: validator } });
    await stepOne(user, "abc");
    await act(async () => {});
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription("Could not check this just now");

    await next(user); // asks again (call 2, fails)
    expect(heading()).toHaveTextContent("Step 1");
    await act(async () => {});
    await next(user); // call 3 succeeds, but this press still has to wait for it
    expect(heading()).toHaveTextContent("Step 1");
    await act(async () => {});
    await next(user);
    expect(heading()).toHaveTextContent("Step 2");
    expect(n).toBe(3);
  });

  it("a field that names a check nobody registered is not blocked forever", async () => {
    const { user } = setup({ asyncValidators: {} });
    await stepOne(user);
    await next(user);
    expect(heading()).toHaveTextContent("Step 2");
  });
});

describe("conditional fields", () => {
  it("shows and hides a field, keeps what was typed, and never sends it while hidden", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ reference: "Q-9" });
    const { user } = setup({ onSubmit });
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await user.click(screen.getByLabelText("Modified from standard"));
    await user.type(screen.getByLabelText("Describe the modifications"), "Exhaust");
    await user.click(screen.getByLabelText("Modified from standard"));
    expect(screen.queryByLabelText("Describe the modifications")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Modified from standard"));
    expect(screen.getByLabelText("Describe the modifications")).toHaveValue("Exhaust");
    await user.click(screen.getByLabelText("Modified from standard"));

    await next(user);
    await stepThree(user);
    await next(user);
    await user.selectOptions(screen.getByLabelText("Cover level"), "comprehensive");
    await user.click(screen.getByLabelText("I accept the terms"));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0]![0];
    expect("mods" in sent).toBe(false);
    expect("businessUse" in sent).toBe(false);
    expect("niNumber" in sent).toBe(true);
    expect(sent.monthly).toBe(Math.round((12000 * 0.0025 + 14 + 6) * 1.35));
  });
});

describe("repeatable group", () => {
  it("adds a row, focuses its first input and announces it", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await next(user);
    expect(screen.getAllByLabelText("Driver name")).toHaveLength(1); // the group starts with its minimum
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    expect(screen.getAllByLabelText("Driver name")[1]).toHaveFocus();
    expect(live()).toBe("Driver 2 added");
  });

  it("stops at the maximum and says so", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await next(user);
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole("button", { name: "Add driver" }));
    expect(screen.getByRole("button", { name: "Add driver" })).toBeDisabled();
    expect(screen.getAllByLabelText("Driver name")).toHaveLength(4);
  });

  it("asks for a driver when there are none, and focuses the add button", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "Remove driver 1" }));
    expect(live()).toBe("Driver 1 removed. 0 left");
    await next(user);
    expect(screen.getByRole("button", { name: "Add driver" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add driver" })).toHaveAccessibleDescription("Add at least 1 driver");
  });

  it("keeps an error on the row it belongs to after an earlier row is removed", async () => {
    const { user } = setup();
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await next(user);
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole("button", { name: "Add driver" }));
    const names = screen.getAllByLabelText("Driver name");
    await user.type(names[0]!, "A");
    await user.type(names[1]!, "B");
    // row 3 left empty: it carries the "required" error after pressing Next
    await user.type(screen.getAllByLabelText("Years licensed")[0]!, "5");
    await user.type(screen.getAllByLabelText("Years licensed")[1]!, "5");
    await user.type(screen.getAllByLabelText("Years licensed")[2]!, "5");
    await next(user);
    expect(screen.getAllByLabelText("Driver name")[2]).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Remove driver 1" }));
    const after = screen.getAllByLabelText("Driver name");
    expect(after).toHaveLength(2);
    expect(after[0]).not.toHaveAttribute("aria-invalid");
    expect(after[1]).toHaveAttribute("aria-invalid", "true");
    expect(after[1]).toHaveAccessibleDescription("Driver name is required");
  });
});

describe("draft autosave", () => {
  it("survives a reload: same step, same values, nothing sensitive", async () => {
    const { user, view } = setup();
    await stepOne(user);
    await user.type(screen.getByLabelText("National insurance number"), "QQ123456C");
    await next(user);
    await stepTwo(user);
    view.unmount();

    expect(localStorage.getItem(draftKey(quoteSchema))).not.toContain("QQ123456C");

    setup();
    expect(heading()).toHaveTextContent("Step 2 of 4: Vehicle");
    expect(screen.getByLabelText("Vehicle value")).toHaveValue(12000);
    expect(screen.getByText("Draft restored. Carry on where you left off.", { selector: "p" })).toBeInTheDocument();
    expect(live()).toBe("Draft restored. Carry on where you left off.");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("Sam Rao");
    expect(screen.getByLabelText("National insurance number")).toHaveValue("");
  });

  it("does not overwrite the saved draft with an empty form while loading it", () => {
    const saved = JSON.stringify({ format: 1, schemaVersion: 2, step: 0, savedAt: "x", values: { fullName: "Kept" } });
    localStorage.setItem(draftKey(quoteSchema), saved);
    setup();
    expect(screen.getByLabelText("Full name")).toHaveValue("Kept");
    expect(JSON.parse(localStorage.getItem(draftKey(quoteSchema)) as string).values.fullName).toBe("Kept");
  });

  const oldDraft = JSON.stringify({
    format: 1, schemaVersion: 1, step: 2, savedAt: "x",
    values: { fullName: "Old Draft", driverName: "Ola", licenceYears: 9, vehicleType: "hovercraft" },
  });

  it("migrates a version 1 draft, and blanks a value the new options no longer allow", () => {
    localStorage.setItem(draftKey(quoteSchema), oldDraft);
    setup();
    expect(heading()).toHaveTextContent("Step 3 of 4");
    expect(screen.getByText("Draft restored and updated to the latest form.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByLabelText("Driver name")).toHaveValue("Ola");
    expect(screen.getByLabelText("Years licensed")).toHaveValue(9);
  });

  it("discards an old draft it cannot migrate, says so, and starts at step 1", () => {
    localStorage.setItem(draftKey(quoteSchema), oldDraft);
    setup({ migrations: {} });
    expect(heading()).toHaveTextContent("Step 1 of 4");
    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(screen.getByText("An earlier draft no longer fits this form and was cleared.", { selector: "p" })).toBeInTheDocument();
  });

  it("shows the same notice under StrictMode, which builds the initial state twice", () => {
    localStorage.setItem(draftKey(quoteSchema), oldDraft);
    render(
      <StrictMode>
        <FormEngine schema={quoteSchema} migrations={{}} onSubmit={vi.fn()} />
      </StrictMode>,
    );
    expect(screen.getByText("An earlier draft no longer fits this form and was cleared.", { selector: "p" })).toBeInTheDocument();
  });

  it("keeps working, and says so once, when the browser refuses to store the draft", async () => {
    const setItem = vi.fn(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const storage: StorageLike = { getItem: () => null, setItem, removeItem: () => {} };
    const { user } = setup({ storage });
    await user.type(screen.getByLabelText("Full name"), "Sam");
    expect(screen.getByLabelText("Full name")).toHaveValue("Sam");
    expect(live()).toBe("This draft could not be saved on this device");
    const before = screen.getByTestId("live").firstElementChild;
    await user.type(screen.getByLabelText("Full name"), "uel");
    expect(screen.getByTestId("live").firstElementChild).toBe(before);
  });

  it("clears the draft once the form is accepted", async () => {
    const { user } = setup({ asyncValidators: {} });
    await stepOne(user);
    await next(user);
    await stepTwo(user);
    await next(user);
    await stepThree(user);
    await next(user);
    await user.selectOptions(screen.getByLabelText("Cover level"), "third_party");
    await user.click(screen.getByLabelText("I accept the terms"));
    expect(localStorage.getItem(draftKey(quoteSchema))).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("heading", { name: "Quote submitted" })).toHaveFocus();
    expect(localStorage.getItem(draftKey(quoteSchema))).toBeNull();
    expect(screen.getByText("Reference Q-1")).toBeInTheDocument();
  });
});

async function toLastStep(user: User) {
  await stepOne(user);
  await next(user);
  await stepTwo(user);
  await next(user);
  await stepThree(user);
  await next(user);
  await user.selectOptions(screen.getByLabelText("Cover level"), "comprehensive");
  await user.click(screen.getByLabelText("I accept the terms"));
}

describe("submitting", () => {
  it("shows the computed price and updates it as inputs change", async () => {
    const { user } = setup();
    await toLastStep(user);
    expect(screen.getByText("Monthly price").nextElementSibling).toHaveTextContent("£68");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    await user.type(screen.getAllByLabelText("Driver name")[1]!, "Jo");
    await user.type(screen.getAllByLabelText("Years licensed")[1]!, "2");
    await next(user);
    expect(screen.getByText("Monthly price").nextElementSibling).toHaveTextContent("£86");
  });

  it("sends once however many times the button is pressed", async () => {
    let finish: (v: unknown) => void = () => {};
    const onSubmit = vi.fn(() => new Promise((r) => (finish = r)));
    const { user } = setup({ onSubmit });
    await toLastStep(user);
    const submit = screen.getByRole("button", { name: "Submit" });
    await user.click(submit);
    await user.click(screen.getByRole("button", { name: "Sending" }));
    await user.click(screen.getByRole("button", { name: "Sending" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => finish({ reference: "Q-2" }));
    expect(await screen.findByText("Reference Q-2")).toBeInTheDocument();
  });

  it("puts each API error on its own input, jumps back to the step and focuses the first one", async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(422, [
        { field: "drivers[0].licence_years", message: "We need a year of history" },
        { field: "email", message: "Already has a quote" },
        { field: "quote_engine", message: "Rating service unavailable" },
      ]),
    );
    const { user } = setup({ onSubmit });
    await toLastStep(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("Step 1 of 4");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveFocus();
    expect(email).toHaveAccessibleDescription("Already has a quote");
    expect(screen.getByRole("alert")).toHaveTextContent("quote_engine: Rating service unavailable");
    expect(live()).toBe("The server found 2 problems on step 1");

    await stepTwoToThree(user);
    const years = screen.getByLabelText("Years licensed");
    expect(years).toHaveAttribute("aria-invalid", "true");
    expect(years).toHaveAccessibleDescription("We need a year of history");
    await user.type(years, "0");
    expect(years).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the form and says so when the request fails outright", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new TypeError("network"));
    const { user } = setup({ onSubmit });
    await toLastStep(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not send the form");
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText("Cover level")).toHaveValue("comprehensive");
    onSubmit.mockResolvedValueOnce({ reference: "Q-3" });
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Reference Q-3")).toBeInTheDocument();
  });

  it("walks back to the first invalid step when a draft left an earlier step incomplete", async () => {
    localStorage.setItem(
      draftKey(quoteSchema),
      JSON.stringify({ format: 1, schemaVersion: 2, step: 3, savedAt: "x", values: { fullName: "Only a name", cover: "third_party", terms: true } }),
    );
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(heading()).toHaveTextContent("Step 1 of 4");
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(live()).toMatch(/^Step 1 has \d errors?: /);
  });
});

async function stepTwoToThree(user: User) {
  await next(user);
  await next(user);
}
