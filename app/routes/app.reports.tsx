import { formData, formResult } from "../services/form.server";
import { generateWeeklyDigest } from "../services/ai/digest.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import { storeEntitlements } from "../services/billing.server";
import { reportWindow } from "../services/report-access.server";
import { savedBriefingState } from "../services/saved-reports.server";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { Page, Card, Submit, Feedback } from "../components/ui";
export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const history = await reportWindow(store.id);
  const { plan } = await storeEntitlements(store.id);
  if (!plan.digest) return { available: false, reports: [] };
  const reports = await prisma.intelligenceDigest.findMany({
    where: {
      storeId: store.id,
      periodStart: {
        gte: new Date(history.start.getTime() + 7 * 86_400_000),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      storeId: true,
      summary: true,
      periodStart: true,
      periodEnd: true,
      createdAt: true,
      metricsJson: true,
    },
  });
  return {
    available: true,
    reports: await Promise.all(
      reports.map(async (r) => {
        const state = await savedBriefingState(r);
        return {
          id: r.id,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          createdAt: r.createdAt,
          summary: state.available ? r.summary : null,
          reason: state.reason,
          warnings: state.warnings,
        };
      }),
    ),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const form = await formData(request);
  return formResult(async () => {
    const digestId = form.digestId;
    if (digestId !== undefined && (!digestId.trim() || digestId.length > 200))
      throw new Response("Invalid briefing selection.", { status: 400 });
    await generateWeeklyDigest(store.id, digestId);
    return digestId
      ? "The selected briefing is ready."
      : "This week's briefing is ready.";
  });
}
export default function Reports() {
  const { reports, available } = useLoaderData<typeof loader>();
  return (
    <Page title="Profit briefings">
      <Feedback result={useActionData<typeof action>()} />
      {available && (
        <Form method="post">
          <Submit>Refresh this week’s briefing</Submit>
        </Form>
      )}
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
          {r.summary ? (
            <p className="pp-answer">{r.summary}</p>
          ) : (
            <p>
              {r.reason} <Link to="/app/data-health">Data health</Link>.
            </p>
          )}
          {!r.summary && (
            <Form method="post">
              <input type="hidden" name="digestId" value={r.id} />
              <Submit>Refresh this briefing</Submit>
            </Form>
          )}
          <p>Generated {new Date(r.createdAt).toLocaleString()}.</p>
          {r.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
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
