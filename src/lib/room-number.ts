export function normalizeRoomNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
