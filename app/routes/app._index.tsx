import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import prisma from "../db.server";
import { tenant, requestPeriod } from "../services/tenant.server";
import { periodSummary } from "../services/profit/reporting.server";
import { formatMoney } from "../lib/money";
import { Page, Card, Notice, PeriodSelect } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const period = requestPeriod(request, store.ianaTimezone);
  const [summary, snapshots, sync, pending, leaks] = await Promise.all([
    periodSummary(store.id, period),
    prisma.profitSnapshot.findMany({
      where: { storeId: store.id, date: { gte: period.start, lt: period.end } },
      select: { date: true, computedAt: true, confidenceScore: true },
      orderBy: { date: "desc" },
    }),
    prisma.syncJob.findFirst({
      where: {
        storeId: store.id,
        type: { in: ["HISTORICAL_ORDERS", "INCREMENTAL_ORDERS"] },
        status: "COMPLETED",
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.syncJob.count({
      where: {
        storeId: store.id,
        status: { in: ["QUEUED", "RUNNING", "FAILED"] },
      },
    }),
    prisma.profitLeak.findMany({
      where: { storeId: store.id, status: "OPEN" },
      orderBy: { detectedAt: "desc" },
      take: 5,
      select: { id: true, title: true, severity: true },
    }),
  ]);
  return {
    summary,
    period: period.key,
    periodLabel: period.label,
    timeZone: store.ianaTimezone,
    snapshots,
    sync,
    pending,
    leaks,
  };
}

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const ready = !!d.sync && d.snapshots.length > 0;
  const money = (n: number) =>
    ready ? formatMoney(n, d.summary.currency) : "—";
  return (
    <Page title="ProfitPilot AI">
      <div className="pp-toolbar">
        <div>
          <h1>Know what you keep.</h1>
          <p className="pp-muted">
            {d.periodLabel} · {d.timeZone} · {d.summary.currency}
          </p>
        </div>
        <PeriodSelect value={d.period} />
      </div>
      {!ready && (
        <Notice>
          Your profit overview will appear after synchronization and calculation
          finish.{" "}
          <Link to="/app/data-health">View setup and sync progress</Link>.
        </Notice>
      )}
      {!!d.pending && (
        <Notice>
          Data processing needs attention or is still running. Figures may be
          incomplete. <Link to="/app/data-health">Check data health</Link>.
        </Notice>
      )}
      <div className="pp-grid">
        <Card title="Net sales">
          <div className="pp-metric">{money(d.summary.netSalesMinor)}</div>
          <p className="pp-muted">After discounts and refunds</p>
        </Card>
        <Card title="Estimated net profit">
          <div
            className={`pp-metric ${d.summary.netProfitMinor < 0 ? "pp-negative" : ""}`}
          >
            {money(d.summary.netProfitMinor)}
          </div>
          <p className="pp-muted">After recorded costs and expenses</p>
        </Card>
        <Card title="Net margin">
          <div className="pp-metric">
            {ready && d.summary.netMarginBps !== null
              ? `${(d.summary.netMarginBps / 100).toFixed(1)}%`
              : "—"}
          </div>
          <p className="pp-muted">Profit as a share of net sales</p>
        </Card>
        <Card title="Profit Confidence">
          <div className="pp-metric">
            {ready ? `${d.snapshots[0].confidenceScore}/100` : "—"}
          </div>
          <p className="pp-muted">
            Latest calculated day; a data-quality score, not a probability.
          </p>
          <Link to="/app/data-health">See missing inputs</Link>
        </Card>
      </div>
      <Notice>
        Profit is an estimate. Missing COGS, shipping costs, advertising or
        expenses can overstate it. Refunds currently restate the original order
        period. <Link to="/app/help">Calculation limitations</Link>.
      </Notice>
      <Card title="Needs attention">
        {d.leaks.length ? (
          <ul>
            {d.leaks.map((l) => (
              <li key={l.id}>
                <Link to="/app/leaks">{l.title}</Link> ·{" "}
                {l.severity.toLowerCase()}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {ready
              ? "No open alerts from the latest detection run."
              : "Alerts will appear after your data is ready."}
          </p>
        )}
      </Card>
      <Card title="Where the money goes">
        <div className="pp-table-wrap">
          <table>
            <tbody>
              {(
                [
                  ["COGS", d.summary.cogsMinor],
                  ["Shipping cost", d.summary.shippingCostMinor],
                  ["Payment fees", d.summary.paymentFeesMinor],
                  ["Advertising", d.summary.adSpendMinor],
                  ["Other expenses", d.summary.otherExpensesMinor],
                  ["Refunded product sales", d.summary.refundsMinor],
                ] as const
              ).map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{money(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Ask ProfitPilot">
        <p>Explore your measured changes and the inputs behind them.</p>
        <Link to="/app/ask">Ask about your profit</Link>
      </Card>
      <p className="pp-muted">
        Last completed order sync:{" "}
        {d.sync?.finishedAt
          ? new Date(d.sync.finishedAt).toLocaleString()
          : "Not yet completed"}
        . Calculations use recorded data and merchant assumptions.
      </p>
    </Page>
  );
}
