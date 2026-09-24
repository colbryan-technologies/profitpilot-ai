import type { LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { tenant } from "../services/tenant.server";
import { Page, Card, Notice } from "../components/ui";
export async function loader({ request }: LoaderFunctionArgs) {
  await tenant(request);
  return null;
}
export default function Help() {
  return (
    <Page title="Help & calculation methodology">
      <Notice>
        This is a development build under review. It is not ready for paid
        merchant onboarding or accounting/tax reliance.
      </Notice>
      <Card title="How estimated profit is calculated">
        <p>
          Net sales are calculated from recorded product sales, discounts,
          refunds and configured tax treatment. Gross profit subtracts COGS.
          Order contribution adds net shipping receipts and tips, then subtracts
          shipping costs, processing fees and the current duty adjustment. Store
          contribution subtracts advertising. Estimated net profit also
          subtracts recorded expenses.
        </p>
        <p>
          All money is processed in integer minor units using decimal
          conversion. Different currencies are not combined. No exchange-rate
          conversion is provided.
        </p>
      </Card>
      <Card title="Assumptions and open limitations">
        <ul>
          <li>
            Refunds restate the original sale period, rather than forming a
            cash-flow ledger on refund date.
          </li>
          <li>
            Orders earlier than the first cost-history record use that earliest
            cost as an estimate.
          </li>
          <li>
            Missing costs are treated as zero and can overstate profit.
            Estimated shipping persists after returns.
          </li>
          <li>
            Monthly/yearly recurring expenses use a 365.25-day average and daily
            rounding.
          </li>
          <li>
            Gift cards, duties, order edits, shipping-tax refunds and manual
            refund adjustments still need reconciliation against live Shopify
            fixtures.
          </li>
          <li>
            Large orders and catalogs are paged completely. Imports stop on
            incomplete responses or records changed during paging; check Data
            health and retry failed synchronization before relying on totals.
          </li>
        </ul>
      </Card>
      <Card title="Profit Confidence">
        <p>
          A weighted quality checklist, not a probability: orders 25 points,
          refunds/transactions 10, COGS 25, shipping 10, payment fees 10,
          advertising 10, tax configuration 5 and freshness 5. Check the
          component explanations and timestamps.
        </p>
        <Link to="/app/data-health">Review data health</Link>
      </Card>
      <Card title="Support and privacy">
        <p>
          For this development build, contact your installation administrator.
          Public support contacts and the final privacy policy must be
          configured before launch. Customer data requests and deletion
          acceptance tests remain launch blockers.
        </p>
        <p>
          AI sharing is off by default and can be controlled in Settings. Stored
          integration tokens, order identifiers and financial records require
          restricted database access and backups.
        </p>
      </Card>
    </Page>
  );
}
