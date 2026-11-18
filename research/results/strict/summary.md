# Aero allocation skill: results

Data: 2026-10-22 00:00 to 2026-11-18 22:00 UTC (27.9 days), 317 gauges, 53553 allocations by 15974 stakes.
Prices: one snapshot, AERO at $0.4241. Gauges paying a token without a price hold 0.1% of today's power; that token counts as 0, for strategies and placebos alike.
Allocations to addresses that are not gauges (the zero address and 0x2e67…6902, which has no code): 8.3% of all power allocated. Weights are taken over real gauges only.
Average sAERO in a pool over the whole period: APR 21.4% at today's prices (fees 99.6% of pay, incentives the rest).

Strategies: 15974 stakes, grouped into 11101 strategies (stakes with exactly the same allocations, hour by hour, are one strategy). Only strategies of at least 100 sAERO are tested.

## Selection

Tested: 9620 strategies with at least 96 hours in pools.
- Significant at FDR 0.1 (Benjamini–Hochberg): 2025 better than chance.
- p < 0.05: 28.0% of strategies (5% expected with no skill anywhere).
- p-values as normal quantiles: mean 0.96, variance 1.85 (about 0 and 1 with no skill anywhere).
- Against a crowd of stakes (pools drawn by how many stakes are in them, not by their power): 699 significant at FDR 0.1; p < 0.05 for 17.4%.
- Calibration by size. With no skill, p-values are spread evenly: 5% below 0.05 and 10% above 0.9.

  | sAERO | Strategies | p < 0.05 (power) | p > 0.9 (power) | p < 0.05 (stakes) | p > 0.9 (stakes) |
  |---|---|---|---|---|---|
  | 100–1k | 1877 | 23.7% | 3.7% | 14.4% | 9.9% |
  | 1k–10k | 4202 | 25.5% | 2.7% | 14.8% | 8.6% |
  | 10k–100k | 2669 | 28.5% | 1.8% | 17.6% | 7.5% |
  | 100k–1M | 758 | 43.8% | 2.9% | 32.2% | 5.8% |
  | ≥ 1M | 114 | 72.8% | 4.4% | 62.3% | 3.5% |

- Persistence: Spearman ρ between first-half and second-half selection z, 6933 strategies: 0.339 (±0.024 is the 95% band for 0).

## Timing

Tested: 6687 strategies with 25604 moves that had at least two possible hours.
- Significant at FDR 0.1: 24.
- p < 0.05: 8.4% of strategies.
- Mean rank of the hour actually chosen, over all moves: 0.505 (0.5 with no timing skill; z = 2.41).
- Gain from timing, against moving at a random possible hour, in hours of the average sAERO's pay: median -0.0 per move; the best possible hour would have gained a median 15.0.

## Highest APRs (at least 7 days in pools)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2751 | 1,234 | vAMM-USDC/NOCK, CL100-RSGP/USDC | 10.2 | 1405.3% | 19.8% | 5.0e-5 | 0.001 | 1 | 0.65 | 0.3576 | 0.927 | thin
| 7093 | 4,565 | CL200-wtCOIN/USDC | 27.4 | 886.0% | 20.8% | 5.0e-5 | 0.001 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 285.0% | 17.3% | 5.0e-5 | 0.001 | 1 | 0.06 | 0.9381 | 1.000 | thin
| 5703 | 496 | CL200-AERO/WETH, CL100-EURC/cbBTC, CL10-USDC/PYPLc, CL200-AERO/wstETH | 27.5 | 152.3% | 20.9% | 0.0079 | 0.053 | 2 | 0.30 | 0.8122 | 1.000 | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 27.4 | 130.8% | 20.8% | 5.0e-5 | 0.001 | 8 | 0.75 | 0.0190 | 0.438 | thin
| 5468 | 260 | CL10-USDC/LMTS, CL50-USDC/cbBTC | 16.5 | 130.6% | 24.3% | 1.0e-4 | 0.002 | 0 |  |  |  | thin
| 1045 | 2,782 | CL10-USDC/SEc, sAMM-msUSD/USDC, CL100-RSGP/USDC | 8.4 | 69.6% | 20.3% | 5.0e-5 | 0.001 | 1 | 0.18 | 0.8402 | 1.000 | thin
| 3443 | 4,333 | CL100-WETH/B3, CL200-BIO/USDC, CL100-WETH/PENDLE, CL1-USDC/eUSD | 27.4 | 69.3% | 20.8% | 5.0e-5 | 0.001 | 7 | 0.43 | 0.6673 | 1.000 | thin
| 5310 | 438 | CL100-USDC/TAO, CL1-XSGD/USDC, CL100-cbXRP/cbBTC, CL100-WETH/B3 | 20.3 | 62.7% | 20.7% | 5.0e-5 | 0.001 | 6 | 0.42 | 0.7053 | 1.000 |
| 5187 | 645 | CL100-USDC/TAO, CL1-XSGD/USDC, CL100-cbXRP/cbBTC, CL200-RECALL/USDC | 25.6 | 56.5% | 21.5% | 5.0e-5 | 0.001 | 9 | 0.28 | 0.9930 | 1.000 |
| 6564 | 2,509 | CL50-WETH/VELVET, CL100-cbXRP/cbBTC, CL1-wtSGOV/USDC, CL200-cbBTC/EDGE | 27.4 | 54.7% | 20.8% | 0.0002 | 0.004 | 7 | 0.65 | 0.1658 | 0.798 | thin
| 4149 | 2,968 | CL200-TIG/USDC, CL100-RSGP/USDC | 8.4 | 52.6% | 20.3% | 0.0032 | 0.028 | 0 |  |  |  | thin
| 4484 | 1,206 | CL50-EURC/USDC, CL10-USDC/SPCXc | 10.0 | 52.6% | 19.0% | 0.0005 | 0.008 | 1 | 0.83 | 0.1808 | 0.819 | thin
| 6889, 6923 | 1,819 | CL200-O/USDC, sAMM-msUSD/USDC, vAMM-WETH/TLOS, CL100-RSGP/USDC | 12.3 | 52.4% | 18.1% | 0.0002 | 0.005 | 4 | 0.75 | 0.0789 | 0.649 | thin
| 6641 | 185 | CL1-WETH/wstETH, CL100-AERO/USDC, CL10-WETH/cbBTC | 27.5 | 47.5% | 20.9% | 0.0002 | 0.005 | 2 | 0.48 | 0.5604 | 0.983 | thin
| 5504 | 1,725 | CL100-USDC/TAO, CL50-WETH/USDC | 10.5 | 47.1% | 18.8% | 0.0028 | 0.026 | 1 | 0.86 | 0.2587 | 0.865 | thin
| 5829 | 1,578 | CL200-WETH/BRETT, CL200-WETH/KTA, CL200-tBTC/USDC, CL1-WETH/cbBTC | 27.5 | 46.4% | 20.9% | 0.0001 | 0.003 | 8 | 0.53 | 0.3916 | 0.930 | thin
| 6444 | 152 | CL10-SOL/cbBTC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/MRNAc | 27.5 | 45.1% | 20.9% | 1.0e-4 | 0.002 | 5 | 0.53 | 0.4076 | 0.935 |
| 3924 | 10,896 | CL200-WETH/Basecat, CL200-cbBTC/ZEN, CL200-PORTAL/USDC, CL50-MOCA/USDC | 13.4 | 44.3% | 24.3% | 0.0006 | 0.009 | 2 | 0.70 | 0.3377 | 0.917 |
| 7698 | 2,555 | CL10-WETH/METAc, CL50-BIO/WETH, CL10-USDC/AMZNc, CL100-WETH/cbXRP | 27.3 | 44.1% | 20.7% | 5.0e-5 | 0.001 | 9 | 0.38 | 0.8172 | 1.000 |
| 5100 | 228 | CL200-WETH/BRETT, CL1-WETH/cbBTC | 27.6 | 43.9% | 21.0% | 0.0002 | 0.005 | 1 | 0.63 | 0.3856 | 0.930 | thin
| 4123 | 242 | CL200-BNKR/WETH | 27.7 | 42.6% | 21.0% | 0.0002 | 0.004 | 0 |  |  |  | thin
| 3872 | 2,598 | CL50-msUSD/USDC, CL100-AERO/USDC, CL100-USDC/DIEM, CL100-USDC/cbHYPE | 10.2 | 42.3% | 18.6% | 5.0e-5 | 0.001 | 1 | 0.56 | 0.4555 | 0.957 |
| 1658 | 3,558 | sAMM-msUSD/USDC, CL100-USDC/DIEM, CL100-USDC/cbHYPE, CL200-O/USDC | 27.8 | 42.2% | 21.2% | 5.0e-5 | 0.001 | 6 | 0.42 | 0.7103 | 1.000 | thin
| 7251 | 1,052 | CL100-WETH/B3, CL200-WETH/VVV | 9.3 | 41.8% | 19.3% | 0.0005 | 0.008 | 0 |  |  |  | thin

## Largest strategies

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10495 | 143,276,232 | vAMM-AERO/USDC, CL200-AERO/WETH, CL200-AERO/USDC, CL10-USDC/MSFTc | 26.0 | 14.2% | 19.8% | 0.2018 | 0.400 | 4 | 0.63 | 0.1878 | 0.822 | thin
| 10426 | 106,692,444 | vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC | 26.0 | 18.3% | 19.8% | 0.0002 | 0.004 | 2 | 0.43 | 0.6803 | 1.000 | thin
| 10504 | 71,138,593 | vAMM-AERO/USDC, CL10-USDC/METAc, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 26.0 | 12.0% | 19.9% | 0.9660 | 0.978 | 3 | 0.40 | 0.7043 | 1.000 | thin
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.8% | 22.2% | 5.0e-5 | 0.001 | 7 | 0.80 | 0.0190 | 0.438 | thin
| 10522 | 36,000,001 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 26.0 | 21.2% | 19.9% | 0.0360 | 0.144 | 0 |  |  |  | thin
| 621 | 18,287,265 | vAMM-AERO/USDC, vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC | 27.9 | 20.0% | 21.4% | 5.0e-5 | 0.001 | 0 |  |  |  | thin
| 20365 | 13,345,773 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.9% | 22.2% | 5.0e-5 | 0.001 | 7 | 0.71 | 0.0849 | 0.665 |
| 1103 | 11,442,128 | vAMM-AERO/fBOMB, CL100-WETH/VVV, CL10-USDC/METAc, CL1-WETH/cbBTC | 27.8 | 24.8% | 21.1% | 5.0e-5 | 0.001 | 4 | 0.61 | 0.2468 | 0.853 | thin
| 19741 | 11,406,304 | CL50-WETH/USDC, CL1-WETH/cbBTC, CL200-WETH/DRV, CL10-cbETH/cbBTC | 7.9 | 31.3% | 24.9% | 5.0e-5 | 0.001 | 0 |  |  |  | thin
| 18791 | 9,232,536 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC, CL200-AERO/WETH | 21.3 | 23.1% | 21.2% | 1.0e-4 | 0.002 | 8 | 0.64 | 0.1459 | 0.772 |
| 8305 | 9,131,028 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL200-AERO/WETH, CL100-WETH/VVV | 27.3 | 21.5% | 20.7% | 0.0003 | 0.006 | 6 | 0.60 | 0.1978 | 0.826 | thin
| 16765 | 7,713,287 | CL50-USDC/cbBTC, CL200-AERO/cbBTC, CL10-USDC/AMZNc, CL200-WETH/AAVE | 25.0 | 25.1% | 20.2% | 0.0118 | 0.069 | 0 |  |  |  |
| 12469 | 5,766,071 | CL100-WETH/VVV | 26.5 | 20.7% | 20.2% | 0.4885 | 0.650 | 0 |  |  |  |
| 1359 | 5,471,711 | vAMM-AERO/USDC, CL100-USDC/cbBTC, CL50-USDC/cbBTC, CL200-AERO/USDC | 15.2 | 18.0% | 19.3% | 0.2268 | 0.427 | 0 |  |  |  |
| 17968, 17969, 17970 +1 | 5,390,075 | vAMM-AERO/USDC, CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 23.4 | 21.0% | 20.7% | 5.0e-5 | 0.001 | 0 |  |  |  |

## Strongest selection evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 11869, 12080, 12090 +1 | 2,852,897 | CL50-WETH/USDC | 26.5 | 23.2% | 20.2% | 5.0e-5 | 0.001 | 0 |  |  |  |
| 20157, 20158 | 1,920 | CL100-XSGD/WETH, CL10-USDC/TTWOc, CL100-TOWNS/WETH, vAMM-WETH/EDEL | 7.0 | 230218.5% | 25.3% | 5.0e-5 | 0.001 | 1 | 0.31 | 0.6663 | 1.000 | thin
| 3430 | 234 | CL50-WETH/RSC, vAMM-cbBTC/EDGE, sAMM-DOLA/USDC, CL50-VFY/ZEN | 27.8 | 917.7% | 21.1% | 5.0e-5 | 0.001 | 7 | 0.13 | 1.0000 | 1.000 | thin
| 2751 | 1,234 | vAMM-USDC/NOCK, CL100-RSGP/USDC | 10.2 | 1405.3% | 19.8% | 5.0e-5 | 0.001 | 1 | 0.65 | 0.3576 | 0.927 | thin
| 7093 | 4,565 | CL200-wtCOIN/USDC | 27.4 | 886.0% | 20.8% | 5.0e-5 | 0.001 | 0 |  |  |  | thin
| 11795 | 431 | CL100-ZORA/WETH | 8.4 | 695.6% | 17.9% | 5.0e-5 | 0.001 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 285.0% | 17.3% | 5.0e-5 | 0.001 | 1 | 0.06 | 0.9381 | 1.000 | thin
| 12494 | 446 | CL10-USDC/ORCLc, CL100-RSGP/USDC | 7.0 | 371.4% | 17.2% | 5.0e-5 | 0.001 | 1 | 0.97 | 0.0360 | 0.526 | thin
| 1469 | 1,297 | vAMM-WETH/FAI, CL50-WETH/FAI, vAMM-VIRTUAL/DEUS, CL10-USDC/MAG7 | 7.8 | 301.1% | 21.2% | 5.0e-5 | 0.001 | 1 | 0.97 | 0.0539 | 0.594 | thin
| 9697 | 129 | CL10-USDC/MUSD, vAMM-VVV/DIEM, vAMM-cbBTC/EDGE, CL50-VFY/ZEN | 27.0 | 156.6% | 20.4% | 5.0e-5 | 0.001 | 6 | 0.19 | 0.9920 | 1.000 | thin
| 932 | 379 | vAMM-AERO/USDC, vAMM-weETH/WETH, CL10-USDC/NVDAc, CL200-WETH/AAVE | 10.0 | 128.9% | 20.2% | 5.0e-5 | 0.001 | 2 | 0.71 | 0.1978 | 0.826 | thin
| 1860 | 693 | vAMM-WETH/cbBTC, vAMM-WETH/wstETH, vAMM-cbBTC/EDGE, vAMM-WETH/FLOCK | 13.6 | 111.3% | 19.5% | 5.0e-5 | 0.001 | 0 |  |  |  | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 27.4 | 130.8% | 20.8% | 5.0e-5 | 0.001 | 8 | 0.75 | 0.0190 | 0.438 | thin
| 751 | 5,992 | CL50-EURC/USDC, CL1-USDC/PROS, CL100-WETH/B3, CL10-USDC/LMTS | 21.6 | 139.5% | 18.9% | 5.0e-5 | 0.001 | 3 | 0.65 | 0.2368 | 0.851 | thin
| 6288 | 816 | vAMM-WETH/wstETH, vAMM-VIRTUAL/cbBTC, CL1-WETH/wstETH, CL100-WETH/REI | 6.0 | 205.0% | 22.3% | 5.0e-5 | 0.001 | 0 |  |  |  | thin

## Strongest timing evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1063 | 10,604 | CL50-WETH/USDC, CL100-RSGP/USDC, CL50-HYPE/WETH, CL1-USDC/KNTQ | 27.8 | 22.4% | 21.2% | 0.3177 | 0.520 | 4 | 0.98 | 5.0e-5 | 0.048 |
| 1080 | 3,419 | CL200-AERO/WETH, CL10-USDC/MUc, CL100-RSGP/USDC, CL50-msUSD/USDC | 27.8 | 24.5% | 21.2% | 0.0779 | 0.239 | 7 | 0.93 | 5.0e-5 | 0.048 |
| 2133 | 3,001 | CL10-USDC/MSFTc, sAMM-WETH/msETH, CL100-RSGP/USDC, CL1-cbETH/WETH | 12.4 | 22.9% | 18.8% | 0.1299 | 0.317 | 3 | 1.00 | 5.0e-5 | 0.048 |
| 1277, 2272 | 731 | vAMM-AERO/USDC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-WETH/cbBTC | 27.8 | 18.6% | 21.1% | 0.6683 | 0.763 | 3 | 0.99 | 5.0e-5 | 0.048 |
| 9833 | 4,907 | CL200-AERO/cbBTC, vAMM-AERO/WETH, CL100-TOWNS/WETH, CL1-WBTC/cbBTC | 27.0 | 23.2% | 20.4% | 0.1548 | 0.349 | 6 | 0.95 | 5.0e-5 | 0.048 |
| 8394 | 5,132 | vAMM-AERO/USDC, CL10-USDC/MUSD, sAMM-WETH/msETH, CL10-USDC/MXNB | 27.0 | 18.6% | 20.4% | 0.6553 | 0.756 | 4 | 0.96 | 5.0e-5 | 0.048 |
| 22761 | 10,011 | CL10-USDC/MSTRc, CL10-SOL/WETH, CL50-USDC/VVV, CL10-USDC/SNDKc | 13.0 | 30.2% | 22.6% | 0.0047 | 0.036 | 4 | 0.98 | 5.0e-5 | 0.048 |
| 2510 | 197,798 | CL10-USDC/MSTRc, CL50-USDC/cbBTC, CL10-USDC/SNDKc, CL1-USDC/KNTQ | 20.8 | 21.9% | 21.0% | 0.2308 | 0.432 | 6 | 0.93 | 1.0e-4 | 0.067 |
| 1969 | 9,671 | CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/GOOGLc, CL1-USDC/KNTQ | 22.6 | 20.2% | 19.8% | 0.4076 | 0.596 | 3 | 0.98 | 0.0001 | 0.067 |
| 1628, 5397, 5425 | 9,985 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 27.6 | 26.0% | 21.0% | 0.0480 | 0.174 | 3 | 0.98 | 0.0001 | 0.067 |
| 11311 | 372,606 | CL100-WETH/VVV, CL10-USDC/AMZNc, CL10-USDC/MSTRc | 27.0 | 27.1% | 20.4% | 0.0120 | 0.069 | 2 | 0.99 | 0.0001 | 0.067 |
| 4182 | 3,928 | CL10-USDC/MSFTc, CL50-msUSD/USDC, CL200-USDC/BLUECHIP, vAMM-WETH/TLOS | 27.0 | 29.2% | 20.4% | 0.0015 | 0.017 | 5 | 0.93 | 0.0001 | 0.067 |
| 4273 | 3,919 | CL10-USDC/GOOGLc, CL50-msUSD/USDC, CL200-USDC/BLUECHIP, vAMM-WETH/TLOS | 27.0 | 28.6% | 20.4% | 0.0043 | 0.034 | 5 | 0.91 | 0.0001 | 0.067 |
| 4711 | 5,517 | CL10-USDC/MSTRc, CL1-USDC/KNTQ, CL100-WETH/EURC, CL200-WETH/MORPHO | 26.6 | 22.4% | 20.2% | 0.3377 | 0.537 | 3 | 0.97 | 0.0001 | 0.067 |
| 7763 | 3,128 | CL200-USDC/cbZEC, CL100-RSGP/USDC, CL100-WETH/LINK | 24.5 | 21.1% | 20.4% | 0.4206 | 0.605 | 2 | 1.00 | 0.0001 | 0.067 |

## Aero Autopilot USDC Maxi (stake 20366)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.8% | 22.2% | 5.0e-5 | 0.001 | 7 | 0.80 | 0.0190 | 0.438 | thin

"thin" marks a strategy that held more than 25% of a pool's power at some point. Placebos pay the same dilution, but such pools are rarely drawn.
