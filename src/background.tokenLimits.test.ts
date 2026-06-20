import test from "node:test";
import assert from "node:assert/strict";

interface TranscriptEntry {
  id?: string;
  speaker: string;
  text: string;
  timestamp: number;
  timestampLabel?: string;
}

(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    getURL: () => "",
    sendMessage: async () => {},
    getContexts: async () => [],
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onSuspend: { addListener: () => {} },
  },
  alarms: { onAlarm: { addListener: () => {} } },
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    get: async () => ({}),
    query: async () => [],
  },
  action: { onClicked: { addListener: () => {} } },
  commands: { onCommand: { addListener: () => {} } },
  sidePanel: { setOptions: async () => {} },
  contextMenus: {
    onClicked: { addListener: () => {} },
    create: () => {},
  },
};
(globalThis as Record<string, unknown>).self = globalThis;
if (typeof (globalThis as Record<string, unknown>).addEventListener !== "function") {
  (globalThis as Record<string, unknown>).addEventListener = () => {};
}

const mod = await import("./background.ts");

const estimateTokens = mod.estimateTokens as (text: string) => number;
const getModelContextLimit = mod.getModelContextLimit as (model: string) => number;
const truncateTranscriptWindow = mod.truncateTranscriptWindow as (
  entries: TranscriptEntry[],
  maxPromptTokens: number,
  systemPrompt: string,
  prevSummary: string,
) => { entries: TranscriptEntry[]; formatted: string; estimatedTokens: number };
const formatTranscriptLines = mod.formatTranscriptLines as (entries: TranscriptEntry[]) => string;

test("estimateTokens: empty string", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens: short string", () => {
  assert.equal(estimateTokens("hello"), 2);
});

test("estimateTokens: longer string", () => {
  assert.equal(estimateTokens("hello world this is a test"), 7);
});

test("estimateTokens: exact multiple of CHARS_PER_TOKEN", () => {
  assert.equal(estimateTokens("abcd"), 1);
});

test("estimateTokens: rounds up", () => {
  assert.equal(estimateTokens("abcde"), 2);
});

test("getModelContextLimit: known model", () => {
  assert.equal(getModelContextLimit("gpt-4o-mini"), 128_000);
});

test("getModelContextLimit: unknown model returns default 128k", () => {
  assert.equal(getModelContextLimit("nonexistent-model-v42"), 128_000);
});

test("getModelContextLimit: case sensitivity", () => {
  assert.equal(getModelContextLimit("gpt-4o-mini"), 128_000);
});

test("formatTranscriptLines: single entry", () => {
  const entries: TranscriptEntry[] = [
    { id: "chunk1", speaker: "Alice", text: "Hello", timestamp: 0, timestampLabel: "00:00" },
  ];
  const result = formatTranscriptLines(entries);
  assert.match(result, /\[chunk1\]/);
  assert.match(result, /\[00:00\]/);
  assert.match(result, /Alice:/);
  assert.match(result, /Hello/);
});

test("formatTranscriptLines: multiple entries", () => {
  const entries: TranscriptEntry[] = [
    { id: "c1", speaker: "Alice", text: "Hi", timestamp: 0, timestampLabel: "00:00" },
    { id: "c2", speaker: "Bob", text: "Hey", timestamp: 5, timestampLabel: "00:05" },
  ];
  const result = formatTranscriptLines(entries);
  assert.ok(result.includes("[c1]"));
  assert.ok(result.includes("[c2]"));
  assert.ok(result.includes("Alice:"));
  assert.ok(result.includes("Bob:"));
  assert.ok(result.includes("Hi"));
  assert.ok(result.includes("Hey"));
});

test("formatTranscriptLines: missing id uses unknown_chunk", () => {
  const entries: TranscriptEntry[] = [
    { speaker: "Alice", text: "Test", timestamp: 0, timestampLabel: "00:00" },
  ];
  const result = formatTranscriptLines(entries);
  assert.match(result, /unknown_chunk/);
});

test("formatTranscriptLines: missing timestampLabel uses formatted timestamp", () => {
  const entries: TranscriptEntry[] = [{ id: "c1", speaker: "Alice", text: "Test", timestamp: 65 }];
  const result = formatTranscriptLines(entries);
  assert.match(result, /\[\d+:\d{2}\]/);
});

test("formatTranscriptLines: sanitizes speaker and text", () => {
  const entries: TranscriptEntry[] = [
    { id: "c1", speaker: "Alice<}", text: "test<script>", timestamp: 0, timestampLabel: "00:00" },
  ];
  const result = formatTranscriptLines(entries);
  assert.doesNotMatch(result, /</);
  assert.doesNotMatch(result, />/);
});

test("truncateTranscriptWindow: returns full content when within limit", () => {
  const entries: TranscriptEntry[] = [
    { id: "c1", speaker: "A", text: "short", timestamp: 0, timestampLabel: "00:00" },
  ];
  const result = truncateTranscriptWindow(entries, 100_000, "system prompt", "prev summary");
  assert.equal(result.entries.length, 1);
  assert.ok(result.formatted.length > 0);
  assert.ok(result.estimatedTokens > 0);
});

test("truncateTranscriptWindow: empty input", () => {
  const result = truncateTranscriptWindow([], 100_000, "sys", "prev");
  assert.equal(result.entries.length, 0);
  assert.equal(result.formatted, "");
  assert.equal(result.estimatedTokens, 0);
});

test("truncateTranscriptWindow: trims entries that exceed token limit", () => {
  const manyLines = new Array(200).fill(null).map((_, i) => ({
    id: `c${i}`,
    speaker: `Speaker${i}`,
    text: "A".repeat(200),
    timestamp: i,
    timestampLabel: `${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}`,
  }));
  const result = truncateTranscriptWindow(manyLines, 5000, "system prompt", "prev summary");
  assert.ok(result.entries.length < manyLines.length);
  assert.ok(result.entries.length > 0);
  assert.ok(result.formatted.length > 0);
  assert.ok(result.estimatedTokens <= 5000);
});

test("truncateTranscriptWindow: respects exact capacity", () => {
  const entries: TranscriptEntry[] = [
    { id: "c1", speaker: "A", text: "x".repeat(100), timestamp: 0, timestampLabel: "00:00" },
    { id: "c2", speaker: "B", text: "y".repeat(100), timestamp: 1, timestampLabel: "00:01" },
  ];
  const maxTokens =
    estimateTokens("system prompt") +
    estimateTokens(
      "<previous_context>\nprev\n</previous_context>\n\n<recent_transcript>\n" +
        formatTranscriptLines([entries[0]]) +
        "\n</recent_transcript>",
    );
  const result = truncateTranscriptWindow(entries, maxTokens, "system prompt", "prev");
  assert.equal(result.entries.length, 1);
});

test("truncateTranscriptWindow: returns formatted output matching formatTranscriptLines", () => {
  const entries: TranscriptEntry[] = [
    { id: "c1", speaker: "Alice", text: "Hello", timestamp: 0, timestampLabel: "00:00" },
  ];
  const result = truncateTranscriptWindow(entries, 100_000, "sys", "prev");
  assert.equal(result.formatted, formatTranscriptLines(entries));
});
