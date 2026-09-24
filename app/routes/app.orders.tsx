import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { orderHistoryBounds } from "../services/report-access.server";
import prisma from "../db.server";
import { tenant, pageNumber } from "../services/tenant.server";
import { formatMoney } from "../lib/money";
import { Page, Card, Pagination, Notice } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const history = await orderHistoryBounds(store.id);
  const page = pageNumber(request);
  const rows = await prisma.order.findMany({
    where: {
      storeId: store.id,
      processedAt: { gte: history.start, lt: history.end },
    },
    orderBy: [{ processedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 50,
    take: 51,
    select: {
      id: true,
      name: true,
      processedAt: true,
      currency: true,
      contributionProfitMinor: true,
      computedAt: true,
      cogsCoverage: true,
      isTest: true,
      financialStatus: true,
    },
  });
  return { rows: rows.slice(0, 50), page, more: rows.length > 50 };
}
export default function Orders() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Order profitability">
      <Notice>
        Order contribution excludes store-level advertising and overhead. Test
        orders are excluded from aggregate profit.
      </Notice>
      <Card title="Orders">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Status</th>
                <th>Contribution</th>
                <th>COGS coverage</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/app/orders/${o.id}`}>{o.name}</Link>
                  </td>
                  <td>{new Date(o.processedAt).toLocaleDateString()}</td>
                  <td>
                    {o.isTest ? "Test" : (o.financialStatus ?? "Unknown")}
                  </td>
                  <td>
                    {o.computedAt && o.contributionProfitMinor !== null
                      ? formatMoney(o.contributionProfitMinor, o.currency)
                      : "Awaiting calculation"}
                  </td>
                  <td>
                    {o.cogsCoverage === null ? "—" : `${o.cogsCoverage}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.rows.length && <p>No synchronized orders yet.</p>}
        <Pagination page={d.page} more={d.more} />
      </Card>
    </Page>
  );
}
