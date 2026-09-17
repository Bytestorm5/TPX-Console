import { expect, test, type Page } from "@playwright/test";

/**
 * The console in fixture mode: Ada Fixture is org:admin of "Ada's Org", which
 * tpx-auth bootstraps with a Default project and the default vocabulary
 * (just `prod`; the tests extend it with `staging`). State is in memory and
 * shared across tests, so they run serially in order.
 */
test.describe.configure({ mode: "serial" });

const shots = process.env.TPX_E2E_SHOTS ?? "";
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

/** Names are unique per run so the suite can be re-run against a dev server that kept its in-memory state. */
const run = Date.now().toString(36).slice(-5);
const connectionName = `GitHub (${run})`;
const attachmentName = `scm-${run}`;

test("health, sign-in and the landing redirect", async ({ page }) => {
  const health = await page.request.get("/healthz");
  expect(await health.json()).toEqual({ ok: true, service: "tpx-web" });

  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await shot(page, "01-sign-in");

  await page.goto("/");
  await expect(page).toHaveURL(/\/default\/prod$/);
  await expect(page.getByRole("heading", { name: "Default" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("Connections");
  await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("Operator");
  await expect(page.getByRole("navigation", { name: "Primary" })).toContainText("preview");
  await shot(page, "02-overview");
});

test("two-segment URLs redirect to the default environment; unknown scopes are 404", async ({ page }) => {
  await page.goto("/default");
  await expect(page).toHaveURL(/\/default\/prod$/);
  const missing = await page.goto("/nope/prod");
  expect(missing?.status()).toBe(404);
  await expect(page.getByText("project or environment not found")).toBeVisible();
});

test("extend the vocabulary and add a second environment to the project", async ({ page }) => {
  const existing = await page.goto("/default/staging");
  if (existing?.status() === 404) {
    await page.goto("/org/environments");
    await expect(page.getByRole("heading", { name: "Environments", exact: true })).toBeVisible();
    await page.getByLabel("Environments", { exact: true }).fill("prod, staging");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByTestId("vocabulary")).toContainText("staging");

    await page.goto("/default/prod");
    await page.getByLabel("Add environment").selectOption("staging");
    await page.getByTestId("environments-card").getByRole("button", { name: "Add" }).click();
  }
  await expect(page).toHaveURL(/\/default\/staging$/);
  await expect(page.getByLabel("Environment", { exact: true })).toBeVisible();
  await shot(page, "02b-overview-staging");
});

test("connect a provider from the marketplace, rotate and reveal a secret", async ({ page }) => {
  await page.goto("/default/prod/connections/marketplace");
  await expect(page.getByTestId("provider-github")).toBeVisible();
  await shot(page, "03-marketplace");
  await page.getByTestId("provider-github").getByRole("link", { name: "Connect" }).click();
  await expect(page.getByTestId("connect-form")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(connectionName);
  await page.getByLabel("Owner", { exact: true }).fill("trusplex");
  await page.getByLabel("Personal access token").fill("ghp_1234567890abcdef");
  await shot(page, "04-connect-form");
  await page.getByRole("button", { name: "Create connection" }).click();

  await expect(page).toHaveURL(/\/connections\/c\/con_/);
  await expect(page.getByRole("heading", { name: connectionName })).toBeVisible();
  await expect(page.getByTestId("values-card")).toContainText("••••cdef");
  await shot(page, "05-connection");

  // A per-environment default for "staging", then reveal it (audited).
  await page.getByRole("tab", { name: "staging" }).click();
  await expect(page).toHaveURL(/level=staging/);
  await page.getByLabel("Owner", { exact: true }).fill("trusplex-staging");
  await page.getByLabel("Personal access token").fill("ghp_staging_token_9999");
  await page.getByRole("button", { name: "Save values" }).click();
  await expect(page.getByTestId("values-card")).toContainText("••••9999");
  await page.getByRole("button", { name: "Reveal" }).first().click();
  await expect(page.getByTestId("revealed-secret")).toContainText("ghp_staging_token_9999");
  await shot(page, "06-revealed");

  // The list knows about it.
  await page.getByRole("link", { name: "Connected" }).click();
  await expect(page.getByRole("table")).toContainText(connectionName);
  await expect(page.getByRole("table")).toContainText("staging");
});

test("attach, override per environment, and promote with a diffed confirmation", async ({ page }) => {
  await page.goto("/default/prod/connections/attachments");
  await expect(page.getByTestId("attach-card")).toBeVisible();
  await page.getByLabel("Connection and capability").selectOption({ label: `${connectionName} — scm` });
  await page.getByLabel("Name", { exact: true }).fill(attachmentName);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(page).toHaveURL(/\/connections\/attachments\/att_/);
  await expect(page.getByTestId("resolved-card")).toContainText("available");
  await expect(page.getByTestId("resolved-owner")).toContainText("inherited");
  await shot(page, "07-attachment");

  // An environment override for prod…
  await page.getByTestId("binding-card").getByLabel("Owner", { exact: true }).fill("trusplex-prod");
  await page.getByTestId("binding-card").getByRole("button", { name: "Save environment override" }).click();
  await expect(page.getByTestId("resolved-owner")).toContainText("overridden");
  await expect(page.getByTestId("resolved-owner")).toContainText("trusplex-prod");

  // …promoted to staging after seeing the diff (staging inherits its owner from the connection default until then).
  await page.getByLabel("Target environment").selectOption({ label: "staging" });
  await page.getByRole("button", { name: "Plan promotion" }).click();
  await expect(page.getByTestId("promotion-plan")).toContainText("copy");
  await shot(page, "08-promotion-plan");
  await page.getByRole("button", { name: /Confirm promotion to staging/ }).click();
  await expect(page.getByTestId("promotion-done")).toBeVisible();

  // Staging now resolves the promoted values from its own binding.
  await page.goto("/default/staging/connections/attachments");
  await expect(page.getByTestId("resolution-card")).toContainText("overridden");
  await shot(page, "09-attachments-staging");

  await page.goto("/default/prod/connections/audit");
  await expect(page.getByRole("table")).toContainText("binding.promote");
  await expect(page.getByRole("table")).toContainText("secret.reveal");
  await shot(page, "10-audit");
});

test("workspace pages and the dark theme", async ({ page }) => {
  await page.goto("/org/projects");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(`Client site ${run}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("table")).toContainText(`client-site-${run}`);
  await shot(page, "11-projects");

  await page.goto("/org/access");
  await expect(page.getByRole("heading", { name: "Access", exact: true })).toBeVisible();
  await shot(page, "12-access");

  await page.goto("/default/prod");
  await page.getByRole("button", { name: /switch to dark theme/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await shot(page, "13-overview-dark");
  await page.goto("/default/prod/connections/marketplace");
  await shot(page, "14-marketplace-dark");
  await page.goto("/default/prod/connections/attachments");
  await shot(page, "15-attachments-dark");
});

test("the API forwarder carries the resolved scope to the service", async ({ page }) => {
  const providers = await page.request.get("/api/connections/providers", {
    headers: { "x-tpx-project": "default", "x-tpx-environment": "prod" },
  });
  expect(providers.status()).toBe(200);
  const list = (await providers.json()) as { id: string }[];
  expect(list.map((p) => p.id)).toContain("github");

  const resolved = await page.request.get("/api/connections/resolve/scm", {
    headers: { "x-tpx-project": "default", "x-tpx-environment": "staging" },
  });
  expect(resolved.status()).toBe(200);
  expect(await resolved.json()).toMatchObject({ capability: "scm", available: true });

  const whoami = await page.request.get("/api/workspace/whoami", {
    headers: { "x-tpx-project": "default", "x-tpx-environment": "staging" },
  });
  expect(whoami.status()).toBe(200);
  expect(await whoami.json()).toMatchObject({
    userId: "user_fixture",
    tenantId: "org_fixture",
    environmentName: "staging",
  });

  const noScope = await page.request.get("/api/connections/providers");
  expect(noScope.status()).toBe(400);
  const unknownProject = await page.request.get("/api/connections/providers", { headers: { "x-tpx-project": "nope" } });
  expect(unknownProject.status()).toBe(404);
  const unknownProduct = await page.request.get("/api/nothing/x", { headers: { "x-tpx-project": "default" } });
  expect(unknownProduct.status()).toBe(404);
});
