import { describe, expect, it } from "vitest";
import { formValues, prefixed } from "../src/lib/forms.ts";
import { maskHint } from "../src/lib/format.ts";

describe("form helpers", () => {
  it("flattens FormData, first value wins, files ignored", () => {
    const form = new FormData();
    form.append("name", "a");
    form.append("name", "b");
    form.append("file", new Blob(["x"]), "x.txt");
    expect(formValues(form)).toEqual({ name: "a" });
  });

  it("collects prefixed fields, dropping blanks unless asked to keep them", () => {
    const values = { "credential:token": "t", "credential:secret": "", "config:zone": "z", other: "o" };
    expect(prefixed(values, "credential")).toEqual({ token: "t" });
    expect(prefixed(values, "credential", true)).toEqual({ token: "t", secret: "" });
    expect(prefixed(values, "config")).toEqual({ zone: "z" });
  });

  it("never shows more than the hint", () => {
    expect(maskHint("ab12")).toBe("••••ab12");
    expect(maskHint(undefined)).toBe("••••••••");
  });
});
