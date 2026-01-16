import { test, expect } from '@playwright/test'

test('homepage renders masthead', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The Wedding Times' })).toBeVisible()
})

test('archive page renders archive heading', async ({ page }) => {
  await page.goto('/archive')
  await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible()
})

test('search page renders results header', async ({ page }) => {
  await page.goto('/search?q=berlin')
  await expect(page.getByRole('heading', { name: 'Search Results' })).toBeVisible()
})
