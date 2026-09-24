import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { tenant, requestPeriod } from "../services/tenant.server";
import {
  productMetrics,
  periodSummary,
} from "../services/profit/reporting.server";
import { formatMoney } from "../lib/money";
import { Page, Card, Notice, PeriodSelect } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const period = requestPeriod(request, store.ianaTimezone);
  const summary = await periodSummary(store.id, period);
  const products = await productMetrics(store.id, period, {
    adSpendMinor: summary.adSpendMinor,
  });
  return { products, currency: store.currency, period: period.key };
}
export default function Products() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Product profitability">
      <PeriodSelect value={d.period} />
      <Notice>
        Advertising and order costs are allocated by net sales. These are
        estimates, not ad attribution. Missing COGS overstates profit.
      </Notice>
      <Card title="Products sold in this period">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Units kept</th>
                <th>Net sales</th>
                <th>Contribution</th>
                <th>Cost data</th>
              </tr>
            </thead>
            <tbody>
              {d.products.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <Link
                      to={`/app/products/${encodeURIComponent(p.productId)}?period=${d.period}`}
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td>{p.unitsSold}</td>
                  <td>{formatMoney(p.netSalesMinor, d.currency)}</td>
                  <td>{formatMoney(p.contributionProfitMinor, d.currency)}</td>
                  <td>{p.missingCogs ? "Missing COGS" : "COGS recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.products.length && (
          <p>No synchronized product sales for this period.</p>
        )}
      </Card>
    </Page>
  );
}

export { ReportErrorBoundary as ErrorBoundary } from "../components/report-error";
