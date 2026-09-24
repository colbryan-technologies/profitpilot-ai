import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Page, Card } from "./ui";
export function ReportErrorBoundary() {
  const error = useRouteError();
  if (
    !isRouteErrorResponse(error) ||
    ![403, 503].includes(error.status) ||
    typeof error.data !== "string" ||
    !(
      error.data.startsWith("This period is outside") ||
      error.data.startsWith("Report data is not ready")
    )
  )
    throw error;
  return (
    <Page title="Report unavailable">
      <Card title="Check report availability">
        <p>{error.data}</p>
        <Link to="/app?period=7d">View last 7 days</Link>
        {" · "}
        <Link to="/app/billing">Manage plan</Link>
        {" · "}
        <Link to="/app/data-health">Data health</Link>
      </Card>
    </Page>
  );
}
