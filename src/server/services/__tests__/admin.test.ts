import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  bucketizeByMonth,
  calculateTrendDelta,
  getMonthBuckets,
  startOfMonth,
  sumSeries,
} from "~/server/services/admin";

describe("admin service helpers", () => {
  it("computes UTC month boundaries", () => {
    const date = new Date("2024-02-15T10:30:00Z");
    const start = startOfMonth(date);
    assert.equal(start.toISOString(), "2024-02-01T00:00:00.000Z");
  });

  it("builds the requested number of month buckets ending with current month", () => {
    const now = new Date("2024-06-05T12:00:00Z");
    const buckets = getMonthBuckets(now, 3);
    assert.equal(buckets.length, 3);
    assert.equal(buckets[0]?.label, "Apr");
    assert.equal(buckets[2]?.label, "Jun");
  });

  it("groups dates into their respective month buckets", () => {
    const now = new Date("2024-06-05T12:00:00Z");
    const dates = [
      new Date("2024-04-10T00:00:00Z"),
      new Date("2024-05-01T00:00:00Z"),
      new Date("2024-05-15T00:00:00Z"),
      new Date("2024-06-01T00:00:00Z"),
    ];
    const series = bucketizeByMonth(dates, 3, now);
    assert.deepEqual(
      series.map((point) => point.value),
      [1, 2, 1],
    );
  });

  it("calculates trend deltas with correct direction", () => {
    const deltaUp = calculateTrendDelta(10, 5);
    assert.equal(deltaUp.direction, "increase");
    assert.equal(deltaUp.delta, 5);

    const deltaDown = calculateTrendDelta(3, 6);
    assert.equal(deltaDown.direction, "decrease");
    assert.equal(deltaDown.percent, 50);

    const neutral = calculateTrendDelta(0, 0);
    assert.equal(neutral.direction, "neutral");
  });

  it("sums series values", () => {
    const total = sumSeries([
      { label: "Jan", value: 1 },
      { label: "Feb", value: 2 },
    ]);
    assert.equal(total, 3);
  });
});

