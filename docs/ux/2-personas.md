# 2. Hydrex users

Who comes to metaDEX Café: holders of Hydrex accounts. This part sums up what is publicly known about them, then
describes four proto-personas. These come from desk research (Hydrex's app, docs and public API, community channels and
open-source tools around it), not from interviews: [6. Validation](6-validation.md) says how to test them.

## Hydrex in brief

Hydrex is a ve(3,3) DEX on Base ("Base's Universal Liquidity Engine"; third parties still call it a MetaDEX). Holders
lock HYDX into **Accounts**, NFTs that carry **Earning Power**, and each weekly **epoch** (Thursday 00:00 UTC, the
"epoch flip") they vote on pools and earn the pools' fees and bribes.

| Account type     | In Hydrex's words                                                                     | Relevance here                                |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| Flex Account     | "Lock and Get Paid Weekly". 2-year lock, 1:1.3 Earning Power, rolling lock by default | The common account; can join                  |
| Protocol Account | "Permanent Earning Power". From oHYDX conversion or rebases; permanently locked       | Often held alongside a Flex Account; can join |
| Liquid Account   | LP positions that earn oHYDX, no lock                                                 | Not a voting account; cannot join             |

Hydrex built voting automation on **conduits**, which its app calls automations: "Hydrex enables the automation of
voting, fee collection, and more … This automation is entirely optional." Its app offered an automation picker when a
Flex Account was created, with "No Automation (Manage Myself)" and 14 automations, each shown by name and the assets it
paid out in, and an account view with "Current payout – Automated to …", "Next payout" and "Automation History".
**Carbon Impact was one of them**, with a "Carbon impact" badge: "Part of the value from this automation supports Klima
Protocol's voluntary carbon offset program."

**Hydrex has since disabled its automations** (per the metaDEX Café team). Its public API still lists all 14, with the
Earning Power delegated to each at the current epoch, but only Carbon Impact still votes: its last vote was cast seconds
before the 15 October flip, while most others last voted on 9 September. The holders who used them have learnt the
vocabulary of automations (output asset, next payout, automated or manual) and have lost the thing it described.

## The numbers that shape the audience

From Hydrex's public API and community channels in October 2026 (sources at the end).

| Fact                                        | Value                                                                                  | What it means for the site                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lockers, lifetime                           | 4,015                                                                                  | A small, findable audience: recruit test participants from it                                                        |
| Earning Power delegated to automations      | 12.6 M, about 5% of the effective total                                                | A minority automated; they know what an automation is                                                                |
| Of which, in automations that no longer run | About 11.5 M, in 13 automations                                                        | Holders whose votes and claims sit with a stopped automation: the largest group that has a reason to come            |
| Carbon Impact's Earning Power               | 1.17 M                                                                                 | The one automation still running; metaDEX Café is now its door                                                       |
| Weekly rewards to all voters                | $56.9 K on 10 Sep, $15.0 K on 8 Oct                                                    | Rewards are falling; for most holders a week's rewards are a few dollars                                             |
| One optimiser's measured return             | $0.44 to $0.91 a week per 1,000 votes                                                  | A 10,000-vote holder earns about $5 to $9 a week, near Hydrex's $4 claim threshold per reward token                  |
| Concentration                               | The top 20 hold 49% of the top 200's Earning Power                                     | By headcount, small holders; by Earning Power, a few large holders and protocols                                     |
| HYDX price                                  | About $0.025, 98% below its high                                                       | Many holders are locked in at a loss; trust is low and attention is scarce                                           |
| Community                                   | Discord 6.1 K members; X 11.8 K followers                                              | Where users ask questions; where to recruit and to link the site from                                                |
| Wallets Hydrex recommends                   | "Sign in with Base" (Coinbase Smart Wallet), WalletConnect, browser wallets, Farcaster | Many holders sign with a smart wallet, often on a phone; Hydrex is also a Base and Farcaster mini app, portrait only |

Two conclusions follow:

1. **The "typical Hydrex user" is two people.** By headcount: a small holder on a phone, with a few dollars of weekly
   rewards, who wants nothing to do. By Earning Power: a large holder or a protocol on desktop, who counts every vote.
   The site must serve the first on a phone in a wallet app, and convince the second with numbers and verifiable detail.
2. **metaDEX Café is the way into the one automation that still runs.** With Hydrex's automations disabled, a holder who
   wants their votes handled has two choices this research could confirm: vote by hand every Thursday, or join Carbon
   Impact here (a third-party voter, Tropic Vote, advertises itself, unverified). The site's first audience is the
   holders left in a stopped automation, who may not know it has stopped. It also inherits the jobs Hydrex's automation
   pages did: the next payout, what happened last epoch, what is automated and what is not.

What Hydrex still publishes about Carbon Impact is out of date, and a holder who reads both will notice: its API lists
it as paying "60% kVCM, 40% AZUSD", but AZUSD no longer works and the automation no longer claims it; the page says it
pays kVCM and retires 33.33%. Hydrex's app also said a change of automation took effect "after the next payout", where
the page says claims move at once and votes from the next epoch. The site has to be the source of truth on its own
automation, and say so.

## Proto-personas

Four people, by how often they are met and what they decide. Each has the questions they ask, in the order they ask
them: the organisation of the site should answer them in that order.

### Maya, the set-and-forget holder

> "I picked the USDC automation so I would never have to vote. Now it has stopped, and I don't have time to vote every
> Thursday. I just want it to pay me."

|                     |                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who                 | One Flex Account on a rolling lock, 5,000 to 20,000 Earning Power. Came to Hydrex through Base: signed in with Base on a phone. Not a DeFi professional; knows "Account" and "Earning Power" from Hydrex's app, not "conduit" or "veNFT". |
| Today               | Was in the USDC or Liquid Hydrex automation, picked when the account was created. Hydrex has since disabled it: nobody runs it, and the account's votes and claims still point at it. Maya may not know.                                  |
| Weekly stake        | A few dollars. Giving up a third of it changes little; losing the account would change a lot.                                                                                                                                             |
| Arrives from        | A post from Hydrex or Klima about automations ending, a friend's link, X or Farcaster. On a phone, often in an in-app browser.                                                                                                            |
| Asks, in order      | 1. My automation stopped: what happens to my account now? 2. What is this, and is it connected to Hydrex? 3. Can it take my HYDX? 4. What do I get, and when? 5. Can I stop? 6. How do I do it from my phone?                             |
| Needs from the site | A first screen that answers 1 to 5 without jargon; a wallet connection that works with the wallet they have; a join that is one decision; reassurance after, in their own time zone.                                                      |
| Lost by             | A page that starts with contract addresses; a status that says "In another Hydrex automation: USDC" as if it still ran; a "connect" step that does not find their smart wallet; a review they cannot read on a small screen.              |

### Theo, the weekly optimiser

> "I vote in the last minutes before the flip and swap everything to USDC. Show me the net, or don't waste my time."

|                     |                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who                 | Several accounts, Flex and Protocol (from oHYDX), 200,000 to 2,000,000 Earning Power. Desktop, Rabby or MetaMask. Reads contracts; may run their own voting script.                                                      |
| Today               | Votes on their own each week; any automation they used for small accounts has stopped. Tracks dollars per 1,000 votes.                                                                                                   |
| Weekly stake        | Hundreds of dollars. A third retired is a real cost they will compute.                                                                                                                                                   |
| Arrives from        | Discord, a teammate, the contract on Basescan.                                                                                                                                                                           |
| Asks, in order      | 1. How does it vote: which pools, when? 2. What is my net after the share retired and the fee, against voting myself? 3. What exactly can it claim, and who can change the settings? 4. Can I put in only some accounts? |
| Needs from the site | Numbers and mechanics, quickly; the full disclosures and the contracts one click away; per-account choice; a review with the exact calls.                                                                                |
| Lost by             | Marketing without numbers; anything vague about the admin key; having to read the newcomer's explanation every visit.                                                                                                    |

Theo is unlikely to put all their Earning Power in Carbon Impact. They may put in a small account, or their Protocol
Account, and they are the one who will tell Discord whether the site is trustworthy.

### Sofia, the impact-minded holder

> "If my votes earn anyway, I'd rather a part of it did something real. But show me it's real."

|                     |                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who                 | A Hydrex holder who also follows ReFi on Base: Klima, Regen, tree and carbon projects. May hold kVCM. Some arrive from Klima with no Hydrex account yet.                    |
| Today               | In an automation, or voting on their own; would accept less yield for visible impact.                                                                                       |
| Weekly stake        | Small to medium. The share retired is the point, not a cost.                                                                                                                |
| Arrives from        | Klima's channels, a ReFi newsletter, Hydrex's community.                                                                                                                    |
| Asks, in order      | 1. What is retired, and where can I see it? 2. How much is because of me? 3. Why is it retired in Hydrex's name? 4. What do I keep? 5. (Without an account) how do I start? |
| Needs from the site | The carbon side explained in plain words, with proof they can follow; their share of the impact; something they can share; a route to Hydrex if they have no account.       |
| Lost by             | Impact claimed without proof; finding out after joining that the retirement does not carry their name or any trace of them.                                                 |

### Rafael, the treasury signer

> "Our protocol holds a Protocol Account in a Safe. If our votes retire carbon, that's a story we can tell. But I need
> three co-signers to agree."

|                     |                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who                 | A signer of a project's Safe on Base. The project bribes or provides liquidity on Hydrex and holds accounts for it.                                                                            |
| Today               | Votes for its own pools, or not at all.                                                                                                                                                        |
| Weekly stake        | Depends on whether its votes are needed for its own pools; joining gives them up.                                                                                                              |
| Arrives from        | A partnership conversation, Klima, or the Safe App.                                                                                                                                            |
| Asks, in order      | 1. Can we do it from our Safe? 2. What do I send my co-signers so they can check it? 3. What exactly will they sign? 4. Can we stop, and how fast? 5. Can the retirement carry our name?       |
| Needs from the site | The Safe App; a stable, linkable explanation of what joining allows and who controls what; a proposal decoded in Safe{Wallet}; a clear "what happens next" for a transaction others will sign. |
| Lost by             | Content that only exists inside a connected view; links that cannot point to a section.                                                                                                        |

There is no public evidence yet of DAOs using Safe with Hydrex; Rafael is the least certain persona and the one to test
first with a few real signers.

## Jobs to be done

| When…                                   | I want to…                                    | So that…                                          | Persona |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ------- |
| voting every week is not worth my time  | let my votes work on their own                | I still get paid, with nothing to do              | Maya    |
| I compare where my votes go             | see the net, the mechanics and the risks      | I choose on facts, account by account             | Theo    |
| my holdings earn anyway                 | have part of it do measurable good            | I can feel, and show, that it matters             | Sofia   |
| our treasury changes where its votes go | give co-signers something they can verify     | we sign without a meeting                         | Rafael  |
| my automation has stopped               | see it, and move my accounts to one that runs | my votes keep earning without my weekly attention | Maya    |
| I have joined                           | check that it works and what comes next       | I can stay, or leave, with confidence             | All     |

## What the personas ask of the organisation

- **A status that tells the truth about other automations.** Most visitors' accounts sit in an automation Hydrex no
  longer runs. The App must say so, and say what joining changes for them, before anything else.
- **Two speeds.** Maya and Sofia need a page that explains before it asks; Theo and Rafael need to get past it at once.
  One scroll cannot do both (audit, P2).
- **The decision is a comparison.** Every persona compares Carbon Impact with something: Maya with a stopped automation
  and voting by hand, Theo with voting on their own, Sofia with doing nothing for the climate, Rafael with voting for
  the project's own pools. The site never offers that comparison today (P3).
- **Proof and linkability.** Theo's and Rafael's trust, and Sofia's, rests on detail they can check and send to someone
  else: it needs stable, linkable pages (P9, P10).
- **Phones and smart wallets first.** Maya is the most common holder, on a phone with a smart wallet. The page today
  finds wallets the browser announces and `window.ethereum`; a holder who signs in with Base outside a wallet app's
  browser may find nothing to connect.

## Sources

- Hydrex app and its JavaScript bundles: <https://www.hydrex.fi>, <https://www.hydrex.fi/manifest.json>
- Hydrex docs: <https://docs.hydrex.fi>
- Hydrex API: <https://api.hydrex.fi/conduits>, <https://api.hydrex.fi/stats/lifetime>,
  <https://api.hydrex.fi/stats/vetoken/global-earning-power>, <https://api.hydrex.fi/stats/holder-earning-power>
- Hydrex SDK: <https://registry.npmjs.org/@hydrexfi/hydrex-sdk>
- TVL: <https://api.llama.fi/protocol/hydrex>; price: <https://www.coingecko.com/en/coins/hydrex>
- A public optimiser and its measured returns: <https://github.com/RichJamo/hydrex-optimiser>; a third-party voter:
  <https://www.tropic.vote/>
- Community size: Discord invite API; <https://alphagrowth.io/hydrex/community>
- Klima and Hydrex: <https://docs.klimaprotocol.com/roadmap-and-timeline>,
  <https://www.coingecko.com/en/coins/klima-protocol-kvcm>
- A protocol bribing on Hydrex:
  <https://forum.regen.network/t/lpdao-proposal-launch-regen-single-sided-staking-pool-on-hydrex-base/546>
