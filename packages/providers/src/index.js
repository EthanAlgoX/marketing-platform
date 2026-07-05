"use strict";

try {
  module.exports = require("../dist/index.js");
} catch (error) {
  if (error && error.code === "MODULE_NOT_FOUND") {
    throw new Error(
      "Provider runtime build is missing. Run `pnpm --filter @marketing-platform/providers build` before starting the compiled API.",
    );
  }
  throw error;
}
