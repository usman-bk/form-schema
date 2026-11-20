import { FormEngine } from "../react/FormEngine";
import { quoteMigrations, quoteSchema } from "./quoteSchema";
import { checkUsername, submitQuote } from "./fakeApi";

export function App() {
  return (
    <main>
      <h1>Motor insurance quote</h1>
      <FormEngine
        schema={quoteSchema}
        migrations={quoteMigrations}
        asyncValidators={{ username: checkUsername }}
        onSubmit={submitQuote}
        submitLabel="Get my quote"
      />
    </main>
  );
}
