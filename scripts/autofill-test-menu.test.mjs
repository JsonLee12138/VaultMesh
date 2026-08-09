import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../autofill-test.html", import.meta.url), "utf8");

const suiteIds = [
  "save-capture-tests",
  "login-tests",
  "otp-tests",
  "passkey-tests",
  "card-tests",
  "identity-tests",
  "sensitive-item-tests",
  "account-lifecycle-tests",
  "runtime-tests",
];

test("autofill QA home routes every card to an existing suite", () => {
  for (const suiteId of suiteIds) {
    assert.match(html, new RegExp(`data-suite-card="${suiteId}"`));
    assert.match(html, new RegExp(`href="\\?suite=${suiteId}"`));
    assert.match(html, new RegExp(`<section class="section" id="${suiteId}"`));
  }

  assert.equal((html.match(/data-suite-card=/g) || []).length, suiteIds.length);
});

test("suite completion is tab-scoped and never stores form values", () => {
  assert.match(html, /sessionStorage\.setItem\(suiteStorageKey, JSON\.stringify\(status\)\)/);
  assert.doesNotMatch(html, /localStorage\./);
  assert.match(html, /status\[suiteId\] = new Date\(\)\.toISOString\(\)/);
});

test("suite pages expose both automatic and manual completion paths", () => {
  assert.match(html, /currentSuite\?\.mode === "audit"/);
  assert.match(html, /id="manual-pass-button"/);
  assert.match(html, /setSuitePassed\(currentSuite\?\.id\)/);
  assert.match(html, /id="home-button" href="\.\/autofill-test\.html"/);
});
