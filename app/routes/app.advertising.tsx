import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { formData, formResult } from "../services/form.server";
import { recordManualSpend } from "../services/ads/sync.server";
import { formatMoney } from "../lib/money";
import { Page, Card, Notice, Field, Submit, Feedback } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const accounts = await prisma.adAccount.findMany({
    where: { storeId: store.id },
    select: {
      id: true,
      name: true,
      provider: true,
      status: true,
      currency: true,
      lastSyncedAt: true,
    },
  });
  const spend = await prisma.adSpend.findMany({
    where: { storeId: store.id },
    orderBy: { date: "desc" },
    take: 60,
    select: {
      id: true,
      date: true,
      currency: true,
      spendMinor: true,
      adAccount: { select: { name: true } },
    },
  });
  return { accounts, spend, currency: store.currency };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const f = await formData(request);
  return formResult(async () => {
    const row = z
      .object({ date: z.iso.date(), amount: z.string().regex(/^\d+(\.\d+)?$/) })
      .parse(f);
    await recordManualSpend(store.id, [{ ...row, currency: store.currency }]);
    return "Daily manual spend saved and snapshot refreshed.";
  });
}
export default function Advertising() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Advertising">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        Enter total spend, not attributed revenue. Manual entries replace the
        manual total for that date. Do not re-enter spend already synchronized
        from another account.
      </Notice>
      <Card title="Record daily spend">
        <Form method="post">
          <Field label="Date" name="date" type="date" />
          <Field label={`Total spend (${d.currency})`} name="amount" />
          <Submit>Save daily total</Submit>
        </Form>
      </Card>
      <Card title="Accounts">
        <p>
          Direct Meta and Google connection flows are not yet enabled. Use
          manual spend while these integrations are verified.
        </p>
        {d.accounts.map((a) => (
          <p key={a.id}>
            {a.name ?? a.provider} · {a.status} · {a.currency} ·{" "}
            {a.lastSyncedAt
              ? `Updated ${new Date(a.lastSyncedAt).toLocaleString()}`
              : "Never synchronized"}
          </p>
        ))}
      </Card>
      <Card title="Latest daily records">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Spend</th>
              </tr>
            </thead>
            <tbody>
              {d.spend.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.date).toISOString().slice(0, 10)}</td>
                  <td>{r.adAccount.name}</td>
                  <td>{formatMoney(r.spendMinor, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.spend.length && <p>No advertising spend recorded.</p>}
      </Card>
    </Page>
  );
}
