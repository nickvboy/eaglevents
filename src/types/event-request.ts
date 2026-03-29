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
  "Audio PA",
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
  additionalInformation: string;
  eventTypes: EventTypeOption[];
};

export type EventRequestDetails = EventRequestDetailsV1 | EventRequestDetailsV2;

export type EventRequestFormState = {
  selectedEquipment: EquipmentNeededOption[];
  additionalInformation: string;
  selectedEventTypes: EventTypeOption[];
};

const EQUIPMENT_SECTION_LABEL = "Equipment Needed:";
const EVENT_TYPE_SECTION_LABEL = "Event Type:";
const ADDITIONAL_INFO_LABEL = "Additional Information:";

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
      additionalInformation: "",
      selectedEventTypes: [],
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
  const additionalInformation = parseStructuredFieldLine(
    lines,
    ADDITIONAL_INFO_LABEL,
  );

  if (selectedEquipment || selectedEventTypes || additionalInformation) {
    return {
      selectedEquipment: selectedEquipment ?? [],
      additionalInformation,
      selectedEventTypes: selectedEventTypes ?? [],
    };
  }

  return {
    selectedEquipment: ["Other"],
    additionalInformation: normalized,
    selectedEventTypes: [],
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
    additionalInformation: details.additionalInformation.trim(),
    selectedEventTypes,
  };
}

export function toEventRequestFormState(
  value: EventRequestDetails | string | null | undefined,
): EventRequestFormState {
  if (!value) {
    return {
      selectedEquipment: [],
      additionalInformation: "",
      selectedEventTypes: [],
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
  const additionalInformation = formState.additionalInformation.trim();
  const selectedEventTypes = unique(formState.selectedEventTypes);

  if (
    selectedEquipment.length === 0 &&
    additionalInformation.length === 0 &&
    selectedEventTypes.length === 0
  ) {
    return null;
  }

  return {
    version: 2,
    equipmentNeeded: selectedEquipment,
    additionalInformation:
      selectedEquipment.includes("Other") ? additionalInformation : "",
    eventTypes: selectedEventTypes,
  };
}

export function summarizeEventRequestDetails(
  value: EventRequestDetails | string | null | undefined,
) {
  const formState = toEventRequestFormState(value);
  return {
    equipmentNeeded: formState.selectedEquipment.join(", "),
    additionalInformation: formState.additionalInformation,
    eventTypes: formState.selectedEventTypes.join(", "),
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
  if (value.additionalInformation.trim() && value.equipmentNeeded.includes("Other")) {
    lines.push(`${ADDITIONAL_INFO_LABEL} ${value.additionalInformation.trim()}`);
  }
  if (value.eventTypes.length > 0) {
    lines.push(
      EVENT_TYPE_SECTION_LABEL,
      ...value.eventTypes.map((option) => `- ${option}`),
    );
  }
  const joined = lines.join("\n").trim();
  return joined.length > 0 ? joined : null;
}
