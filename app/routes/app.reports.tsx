import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { Page, Card } from "../components/ui";
export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  return {
    reports: await prisma.intelligenceDigest.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, summary: true, periodStart: true, periodEnd: true },
    }),
  };
}
export default function Reports() {
  const { reports } = useLoaderData<typeof loader>();
  return (
    <Page title="Profit briefings">
      {reports.map((r) => (
        <Card
          key={r.id}
          title={`Week from ${new Date(r.periodStart).toISOString().slice(0, 10)}`}
        >
          <p className="pp-answer">{r.summary}</p>
        </Card>
      ))}
      {!reports.length && (
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
