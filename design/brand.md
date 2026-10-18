# Brand: what fits metaDEX Café

Research for the brand of metaDEX Café, before anything changes on the page: what the name carries, the neighbours on
Base, what the five personas need from a brand, the rules on environmental claims, and type and colour within the page's
own rules. Three directions follow, drawn on the design canvas, row 7:
<https://claude.ai/artifact/XWN6n3DdJEcgaWbD1GDsA5>. Direction A, "The Course", is chosen, and the page now uses its
three faces. Sites and figures were checked on 17 Oct 2026.

## In short

1. **The name has a better story than coffee.** Exchanges began in coffeehouses. In 1698 John Castaing posted the prices
   of stocks at Jonathan's Coffee-House in Exchange Alley, a list that became the London Stock Exchange's Daily Official
   List; Lloyd's began in Edward Lloyd's coffee house, for which Lloyd gathered shipping news. A café where votes are
   cast and the figures posted every week is in that line: the warmth of a café, the record of an exchange.
2. **Warmth must not cost competence.** People judge brands on warmth and on competence, and competence decides what
   they pay for. The café carries the voice and the structure, a menu and a receipt; never the figures, the calls or the
   checks.
3. **The identity claims nothing about the environment.** Since 27 Sep 2026, EU law counts pictures, symbols, colours
   and names as environmental claims, bans sustainability labels of one's own making, and bans claims of neutrality
   based on offsets. No leaf, globe, drop, eco green or seal: the receipt makes the claim, in tonnes, with the
   transaction.
4. **Stay out of the neighbours' colours.** Saturated blue belongs to Base, Coinbase, Hydrex and Aero; neon green to
   Klima and Safe; red-orange and yellows to Aero and Base; cream backgrounds to Aero and Aerodrome. Today's teal sits
   beside PancakeSwap's and Hydrex's. Still open: roasted browns, slate, violet, and dark grounds that are not pure
   black.
5. **Not a food coin.** SUSHI, YAM, HOTDOG and PIZZA left food names with a scam's reputation in 2020; PancakeSwap and
   Beefy show that a lasting product with plain figures outlives it. No mascot, no token, no APY, no puns where money
   moves.
6. **Polish is not proof.** Drainers copy brands on thousands of domains. The brand helps people recognise the page; the
   page teaches them to check the address, the calls and the build, and shows addresses in full, in a monospace, grouped
   in fours.
7. **Type that reads figures and hex.** A slashed zero, distinct 1, l and I, tabular figures, small files. Atkinson
   Hyperlegible Next and Mono do all of it by default, in about 34 KB, and no DeFi site checked uses them.
8. **Fonts change the page's rules.** The page carries its fonts inside its stylesheet, so its hash covers them: the CSP
   allows fonts as `data:` only, and `LICENSES/` holds OFL-1.1. Google Fonts' files drop the features that matter here,
   so `scripts/fonts.py` subsets the sources.
9. **Both themes, set explicitly.** Wallet browsers on Android follow the wallet's theme and may darken a page that
   declares none; `Canvas` differs between browsers; and where `light-dark()` is unsupported, today's links lose their
   colour.
10. **Chosen:** direction A, "The Course", with C's layout for receipts and wallet calls: [A, as chosen](#a-as-chosen).
    Its faces are on the page; its colours are not yet.

## The name

### Café

- **Coffeehouses were where finance began.** Dealers expelled from the Royal Exchange met at Jonathan's, where in 1698
  John Castaing posted "The Course of the Exchange and Other Things", a list of stock and commodity prices issued twice
  a week; it became the Stock Exchange's Daily Official List
  ([Wikipedia](https://en.wikipedia.org/wiki/Jonathan%27s_Coffee-House),
  [Huguenots of Spitalfields](https://huguenotsofspitalfields.org/famoushuguenots/castaing-john)). Edward Lloyd's coffee
  house, open by 1688, became the market for marine insurance, where Lloyd provided shipping news; Lloyd's List followed
  in 1734 ([Wikipedia](https://en.wikipedia.org/wiki/Lloyd%27s_Coffee_House),
  [Lloyd's List](https://en.wikipedia.org/wiki/Lloyd%27s_List)). The café is where people met to trade and the prices
  were posted for all to read: what the page does for votes, each week.
- **Banks have used cafés for warmth and contact.** Capital One runs about 50 cafés, inherited from ING Direct
  ([The Financial Brand](https://thefinancialbrand.com/61682/capital-one-bank-branch-cafe-design/)); Umpqua called its
  branches stores and was called "Starbucks with tellers"
  ([American Banker](https://www.americanbanker.com/news/lifetime-achievement-umpqua-holdings-ray-davis)). In both, the
  café is about service, not the product.
- **A café has a menu, a till and a receipt.** The UX directions already use them: the menu of automations, a receipt
  per position per epoch. They are structures people know, which is why they help.
- **In crypto, food has a past.** In 2020, YAM's market value fell from about $475M to $19.5M in hours after a bug
  ([The Block](https://www.theblock.co/post/74810/yam-token-market-cap-collapses-by-more-than-90-flaw)), HOTDOG fell
  99.9% within hours of launch
  ([Cointelegraph](https://cointelegraph.com/news/defi-meme-coin-hotdog-dumps-99-9-in-hours-after-launch)), and SUSHI's
  founder sold the developers' fund before returning it
  ([Decrypt](https://decrypt.co/41547/sushiswap-chef-nomi-gives-back-14-million-ethereum)). PancakeSwap, with a bunny
  and a food name since 2020, is still among the largest DEXes, and Beefy, with a cow, is "all business despite its cute
  cow logo" ([Fantom](https://blog.fantom.foundation/fantom-ecosystem-spotlight-beefy-finance/)). The name works if
  everything near money looks like a statement.
- **CafeSwap** (BREW), a farm on BSC and Polygon in 2021, is the nearest name
  ([DefiLlama](https://defillama.com/protocol/cafeswap)); no "metaDEX Café" was found.

### metaDEX

- **Dromos Labs, behind Velodrome, Aerodrome and Aero, calls its model "MetaDEX™"**, with versions MetaDEX01 to 03
  ([Dromos](https://dromos.xyz/), [Dromos blog](https://blog.dromos.xyz/introducing-metadex03)). Hydrex has been called
  an "Omni-Liquidity MetaDEX" ([IQ.wiki](https://iq.wiki/wiki/hydrex.md)), but its site no longer says so
  ([Hydrex](https://hydrex.fi/)). The word is older: Mastercoin had a "MetaDEx" in 2014
  ([Omni spec](https://github.com/OmniLayer/spec/blob/master/OmniSpecification-v0.6.adoc)).
- **Tokens with near names exist:** MetaDex (MDEX), a tracker with profit claims
  ([Coinbase](https://www.coinbase.com/price/metadex)), and MDEX, a DEX of 2021.
- **What it means:** "metaDEX" tells Hydrex and Aero voters the page is for them, and ties it to a mark another company
  uses. Lowercase "meta" keeps it a word in the name rather than Dromos's term; the page should say it is independent of
  Dromos and Hydrex, and a trademark check comes before money is spent on a mark.

## The neighbours

Read from brand kits, stylesheets and logo files.

| Brand               | Colours                                                                   | Type                                           | Source                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base                | Blue `#0000FF`; grays; yellow `#FFD12F`, red `#FC401F`, tan `#B8A581`     | Base Sans, Base Mono                           | [brand.base.org](https://brand.base.org/color)                                                                                                                          |
| Coinbase Wallet     | Blue `#0052FF`; was the Base app from July 2025 to 10 Sep 2026            | Coinbase Sans                                  | [The Block](https://theblock.co/news/defi/2026-09-10-coinbase-rebrands-base-app-back-to-coinbase-wallet-after-just-over-a-year-as-social-experiment-falls-short-414115) |
| Hydrex              | Blue `#0052FF` on white; peach, mint, violet accents; dark `#15181A`      | Satoshi, DM Sans                               | [hydrex.fi](https://hydrex.fi/)                                                                                                                                         |
| Aero, from 22 Oct   | Flight blue `#154AFA`, red `#FF1100`, midnight `#090E1F`, cloud `#EAEAEC` | Roobert, Roobert Mono, Bureau Serif            | [aero.xyz/brand](https://aero.xyz/brand/)                                                                                                                               |
| Aerodrome           | Blue `#0433FF`, red `#FF1100`, cream `#F5F3E6`, background `#EBE9E7`      | Inter, JetBrains Mono                          | [aerodrome.finance](https://aerodrome.finance/)                                                                                                                         |
| Klima Protocol      | Klima Green `#00CC33`, Void Black `#000000`; the site uses `#00994D`      | Inter; the site adds Instrument Serif, DM Sans | [Media kit](https://carbonmarkdmcc.notion.site/Klima-Protocol-Media-Kit-1b4ce692cbac80d1a1b8cdf0b4b585e2), [site](https://www.klimaprotocol.com/)                       |
| Safe{Wallet}        | Green `#12FF80` on `#121312`                                              | Citerne, DM Sans                               | [safe.global](https://safe.global/)                                                                                                                                     |
| PancakeSwap, Revert | Teal `#1FC7D4`; green `#08B44E`                                           | Kanit; —                                       | [Revert](https://revert.finance/brand)                                                                                                                                  |

- **The crowded bands:** saturated blue, `#0000FF` to `#154AFA`; bright greens; red-orange; saturated yellow; cream and
  warm grey backgrounds; teal. In payments, 63% of 144 brands have blue in their palette, and half of those that lead
  with it share a near-identical shade
  ([FXC Intelligence, July 2026](https://assets.fxcintel.com/newsletter/Why-does-blue-dominate-payments-industry-branding-fxc-intelligence-July-26.pdf)).
- **The crowded faces:** Inter, DM Sans, Satoshi, Roobert, Base Sans, Geist, JetBrains Mono, and Instrument Serif on
  Klima's site.
- **Klima, the parent:** its guidelines allow its logo green on black, dark or grey only, unaltered, with clear space.
  Klima agrees to the café using it where it makes sense: beside a retirement, as who retires, never as a badge
  ([Klima's mark](#klimas-mark)). Klima's green stays Klima's and does not become the café's.
- **Words:** Aero replaces Aerodrome and Velodrome on 22 Oct, so "Aero relays", not "Aerodrome". The Base app is
  Coinbase Wallet again since 10 Sep 2026, and the page and these documents now say so.

## What each persona needs from a brand

People judge a brand on its intentions, warmth, and on its ability, competence
([Kervyn, Fiske and Malone](https://pmc.ncbi.nlm.nih.gov/articles/PMC3882007)). Nonprofits read as warm but less
competent, and competence predicted buying; an endorsement from a credible source closed the gap
([Aaker, Vohs and Mogilner](https://www.gsb.stanford.edu/news/research/aaker_warm.html)). Side by side, more warmth can
read as less competence
([the compensation effect](https://research.dial.uclouvain.be/entities/publication/01dbfe33-c79f-4fbf-abfe-23d8f6334e6f)):
where people compare products, keep the warmth out.

| Persona                  | The brand must say                     | Shown by                                                                             | What breaks it                                          |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **The stranded holder**  | Safe, simple, and for $3 as for $3,000 | A phone first, large type, one clear action, both themes, nothing to connect to look | Hype, countdowns, mascots, token tickers: a scam's look |
| **The hands-off holder** | The same every week                    | The receipt as the signature: one layout each Thursday, fee lines that never move    | Decoration that changes; a promotional tone             |
| **The optimiser**        | Honest numbers                         | Dense tables, tabular figures, the benchmark beside each figure                      | Cute in a comparison; an APR as a headline              |
| **The treasury**         | Checkable                              | Full addresses in a monospace, calls in Safe's order, build hashes, named keys       | Polish offered as proof; warmth near the calls          |
| **The impact holder**    | Claims no more than it does            | Tonnes with the transaction; Klima's mark at its rules, next to the statement        | A leaf, a seal, "for the climate"                       |

### Polish is not proof

- **Looks decide credibility, and can be copied.** "Design look" came up in 46% of comments on websites' credibility,
  55% for finance
  ([Fogg and others](https://advocacy.consumerreports.org/research/how-do-people-evaluate-a-web-sites-credibility));
  Stanford's guidelines start with making information easy to verify
  ([Stanford](https://credibility.stanford.edu/guidelines/index.html)). Inferno Drainer copied more than 100 crypto
  brands on more than 16,000 domains ([Group-IB](https://www.group-ib.com/media-center/press-releases/inferno-drainer)),
  and drainers took $84M in 2025, some through compromised front ends
  ([Scam Sniffer](https://drops.scamsniffer.io/scam-sniffer-2025-crypto-phishing-losses-fall-83-to-84-million/)).
- **So the brand is consistent, and points away from itself:** the same domain everywhere, the contract addresses, the
  build to compare, and "read the wallet prompt", as the page says today.
- **Addresses in full.** Address poisoning has hit 17M victims for at least $83.8M; wallets show the first and last four
  characters, and attackers match up to 20
  ([USENIX Security 2025](https://www.usenix.org/conference/usenixsecurity25/presentation/tsuchiya)). SEAL asks signers
  to check the whole hash
  ([SEAL](https://frameworks.securityalliance.org/wallet-security/signing-and-verification/secure-multisig-safe-verification)).
  Wherever someone is asked to check, the page shows the checksummed address in full, in groups of four:
  `0xdE91 885c F35a c57D F0c4 A75c 1686 2127 dBe8 317c`.
- **Calls in Safe's order:** To, Value, Data, Operation, Nonce, as Safe's help asks signers to check
  ([Safe](https://help.safe.global/articles/2485383995-how-to-perform-basic-transactions-checks-on-safewallet)).

### The receipt is the brand's best device

- Showing the work raises the value people see in it, even when it takes longer
  ([Buell and Norton, 2011](https://ideas.repec.org/a/inm/ormnsc/v57y2011i9p1564-1579.html)); letting cooks and
  customers see each other raised the quality customers reported 22%
  ([Buell, Kim and Tsay, 2017](https://pubsonline.informs.org/doi/fpi/10.1287/mnsc.2015.2411)); showing costs raised
  sales 22%, through trust
  ([Mohan, Buell and John](https://www.library.hbs.edu/working-knowledge/deconstructing-the-price-tag)). Showing a
  growing backlog removed the gain
  ([Buell, Porter and Norton, 2021](https://pubsonline.informs.org/doi/fpi/10.1287/msom.2020.0877)): a receipt shows the
  weeks that went badly too.
- Stripe Climate already proves its contribution with a line on a receipt ([Stripe](https://stripe.com/climate)).
- From thermal receipts, borrow the structure, not the texture: a header with the ID and time, right-aligned amounts in
  tabular figures, rules between sections, the total last and larger
  ([Epson](https://www.epson.com.au/pos/products/Printers/DisplaySpecs.asp?id=tmt82ii)). No torn edges or paper grain.

## Environmental claims

- **The law.** Directive (EU) 2024/825 applies from 27 Sep 2026
  ([EUR-Lex](https://eur-lex.europa.eu/eli/dir/2024/825/oj/eng)). An environmental claim is any message "in any form,
  including text, pictorial, graphic or symbolic representation, such as labels, brand names, company names or product
  names". It bans sustainability labels not based on a certification scheme or set up by a public authority, generic
  claims such as "eco-friendly", "green" or "climate friendly" without recognised excellent performance, and claims of a
  neutral, reduced or positive impact based on offsetting. It allows a company to speak of its investments in carbon
  credit projects, if not misleading.
- **The Commission's Q&A** (September 2026, not binding) says implicit claims can include "images (e.g. trees,
  rainforests, water, animals) and colours (e.g. blue or green backgrounds or text)", and that "a green leaf or water
  drop, when combined with logos or positioned next to statements about sustainability" may be taken for a trust mark
  ([Commission](https://commission.europa.eu/document/download/3c257883-bb2a-4dd9-a6dc-501d587bb34f_en)).
- **The UK and the Netherlands say the same.** The CMA's code covers "the colours, pictures and logos used" and business
  names, with a green leaf among its examples
  ([CMA](https://www.gov.uk/government/publications/green-claims-code-making-environmental-claims/environmental-claims-on-goods-and-services));
  the ACM says green, a tree or a leaf can give the impression of environmental benefit
  ([ACM](https://www.acm.nl/system/files/documents/guidelines-sustainability-claims.pdf)). The ASA found against Lloyds
  Bank for an image of Earth with "Prosper" in green
  ([ASA](https://www.asa.org.uk/rulings/lloyds-bank-plc-a24-1244509-lloyds-bank-plc.html)).
- **Climate companies have moved off green.** Watershed leads with cobalt and cream, with a mono face for metadata
  ([Watershed](https://watershed.com/brand)); Climeworks with blue and yellow, green secondary; Isometric and Frontier
  with near-black and soft warm colours. "Green has become the new beige"
  ([Antenna Group](https://www.antennagroup.com/signals/green-is-the-new-beige)).

What follows for the café:

- No leaf, tree, globe, drop or Earth; no green or blue wash near the word "carbon"; no badge, stamp or seal of the
  café's own that could pass for a label.
- The claim is specific and next to its proof: "Retired 75 kVCM, ≈ 19 t of carbon credits, in the name "Hydrex"", with
  the transaction. "Your share of what was retired", never "your footprint", "neutral" or "offset".
- **The home heading** was "Your Hydrex votes, working for the climate", a claim of climate benefit in general. It is
  now "Your Hydrex votes, retiring carbon credits and paying you": what happens, which anyone can check on Basescan,
  with the share retired in the lead below it. "Carbon Impact" is a product name the rules cover: say what it does in
  the same place, as the page does.

## Type

### What the text needs

Figures in money, tokens, tonnes and percent; hex addresses, hashes and calldata; long plain prose; a phone in a
wallet's browser.

- **Glyphs:** a slashed or dotted zero, and 1, l and I that differ; in hex, 0, 6, 8, b and B.
- **Tabular figures,** so columns of amounts line up, and lining figures in tables.
- **Small files:** about 60 KB in all, two files on the first paint at most
  ([web.dev](https://web.dev/learn/performance/optimize-web-fonts)).

### Within the page's rules

What the page does now, with A's three faces:

- **Hashes:** `@font-face` cannot carry `integrity`, so a font file would be the only one the page loads without a hash
  in `index.html`. Instead, the build puts each font inside `style.css` as a `data:` URL, with esbuild's `dataurl`
  loader: the stylesheet's hash covers them, as it covers the rest. The cost is weight before the first paint: the
  stylesheet grows from 2 KB to 54 KB compressed. In exchange, text never changes face once drawn.
- **CSP:** `font-src data:`, so that fonts can come from the stylesheet only; a test checks it, and that each font the
  stylesheet names is in `fonts/`.
- **Features:** the files Google Fonts and Fontsource serve have no `zero`, `ss` or `cv` features, and some lack `tnum`
  ([Marussy](https://marussy.com/variable-css-font-features)). `scripts/fonts.py` makes the subsets from Google Fonts'
  sources at a pinned commit, checks their hashes, keeps `tnum`, `zero`, `case`, `frac` and the other figure features,
  and gives the same files on every run.
- **Licences:** all three are under OFL-1.1, in `LICENSES/`, with an entry each in `REUSE.toml`. None reserves a name,
  so the subsets keep theirs; each keeps its copyright and licence in its own metadata. IBM Plex and Source, had they
  been chosen, reserve theirs: a subset is a modified version, which may not carry the name
  ([SIL](https://openfontlicense.org/webfonts-and-reserved-font-names/)).

### Candidates

Sizes are Latin subsets made from the sources, keeping the features above; "Google" is the file Google Fonts serves.

| Face                                              | Licence               | Figures and glyphs                                     | KB, own subset                | Character                                   | In DeFi                        |
| ------------------------------------------------- | --------------------- | ------------------------------------------------------ | ----------------------------- | ------------------------------------------- | ------------------------------ |
| **Atkinson Hyperlegible Next**, Braille Institute | OFL, no reserved name | `tnum`; slashed zero by default; 1, l, I clearly apart | 12 a weight; 33 variable      | Made for legibility; friendly, plain        | None found                     |
| **Atkinson Hyperlegible Mono**                    | OFL, no reserved name | Monospaced; slashed zero                               | 10; 17 variable               | Receipt, calldata                           | None found                     |
| **Young Serif**, Bastien Sozeau                   | OFL                   | `tnum` and `lnum`; old-style figures by default        | 18, one weight                | A menu or a price list; headings only       | None found                     |
| **Recursive**, Arrow Type                         | OFL                   | Tabular by default; Mono with a slashed zero           | 23–28 a style; 45–86 variable | Casual axis from single-stroke signpainting | None found                     |
| **Martian Mono**, Evil Martians                   | OFL                   | Monospaced; slashed zero                               | 9.5; 22 variable              | Receipt, terminal; widths 75–112.5          | None found                     |
| IBM Plex Sans and Mono                            | OFL, reserves "Plex"  | `tnum`; `zero` slashes                                 | 16; 9.5                       | Corporate, statements                       | None found                     |
| Bricolage Grotesque                               | OFL                   | `tnum`; l and I alike                                  | 21.5; 74 variable             | Enamel signs, posters                       | None found                     |
| Fraunces                                          | OFL                   | No `tnum`                                              | 18.5; 67 variable             | Café menus; common for food brands          | None found                     |
| Instrument Serif; DM Sans; JetBrains Mono; Inter  | OFL                   | —                                                      | —                             | —                                           | Klima, Hydrex, Safe, Aerodrome |
| System stack                                      | —                     | Varies; Roboto has no `zero`                           | 0                             | Native, neutral                             | Basescan                       |

Sources: [Recursive](https://www.recursive.design/),
[Atkinson Hyperlegible Next](https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next),
[Atkinson Hyperlegible Mono](https://fonts.google.com/specimen/Atkinson+Hyperlegible+Mono),
[Young Serif](https://fonts.google.com/specimen/Young+Serif),
[Martian Mono](https://fonts.google.com/specimen/Martian+Mono).

## Colour

- **WCAG 2.2 AA is the bar:** 4.5:1 for text, 3:1 for large text and for controls. APCA left the WCAG 3 draft in 2023,
  and WCAG 3's contrast method is not settled
  ([Roselli, April 2026](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)).
- **Coffee alone is too light.** Crema, `#c8894a`, is 2.94:1 on white: for fills and marks, never text. Text-safe on
  white, it darkens to `#a06b31` or below.
- **Status in blue against orange.** Simulated for colour-blind vision, amber against tomato is hard for everyone, and
  green against red for deutans and protans; blue against orange holds for all. The status pattern's shapes and words
  stay, as the [README](README.md#status) says.
- **Build in OKLCH, write hex first.** `oklch()` works from Safari 15.4, `light-dark()` from Safari 17.5; about 1% of
  traffic is on older iOS, and wallets on iOS use its WebKit. Where `light-dark()` fails, a custom property holding it
  makes every `var()` that uses it invalid: links lose their colour and buttons their fill, as today. Plain hex first,
  then `light-dark()` in `@supports`.
- **Set the background.** `Canvas` differs between browsers in dark mode, and Android's WebView follows the wallet's
  theme and may darken a page without `color-scheme`
  ([Android](https://developer.android.com/develop/ui/views/layout/webapps/dark-theme)).
- **Light by default for reading.** Dark mode reads worse for people with normal vision; offer both, follow the device
  ([NN/g](https://www.nngroup.com/articles/dark-mode/)).

Every direction below shares the status colours, each at least 5.5:1 on its background:

| Role   | Light     | Dark      | Use                                          |
| ------ | --------- | --------- | -------------------------------------------- |
| Info   | `#234e82` | `#85b6e9` | Joining, leaving, "at the flip"              |
| Warn   | `#944e00` | `#efb062` | Stopped, late, checks failed, with its shape |
| Danger | `#ab331f` | `#ef816b` | A failed transaction, a refusal              |

## The mark

- **Readable at 16 px:** three shapes at most, no text but a letter, one colour, on its own tile so the wallet's theme
  does not matter.
- **Files:** `icon.svg`, which Safe{Wallet} shows at 48 px from `manifest.json`; a 32 px `favicon.ico`; a 180 px
  `apple-touch-icon.png`. MetaMask reads a dapp's icon from `link[rel="shortcut icon"]` only
  ([MetaMask](https://docs.metamask.io/metamask-connect/evm/guides/best-practices/display.md)).
- **The old mark,** two arrows on teal, said "swap": what any DEX says, and not what the page does. The new one is under
  [A, as chosen](#the-mark-chosen).

## Voice

Today's rules hold: plain words, each figure read from Base, no pressure. The café adds:

- **Words that carry structure:** the menu, for the automations; a receipt, for each position each epoch; Thursday, for
  payday.
- **No puns where money moves:** no brewing, roasting or fresh cups of yield; nothing "on the house" that is not free.
- **Independent, and says so:** not Dromos's, not Hydrex's; Carbon Impact's operator and keys by name.

## Three directions

Each is drawn on the canvas, row 7, with its palette, type, mark, and the same receipt and home in it. Figures are
Carbon Impact's last epoch for a sample account, as on the canvas's receipt. All three keep the rules above.

|                | **A. The Course**                                                                                             | **B. Ardoise**                                                                                   | **C. Ticket**                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **The idea**   | The price list posted at Jonathan's, 1698: the café where an exchange's figures are posted each week          | The café's slate menu board, lettered by hand                                                    | The till receipt: every week's proof, line by line                                             |
| **Leads with** | Competence, then warmth                                                                                       | Warmth, then competence                                                                          | Proof                                                                                          |
| **Ground**     | White paper `#fdfcf9`; dark `#18120f`                                                                         | Slate `#191d23`, dark first; light `#f6f5f1`                                                     | Thermal white `#fefdfc`; carbon `#0f0f0f`                                                      |
| **Text**       | Ink `#251a15`, 16.5:1                                                                                         | Chalk `#f0eee9`, 14.6:1                                                                          | `#121212`, 18.4:1                                                                              |
| **Accent**     | Roast `#6b3818`, 9.3:1; dark `#e6b285`                                                                        | Crema chalk `#f3b680`, 9.5:1; light `#a14f09`, 5.3:1                                             | Stamp violet `#5f38a7`, 7.9:1; dark `#bca9f7`                                                  |
| **Type**       | Young Serif for headings, Atkinson Hyperlegible Next for text, Atkinson Hyperlegible Mono for figures and hex | Recursive: Casual for headings, Linear for text, Mono for figures and hex                        | System sans for text; Martian Mono for headings, figures and hex                               |
| **Fonts**      | About 52 KB, three files                                                                                      | About 55–86 KB, one family                                                                       | About 10–22 KB, one file                                                                       |
| **Mark**       | "é" in Young Serif on ink                                                                                     | A cup from above, chalk on slate                                                                 | A receipt with its total line                                                                  |
| **Best for**   | The treasury, the impact holder, the optimiser                                                                | The stranded holder, the hands-off holder                                                        | The optimiser, the treasury                                                                    |
| **Risk**       | Serif on warm paper is a common editorial look; Klima's site has a serif too                                  | Casual lettering near money reads less competent; chalk tips into kitsch; dark first reads worse | Cold for a $3 holder; reads as a developer's tool; violet sits near PancakeSwap's and Hydrex's |

**Chosen: A, with C's layout for receipts and calls.** It tells the name's best story, puts competence first for those
who pay most, and its faces are the most legible, the lightest after C's, and used by no neighbour. Its receipts and
calls take C's structure in Atkinson Hyperlegible Mono: monospace amounts, rules, the total last. B's warmth is better
carried in words than in lettering.

## A, as chosen

On the canvas, row 7: the receipt in both themes, a call as the wallet will ask it, and the same call in a Safe.

### On the page now

- **Young Serif** for the name and the `h1` and `h2` headings, at its one weight; **Atkinson Hyperlegible Next** for
  text, at 400 and 700, where 600 takes 700; **Atkinson Hyperlegible Mono**, at 400 and 600, for `code`, labels, slips
  and receipts: addresses, hashes, calls and their figures. Tables and key figures use tabular figures.
- Atkinson Hyperlegible Next draws a slashed zero in text too, as in "Thu 10 Sep": it is the face's legibility, not an
  option.
- The colours are Roast's, with milk in dark, and the mark is the figures and the total: see below.
- **Home** is row 7's: the heading, one paragraph, Open the app and How it works, then the states of Carbon Impact and
  of Hydrex's other automations, each with its shape and when it last voted. On a phone, the header keeps Open the app
  beside the name; How it works is under the heading.
- **The review** shows each call as a slip, and **the last payout** as a receipt for each of the owner's accounts in it,
  in the layout below, at the canvas's sizes: slips at 13 px and receipts at 14 px, in the mono face, the labels' column
  84 px wide on a phone as on a desktop.
- **Addresses and hashes** are in full, in groups of four, wherever the page writes them. Only the header's wallet chip
  and the links to a transaction keep the short form: they are there to recognise a wallet or to follow a link, not to
  check.
- **Statuses** have their shape before their words: filled for running, half filled for joining and leaving, hollow for
  not looked after, a triangle for stopped or partly in, a square for checks that failed.
- **Labels** of figures, fields and steps are small capitals in the mono face, at 13 px and 600 with 0.08em of tracking:
  quiet above what they name, in ink beside it, on a slip or a receipt. The earnings tables' figures are mono.

### Receipts and calls

C's layout, in A's faces and colours, wherever someone checks figures or addresses: receipts, statements, the review's
"What your wallet will ask", and the brief for co-signers. Everything else is plain A.

- **The header,** centred: the name in Young Serif, then what the slip is, the account and the dates.
- **One row per line,** the label on the left in small capitals, the value on the right; both in Atkinson Hyperlegible
  Mono, so that figures line up. No dot leaders.
- **Rules:** a dashed rule between sections, a double rule above the total. The total last and larger, then the time and
  the transaction.
- **The same lines in the same order** every week, so that a change shows.
- **A call** opens with what it is, "Your wallet will ask · 1 of 2", and the page's own words, "#9540 joins Carbon
  Impact.", then one row per field: To, with the name of the contract under it; Call; Conduit, with its name; Account;
  Approve; Value. Each address in full, checksummed, in groups of four; copying it gives it without spaces. Its foot:
  "How to check these calls", and "On Base".
- **In a Safe,** "In a Safe · one transaction to sign", or "In a Safe · call 1 of 2", then the same rows, then the ones
  Safe{Wallet} adds: Data and, for one call, Operation, "0 · call". Data is the selector, then each 32-byte word on two
  lines of 16 bytes, the same on a phone as on a desktop, across the slip under the call decoded above it with the
  conduit's address in full, so that co-signers can compare like with like; the foot says how to read the words, "the
  conduit, 9540 as 2544, and true as 1". Safe{Wallet} sets the nonce, and sends several calls through its MultiSend
  contract, with operation 1: the page says so rather than show fields it cannot know.
- **A receipt** is the account's line in the conduit's run. Its header gives the epoch whose rewards it paid, "Thu 8 Oct
  to Thu 15 Oct", the one that ended at the flip before the payout. Then earned, in dollars, with the tokens under it;
  swapped into kVCM; retired, with its share, the tonnes, the name they were retired in at that payout, and Klima's
  mark; the fee, with its share; then "Paid to you", as large as its figure, the dollars under it, and the payout
  address only when it is not the owner's own; last, the time in UTC and the transaction. Dollars, at the prices of the
  flip before the payout, follow the tokens once read.
- **The shares** are of all the payout's kVCM. The automation retires up to its `retireBps` of it, as the purchase may
  cost less: #82774's payout of 23 Sept retired 31.01%, under 33.33%.

### Klima's mark

Klima agrees to the café using its logo where it makes sense. A trade mark is "generally unlikely" to be taken for a
sustainability label, the Commission says, unless it is a certification mark
([Commission](https://commission.europa.eu/document/download/3c257883-bb2a-4dd9-a6dc-501d587bb34f_en), Q3); placed
beside a specific retirement, Klima's mark says who retires, and nothing more.

- **On the page now:** under "Retired so far" on Home, and on each receipt's retirement line, "through Klima Protocol",
  with the icon at 24 px.
- **On the canvas:** on the receipt's retirement line, in both themes.
- **Beside a retirement only,** and where an automation's page says who retires its credits. Never on its own as a
  badge, on Home's heading, or next to "impact" without a figure.
- **Klima's own icon,** from its brand guidelines, unaltered: the green mark on its black disc, which reads on both
  themes. Its guidelines keep the height of the mark's "X" clear around it, about a third of its size: 8 px at 24 px.
- **In the repository,** `klima-protocol.svg` is Klima Protocol's, all rights reserved, under
  `LICENSES/LicenseRef-KlimaProtocol.txt` and an entry of its own in `REUSE.toml`.

### The mark, chosen

**Figures and the total**, from the alternatives on the canvas, row 8: two figures and a total, right-aligned, as on the
receipt and on the posted list. Three shapes on the ink tile, the total in crema; it holds at 16 px, has no letters to
blur, claims nothing, and reads in one colour.

- `icon.svg` is the mark; `scripts/icons.ts` draws `favicon.ico`, at 16 and 32 px, and `apple-touch-icon.png`, at 180 px
  and opaque, from it, with Chromium, and gives the same files on every run.
- `index.html` links all three, the `.ico` as `shortcut icon` for MetaMask; `manifest.json` still names `icon.svg` for
  Safe{Wallet}.

### Colour

**Roast, with milk in dark,** is on the page: ink `#251a15` and roast `#6b3818` on paper `#fdfcf9`; in dark, ink
`#f1eee9` and milk `#e7d4bf` on `#18120f`. Each colour is a custom property with its light value first; the light and
dark pairs follow inside `@supports (color: light-dark(red, red))`, so that a browser without `light-dark()` keeps the
light palette whole, links and buttons included, rather than losing them. A test checks that `light-dark()` appears
nowhere else, and that nothing still uses the system's `Canvas`.

Five palettes were drawn, on the canvas, row 9, each on the same piece of Home in both themes: roast, ink only, claret,
ink blue, and today's teal. Each keeps the same status colours, with their shapes and words; green is left out, as
beside "carbon" it reads as a claim.

- **Roast needs milk in dark.** The crema drawn on A's board, `#e6b285`, is nearly the warning amber, `#efb062`: a
  distance of 3.8 in OKLab, where under about 10 a button and a warning look alike. Milk, `#e7d4bf`, is 11.6 from it, at
  12.9:1 on the dark paper.
- **Ink blue takes the joining blue's place,** 5.3 from it in light and 3.6 in dark: joining and leaving would need
  another colour.
- **Ink only** is the furthest from every status colour, so that a stopped automation stands out most; it is also the
  plainest.

## To decide

- **A trademark check** on "metaDEX Café" against Dromos's "MetaDEX™".
- **A test with people,** five seconds on Home for each persona: what is this, who is it for, would you trust it with
  your account. Rate warmth and competence, as the studies above did.
