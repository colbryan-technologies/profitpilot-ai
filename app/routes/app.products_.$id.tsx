import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { loader as productsLoader } from "./app.products";
import { Page, Card, Notice } from "../components/ui";
import { formatMoney } from "../lib/money";

export async function loader(args: LoaderFunctionArgs) {
  const d = await productsLoader(args);
  const p = d.products.find((p) => p.productId === args.params.id);
  if (!p)
    throw new Response("Product not found in this period", { status: 404 });
  return { p, currency: d.currency, period: d.period };
}
export default function ProductDetail() {
  const { p, currency, period } = useLoaderData<typeof loader>();
  return (
    <Page title={p.title}>
      <Link to={`/app/products?period=${period}`}>Back to products</Link>
      <Notice>
        {p.missingCogs ? "COGS is missing for some sold units. " : ""}Order and
        advertising costs below are allocations by net sales.
      </Notice>
      <Card title="Product breakdown">
        <table>
          <tbody>
            {(
              [
                ["Net sales", p.netSalesMinor],
                ["COGS", p.cogsMinor],
                ["Gross profit", p.grossProfitMinor],
                ["Allocated order costs", p.allocatedCostsMinor],
                ["Allocated advertising", p.allocatedAdSpendMinor],
                ["Estimated contribution", p.contributionProfitMinor],
              ] as const
            ).map(([label, n]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{formatMoney(n, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
