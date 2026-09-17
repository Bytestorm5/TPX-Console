import { driverContractCases, eventLogContractCases } from "@alfiz/application/driver-suite";
import { describe, it } from "vitest";
import { freshStore } from "./harness";

// The Alfiz storage-driver conformance suite against the Convex functions,
// through the same adapter production uses. Each case gets a fresh backend.
describe("convex store — Alfiz storage contract", () => {
  for (const c of driverContractCases) it(c.name, () => c.run(freshStore().store.alfiz));
});

describe("convex store — event log contract", () => {
  for (const c of eventLogContractCases) it(c.name, () => c.run(freshStore().store.alfiz));
});
