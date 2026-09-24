import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import { storedCoverage } from "../services/import-coverage.server";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { startInitialSync } from "../services/jobs/sync-runner.server";
import { enqueueRecalculate, enqueueSync } from "../services/jobs/queue.server";
import { formData, formResult } from "../services/form.server";
import { Page, Card, Notice, Submit, Feedback } from "../components/ui";
import type { ConfidenceResult } from "../domain/confidence";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const [jobs, snapshot, orders, variants, failures] = await Promise.all([
    prisma.syncJob.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        processed: true,
        finishedAt: true,
      },
    }),
    prisma.profitSnapshot.findFirst({
      where: { storeId: store.id },
      orderBy: { date: "desc" },
      select: { confidenceJson: true, computedAt: true },
    }),
    prisma.order.count({ where: { storeId: store.id } }),
    prisma.variant.count({ where: { storeId: store.id, deletedAt: null } }),
    prisma.webhookEvent.count({
      where: { storeId: store.id, status: { in: ["FAILED", "DEAD_LETTER"] } },
    }),
  ]);
  const coverage = await storedCoverage(store.id, store.ianaTimezone);
  return {
    coverage: coverage.ranges,
    coveredDays: coverage.days.size,
    jobs,
    orders,
    variants,
    failures,
    confidence: snapshot?.confidenceJson as ConfidenceResult | null,
    computedAt: snapshot?.computedAt,
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const form = await formData(request);
  return formResult(async () => {
    if (form.intent === "recalculate") await enqueueRecalculate(store.id);
    else if (form.intent === "resync")
      await startInitialSync(store.id, store.shopDomain);
    else if (form.intent === "sync") {
      const history = await prisma.syncJob.findFirst({
        where: {
          storeId: store.id,
          type: "HISTORICAL_ORDERS",
          status: "COMPLETED",
        },
      });
      if (history)
        await enqueueSync(store.id, store.shopDomain, "INCREMENTAL_ORDERS");
      else await startInitialSync(store.id, store.shopDomain);
    } else throw new Response("Unknown action", { status: 400 });
    return "Work queued. Refresh this page to see progress.";
  });
}
export default function Health() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Data health & setup">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        Complete synchronization, enter your costs, and confirm fee and tax
        assumptions before relying on profit estimates.
      </Notice>
      <Card title="Setup checklist">
        <ol>
          <li>Synchronize Shopify orders and products.</li>
          <li>
            <Link to="/app/cogs">Review product costs</Link>.
          </li>
          <li>
            <Link to="/app/settings">
              Confirm tax, fees and shipping estimates
            </Link>
            .
          </li>
          <li>
            <Link to="/app/advertising">Record advertising spend</Link> and{" "}
            <Link to="/app/expenses">expenses</Link>.
          </li>
        </ol>
        <p>
          {d.orders} stored orders · {d.variants} active variants · {d.failures}{" "}
          failed webhook records
        </p>
        <Form method="post" className="pp-toolbar">
          <Submit name="intent" value="sync">
            Synchronize
          </Submit>
          <Submit name="intent" value="resync">
            Reimport history
          </Submit>
          <Submit name="intent" value="recalculate">
            Recalculate
          </Submit>
        </Form>
      </Card>
      <Card title="Recorded import coverage">
        <p>
          {d.coveredDays} store-calendar days covered by completed imports.
          Today is provisional.
        </p>
        {d.coverage.map((r, i) => (
          <p key={i}>
            {new Date(r.start).toISOString()} to {new Date(r.end).toISOString()}
          </p>
        ))}
        {!d.coverage.length && (
          <p>
            No recorded coverage yet. Reimport history after verifying Shopify
            permissions; older imports do not establish date coverage.
          </p>
        )}
      </Card>
      <Card title="Profit Confidence">
        {d.confidence ? (
          <>
            <p>
              Latest calculated score: {d.confidence.score}/100. Calculated{" "}
              {d.computedAt ? new Date(d.computedAt).toLocaleString() : "—"}.
            </p>
            <ul>
              {d.confidence.indicators.map((i) => (
                <li key={i.key}>
                  <strong>{i.label}</strong> · {i.points}/{i.weight} points
                  <p>
                    {i.detail}{" "}
                    {i.actionHref && <Link to={i.actionHref}>Review</Link>}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>No calculations yet.</p>
        )}
      </Card>
      <Card title="Recent background work">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Processed</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {d.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.type.toLowerCase().replaceAll("_", " ")}</td>
                  <td>{j.status}</td>
                  <td>{j.processed}</td>
                  <td>{j.progress}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.jobs.length && (
          <p>No jobs recorded. Start synchronization above.</p>
        )}
      </Card>
    </Page>
  );
}
