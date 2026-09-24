// Drives a normal, visible Chrome the way TeslaTracker does: either by
// attaching to one you already run with --remote-debugging-port (CDP), or by
// launching one with headless off.
//
// Deliberately NOT included: stealth plugins, fingerprint spoofing, CAPTCHA
// solving or IP rotation. If a page stays on a challenge, we stop and report
// it instead of working around it.

import { chromium } from 'playwright-core';

export const BOT_ID = 'TesBidsBot/1.0 (+https://tesbids.com/bot)';
export const BOT_CONTACT = 'bot@tesbids.com';

export class BlockedError extends Error {
  constructor(source, reason) {
    super(`${source}: blocked (${reason})`);
    this.name = 'BlockedError';
    this.source = source;
    this.reason = reason;
  }
}

export async function openBrowser({ cdpUrl, executablePath, channel, headless = false } = {}) {
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    // close() on a CDP connection only disconnects; your Chrome keeps running.
    return { context, close: () => browser.close() };
  }
  const browser = await chromium.launch({ headless, executablePath, channel });
  const context = await browser.newContext();
  return { context, close: () => browser.close() };
}

// Signs of a bot check that hasn't cleared. Cloudflare and Imperva/Incapsula
// are what Cars & Bids and Copart use today.
async function challengeReason(page) {
  return page.evaluate(() => {
    const title = document.title || '';
    const text = document.body ? document.body.innerText.slice(0, 2000) : '';
    if (/just a moment/i.test(title)) return 'cloudflare challenge';
    if (document.querySelector('iframe[src*="_Incapsula_Resource"]')) return 'incapsula challenge';
    if (/request unsuccessful|access denied|you have been blocked/i.test(text)) return 'access denied page';
    return null;
  });
}

// Opens `url` in a fresh tab, waits for the page's own JSON responses whose
// URL matches `match`, and returns them. Also returns the page for DOM reads.
export async function capture(context, url, {
  source,
  match,
  settleMs = 15000,
  challengeWaitMs = 30000,
  navigationTimeoutMs = 60000,
} = {}) {
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ From: BOT_CONTACT, 'X-Bot': BOT_ID });
  const responses = [];
  page.on('response', async (res) => {
    try {
      if (!match(res.url())) return;
      if (!(res.headers()['content-type'] || '').includes('json')) return;
      responses.push({ url: res.url(), body: await res.json() });
    } catch {
      // Body unavailable (redirect, aborted request): ignore that response.
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });

  // A real browser often clears a managed check on its own within seconds.
  // If it doesn't, give up rather than escalate.
  const challengeDeadline = Date.now() + challengeWaitMs;
  let reason = await challengeReason(page).catch(() => null);
  while (reason && Date.now() < challengeDeadline) {
    await page.waitForTimeout(1000);
    reason = await challengeReason(page).catch(() => null);
  }
  if (reason) {
    await page.close();
    throw new BlockedError(source, reason);
  }

  const settleDeadline = Date.now() + settleMs;
  while (!responses.length && Date.now() < settleDeadline) await page.waitForTimeout(500);
  await page.waitForTimeout(1500); // let trailing requests land

  return { page, responses };
}

export function politePause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
