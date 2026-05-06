export function normalizeRoomNumber(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeRoomNumberInput(value: string) {
  return value.replace(/\s+/g, " ").toUpperCase();
}
