import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, Button, buttonClasses, Card, EmptyState, Field, Input, PageHeader, cn } from "../src/index.ts";

describe("@tpx/ui", () => {
  it("merges classes and lets later utilities win", () => {
    const hidden = Math.random() > 2;
    expect(cn("px-2", "px-4", hidden && "hidden")).toBe("px-4");
  });
  it("renders every button variant as a solid fill (never an outline)", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      const classes = buttonClasses(variant);
      // No border-width utility (`border`, `border-2`, `hover:border`), whatever the color tokens are called.
      const outline = classes.split(/\s+/).filter((token) => /^(?:[a-z-]+:)*border(?:-\d+)?$/.test(token));
      expect(outline).toEqual([]);
      expect(classes).toContain("rounded-sm");
    }
    expect(buttonClasses("primary")).toContain("bg-accent");
    expect(buttonClasses("primary")).toContain("text-on-accent");
    const html = renderToStaticMarkup(<Button variant="secondary">Find More</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain("Find More");
  });
  it("uses token utilities only — no raw hex or px in markup", () => {
    const html = renderToStaticMarkup(
      <Card>
        <PageHeader title="Connections" description="desc" />
        <Field label="Name" htmlFor="n">
          <Input id="n" />
        </Field>
        <Badge tone="success">available</Badge>
        <EmptyState title="Nothing here" />
      </Card>,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/\d+px/);
    expect(html).toContain("bg-surface-raised");
  });
});
