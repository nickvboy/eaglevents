import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  analyticsDurationMetricValues,
  analyticsFrequencyValues,
  analyticsLocationLevelValues,
  analyticsLocationModeValues,
  analyticsMetricValues,
  analyticsOverlapLevelValues,
  analyticsRangePresetValues,
  analyticsRequesterSourceValues,
  defaultAnalyticsFilters,
  getAnalyticsMeta,
  getDurationAnalytics,
  getEventTypeAnalytics,
  getLocationAnalytics,
  getOverviewAnalytics,
  getOverlapAnalytics,
  getAttendeeAnalytics,
  getRequesterAnalytics,
  getTrendsAnalytics,
} from "~/server/services/admin-analytics";
import { requireAdminCapability } from "~/server/services/permissions";

export const analyticsRangePresetSchema = z.enum(analyticsRangePresetValues);
export const analyticsFrequencySchema = z.enum(analyticsFrequencyValues);
export const analyticsMetricSchema = z.enum(analyticsMetricValues);
export const analyticsDurationMetricSchema = z.enum(analyticsDurationMetricValues);
export const analyticsLocationLevelSchema = z.enum(analyticsLocationLevelValues);
export const analyticsRequesterSourceSchema = z.enum(analyticsRequesterSourceValues);
export const analyticsOverlapLevelSchema = z.enum(analyticsOverlapLevelValues);
export const analyticsLocationModeSchema = z.enum(analyticsLocationModeValues);

export const analyticsGlobalFiltersSchema = z.object({
  rangePreset: analyticsRangePresetSchema,
  customStart: z.date().nullable(),
  customEnd: z.date().nullable(),
  frequency: analyticsFrequencySchema,
  buildingIds: z.array(z.number().int().positive()),
  roomIds: z.array(z.number().int().positive()),
  eventTypes: z.array(z.string().min(1)),
  requestCategories: z.array(z.string().min(1)),
  requesterKeys: z.array(z.string().min(1)),
  locationMode: analyticsLocationModeSchema,
  includeAllDay: z.boolean(),
});

const topNSchema = z.number().int().min(1).max(25).optional();

export const adminAnalyticsRouter = createTRPCRouter({
  meta: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
    return getAnalyticsMeta(ctx.db);
  }),

  overview: protectedProcedure
    .input(z.object({ filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()), topN: topNSchema }))
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getOverviewAnalytics(ctx.db, input.filters, input.topN ?? 10);
    }),

  trends: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        metric: z.enum(["eventCount", "scheduledHours"]).default("eventCount"),
        composition: z.enum(["requestCategory", "eventType", "locationMode"]).default("requestCategory"),
        comparePrevious: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getTrendsAnalytics(ctx.db, input);
    }),

  eventTypes: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        metric: z.enum(["eventCount", "scheduledHours"]).default("eventCount"),
        topN: topNSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getEventTypeAnalytics(ctx.db, input);
    }),

  locations: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        level: analyticsLocationLevelSchema.default("building"),
        metric: z.enum(["eventCount", "scheduledHours", "participants"]).default("eventCount"),
        topN: topNSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getLocationAnalytics(ctx.db, input);
    }),

  requesters: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        metric: z.enum(["eventCount", "scheduledHours", "participants"]).default("eventCount"),
        topN: topNSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getRequesterAnalytics(ctx.db, input);
    }),

  attendees: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        metric: z.enum(["eventCount", "scheduledHours", "participants"]).default("eventCount"),
        topN: topNSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getAttendeeAnalytics(ctx.db, input);
    }),

  durations: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        durationMetric: analyticsDurationMetricSchema.default("scheduled"),
        breakoutBy: z.enum(["eventType", "building", "requester"]).default("eventType"),
        histogramBins: z.number().int().min(4).max(24).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getDurationAnalytics(ctx.db, input);
    }),

  overlap: protectedProcedure
    .input(
      z.object({
        filters: analyticsGlobalFiltersSchema.default(defaultAnalyticsFilters()),
        level: analyticsOverlapLevelSchema.default("system"),
        entityId: z.number().int().positive().nullable().optional(),
        selectedDate: z.date().nullable().optional(),
        topN: topNSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "analytics:view");
      return getOverlapAnalytics(ctx.db, input);
    }),
});
