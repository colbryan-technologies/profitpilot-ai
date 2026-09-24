import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, Link, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import { tenant } from "../services/tenant.server";
import { formData } from "../services/form.server";
import { askProfitPilot } from "../services/ai/ask.server";
import { Page, Card, Submit, Notice } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  return { aiEnabled: store.aiEnabled };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store, actorId } = await tenant(request);
  const f = await formData(request);
  const question = z.string().trim().min(1).max(1000).safeParse(f.question);
  if (!question.success)
    return data(
      { error: "Enter a question of 1–1,000 characters.", answer: null },
      { status: 400 },
    );
  try {
    const result = await askProfitPilot({
      storeId: store.id,
      userId: actorId,
      question: question.data,
    });
    return data({ answer: result.answer, error: null });
  } catch (err) {
    if (err instanceof Response && err.status < 500)
      return data(
        { error: await err.text(), answer: null },
        { status: err.status },
      );
    return data(
      {
        error:
          "ProfitPilot could not prepare an answer. Check data health and try again.",
        answer: null,
      },
      { status: 503 },
    );
  }
}
export default function Ask() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  return (
    <Page title="Ask ProfitPilot">
      <Notice>
        {d.aiEnabled
          ? "AI can explain your calculated summaries. Verify important conclusions against the underlying reports."
          : "AI sharing is off. You will receive a deterministic summary of your calculated figures."}{" "}
        <Link to="/app/notifications">Manage AI sharing</Link>.
      </Notice>
      <Card title="What would you like to investigate?">
        <Form method="post">
          <label className="pp-field">
            Your question
            <textarea
              name="question"
              maxLength={1000}
              required
              placeholder="What changed in my profit this month?"
            />
          </label>
          <Submit>Ask ProfitPilot</Submit>
        </Form>
      </Card>
      {r?.error && (
        <div role="alert" className="pp-error">
          {r.error}
        </div>
      )}
      {r?.answer && (
        <Card title="Your profit summary">
          <div className="pp-answer">{r.answer}</div>
          <p>
            <Link to="/app/overview">View calculated totals</Link> ·{" "}
            <Link to="/app/leaks">Profit leaks</Link>
          </p>
        </Card>
      )}
    </Page>
  );
}
