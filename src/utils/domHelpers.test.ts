import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, formatDuration, sanitizeTopicStatus } from "./domHelpers";

test("escapeHtml prevents XSS", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");

  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml("Alice"), "Alice");
  assert.equal(escapeHtml("O'Brien"), "O&#039;Brien");
  assert.equal(escapeHtml('Say "hello"'), "Say &quot;hello&quot;");
  assert.equal(escapeHtml("a < b"), "a &lt; b");
  assert.equal(escapeHtml("a > b"), "a &gt; b");
  assert.equal(escapeHtml("M&Ms"), "M&amp;Ms");

  const xss = '<script>alert("xss")</script>';
  assert.equal(escapeHtml(xss), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");

  const imgXss = '<img src=x onerror="alert(1)">';
  assert.equal(escapeHtml(imgXss), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");

  const safe = escapeHtml(xss);
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag
  assert.ok(!safe.includes("<script>"));
  assert.ok(!safe.includes("</script>"));
  assert.ok(!safe.includes('"'));
});

test("escapeHtml handles edge cases", () => {
  assert.equal(escapeHtml("   "), "   ");
  assert.equal(escapeHtml("a".repeat(1000)), "a".repeat(1000));

  assert.equal(escapeHtml("Jack &amp; Jill"), "Jack &amp;amp; Jill");

  assert.equal(escapeHtml("\n\t"), "\n\t");
});

test("escapeHtml in attribute context prevents injection", () => {
  const name = 'John "Drop Table" Doe';
  const escaped = escapeHtml(name);
  const attr = `data-name="${escaped}"`;
  assert.equal(attr, 'data-name="John &quot;Drop Table&quot; Doe"');

  const singleQuote = "O'Brien";
  const escaped2 = escapeHtml(singleQuote);
  const attr2 = `data-author="${escaped2}"`;
  assert.equal(attr2, 'data-author="O&#039;Brien"');
});

test("regression: malicious speaker name in transcript entry pattern", () => {
  const malicious = '<script>alert("xss")</script>';
  const speaker = escapeHtml(malicious);

  const initials = speaker
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  assert.equal(initials, "&");
  assert.ok(!initials.includes("<"));
  assert.ok(!initials.includes(">"));
  assert.ok(!initials.includes('"'));

  const html = `<div class="transcript-speaker">${speaker}</div>`;
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("escapeHtml output is safe when embedded in innerHTML", () => {
  const payloads = [
    '<script>alert("xss")</script>',
    '<img src=x onerror="alert(1)">',
    '"><script>alert(1)</script>',
    "javascript:alert(1)",
    "<<script>script>alert(1)</script>",
  ];

  for (const payload of payloads) {
    const escaped = escapeHtml(payload);
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag
    assert.ok(!escaped.includes("<script>"), `payload still contains <script>: ${payload}`);
    assert.ok(!escaped.includes("</script>"), `payload still contains </script>: ${payload}`);
    assert.ok(!escaped.includes('"'), `payload still contains double quote: ${payload}`);
  }
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "00:00:00");
  assert.equal(formatDuration(90), "00:01:30");
  assert.equal(formatDuration(3661), "01:01:01");
  assert.equal(formatDuration(86399), "23:59:59");
  assert.equal(formatDuration(360000), "100:00:00");
});

test("sanitizeTopicStatus", () => {
  assert.equal(sanitizeTopicStatus("completed"), "completed");
  assert.equal(sanitizeTopicStatus("unresolved"), "unresolved");
  assert.equal(sanitizeTopicStatus("active"), "active");
  assert.equal(sanitizeTopicStatus("pending"), "active");
  assert.equal(sanitizeTopicStatus(""), "active");
});
