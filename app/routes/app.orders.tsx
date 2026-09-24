import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { orderHistoryBounds } from "../services/report-access.server";
import { reportReadiness } from "../services/report-readiness.server";
import { CALC_VERSION } from "../domain/profit/types";
import { dayFromString, localDateString, addDays } from "../lib/dates";
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
      calcVersion: true,
      shopifyUpdatedAt: true,
      cogsCoverage: true,
      isTest: true,
      financialStatus: true,
    },
  });
  const days = [
    ...new Set(
      rows
        .slice(0, 50)
        .map((r) => localDateString(r.processedAt, store.ianaTimezone)),
    ),
  ];
  days.sort();
  const ready =
    days.length > 0 &&
    (
      await reportReadiness(store.id, {
        start: dayFromString(days[0]),
        end: addDays(dayFromString(days[days.length - 1]), 1),
      })
    ).ready;
  return {
    rows: rows.slice(0, 50).map((r) => {
      const current =
        ready &&
        r.calcVersion === CALC_VERSION &&
        r.computedAt !== null &&
        r.computedAt >= r.shopifyUpdatedAt;
      return {
        ...r,
        contributionProfitMinor: current ? r.contributionProfitMinor : null,
        cogsCoverage: current ? r.cogsCoverage : null,
        computedAt: current ? r.computedAt : null,
      };
    }),
    page,
    more: rows.length > 50,
  };
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
                      : "Data needs refresh"}
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
