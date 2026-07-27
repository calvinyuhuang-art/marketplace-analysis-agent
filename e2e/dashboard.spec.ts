import { expect, test } from "@playwright/test";
import { completeKdpFixture } from "../fixtures/evidence/kdp-fixtures";

test("dashboard renders and reports service health", async ({ page }) => {
  await page.goto("/");

  const healthCard = page.getByTestId("health-card");
  await expect(healthCard).toBeVisible();
  await expect(healthCard.getByText("ok")).toBeVisible();

  const readinessCard = page.getByTestId("readiness-card");
  await expect(readinessCard).toBeVisible();
  await expect(readinessCard.getByText("database")).toBeVisible();
});

test("test console runs a read-only probe", async ({ page }) => {
  await page.goto("/test-console");
  await page.getByRole("button", { name: "Probe /health" }).click();
  await expect(page.getByTestId("test-output")).toContainText("\"status\"");
});

test("new analysis with evidence shows readiness after reload", async ({ page, request }) => {
  const pkgId = `evpkg_e2e_${Date.now()}`;
  const registered = await request.post("http://127.0.0.1:4320/v1/evidence-packages", {
    data: completeKdpFixture(pkgId)
  });
  expect(registered.ok()).toBeTruthy();

  await page.goto("/new-analysis");
  await expect(page.getByTestId("new-analysis")).toBeVisible();

  await page.getByTestId("product-name").fill("Lofi Rainy Day Coloring Book");
  await page.getByTestId("sales-goal").fill("Validate pricing band for launch");
  await page.getByLabel("Evidence package IDs (comma-separated)").fill(pkgId);
  await page.getByTestId("submit-analysis").click();

  await expect(page.getByTestId("run-inspector")).toBeVisible({ timeout: 15_000 });
  const runId = await page.getByTestId("run-id").textContent();
  expect(runId).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("run-inspector")).toBeVisible();
  await expect(page.getByTestId("run-id")).toHaveText(runId!);

  await expect(page.getByTestId("readiness-drill-in")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-inspector")).toContainText(
    /completed|partial|evidence_insufficient|failed|cancelled/,
    { timeout: 45_000 }
  );

  const body = await page.getByTestId("run-inspector").textContent();
  if (body && /completed|partial/.test(body)) {
    await expect(page.getByTestId("open-finding-review")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("open-finding-review").click();
    await expect(page.getByTestId("finding-review")).toBeVisible({ timeout: 10_000 });
  }
});
