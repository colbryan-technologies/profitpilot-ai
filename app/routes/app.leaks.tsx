import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { formData, formResult } from "../services/form.server";
import { Page, Card, Notice, Submit, Feedback } from "../components/ui";
import type { LeakEvidence } from "../domain/leaks";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const rows = await prisma.profitLeak.findMany({
    where: { storeId: store.id, status: "OPEN" },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return {
    leaks: rows
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .map((l) => ({
        id: l.id,
        title: l.title,
        severity: l.severity,
        evidence: l.evidenceJson as unknown as LeakEvidence,
      })),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const f = await formData(request);
  return formResult(async () => {
    const result = await prisma.profitLeak.updateMany({
      where: { id: f.id, storeId: store.id, status: "OPEN" },
      data: { status: "DISMISSED", dismissedAt: new Date() },
    });
    if (!result.count) throw new Response("Alert not found", { status: 404 });
    return "Alert dismissed for this comparison period.";
  });
}
export default function Leaks() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Profit leaks">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        These are measured changes worth investigating, not proof of causation.
        Product advertising costs are allocated by net sales, not attributed to
        individual purchases.
      </Notice>
      {d.leaks.map((l) => (
        <Card key={l.id} title={l.title}>
          <p>{l.severity.toLowerCase()} priority</p>
          <ul>
            {l.evidence.facts?.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <Form method="post">
            <input type="hidden" name="id" value={l.id} />
            <Submit>Dismiss for this period</Submit>
          </Form>
        </Card>
      ))}
      {!d.leaks.length && (
        <Card title="No open alerts">
          <p>
            Alerts appear after synchronization, calculation and detection
            complete. No alerts does not establish that all costs are recorded.
          </p>
        </Card>
      )}
    </Page>
  );
}
