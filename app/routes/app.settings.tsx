import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import {
  feeSchema,
  shippingRuleSchema,
  taxSchema,
  saveFeeConfig,
  saveTaxConfig,
  upsertShippingRule,
  deleteShippingRule,
} from "../services/settings.server";
import { formData, formResult } from "../services/form.server";
import { toDecimalString, formatMoney } from "../lib/money";
import { Page, Card, Field, Submit, Feedback, Notice } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const [fee, tax, shipping] = await Promise.all([
    prisma.feeConfig.findUnique({ where: { storeId: store.id } }),
    prisma.taxConfig.findUnique({ where: { storeId: store.id } }),
    prisma.shippingCostRule.findMany({
      where: { storeId: store.id },
      orderBy: { priority: "desc" },
    }),
  ]);
  return { fee, tax, shipping, currency: store.currency };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store, actorId } = await tenant(request);
  const f = await formData(request);
  return formResult(async () => {
    if (f.intent === "fees")
      await saveFeeConfig(store.id, feeSchema.parse(f), actorId);
    else if (f.intent === "tax")
      await saveTaxConfig(store.id, taxSchema.parse(f), actorId);
    else if (f.intent === "shipping")
      await upsertShippingRule(store.id, shippingRuleSchema.parse(f), actorId);
    else if (f.intent === "delete-shipping")
      await deleteShippingRule(store.id, f.id, actorId);
    else throw new Response("Unknown action", { status: 400 });
    return "Settings saved. Recalculation queued.";
  });
}
export default function Settings() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Calculation settings">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        These assumptions affect estimated profit across your history. Confirm
        them against your own processor, carrier and tax records.
      </Notice>
      <Card title="Payment fee estimates">
        <Form method="post">
          <input type="hidden" name="intent" value="fees" />
          <Field
            label="Percentage per charge"
            name="percent"
            value={(d.fee?.percentBps ?? 290) / 100}
          />
          <Field
            label={`Fixed fee (${d.currency})`}
            name="fixed"
            value={toDecimalString(d.fee?.fixedMinor ?? 30, d.currency)}
          />
          <Submit>Confirm fee estimate</Submit>
        </Form>
      </Card>
      <Card title="Collected tax">
        <p>
          Collected tax is excluded by default. Costs should be entered net of
          recoverable tax where appropriate. This app does not determine your
          tax obligations.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="tax" />
          <input type="hidden" name="regionCode" value="CUSTOM" />
          <label className="pp-field">
            Treatment
            <select
              name="treatment"
              defaultValue={
                d.tax?.treatment === "INCLUDE_TAX_AS_REVENUE"
                  ? "INCLUDE_TAX_AS_REVENUE"
                  : "EXCLUDE_COLLECTED_TAX"
              }
            >
              <option value="EXCLUDE_COLLECTED_TAX">
                Exclude collected tax from revenue
              </option>
              <option value="INCLUDE_TAX_AS_REVENUE">
                Include collected tax as revenue
              </option>
            </select>
          </label>
          <Field
            label="Notes (optional)"
            name="notes"
            value={d.tax?.notes ?? ""}
            required={false}
          />
          <Submit>Confirm tax treatment</Submit>
        </Form>
      </Card>
      <Card title="Shipping cost estimates">
        <Form method="post">
          <input type="hidden" name="intent" value="shipping" />
          <Field label="Rule name" name="name" />
          <Field
            label="Country code (optional; blank means default)"
            name="countryCode"
            required={false}
          />
          <Field label={`Flat cost (${d.currency})`} name="flat" value="0" />
          <Field
            label={`Per original item (${d.currency})`}
            name="perItem"
            value="0"
          />
          <Field
            label="Percentage of shipping charged"
            name="percent"
            value="0"
          />
          <Field
            label="Priority (higher wins)"
            name="priority"
            type="number"
            value="0"
          />
          <Submit>Add shipping rule</Submit>
        </Form>
        <ul>
          {d.shipping.map((r) => (
            <li key={r.id}>
              {r.name} · {r.countryCode ?? "Default"} ·{" "}
              {formatMoney(r.flatMinor, r.currency)} flat +{" "}
              {formatMoney(r.perItemMinor, r.currency)} per item
              <Form method="post">
                <input type="hidden" name="intent" value="delete-shipping" />
                <input type="hidden" name="id" value={r.id} />
                <Submit>Remove rule</Submit>
              </Form>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Other settings">
        <div className="pp-links">
          <Link to="/app/notifications">Notifications</Link>
          <Link to="/app/integrations">Integrations</Link>
          <Link to="/app/billing">Billing</Link>
          <Link to="/app/help">Help and methodology</Link>
        </div>
      </Card>
    </Page>
  );
}
