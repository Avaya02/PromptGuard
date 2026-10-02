import assert from "node:assert/strict";
import { test } from "node:test";

import { capitalize } from "../src/strings.js";

test("capitalize uppercases the first character", () => {
  assert.equal(capitalize("hello"), "Hello");
  assert.equal(capitalize(""), "");
});
