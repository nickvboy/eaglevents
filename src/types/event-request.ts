export const EQUIPMENT_NEEDED_OPTIONS = [
  "Audio PA System",
  "Conference Phone",
  "LCD TV",
  "Laptop",
  "Podium",
  "Projector",
  "Screen",
  "USB Webcam",
  "Video Camera and Tripod",
  "Other",
] as const;

export const EVENT_TYPE_OPTIONS = [
  "Recording",
  "Stream",
  "Panel",
  "Projector Setup",
  "Inside Audio PA",
  "Outside Audio PA",
  "Concert",
  "Additional Mics/Soundboard",
  "Bluetooth Receiver",
  "General Tech Support",
  "Other",
] as const;

export type EquipmentNeededOption = (typeof EQUIPMENT_NEEDED_OPTIONS)[number];
export type EventTypeOption = (typeof EVENT_TYPE_OPTIONS)[number];

export type EventRequestDetailsV1 = {
  version: 1;
  equipmentNeededText: string;
};

export type EventRequestDetailsV2 = {
  version: 2;
  equipmentNeeded: EquipmentNeededOption[];
  additionalInformation?: string;
  equipmentOtherDetails?: string;
  eventTypes: EventTypeOption[];
  eventTypeOtherDetails?: string;
};

export type EventRequestDetails = EventRequestDetailsV1 | EventRequestDetailsV2;

export type EventRequestFormState = {
  selectedEquipment: EquipmentNeededOption[];
  equipmentOtherDetails: string;
  selectedEventTypes: EventTypeOption[];
  eventTypeOtherDetails: string;
};

const EQUIPMENT_SECTION_LABEL = "Equipment Needed:";
const EVENT_TYPE_SECTION_LABEL = "Event Type:";
const ADDITIONAL_INFO_LABEL = "Additional Information:";
const EQUIPMENT_OTHER_LABEL = "Equipment Other Details:";
const EVENT_TYPE_OTHER_LABEL = "Event Type Other Details:";

function isEquipmentNeededOption(value: string): value is EquipmentNeededOption {
  return (EQUIPMENT_NEEDED_OPTIONS as readonly string[]).includes(value);
}

function isEventTypeOption(value: string): value is EventTypeOption {
  return (EVENT_TYPE_OPTIONS as readonly string[]).includes(value);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function parseStructuredCheckboxLines(
  lines: string[],
  sectionLabel: string,
  isValid: (value: string) => boolean,
) {
  const sectionStart = lines.indexOf(sectionLabel);
  if (sectionStart === -1) return null;
  const values: string[] = [];
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.startsWith("- ")) break;
    const value = line.slice(2).trim();
    if (isValid(value)) {
      values.push(value);
    }
  }
  return values;
}

function parseStructuredFieldLine(lines: string[], fieldLabel: string) {
  const line = lines.find((entry) => entry.startsWith(fieldLabel));
  if (!line) return "";
  return line.slice(fieldLabel.length).trim();
}

function parseLegacyEquipmentNeededText(rawValue: string): EventRequestFormState {
  const normalized = rawValue.trim();
  if (!normalized) {
    return {
      selectedEquipment: [],
      equipmentOtherDetails: "",
      selectedEventTypes: [],
      eventTypeOtherDetails: "",
    };
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const selectedEquipment = parseStructuredCheckboxLines(
    lines,
    EQUIPMENT_SECTION_LABEL,
    isEquipmentNeededOption,
  ) as EquipmentNeededOption[] | null;
  const selectedEventTypes = parseStructuredCheckboxLines(
    lines,
    EVENT_TYPE_SECTION_LABEL,
    isEventTypeOption,
  ) as EventTypeOption[] | null;
  const equipmentOtherDetails =
    parseStructuredFieldLine(lines, EQUIPMENT_OTHER_LABEL) ||
    parseStructuredFieldLine(lines, ADDITIONAL_INFO_LABEL);
  const eventTypeOtherDetails = parseStructuredFieldLine(
    lines,
    EVENT_TYPE_OTHER_LABEL,
  );

  if (
    selectedEquipment ||
    selectedEventTypes ||
    equipmentOtherDetails ||
    eventTypeOtherDetails
  ) {
    return {
      selectedEquipment: selectedEquipment ?? [],
      equipmentOtherDetails,
      selectedEventTypes: selectedEventTypes ?? [],
      eventTypeOtherDetails,
    };
  }

  return {
    selectedEquipment: ["Other"],
    equipmentOtherDetails: normalized,
    selectedEventTypes: [],
    eventTypeOtherDetails: "",
  };
}

function normalizeV2Details(details: EventRequestDetailsV2): EventRequestFormState {
  const selectedEquipment = unique(
    details.equipmentNeeded.filter((value): value is EquipmentNeededOption =>
      isEquipmentNeededOption(value),
    ),
  );
  const selectedEventTypes = unique(
    details.eventTypes.filter((value): value is EventTypeOption =>
      isEventTypeOption(value),
    ),
  );
  return {
    selectedEquipment,
    equipmentOtherDetails: (
      details.equipmentOtherDetails ?? details.additionalInformation ?? ""
    ).trim(),
    selectedEventTypes,
    eventTypeOtherDetails: (details.eventTypeOtherDetails ?? "").trim(),
  };
}

export function toEventRequestFormState(
  value: EventRequestDetails | string | null | undefined,
): EventRequestFormState {
  if (!value) {
    return {
      selectedEquipment: [],
      equipmentOtherDetails: "",
      selectedEventTypes: [],
      eventTypeOtherDetails: "",
    };
  }
  if (typeof value === "string") {
    return parseLegacyEquipmentNeededText(value);
  }
  if (value.version === 2) {
    return normalizeV2Details(value);
  }
  return parseLegacyEquipmentNeededText(value.equipmentNeededText);
}

export function buildEventRequestDetailsV2(
  formState: EventRequestFormState,
): EventRequestDetailsV2 | null {
  const selectedEquipment = unique(formState.selectedEquipment);
  const equipmentOtherDetails = formState.equipmentOtherDetails.trim();
  const selectedEventTypes = unique(formState.selectedEventTypes);
  const eventTypeOtherDetails = formState.eventTypeOtherDetails.trim();

  if (
    selectedEquipment.length === 0 &&
    equipmentOtherDetails.length === 0 &&
    selectedEventTypes.length === 0 &&
    eventTypeOtherDetails.length === 0
  ) {
    return null;
  }

  return {
    version: 2,
    equipmentNeeded: selectedEquipment,
    equipmentOtherDetails:
      selectedEquipment.includes("Other") ? equipmentOtherDetails : "",
    eventTypes: selectedEventTypes,
    eventTypeOtherDetails:
      selectedEventTypes.includes("Other") ? eventTypeOtherDetails : "",
  };
}

export function summarizeEventRequestDetails(
  value: EventRequestDetails | string | null | undefined,
) {
  const formState = toEventRequestFormState(value);
  return {
    equipmentNeeded: formState.selectedEquipment.join(", "),
    additionalInformation: formState.equipmentOtherDetails,
    eventTypes: [
      formState.selectedEventTypes.join(", "),
      formState.selectedEventTypes.includes("Other") &&
      formState.eventTypeOtherDetails
        ? `Other: ${formState.eventTypeOtherDetails}`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  };
}

export function formatLegacyEquipmentNeededText(
  value: EventRequestDetails | string | null | undefined,
) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value.version === 1) {
    const trimmed = value.equipmentNeededText.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const lines: string[] = [];
  if (value.equipmentNeeded.length > 0) {
    lines.push(
      EQUIPMENT_SECTION_LABEL,
      ...value.equipmentNeeded.map((option) => `- ${option}`),
    );
  }
  if (
    (value.equipmentOtherDetails ?? value.additionalInformation ?? "").trim() &&
    value.equipmentNeeded.includes("Other")
  ) {
    lines.push(
      `${EQUIPMENT_OTHER_LABEL} ${(value.equipmentOtherDetails ?? value.additionalInformation ?? "").trim()}`,
    );
  }
  if (value.eventTypes.length > 0) {
    lines.push(
      EVENT_TYPE_SECTION_LABEL,
      ...value.eventTypes.map((option) => `- ${option}`),
    );
  }
  if (
    (value.eventTypeOtherDetails ?? "").trim() &&
    value.eventTypes.includes("Other")
  ) {
    lines.push(
      `${EVENT_TYPE_OTHER_LABEL} ${(value.eventTypeOtherDetails ?? "").trim()}`,
    );
  }
  const joined = lines.join("\n").trim();
  return joined.length > 0 ? joined : null;
}
