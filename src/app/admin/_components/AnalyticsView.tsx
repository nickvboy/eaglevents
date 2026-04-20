"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

import { AnalyticsFilterBar } from "./analytics/AnalyticsFilterBar";
import { AnalyticsKpiGrid } from "./analytics/AnalyticsKpiGrid";
import { AnalyticsLoadingState } from "./analytics/AnalyticsLoadingState";
import { AnalyticsSectionTabs } from "./analytics/AnalyticsSectionTabs";
import { BoxPlotCard } from "./analytics/BoxPlotCard";
import { CalendarHeatmapCard } from "./analytics/CalendarHeatmapCard";
import { CoverageBadge } from "./analytics/CoverageBadge";
import { DonutChartCard } from "./analytics/DonutChartCard";
import { EmptyAnalyticsState } from "./analytics/EmptyAnalyticsState";
import { HeatmapCard } from "./analytics/HeatmapCard";
import { RankedBarChartCard } from "./analytics/RankedBarChartCard";
import { StackedCompositionChartCard } from "./analytics/StackedCompositionChartCard";
import { TimeSeriesChartCard } from "./analytics/TimeSeriesChartCard";
import { TimelineLanesCard } from "./analytics/TimelineLanesCard";
import { AnalyticsCard } from "./analytics/AnalyticsCard";

type AnalyticsFilters = NonNullable<
  NonNullable<RouterInputs["admin"]["analytics"]["overview"]>["filters"]
>;
type AnalyticsMeta = RouterOutputs["admin"]["analytics"]["meta"];
type SectionId = "overview" | "trends" | "eventTypes" | "locations" | "requesters" | "attendees" | "durations" | "overlap";

const defaultFilters: AnalyticsFilters = {
  rangePreset: "12M",
  customStart: null,
  customEnd: null,
  frequency: "auto",
  buildingIds: [],
  roomIds: [],
  eventTypes: [],
  requestCategories: [],
  requesterKeys: [],
  locationMode: "all",
  includeAllDay: true,
};

const sections: Array<{ id: SectionId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "eventTypes", label: "Event Types" },
  { id: "locations", label: "Locations" },
  { id: "requesters", label: "Requesters" },
  { id: "attendees", label: "Attendees" },
  { id: "durations", label: "Durations" },
  { id: "overlap", label: "Overlap" },
];

const controlClass =
  "rounded-lg border border-outline-muted bg-surface-canvas px-3 py-2 text-sm text-ink-primary outline-none transition focus:border-accent-strong";
const ANALYTICS_TOP_N_MIN = 3;
const ANALYTICS_TOP_N_MAX = 25;

function parseBoundedInteger(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function CommitNumberInput(props: {
  className: string;
  value: number;
  min: number;
  max: number;
  fallback: number;
  onCommit: (value: number) => void;
}) {
  const { className, value, min, max, fallback, onCommit } = props;
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const nextValue = parseBoundedInteger(draft, min, max, fallback);
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onCommit(nextValue);
    }
  };

  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 text-sm text-status-danger">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-full border border-status-danger px-4 py-2 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

function ScatterCard({
  title,
  helper,
  data,
}: {
  title: string;
  helper: string;
  data: Array<{ x: number; y: number; label: string }>;
}) {
  return (
    <AnalyticsCard title={title} helper={helper}>
      {data.length === 0 ? (
        <EmptyAnalyticsState message="Participant coverage is too low for a scatter view." />
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <XAxis dataKey="x" name="Participants" />
              <YAxis dataKey="y" name="Duration" unit="h" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={data} fill="var(--color-accent-strong)" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </AnalyticsCard>
  );
}

export function AnalyticsView() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);

  const [overviewTopN, setOverviewTopN] = useState(10);
  const [overviewMetric, setOverviewMetric] = useState<"eventCount" | "scheduledHours">("eventCount");
  const [trendsMetric, setTrendsMetric] = useState<"eventCount" | "scheduledHours">("eventCount");
  const [trendsComposition, setTrendsComposition] = useState<"requestCategory" | "eventType" | "locationMode">("requestCategory");
  const [comparePrevious, setComparePrevious] = useState(true);
  const [eventTypeMetric, setEventTypeMetric] = useState<"eventCount" | "scheduledHours">("eventCount");
  const [eventTypeTopN, setEventTypeTopN] = useState(10);
  const [locationLevel, setLocationLevel] = useState<"building" | "room">("building");
  const [locationMetric, setLocationMetric] = useState<"eventCount" | "scheduledHours" | "participants">("eventCount");
  const [locationTopN, setLocationTopN] = useState(10);
  const [requesterMetric, setRequesterMetric] = useState<"eventCount" | "scheduledHours" | "participants">("eventCount");
  const [requesterTopN, setRequesterTopN] = useState(10);
  const [attendeeMetric, setAttendeeMetric] = useState<"eventCount" | "scheduledHours" | "participants">("eventCount");
  const [attendeeTopN, setAttendeeTopN] = useState(10);
  const [durationMetric, setDurationMetric] = useState<"scheduled" | "program" | "setupLead">("scheduled");
  const [durationBreakout, setDurationBreakout] = useState<"eventType" | "building" | "requester">("eventType");
  const [histogramBins, setHistogramBins] = useState(12);
  const [overlapLevel, setOverlapLevel] = useState<"system" | "building" | "room">("system");
  const [overlapEntityId, setOverlapEntityId] = useState<number | null>(null);
  const [overlapTopN, setOverlapTopN] = useState(10);
  const [selectedOverlapDate, setSelectedOverlapDate] = useState<string>("");

  const metaQuery = api.admin.analytics.meta.useQuery(undefined, { staleTime: 300_000 });

  useEffect(() => {
    if (!metaQuery.data) return;
    setFilters(metaQuery.data.defaults);
  }, [metaQuery.data]);

  const overviewQuery = api.admin.analytics.overview.useQuery(
    { filters, topN: overviewTopN },
    { enabled: activeSection === "overview", staleTime: 60_000 },
  );
  const trendsQuery = api.admin.analytics.trends.useQuery(
    { filters, metric: trendsMetric, composition: trendsComposition, comparePrevious },
    { enabled: activeSection === "trends", staleTime: 60_000 },
  );
  const eventTypesQuery = api.admin.analytics.eventTypes.useQuery(
    { filters, metric: eventTypeMetric, topN: eventTypeTopN },
    { enabled: activeSection === "eventTypes", staleTime: 60_000 },
  );
  const locationsQuery = api.admin.analytics.locations.useQuery(
    { filters, level: locationLevel, metric: locationMetric, topN: locationTopN },
    { enabled: activeSection === "locations", staleTime: 60_000 },
  );
  const requestersQuery = api.admin.analytics.requesters.useQuery(
    { filters, metric: requesterMetric, topN: requesterTopN },
    { enabled: activeSection === "requesters", staleTime: 60_000 },
  );
  const attendeesQuery = api.admin.analytics.attendees.useQuery(
    { filters, metric: attendeeMetric, topN: attendeeTopN },
    { enabled: activeSection === "attendees", staleTime: 60_000 },
  );
  const durationsQuery = api.admin.analytics.durations.useQuery(
    { filters, durationMetric, breakoutBy: durationBreakout, histogramBins },
    { enabled: activeSection === "durations", staleTime: 60_000 },
  );
  const overlapQuery = api.admin.analytics.overlap.useQuery(
    {
      filters,
      level: overlapLevel,
      entityId: overlapEntityId,
      selectedDate: selectedOverlapDate ? new Date(`${selectedOverlapDate}T00:00:00`) : null,
      topN: overlapTopN,
    },
    { enabled: activeSection === "overlap", staleTime: 60_000 },
  );

  useEffect(() => {
    if (!overlapQuery.data?.selectedDate) return;
    setSelectedOverlapDate(overlapQuery.data.selectedDate.toISOString().slice(0, 10));
  }, [overlapQuery.data?.selectedDate]);

  const overlapEntities = useMemo(() => {
    if (!metaQuery.data) return [];
    if (overlapLevel === "building") return metaQuery.data.buildingOptions;
    if (overlapLevel === "room") return metaQuery.data.roomOptions;
    return [];
  }, [metaQuery.data, overlapLevel]);

  const resolvedMeta = useMemo<((Omit<AnalyticsMeta, "defaults"> & { defaults: AnalyticsFilters }) | null)>(
    () =>
      metaQuery.data
        ? {
            ...metaQuery.data,
            defaults: metaQuery.data.defaults ?? defaultFilters,
          }
        : null,
    [metaQuery.data],
  );

  const coverageBadges = (coverage: AnalyticsMeta["coverage"] | undefined) => {
    if (!coverage) return null;
    return (
      <div className="flex flex-wrap gap-2">
        <CoverageBadge label="Participants" value={coverage.participantCountCoveragePercent} />
        <CoverageBadge label="Event types" value={coverage.eventTypeCoveragePercent} />
      </div>
    );
  };

  if (metaQuery.isLoading) {
    return (
      <div className="flex flex-col gap-8">
        <div className="h-40 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
        <AnalyticsLoadingState cards={4} />
      </div>
    );
  }

  if (metaQuery.isError || !metaQuery.data || !resolvedMeta) {
    return <ErrorState message="Unable to load analytics metadata." onRetry={() => void metaQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm uppercase tracking-[0.3em] text-accent-soft">Event Analytics</p>
        <h2 className="text-3xl font-semibold text-ink-primary">Analytics</h2>
        <p className="max-w-4xl text-sm text-ink-muted">
          Explore event volume, type mix, location usage, requester patterns, durations, and concurrency from a dedicated analytics workspace.
        </p>
      </header>

      <AnalyticsFilterBar
        meta={resolvedMeta}
        value={filters}
        onChange={setFilters}
        onReset={() => setFilters(resolvedMeta.defaults)}
      />
      <AnalyticsSectionTabs sections={sections} active={activeSection} onChange={setActiveSection} />

      {activeSection === "overview" ? (
        overviewQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : overviewQuery.isError || !overviewQuery.data ? (
          <ErrorState message="Unable to load overview analytics." onRetry={() => void overviewQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={overviewQuery.data.kpis} />
            {coverageBadges(overviewQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <TimeSeriesChartCard title="Event volume trend" helper="Event counts over the selected time window." series={overviewQuery.data.eventVolumeTrend} mode="area" />
              <TimeSeriesChartCard title="Scheduled hours trend" helper="Total scheduled workload over time." series={overviewQuery.data.scheduledHoursTrend} mode="line" />
              <StackedCompositionChartCard title="Request category mix" helper="See how request category composition changes over time." points={overviewQuery.data.requestMixTrend} mode="bar" />
              <RankedBarChartCard
                title="Top buildings"
                helper="Compare the busiest buildings by event count or scheduled hours."
                data={overviewMetric === "eventCount" ? overviewQuery.data.topLocationsByCount : overviewQuery.data.topLocationsByHours}
                toolbar={
                  <>
                    <select className={controlClass} value={overviewMetric} onChange={(event) => setOverviewMetric(event.target.value as "eventCount" | "scheduledHours")}>
                      <option value="eventCount">Event count</option>
                      <option value="scheduledHours">Scheduled hours</option>
                    </select>
                    <CommitNumberInput
                      className={controlClass}
                      min={ANALYTICS_TOP_N_MIN}
                      max={ANALYTICS_TOP_N_MAX}
                      value={overviewTopN}
                      fallback={10}
                      onCommit={setOverviewTopN}
                    />
                  </>
                }
              />
              <HeatmapCard title="Weekday and hour pattern" helper="When events tend to start across the week." cells={overviewQuery.data.weekdayHourHeatmap} />
              <TimeSeriesChartCard title="Concurrency trend" helper="Peak concurrent events within each time bucket." series={overviewQuery.data.concurrencyTrend} mode="line" />
            </div>
          </div>
        )
      ) : null}

      {activeSection === "trends" ? (
        trendsQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : trendsQuery.isError || !trendsQuery.data ? (
          <ErrorState message="Unable to load trend analytics." onRetry={() => void trendsQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={trendsQuery.data.kpis} />
            {coverageBadges(trendsQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <TimeSeriesChartCard
                title="Primary trend"
                helper="Track the main selected metric over time and compare to the prior period."
                series={trendsQuery.data.series}
                compareSeries={comparePrevious ? trendsQuery.data.comparison : undefined}
                mode="line"
                toolbar={
                  <>
                    <select className={controlClass} value={trendsMetric} onChange={(event) => setTrendsMetric(event.target.value as "eventCount" | "scheduledHours")}>
                      <option value="eventCount">Event count</option>
                      <option value="scheduledHours">Scheduled hours</option>
                    </select>
                    <select className={controlClass} value={trendsComposition} onChange={(event) => setTrendsComposition(event.target.value as "requestCategory" | "eventType" | "locationMode")}>
                      <option value="requestCategory">Request category</option>
                      <option value="eventType">Event type</option>
                      <option value="locationMode">Virtual vs physical</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm text-ink-muted">
                      <input type="checkbox" checked={comparePrevious} onChange={(event) => setComparePrevious(event.target.checked)} />
                      Compare previous
                    </label>
                  </>
                }
              />
              <StackedCompositionChartCard title="Composition over time" helper="See how the selected composition dimension shifts across the range." points={trendsQuery.data.compositionTrend} mode="area" />
              <CalendarHeatmapCard title="Calendar heatmap" helper="Daily event counts over the selected window." cells={trendsQuery.data.calendarHeatmap} />
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <TimeSeriesChartCard title="Virtual vs physical" helper="Compare demand by delivery mode." series={trendsQuery.data.splitSeries.virtual} compareSeries={trendsQuery.data.splitSeries.physical} mode="line" />
              <TimeSeriesChartCard title="All-day vs timed" helper="See whether long all-day bookings are driving the trend." series={trendsQuery.data.splitSeries.allDay} compareSeries={trendsQuery.data.splitSeries.timed} mode="line" />
            </div>
          </div>
        )
      ) : null}

      {activeSection === "eventTypes" ? (
        eventTypesQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : eventTypesQuery.isError || !eventTypesQuery.data ? (
          <ErrorState message="Unable to load event type analytics." onRetry={() => void eventTypesQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={eventTypesQuery.data.kpis} />
            {coverageBadges(eventTypesQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedBarChartCard
                title="Event types by count"
                helper="Rank the most common event types in the filtered set."
                data={eventTypeMetric === "eventCount" ? eventTypesQuery.data.rankedByCount : eventTypesQuery.data.rankedByHours}
                toolbar={
                  <>
                    <select className={controlClass} value={eventTypeMetric} onChange={(event) => setEventTypeMetric(event.target.value as "eventCount" | "scheduledHours")}>
                      <option value="eventCount">Event count</option>
                      <option value="scheduledHours">Scheduled hours</option>
                    </select>
                    <CommitNumberInput
                      className={controlClass}
                      min={ANALYTICS_TOP_N_MIN}
                      max={ANALYTICS_TOP_N_MAX}
                      value={eventTypeTopN}
                      fallback={10}
                      onCommit={setEventTypeTopN}
                    />
                  </>
                }
              />
              <RankedBarChartCard title="Event types by scheduled hours" helper="Highlight the event types consuming the most booked time." data={eventTypesQuery.data.rankedByHours} />
              <StackedCompositionChartCard title="Type share over time" helper="Track event type share as the mix changes." points={eventTypesQuery.data.typeShareTrend} mode="bar" />
              <StackedCompositionChartCard title="Type by request category" helper="Compare event-type volume through the request category lens." points={eventTypesQuery.data.typeByRequestCategory} mode="bar" />
              <DonutChartCard title="Categorization coverage" helper="How much of the filtered set has an explicit event type." data={eventTypesQuery.data.categorizedVsUncategorized} />
            </div>
          </div>
        )
      ) : null}

      {activeSection === "locations" ? (
        locationsQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : locationsQuery.isError || !locationsQuery.data ? (
          <ErrorState message="Unable to load location analytics." onRetry={() => void locationsQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={locationsQuery.data.kpis} />
            {coverageBadges(locationsQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedBarChartCard
                title={locationLevel === "building" ? "Top buildings" : "Top rooms"}
                helper="Rank the busiest locations for the selected metric."
                data={locationsQuery.data.rankedLocations}
                toolbar={
                  <>
                    <select className={controlClass} value={locationLevel} onChange={(event) => setLocationLevel(event.target.value as "building" | "room")}>
                      <option value="building">Building</option>
                      <option value="room">Room</option>
                    </select>
                    <select className={controlClass} value={locationMetric} onChange={(event) => setLocationMetric(event.target.value as "eventCount" | "scheduledHours" | "participants")}>
                      <option value="eventCount">Event count</option>
                      <option value="scheduledHours">Scheduled hours</option>
                      <option value="participants">Participants</option>
                    </select>
                    <CommitNumberInput
                      className={controlClass}
                      min={ANALYTICS_TOP_N_MIN}
                      max={ANALYTICS_TOP_N_MAX}
                      value={locationTopN}
                      fallback={10}
                      onCommit={setLocationTopN}
                    />
                  </>
                }
              />
              <StackedCompositionChartCard title="Location trend" helper="Location-related workload by request category across time." points={locationsQuery.data.locationTrend} mode="bar" />
              <HeatmapCard title="Building time pattern" helper="See when physical events cluster through the week." cells={locationsQuery.data.buildingHeatmap} />
              <DonutChartCard title="Virtual vs physical" helper="Low-cardinality split of the filtered set." data={locationsQuery.data.virtualVsPhysical} />
              <AnalyticsCard title="Occupancy table" helper="Top locations with counts, hours, and median duration.">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-ink-muted">
                      <tr>
                        <th className="pb-2">Location</th>
                        <th className="pb-2">Events</th>
                        <th className="pb-2">Hours</th>
                        <th className="pb-2">Median duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationsQuery.data.occupancyRows.map((row) => (
                        <tr key={row.key} className="border-t border-outline-muted">
                          <td className="py-2 text-ink-primary">{row.label}</td>
                          <td className="py-2 text-ink-muted">{row.eventCount}</td>
                          <td className="py-2 text-ink-muted">{row.scheduledHours}</td>
                          <td className="py-2 text-ink-muted">{row.medianDuration}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AnalyticsCard>
            </div>
          </div>
        )
      ) : null}

      {activeSection === "requesters" ? (
        requestersQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : requestersQuery.isError || !requestersQuery.data ? (
          <ErrorState message="Unable to load requester analytics." onRetry={() => void requestersQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={requestersQuery.data.kpis} />
            {coverageBadges(requestersQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedBarChartCard
                title="Top requesters"
                helper="Rank the requester proxies driving demand."
                data={requestersQuery.data.rankedRequesters}
                toolbar={
                  <>
                    <select className={controlClass} value={requesterMetric} onChange={(event) => setRequesterMetric(event.target.value as "eventCount" | "scheduledHours" | "participants")}>
                      <option value="eventCount">Event count</option>
                      <option value="scheduledHours">Scheduled hours</option>
                      <option value="participants">Participants</option>
                    </select>
                    <CommitNumberInput
                      className={controlClass}
                      min={ANALYTICS_TOP_N_MIN}
                      max={ANALYTICS_TOP_N_MAX}
                      value={requesterTopN}
                      fallback={10}
                      onCommit={setRequesterTopN}
                    />
                  </>
                }
              />
              <StackedCompositionChartCard title="Requester share over time" helper="How requester mix changes through time." points={requestersQuery.data.requesterShareTrend} mode="bar" />
              <StackedCompositionChartCard title="Requester by request category" helper="Break requester demand down by request category." points={requestersQuery.data.requesterByRequestCategory} mode="bar" />
              <HeatmapCard title="Requester by location" helper="Matrix of top requesters against top buildings." cells={requestersQuery.data.requesterLocationMatrix} />
              <TimeSeriesChartCard title="Concentration curve" helper="Cumulative share contributed by the top requesters." series={requestersQuery.data.concentrationCurve} mode="line" />
            </div>
          </div>
        )
      ) : null}

      {activeSection === "attendees" ? (
        attendeesQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : attendeesQuery.isError || !attendeesQuery.data ? (
          <ErrorState message="Unable to load attendee analytics." onRetry={() => void attendeesQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={attendeesQuery.data.kpis} />
            {coverageBadges(attendeesQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedBarChartCard
                title="Top attendees"
                helper="Rank the attendees that appear across the most demand."
                data={attendeesQuery.data.rankedAttendees}
                toolbar={
                  <>
                    <select className={controlClass} value={attendeeMetric} onChange={(event) => setAttendeeMetric(event.target.value as "eventCount" | "scheduledHours" | "participants")}>
                      <option value="eventCount">Event count</option>
                      <option value="scheduledHours">Scheduled hours</option>
                      <option value="participants">Participants</option>
                    </select>
                    <CommitNumberInput
                      className={controlClass}
                      min={ANALYTICS_TOP_N_MIN}
                      max={ANALYTICS_TOP_N_MAX}
                      value={attendeeTopN}
                      fallback={10}
                      onCommit={setAttendeeTopN}
                    />
                  </>
                }
              />
              <StackedCompositionChartCard title="Attendee share over time" helper="How attendee mix changes through time." points={attendeesQuery.data.attendeeShareTrend} mode="bar" />
              <StackedCompositionChartCard title="Attendance by request category" helper="Break attendee-linked demand down by request category." points={attendeesQuery.data.attendeeByRequestCategory} mode="bar" />
              <StackedCompositionChartCard title="Participant load by attendee" helper="Track participant volume across the top attendees over time." points={attendeesQuery.data.attendeeParticipantShareTrend} mode="bar" />
              <StackedCompositionChartCard title="Participants by request category" helper="See where participant volume is concentrated across request categories." points={attendeesQuery.data.attendeeParticipantsByRequestCategory} mode="bar" />
              <HeatmapCard title="Attendee by location" helper="Matrix of top attendees against top buildings." cells={attendeesQuery.data.attendeeLocationMatrix} />
              <TimeSeriesChartCard title="Concentration curve" helper="Cumulative share contributed by the top attendees." series={attendeesQuery.data.concentrationCurve} mode="line" />
            </div>
          </div>
        )
      ) : null}

      {activeSection === "durations" ? (
        durationsQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : durationsQuery.isError || !durationsQuery.data ? (
          <ErrorState message="Unable to load duration analytics." onRetry={() => void durationsQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={durationsQuery.data.kpis} />
            {coverageBadges(durationsQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedBarChartCard
                title="Duration histogram"
                helper="Distribution of the selected duration metric."
                data={durationsQuery.data.histogram.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
                toolbar={
                  <>
                    <select className={controlClass} value={durationMetric} onChange={(event) => setDurationMetric(event.target.value as "scheduled" | "program" | "setupLead")}>
                      <option value="scheduled">Scheduled</option>
                      <option value="program">Program</option>
                      <option value="setupLead">Setup lead</option>
                    </select>
                    <select className={controlClass} value={durationBreakout} onChange={(event) => setDurationBreakout(event.target.value as "eventType" | "building" | "requester")}>
                      <option value="eventType">Event type</option>
                      <option value="building">Building</option>
                      <option value="requester">Requester</option>
                    </select>
                    <CommitNumberInput
                      className={controlClass}
                      min={4}
                      max={24}
                      value={histogramBins}
                      fallback={12}
                      onCommit={setHistogramBins}
                    />
                  </>
                }
              />
              <BoxPlotCard title="Box plot by breakout" helper="Spread and outliers for the chosen grouping." data={durationsQuery.data.boxPlot} />
              <ScatterCard title="Participants vs duration" helper="Participant count against duration, shown when coverage is sufficient." data={durationsQuery.data.scatter} />
              <AnalyticsCard title="Longest events" helper="The longest bookings in the filtered set.">
                <div className="space-y-3">
                  {durationsQuery.data.longestEvents.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-outline-muted bg-surface-muted px-4 py-3">
                      <div className="text-sm font-semibold text-ink-primary">{entry.title}</div>
                      <div className="mt-1 text-xs text-ink-muted">
                        {entry.duration}h{entry.buildingLabel ? ` · ${entry.buildingLabel}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </AnalyticsCard>
            </div>
          </div>
        )
      ) : null}

      {activeSection === "overlap" ? (
        overlapQuery.isLoading ? (
          <AnalyticsLoadingState cards={4} />
        ) : overlapQuery.isError || !overlapQuery.data ? (
          <ErrorState message="Unable to load overlap analytics." onRetry={() => void overlapQuery.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            <AnalyticsKpiGrid items={overlapQuery.data.kpis} />
            {coverageBadges(overlapQuery.data.coverage)}
            <div className="grid gap-6 xl:grid-cols-2">
              <TimeSeriesChartCard
                title="Concurrency trend"
                helper="Peak concurrent events across the selected time range."
                series={overlapQuery.data.concurrencyTrend}
                mode="area"
                toolbar={
                  <>
                    <select
                      className={controlClass}
                      value={overlapLevel}
                      onChange={(event) => {
                        setOverlapLevel(event.target.value as "system" | "building" | "room");
                        setOverlapEntityId(null);
                      }}
                    >
                      <option value="system">System</option>
                      <option value="building">Building</option>
                      <option value="room">Room</option>
                    </select>
                    {overlapLevel !== "system" ? (
                      <select
                        className={controlClass}
                        value={overlapEntityId ?? ""}
                        onChange={(event) => setOverlapEntityId(event.target.value ? Number(event.target.value) : null)}
                      >
                        <option value="">Select {overlapLevel}</option>
                        {overlapEntities.map((option) => (
                          <option key={String(option.value)} value={String(option.value)}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <CommitNumberInput
                      className={controlClass}
                      min={ANALYTICS_TOP_N_MIN}
                      max={ANALYTICS_TOP_N_MAX}
                      value={overlapTopN}
                      fallback={10}
                      onCommit={setOverlapTopN}
                    />
                  </>
                }
              />
              <HeatmapCard title="Concurrency heatmap" helper="Intensity of simultaneous event load by weekday and hour." cells={overlapQuery.data.concurrencyHeatmap} />
              <RankedBarChartCard title="Overlap burden" helper="Locations ranked by overlap hours." data={overlapQuery.data.overlapRanked} />
              <RankedBarChartCard
                title="Overlap duration distribution"
                helper="Distribution of segment durations where more than one event overlaps."
                data={overlapQuery.data.overlapDurationDistribution.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
              />
              <TimelineLanesCard
                title="Selected-day timeline"
                helper="Parallel events laid out as lanes for the selected day."
                lanes={overlapQuery.data.timelineLanes}
                toolbar={
                  <input
                    type="date"
                    className={controlClass}
                    value={selectedOverlapDate}
                    onChange={(event) => setSelectedOverlapDate(event.target.value)}
                  />
                }
              />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
