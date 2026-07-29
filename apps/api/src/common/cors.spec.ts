import { DEFAULT_WEB_ORIGIN, parseAllowedOrigins } from "./cors";

describe("parseAllowedOrigins", () => {
  it("falls back to the local dev server when unset", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([DEFAULT_WEB_ORIGIN]);
  });

  it("falls back when the variable is present but blank", () => {
    expect(parseAllowedOrigins("")).toEqual([DEFAULT_WEB_ORIGIN]);
    expect(parseAllowedOrigins("   ")).toEqual([DEFAULT_WEB_ORIGIN]);
  });

  it("reads a single origin", () => {
    expect(parseAllowedOrigins("https://app.clinicpilot.io")).toEqual([
      "https://app.clinicpilot.io",
    ]);
  });

  it("splits a comma-separated list and trims whitespace", () => {
    expect(parseAllowedOrigins("http://localhost:5173, http://localhost:8081")).toEqual([
      "http://localhost:5173",
      "http://localhost:8081",
    ]);
  });

  it("drops empty entries from a trailing or doubled comma", () => {
    expect(parseAllowedOrigins("http://a.test,,http://b.test,")).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
  });
});
