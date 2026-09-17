import { describe, expect, it } from "vitest";
import { QUEUES, parseEvent } from "../src/events.ts";
import { UpdateTenantEnvironmentsInputSchema, CreateGrantInputSchema } from "../src/auth.ts";
import { SecretLocatorSchema } from "../src/connections.ts";

describe("event bus", () => {
  it("names queues once", () => {
    expect(new Set(Object.values(QUEUES)).size).toBe(Object.values(QUEUES).length);
  });
  it("parses a contract-change event and rejects unknown types", () => {
    const event = parseEvent({
      id: "0b6a4a5c-8a3a-4a5a-9c3a-1e2f3a4b5c6d",
      at: 1,
      scope: { tenantId: "t", projectId: "p", environmentId: "e" },
      actorUserId: null,
      type: "integrator.contract.changed",
      payload: { contractId: "c1", summary: "field removed", severity: "breaking" },
    });
    expect(event.type).toBe("integrator.contract.changed");
    expect(() => parseEvent({ ...event, type: "nope" })).toThrow();
  });
});

describe("auth inputs", () => {
  it("keeps project defaults inside the vocabulary", () => {
    expect(
      UpdateTenantEnvironmentsInputSchema.safeParse({ environments: ["prod"], projectDefaults: ["dev"] }).success,
    ).toBe(false);
    expect(
      UpdateTenantEnvironmentsInputSchema.safeParse({ environments: ["prod", "dev"], projectDefaults: ["prod"] })
        .success,
    ).toBe(true);
  });
  it("requires exactly one of roleId / pattern on a grant", () => {
    expect(CreateGrantInputSchema.safeParse({ subject: "user:u", scope: "tpx.tenant:t" }).success).toBe(false);
    expect(
      CreateGrantInputSchema.safeParse({ subject: "user:u", scope: "tpx.tenant:t", roleId: "r", pattern: "p" }).success,
    ).toBe(false);
    expect(CreateGrantInputSchema.safeParse({ subject: "group:g", scope: "tpx.tenant:t", roleId: "r" }).success).toBe(
      false,
    );
    expect(CreateGrantInputSchema.safeParse({ subject: "org:o", scope: "tpx.tenant:t", roleId: "r" }).success).toBe(
      true,
    );
  });
});

describe("connections inputs", () => {
  it("discriminates secret locators", () => {
    expect(SecretLocatorSchema.safeParse({ level: "binding", attachmentId: "a", environmentId: "e" }).success).toBe(
      true,
    );
    expect(SecretLocatorSchema.safeParse({ level: "binding", attachmentId: "a" }).success).toBe(false);
  });
});
