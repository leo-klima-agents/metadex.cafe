# Brand

How metaDEX Café looks and speaks: the name, the voice, what it may claim, type, colour, the mark, navigation, and the
layout of slips and receipts. `style.css` and `index.html` follow these rules. Sources were checked on 17 Oct 2026.

## The name

- **Café:** exchanges began in coffeehouses. In 1698, John Castaing posted the prices of stocks at Jonathan's
  Coffee-House, a list that became the London Stock Exchange's Daily Official List
  ([Wikipedia](https://en.wikipedia.org/wiki/Jonathan%27s_Coffee-House)), and Lloyd's began in Edward Lloyd's coffee
  house ([Wikipedia](https://en.wikipedia.org/wiki/Lloyd%27s_Coffee_House)). A café where votes are cast and the figures
  posted every week follows that line: the warmth of a café, the record of an exchange. A café also has a menu and a
  receipt, structures people know, which the page uses.
- **Not a food coin.** Food names in crypto carry the reputation of 2020's failures, such as YAM and HOTDOG. PancakeSwap
  and Beefy show that a lasting product with plain figures outlives it. So: no mascot, no token, no APY as a headline,
  and no puns where money moves.
- **metaDEX:** Dromos Labs, behind Velodrome, Aerodrome and Aero, calls its model "MetaDEX™"
  ([Dromos](https://dromos.xyz/)). The word tells Hydrex and Aero voters the page is for them, but it ties the name to a
  mark another company uses. The lowercase "meta" keeps it a word in the name. The page should say that it is
  independent of Dromos and of Hydrex, and a trademark check comes before any money is spent on a mark.

## Voice

- Plain words, every figure read from Base, and no pressure.
- Warmth goes in the words and the structure: the menu, the receipt, Thursday as payday. Competence goes in the figures,
  the calls and the checks, which are never playful. People judge brands on warmth and competence, and competence
  decides what they pay for ([Aaker](https://www.gsb.stanford.edu/news/research/aaker_warm.html)).
- No puns where money moves: no brewing, roasting or fresh cups of yield, and nothing "on the house" that is not free.
- Independent, and says so: not Dromos's, not Hydrex's. Anonymous for now: the page names no operator, nobody behind
  Carbon Impact's keeper or admin key, and links to no repository of the café's.
- Say "Aero", not "Aerodrome", from 22 Oct 2026, and "Coinbase Wallet", its name again since 10 Sep 2026. Aerodrome's
  pools and its AERO keep their name where the swap names an exchange or a token.
- "Small balances", not "dust", in the page's words: plain, and no pun.

## What the page may claim

From 27 Sep 2026, EU law treats pictures, symbols, colours and names as environmental claims. It bans sustainability
labels of one's own making, generic claims such as "green", and claims of a neutral or positive impact based on offsets
([Directive 2024/825](https://eur-lex.europa.eu/eli/dir/2024/825/oj/eng)). The Commission's guidance names images such
as trees or water, and green or blue backgrounds
([Commission](https://commission.europa.eu/document/download/3c257883-bb2a-4dd9-a6dc-501d587bb34f_en)); the UK's CMA and
the Dutch ACM say the same.

- No leaf, tree, globe, drop or Earth. No green or blue wash near the word "carbon". No badge, stamp or seal of the
  café's own that could pass for a label.
- A claim is specific, and next to its proof: "Retired 75 kVCM, ≈ 19 t of carbon credits, in the name "Hydrex"", with
  the transaction.
- Say "retired" and "your share of what was retired". Never "carbon neutral", "offset" or "your footprint".
- "Carbon Impact" is a product name the law covers, so the page says what it does in the same place.
- Home's heading says what happens, which anyone can check: "Vote, claim and swap on Base".

## Trust

Polish is not proof. Drainers copy brands on thousands of domains, and address poisoning matches the first and last
characters that wallets show ([USENIX 2025](https://www.usenix.org/conference/usenixsecurity25/presentation/tsuchiya)).
The brand helps people recognise the page; the page teaches them to check the address, the calls and the build.

- **Addresses and hashes in full,** checksummed, in groups of four, wherever someone checks:
  `0xdE91 885c F35a c57D F0c4 A75c 1686 2127 dBe8 317c`. A copy gives them without spaces. Only the wallet chip and
  links to a transaction use the short form, as they are there to recognise or to follow, not to check.
- **In a call, an address as the wallet will show it,** on three lines of four columns, as hardware wallets do, so that
  the two compare line by line:

  ```
    0x dE91 885c F35a
  c57D F0c4 A75c 1686
  2127 dBe8 317c
  ```

- **Token symbols in the mono face,** as untrusted text: a symbol is whatever its contract says. The address goes beside
  it, and a symbol that copies a listed token's, at another address, says so. No symbol becomes a link.
- **Calls in Safe's order** of fields, as Safe asks signers to check them
  ([Safe](https://help.safe.global/articles/2485383995-how-to-perform-basic-transactions-checks-on-safewallet)).

## Type

| Face                       | Weights  | Used for                                                       |
| -------------------------- | -------- | -------------------------------------------------------------- |
| Young Serif                | 400      | The name, `h1` and `h2`, and popups' titles. One weight.       |
| Atkinson Hyperlegible Next | 400, 700 | Text. 600 takes 700.                                           |
| Atkinson Hyperlegible Mono | 400, 600 | `code`, labels, slips and receipts: addresses, calls, figures. |

- **Why these:** a slashed zero, and 1, l and I that differ, which matter for figures and hex; tabular figures; about 62
  KB for all five files; and no neighbour on Base uses them. Atkinson Hyperlegible Next draws a slashed zero in text
  too.
- **Tabular figures** in tables and key figures, so that amounts line up.
- **Labels** of figures, fields and steps are small capitals in the mono face: 13 px, weight 600, 0.08em of tracking.
  They are quiet above what they name, and in ink beside it on a slip or a receipt.
- **The fonts are inside the stylesheet,** as `data:` URLs, so the stylesheet's hash in `index.html` covers them, and
  the Content Security Policy allows fonts from `data:` only. Text never changes face once drawn.
- **`scripts/fonts.py`** makes the subsets from Google Fonts' sources at a pinned commit, because the files Google Fonts
  serves drop features such as the slashed zero. All three faces are under the SIL Open Font License 1.1, in
  `LICENSES/`, and none reserves its name.

## Colour

Roast, with milk in dark. Each colour is a custom property in `style.css`: the light value first, then light and dark
inside `@supports (color: light-dark(red, red))`. Where `light-dark()` is not supported, as on older iOS, a property
holding it would be invalid wherever it is used, and links and buttons would lose their colour.

| Role                   | Light     | Dark      |
| ---------------------- | --------- | --------- |
| Paper, the background  | `#fdfcf9` | `#18120f` |
| Card: boxes, folds     | `#ffffff` | `#211915` |
| Ink, text              | `#251a15` | `#f1eee9` |
| Accent: links, buttons | `#6b3818` | `#e7d4bf` |
| Quiet text, edges      | `#645850` | `#b7b0a7` |
| Lines                  | `#d9d3cc` | `#413933` |
| Tint: ticked, calldata | `#f9eee4` | `#2e2118` |
| Notice background      | `#fbe6e3` | `#3a1b18` |
| Info: joining          | `#234e82` | `#85b6e9` |
| Warn: stopped, partly  | `#944e00` | `#efb062` |
| Danger: failed checks  | `#ab331f` | `#ef816b` |

- **WCAG 2.2 AA at least:** 4.5:1 for text, 3:1 for large text and controls. The status colours are 5.5:1 or more.
- **Status in blue and orange,** which stay apart for colour-blind vision, where green and red do not. Each status also
  has its shape and words.
- **The dark accent is milk,** far enough from the warning amber that a button never looks like a warning.
- **Stay out of the neighbours' colours:** saturated blue (Base, Coinbase, Hydrex, Aero), bright green (Klima, Safe),
  red-orange and yellow (Aero, Base), cream (Aero, Aerodrome) and teal (PancakeSwap, Hydrex). Klima's green stays
  Klima's: beside "carbon", green reads as a claim.
- **Set the background, and follow the device.** `Canvas` differs between browsers, and wallets' browsers on Android may
  darken a page that sets no colours. Light reads better for most people, so it is the default without a preference
  ([NN/g](https://www.nngroup.com/articles/dark-mode/)).

### Status shapes

A shape before the words: filled for running; half filled for joining and leaving; hollow for not looked after; a
triangle for stopped or partly in; a square for checks that failed.

## The mark

Figures and the total: two figures and a total, right-aligned, as on a receipt or a posted price list. Three shapes on
an ink tile (`#251a15`), with the total in crema (`#e6b285`). It holds at 16 px, has no letters to blur, claims nothing,
and works in one colour.

- `icon.svg` is the mark. Safe{Wallet} shows it at 48 px, from `manifest.json`.
- `scripts/icons.ts` draws `favicon.ico`, at 16 and 32 px, and `apple-touch-icon.png`, at 180 px and opaque, from it.
- `index.html` links all three. MetaMask reads a page's icon from `link[rel="shortcut icon"]` only, so the `.ico` is
  linked that way.

## Navigation

- **The header is the same on every view, at every width:** the logo and the name, which lead Home, and one button:
  "Connect a wallet", or the wallet's chip once connected, which leads to the App. On the App itself, the chip reads as
  where you are.
- **The title of every page below the App leads back to it,** before the page's own name, in the heading's face and
  quieter: "Your wallet › Hydrex", "Your wallet › Hydrex › Carbon Impact". Wallets' browsers and Safe{Wallet}'s frame
  have no address bar. Home and About are the page's own, and have none.
- **A view repeats only its own main action,** as a button, such as "Open the app" on Home. It never offers a second way
  to a page the header already leads to.
- **Within a view, a link leads to a section and says what it holds,** such as "What it means" or "More on leaving",
  never "How it works" or "Learn more".

## Layout and controls

`style.css` holds one scale for each of these, as custom properties: gaps, radii and text sizes.

- **Headings by level, the same on every view:** `h1` in the serif, 32 px; `h2`, and the titles of popups and of the
  review, in the serif, 20 px; `h3`, a group's heading or a card's title, in the sans, 16 px, bold; a popup's own
  headings, such as Contracts or Checks, as labels. A count beside a heading is quiet, in the sans: "Needs you · 2".
- **Cards:** one edge, one radius and one padding for every card. A card that leads somewhere is a link as large as the
  card, its title in ink, with a chevron at its end, or an arrow when it leaves the page. What else it holds, such as an
  account's box to tick or a link in its status, stays apart from that link: never a link inside a control.
- **Links look like links:** underlined, in the accent. The breadcrumb is quieter, and underlined on hover. A link to
  Hydrex's app, where something is done rather than checked, opens apart and ends with "↗".
- **Buttons look like buttons:** filled for the main action of a group, outlined for the others, compact inside a line
  or a notice. In a row, the main action comes first, a move between automations next, and Leave last. A link that does
  a button's job, such as a need's "Change", is drawn as a button.
- **Empty and loading lines are quiet and small:** "Loading…", "No record yet.", "No tokens to sell.".

## Slips and receipts

Wherever someone checks figures or addresses (the calls in the review, receipts, statements, the brief for co-signers),
the page lays them out like a till receipt: its structure, not its texture, with no torn edges or paper grain. Showing
the work raises the value people see in it
([Buell and Norton](https://ideas.repec.org/a/inm/ormnsc/v57y2011i9p1564-1579.html)), and a receipt shows the weeks that
went badly too.

- **The header,** centred: the name in Young Serif, then what the slip is, the account and the dates.
- **One row per line:** the label on the left in small capitals, the value on the right, both in the mono face.
- **Rules:** a dashed rule between sections, and a double rule above the total. The total comes last and larger, then
  the time and the transaction.
- **The same lines in the same order** every week, so that a change shows.
- **Sizes:** 13 px for call slips, with a 96 px column for the labels on a phone as on a desktop, and 14 px for
  receipts.

**A call** is a bill of its own: the name, then what it is, "Call 1 of 2", and the page's own words, such as "Account
#9540 joins Carbon Impact.": an account is always named as one, never by its number alone. Then a row per field, in
full, with nothing to open: To, with the contract's name above it; Call; Conduit, with its name above it; Account;
Approve; Value. What a field holds always goes above its value, as a token's symbol goes above its address. A list of
addresses, such as a claim's reward contracts and tokens, takes as many columns as fit: two in the review on a desktop,
one on a phone.

**A swap** is a bill before the wallet asks: the name, "Quote · swap into cbBTC", with a token's symbol in its own case
among the capitals, and the gas under it, as it is paid apart, in ETH. Then a line per token, with what it fetches and
its route by tokens, then who runs its pools, each once, "ZORA → WETH → USDC via Aerodrome, Uniswap", without addresses
or fee tiers: the calls name each pool in full. Then what they fetch, the 1%, "Reaches you", and "At least", with the
slippage that set it.

**In a Safe,** it opens with "In a Safe · one transaction to sign", or "In a Safe · call 1 of 2", and adds the fields
Safe{Wallet} shows: Data and, for a single call, Operation. Data is the selector, then each 32-byte word on two lines of
16 bytes, under the decoded call, so that co-signers can compare like with like. Safe{Wallet} sets the nonce, and sends
several calls through its MultiSend contract with operation 1: the page says so rather than show fields it cannot know.

**A receipt** is one account's line in a payout run. Its header gives the epoch the payout was for. Then: earned, in
dollars, with the tokens under it; swapped into kVCM; retired, with its share, the tonnes and Klima's mark; the fee,
with its share; then "Paid to you", as large as its figure, with dollars under it, and the payout address only when it
is not the owner's own; last, the time in UTC and the transaction. Dollars use the prices of the flip before the payout,
and follow the tokens once read. The shares are of all the payout's kVCM: Carbon Impact retires up to its `retireBps`,
as buying the credits may cost less. #82774's payout of 23 Sept retired 31.01%.

## Klima's mark

Klima Protocol agrees to the café using its logo where it makes sense. Placed beside a specific retirement, it says who
retires the credits, and nothing more. The Commission says a trade mark is generally unlikely to count as a
sustainability label, unless it is a certification mark.

- **Beside a retirement only:** beside "Retired so far" on Carbon Impact's page, and on each receipt's retirement line,
  as "through Klima Protocol", at 24 px. Never alone as a badge, in Home's heading, or next to "impact" without a
  figure.
- **Unaltered:** Klima's own icon, the green mark on its black disc, which works in both themes. Its guidelines keep a
  third of its size clear around it: 8 px at 24 px.
- **In the repository:** `klima-protocol.svg` is Klima Protocol's, all rights reserved, under
  `LICENSES/LicenseRef-KlimaProtocol.txt`, with an entry of its own in `REUSE.toml`.

## To decide

- A trademark check on "metaDEX Café" against Dromos's "MetaDEX™".
- A test with people: five seconds on Home for each persona, then what is this, who is it for, and would you trust it
  with your account. Rate warmth and competence.
