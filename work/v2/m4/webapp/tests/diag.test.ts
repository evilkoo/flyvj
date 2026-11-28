// M4 unit tests — pure helpers in src/diag.ts (dev diagnostics contracts).
// Runs directly on the .ts source via `node --test` (erasable syntax only).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAG_ENDPOINTS,
  DIAG_MAX_AUDIO_BYTES,
  DIAG_MAX_JSONL_LINES,
  DIAG_MAX_META_BYTES,
  DIAG_MAX_BAND_SAMPLES,
  DIAG_AUDIO_MAX_MS,
  isLoopbackAddress,
  trimJsonlContent,
  chooseAudioMimeType,
  encodeDiagMetaHeader,
  decodeDiagMetaHeader,
} from "../src/diag.ts";

test("diag constants match the dev-diag contract", () => {
  assert.equal(DIAG_ENDPOINTS.status, "/__diag/status");
  assert.equal(DIAG_ENDPOINTS.telemetry, "/__diag/telemetry");
  assert.equal(DIAG_ENDPOINTS.audio, "/__diag/audio");
  assert.equal(DIAG_ENDPOINTS.audioMeta, "/__diag/audio-meta");
  assert.equal(DIAG_MAX_AUDIO_BYTES, 52428800);
  assert.equal(DIAG_MAX_META_BYTES, 8388608);
  assert.equal(DIAG_MAX_JSONL_LINES, 2000);
  assert.equal(DIAG_AUDIO_MAX_MS, 300000);
  assert.equal(DIAG_MAX_BAND_SAMPLES, 25000);
});

test("isLoopbackAddress: exactly the four allowed loopback forms", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("localhost"), true);
});

test("isLoopbackAddress: whitespace around allowed forms still passes", () => {
  assert.equal(isLoopbackAddress(" 127.0.0.1 "), true);
  assert.equal(isLoopbackAddress("\t::1\n"), true);
  assert.equal(isLoopbackAddress(" localhost "), true);
});

test("isLoopbackAddress: everything else is rejected", () => {
  assert.equal(isLoopbackAddress(undefined), false);
  assert.equal(isLoopbackAddress(""), false);
  assert.equal(isLoopbackAddress("   "), false);
  assert.equal(isLoopbackAddress("127.0.0.2"), false);
  assert.equal(isLoopbackAddress("10.0.0.1"), false);
  assert.equal(isLoopbackAddress("192.168.1.10"), false);
  assert.equal(isLoopbackAddress("::2"), false);
  assert.equal(isLoopbackAddress("::ffff:192.168.0.1"), false);
  assert.equal(isLoopbackAddress("0.0.0.0"), false);
  assert.equal(isLoopbackAddress("localhost.evil.com"), false);
});

test("trimJsonlContent: empty or whitespace-only content → empty string", () => {
  assert.equal(trimJsonlContent(""), "");
  assert.equal(trimJsonlContent("\n\n   \n\t\n"), "");
  assert.equal(trimJsonlContent("{\n}".slice(0, 0)), "");
});

test("trimJsonlContent: drops empty lines and keeps order with trailing newline", () => {
  assert.equal(trimJsonlContent('{"a":1}\n\n{"a":2}\n\n\n'), '{"a":1}\n{"a":2}\n');
  assert.equal(trimJsonlContent('{"a":1}\r\n{"a":2}\r\n'), '{"a":1}\n{"a":2}\n');
});

test("trimJsonlContent: keeps only the last maxLines", () => {
  const five = ["1", "2", "3", "4", "5"].map((n) => `{"n":${n}}`).join("\n") + "\n";
  assert.equal(trimJsonlContent(five, 2), '{"n":4}\n{"n":5}\n');
  assert.equal(trimJsonlContent(five, 5), five);
  assert.equal(trimJsonlContent(five, 0), "");
  assert.equal(trimJsonlContent(five, 99), five);
});

test("trimJsonlContent: default cap is DIAG_MAX_JSONL_LINES (2000 survive, 2001st dropped)", () => {
  const lines = Array.from({ length: 2001 }, (_, i) => `{"i":${i}}`).join("\n") + "\n";
  const trimmed = trimJsonlContent(lines);
  assert.equal(trimmed.split("\n").filter((l) => l.length > 0).length, 2000);
  assert.ok(trimmed.startsWith('{"i":1}'));
  assert.ok(trimmed.endsWith('{"i":2000}\n'));
});

test("chooseAudioMimeType: prefers webm;codecs=opus, then webm, then ogg, else empty", () => {
  assert.equal(
    chooseAudioMimeType(() => true),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    chooseAudioMimeType((mime) => mime === "audio/webm"),
    "audio/webm",
  );
  assert.equal(
    chooseAudioMimeType((mime) => mime.includes("ogg")),
    "audio/ogg;codecs=opus",
  );
  assert.equal(chooseAudioMimeType(() => false), "");
});

test("meta header roundtrip: ASCII object survives encode→decode", () => {
  const meta = { mimeType: "audio/webm;codecs=opus", startSongMs: 1200, endSongMs: 4600 };
  const encoded = encodeDiagMetaHeader(meta);
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/, "header value is plain base64");
  assert.deepEqual(decodeDiagMetaHeader(encoded), meta);
});

test("meta header roundtrip: Chinese labels and emoji survive UTF-8 encoding", () => {
  const meta = {
    label: "烏蠅VJ 測試 🎵",
    path: "mic-clip-latest.webm",
    note: "琶洲 arena — 第 2 層 第 5 欄",
  };
  assert.deepEqual(decodeDiagMetaHeader(encodeDiagMetaHeader(meta)), meta);
});

test("meta header roundtrip: empty object and nested structures", () => {
  assert.deepEqual(decodeDiagMetaHeader(encodeDiagMetaHeader({})), {});
  const nested = { agc: { ambient: { low: 0.1, mid: 0.2, high: 0.3 } }, list: [1, [2, "3"]] };
  assert.deepEqual(decodeDiagMetaHeader(encodeDiagMetaHeader(nested)), nested);
});

test("decodeDiagMetaHeader: missing input → null", () => {
  assert.equal(decodeDiagMetaHeader(undefined), null);
  assert.equal(decodeDiagMetaHeader(""), null);
  assert.equal(decodeDiagMetaHeader("   \t"), null);
});

test("decodeDiagMetaHeader: corrupt base64 → null", () => {
  assert.equal(decodeDiagMetaHeader("!!!not-base64!!!"), null);
  assert.equal(decodeDiagMetaHeader("abc"), null); // invalid base64 length
});

test("decodeDiagMetaHeader: valid base64 but not a JSON object → null", () => {
  const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
  assert.equal(decodeDiagMetaHeader(b64("just a string, not json")), null);
  assert.equal(decodeDiagMetaHeader(b64("42")), null);
  assert.equal(decodeDiagMetaHeader(b64("[1,2,3]")), null);
  assert.equal(decodeDiagMetaHeader(b64('"quoted"')), null);
  assert.equal(decodeDiagMetaHeader(b64("null")), null);
});

test("decodeDiagMetaHeader: valid base64 but invalid UTF-8 bytes → null", () => {
  const corrupt = btoa(String.fromCharCode(0xc3) + String.fromCharCode(0x28)); // broken 2-byte seq
  assert.equal(decodeDiagMetaHeader(corrupt), null);
});
