import type { ActionFunctionArgs } from "react-router";
import { tenant } from "../services/tenant.server";
import {
  privacyExportPage,
  requirePrivacyRequest,
} from "../services/privacy.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { store } = await tenant(request);
  const record = await requirePrivacyRequest(store.id, params.id ?? "");
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let first = true;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const page = await privacyExportPage(store.id, record.id, cursor);
        if (cancelled) return;
        let text = first
          ? JSON.stringify({
              type: "manifest",
              requestId: record.requestId,
              exportedAt: new Date().toISOString(),
              format: "ProfitPilot privacy export v1",
              scope:
                "Stored order records matching this Shopify request; review before delivery",
            }) + "\n"
          : "";
        first = false;
        text +=
          page.orders
            .map((order) => JSON.stringify({ type: "order", data: order }))
            .join("\n") + "\n";
        controller.enqueue(encoder.encode(text));
        if (!page.nextCursor) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "end", complete: true }) + "\n",
            ),
          );
          controller.close();
        } else cursor = page.nextCursor;
      } catch {
        if (!cancelled)
          controller.error(
            new Error(
              "Export interrupted. Do not use a partial file; retry the request.",
            ),
          );
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="profitpilot-privacy-${record.id}.jsonl"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
