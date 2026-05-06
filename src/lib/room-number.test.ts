import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRoomNumber, normalizeRoomNumberInput } from "./room-number";

void test("room number input keeps typed spaces while uppercasing", () => {
  assert.equal(normalizeRoomNumberInput("room a "), "ROOM A ");
  assert.equal(normalizeRoomNumberInput("room   a"), "ROOM A");
});

void test("room number normalization trims submitted values", () => {
  assert.equal(normalizeRoomNumber(" room   a "), "ROOM A");
});
