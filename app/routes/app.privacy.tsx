import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { tenant } from "../services/tenant.server";
import prisma from "../db.server";
import { formData, formResult } from "../services/form.server";
import { fulfillPrivacyRequest } from "../services/privacy.server";
import { Page, Card, Feedback, Notice, Submit } from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const requests = await prisma.privacyRequest.findMany({
    where: { storeId: store.id },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 100,
    select: {
      id: true,
      requestId: true,
      status: true,
      receivedAt: true,
      dueAt: true,
      fulfilledAt: true,
    },
  });
  return { requests, now: new Date().toISOString() };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const f = await formData(request);
  return formResult(async () => {
    if (!f.id || f.confirm !== "delivered")
      throw new Response("Confirm delivery before closing this request", {
        status: 400,
      });
    await fulfillPrivacyRequest(store.id, f.id);
    return "Delivery recorded. Customer lookup identifiers have been removed from this request.";
  });
}
export default function Privacy() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Privacy requests">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        Review each export and provide the relevant data to the requesting
        customer through your verified support process. Downloading does not
        mark delivery complete. Keep downloaded files private and delete them
        when no longer needed.
      </Notice>
      <Card title="Requests from Shopify">
        <p>
          The export contains records held by ProfitPilot, including internal
          financial calculations. Review it before sharing. Requests with no
          matching stored records produce an empty export. This page shows up to
          100 requests, with pending requests first.
        </p>
        {!d.requests.length && <p>No requests received.</p>}
        {d.requests.map((r) => (
          <section key={r.id}>
            <h3>Request {r.requestId}</h3>
            <p>
              {r.status} · Due {new Date(r.dueAt).toISOString().slice(0, 10)}
              {r.status === "PENDING" && new Date(r.dueAt) < new Date(d.now)
                ? " · Overdue"
                : ""}
            </p>
            {r.status === "PENDING" && (
              <>
                <Form
                  method="post"
                  action={`/app/privacy/${r.id}/export`}
                  reloadDocument
                >
                  <Submit>Download private export</Submit>
                </Form>
                <Form method="post">
                  <input type="hidden" name="id" value={r.id} />
                  <label>
                    <input
                      type="checkbox"
                      name="confirm"
                      value="delivered"
                      required
                    />{" "}
                    I reviewed the export and completed delivery through our
                    support process.
                  </label>
                  <Submit>Record completed delivery</Submit>
                </Form>
              </>
            )}
          </section>
        ))}
      </Card>
    </Page>
  );
}
