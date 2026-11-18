# Aero allocation skill: results

Data: 2026-10-22 00:00 to 2026-11-18 22:00 UTC (27.9 days), 317 gauges, 53553 allocations by 15974 stakes.
Prices: one snapshot, AERO at $0.4241. Gauges paying a token without a price hold 0.1% of today's power; that token counts as 0, for strategies and placebos alike.
Allocations to addresses that are not gauges (the zero address and 0x2e67…6902, which has no code): 8.3% of all power allocated. Weights are taken over real gauges only.
Average sAERO in a pool over the whole period: APR 21.4% at today's prices (fees 99.6% of pay, incentives the rest).

Strategies: 15974 stakes, grouped into 11101 strategies (stakes with exactly the same allocations, hour by hour, are one strategy). Only strategies of at least 100 sAERO are tested.

## Selection

Tested: 9620 strategies with at least 96 hours in pools.
- Significant at FDR 0.1 (Benjamini–Hochberg): 1692 better than chance.
- p < 0.05: 26.1% of strategies (5% expected with no skill anywhere).
- p-values as normal quantiles: mean 0.90, variance 1.61 (about 0 and 1 with no skill anywhere).
- Against a crowd of stakes (pools drawn by how many stakes are in them, not by their power): 224 significant at FDR 0.1; p < 0.05 for 12.4%.
- Calibration by size. With no skill, p-values are spread evenly: 5% below 0.05 and 10% above 0.9.

  | sAERO | Strategies | p < 0.05 (power) | p > 0.9 (power) | p < 0.05 (stakes) | p > 0.9 (stakes) |
  |---|---|---|---|---|---|
  | 100–1k | 1877 | 23.6% | 3.6% | 11.6% | 9.1% |
  | 1k–10k | 4202 | 24.9% | 2.7% | 11.0% | 7.2% |
  | 10k–100k | 2669 | 25.3% | 1.8% | 10.9% | 5.7% |
  | 100k–1M | 758 | 36.4% | 1.2% | 21.1% | 4.6% |
  | ≥ 1M | 114 | 64.9% | 1.8% | 54.4% | 0.9% |

- Persistence: Spearman ρ between first-half and second-half selection z, 6933 strategies: 0.334 (±0.024 is the 95% band for 0).

## Timing

Tested: 6687 strategies with 25604 moves that had at least two possible hours.
- Significant at FDR 0.1: 24.
- p < 0.05: 8.4% of strategies.
- Mean rank of the hour actually chosen, over all moves: 0.505 (0.5 with no timing skill; z = 2.41).
- Gain from timing, against moving at a random possible hour, in hours of the average sAERO's pay: median -0.0 per move; the best possible hour would have gained a median 15.0.

## Highest APRs (at least 7 days in pools)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2751 | 1,234 | vAMM-USDC/NOCK, CL100-RSGP/USDC | 10.2 | 1405.3% | 19.8% | 5.0e-5 | 0.003 | 1 | 0.65 | 0.3586 | 0.930 | thin
| 7093 | 4,565 | CL200-wtCOIN/USDC | 27.4 | 886.0% | 20.8% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 285.0% | 17.3% | 5.0e-5 | 0.003 | 1 | 0.06 | 0.9241 | 1.000 | thin
| 5703 | 496 | CL200-AERO/WETH, CL100-EURC/cbBTC, CL10-USDC/PYPLc, CL200-AERO/wstETH | 27.5 | 152.3% | 20.9% | 0.0074 | 0.059 | 2 | 0.30 | 0.8012 | 1.000 | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 27.4 | 130.8% | 20.8% | 5.0e-5 | 0.003 | 8 | 0.75 | 0.0120 | 0.395 | thin
| 5468 | 260 | CL10-USDC/LMTS, CL50-USDC/cbBTC | 16.5 | 130.6% | 24.3% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 1045 | 2,782 | CL10-USDC/SEc, sAMM-msUSD/USDC, CL100-RSGP/USDC | 8.4 | 69.6% | 20.3% | 0.0001 | 0.005 | 1 | 0.18 | 0.8112 | 1.000 | thin
| 3443 | 4,333 | CL100-WETH/B3, CL200-BIO/USDC, CL100-WETH/PENDLE, CL1-USDC/eUSD | 27.4 | 69.3% | 20.8% | 5.0e-5 | 0.003 | 7 | 0.43 | 0.6683 | 1.000 | thin
| 5310 | 438 | CL100-USDC/TAO, CL1-XSGD/USDC, CL100-cbXRP/cbBTC, CL100-WETH/B3 | 20.3 | 62.7% | 20.7% | 1.0e-4 | 0.004 | 6 | 0.42 | 0.7193 | 1.000 |
| 5187 | 645 | CL100-USDC/TAO, CL1-XSGD/USDC, CL100-cbXRP/cbBTC, CL200-RECALL/USDC | 25.6 | 56.5% | 21.5% | 5.0e-5 | 0.003 | 9 | 0.28 | 0.9850 | 1.000 |
| 6564 | 2,509 | CL50-WETH/VELVET, CL100-cbXRP/cbBTC, CL1-wtSGOV/USDC, CL200-cbBTC/EDGE | 27.4 | 54.7% | 20.8% | 0.0002 | 0.006 | 7 | 0.65 | 0.1548 | 0.781 | thin
| 4149 | 2,968 | CL200-TIG/USDC, CL100-RSGP/USDC | 8.4 | 52.6% | 20.3% | 0.0026 | 0.032 | 0 |  |  |  | thin
| 4484 | 1,206 | CL50-EURC/USDC, CL10-USDC/SPCXc | 10.0 | 52.6% | 19.0% | 0.0004 | 0.009 | 1 | 0.83 | 0.1648 | 0.790 | thin
| 6889, 6923 | 1,819 | CL200-O/USDC, sAMM-msUSD/USDC, vAMM-WETH/TLOS, CL100-RSGP/USDC | 12.3 | 52.4% | 18.1% | 5.0e-5 | 0.003 | 4 | 0.75 | 0.0609 | 0.605 | thin
| 6641 | 185 | CL1-WETH/wstETH, CL100-AERO/USDC, CL10-WETH/cbBTC | 27.5 | 47.5% | 20.9% | 0.0004 | 0.009 | 2 | 0.48 | 0.5495 | 0.983 | thin
| 5504 | 1,725 | CL100-USDC/TAO, CL50-WETH/USDC | 10.5 | 47.1% | 18.8% | 0.0033 | 0.036 | 1 | 0.86 | 0.2478 | 0.861 | thin
| 5829 | 1,578 | CL200-WETH/BRETT, CL200-WETH/KTA, CL200-tBTC/USDC, CL1-WETH/cbBTC | 27.5 | 46.4% | 20.9% | 5.0e-5 | 0.003 | 8 | 0.53 | 0.4096 | 0.935 | thin
| 6444 | 152 | CL10-SOL/cbBTC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/MRNAc | 27.5 | 45.1% | 20.9% | 0.0002 | 0.007 | 5 | 0.53 | 0.4076 | 0.935 |
| 3924 | 10,896 | CL200-WETH/Basecat, CL200-cbBTC/ZEN, CL200-PORTAL/USDC, CL50-MOCA/USDC | 13.4 | 44.3% | 24.3% | 0.0028 | 0.033 | 2 | 0.70 | 0.2727 | 0.873 |
| 7698 | 2,555 | CL10-WETH/METAc, CL50-BIO/WETH, CL10-USDC/AMZNc, CL100-WETH/cbXRP | 27.3 | 44.1% | 20.7% | 5.0e-5 | 0.003 | 9 | 0.38 | 0.8232 | 1.000 |
| 5100 | 228 | CL200-WETH/BRETT, CL1-WETH/cbBTC | 27.6 | 43.9% | 21.0% | 0.0002 | 0.007 | 1 | 0.63 | 0.3516 | 0.925 | thin
| 4123 | 242 | CL200-BNKR/WETH | 27.7 | 42.6% | 21.0% | 0.0004 | 0.010 | 0 |  |  |  | thin
| 3872 | 2,598 | CL50-msUSD/USDC, CL100-AERO/USDC, CL100-USDC/DIEM, CL100-USDC/cbHYPE | 10.2 | 42.3% | 18.6% | 1.0e-4 | 0.004 | 1 | 0.56 | 0.4396 | 0.950 |
| 1658 | 3,558 | sAMM-msUSD/USDC, CL100-USDC/DIEM, CL100-USDC/cbHYPE, CL200-O/USDC | 27.8 | 42.2% | 21.2% | 1.0e-4 | 0.004 | 6 | 0.42 | 0.6973 | 1.000 | thin
| 7251 | 1,052 | CL100-WETH/B3, CL200-WETH/VVV | 9.3 | 41.8% | 19.3% | 0.0007 | 0.014 | 0 |  |  |  | thin

## Largest strategies

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10495 | 143,276,232 | vAMM-AERO/USDC, CL200-AERO/WETH, CL200-AERO/USDC, CL10-USDC/MSFTc | 26.0 | 14.2% | 19.8% | 0.1908 | 0.400 | 4 | 0.63 | 0.1778 | 0.813 | thin
| 10426 | 106,692,444 | vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC | 26.0 | 18.3% | 19.8% | 0.0002 | 0.007 | 2 | 0.43 | 0.6244 | 0.999 | thin
| 10504 | 71,138,593 | vAMM-AERO/USDC, CL10-USDC/METAc, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 26.0 | 12.0% | 19.9% | 0.9720 | 0.981 | 3 | 0.40 | 0.7023 | 1.000 | thin
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.8% | 22.2% | 0.0006 | 0.012 | 7 | 0.80 | 0.0170 | 0.422 | thin
| 10522 | 36,000,001 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 26.0 | 21.2% | 19.9% | 0.0260 | 0.126 | 0 |  |  |  | thin
| 621 | 18,287,265 | vAMM-AERO/USDC, vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC | 27.9 | 20.0% | 21.4% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 20365 | 13,345,773 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.9% | 22.2% | 0.0210 | 0.110 | 7 | 0.71 | 0.0819 | 0.650 |
| 1103 | 11,442,128 | vAMM-AERO/fBOMB, CL100-WETH/VVV, CL10-USDC/METAc, CL1-WETH/cbBTC | 27.8 | 24.8% | 21.1% | 5.0e-5 | 0.003 | 4 | 0.61 | 0.2418 | 0.858 | thin
| 19741 | 11,406,304 | CL50-WETH/USDC, CL1-WETH/cbBTC, CL200-WETH/DRV, CL10-cbETH/cbBTC | 7.9 | 31.3% | 24.9% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 18791 | 9,232,536 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC, CL200-AERO/WETH | 21.3 | 23.1% | 21.2% | 0.0006 | 0.013 | 8 | 0.64 | 0.1558 | 0.781 |
| 8305 | 9,131,028 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL200-AERO/WETH, CL100-WETH/VVV | 27.3 | 21.5% | 20.7% | 0.0014 | 0.022 | 6 | 0.60 | 0.2018 | 0.826 | thin
| 16765 | 7,713,287 | CL50-USDC/cbBTC, CL200-AERO/cbBTC, CL10-USDC/AMZNc, CL200-WETH/AAVE | 25.0 | 25.1% | 20.2% | 0.0959 | 0.283 | 0 |  |  |  |
| 12469 | 5,766,071 | CL100-WETH/VVV | 26.5 | 20.7% | 20.2% | 0.2008 | 0.410 | 0 |  |  |  |
| 1359 | 5,471,711 | vAMM-AERO/USDC, CL100-USDC/cbBTC, CL50-USDC/cbBTC, CL200-AERO/USDC | 15.2 | 18.0% | 19.3% | 0.4276 | 0.617 | 0 |  |  |  |
| 17968, 17969, 17970 +1 | 5,390,075 | vAMM-AERO/USDC, CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 23.4 | 21.0% | 20.7% | 0.2348 | 0.449 | 0 |  |  |  |

## Strongest selection evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20157, 20158 | 1,920 | CL100-XSGD/WETH, CL10-USDC/TTWOc, CL100-TOWNS/WETH, vAMM-WETH/EDEL | 7.0 | 230218.5% | 25.3% | 5.0e-5 | 0.003 | 1 | 0.31 | 0.6963 | 1.000 | thin
| 3430 | 234 | CL50-WETH/RSC, vAMM-cbBTC/EDGE, sAMM-DOLA/USDC, CL50-VFY/ZEN | 27.8 | 917.7% | 21.1% | 5.0e-5 | 0.003 | 7 | 0.13 | 1.0000 | 1.000 | thin
| 2751 | 1,234 | vAMM-USDC/NOCK, CL100-RSGP/USDC | 10.2 | 1405.3% | 19.8% | 5.0e-5 | 0.003 | 1 | 0.65 | 0.3586 | 0.930 | thin
| 7093 | 4,565 | CL200-wtCOIN/USDC | 27.4 | 886.0% | 20.8% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 11795 | 431 | CL100-ZORA/WETH | 8.4 | 695.6% | 17.9% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 285.0% | 17.3% | 5.0e-5 | 0.003 | 1 | 0.06 | 0.9241 | 1.000 | thin
| 12494 | 446 | CL10-USDC/ORCLc, CL100-RSGP/USDC | 7.0 | 371.4% | 17.2% | 5.0e-5 | 0.003 | 1 | 0.97 | 0.0270 | 0.470 | thin
| 1469 | 1,297 | vAMM-WETH/FAI, CL50-WETH/FAI, vAMM-VIRTUAL/DEUS, CL10-USDC/MAG7 | 7.8 | 301.1% | 21.2% | 5.0e-5 | 0.003 | 1 | 0.97 | 0.0420 | 0.566 | thin
| 9697 | 129 | CL10-USDC/MUSD, vAMM-VVV/DIEM, vAMM-cbBTC/EDGE, CL50-VFY/ZEN | 27.0 | 156.6% | 20.4% | 5.0e-5 | 0.003 | 6 | 0.19 | 0.9890 | 1.000 | thin
| 932 | 379 | vAMM-AERO/USDC, vAMM-weETH/WETH, CL10-USDC/NVDAc, CL200-WETH/AAVE | 10.0 | 128.9% | 20.2% | 5.0e-5 | 0.003 | 2 | 0.71 | 0.1888 | 0.821 | thin
| 1860 | 693 | vAMM-WETH/cbBTC, vAMM-WETH/wstETH, vAMM-cbBTC/EDGE, vAMM-WETH/FLOCK | 13.6 | 111.3% | 19.5% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 27.4 | 130.8% | 20.8% | 5.0e-5 | 0.003 | 8 | 0.75 | 0.0120 | 0.395 | thin
| 751 | 5,992 | CL50-EURC/USDC, CL1-USDC/PROS, CL100-WETH/B3, CL10-USDC/LMTS | 21.6 | 139.5% | 18.9% | 5.0e-5 | 0.003 | 3 | 0.65 | 0.2148 | 0.834 | thin
| 6288 | 816 | vAMM-WETH/wstETH, vAMM-VIRTUAL/cbBTC, CL1-WETH/wstETH, CL100-WETH/REI | 6.0 | 205.0% | 22.3% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 3443 | 4,333 | CL100-WETH/B3, CL200-BIO/USDC, CL100-WETH/PENDLE, CL1-USDC/eUSD | 27.4 | 69.3% | 20.8% | 5.0e-5 | 0.003 | 7 | 0.43 | 0.6683 | 1.000 | thin

## Strongest timing evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1063 | 10,604 | CL50-WETH/USDC, CL100-RSGP/USDC, CL50-HYPE/WETH, CL1-USDC/KNTQ | 27.8 | 22.4% | 21.2% | 0.4176 | 0.611 | 4 | 0.98 | 5.0e-5 | 0.042 |
| 1080 | 3,419 | CL200-AERO/WETH, CL10-USDC/MUc, CL100-RSGP/USDC, CL50-msUSD/USDC | 27.8 | 24.5% | 21.2% | 0.0919 | 0.277 | 7 | 0.93 | 5.0e-5 | 0.042 |
| 2133 | 3,001 | CL10-USDC/MSFTc, sAMM-WETH/msETH, CL100-RSGP/USDC, CL1-cbETH/WETH | 12.4 | 22.9% | 18.8% | 0.1399 | 0.345 | 3 | 1.00 | 5.0e-5 | 0.042 |
| 1277, 2272 | 731 | vAMM-AERO/USDC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-WETH/cbBTC | 27.8 | 18.6% | 21.1% | 0.7023 | 0.780 | 3 | 0.99 | 5.0e-5 | 0.042 |
| 1628, 5397, 5425 | 9,985 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 27.6 | 26.0% | 21.0% | 0.0749 | 0.245 | 3 | 0.98 | 5.0e-5 | 0.042 |
| 9833 | 4,907 | CL200-AERO/cbBTC, vAMM-AERO/WETH, CL100-TOWNS/WETH, CL1-WBTC/cbBTC | 27.0 | 23.2% | 20.4% | 0.1858 | 0.395 | 6 | 0.95 | 5.0e-5 | 0.042 |
| 4182 | 3,928 | CL10-USDC/MSFTc, CL50-msUSD/USDC, CL200-USDC/BLUECHIP, vAMM-WETH/TLOS | 27.0 | 29.2% | 20.4% | 0.0035 | 0.037 | 5 | 0.93 | 5.0e-5 | 0.042 |
| 22761 | 10,011 | CL10-USDC/MSTRc, CL10-SOL/WETH, CL50-USDC/VVV, CL10-USDC/SNDKc | 13.0 | 30.2% | 22.6% | 0.0069 | 0.056 | 4 | 0.98 | 5.0e-5 | 0.042 |
| 1969 | 9,671 | CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/GOOGLc, CL1-USDC/KNTQ | 22.6 | 20.2% | 19.8% | 0.3886 | 0.589 | 3 | 0.98 | 1.0e-4 | 0.061 |
| 11311 | 372,606 | CL100-WETH/VVV, CL10-USDC/AMZNc, CL10-USDC/MSTRc | 27.0 | 27.1% | 20.4% | 0.0180 | 0.101 | 2 | 0.99 | 1.0e-4 | 0.061 |
| 2510 | 197,798 | CL10-USDC/MSTRc, CL50-USDC/cbBTC, CL10-USDC/SNDKc, CL1-USDC/KNTQ | 20.8 | 21.9% | 21.0% | 0.3047 | 0.520 | 6 | 0.93 | 1.0e-4 | 0.061 |
| 3942 | 17,046 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 27.7 | 26.0% | 21.0% | 0.0619 | 0.218 | 3 | 0.98 | 0.0001 | 0.072 |
| 1254 | 3,264 | CL10-USDC/SPCXc, CL100-RSGP/USDC, CL100-USDC/INFI | 27.6 | 25.6% | 21.0% | 0.0959 | 0.283 | 3 | 0.97 | 0.0001 | 0.072 |
| 8394 | 5,132 | vAMM-AERO/USDC, CL10-USDC/MUSD, sAMM-WETH/msETH, CL10-USDC/MXNB | 27.0 | 18.6% | 20.4% | 0.6364 | 0.747 | 4 | 0.96 | 0.0001 | 0.072 |
| 734 | 282 | CL10-USDC/NVDAc, CL10-USDC/MSTRc, CL10-USDC/SNDKc, CL10-USDC/MUc | 27.9 | 26.9% | 21.4% | 0.0559 | 0.203 | 3 | 0.97 | 0.0002 | 0.088 |

## Aero Autopilot USDC Maxi (stake 20366)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.8% | 22.2% | 0.0006 | 0.012 | 7 | 0.80 | 0.0170 | 0.422 | thin

"thin" marks a strategy that held more than 25% of a pool's power at some point. Placebos pay the same dilution, but such pools are rarely drawn.
