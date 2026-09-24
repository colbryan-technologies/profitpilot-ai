import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { tenant, pageNumber } from "../services/tenant.server";
import {
  expenseSchema,
  upsertExpense,
  deleteExpense,
} from "../services/settings.server";
import { formData, formResult } from "../services/form.server";
import { formatMoney } from "../lib/money";
import {
  Page,
  Card,
  Field,
  Submit,
  Feedback,
  Pagination,
  Notice,
} from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const page = pageNumber(request);
  const expenses = await prisma.expense.findMany({
    where: { storeId: store.id },
    orderBy: { startsOn: "desc" },
    take: 51,
    skip: (page - 1) * 50,
  });
  return {
    currency: store.currency,
    expenses: expenses.slice(0, 50),
    more: expenses.length > 50,
    page,
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store, actorId } = await tenant(request);
  const form = await formData(request);
  return formResult(async () => {
    if (form.intent === "delete") {
      await deleteExpense(store.id, form.id, actorId);
      return "Expense removed. Recalculation queued.";
    }
    await upsertExpense(store.id, expenseSchema.parse(form), actorId);
    return "Expense saved. Recalculation queued.";
  });
}
export default function Expenses() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Expenses">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        Recurring monthly and annual expenses are spread using an average
        365.25-day year. These are management estimates, not an accounting
        ledger.
      </Notice>
      <Card title="Add an expense">
        <Form method="post">
          <Field label="Name" name="name" />
          <Field label={`Amount (${d.currency})`} name="amount" />
          <label className="pp-field">
            Category
            <select name="category">
              {[
                "SOFTWARE",
                "WAREHOUSE",
                "CONTRACTORS",
                "PACKAGING",
                "FULFILLMENT",
                "PAYROLL",
                "AGENCY",
                "OTHER",
              ].map((v) => (
                <option key={v} value={v}>
                  {v.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="pp-field">
            Repeats
            <select name="recurrence">
              {["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"].map((v) => (
                <option key={v} value={v}>
                  {v.toLowerCase().replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <Field label="Start / incurred date" name="startsOn" type="date" />
          <Field
            label="End date (exclusive, optional)"
            name="endsOn"
            type="date"
            required={false}
          />
          <Submit>Add expense</Submit>
        </Form>
      </Card>
      <Card title="Recorded expenses">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Amount</th>
                <th>Recurrence</th>
                <th>From</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {d.expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{formatMoney(e.amountMinor, e.currency)}</td>
                  <td>{e.recurrence.toLowerCase().replaceAll("_", " ")}</td>
                  <td>{new Date(e.startsOn).toISOString().slice(0, 10)}</td>
                  <td>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={e.id} />
                      <Submit>Remove</Submit>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.expenses.length && <p>No expenses recorded.</p>}
        <Pagination page={d.page} more={d.more} />
      </Card>
    </Page>
  );
}
