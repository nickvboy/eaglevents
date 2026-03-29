import { z } from "zod";

import {
  EQUIPMENT_NEEDED_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type EventRequestDetails,
  type EventRequestDetailsV1,
  type EventRequestDetailsV2,
} from "~/types/event-request";

const equipmentNeededOptionSchema = z.enum(EQUIPMENT_NEEDED_OPTIONS);
const eventTypeOptionSchema = z.enum(EVENT_TYPE_OPTIONS);

export const eventRequestDetailsV1Schema = z.object({
  version: z.literal(1),
  equipmentNeededText: z.string().trim().min(1).max(2000),
});

export const eventRequestDetailsV2Schema = z.object({
  version: z.literal(2),
  equipmentNeeded: z.array(equipmentNeededOptionSchema).max(EQUIPMENT_NEEDED_OPTIONS.length),
  additionalInformation: z.string().trim().max(2000).optional(),
  equipmentOtherDetails: z.string().trim().max(2000).optional(),
  eventTypes: z.array(eventTypeOptionSchema).max(EVENT_TYPE_OPTIONS.length),
  eventTypeOtherDetails: z.string().trim().max(2000).optional(),
});

export const eventRequestDetailsSchema = z.discriminatedUnion("version", [
  eventRequestDetailsV1Schema,
  eventRequestDetailsV2Schema,
]);

export function normalizeEventRequestDetails(
  value: EventRequestDetails | null | undefined,
): EventRequestDetails | null {
  if (!value) return null;
  if (value.version === 1) {
    const text = value.equipmentNeededText.trim();
    return text.length > 0
      ? ({ version: 1, equipmentNeededText: text } satisfies EventRequestDetailsV1)
      : null;
  }

  const equipmentNeeded = Array.from(new Set(value.equipmentNeeded));
  const eventTypes = Array.from(new Set(value.eventTypes));
  const equipmentOtherDetails = (
    value.equipmentOtherDetails ?? value.additionalInformation ?? ""
  ).trim();
  const eventTypeOtherDetails = (value.eventTypeOtherDetails ?? "").trim();

  if (
    equipmentNeeded.length === 0 &&
    equipmentOtherDetails.length === 0 &&
    eventTypes.length === 0 &&
    eventTypeOtherDetails.length === 0
  ) {
    return null;
  }

  return {
    version: 2,
    equipmentNeeded,
    equipmentOtherDetails:
      equipmentNeeded.includes("Other") ? equipmentOtherDetails : "",
    eventTypes,
    eventTypeOtherDetails:
      eventTypes.includes("Other") ? eventTypeOtherDetails : "",
  } satisfies EventRequestDetailsV2;
}
