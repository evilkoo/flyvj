import { test } from "node:test";
import assert from "node:assert/strict";
import { connectedValue, isParamMsg, isComposition, columnConnectPath, layerClearPath, paramByIdPath } from "../src/protocol.ts";

test("ParamState enum: 'Connected' string is on (M1 lesson: never === true)", () => {
  assert.equal(connectedValue("Connected"), true);
  assert.equal(connectedValue("Disconnected"), false);
  assert.equal(connectedValue("Empty"), false);
});

test("ParamState tolerance: boolean true and numeric ≥3 also count", () => {
  assert.equal(connectedValue(true), true);
  assert.equal(connectedValue(false), false);
  assert.equal(connectedValue(3), true);
  assert.equal(connectedValue(2), false);
  assert.equal(connectedValue(undefined), false);
  assert.equal(connectedValue(null), false);
});

test("isParamMsg accepts only the four M1-verified reply types", () => {
  for (const t of ["parameter_get", "parameter_set", "parameter_update", "parameter_subscribed"]) {
    assert.equal(isParamMsg({ type: t, id: 7, value: "Connected" }), true);
  }
  assert.equal(isParamMsg({ type: "parameter_update", value: 1 }), false); // no id
  assert.equal(isParamMsg({ type: "other", id: 1, value: 1 }), false);
  assert.equal(isParamMsg(null), false);
});

test("isComposition detects state push by columns+layers arrays", () => {
  assert.equal(isComposition({ layers: [], columns: [] }), true);
  assert.equal(isComposition({ layers: [] }), false);
  assert.equal(isComposition({ type: "parameter_update" }), false);
});

test("paths match M1-verified forms", () => {
  assert.equal(columnConnectPath(42), "/composition/columns/by-id/42/connect");
  assert.equal(paramByIdPath(9), "/parameter/by-id/9");
});

test("layerClearPath builds position-based layer clear address", () => {
  assert.equal(layerClearPath(1), "/composition/layers/1/clear");
  assert.equal(layerClearPath(5), "/composition/layers/5/clear");
});
