# Aero allocation skill: results

Data: 2026-10-22 00:00 to 2026-11-19 13:00 UTC (28.5 days), 317 gauges, 54261 allocations by 16030 stakes. 24 allocations after the last hour are left out.
Prices: one snapshot, AERO at $0.4331, each from a pool at least 10 times as deep as the most its token paid in a day. Gauges paying a token without a price hold 1.2% of the last hour's power; that token counts as 0, for strategies and placebos alike.
Gauges that didn't count the sAERO allocated to them (power under 10.0% of it, as when a gauge isn't activated): 0.3% of allocated sAERO-hours, which earn nothing there.
Allocations to addresses that are not gauges (the zero address and 0x2e67…6902, which has no code): 8.2% of the sAERO in all allocation events. Weights are taken over real gauges only.
Average sAERO in a pool over the whole period: APR 21.1% at today's prices (fees 95.5% of all pay, incentives the rest).

Strategies: 16029 stakes, grouped into 11214 strategies (stakes with exactly the same allocations, hour by hour, and the same end, are one strategy). 3924 stakes were withdrawn or their lock ended before the last hour; their allocations end then.

## Selection

Tested: 9701 strategies of at least 100 sAERO with at least 96 hours in pools.
- Significant at FDR 0.1 (Benjamini–Hochberg): 1702 better than chance.
- p < 0.05: 25.8% of strategies (5% expected with no skill anywhere).
- p-values as normal quantiles: mean 0.88, variance 1.58 (about 0 and 1 with no skill anywhere).
- Against a crowd of stakes (pools drawn by how many stakes are in them, not by their power): 155 significant at FDR 0.1; p < 0.05 for 12.1%.
- Calibration by size. With no skill, p-values are spread evenly: 5% below 0.05 and 10% above 0.9.

  | sAERO | Strategies | p < 0.05 (power) | p > 0.9 (power) | p < 0.05 (stakes) | p > 0.9 (stakes) |
  |---|---|---|---|---|---|
  | 100–1k | 1909 | 22.9% | 3.7% | 11.1% | 9.0% |
  | 1k–10k | 4247 | 24.5% | 2.7% | 10.8% | 7.0% |
  | 10k–100k | 2672 | 25.2% | 1.8% | 10.7% | 5.4% |
  | 100k–1M | 759 | 36.9% | 1.1% | 20.0% | 4.0% |
  | ≥ 1M | 114 | 65.8% | 0.9% | 54.4% | 0.9% |

- Persistence: Spearman ρ between first-half and second-half selection p-values (as normal quantiles), 6958 strategies: 0.350 (±0.023 is the 95% band for 0).

## Timing

Tested: 6739 strategies of at least 100 sAERO, with 26179 moves that had at least two possible hours.
- Significant at FDR 0.1: 32.
- p < 0.05: 9.0% of strategies.
- Mean rank of the hour actually chosen, over all moves: 0.506 (0.5 with no timing skill; z = 3.11).
- Gain from timing, against moving at a random possible hour, in hours of the average sAERO's pay: median -0.0 per move; the best possible hour would have gained a median 15.1.
- Moves made outside the hours they were allowed at, left out: 0.

## Highest APRs (at least 7 days in pools)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 11795 | 431 | CL100-ZORA/WETH | 8.4 | 662.6% | 17.7% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 3430 | 234 | CL50-WETH/RSC, vAMM-cbBTC/EDGE, sAMM-DOLA/USDC, CL50-VFY/ZEN | 28.4 | 493.9% | 20.8% | 5.0e-5 | 0.003 | 7 | 0.34 | 0.8701 | 1.000 | thin
| 1469 | 1,297 | vAMM-WETH/FAI, CL50-WETH/FAI, vAMM-VIRTUAL/DEUS, CL10-USDC/MAG7 | 7.8 | 306.8% | 21.2% | 5.0e-5 | 0.003 | 1 | 0.98 | 0.0370 | 0.521 | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 284.4% | 17.1% | 5.0e-5 | 0.003 | 1 | 0.09 | 0.9221 | 1.000 | thin
| 9697 | 129 | CL10-USDC/MUSD, vAMM-VVV/DIEM, vAMM-cbBTC/EDGE, CL50-VFY/ZEN | 27.6 | 147.6% | 20.2% | 5.0e-5 | 0.003 | 7 | 0.18 | 0.9970 | 1.000 | thin
| 5703 | 496 | CL200-AERO/WETH, CL100-EURC/cbBTC, CL10-USDC/PYPLc, CL200-AERO/wstETH | 28.2 | 145.7% | 20.7% | 1.0e-4 | 0.004 | 2 | 0.73 | 0.1678 | 0.781 | thin
| 4160 | 332 | vAMM-VIRTUAL/cbBTC, sAMM-BD/USDC, CL200-VIRTUAL/WETH, CL1-XSGD/USDC | 27.9 | 136.5% | 20.4% | 0.0003 | 0.008 | 7 | 0.39 | 0.8282 | 1.000 | thin
| 751 | 5,992 | CL50-EURC/USDC, CL1-USDC/PROS, CL100-WETH/B3, CL10-USDC/LMTS | 22.3 | 136.0% | 18.6% | 1.0e-4 | 0.004 | 3 | 0.61 | 0.2777 | 0.867 | thin
| 1057 | 5,096 | CL200-AERO/WETH, CL10-USDC/MUc, CL10-USDC/SPCXc, vAMM-fBOMB/USDbC | 28.4 | 135.8% | 20.9% | 5.0e-5 | 0.003 | 4 | 0.77 | 0.0250 | 0.445 | thin
| 3849, 3853 | 643 | CL10-USDC/AMDc | 28.4 | 126.6% | 20.8% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 932 | 379 | vAMM-AERO/USDC, vAMM-weETH/WETH, CL10-USDC/NVDAc, CL200-WETH/AAVE | 10.0 | 126.3% | 20.1% | 5.0e-5 | 0.003 | 2 | 0.54 | 0.4086 | 0.943 | thin
| 5468 | 260 | CL10-USDC/LMTS, CL50-USDC/cbBTC | 17.1 | 124.7% | 23.8% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 1930 | 514 | sAMM-BD/USDC, vAMM-WETH/VVV, CL100-RSGP/USDC | 28.0 | 120.9% | 20.5% | 0.0002 | 0.006 | 3 | 0.47 | 0.5465 | 0.980 | thin
| 1860 | 693 | vAMM-WETH/cbBTC, vAMM-WETH/wstETH, vAMM-cbBTC/EDGE, vAMM-WETH/FLOCK | 13.6 | 111.2% | 19.4% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 28.0 | 106.6% | 20.6% | 1.0e-4 | 0.004 | 8 | 0.76 | 0.0098 | 0.394 | thin
| 6514 | 1,013 | CL100-cbXRP/cbBTC | 12.2 | 95.2% | 17.5% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 2973 | 1,926 | CL50-WETH/GOOGLc, CL10-USDC/AMZNc, vAMM-WETH/WELL, CL1-WETH/wstETH | 8.0 | 86.4% | 20.0% | 5.0e-5 | 0.003 | 2 | 0.75 | 0.3566 | 0.921 | thin
| 3471 | 1,208 | CL10-USDC/HSAIc, CL50-WETH/NVDAc | 9.8 | 80.8% | 17.2% | 1.0e-4 | 0.004 | 1 | 0.86 | 0.1479 | 0.755 | thin
| 9896 | 129 | CL200-WETH/DRV, CL100-WETH/PENDLE, CL50-MOCA/USDC, CL10-USDC/MRVLc | 27.8 | 76.7% | 20.3% | 5.0e-5 | 0.003 | 6 | 0.46 | 0.6194 | 0.990 | thin
| 18085 | 100 | CL1-USDC/VELVET, CL100-RSGP/USDC, CL50-USDC/DEUS, CL50-LCAP/USDC | 23.9 | 74.6% | 20.4% | 1.0e-4 | 0.004 | 6 | 0.61 | 0.1948 | 0.805 | thin
| 1594 | 2,241 | CL50-WETH/VELVET, CL100-cbXRP/cbBTC, vAMM-WETH/VEIL, vAMM-WETH/WELL | 28.4 | 73.4% | 20.9% | 5.0e-5 | 0.003 | 8 | 0.43 | 0.7223 | 1.000 | thin
| 1045 | 2,782 | CL10-USDC/SEc, sAMM-msUSD/USDC, CL100-RSGP/USDC | 8.4 | 67.1% | 20.2% | 1.0e-4 | 0.004 | 1 | 0.09 | 0.9241 | 1.000 | thin
| 3443 | 4,333 | CL100-WETH/B3, CL200-BIO/USDC, CL100-WETH/PENDLE, CL1-USDC/eUSD | 28.0 | 66.8% | 20.5% | 5.0e-5 | 0.003 | 7 | 0.31 | 0.8921 | 1.000 | thin
| 13239 | 1,798 | sAMM-WETH/msETH, sAMM-msUSD/USDC, CL10-USDC/SNDKc, CL200-WETH/VVV | 26.9 | 65.9% | 19.7% | 5.0e-5 | 0.003 | 11 | 0.61 | 0.1998 | 0.808 | thin
| 2084 | 22,103 | CL50-msUSD/USDC, CL200-msUSD/msETH | 10.6 | 65.3% | 19.5% | 5.0e-5 | 0.003 | 1 | 0.37 | 0.6314 | 0.992 | thin

## Largest strategies

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10495 | 143,276,232 | vAMM-AERO/USDC, CL200-AERO/WETH, CL200-AERO/USDC, CL10-USDC/MSFTc | 26.6 | 14.1% | 19.6% | 0.1878 | 0.408 | 4 | 0.67 | 0.1309 | 0.729 | thin
| 10426 | 106,692,444 | vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC | 26.6 | 17.7% | 19.6% | 0.0026 | 0.032 | 2 | 0.42 | 0.6034 | 0.990 | thin
| 10504 | 71,138,593 | vAMM-AERO/USDC, CL10-USDC/METAc, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 26.6 | 11.9% | 19.6% | 0.9700 | 0.977 | 3 | 0.36 | 0.8052 | 1.000 | thin
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.8 | 22.4% | 21.8% | 0.0004 | 0.011 | 7 | 0.72 | 0.0629 | 0.588 | thin
| 10522 | 36,000,001 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 26.6 | 20.9% | 19.6% | 0.0350 | 0.155 | 0 |  |  |  | thin
| 621 | 18,287,265 | vAMM-AERO/USDC, vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC | 28.5 | 19.7% | 21.1% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 20365 | 13,345,773 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.8 | 22.6% | 21.8% | 0.0230 | 0.119 | 7 | 0.71 | 0.0819 | 0.626 |
| 1103 | 11,442,128 | vAMM-AERO/fBOMB, CL100-WETH/VVV, CL10-USDC/METAc, CL1-WETH/cbBTC | 28.4 | 24.6% | 20.9% | 5.0e-5 | 0.003 | 4 | 0.61 | 0.2308 | 0.831 | thin
| 19741 | 11,406,304 | CL50-WETH/USDC, CL1-WETH/cbBTC, CL200-WETH/DRV, CL10-cbETH/cbBTC | 8.5 | 30.0% | 24.1% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 18791 | 9,232,536 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC, CL200-AERO/WETH | 21.9 | 23.0% | 20.9% | 0.0004 | 0.010 | 8 | 0.79 | 0.0140 | 0.412 |
| 8305 | 9,131,028 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL200-AERO/WETH, CL100-WETH/VVV | 27.9 | 21.5% | 20.4% | 0.0010 | 0.017 | 6 | 0.61 | 0.1768 | 0.793 | thin
| 16765 | 7,713,287 | CL50-USDC/cbBTC, CL200-AERO/cbBTC, CL10-USDC/AMZNc, CL200-WETH/AAVE | 25.6 | 24.8% | 19.9% | 5.0e-5 | 0.003 | 0 |  |  |  |
| 12469 | 5,766,071 | CL100-WETH/VVV | 27.1 | 21.5% | 19.9% | 0.2018 | 0.423 | 0 |  |  |  |
| 1359 | 5,471,711 | vAMM-AERO/USDC, CL100-USDC/cbBTC, CL50-USDC/cbBTC, CL200-AERO/USDC | 15.2 | 17.9% | 19.0% | 0.4436 | 0.633 | 0 |  |  |  |
| 17968, 17969, 17970 +1 | 5,390,075 | vAMM-AERO/USDC, CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 24.0 | 20.7% | 20.4% | 0.1588 | 0.376 | 0 |  |  |  |

## Strongest selection evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 3430 | 234 | CL50-WETH/RSC, vAMM-cbBTC/EDGE, sAMM-DOLA/USDC, CL50-VFY/ZEN | 28.4 | 493.9% | 20.8% | 5.0e-5 | 0.003 | 7 | 0.34 | 0.8701 | 1.000 | thin
| 11795 | 431 | CL100-ZORA/WETH | 8.4 | 662.6% | 17.7% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 284.4% | 17.1% | 5.0e-5 | 0.003 | 1 | 0.09 | 0.9221 | 1.000 | thin
| 1469 | 1,297 | vAMM-WETH/FAI, CL50-WETH/FAI, vAMM-VIRTUAL/DEUS, CL10-USDC/MAG7 | 7.8 | 306.8% | 21.2% | 5.0e-5 | 0.003 | 1 | 0.98 | 0.0370 | 0.521 | thin
| 9697 | 129 | CL10-USDC/MUSD, vAMM-VVV/DIEM, vAMM-cbBTC/EDGE, CL50-VFY/ZEN | 27.6 | 147.6% | 20.2% | 5.0e-5 | 0.003 | 7 | 0.18 | 0.9970 | 1.000 | thin
| 932 | 379 | vAMM-AERO/USDC, vAMM-weETH/WETH, CL10-USDC/NVDAc, CL200-WETH/AAVE | 10.0 | 126.3% | 20.1% | 5.0e-5 | 0.003 | 2 | 0.54 | 0.4086 | 0.943 | thin
| 1860 | 693 | vAMM-WETH/cbBTC, vAMM-WETH/wstETH, vAMM-cbBTC/EDGE, vAMM-WETH/FLOCK | 13.6 | 111.2% | 19.4% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 12494 | 446 | CL10-USDC/ORCLc, CL100-RSGP/USDC | 7.0 | 220.6% | 17.0% | 5.0e-5 | 0.003 | 1 | 0.96 | 0.0440 | 0.543 | thin
| 1057 | 5,096 | CL200-AERO/WETH, CL10-USDC/MUc, CL10-USDC/SPCXc, vAMM-fBOMB/USDbC | 28.4 | 135.8% | 20.9% | 5.0e-5 | 0.003 | 4 | 0.77 | 0.0250 | 0.445 | thin
| 6288 | 816 | vAMM-WETH/wstETH, vAMM-VIRTUAL/cbBTC, CL1-WETH/wstETH, CL100-WETH/REI | 6.0 | 190.8% | 22.1% | 5.0e-5 | 0.003 | 0 |  |  |  | thin
| 3443 | 4,333 | CL100-WETH/B3, CL200-BIO/USDC, CL100-WETH/PENDLE, CL1-USDC/eUSD | 28.0 | 66.8% | 20.5% | 5.0e-5 | 0.003 | 7 | 0.31 | 0.8921 | 1.000 | thin
| 9896 | 129 | CL200-WETH/DRV, CL100-WETH/PENDLE, CL50-MOCA/USDC, CL10-USDC/MRVLc | 27.8 | 76.7% | 20.3% | 5.0e-5 | 0.003 | 6 | 0.46 | 0.6194 | 0.990 | thin
| 13239 | 1,798 | sAMM-WETH/msETH, sAMM-msUSD/USDC, CL10-USDC/SNDKc, CL200-WETH/VVV | 26.9 | 65.9% | 19.7% | 5.0e-5 | 0.003 | 11 | 0.61 | 0.1998 | 0.808 | thin
| 1594 | 2,241 | CL50-WETH/VELVET, CL100-cbXRP/cbBTC, vAMM-WETH/VEIL, vAMM-WETH/WELL | 28.4 | 73.4% | 20.9% | 5.0e-5 | 0.003 | 8 | 0.43 | 0.7223 | 1.000 | thin
| 3849, 3853 | 643 | CL10-USDC/AMDc | 28.4 | 126.6% | 20.8% | 5.0e-5 | 0.003 | 0 |  |  |  | thin

## Strongest timing evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1063 | 10,604 | CL50-WETH/USDC, CL100-RSGP/USDC, CL50-HYPE/WETH, CL1-USDC/KNTQ | 28.5 | 22.1% | 20.9% | 0.3606 | 0.577 | 4 | 0.97 | 5.0e-5 | 0.031 |
| 1080 | 3,419 | CL200-AERO/WETH, CL10-USDC/MUc, CL100-RSGP/USDC, CL50-msUSD/USDC | 28.5 | 22.5% | 20.9% | 0.2537 | 0.476 | 7 | 0.91 | 5.0e-5 | 0.031 |
| 1277, 2272 | 731 | vAMM-AERO/USDC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-WETH/cbBTC | 28.4 | 18.4% | 20.8% | 0.6643 | 0.756 | 3 | 0.99 | 5.0e-5 | 0.031 |
| 1254 | 3,264 | CL10-USDC/SPCXc, CL100-RSGP/USDC, CL100-USDC/INFI | 28.2 | 25.0% | 20.7% | 0.0929 | 0.282 | 4 | 1.00 | 5.0e-5 | 0.031 |
| 1628, 5397, 5425 | 9,985 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 28.2 | 26.0% | 20.7% | 0.0440 | 0.180 | 3 | 0.98 | 5.0e-5 | 0.031 |
| 9833 | 4,907 | CL200-AERO/cbBTC, vAMM-AERO/WETH, CL100-TOWNS/WETH, CL1-WBTC/cbBTC | 27.6 | 22.7% | 20.2% | 0.2028 | 0.424 | 6 | 0.96 | 5.0e-5 | 0.031 |
| 4182 | 3,928 | CL10-USDC/MSFTc, CL50-msUSD/USDC, CL200-USDC/BLUECHIP, vAMM-WETH/TLOS | 27.6 | 28.2% | 20.2% | 0.0062 | 0.051 | 5 | 0.95 | 5.0e-5 | 0.031 |
| 4273 | 3,919 | CL10-USDC/GOOGLc, CL50-msUSD/USDC, CL200-USDC/BLUECHIP, vAMM-WETH/TLOS | 27.6 | 27.7% | 20.2% | 0.0081 | 0.062 | 5 | 0.95 | 5.0e-5 | 0.031 |
| 2510 | 197,798 | CL10-USDC/MSTRc, CL50-USDC/cbBTC, CL10-USDC/SNDKc, CL1-USDC/KNTQ | 21.4 | 22.1% | 20.6% | 0.2078 | 0.429 | 6 | 0.95 | 5.0e-5 | 0.031 |
| 7763 | 3,128 | CL200-USDC/cbZEC, CL100-RSGP/USDC, CL100-WETH/LINK | 25.1 | 20.9% | 20.1% | 0.4156 | 0.613 | 2 | 1.00 | 5.0e-5 | 0.031 |
| 22761 | 10,011 | CL10-USDC/MSTRc, CL10-SOL/WETH, CL50-USDC/VVV, CL10-USDC/SNDKc | 13.6 | 29.8% | 22.2% | 0.0073 | 0.058 | 4 | 0.99 | 5.0e-5 | 0.031 |
| 1969 | 9,671 | CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/GOOGLc, CL1-USDC/KNTQ | 23.2 | 20.1% | 19.6% | 0.4046 | 0.607 | 3 | 0.99 | 1.0e-4 | 0.042 |
| 1222 | 11,904 | vAMM-AERO/USDC, CL50-WETH/USDC, CL200-AERO/WETH, CL10-USDC/GOOGLc | 9.6 | 20.2% | 20.2% | 0.4605 | 0.645 | 3 | 0.98 | 1.0e-4 | 0.042 |
| 3942 | 17,046 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 28.3 | 26.0% | 20.8% | 0.0500 | 0.193 | 3 | 0.98 | 1.0e-4 | 0.042 |
| 8394 | 5,132 | vAMM-AERO/USDC, CL10-USDC/MUSD, sAMM-WETH/msETH, CL10-USDC/MXNB | 27.6 | 18.4% | 20.2% | 0.6444 | 0.746 | 4 | 0.96 | 1.0e-4 | 0.042 |

## Aero Autopilots: USDC Maxi (stake 20366) and sAERO Maxi (stake 20365)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.8 | 22.4% | 21.8% | 0.0004 | 0.011 | 7 | 0.72 | 0.0629 | 0.588 | thin
| 20365 | 13,345,773 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.8 | 22.6% | 21.8% | 0.0230 | 0.119 | 7 | 0.71 | 0.0819 | 0.626 |

"thin" marks a strategy that held more than 25.0% of a pool's power at some point. Placebos pay the same dilution, but such pools are rarely drawn.
