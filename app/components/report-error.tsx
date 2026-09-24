import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Page, Card } from "./ui";
export function ReportErrorBoundary() {
  const error = useRouteError();
  if (
    !isRouteErrorResponse(error) ||
    error.status !== 403 ||
    typeof error.data !== "string" ||
    !error.data.startsWith("This period is outside")
  )
    throw error;
  return (
    <Page title="Report unavailable">
      <Card title="Choose an included period">
        <p>{error.data}</p>
        <Link to="/app?period=7d">View last 7 days</Link>
        {" · "}
        <Link to="/app/billing">Manage plan</Link>
      </Card>
    </Page>
  );
}
