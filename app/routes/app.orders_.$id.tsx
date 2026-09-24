import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { orderHistoryBounds } from "../services/report-access.server";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import {
  buildCalculationContext,
  toOrderInput,
} from "../services/profit/recalc.server";
import { computeOrderProfit } from "../domain/profit/order";
import { formatMoney } from "../lib/money";
import { Page, Card, Notice } from "../components/ui";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const history = await orderHistoryBounds(store.id);
  const row = await prisma.order.findFirst({
    where: {
      id: params.id,
      storeId: store.id,
      processedAt: { gte: history.start, lt: history.end },
    },
    include: { lineItems: true, refunds: true, transactions: true },
  });
  if (!row) throw new Response("Order not found", { status: 404 });
  return {
    name: row.name,
    p: computeOrderProfit(
      toOrderInput(row),
      await buildCalculationContext(store.id),
    ),
  };
}
export default function OrderDetail() {
  const { name, p } = useLoaderData<typeof loader>();
  const money = (n: number) => formatMoney(n, p.currency);
  return (
    <Page title={name}>
      <Link to="/app/orders">Back to orders</Link>
      {p.isExcluded && <Notice>Excluded: {p.excludedReason}</Notice>}
      <Notice>
        Calculation {p.calcVersion}. Shipping:{" "}
        {p.shippingCostSource.toLowerCase()}; fees:{" "}
        {p.paymentFeeSource.toLowerCase()}. Missing COGS is treated as zero and
        can overstate profit. Advertising and overhead are not allocated here.
      </Notice>
      <Card title="Calculation breakdown">
        <table>
          <tbody>
            {(
              [
                ["Gross sales", p.grossSalesMinor],
                ["Discounts", -p.discountsMinor],
                ["Product refunds", -p.refundsMinor],
                ["Net sales", p.netSalesMinor],
                ["COGS", -p.cogsMinor],
                ["Shipping revenue", p.shippingRevenueMinor],
                ["Shipping cost", -p.shippingCostMinor],
                ["Payment fees", -p.paymentFeesMinor],
                ["Estimated contribution", p.contributionProfitMinor],
              ] as const
            ).map(([label, n]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{money(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Line items">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Net sales</th>
                <th>COGS</th>
                <th>Cost source</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.lineItemId}>
                  <td>{l.title}</td>
                  <td>{money(l.netSalesMinor)}</td>
                  <td>{money(l.cogsMinor)}</td>
                  <td>{l.cogsSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
