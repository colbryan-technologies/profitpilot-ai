import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { tenant } from "../services/tenant.server";
import {
  billingConfigured,
  resolveEntitlements,
  planSelectionUrl,
  PLANS,
} from "../services/billing.server";
import { env } from "../lib/env.server";
import { Page, Card, Notice } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const configured = billingConfigured();
  const result = await resolveEntitlements(
    store.id,
    store.shopifyShopId ? `gid://shopify/Shop/${store.shopifyShopId}` : null,
  );
  return {
    plan: result.plan,
    source: result.source,
    active: result.active,
    configured,
    url: configured
      ? planSelectionUrl(store.shopDomain, env().SHOPIFY_APP_HANDLE)
      : null,
    plans: Object.values(PLANS),
  };
}
export default function Billing() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Billing">
      <Notice>
        {d.configured
          ? "Shopify hosts plan selection and confirms all charges. Prices and trials shown there are authoritative."
          : "Paid billing is not configured. No charges can be initiated from this app yet."}
      </Notice>
      <Card title="Your plan">
        <p>
          {d.plan.name} · {d.active ? "Available" : "No active subscription"} ·{" "}
          {d.source === "unenforced"
            ? "Development configuration"
            : "Verified plan mirror"}
        </p>
        {d.url && (
          <s-link href={d.url} target="_top">
            Manage plan in Shopify
          </s-link>
        )}
      </Card>
      <Card title="Configured plan allowances">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Monthly order target</th>
                <th>Daily questions</th>
                <th>History target</th>
              </tr>
            </thead>
            <tbody>
              {d.plans.map((p) => (
                <tr key={p.key}>
                  <td>{p.name}</td>
                  <td>{p.orderLimit ?? "Unlimited"}</td>
                  <td>{p.askPerDay}</td>
                  <td>{p.historyDays} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          History and order allowances are configuration targets pending
          complete enforcement and billing acceptance tests. This build is not
          ready for paid merchant onboarding.
        </p>
      </Card>
    </Page>
  );
}
