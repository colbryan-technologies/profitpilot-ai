import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { tenant } from "../services/tenant.server";
import { formData, formResult } from "../services/form.server";
import {
  notificationSchema,
  saveNotificationPrefs,
} from "../services/settings.server";
import { Page, Card, Field, Submit, Feedback, Notice } from "../components/ui";
import { env } from "../lib/env.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  return {
    pref: await prisma.notificationPreference.findUnique({
      where: { storeId: store.id },
    }),
    aiEnabled: store.aiEnabled,
    provider: env().AI_PROVIDER,
    timeZone: store.ianaTimezone,
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const f = await formData(request);
  return formResult(async () => {
    await saveNotificationPrefs(
      store.id,
      notificationSchema.parse({ ...f, dailyDigest: false, leakAlerts: false }),
    );
    await prisma.store.update({
      where: { id: store.id },
      data: { aiEnabled: f.aiEnabled === "on" },
    });
    return "Preferences saved.";
  });
}
export default function Notifications() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Briefings & AI sharing">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        Weekly briefings appear inside <Link to="/app/reports">Reports</Link>.
        Email delivery, daily briefings and external alert delivery are not
        enabled.
      </Notice>
      <Card title="Preferences">
        <Form method="post">
          <label className="pp-field">
            <span>
              <input
                type="checkbox"
                name="weeklyDigest"
                defaultChecked={d.pref?.weeklyDigest ?? true}
              />{" "}
              Generate a weekly briefing
            </span>
          </label>
          <Field
            label={`Monday generation hour (0–23, ${d.timeZone})`}
            name="deliveryHour"
            type="number"
            value={d.pref?.deliveryHour ?? 8}
          />
          <h3>Optional AI explanations</h3>
          <p>
            Enabling this shares aggregated financial summaries, product titles,
            your questions and recent conversation context with the configured
            AI provider (
            {d.provider === "none" ? "none configured" : d.provider}). Customer
            names and addresses are not included in the grounding summary. Do
            not enter personal information in your questions. Financial
            calculations continue without AI.
          </p>
          <label className="pp-field">
            <span>
              <input
                type="checkbox"
                name="aiEnabled"
                defaultChecked={d.aiEnabled}
              />{" "}
              Allow AI sharing for this store
            </span>
          </label>
          <Submit>Save preferences</Submit>
        </Form>
      </Card>
    </Page>
  );
}
