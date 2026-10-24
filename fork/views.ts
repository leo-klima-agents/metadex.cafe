import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { toFunctionSelector } from "viem";
import { blockTime, read } from "../src/chain.ts";
import { KVCM, VOTER } from "../src/config.ts";
import { readEarnings, rewardsFor, sharesOf, tokensOf } from "../src/earnings.ts";
import { WEEK, short } from "../src/format.ts";
import { readAccounts } from "../src/hydrex.ts";
import {
  SETTLED,
  blockTimes,
  payoutBlocks,
  payoutsIn,
  readEarned,
  readStamps,
  standingOf,
  weighed,
} from "../src/receipts.ts";
import {
  CONDUIT,
  BLOCK,
  FLIP,
  SITE,
  MEMBER,
  NEWCOMER,
  ELSEWHERE,
  ENDED,
  PAYEE,
  PAID,
  PAID_THROUGH,
  PAID_TX,
  PAID_IDS,
  RECIPIENT,
  anvil,
  warm,
  open,
  connected,
  app,
  hydrex,
  account,
  group,
  product,
  position,
  review,
  homeTitle,
  appTitle,
  hydrexTitle,
  toHydrex,
  connectButton,
  chip,
  pick,
  shoot,
  stop,
  hooks,
  startAtBlock,
} from "./harness.ts";

describe("the page against a fork of Base: its views, and each account's payouts", { timeout: 1_800_000 }, () => {
  before(startAtBlock);
  after(stop);
  hooks();

  test("Home first, the App at its address, Back and Forward, About, and an address the page does not know", async () => {
    const { page, asked, violations } = await open({ owner: NEWCOMER }, { width: 390, height: 844 });
    await homeTitle(page).waitFor();
    assert.equal(await appTitle(page).isVisible(), false);
    assert.equal(await page.title(), "metaDEX Café");
    // Home holds a heading and its one button; the header, the logo and the name, and a button to connect a wallet.
    const home = page.locator('.view[data-view="home"]');
    assert.deepEqual(await home.locator(".buttons a").allTextContents(), ["Open app"]);
    await connectButton(page).waitFor();
    assert.equal(await page.locator("header .to-app").isVisible(), false);
    assert.equal(await page.locator("header.site > .name img").getAttribute("src"), "icon.svg");
    assert.equal(await page.getByRole("navigation", { name: "Breadcrumb" }).count(), 0, "Home is the page's own");
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 844, "Home fits one screen");
    await shoot(page, "home-390-light");
    await home.getByRole("link", { name: "Open app" }).click();
    await appTitle(page).waitFor();
    assert.equal(await homeTitle(page).isVisible(), false);
    assert.equal(await page.title(), "Your wallet · metaDEX Café");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Your wallet");
    // The App lists the products: the Hydrex automations, and the swap.
    assert.deepEqual(await app(page).locator("#products h3").allInnerTexts(), ["Hydrex automations", "Swap tokens"]);
    assert.equal(await page.locator("header .to-app").getAttribute("aria-current"), "page");
    await app(page).getByRole("button", { name: "Test Wallet" }).waitFor();
    await shoot(page, "app-390-light");
    await page.goBack();
    await homeTitle(page).waitFor();
    assert.equal(await page.title(), "metaDEX Café");
    assert.equal(await page.locator("header .to-app").getAttribute("aria-current"), null);
    await page.goForward();
    await appTitle(page).waitFor();
    await page.locator("footer").getByRole("link", { name: "About" }).click();
    await page.getByRole("heading", { name: "About", level: 1 }).waitFor();
    assert.equal(await page.title(), "About · metaDEX Café");
    assert.equal(await page.getByRole("navigation", { name: "Breadcrumb" }).count(), 0, "About is the page's own");
    assert.deepEqual(await page.locator('.view[data-view="about"] > .rows dt').allInnerTexts(), [
      "Official address",
      "Cookies stored",
      "Version",
    ]);
    // Its rows are all there is: no popup. The footer leads to it, without the version, at the foot of the screen.
    assert.equal(await page.locator('.view[data-view="about"]').getByRole("button").count(), 0);
    assert.deepEqual(await page.locator("footer a").allTextContents(), ["About"]);
    const footer = (await page.locator("footer").boundingBox())!;
    assert.equal(Math.round(footer.y + footer.height), 844, "the footer is at the foot of the screen");
    await page.goto(`${SITE}/#about/check`);
    await homeTitle(page).waitFor();
    await page.goto(`${SITE}/#how-it-works`);
    await homeTitle(page).waitFor();
    assert.deepEqual(asked, [], "the page asks a wallet nothing until it is picked");
    assert.deepEqual(violations, []);
  });

  test("a wallet connected on Home or About leads on to the App, and Home stays Home afterwards", async () => {
    const { page, violations } = await open({ owner: NEWCOMER });
    await homeTitle(page).waitFor();
    await connectButton(page).click();
    await appTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "#app");
    await page.locator("header.site").getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    // From About too, and from no other page.
    const other = await open({ owner: NEWCOMER }, { url: `${SITE}/#about` });
    await other.page.getByRole("heading", { name: "About", level: 1 }).waitFor();
    await connectButton(other.page).click();
    await appTitle(other.page).waitFor();
    const hydrexFirst = await open({ owner: NEWCOMER }, { url: `${SITE}/#hydrex` });
    await hydrexTitle(hydrexFirst.page).waitFor();
    await connectButton(hydrexFirst.page).click();
    await chip(hydrexFirst.page, NEWCOMER).waitFor();
    assert.equal(new URL(hydrexFirst.page.url()).hash, "#hydrex");
    // A wallet asked on Hydrex's page and answered once its owner went Home leaves them there.
    let approve = () => {};
    const approval = new Promise<void>((resolve) => (approve = resolve));
    const late = await open({ owner: NEWCOMER, approval }, { url: `${SITE}/#hydrex` });
    await hydrexTitle(late.page).waitFor();
    await connectButton(late.page).click();
    await late.page.locator("header.site").getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(late.page).waitFor();
    approve();
    await chip(late.page, NEWCOMER).waitFor();
    assert.equal(new URL(late.page.url()).hash, "");
    assert.equal(await homeTitle(late.page).isVisible(), true);
    for (const each of [violations, other.violations, hydrexFirst.violations, late.violations])
      assert.deepEqual(each, []);
  });

  test("without the script, Home shows and says that the page needs it", async () => {
    const { page } = await open(false, { url: `${SITE}/#app`, script: false });
    await homeTitle(page).waitFor();
    // Chromium still parses <noscript> as if scripts ran when Playwright turns them off, so its words are read raw.
    assert.match(await page.locator("noscript").innerHTML(), /This page needs JavaScript\./);
    assert.equal(await appTitle(page).isVisible(), false);
  });

  test("a link in the review opens its section, Back keeps the ticks, and an account's page says what stopped", async () => {
    const { page, violations } = await connected({ owner: ELSEWHERE }, { width: 390, height: 844 });
    await pick(page, 2435, 2439);
    await page.getByRole("button", { name: "Join Carbon Impact with 2 Hydrex accounts" }).click();
    await review(page).getByRole("heading", { name: "Before you join" }).waitFor();
    await review(page).getByRole("link", { name: "Can change" }).click();
    assert.equal(await review(page).isVisible(), false);
    await page.locator('.pop:popover-open [data-section="control"]').getByText("The admin key").waitFor();
    assert.equal(await page.title(), "Carbon Impact · metaDEX Café");
    assert.equal(new URL(page.url()).hash, "#hydrex/carbon-impact/control");
    assert.equal(await appTitle(page).isVisible(), false);
    await page.goBack();
    await hydrexTitle(page).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "Pick Hydrex account #2439" }).isChecked(), true);
    await page.getByRole("button", { name: "Join Carbon Impact with 2 Hydrex accounts" }).waitFor();
    await account(page, 2439).getByRole("link", { name: "Hydrex account #2439" }).click();
    await position(page).getByRole("heading", { name: "Account #2439", level: 1 }).waitFor();
    assert.equal(new URL(page.url()).hash, "#hydrex/2439");
    assert.equal(await page.title(), "Hydrex account #2439 · metaDEX Café");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Account #2439");
    await position(page)
      .locator(".position-stopped")
      .getByText(/Earns nothing\s+since\s+Thu,? 10 Sept?\./)
      .waitFor();
    await position(page).getByRole("button", { name: "Join Carbon Impact", exact: true }).waitFor();
    await position(page).getByRole("button", { name: "Leave", exact: true }).waitFor();
    assert.equal(await position(page).locator(".position-owner-row").isVisible(), false, "its own account");
    await shoot(page, "stopped-account-390-light");
    // Its title leads back: "Your wallet › Hydrex › Account #2439".
    const trail = position(page).getByRole("navigation", { name: "Breadcrumb" });
    assert.deepEqual(await trail.getByRole("link").allInnerTexts(), ["Your wallet", "Hydrex"]);
    await trail.getByRole("link", { name: "Hydrex" }).click();
    await hydrexTitle(page).waitFor();
    // Hydrex's page leads back to the wallet, the App.
    await hydrex(page)
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Your wallet" })
      .click();
    await appTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "#app");
    assert.equal(await page.title(), "Your wallet · metaDEX Café");
    assert.equal(await homeTitle(page).isVisible(), false);
    // The App says what needs you across the products: here, the accounts in automations that stopped.
    const needs = app(page).locator("#needs");
    await needs.getByRole("heading", { name: "Needs you · 2" }).waitFor();
    await needs.getByText(/^Hydrex account #2439 earns nothing: USDC stopped since Wed,? 9 Sept?$/).waitFor();
    assert.equal(
      await needs.locator("li").filter({ hasText: "#2439" }).getByRole("link", { name: "Change" }).getAttribute("href"),
      "#hydrex/2439",
    );
    await app(page).locator(".hydrex-yours").getByText("2 Hydrex accounts", { exact: true }).waitFor();
    // With a wallet connected, Home is still Home: the name in the header leads there.
    await page.locator("header.site").getByRole("link", { name: "metaDEX Café" }).click();
    await homeTitle(page).waitFor();
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(await page.title(), "metaDEX Café");
    assert.equal(await appTitle(page).isVisible(), false);
    assert.deepEqual(violations, []);
  });

  test("what the votes earned last epoch: on the menu, for a member's account, and all of Hydrex once its popup opens", async () => {
    await warm(async () => {
      const found = (await readEarnings(CONDUIT))!;
      await sharesOf([9540n, 14485n], found.start, found.votes, CONDUIT);
    });
    // All of Hydrex takes too many reads for the fork to answer in time, so they are refused, and noted.
    const everyPool = toFunctionSelector("function totalWeightAt(uint256)").slice(2);
    let compared = false;
    const refuse = (body: string) => {
      const all = body.includes(everyPool);
      compared ||= all;
      return all;
    };
    const { page, violations } = await connected({ owner: MEMBER }, { width: 390, height: 844, refuse });
    // 7,919 of the automation's 897,043 votes.
    await account(page, 9540)
      .getByText(/≈\s\$6\.1\d last epoch/)
      .waitFor({ timeout: 120_000 });
    assert.equal(await account(page, 14485).locator(".earned").isVisible(), false, "its own account voted itself");
    await shoot(page, "member-earned-390-light");
    // What reached the owner for each 1,000 Earning Power: what the votes earned is in the record's popup.
    const menu = hydrex(page).locator('.choice[data-choice="carbon-impact"]');
    assert.match(await menu.locator(".record").innerText(), /^≈\s\$0\.\d\d$/);
    assert.equal(await menu.locator(".record-unit").innerText(), "per 1,000 Earning Power");
    await page.goto(`${SITE}/#hydrex/carbon-impact`);
    const impact = product(page, "carbon-impact");
    assert.match(await impact.locator(".record").innerText(), /^≈\s\$0\.\d\d$/);
    assert.equal(compared, false, "all of Hydrex waits until its popup opens");
    await page.goto(`${SITE}/#hydrex/carbon-impact/record`);
    const table = impact.locator(".earnings");
    assert.equal(await table.locator(".ours.earning-power").innerText(), "1.17M");
    assert.equal(await table.locator(".ours.pools").innerText(), "27 pools");
    assert.match(await table.locator(".ours.per-power").innerText(), /^≈\s\$0\.5\d$/);
    await impact.locator(".all-failed").getByText("Reading all of Hydrex failed.").waitFor();
    assert.equal(compared, true);
    assert.equal(await page.locator("#error").isVisible(), false, "the rest of the page is as it was");
    await impact.locator(".earned-pools tr").filter({ hasText: "AVNT / USDC" }).waitFor();
    await shoot(page, "record-390-light");
    // An account's page keeps what its votes earned once the wallet locks.
    await page.goto(`${SITE}/#hydrex/9540`);
    const earnedRow = position(page).locator(".position-earned-row");
    await earnedRow.getByText(/≈\s\$6\.1\d/).waitFor();
    await page.evaluate(() => (window as any).testWalletEmit("accountsChanged", []));
    await position(page).locator(".position-owner-row").getByText(short(MEMBER)).waitFor();
    assert.equal(await earnedRow.isVisible(), true);
    assert.deepEqual(violations, []);
  });

  test("an address the page cannot decode opens Home, and the script still runs", async () => {
    const { page, violations } = await open(false, { url: `${SITE}/#100%` });
    await homeTitle(page).waitFor();
    await page.goto(`${SITE}/#%E0%A4`);
    await homeTitle(page).waitFor();
    await page.locator('.view[data-view="home"]').getByRole("link", { name: "Open app" }).click();
    await appTitle(page).waitFor();
    await app(page).getByRole("button", { name: "Browser wallet" }).waitFor();
    await toHydrex(page);
    await hydrex(page)
      .locator(".impact-state")
      .getByText(/^(Running|Stopped)$/)
      .waitFor();
    assert.deepEqual(violations, []);
  });

  test("each account's last payout, found through Hydrex's reward contracts, and its receipt on its page", async () => {
    // PAYEE has 93 accounts: anvil reads them from FORK_URL for most of a minute the first time. #82774 was not paid in
    // last epoch's pools, so the page also reads the pools of the epoch before, among every pool's reward contracts.
    // MEMBER's #9540, whose page the test opens last, was paid weeks before, so the page looks further back for it. They
    // are all read first, with no time limit, as the page reads them, then their receipts' names and tokens.
    const ids = [...PAID_IDS, 9540n];
    await warm(async () => {
      const [earnings] = await Promise.all([readEarnings(CONDUIT), readAccounts(PAYEE)]);
      const last = { start: earnings!.start, pairs: weighed(earnings!.rewards, earnings!.prices) };
      const top = BLOCK - SETTLED;
      const [[time], stamps, earned, rewards] = await Promise.all([
        read([blockTime], top) as Promise<[bigint]>,
        readStamps(ids, last.pairs, top),
        readEarned(ids, last.pairs, top),
        rewardsFor(CONDUIT, earnings!.start - WEEK),
      ]);
      const before = { start: earnings!.start - WEEK, pairs: weighed(rewards, earnings!.prices) };
      const stampsBefore = await readStamps(ids, before.pairs, top);
      const standings = ids.map((id, i) =>
        standingOf(
          id,
          last,
          before,
          { last: stamps[i]!, earned: earned[i]!, before: stampsBefore[i]! },
          { last: true, before: true },
        ),
      );
      assert.deepEqual(
        standings.slice(0, PAID_IDS.length).map(({ through, late }) => [through, late]),
        PAID_IDS.map(() => [PAID_THROUGH, true]),
        "they were paid for neither epoch since",
      );
      const blocks = await payoutBlocks(standings, top, Number(time));
      assert.deepEqual(
        PAID_IDS.map((id) => blocks.get(id)),
        PAID_IDS.map(() => PAID),
      );
      const at = [...new Set(blocks.values())];
      const [paid] = await Promise.all([payoutsIn(at), blockTimes(at)]);
      assert.deepEqual(
        PAID_IDS.map((id) => paid.find((payout) => payout.id === id)?.tx),
        PAID_IDS.map(() => PAID_TX),
      );
      assert.ok(paid.some((payout) => payout.id === 9540n && payout.block === blocks.get(9540n)));
      await tokensOf(paid.flatMap(({ earned, paid, fees }) => [...earned, ...paid, ...fees]).map(({ token }) => token));
    });
    const { page, violations, rpc } = await connected(
      { owner: PAYEE },
      { width: 390, height: 844, dark: true, flowing: true },
    );
    // The App marks the account paid late.
    await account(page, 82774).getByText("Payout late").waitFor({ timeout: 120_000 });
    // Its receipt needs the symbols of the tokens it paid, such as kVCM, which only the account's page reads. If that
    // read fails, the page says so, and does not show the payouts as read.
    const symbol = toFunctionSelector("function symbol()").slice(2);
    rpc.refuse = (body) => body.includes(symbol) && body.includes(KVCM.slice(2).toLowerCase());
    await account(page, 82774).getByRole("link", { name: "Hydrex account #82774" }).click();
    const payoutsSection = position(page).locator(".position-payouts");
    await payoutsSection.getByText("Reading the payouts failed.").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(500);
    assert.equal(await payoutsSection.locator(".receipts-failed").isVisible(), true, "the failure stays");
    assert.equal(await payoutsSection.locator(".receipts-found").isVisible(), false);
    rpc.refuse = undefined;
    await payoutsSection.getByRole("button", { name: "Try again" }).click();
    const standing = position(page).locator(".standing");
    const receipt = standing.locator(".receipt");
    await receipt.first().waitFor({ timeout: 120_000 });
    assert.equal(await standing.count(), 1);
    assert.equal(await position(page).locator("h1").innerText(), "Account #82774");
    // On Fri 16 Oct, Carbon Impact owed it the epoch from Thu 1 Oct, and had paid nothing since Wed 23 Sep.
    assert.match(await standing.locator(".standing-late").innerText(), /^Late · paid up to Thu,? 17 Sept?$/);
    assert.equal(await standing.locator(".standing-paid").isVisible(), false);
    // What waits shows in tokens at once, then at prices now.
    await standing
      .locator(".standing-waiting")
      .getByText(/^(At least )?≈\s\$\d[\d,.]* waiting$/)
      .waitFor();
    assert.equal(await standing.locator(".standing-outside").isVisible(), false);
    assert.equal(await position(page).locator(".position-underway").isVisible(), false);
    assert.equal(await receipt.count(), 1);
    assert.equal(await receipt.locator(".receipt-id").textContent(), "Account #82774");
    assert.equal(await receipt.locator(".receipt-earned").innerText(), "8.56 USDC and 89.04 HYDX");
    assert.equal(await receipt.locator(".receipt-swapped").innerText(), "1,053.92 kVCM");
    assert.equal(await receipt.locator(".receipt-retired").innerText(), "−326.80 kVCM");
    assert.equal(await receipt.locator(".receipt-tonnes").innerText(), "65.26 t of carbon credits");
    assert.equal(await receipt.locator(".receipt-fee").innerText(), "0 kVCM");
    assert.equal(await receipt.locator(".receipt-paid").innerText(), "727.11 kVCM");
    // The epoch it paid for. The time is a label, which CSS shows in capitals, so it is read with textContent.
    assert.match((await receipt.locator(".receipt-day").textContent()) ?? "", /^Thu,? 10 Sept? to Thu,? 17 Sept?$/);
    assert.equal(await receipt.locator(".receipt-retired-share").innerText(), "31.01%");
    assert.equal(await receipt.locator(".receipt-fee-share").innerText(), "0%");
    assert.equal(await receipt.locator(".total dt").textContent(), "Paid to you");
    assert.equal(await receipt.locator(".receipt-elsewhere").isVisible(), false, "paid to the owner itself");
    assert.match((await receipt.locator("time.receipt-time").textContent()) ?? "", /^Wed,? 23 Sept?,? 17:44 UTC$/);
    assert.equal(
      await receipt.locator(".through img").isVisible(),
      true,
      "Klima Protocol's mark, beside the retirement",
    );
    assert.equal(
      await receipt.getByRole("link", { name: "Transaction" }).getAttribute("href"),
      `https://basescan.org/tx/${PAID_TX}`,
    );
    await receipt
      .locator(".receipt-paid-worth")
      .getByText(/^≈\s\$\d/)
      .waitFor({ timeout: 120_000 });
    // Its payout address, its owner's own, is behind an info button.
    await position(page).getByRole("button", { name: "Payout address" }).click();
    await position(page).locator(".position-payout:popover-open").getByText("(the owner)").waitFor();
    await page.keyboard.press("Escape");
    await shoot(page, "receipt-390-dark", position(page));
    // After the flip, the page reads Carbon Impact again and fills its figures, such as .tonnes, across the page. The
    // receipts keep their own.
    const entityName = toFunctionSelector("function retiringEntityName()").slice(2);
    const readAgain = page.waitForResponse((response) => !!response.request().postData()?.includes(entityName));
    await page.clock.setSystemTime((FLIP + 60) * 1000);
    await page.clock.runFor(30_000);
    await readAgain;
    await page.waitForTimeout(500);
    assert.equal(await receipt.locator(".receipt-retired").innerText(), "−326.80 kVCM");
    assert.equal(await receipt.locator(".receipt-tonnes").innerText(), "65.26 t of carbon credits");
    // A member's account last paid in an earlier payout has the receipt of that one; its own account has none.
    const member = await open({ owner: MEMBER }, { width: 390, height: 844, url: `${SITE}/#hydrex/9540` });
    const own = position(member.page).locator(".standing");
    await own.locator(".receipt").waitFor({ timeout: 120_000 });
    assert.match(await own.locator(".standing-late").innerText(), /^Late · paid up to Thu,? 27 Aug$/);
    assert.match((await own.locator("time.receipt-time").textContent()) ?? "", /^Thu,? 27 Aug,? 01:47 UTC$/);
    await position(member.page).locator(".position-owner-row").getByText(short(MEMBER)).waitFor();
    // Without the owner's wallet, its page speaks of its owner.
    await member.page.goto(`${SITE}/#hydrex/14485`);
    await position(member.page).getByText("Its owner votes with it").waitFor({ timeout: 60_000 });
    assert.equal(await position(member.page).locator(".position-payouts").isVisible(), false, "not in an automation");
    assert.deepEqual([...violations, ...member.violations], []);
  });

  test("a wallet that locks is let go, and connects again from a click", async () => {
    const { page } = await connected({ owner: NEWCOMER });
    await account(page, 141).waitFor();
    // An account's page stays when the wallet moves to another address or locks: about its owner, without actions.
    await page.goto(`${SITE}/#hydrex/141`);
    const actions = position(page).locator(".position-actions");
    await actions.getByRole("button", { name: "Join Carbon Impact", exact: true }).waitFor();
    await page.evaluate((other) => (window as any).testWalletEmit("accountsChanged", [other]), MEMBER);
    await position(page).getByText("Its owner votes with it").waitFor();
    await position(page).locator(".position-owner-row").getByText(short(NEWCOMER)).waitFor();
    assert.equal(await actions.isVisible(), false);
    await page.evaluate(() => (window as any).testWalletEmit("accountsChanged", []));
    await connectButton(page).waitFor();
    assert.equal(await position(page).getByText("Its owner votes with it").isVisible(), true);
    assert.equal(await actions.isVisible(), false);
    await page.goto(`${SITE}/#app`);
    await app(page).getByText("Connect a wallet").waitFor();
    for (const part of ["#accounts", "#none", "#epoch"]) assert.equal(await page.locator(part).isVisible(), false);
    await connectButton(page).waitFor();
    await page.getByRole("button", { name: "Test Wallet" }).click();
    await toHydrex(page);
    await account(page, 141).waitFor();
  });

  test("an ended lock offers nothing to tick", async () => {
    const { page } = await connected({ owner: ENDED });
    const nothing = group(page, "closed");
    await nothing.locator("summary").click();
    await account(page, 123351).getByText("Lock ended").waitFor();
    assert.equal(await account(page, 123351).locator(".pick").isVisible(), false);
    // Its box is there, hidden and disabled, and nothing shows where it would be clicked.
    const box = account(page, 123351).locator(".pick");
    assert.equal(await box.isDisabled(), true, "nothing can tick it");
    assert.equal(await account(page, 123351).locator(".tick").isVisible(), false, "nothing to click");
    assert.equal(await nothing.getByRole("button").count(), 0);
    await account(page, 123364).waitFor();
    // An automation's page lists those that can join it, and says when the wallet has none, as an address with no
    // account has.
    await page.goto(`${SITE}/#hydrex/carbon-impact`);
    const impact = product(page, "carbon-impact");
    await impact.getByRole("button", { name: "Join Carbon Impact", exact: true }).waitFor();
    assert.equal(await impact.locator(".mine-none").isVisible(), false);
    await page.evaluate((other) => (window as any).testWalletEmit("accountsChanged", [other]), RECIPIENT);
    await impact.getByText("No Hydrex account can join.").waitFor();
  });

  test("without a wallet in the browser, Browser wallet links to wallet apps", async () => {
    const { page } = await open(false, { width: 390, height: 844, url: `${SITE}/#app` });
    await app(page).getByRole("button", { name: "Browser wallet" }).click();
    await app(page).getByText("No wallet found.").waitFor();
    const links = app(page).locator(".no-wallet a");
    assert.deepEqual(await links.allTextContents(), ["Coinbase Wallet", "MetaMask"]);
    assert.deepEqual(await links.evaluateAll((found) => found.map((link) => (link as HTMLAnchorElement).href)), [
      "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fmetadex.cafe%2F%23app",
      "https://link.metamask.io/dapp/metadex.cafe/#app",
    ]);
    await shoot(page, "no-wallet-390-light");
    assert.equal(await page.locator("#accounts").isVisible(), false);
    // The header's button, which would connect the one wallet at once, says so in its popup.
    await page.goto(`${SITE}/#hydrex`);
    await hydrex(page).getByText("No wallet connected.").waitFor();
    await connectButton(page).click();
    const pop = page.locator("#connect:popover-open");
    await pop.getByText("No wallet found.").waitFor();
    assert.deepEqual(await pop.locator(".no-wallet a").allTextContents(), ["Coinbase Wallet", "MetaMask"]);
  });

  test("if the Voter cannot be read, the accounts still show", async () => {
    await anvil("anvil_setCode", [VOTER, "0x"]);
    const { page } = await connected({ owner: ELSEWHERE });
    await account(page, 2439).getByText("In USDC", { exact: true }).waitFor();
    await group(page, "other").getByText("#2435").waitFor();
    assert.equal(await page.locator("#error").isVisible(), false);
  });
});
