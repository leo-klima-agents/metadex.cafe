# Plan

The milestones of the plan of 2026-10-15, and where each stands. Ask the user at the end of each milestone before going
on. [research.md](research.md) keeps the findings and the decisions taken since.

1. **Research:** the findings, the personas, a note on Aerodrome's and Velodrome's relays, and two visual directions.
   Done; the personas, the note and the directions are now in [earlier-design.md](earlier-design.md).
2. **Skeleton:**
   - **Set-up:** the repository, CI, REUSE, Prettier, tsconfig, the build with splitting, and the budget.
   - **README:** in hydrex-keeper's sections: what it does, what it can and cannot do, deployment, development, failure
     modes, limitations, licence.

   Done. The budget went with [decision 13](research.md#decisions). The build no longer splits: Coinbase's SDK is
   bundled on its own instead.

3. **Read-only page:** the registry, live relay numbers, this week's vote, and the read-only address view, all from
   public RPCs. Done; the registry became `src/config.ts`, and the address view went with
   [decision 23](research.md#decisions).
4. **Wallets:** `injected` and `coinbaseWallet`, account statuses, join, leave and payout, with simulation, batching and
   the startup checks. Then the fork and Coinbase tests. Built without wagmi ([decision 17](research.md#decisions)), and
   in review.
5. **Safe:** the Safe App manifest, the `safe` connector and a first deployment to GitHub Pages, tested in Playwright
   and then by the user with a real Safe. Built, and in review: the page runs as a Safe App and proposes; it was tested
   in Playwright against a stand-in for Safe{Wallet}, and against Safe{Wallet} itself, read-only. Left: the first
   deployment, and the user's test with a real Safe.
6. **Polish:** all states, copy, accessibility, the cold-read loop, mobile, and the in-wallet browsers. Done, and in
   review: the findings and the three rounds of cold reads are in [research.md](research.md#polish). Not done: tests in
   WebKit and in real wallet apps, which this environment does not have.
7. **Release:** the first deployment from a tag, and the verification steps written down. The steps are written down, in
   the README's [Deployment](../README.md#deployment), and the version is 0.3.0. Left for the user: the repository's
   settings, then the tag `v0.3.0`, which deploys, then the steps after the deployment, among them the test with a real
   Safe that milestone 5 left.
