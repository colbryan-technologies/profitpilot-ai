import { useEffect, useRef } from "react";
import { Link, useNavigation, useRevalidator } from "react-router";
import { startBackgroundRefresh } from "../lib/background-refresh";
import { Notice } from "./ui";

export function BackgroundWork({
  active,
  recalculating,
}: {
  active: boolean;
  recalculating: boolean;
}) {
  const { revalidate, state } = useRevalidator();
  const navigation = useNavigation();
  const wasActive = useRef(active);
  useEffect(() => {
    if (navigation.state !== "idle" || state !== "idle") return;
    // Parent and child loaders run concurrently. Fetch once more after observing
    // completion so a child cannot retain a snapshot read just before it finished.
    if (wasActive.current && !active) {
      wasActive.current = false;
      void revalidate();
      return;
    }
    wasActive.current = active;
    if (active) return startBackgroundRefresh(revalidate, document);
  }, [active, navigation.state, revalidate, state]);

  return active ? (
    <div className="pp-page">
      <Notice>
        {recalculating ? "Recalculating…" : "Updating your data…"} This page
        will update automatically when the work finishes.{" "}
        <Link to="/app/data-health">View progress</Link>.
      </Notice>
    </div>
  ) : null;
}
