import assert from "node:assert/strict";
import test from "node:test";

import { buildDateTimeDimensionValue, normalizeDateFormatConfig } from "~/server/services/date-time";

void test("date-time dimension derives local date boundaries in non-UTC time zones", () => {
  const row = buildDateTimeDimensionValue(new Date("2026-04-07T00:30:00.000Z"), {
    timeZone: "America/Los_Angeles",
    formatConfig: normalizeDateFormatConfig(undefined),
  });

  assert.equal(row.fullDate, "2026-04-06");
  assert.equal(row.calendarDate, "2026-04-06");
  assert.equal(row.dayOfWeekName, "Monday");
  assert.equal(row.monthYearText, "April 2026");
  assert.equal(row.previousDate, "2026-04-05");
  assert.equal(row.nextDate, "2026-04-07");
});

void test("date-time dimension respects configured date format patterns", () => {
  const row = buildDateTimeDimensionValue(new Date("2026-12-31T23:15:45.000Z"), {
    timeZone: "UTC",
    formatConfig: normalizeDateFormatConfig({
      dateKeyPattern: "YYYY-MM-DD",
      isoDatePattern: "DD/MM/YYYY",
      usDatePattern: "MMMM D, YYYY",
      longDatePattern: "ddd, MMM D YYYY",
      monthYearPattern: "MMM YYYY",
      yearMonthLabelPattern: "MMM-YYYY",
      yearQuarterLabelPattern: "[Quarter] Q YYYY",
      quarterYearLabelPattern: "YYYY [quarter] Q",
      isoDateTimePattern: "YYYY/MM/DD HH:mm:ss",
      usDateTimePattern: "MM-DD-YYYY hh:mm:ss A",
    }),
  });

  assert.equal(row.dateKey, "2026-12-31");
  assert.equal(row.dateIsoFormat, "31/12/2026");
  assert.equal(row.dateUsFormat, "December 31, 2026");
  assert.equal(row.dateLongFormat, "Thu, Dec 31 2026");
  assert.equal(row.monthYearText, "Dec 2026");
  assert.equal(row.yearMonthLabel, "Dec-2026");
  assert.equal(row.yearQuarterLabel, "Quarter 4 2026");
  assert.equal(row.quarterYearLabel, "2026 quarter 4");
  assert.equal(row.isoDateTime, "2026/12/31 23:15:45");
  assert.equal(row.usDateTime, "12-31-2026 11:15:45 PM");
});
