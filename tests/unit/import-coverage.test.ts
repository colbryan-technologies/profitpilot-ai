import { describe, it, expect } from "vitest";
import {
  coverageIntervals,
  coveredCalendarDays,
  importWindow,
} from "../../app/services/import-coverage.server";
const w = (
  kind: "historical" | "incremental",
  since: string,
  through: string,
) => ({ importWindow: importWindow(kind, new Date(since), new Date(through)) });
describe("recorded import coverage", () => {
  it("ignores legacy and malformed records", () =>
    expect(
      coverageIntervals([
        {},
        null,
        {
          importWindow: {
            version: 1,
            kind: "historical",
            since: "bad",
            through: "bad",
          },
        },
      ]),
    ).toEqual([]));
  it("never derives historical coverage from updates alone", () =>
    expect(
      coverageIntervals([w("incremental", "2026-09-01", "2026-09-24")]),
    ).toEqual([]));
  it("extends overlapping updates without filling gaps", () => {
    const ranges = coverageIntervals([
      w("historical", "2026-09-01", "2026-09-10"),
      w("incremental", "2026-09-09", "2026-09-12"),
      w("incremental", "2026-09-13", "2026-09-24"),
    ]);
    expect(ranges).toEqual([
      { start: new Date("2026-09-01"), end: new Date("2026-09-12") },
    ]);
  });
  it("merges adjacent independently completed historical ranges", () =>
    expect(
      coverageIntervals([
        w("historical", "2026-09-01", "2026-09-10"),
        w("historical", "2026-09-10", "2026-09-20"),
      ]),
    ).toEqual([
      { start: new Date("2026-09-01"), end: new Date("2026-09-20") },
    ]));
  it("excludes partial first and last past local days", () => {
    const days = coveredCalendarDays(
      [
        {
          start: new Date("2026-03-07T18:00:00Z"),
          end: new Date("2026-03-10T14:00:00Z"),
        },
      ],
      "America/New_York",
      new Date("2026-03-11T12:00:00Z"),
    );
    expect([...days]).toEqual(["2026-03-08", "2026-03-09"]);
  });
  it("allows the ongoing local day through the import timestamp", () =>
    expect([
      ...coveredCalendarDays(
        [
          {
            start: new Date("2026-09-22T12:00:00Z"),
            end: new Date("2026-09-24T10:00:00Z"),
          },
        ],
        "UTC",
        new Date("2026-09-24T12:00:00Z"),
      ),
    ]).toEqual(["2026-09-23", "2026-09-24"]));
  it("rejects reversed import windows", () =>
    expect(() =>
      importWindow(
        "historical",
        new Date("2026-09-24"),
        new Date("2026-09-01"),
      ),
    ).toThrow("Invalid import window"));
});
