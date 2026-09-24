import type { ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router";
import "./ui.css";

export function Page({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <s-page heading={title}>
      <div className="pp-page">{children}</div>
    </s-page>
  );
}
export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="pp-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="pp-notice" role="status">
      {children}
    </div>
  );
}
export function Feedback({
  result,
}: {
  result?: { error?: string; message?: string };
}) {
  return result?.error ? (
    <div className="pp-error" role="alert">
      {result.error}
    </div>
  ) : result?.message ? (
    <Notice>{result.message}</Notice>
  ) : null;
}
export function Submit({
  children = "Save",
  name,
  value,
}: {
  children?: ReactNode;
  name?: string;
  value?: string;
}) {
  const busy = useNavigation().state !== "idle";
  return (
    <button
      className="pp-button"
      type="submit"
      disabled={busy}
      name={name}
      value={value}
    >
      {busy ? "Working…" : children}
    </button>
  );
}
export function Field({
  label,
  name,
  value,
  type = "text",
  required = true,
  step,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label className="pp-field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        step={step}
      />
    </label>
  );
}
export function PeriodSelect({ value }: { value: string }) {
  return (
    <Form method="get" className="pp-toolbar">
      <label>
        Period{" "}
        <select name="period" defaultValue={value}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="mtd">Month to date</option>
          <option value="last_month">Last month</option>
        </select>
      </label>
      <button type="submit">Apply</button>
    </Form>
  );
}
export function Pagination({ page, more }: { page: number; more: boolean }) {
  return (
    <nav aria-label="Pagination" className="pp-toolbar">
      {page > 1 && <Link to={`?page=${page - 1}`}>Previous</Link>}
      <span>Page {page}</span>
      {more && <Link to={`?page=${page + 1}`}>Next</Link>}
    </nav>
  );
}
