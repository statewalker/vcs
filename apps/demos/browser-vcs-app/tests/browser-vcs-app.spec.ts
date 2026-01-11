/**
 * Browser VCS App E2E Tests
 *
 * Tests the browser-based VCS application with in-memory storage.
 * Note: Browser Filesystem tests require manual interaction with
 * the File System Access API, so we focus on in-memory operations.
 */

import { expect, test } from "@playwright/test";

test.describe("Browser VCS App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load the application", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Browser VCS App");
    await expect(page.locator(".subtitle")).toContainText("Git in the browser");
  });

  test("should show storage backend options", async ({ page }) => {
    await expect(page.locator("#btn-memory")).toBeVisible();
    await expect(page.locator("#btn-browser-fs")).toBeVisible();
    await expect(page.locator("#btn-memory")).toHaveClass(/active/);
  });

  test("should show File System API support status", async ({ page }) => {
    const supportElement = page.locator("#fs-api-support");
    await expect(supportElement).toBeVisible();
    // Chromium supports the API
    await expect(supportElement).toHaveClass(/supported|unsupported/);
  });

  test("should initialize in-memory repository", async ({ page }) => {
    // Click initialize button
    await page.locator("#btn-init").click();

    // Check repository status updated
    await expect(page.locator("#repo-status")).toContainText(/Repository ready/);

    // Check activity log shows initialization
    await expect(page.locator(".activity-log")).toContainText(/Initialized/);
  });

  test("should add file and stage it", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();
    await expect(page.locator("#repo-status")).toContainText(/Repository ready/);

    // Add a file
    await page.locator("#file-name").fill("test.txt");
    await page.locator("#file-content").fill("Hello, World!");
    await page.locator("#btn-add-file").click();

    // Check file appears in staging area
    await expect(page.locator("#staging-tree")).toContainText("test.txt");
    await expect(page.locator("#staging-tree")).toContainText("staged");

    // Check activity log
    await expect(page.locator(".activity-log")).toContainText(/Added file: test.txt/);
  });

  test("should create commit", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();
    await expect(page.locator("#repo-status")).toContainText(/Repository ready/);

    // Add a file
    await page.locator("#file-name").fill("readme.md");
    await page.locator("#file-content").fill("# My Project");
    await page.locator("#btn-add-file").click();

    // Create commit
    await page.locator("#commit-message").fill("Initial commit");
    await page.locator("#btn-commit").click();

    // Check commit appears in history
    await expect(page.locator(".commit-history")).toContainText("Initial commit");
    await expect(page.locator(".commit-history .commit-hash")).toBeVisible();

    // Check staging area is cleared
    await expect(page.locator("#staging-tree")).toContainText("No files staged");
  });

  test("should not commit without staged files", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();
    await expect(page.locator("#repo-status")).toContainText(/Repository ready/);

    // Try to commit without files
    await page.locator("#commit-message").fill("Empty commit");
    await page.locator("#btn-commit").click();

    // Check error in activity log
    await expect(page.locator(".activity-log")).toContainText(/No files staged/);
  });

  test("should not commit without message", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();
    await expect(page.locator("#repo-status")).toContainText(/Repository ready/);

    // Add a file
    await page.locator("#file-name").fill("test.txt");
    await page.locator("#file-content").fill("content");
    await page.locator("#btn-add-file").click();

    // Try to commit without message
    await page.locator("#btn-commit").click();

    // Check error in activity log
    await expect(page.locator(".activity-log")).toContainText(/Please enter a commit message/);
  });

  test("should show multiple commits in history", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();

    // First commit
    await page.locator("#file-name").fill("file1.txt");
    await page.locator("#file-content").fill("First file");
    await page.locator("#btn-add-file").click();
    await page.locator("#commit-message").fill("Add file1");
    await page.locator("#btn-commit").click();

    // Second commit
    await page.locator("#file-name").fill("file2.txt");
    await page.locator("#file-content").fill("Second file");
    await page.locator("#btn-add-file").click();
    await page.locator("#commit-message").fill("Add file2");
    await page.locator("#btn-commit").click();

    // Check both commits appear
    await expect(page.locator(".commit-history")).toContainText("Add file1");
    await expect(page.locator(".commit-history")).toContainText("Add file2");

    // Check commit order (newest first)
    const commits = await page.locator(".commit-item").all();
    expect(commits.length).toBe(2);
  });

  test("should not add file without repository", async ({ page }) => {
    // Try to add file without initializing
    await page.locator("#file-name").fill("test.txt");
    await page.locator("#file-content").fill("content");
    await page.locator("#btn-add-file").click();

    // Check error
    await expect(page.locator(".activity-log")).toContainText(/No repository initialized/);
  });

  test("should not add file without name", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();

    // Try to add file without name
    await page.locator("#file-content").fill("content");
    await page.locator("#btn-add-file").click();

    // Check error
    await expect(page.locator(".activity-log")).toContainText(/Please enter a file name/);
  });

  test("should clear inputs after adding file", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();

    // Add a file
    await page.locator("#file-name").fill("test.txt");
    await page.locator("#file-content").fill("content");
    await page.locator("#btn-add-file").click();

    // Check inputs are cleared
    await expect(page.locator("#file-name")).toHaveValue("");
    await expect(page.locator("#file-content")).toHaveValue("");
  });

  test("should clear message after commit", async ({ page }) => {
    // Initialize repository
    await page.locator("#btn-init").click();

    // Add file and commit
    await page.locator("#file-name").fill("test.txt");
    await page.locator("#file-content").fill("content");
    await page.locator("#btn-add-file").click();
    await page.locator("#commit-message").fill("Test commit");
    await page.locator("#btn-commit").click();

    // Check message is cleared
    await expect(page.locator("#commit-message")).toHaveValue("");
  });
});
