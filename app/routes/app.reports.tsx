import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { storeEntitlements } from "../services/billing.server";
import { reportWindow } from "../services/report-access.server";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { Page, Card } from "../components/ui";
export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const history = await reportWindow(store.id);
  const { plan } = await storeEntitlements(store.id);
  if (!plan.digest) return { available: false, reports: [] };
  return {
    available: true,
    reports: await prisma.intelligenceDigest.findMany({
      where: {
        storeId: store.id,
        periodStart: {
          gte: new Date(history.start.getTime() + 7 * 86_400_000),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, summary: true, periodStart: true, periodEnd: true },
    }),
  };
}
export default function Reports() {
  const { reports, available } = useLoaderData<typeof loader>();
  return (
    <Page title="Profit briefings">
      {!available && (
        <Card title="Weekly briefings">
          <p>
            Weekly briefings are included with Starter and above.{" "}
            <Link to="/app/billing">Manage your plan</Link>.
          </p>
        </Card>
      )}
      {reports.map((r) => (
        <Card
          key={r.id}
          title={`Week from ${new Date(r.periodStart).toISOString().slice(0, 10)}`}
        >
          <p className="pp-answer">{r.summary}</p>
        </Card>
      ))}
      {available && !reports.length && (
        <Card title="No briefings yet">
          <p>
            After synchronization, the worker generates a briefing at your
            configured Monday hour. Manage this in Briefings & AI sharing under
            Settings.
          </p>
        </Card>
      )}
    </Page>
  );
}
