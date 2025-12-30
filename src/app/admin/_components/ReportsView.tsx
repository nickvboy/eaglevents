"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { BarChartIcon, ReportIcon, UsersIcon } from "~/app/_components/icons";
import { api, type RouterOutputs } from "~/trpc/react";

type ReportsData = RouterOutputs["admin"]["reports"];
type ExportReport = ReportsData["exportReports"][number];
type MultiYearMonthReport = Extract<ExportReport, { format: "multiYearMonth" }>;
type SimpleTableReport = Extract<ExportReport, { format: "simpleTable" }>;
type BaseReportParameter =
  | {
      id: string;
      label: string;
      type: "select";
      options: Array<{ label: string; value: string }>;
      defaultValue: string;
      helper?: string;
    }
  | {
      id: string;
      label: string;
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      defaultValue: number;
      suffix?: string;
      helper?: string;
    }
  | {
      id: string;
      label: string;
      type: "toggle";
      defaultValue: boolean;
      helper?: string;
    };
type ReportParameter = BaseReportParameter;
type ReportWithParameters = ExportReport & { parameters?: ReportParameter[] };
type ParameterCarrier = { parameters?: BaseReportParameter[] };
type ParameterValue = string | number | boolean;
type ParameterValuesMap = Record<string, ParameterValue>;

function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, ...options }).format(value);
}

function formatHoursValue(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatHours(value: number) {
  return `${formatHoursValue(value)}h`;
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateRange(window: ReportsData["window"]) {
  const start = coerceDate(window.start);
  const end = coerceDate(window.end);
  if (!start || !end) return "";
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function formatDateTime(input: Date | string) {
  const date = coerceDate(input);
  if (!date) return "TBD";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBuildingLabel(entry: { buildingName: string | null; buildingAcronym: string | null }) {
  if (entry.buildingAcronym && entry.buildingName) {
    return `${entry.buildingAcronym} - ${entry.buildingName}`;
  }
  return entry.buildingName ?? entry.buildingAcronym ?? "Unassigned location";
}

export function ReportsView() {
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = api.admin.reports.useQuery(undefined, {
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, ParameterValuesMap>>({});
  const exportReports = data?.exportReports ?? [];

  useEffect(() => {
    if (exportReports.length === 0) {
      if (selectedReportId !== null) {
        setSelectedReportId(null);
      }
      return;
    }
    if (!selectedReportId || !exportReports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(exportReports[0]!.id);
    }
  }, [exportReports, selectedReportId]);

  useEffect(() => {
    if (exportReports.length === 0) return;
    setParameterValues((prev) => {
      let nextState: typeof prev | null = null;
      for (const report of exportReports) {
        const overrides = prev[report.id];
        if (!overrides) continue;
        const sanitized = sanitizeParameterValues(report, overrides);
        if (sanitized !== overrides) {
          if (!nextState) nextState = { ...prev };
          nextState[report.id] = sanitized;
        }
      }
      return nextState ?? prev;
    });
  }, [exportReports]);

  const selectedReport = useMemo(() => {
    if (exportReports.length === 0) return null;
    return exportReports.find((report) => report.id === selectedReportId) ?? exportReports[0] ?? null;
  }, [exportReports, selectedReportId]);

  const activeReport = useMemo(() => {
    if (!selectedReport) return null;
    const values = resolveParameterValues(selectedReport, parameterValues[selectedReport.id]);
    return {
      definition: selectedReport,
      values,
      report: applyReportParameters(selectedReport, values),
    };
  }, [selectedReport, parameterValues]);

  const resolvedParameterValues = selectedReport ? activeReport?.values ?? resolveParameterValues(selectedReport) : null;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const lastUpdatedLabel = lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  const handleParameterChange = (reportId: string, parameterId: string, value: ParameterValue) => {
    setParameterValues((prev) => ({
      ...prev,
      [reportId]: {
        ...(prev[reportId] ?? {}),
        [parameterId]: value,
      },
    }));
  };

  const handleExport = (format: "csv" | "xlsx") => {
    if (!activeReport) return;
    const matrix = buildReportMatrix(activeReport.report);
    if (!matrix) return;
    const filename = slugify(activeReport.definition.label);
    if (format === "csv") {
      downloadCsv(filename, matrix);
    } else {
      downloadExcel(filename, matrix);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-6">
        <div className="h-40 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="h-64 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
          <div className="h-64 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-status-danger bg-status-danger-surface p-6 text-sm text-status-danger">
        <p>Unable to load reporting data. Please try again.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="self-start rounded-full border border-status-danger px-4 py-1 text-xs font-semibold text-status-danger transition hover:bg-status-danger/10"
        >
          Retry
        </button>
      </div>
    );
  }

  const summaryCards = [
    {
      id: "events",
      label: "Events reviewed",
      value: formatNumber(data.summary.totalEvents),
      helper: `Last ${data.window.days} days`,
      icon: BarChartIcon,
    },
    {
      id: "hours",
      label: "Staffed hours",
      value: formatHours(data.summary.staffedHours),
      helper: "Labor logged",
      icon: ReportIcon,
    },
    {
      id: "attendance",
      label: "Avg attendance",
      value: formatNumber(data.summary.avgParticipants),
      helper: "Participants per event",
      icon: UsersIcon,
    },
    {
      id: "zendesk",
      label: "Zendesk coverage",
      value: `${formatNumber(data.summary.zendesk.coveragePercent)}%`,
      helper: `${data.summary.zendesk.confirmed}/${data.summary.zendesk.ticketed || 0} confirmed`,
      icon: ReportIcon,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Reporting window</p>
            <h2 className="text-xl font-semibold text-ink-primary">Last {data.window.days} days</h2>
            <p className="text-sm text-ink-muted">{formatDateRange(data.window)}</p>
          </div>
          <div className="flex flex-col items-start gap-2 text-xs text-ink-muted sm:items-end">
            <span>
              Live updating
              {lastUpdatedLabel ? <span className="ml-1 text-ink-primary">{`- updated ${lastUpdatedLabel}`}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="self-start rounded-full border border-outline-muted px-4 py-2 text-xs font-semibold text-ink-subtle transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              {isFetching ? "Refreshing..." : "Refresh now"}
            </button>
          </div>
        </header>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.id}
                className="rounded-2xl border border-outline-muted bg-[radial-gradient(circle_at_top,var(--color-surface-overlay),transparent)] p-5 shadow-[var(--shadow-pane)]"
              >
                <header className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.2em] text-ink-muted">{card.label}</span>
                  <Icon className="h-4 w-4 text-accent-soft" />
                </header>
                <div className="mt-4 text-3xl font-semibold text-ink-primary">{card.value}</div>
                <p className="mt-2 text-xs text-ink-muted">{card.helper}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <article className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink-primary">Events by building</h2>
              <p className="text-sm text-ink-muted">Top venues based on scheduled activity</p>
            </div>
            <span className="text-xs font-medium text-accent-soft">{data.breakdowns.eventsByBuilding.length} listed</span>
          </header>
          {data.breakdowns.eventsByBuilding.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
              No events logged during this window. Schedule events to populate the report.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-outline-muted rounded-xl border border-outline-muted bg-surface-muted/30">
              {data.breakdowns.eventsByBuilding.map((building) => (
                <li key={`${building.buildingId ?? "none"}`} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-primary">{formatBuildingLabel(building)}</p>
                    <p className="text-xs text-ink-muted">
                      {building.eventCount} events - {building.technicianEvents} needing tech - {formatHours(building.staffedHours)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-ink-muted">Staffed hours</p>
                      <p className="text-sm font-semibold text-ink-primary">{formatHours(building.staffedHours)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
          <header>
            <h2 className="text-lg font-semibold text-ink-primary">Request mix</h2>
            <p className="text-sm text-ink-muted">Distribution across request categories</p>
          </header>
          {data.breakdowns.requestCategories.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
              No categorized events yet.
            </p>
          ) : (
            <div className="mt-6 flex flex-col gap-4">
              {data.breakdowns.requestCategories.map((category) => (
                <div key={category.category} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <span className="text-sm font-semibold text-ink-primary">{category.label}</span>
                    <span>{formatNumber(category.percent, { maximumFractionDigits: 1 })}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-outline-muted">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent-muted),var(--color-accent-strong))]"
                      style={{ width: `${category.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <article className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
          <header>
            <h2 className="text-lg font-semibold text-ink-primary">Hours by department</h2>
            <p className="text-sm text-ink-muted">Where staff time is being invested</p>
          </header>
          {data.breakdowns.hoursByDepartment.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
              No hour logs recorded for this period.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {data.breakdowns.hoursByDepartment.map((dept) => (
                <li key={`${dept.departmentId ?? "unassigned"}`} className="flex items-center justify-between rounded-xl border border-outline-muted bg-surface-muted/50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-primary">{dept.departmentName}</p>
                    <p className="text-xs text-ink-muted">Tracked labor</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-ink-primary">{formatHours(dept.hours)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
          <header className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-ink-primary">Zendesk queue</h2>
              <p className="text-sm text-ink-muted">
                {data.summary.technician.needed} technician requests - {data.summary.technician.readyPercent}% ready
              </p>
            </div>
            <span className="text-xs font-medium text-accent-soft">
              {data.summary.technician.awaitingConfirmation} waiting
            </span>
          </header>
          {data.zendeskQueue.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
              All ticketed events are confirmed. Great work!
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {data.zendeskQueue.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-outline-muted bg-surface-muted px-4 py-3 text-sm text-ink-primary shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{item.title}</p>
                    <span className="text-xs font-medium text-accent-soft">{item.ticketNumber}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{formatBuildingLabel(item)} - {formatDateTime(item.start)}</p>
                  {item.technicianNeeded ? (
                    <span className="mt-2 inline-flex rounded-full bg-accent-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-soft">
                      Tech required
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Report outputs</h2>
          <p className="text-sm text-ink-muted">
            Choose a report format to preview the table and export it as CSV or Excel, including the multi-year view
            used in leadership packets.
          </p>
        </header>
        {exportReports.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
            No exportable reports are available yet. Capture more data to unlock downloads.
          </p>
        ) : (
          <>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted sm:flex-1">
                Report type
                <select
                  value={selectedReport?.id ?? ""}
                  onChange={(event) => setSelectedReportId(event.target.value)}
                  className="rounded-xl border border-outline-muted bg-surface-muted px-4 py-2 text-sm font-medium text-ink-primary focus:border-outline-accent focus:outline-none"
                >
                  {exportReports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {report.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  className="rounded-full border border-outline-muted px-4 py-2 text-sm font-semibold text-ink-subtle transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                  disabled={!activeReport}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("xlsx")}
                  className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:opacity-60"
                  disabled={!activeReport}
                >
                  Export Excel
                </button>
              </div>
            </div>
            {selectedReport && selectedReport.parameters && selectedReport.parameters.length > 0 && resolvedParameterValues ? (
              <ParameterControls
                report={selectedReport}
                values={resolvedParameterValues}
                onChange={(parameterId, value) => handleParameterChange(selectedReport.id, parameterId, value)}
              />
            ) : null}
            {selectedReport && resolvedParameterValues && isMultiYearMonthReport(selectedReport) ? (
              <YearRangeControls
                report={selectedReport}
                values={resolvedParameterValues}
                onChange={(parameterId, value) => handleParameterChange(selectedReport.id, parameterId, value)}
              />
            ) : null}
            {selectedReport && activeReport ? (
              <div className="mt-6 flex flex-col gap-4">
                <p className="text-sm text-ink-muted">{selectedReport.description}</p>
                <ReportPreview report={activeReport.report} />
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function ReportPreview({ report }: { report: ExportReport }) {
  if (isMultiYearMonthReport(report)) {
    return <MultiYearMonthTable report={report} />;
  }
  if (isSimpleTableReport(report)) {
    return <SimpleTable report={report} />;
  }
  return null;
}

function ParameterControls({
  report,
  values,
  onChange,
}: {
  report: ExportReport;
  values: ParameterValuesMap;
  onChange: (parameterId: string, value: ParameterValue) => void;
}) {
  if (!report.parameters || report.parameters.length === 0) {
    return null;
  }
  const parameters: ReportParameter[] = (report as ReportWithParameters).parameters ?? [];

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {parameters.map((parameter) => {
        const value = values[parameter.id] ?? parameter.defaultValue;
        if (parameter.type === "select") {
          return (
            <label key={parameter.id} className="flex flex-col gap-2 text-sm font-medium text-ink-primary">
              <span>{parameter.label}</span>
              <select
                value={String(value)}
                onChange={(event) => onChange(parameter.id, event.target.value)}
                className="rounded-xl border border-outline-muted bg-surface-muted px-3 py-2 text-sm font-medium text-ink-primary focus:border-outline-accent focus:outline-none"
              >
                {parameter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {parameter.helper ? <p className="text-xs font-normal text-ink-muted">{parameter.helper}</p> : null}
            </label>
          );
        }
        if (parameter.type === "number") {
          return (
            <label key={parameter.id} className="flex flex-col gap-2 text-sm font-medium text-ink-primary">
              <span>{parameter.label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={Number(value)}
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step ?? 1}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    onChange(
                      parameter.id,
                      Number.isNaN(parsed) ? parameter.defaultValue : parsed,
                    );
                  }}
                  className="w-full rounded-xl border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                />
                {parameter.suffix ? <span className="text-xs text-ink-muted">{parameter.suffix}</span> : null}
              </div>
              {parameter.helper ? <p className="text-xs font-normal text-ink-muted">{parameter.helper}</p> : null}
            </label>
          );
        }
        if (parameter.type === "toggle") {
          return (
            <label key={parameter.id} className="flex items-center justify-between rounded-xl border border-outline-muted bg-surface-muted px-4 py-3 text-sm font-medium text-ink-primary">
              <div className="flex flex-col">
                <span>{parameter.label}</span>
                {parameter.helper ? <span className="text-xs font-normal text-ink-muted">{parameter.helper}</span> : null}
              </div>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => onChange(parameter.id, event.target.checked)}
                className="h-4 w-4 accent-accent-strong"
              />
            </label>
          );
        }
        return null;
      })}
    </div>
  );
}

function YearRangeControls({
  report,
  values,
  onChange,
}: {
  report: MultiYearMonthReport;
  values: ParameterValuesMap;
  onChange: (parameterId: string, value: ParameterValue) => void;
}) {
  const availableYears = report.years.map((year) => year.year).sort((a, b) => a - b);
  if (availableYears.length === 0) return null;
  const parameters: ReportParameter[] = (report as ReportWithParameters).parameters ?? [];
  const hasStartParameter = parameters.some((parameter) => parameter.id === "startYear");
  const hasEndParameter = parameters.some((parameter) => parameter.id === "endYear");
  if (!hasStartParameter || !hasEndParameter) return null;

  const minYear = availableYears[0]!;
  const maxYear = availableYears[availableYears.length - 1]!;
  const resolvedStart = clampNumber(getNumericValue(values.startYear, minYear), minYear, maxYear);
  const resolvedEnd = clampNumber(getNumericValue(values.endYear, maxYear), minYear, maxYear);
  const startYear = Math.min(resolvedStart, resolvedEnd);
  const endYear = Math.max(resolvedStart, resolvedEnd);
  const yearsShown = endYear - startYear + 1;

  const canShrink = yearsShown > 1;
  const canGrowBackward = startYear > minYear;
  const canGrowForward = endYear < maxYear;
  const canShiftEarlier = startYear > minYear;
  const canShiftLater = endYear < maxYear;

  const updateRange = (nextStart: number, nextEnd: number) => {
    const clampedStart = clampNumber(Math.min(nextStart, nextEnd), minYear, maxYear);
    const clampedEnd = clampNumber(Math.max(nextStart, nextEnd), minYear, maxYear);
    if (clampedStart > clampedEnd) return;
    onChange("startYear", String(clampedStart));
    onChange("endYear", String(clampedEnd));
  };

  const handleIncreaseYears = () => {
    if (canGrowBackward) {
      updateRange(startYear - 1, endYear);
    } else if (canGrowForward) {
      updateRange(startYear, endYear + 1);
    }
  };

  const handleDecreaseYears = () => {
    if (!canShrink) return;
    updateRange(startYear + 1, endYear);
  };

  const handleShift = (direction: "earlier" | "later") => {
    if (direction === "earlier" && canShiftEarlier) {
      updateRange(startYear - 1, endYear - 1);
    }
    if (direction === "later" && canShiftLater) {
      updateRange(startYear + 1, endYear + 1);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-outline-muted bg-surface-muted/40 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">Year window</p>
          <p className="text-sm font-semibold text-ink-primary">
            {startYear === endYear ? startYear : `${startYear} - ${endYear}`}
            <span className="ml-2 text-xs font-normal text-ink-muted">
              ({yearsShown} {yearsShown === 1 ? "year" : "years"})
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 w-9 rounded-full border border-outline-muted text-lg font-semibold text-ink-primary disabled:opacity-40"
            onClick={handleDecreaseYears}
            disabled={!canShrink}
            aria-label="Show fewer years"
          >
            -
          </button>
          <span className="w-20 text-center text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">
            {yearsShown}y
          </span>
          <button
            type="button"
            className="h-9 w-9 rounded-full border border-outline-muted text-lg font-semibold text-ink-primary disabled:opacity-40"
            onClick={handleIncreaseYears}
            disabled={!canGrowBackward && !canGrowForward}
            aria-label="Show more years"
          >
            +
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleShift("earlier")}
          disabled={!canShiftEarlier}
          className="flex-1 rounded-full border border-outline-muted px-3 py-2 text-xs font-semibold text-ink-primary transition hover:bg-surface-muted disabled:opacity-40 sm:flex-none sm:px-4"
        >
          Shift earlier
        </button>
        <button
          type="button"
          onClick={() => handleShift("later")}
          disabled={!canShiftLater}
          className="flex-1 rounded-full border border-outline-muted px-3 py-2 text-xs font-semibold text-ink-primary transition hover:bg-surface-muted disabled:opacity-40 sm:flex-none sm:px-4"
        >
          Shift later
        </button>
      </div>
    </div>
  );
}

function MultiYearMonthTable({ report }: { report: MultiYearMonthReport }) {
  if (report.years.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
        No historical trends available yet.
      </p>
    );
  }
  const monthCount = Math.max(...report.years.map((year) => year.months.length));
  if (monthCount === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-6 text-sm text-ink-muted">
        No month-level data captured yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-outline-muted bg-surface-muted">
      <table className="w-full table-fixed border-collapse text-sm text-ink-primary">
        <thead>
          <tr>
            {report.years.map((year) => (
              <th
                key={`year-${year.year}`}
                colSpan={3}
                className="border-b border-outline-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted"
              >
                {year.year}
              </th>
            ))}
          </tr>
          <tr>
            {report.years.map((year) => (
              <Fragment key={`labels-${year.year}`}>
                <th className="border-b border-outline-muted px-3 py-2 text-left text-xs text-ink-muted">Month</th>
                <th className="border-b border-outline-muted px-3 py-2 text-right text-xs text-ink-muted">Events</th>
                <th className="border-b border-outline-muted px-3 py-2 text-right text-xs text-ink-muted">Hours</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: monthCount }).map((_, index) => (
            <tr key={`month-row-${index}`} className="even:bg-surface-muted/60">
              {report.years.map((year) => {
                const month = year.months[index];
                return (
                  <Fragment key={`${year.year}-${index}`}>
                    <td className="border-b border-outline-muted px-3 py-2 text-sm">{month?.label ?? ""}</td>
                    <td className="border-b border-outline-muted px-3 py-2 text-right font-semibold">
                      {formatNumber(month?.eventCount ?? 0)}
                    </td>
                    <td className="border-b border-outline-muted px-3 py-2 text-right">
                      {formatHoursValue(month?.staffedHours ?? 0)}
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
          <tr>
            {report.years.map((year) => (
              <Fragment key={`totals-${year.year}`}>
                <td className="px-3 py-2 text-sm font-semibold text-ink-primary">Totals</td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-ink-primary">
                  {formatNumber(year.totals.events)}
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-ink-primary">
                  {formatHoursValue(year.totals.hours)}
                </td>
              </Fragment>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ report }: { report: SimpleTableReport }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-outline-muted bg-surface-muted">
      <table className="w-full border-collapse text-sm text-ink-primary">
        <thead>
          <tr>
            {report.columns.map((column) => (
              <th
                key={column}
                className="border-b border-outline-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={report.columns.length} className="px-3 py-4 text-center text-sm text-ink-muted">
                No data available yet.
              </td>
            </tr>
          ) : (
            report.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="even:bg-surface-muted/60">
                {row.map((value, columnIndex) => {
                  const isNumber = typeof value === "number";
                  return (
                    <td
                      key={`cell-${rowIndex}-${columnIndex}`}
                      className={
                        "px-3 py-2 text-sm " + (isNumber ? "text-right font-medium text-ink-primary" : "text-left text-ink-primary")
                      }
                    >
                      {formatTableValue(value)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function sanitizeParameterValues(report: ParameterCarrier, overrides: ParameterValuesMap): ParameterValuesMap {
  const parameters = (report.parameters ?? []) as any[];
  if (parameters.length === 0) return overrides;
  let changed = false;
  const nextValues: ParameterValuesMap = { ...overrides };
  for (const raw of parameters) {
    const parameter = raw as any;
    const current = overrides[parameter.id];
    if (parameter.type === "select" && parameter.options) {
      const normalized = String(current ?? parameter.defaultValue ?? "");
      const options = parameter.options as Array<{ value: string }>;
      const allowed = options.some((option) => option.value === normalized);
      if (!allowed) {
        nextValues[parameter.id] = parameter.defaultValue;
        changed = true;
      }
    } else if (parameter.type === "number") {
      const fallback =
        typeof parameter.defaultValue === "number"
          ? parameter.defaultValue
          : Number(parameter.defaultValue ?? 0);
      const numericValue = getNumericValue(current, fallback);
      const min = parameter.min ?? Number.MIN_SAFE_INTEGER;
      const max = parameter.max ?? Number.MAX_SAFE_INTEGER;
      const clamped = clampNumber(numericValue, min, max);
      if (clamped !== numericValue) {
        nextValues[parameter.id] = clamped;
        changed = true;
      }
    } else if (parameter.type === "toggle") {
      const fallback =
        typeof parameter.defaultValue === "boolean" ? parameter.defaultValue : Boolean(parameter.defaultValue);
      const boolValue = getBooleanValue(current, fallback);
      if (boolValue !== current) {
        nextValues[parameter.id] = boolValue;
        changed = true;
      }
    }
  }
  return changed ? nextValues : overrides;
}

function resolveParameterValues(report: ExportReport, overrides?: ParameterValuesMap): ParameterValuesMap {
  const defaults = getParameterDefaults(report);
  const merged = { ...defaults, ...(overrides ?? {}) };
  return sanitizeParameterValues(report, merged);
}

function getParameterDefaults(report: ParameterCarrier): ParameterValuesMap {
  const parameters = (report.parameters ?? []) as BaseReportParameter[];
  if (parameters.length === 0) return {};
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.defaultValue]));
}

function applyReportParameters(report: ExportReport, values: ParameterValuesMap): ExportReport {
  switch (report.id) {
    case "events-hours-month":
      if (!isMultiYearMonthReport(report)) return report;
      if (report.years.length === 0) return report;
      // ensure start/end boundaries
      {
        const firstYear = report.years[0]?.year ?? 0;
        const lastYear = report.years[report.years.length - 1]?.year ?? firstYear;
        const startYear = getNumericValue(values.startYear, firstYear);
        const endYear = getNumericValue(values.endYear, lastYear);
        const minYear = Math.min(startYear, endYear);
        const maxYear = Math.max(startYear, endYear);
        const filteredYears = report.years.filter((year) => year.year >= minYear && year.year <= maxYear);
        return { ...report, years: filteredYears };
      }
    case "building-utilization":
      if (!isSimpleTableReport(report)) return report;
      {
        const includeUnassigned = getBooleanValue(values.includeUnassigned, true);
        const limit = Math.max(1, Math.round(getNumericValue(values.limit, report.rows.length || 1)));
        const filteredRows = report.rows.filter((row) => includeUnassigned || !isUnassignedLabel(row[0]));
        return { ...report, rows: filteredRows.slice(0, limit) };
      }
    case "department-hours":
      if (!isSimpleTableReport(report)) return report;
      {
        const minHours = Math.max(0, getNumericValue(values.minHours, 0));
        const filteredRows = report.rows.filter((row) => getNumericValue(row[1], 0) >= minHours);
        return { ...report, rows: filteredRows };
      }
    case "request-mix":
      if (!isSimpleTableReport(report)) return report;
      {
        const minPercent = Math.min(100, Math.max(0, getNumericValue(values.minPercent, 0)));
        const sortBy = String(values.sortBy ?? "value");
        const filteredRows = report.rows.filter((row) => parsePercentValue(row[2]) >= minPercent);
        filteredRows.sort((a, b) => {
          if (sortBy === "alpha") {
            return String(a[0]).localeCompare(String(b[0]));
          }
          return parsePercentValue(b[2]) - parsePercentValue(a[2]);
        });
        return { ...report, rows: filteredRows };
      }
    default:
      return report;
  }
}

type TableMatrix = {
  headerRows?: Array<Array<string | number>>;
  rows: Array<Array<string | number>>;
};

function buildReportMatrix(report: ExportReport): TableMatrix | null {
  if (isMultiYearMonthReport(report)) {
    return buildMultiYearMatrix(report);
  }
  if (isSimpleTableReport(report)) {
    return buildSimpleTableMatrix(report);
  }
  return null;
}

function buildMultiYearMatrix(report: MultiYearMonthReport): TableMatrix {
  if (report.years.length === 0) return { rows: [] };
  const headerRow1: Array<string | number> = [];
  const headerRow2: Array<string | number> = [];
  for (const year of report.years) {
    headerRow1.push(String(year.year), "", "");
    headerRow2.push("Month", "Number of Events", "Hours");
  }
  const monthCount = Math.max(...report.years.map((year) => year.months.length));
  const rows: Array<Array<string | number>> = [];
  for (let index = 0; index < monthCount; index++) {
    const row: Array<string | number> = [];
    for (const year of report.years) {
      const month = year.months[index];
      row.push(month?.label ?? "", month?.eventCount ?? 0, Math.round((month?.staffedHours ?? 0) * 100) / 100);
    }
    rows.push(row);
  }
  const totalsRow: Array<string | number> = [];
  for (const year of report.years) {
    totalsRow.push("Totals", year.totals.events, Math.round(year.totals.hours * 100) / 100);
  }
  rows.push(totalsRow);
  return { headerRows: [headerRow1, headerRow2], rows };
}

function buildSimpleTableMatrix(report: SimpleTableReport): TableMatrix {
  return {
    headerRows: [report.columns],
    rows: report.rows,
  };
}

function downloadCsv(filename: string, matrix: TableMatrix) {
  const rows = [...(matrix.headerRows ?? []), ...matrix.rows];
  if (rows.length === 0) {
    rows.push(["No data"]);
  }
  const csv = rows.map((row) => row.map(formatCsvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `${filename || "report"}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadExcel(filename: string, matrix: TableMatrix) {
  const rows = [...(matrix.headerRows ?? []), ...matrix.rows];
  if (rows.length === 0) {
    rows.push(["No data"]);
  }
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, `${filename || "report"}.xlsx`);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatCsvCell(value: string | number) {
  const stringValue = typeof value === "number" ? String(value) : value ?? "";
  if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatTableValue(value: string | number) {
  if (typeof value === "number") {
    const hasFraction = Math.abs(value % 1) > 0;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: hasFraction ? 1 : 0 }).format(value);
  }
  return value;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNumericValue(value: ParameterValue | undefined, fallback: number) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function getBooleanValue(value: ParameterValue | undefined, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "true";
  }
  return fallback;
}

function isUnassignedLabel(value: string | number | undefined) {
  if (typeof value !== "string") return false;
  return value.toLowerCase().includes("unassigned");
}

function parsePercentValue(value: string | number | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/%/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isMultiYearMonthReport(report: ExportReport): report is MultiYearMonthReport {
  return report.format === "multiYearMonth";
}

function isSimpleTableReport(report: ExportReport): report is SimpleTableReport {
  return report.format === "simpleTable";
}
