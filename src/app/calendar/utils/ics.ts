type ParsedIcsEvent = {
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
};

type ParsedIcsDate = {
  date: Date;
  isAllDay: boolean;
};

function normalizeSummary(value: string | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "tentative" || lowered === "free" || lowered === "busy") return null;
  return trimmed;
}

function extractEventNameFromDescription(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\\n/g, "\n");
  const match = /(?:^|\n)\s*Event Name:\s*([^\n]+)/i.exec(normalized);
  if (!match) return null;
  const name = match[1]?.trim();
  return name && name.length > 0 ? name : null;
}

function unfoldLines(text: string) {
  const lines = text.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const prev = unfolded.pop() ?? "";
      unfolded.push(prev + line.slice(1));
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseIcsDate(value: string): ParsedIcsDate | null {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6)) - 1;
    const day = Number(trimmed.slice(6, 8));
    return { date: new Date(year, month, day), isAllDay: true };
  }

  const match = /^(\d{8})T(\d{4,6})(Z?)$/.exec(trimmed);
  if (!match) return null;
  const [, datePart, timePart, utcFlag] = match;
  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(4, 6)) - 1;
  const day = Number(datePart.slice(6, 8));
  const hour = Number(timePart.slice(0, 2));
  const minute = Number(timePart.slice(2, 4));
  const second = timePart.length >= 6 ? Number(timePart.slice(4, 6)) : 0;
  const isUtc = utcFlag === "Z";
  const date = isUtc ? new Date(Date.UTC(year, month, day, hour, minute, second)) : new Date(year, month, day, hour, minute, second);
  return { date, isAllDay: false };
}

export function parseIcsEvents(text: string): ParsedIcsEvent[] {
  const lines = unfoldLines(text);
  const events: ParsedIcsEvent[] = [];
  let current: { title: string | null; description: string | null; start: ParsedIcsDate | null; end: ParsedIcsDate | null } | null =
    null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line === "BEGIN:VEVENT") {
      current = { title: null, description: null, start: null, end: null };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.start?.date) {
        const fallbackTitle = extractEventNameFromDescription(current.description);
        const title = normalizeSummary(current.title) ?? fallbackTitle ?? "Imported event";
        const start = current.start.date;
        const startAllDay = current.start.isAllDay;
        const endParsed = current.end?.date;
        const endAllDay = current.end?.isAllDay ?? false;
        const isAllDay = startAllDay || endAllDay;
        let end: Date;
        if (endParsed) {
          end = endParsed;
        } else if (isAllDay) {
          end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        } else {
          end = new Date(start.getTime() + 60 * 60 * 1000);
        }
        if (end <= start) {
          end = isAllDay
            ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
            : new Date(start.getTime() + 60 * 60 * 1000);
        }
        events.push({ title, start, end, isAllDay });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const keyPart = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const key = keyPart.split(";")[0]?.toUpperCase();
    if (!key) continue;
    if (key === "SUMMARY") {
      current.title = value;
    } else if (key === "DESCRIPTION") {
      current.description = value;
    } else if (key === "DTSTART") {
      current.start = parseIcsDate(value);
    } else if (key === "DTEND") {
      current.end = parseIcsDate(value);
    }
  }

  return events;
}
