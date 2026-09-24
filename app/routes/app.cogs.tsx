import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import prisma from "../db.server";
import { tenant, pageNumber } from "../services/tenant.server";
import {
  setCogs,
  previewCogsCsv,
  importCogsCsv,
} from "../services/cogs.server";
import { formData, formResult } from "../services/form.server";
import { formatMoney } from "../lib/money";
import {
  Page,
  Card,
  Field,
  Submit,
  Feedback,
  Pagination,
  Notice,
} from "../components/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const page = pageNumber(request);
  const variants = await prisma.variant.findMany({
    where: { storeId: store.id, deletedAt: null },
    orderBy: { id: "asc" },
    skip: (page - 1) * 50,
    take: 51,
    select: {
      id: true,
      title: true,
      sku: true,
      shopifyUnitCostMinor: true,
      shopifyUnitCostCurrency: true,
      product: { select: { title: true } },
      cogs: {
        where: { effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { unitCostMinor: true, currency: true, effectiveFrom: true },
      },
    },
  });
  return {
    currency: store.currency,
    variants: variants.slice(0, 50),
    more: variants.length > 50,
    page,
  };
}
const entrySchema = z.object({
  variantId: z.string().min(1),
  cost: z.string().regex(/^\d+(\.\d+)?$/),
  date: z.iso.date(),
});
export async function action({ request }: ActionFunctionArgs) {
  const { store, actorId } = await tenant(request);
  const form = await formData(request);
  return formResult(async () => {
    if (form.intent === "import") {
      const csv = z.string().min(1).max(1_000_000).parse(form.csv);
      const preview = await previewCogsCsv(store.id, csv);
      if (preview.unmatched.length)
        throw new Response(
          `Import not saved: ${preview.unmatched.length} rows need correction. ${preview.unmatched
            .slice(0, 5)
            .map((r) => `Row ${r.row}: ${r.reason}`)
            .join("; ")}`,
          { status: 400 },
        );
      const result = await importCogsCsv(store.id, csv, actorId);
      return `${result.written} cost records saved. Recalculation queued.`;
    }
    const f = entrySchema.parse(form);
    const result = await setCogs(
      store.id,
      [
        {
          variantId: f.variantId,
          unitCost: f.cost,
          effectiveFrom: new Date(f.date),
        },
      ],
      "MANUAL",
      actorId,
    );
    if (!result.written)
      throw new Response("Variant not found in this store", { status: 404 });
    return "Cost saved. Historical profits will be recalculated from the effective date.";
  });
}
export default function Cogs() {
  const d = useLoaderData<typeof loader>();
  return (
    <Page title="Cost of goods">
      <Feedback result={useActionData<typeof action>()} />
      <Notice>
        Costs use {d.currency}. Use the date the cost took effect. Earlier
        orders may use the earliest known cost as an estimate; inspect
        historical results before relying on them.
      </Notice>
      <Card title="Record a cost">
        {d.variants.length ? (
          <Form method="post">
            <label className="pp-field">
              Variant
              <select name="variantId" required>
                {d.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.product.title} · {v.title} · {v.sku ?? "No SKU"}
                  </option>
                ))}
              </select>
            </label>
            <Field label={`Unit cost (${d.currency})`} name="cost" />
            <Field label="Effective from" name="date" type="date" />
            <Submit>Save cost</Submit>
          </Form>
        ) : (
          <p>Products will appear after synchronization.</p>
        )}
      </Card>
      <Card title="Current recorded costs">
        <div className="pp-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product / variant</th>
                <th>SKU</th>
                <th>Unit cost</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {d.variants.map((v) => {
                const cost = v.cogs[0];
                return (
                  <tr key={v.id}>
                    <td>
                      {v.product.title} · {v.title}
                    </td>
                    <td>{v.sku ?? "—"}</td>
                    <td>
                      {cost
                        ? formatMoney(cost.unitCostMinor, cost.currency)
                        : v.shopifyUnitCostMinor !== null &&
                            v.shopifyUnitCostCurrency
                          ? formatMoney(
                              v.shopifyUnitCostMinor,
                              v.shopifyUnitCostCurrency,
                            )
                          : "Missing"}
                    </td>
                    <td>
                      {cost
                        ? `Effective ${new Date(cost.effectiveFrom).toISOString().slice(0, 10)}`
                        : v.shopifyUnitCostMinor !== null
                          ? "Shopify current estimate"
                          : "Not recorded"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={d.page} more={d.more} />
      </Card>
      <Card title="Bulk CSV import">
        <p>
          Headers: variant_id, sku, unit_cost, effective_from. Match using a
          Shopify variant ID or a unique SKU. Use YYYY-MM-DD dates. Import saves
          all valid rows and queues recalculation.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="import" />
          <label className="pp-field">
            CSV contents
            <textarea
              name="csv"
              required
              maxLength={1_000_000}
              placeholder={
                "sku,unit_cost,effective_from\nHOOD-1,10.50,2026-04-01"
              }
            />
          </label>
          <Submit>Import costs</Submit>
        </Form>
      </Card>
    </Page>
  );
}
