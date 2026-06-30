import { sanitizePluginName } from "./git-install.js";

describe("sanitizePluginName", () => {
  it("accepts boring repo names", () => {
    expect(sanitizePluginName("my-hermes_plugin.1")).toBe("my-hermes_plugin.1");
  });

  it("rejects traversal", () => {
    expect(() => sanitizePluginName("../bad")).toThrow(/letters/);
  });
});
