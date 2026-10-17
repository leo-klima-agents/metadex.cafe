# 3. Comparable products and evidence

What comparable products do, and what published research says, on the questions the organisation has to settle. Many
DeFi apps render in the browser only, so some page structures come from their docs, guides and forum posts rather than
from the live app; claims from a single secondary source are marked _(one source)_.

## Vote automation products

| Product                                    | Model                                                                                                          | Organisation                                                                                                                       | Lesson for metaDEX Café                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aerodrome and Velodrome Relay              | Deposit the veNFT into a managed one that compounds or converts rewards; no withdrawal in the epoch of deposit | Inside the DEX: a Relay row on the Lock tab → pick a lock → acknowledge the lock extension → confirm _(one source, 2024)_          | Custody is the cost users fear most. metaDEX Café transfers nothing: that is its main advantage, and it must be shown and checkable, not only stated.                             |
| Autopilot (Mellow, on Aerodrome)           | Non-custodial; votes and claims each epoch                                                                     | Landing at `/` ("No clicks. Just yield.", live APR, TVL, audits) and the app at `/app`                                             | The closest analogue chose the two-page split. Its users still asked a moderator on a call whether "signing over the voting rights" was safe: the landing page did not answer it. |
| Votium (vlCVX delegation)                  | Delegate once; a manual vote overrides it for that proposal only                                               | Docs: Quickstart, Voter Manual, Rewards and Fees, **Risks** (split by audience), Audits, Multisig Admin Rights, Contract Addresses | A risks page split by audience, and one page on what the admin can do. "Your CVX is NEVER staked on Votium" is the custody claim, stated once and plainly.                        |
| VeBetterDAO auto-voting                    | One toggle; mid-round changes "only apply from the next round"; manual voting disabled while on                | A toggle in the app                                                                                                                | The same timing rule as Hydrex's epochs, said in one sentence. Members asked for reminders and expiry notices: they want to know when something stops.                            |
| Beefy                                      | Vaults                                                                                                         | List → vault page with a deposit box; a **Risk Checklist** that shows failed checks first and folds the passed ones                | The page's startup checks map onto this: show a failed check prominently, fold the passed ones under "the page checked …".                                                        |
| Aero upgrade hub (Aerodrome and Velodrome) | A migration with a deadline                                                                                    | Countdown → key dates → timeline → a section per audience with a checklist → FAQ → official portals                                | A template for telling holders that something they relied on has stopped and what to do now: what holders of stopped Hydrex automations need.                                     |

Two of these closed or changed because the DEX built automation in: Autopilot wound down as Aero launched its own
automation, saying third-party automations "are becoming redundant" _(one source)_. Hydrex has gone the other way and
disabled its own. The site should be ready for both: holders arriving because Hydrex's automations stopped, and the day
Hydrex offers one again.

## A site and an app

| Product | What it does today                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------- |
| Safe    | `safe.global` explains, with a Trust menu (audits, bug bounty, status); "Launch app" → `app.safe.global` |
| Lido    | `lido.fi` explains, with live APR and TVL; "Stake" → `stake.lido.fi`                                     |
| Morpho  | `morpho.org` explains by audience (institutions, fintechs, users); links straight into vaults            |
| Aave    | The app is listed at a path on the same domain, `aave.com/app` _(one source)_                            |
| Uniswap | `uniswap.org` now redirects to `app.uniswap.org`: app first                                              |

- **Content before connection.** Login walls make people leave, and "Get started" buttons that jump to sign-up before
  giving context stop them (Nielsen Norman Group). Ethereum.org's heuristics: "show as much of the app as possible while
  disconnected". Base's guidelines: let users explore before signing in, and say "Sign in" rather than "Connect wallet".
- **Phishing.** Drainers have impersonated Lido and others with search ads that showed the official domain; Curve's
  domain was hijacked twice through its registrar. A subdomain for the app does not help, as both sit with the same
  registrar. What helps is one origin, bookmarks, and a way to verify the front end: Lido publishes IPFS hashes; metaDEX
  Café already has a reproducible build and the official address in its footer.
- **Indexing.** Several ve-DEX docs, Hydrex's included, return only their title to a crawler that does not run
  JavaScript. Explanations belong in the HTML itself; only the live numbers should be filled in by the script, as the
  current page already does.
- **Safe Apps.** Safe asks for `manifest.json` at the app's root, the Safe selected as the account on its own, and a
  graceful fallback outside Safe. New listings have been paused since mid-2026, so Safe users add apps as custom apps by
  URL: that URL must be stable and documented, and should open on the app, not on marketing.

## Signing and transaction review

- **Users misread what they sign, and plain language helps.** Recent studies report that users misread critical
  parameters and rely on brand familiarity, and that structured plain-language explanations raised comprehension from
  about half to about three quarters and the rejection of malicious transactions from about a third to almost nine in
  ten (two 2026 papers on arXiv, 2601.16751 and 2512.06933).
- **Wallets will not explain this call.** `setConduitApproval(conduit, tokenId, true)` moves no tokens, so wallets that
  simulate show no balance change and, at best, a decoded call. The page's own review is the only plain-language account
  of what joining allows: it must stay in the review, next to Confirm, whatever the organisation.
- **Revoking is the exit.** Disconnecting a wallet removes no approval (Revoke.cash); leaving is the revoke. It should
  be as visible and as short as joining.
- **Progressive disclosure, at most two levels** (Nielsen Norman Group): a summary, then the full version. Staged
  disclosure, like a wizard, only where the steps are distinct, which they are in a join: prepare, understand, sign.
- **Several transactions.** Base recommends batching sequential steps (EIP-5792 `wallet_sendCalls`), which some wallets
  now support on Base; a Safe already proposes one transaction for all accounts. Where a flow must stay several prompts,
  show a count and report each item's outcome.
- **Ethereum.org's seven heuristics** for web3 apps sum up the rest: feedback after every action and every step; trust
  and risks shown; the most important information obvious; clear words; short actions; the network visible and the app
  usable while disconnected; control and history in the app, with explorer links.

## Carbon and impact

- **Klima 2.0.** Retiring carbon means burning kVCM; retirements are irreversible, and buyers receive a publicly
  verifiable certificate through Carbonmark. Klima's site is organised as How it works, For buyers, For suppliers, Trust
  and transparency, FAQ, then Launch app.
- **A certificate page** on Carbonmark reads, in order: Proof of Retirement, date, tonnes, **On behalf of**, retirement
  message, initiating account, transaction, PDF, share links, project details. Retirements made by an automated agent
  show "On behalf of: Automated Carbon Retirement Bot", which credits nobody. Carbon Impact retires "in the name
  Hydrex": the member who gave up a third of their rewards is not on the certificate. Regen and Toucan both carry a
  beneficiary and a message on each retirement.
- **What motivates.** Investors pay for sustainability but not more for more impact: the motive is a warm glow,
  sensitive to relative rather than absolute impact (Heeb et al., 2023). Simple ratings moved billions while detailed
  data was ignored (Hartzmark and Sussman, 2019). Environmental appeals outperformed money-saving appeals in field
  tests, and stressing money reduced take-up (Bolderdijk et al., 2013; Schwartz et al., 2015). These studies are of
  general audiences, not ve-token holders, who are drawn by yield: Theo will not be moved by warm glow, Sofia will.
- **A counter people feel.** Ecosia changed its personal counter from searches to trees so that users need not "make any
  calculations"; users later missed it when it went _(one source)_.

## Time and many positions

- **Say the weekday and the time, every time.** Curve repeats "Thursday 00:00 UTC" in its introduction, its voting
  section and its FAQ, with a worked example: vote on Wednesday and it counts on Thursday; vote on Friday and wait a
  week. The Aero hub writes "Oct 21, 8:00 PM EDT (Oct 22, 00:00 UTC)" next to a countdown.
- **Relative time for how far off, absolute time for the exact moment** (Cloudscape); add the time zone to absolute
  times; avoid "midnight" for deadlines.
- **Status needs more than colour, and a meaning.** At least two cues besides colour, no more than five or six statuses
  on a screen (Carbon Design System). Uniswap pairs each status with its consequence: "out of range … does not earn
  fees". For an account in a stopped automation, the consequence is the point.
- **Bulk actions.** A count of what is selected, an action bar that appears on selection, and an outcome per item when
  some fail (eBay Playbook and others).

## What the evidence means for the organisation

1. **Two pages, one origin.** The closest analogue (Autopilot) and most DeFi products split explaining from acting; a
   path on the same domain (`/app/`) keeps one official address against phishing and gives Safe one stable URL.
2. **Explain before connecting, in static HTML.** Home must work, and be indexable, without a wallet or a script.
3. **Disclosures where the decision is.** The review is the only place a wallet user will get a plain explanation of
   this call; the long version belongs on a linkable reference page, split by audience.
4. **A page for people whose automation stopped.** The Aero hub is the model: what changed, what it means for your
   account, what to do, by when.
5. **One impact unit, with proof and a name.** Tonnes, linked to the certificate; and the question of whose name is on
   it, which the organisation cannot answer but must make room for.
6. **Status with consequences.** Every account status says what it means for votes and rewards, in text, with the date
   of the next change.

## Sources

- Relay: <https://github.com/velodrome-finance/relay>,
  <https://github.com/velodrome-finance/contracts/blob/main/SPECIFICATION.md>,
  <https://gist.github.com/dkackman/bc0c223377f89d71b13c2c2f41fb25ca>
- Aero upgrade hub: <https://aero.xyz/aero-upgrade/>
- Autopilot: <https://www.theautopilot.xyz/>, <https://defillama.com/protocol/autopilot>,
  <https://cryptobriefing.com/mellow-winds-down-autopilot-aero-launch/>
- Votium: <https://docs.votium.app/explainers/voter-manual.md>, <https://docs.votium.app/faq/risks.md>
- VeBetterDAO:
  <https://vechain.discourse.group/t/vebetterdao-proposal-auto-voting-for-x-allocation-with-gasless-voting-and-relayer-rewards/559>
- Beefy: <https://docs.beefy.finance/safety/risk-checklist>
- Sites and apps: <https://safe.global/>, <https://lido.fi/>, <https://morpho.org/>, <https://aave.com/>
- Nielsen Norman Group: <https://www.nngroup.com/articles/login-walls/>,
  <https://www.nngroup.com/articles/get-started/>, <https://www.nngroup.com/articles/progressive-disclosure/>
- Ethereum.org heuristics: <https://ethereum.org/developers/docs/design-and-ux/heuristics-for-web3.md>
- Base guidelines: <https://github.com/base/docs/pull/433/files>
- Phishing: <https://infosecurity-magazine.com/news/crypto-drainer-steals-59m-google-x>,
  <https://namefi.io/r/en/blog/the-curve-finance-dns-hijack>, <https://threesigma.xyz/blog/defi-front-end-exploits>,
  <https://docs.lido.fi/ipfs/apps-list>
- Indexing: <https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics>
- Safe Apps: <https://help.safe.global/articles/1158568108-how-to-build-a-safe-app-and-get-it-listed-in-safewallet>
- Signing research: <https://arxiv.org/abs/2601.16751>, <https://arxiv.org/abs/2512.06933>
- Approvals: <https://revoke.cash/learn/approvals/what-are-token-approvals>
- Batching: <https://docs.metamask.io/wallet/how-to/send-transactions/send-batch-transactions/>
- Klima and Carbonmark: <https://www.klimaprotocol.com/blog/klima-2-protocol-announcement>,
  <https://www.klimaprotocol.com/>, <https://docs.klimaprotocol.com/carbon-buyers-handbook/overview.md>
- Regen and Toucan:
  <https://guides.regen.network/guides/regen-marketplace-buyers-guides/ecocredits/retire-ecocredits/retirement-certification>,
  <https://cdn.jsdelivr.net/npm/toucan-sdk@1.0.6-beta/docs/modules.md>
- Impact research: <https://papers.ssrn.com/abstract=3765659>,
  <https://rafi.com/do-investors-value-sustainability-a-natural-experiment-examining-ranking-and-fund-flows>,
  <https://ideas.repec.org/a/nat/natcli/v3y2013i4d10.1038_nclimate1767.html>,
  <https://repositorio.uchile.cl/handle/2250/131937>
- Ecosia: <https://blog.ecosia.org/new-personal-counter/>
- Time and status: <https://docs.curve.finance/user/dao/gauge-weights>,
  <https://cloudscape.design/patterns/general/timestamps/>, <https://designsystem.maersk.com/content/date-and-time/>,
  <https://carbondesignsystem.com/patterns/status-indicator-pattern/>,
  <https://support.uniswap.org/hc/en-us/articles/32514988932877>,
  <https://playbook.ebay.com/design-system/patterns/bulk-edit>
