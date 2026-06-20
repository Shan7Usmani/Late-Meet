import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "./domHelpers";
import { sanitizeClassName, sanitizeDataAttr } from "./sanitize";

test("escapeHtml prevents XSS in text content", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");

  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml("hello"), "hello");
  assert.equal(escapeHtml("Alice & Bob"), "Alice &amp; Bob");
  assert.equal(
    escapeHtml("<script>alert('xss')</script>"),
    "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
  );

  const output = escapeHtml('<img src=x onerror="alert(1)">');
  assert.equal(output, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.ok(!output.includes('"'));
});

test("sanitizeClassName behavior", () => {
  const allowed = ["default-class", "active", "disabled"];

  // Empty or invalid allowed array should throw error
  assert.throws(() => {
    sanitizeClassName("active", []);
  }, /sanitizeClassName: allowed array must not be empty/);

  assert.throws(() => {
    sanitizeClassName("active", null as any);
  }, /sanitizeClassName: allowed array must not be empty/);

  // Null/undefined value should fall back to allowed[0]
  assert.equal(sanitizeClassName(null, allowed), "default-class");
  assert.equal(sanitizeClassName(undefined, allowed), "default-class");

  // Matching values
  assert.equal(sanitizeClassName("active", allowed), "active");
  assert.equal(sanitizeClassName("disabled", allowed), "disabled");

  // Non-matching values fallback to allowed[0]
  assert.equal(sanitizeClassName("unknown-class", allowed), "default-class");
  assert.equal(sanitizeClassName({ foo: "bar" }, allowed), "default-class");

  // Number/Boolean coercion check
  const mixedAllowed = ["123", "true", "fallback"];
  assert.equal(sanitizeClassName(123, mixedAllowed), "123");
  assert.equal(sanitizeClassName(true, mixedAllowed), "true");
  assert.equal(sanitizeClassName(false, mixedAllowed), "123");
});

test("sanitizeDataAttr behavior", () => {
  // Null/undefined inputs
  assert.equal(sanitizeDataAttr(null), "");
  assert.equal(sanitizeDataAttr(undefined), "");

  // Special characters escaping instead of stripping
  assert.equal(sanitizeDataAttr("some'value"), "some&#39;value");
  assert.equal(sanitizeDataAttr('some"value'), "some&quot;value");
  assert.equal(sanitizeDataAttr("some<value"), "some&lt;value");
  assert.equal(sanitizeDataAttr("some>value"), "some&gt;value");
  assert.equal(sanitizeDataAttr("some&value"), "some&amp;value");

  // Mix of special characters
  assert.equal(
    sanitizeDataAttr(`{"name":"John","role":"<admin>"}`),
    `{&quot;name&quot;:&quot;John&quot;,&quot;role&quot;:&quot;&lt;admin&gt;&quot;}`,
  );

  // Normal strings/numbers/booleans
  assert.equal(sanitizeDataAttr("normal-string-123"), "normal-string-123");
  assert.equal(sanitizeDataAttr(100.5), "100.5");
  assert.equal(sanitizeDataAttr(true), "true");
});
