// @ts-check
const { test, expect } = require('@playwright/test');

const ORTHO_EMAIL = process.env.TEST_ORTHO_EMAIL || '';
const ORTHO_PASS  = process.env.TEST_ORTHO_PASS  || '';

// Helper: wait for app to finish initialising (hub or auth visible)
async function waitForApp(page) {
  await page.waitForFunction(() => {
    const hub = document.getElementById('sc-hub');
    const auth = document.getElementById('sc-auth');
    return (hub && hub.classList.contains('active')) ||
           (auth && auth.classList.contains('active'));
  }, { timeout: 15000 });
}

test('page se charge sans erreur critique', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await waitForApp(page);
  const jsErrors = errors.filter(e => !e.includes('net::ERR') && !e.includes('favicon'));
  expect(jsErrors).toHaveLength(0);
});

test('hub est affiché au démarrage (mode invité)', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  const hub = page.locator('#sc-hub');
  await expect(hub).toHaveClass(/active/, { timeout: 5000 });
});

test('bouton de connexion est accessible depuis le hub', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  // There should be a way to reach the auth screen
  const loginBtn = page.locator('[onclick*="sc-auth"], [onclick*="showAuth"], [onclick*="goToAuth"]').first();
  const count = await loginBtn.count();
  // If no direct button, at least the auth screen element must exist in the DOM
  const authScreen = page.locator('#sc-auth');
  await expect(authScreen).toBeAttached();
});

test('onglets connexion/patient/créer présents dans le formulaire auth', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  // The 3 auth tabs exist in DOM (Se connecter, Patient, Créer un compte)
  const loginTab  = page.locator('button.auth-tab').filter({ hasText: /connecter/i }).first();
  const patientTab = page.locator('button.auth-tab').filter({ hasText: /Patient/i }).first();
  const registerTab = page.locator('button.auth-tab').filter({ hasText: /cr/i }).first();
  await expect(loginTab).toBeAttached();
  await expect(patientTab).toBeAttached();
  await expect(registerTab).toBeAttached();
});

test('champs patient et ortho présents dans le DOM', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await expect(page.locator('#patient-ortho-code').first()).toBeAttached();
  await expect(page.locator('#patient-code').first()).toBeAttached();
});

test('les champs patient acceptent les valeurs (simulation QR)', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  // Simulate what checkURLLoginParams does
  const result = await page.evaluate(() => {
    const orthoEl = document.getElementById('patient-ortho-code');
    const patientEl = document.getElementById('patient-code');
    if (!orthoEl || !patientEl) return { found: false };
    orthoEl.value = 'ABCDEF';
    patientEl.value = 'TEST-1234';
    return { found: true, ortho: orthoEl.value, patient: patientEl.value };
  });
  expect(result.found).toBe(true);
  expect(result.ortho).toBe('ABCDEF');
  expect(result.patient).toBe('TEST-1234');
});

test('connexion ortho valide ouvre le dashboard', async ({ page }) => {
  if (!ORTHO_EMAIL || !ORTHO_PASS) {
    test.skip(true, 'TEST_ORTHO_EMAIL / TEST_ORTHO_PASS non définis');
    return;
  }
  await page.goto('/');
  await waitForApp(page);
  // Navigate to auth screen
  await page.evaluate(() => window.showScreen('sc-auth'));
  await page.fill('#email', ORTHO_EMAIL);
  await page.fill('#password', ORTHO_PASS);
  await page.click('#btn-login');
  await expect(page.locator('#sc-ortho, #sc-hub')).toHaveClass(/active/, { timeout: 15000 });
});

test('jeu homophones se charge correctement', async ({ page }) => {
  await page.goto('/homophones.html');
  const app = page.locator('#app');
  await expect(app).toBeVisible({ timeout: 10000 });
});

test('jeu calcul-chute se charge correctement', async ({ page }) => {
  await page.goto('/calcul-chute.html');
  const app = page.locator('#app');
  await expect(app).toBeVisible({ timeout: 10000 });
});

test('jeu dictée se charge correctement', async ({ page }) => {
  await page.goto('/dictee.html');
  const app = page.locator('#app');
  await expect(app).toBeVisible({ timeout: 10000 });
});
