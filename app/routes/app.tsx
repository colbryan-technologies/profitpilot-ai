import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  useLoaderData,
  useRouteError,
  useNavigation,
} from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  useEffect(() => {
    shopify.loading(navigation.state !== "idle");
  }, [shopify, navigation.state]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/orders">Orders</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/cogs">COGS</s-link>
        <s-link href="/app/expenses">Expenses</s-link>
        <s-link href="/app/advertising">Advertising</s-link>
        <s-link href="/app/leaks">Profit leaks</s-link>
        <s-link href="/app/ask">Ask ProfitPilot</s-link>
        <s-link href="/app/data-health">Data health</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
