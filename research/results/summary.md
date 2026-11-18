# Aero allocation skill: results

Data: 2026-10-22 00:00 to 2026-11-18 22:00 UTC (27.9 days), 317 gauges, 53553 allocations by 15974 stakes.
Prices: one snapshot, AERO at $0.4241. Gauges paying a token without a price hold 0.1% of today's power; that token counts as 0, for strategies and placebos alike.
Allocations to addresses that are not gauges (the zero address and 0x2e67…6902, which has no code): 8.3% of all power allocated. Weights are taken over real gauges only.
Average sAERO in a pool over the whole period: APR 21.4% at today's prices (fees 99.6% of pay, incentives the rest).

Strategies: 15974 stakes, grouped into 11101 strategies (stakes with exactly the same allocations, hour by hour, are one strategy). Only strategies of at least 100 sAERO are tested.

## Selection

Tested: 9620 strategies with at least 96 hours in pools.
- Significant at FDR 0.1 (Benjamini–Hochberg): 1741 better than chance.
- p < 0.05: 26.3% of strategies (5% expected with no skill anywhere).
- p-values as normal quantiles: mean 0.89, variance 1.59 (about 0 and 1 with no skill anywhere).
- Against a crowd of stakes (pools drawn by how many stakes are in them, not by their power): 116 significant at FDR 0.1; p < 0.05 for 13.2%.
- Persistence: Spearman ρ between first-half and second-half selection z, 6933 strategies: 0.337 (±0.024 is the 95% band for 0).

## Timing

Tested: 6687 strategies with 25604 moves that had at least two possible hours.
- Significant at FDR 0.1: 22.
- p < 0.05: 8.7% of strategies.
- Mean rank of the hour actually chosen, over all moves: 0.505 (0.5 with no timing skill; z = 2.41).
- Gain from timing, against moving at a random possible hour, in hours of the average sAERO's pay: median -0.0 per move; the best possible hour would have gained a median 15.0.

## Highest APRs (at least 7 days in pools)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2751 | 1,234 | vAMM-USDC/NOCK, CL100-RSGP/USDC | 10.2 | 1405.3% | 19.8% | 5.0e-5 | 0.004 | 1 | 0.65 | 0.3407 | 0.922 | thin
| 7093 | 4,565 | CL200-wtCOIN/USDC | 27.4 | 886.0% | 20.8% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 285.0% | 17.3% | 5.0e-5 | 0.004 | 1 | 0.06 | 0.9281 | 1.000 | thin
| 5703 | 496 | CL200-AERO/WETH, CL100-EURC/cbBTC, CL10-USDC/PYPLc, CL200-AERO/wstETH | 27.5 | 152.3% | 20.9% | 0.0085 | 0.065 | 2 | 0.30 | 0.8012 | 1.000 | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 27.4 | 130.8% | 20.8% | 5.0e-5 | 0.004 | 8 | 0.75 | 0.0160 | 0.411 | thin
| 5468 | 260 | CL10-USDC/LMTS, CL50-USDC/cbBTC | 16.5 | 130.6% | 24.3% | 1.0e-4 | 0.005 | 0 |  |  |  | thin
| 1045 | 2,782 | CL10-USDC/SEc, sAMM-msUSD/USDC, CL100-RSGP/USDC | 8.4 | 69.6% | 20.3% | 1.0e-4 | 0.005 | 1 | 0.18 | 0.8521 | 1.000 | thin
| 3443 | 4,333 | CL100-WETH/B3, CL200-BIO/USDC, CL100-WETH/PENDLE, CL1-USDC/eUSD | 27.4 | 69.3% | 20.8% | 1.0e-4 | 0.005 | 7 | 0.43 | 0.6494 | 1.000 | thin
| 5310 | 438 | CL100-USDC/TAO, CL1-XSGD/USDC, CL100-cbXRP/cbBTC, CL100-WETH/B3 | 20.3 | 62.7% | 20.7% | 5.0e-5 | 0.004 | 6 | 0.42 | 0.7433 | 1.000 |
| 5187 | 645 | CL100-USDC/TAO, CL1-XSGD/USDC, CL100-cbXRP/cbBTC, CL200-RECALL/USDC | 25.6 | 56.5% | 21.5% | 5.0e-5 | 0.004 | 9 | 0.28 | 0.9860 | 1.000 |
| 6564 | 2,509 | CL50-WETH/VELVET, CL100-cbXRP/cbBTC, CL1-wtSGOV/USDC, CL200-cbBTC/EDGE | 27.4 | 54.7% | 20.8% | 0.0001 | 0.006 | 7 | 0.65 | 0.1409 | 0.760 | thin
| 4149 | 2,968 | CL200-TIG/USDC, CL100-RSGP/USDC | 8.4 | 52.6% | 20.3% | 0.0032 | 0.036 | 0 |  |  |  | thin
| 4484 | 1,206 | CL50-EURC/USDC, CL10-USDC/SPCXc | 10.0 | 52.6% | 19.0% | 0.0004 | 0.011 | 1 | 0.83 | 0.1828 | 0.814 | thin
| 6889, 6923 | 1,819 | CL200-O/USDC, sAMM-msUSD/USDC, vAMM-WETH/TLOS, CL100-RSGP/USDC | 12.3 | 52.4% | 18.1% | 5.0e-5 | 0.004 | 4 | 0.75 | 0.0729 | 0.636 | thin
| 6641 | 185 | CL1-WETH/wstETH, CL100-AERO/USDC, CL10-WETH/cbBTC | 27.5 | 47.5% | 20.9% | 1.0e-4 | 0.005 | 2 | 0.48 | 0.5534 | 0.979 | thin
| 5504 | 1,725 | CL100-USDC/TAO, CL50-WETH/USDC | 10.5 | 47.1% | 18.8% | 0.0033 | 0.037 | 1 | 0.86 | 0.2498 | 0.852 | thin
| 5829 | 1,578 | CL200-WETH/BRETT, CL200-WETH/KTA, CL200-tBTC/USDC, CL1-WETH/cbBTC | 27.5 | 46.4% | 20.9% | 0.0002 | 0.007 | 8 | 0.53 | 0.3986 | 0.932 | thin
| 6444 | 152 | CL10-SOL/cbBTC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/MRNAc | 27.5 | 45.1% | 20.9% | 0.0002 | 0.007 | 5 | 0.53 | 0.3896 | 0.929 |
| 3924 | 10,896 | CL200-WETH/Basecat, CL200-cbBTC/ZEN, CL200-PORTAL/USDC, CL50-MOCA/USDC | 13.4 | 44.3% | 24.3% | 0.0029 | 0.034 | 2 | 0.70 | 0.2957 | 0.884 |
| 7698 | 2,555 | CL10-WETH/METAc, CL50-BIO/WETH, CL10-USDC/AMZNc, CL100-WETH/cbXRP | 27.3 | 44.1% | 20.7% | 1.0e-4 | 0.005 | 9 | 0.38 | 0.8262 | 1.000 |
| 5100 | 228 | CL200-WETH/BRETT, CL1-WETH/cbBTC | 27.6 | 43.9% | 21.0% | 0.0004 | 0.010 | 1 | 0.63 | 0.4076 | 0.935 | thin
| 4123 | 242 | CL200-BNKR/WETH | 27.7 | 42.6% | 21.0% | 0.0003 | 0.009 | 0 |  |  |  | thin
| 3872 | 2,598 | CL50-msUSD/USDC, CL100-AERO/USDC, CL100-USDC/DIEM, CL100-USDC/cbHYPE | 10.2 | 42.3% | 18.6% | 0.0001 | 0.006 | 1 | 0.56 | 0.4416 | 0.952 |
| 1658 | 3,558 | sAMM-msUSD/USDC, CL100-USDC/DIEM, CL100-USDC/cbHYPE, CL200-O/USDC | 27.8 | 42.2% | 21.2% | 0.0001 | 0.006 | 6 | 0.42 | 0.7063 | 1.000 | thin
| 7251 | 1,052 | CL100-WETH/B3, CL200-WETH/VVV | 9.3 | 41.8% | 19.3% | 0.0007 | 0.015 | 0 |  |  |  | thin

## Largest strategies

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10495 | 143,276,232 | vAMM-AERO/USDC, CL200-AERO/WETH, CL200-AERO/USDC, CL10-USDC/MSFTc | 26.0 | 14.2% | 19.8% | 0.0120 | 0.079 | 4 | 0.63 | 0.1678 | 0.798 | thin
| 10426 | 106,692,444 | vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC | 26.0 | 18.3% | 19.8% | 5.0e-5 | 0.004 | 2 | 0.43 | 0.6244 | 0.999 | thin
| 10504 | 71,138,593 | vAMM-AERO/USDC, CL10-USDC/METAc, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 26.0 | 12.0% | 19.9% | 0.8302 | 0.866 | 3 | 0.40 | 0.7333 | 1.000 | thin
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.8% | 22.2% | 0.0001 | 0.006 | 7 | 0.80 | 0.0150 | 0.402 | thin
| 10522 | 36,000,001 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 26.0 | 21.2% | 19.9% | 0.0005 | 0.012 | 0 |  |  |  | thin
| 621 | 18,287,265 | vAMM-AERO/USDC, vAMM-WETH/VVV, CL10-WETH/cbBTC, CL100-USDC/cbBTC | 27.9 | 20.0% | 21.4% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 20365 | 13,345,773 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.9% | 22.2% | 0.0099 | 0.073 | 7 | 0.71 | 0.0799 | 0.652 |
| 1103 | 11,442,128 | vAMM-AERO/fBOMB, CL100-WETH/VVV, CL10-USDC/METAc, CL1-WETH/cbBTC | 27.8 | 24.8% | 21.1% | 0.0044 | 0.043 | 4 | 0.61 | 0.2268 | 0.843 | thin
| 19741 | 11,406,304 | CL50-WETH/USDC, CL1-WETH/cbBTC, CL200-WETH/DRV, CL10-cbETH/cbBTC | 7.9 | 31.3% | 24.9% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 18791 | 9,232,536 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC, CL200-AERO/WETH | 21.3 | 23.1% | 21.2% | 5.0e-5 | 0.004 | 8 | 0.64 | 0.1538 | 0.776 |
| 8305 | 9,131,028 | CL10-WETH/cbBTC, CL50-WETH/USDC, CL200-AERO/WETH, CL100-WETH/VVV | 27.3 | 21.5% | 20.7% | 0.0009 | 0.017 | 6 | 0.60 | 0.2028 | 0.835 | thin
| 16765 | 7,713,287 | CL50-USDC/cbBTC, CL200-AERO/cbBTC, CL10-USDC/AMZNc, CL200-WETH/AAVE | 25.0 | 25.1% | 20.2% | 0.1139 | 0.308 | 0 |  |  |  |
| 12469 | 5,766,071 | CL100-WETH/VVV | 26.5 | 20.7% | 20.2% | 0.0909 | 0.273 | 0 |  |  |  |
| 1359 | 5,471,711 | vAMM-AERO/USDC, CL100-USDC/cbBTC, CL50-USDC/cbBTC, CL200-AERO/USDC | 15.2 | 18.0% | 19.3% | 0.2488 | 0.463 | 0 |  |  |  |
| 17968, 17969, 17970 +1 | 5,390,075 | vAMM-AERO/USDC, CL10-WETH/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 23.4 | 21.0% | 20.7% | 0.1798 | 0.389 | 0 |  |  |  |

## Strongest selection evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20157, 20158 | 1,920 | CL100-XSGD/WETH, CL10-USDC/TTWOc, CL100-TOWNS/WETH, vAMM-WETH/EDEL | 7.0 | 230218.5% | 25.3% | 5.0e-5 | 0.004 | 1 | 0.31 | 0.7033 | 1.000 | thin
| 3430 | 234 | CL50-WETH/RSC, vAMM-cbBTC/EDGE, sAMM-DOLA/USDC, CL50-VFY/ZEN | 27.8 | 917.7% | 21.1% | 5.0e-5 | 0.004 | 7 | 0.13 | 1.0000 | 1.000 | thin
| 2751 | 1,234 | vAMM-USDC/NOCK, CL100-RSGP/USDC | 10.2 | 1405.3% | 19.8% | 5.0e-5 | 0.004 | 1 | 0.65 | 0.3407 | 0.922 | thin
| 7093 | 4,565 | CL200-wtCOIN/USDC | 27.4 | 886.0% | 20.8% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 11795 | 431 | CL100-ZORA/WETH | 8.4 | 695.6% | 17.9% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 4611 | 1,152 | vAMM-AERO/WETH, CL1-WETH/cbBTC, CL10-USDC/NVDAc, CL10-USDC/GOOGLc | 8.5 | 285.0% | 17.3% | 5.0e-5 | 0.004 | 1 | 0.06 | 0.9281 | 1.000 | thin
| 12494 | 446 | CL10-USDC/ORCLc, CL100-RSGP/USDC | 7.0 | 371.4% | 17.2% | 5.0e-5 | 0.004 | 1 | 0.97 | 0.0410 | 0.552 | thin
| 1469 | 1,297 | vAMM-WETH/FAI, CL50-WETH/FAI, vAMM-VIRTUAL/DEUS, CL10-USDC/MAG7 | 7.8 | 301.1% | 21.2% | 5.0e-5 | 0.004 | 1 | 0.97 | 0.0609 | 0.609 | thin
| 9697 | 129 | CL10-USDC/MUSD, vAMM-VVV/DIEM, vAMM-cbBTC/EDGE, CL50-VFY/ZEN | 27.0 | 156.6% | 20.4% | 5.0e-5 | 0.004 | 6 | 0.19 | 0.9960 | 1.000 | thin
| 932 | 379 | vAMM-AERO/USDC, vAMM-weETH/WETH, CL10-USDC/NVDAc, CL200-WETH/AAVE | 10.0 | 128.9% | 20.2% | 5.0e-5 | 0.004 | 2 | 0.71 | 0.1778 | 0.811 | thin
| 1860 | 693 | vAMM-WETH/cbBTC, vAMM-WETH/wstETH, vAMM-cbBTC/EDGE, vAMM-WETH/FLOCK | 13.6 | 111.3% | 19.5% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 5735 | 106 | CL200-USDC/Basecat, CL200-USDC/FOLKS, CL100-RSGP/USDC, CL50-WETH/WOO | 27.4 | 130.8% | 20.8% | 5.0e-5 | 0.004 | 8 | 0.75 | 0.0160 | 0.411 | thin
| 751 | 5,992 | CL50-EURC/USDC, CL1-USDC/PROS, CL100-WETH/B3, CL10-USDC/LMTS | 21.6 | 139.5% | 18.9% | 5.0e-5 | 0.004 | 3 | 0.65 | 0.2258 | 0.843 | thin
| 6288 | 816 | vAMM-WETH/wstETH, vAMM-VIRTUAL/cbBTC, CL1-WETH/wstETH, CL100-WETH/REI | 6.0 | 205.0% | 22.3% | 5.0e-5 | 0.004 | 0 |  |  |  | thin
| 1930 | 514 | sAMM-BD/USDC, vAMM-WETH/VVV, CL100-RSGP/USDC | 27.3 | 127.1% | 20.7% | 5.0e-5 | 0.004 | 3 | 0.55 | 0.3956 | 0.932 | thin

## Strongest timing evidence

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1063 | 10,604 | CL50-WETH/USDC, CL100-RSGP/USDC, CL50-HYPE/WETH, CL1-USDC/KNTQ | 27.8 | 22.4% | 21.2% | 0.3986 | 0.595 | 4 | 0.98 | 5.0e-5 | 0.033 |
| 1080 | 3,419 | CL200-AERO/WETH, CL10-USDC/MUc, CL100-RSGP/USDC, CL50-msUSD/USDC | 27.8 | 24.5% | 21.2% | 0.0969 | 0.284 | 7 | 0.93 | 5.0e-5 | 0.033 |
| 2133 | 3,001 | CL10-USDC/MSFTc, sAMM-WETH/msETH, CL100-RSGP/USDC, CL1-cbETH/WETH | 12.4 | 22.9% | 18.8% | 0.1229 | 0.321 | 3 | 1.00 | 5.0e-5 | 0.033 |
| 3942 | 17,046 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 27.7 | 26.0% | 21.0% | 0.0749 | 0.245 | 3 | 0.98 | 5.0e-5 | 0.033 |
| 1628, 5397, 5425 | 9,985 | CL200-XDP/USDC, CL10-USDC/SNDKc, CL100-RSGP/USDC | 27.6 | 26.0% | 21.0% | 0.0789 | 0.253 | 3 | 0.98 | 5.0e-5 | 0.033 |
| 9833 | 4,907 | CL200-AERO/cbBTC, vAMM-AERO/WETH, CL100-TOWNS/WETH, CL1-WBTC/cbBTC | 27.0 | 23.2% | 20.4% | 0.1978 | 0.407 | 6 | 0.95 | 5.0e-5 | 0.033 |
| 8394 | 5,132 | vAMM-AERO/USDC, CL10-USDC/MUSD, sAMM-WETH/msETH, CL10-USDC/MXNB | 27.0 | 18.6% | 20.4% | 0.6374 | 0.747 | 4 | 0.96 | 5.0e-5 | 0.033 |
| 4182 | 3,928 | CL10-USDC/MSFTc, CL50-msUSD/USDC, CL200-USDC/BLUECHIP, vAMM-WETH/TLOS | 27.0 | 29.2% | 20.4% | 0.0038 | 0.040 | 5 | 0.93 | 5.0e-5 | 0.033 |
| 2510 | 197,798 | CL10-USDC/MSTRc, CL50-USDC/cbBTC, CL10-USDC/SNDKc, CL1-USDC/KNTQ | 20.8 | 21.9% | 21.0% | 0.2667 | 0.480 | 6 | 0.93 | 5.0e-5 | 0.033 |
| 22761 | 10,011 | CL10-USDC/MSTRc, CL10-SOL/WETH, CL50-USDC/VVV, CL10-USDC/SNDKc | 13.0 | 30.2% | 22.6% | 0.0076 | 0.060 | 4 | 0.98 | 5.0e-5 | 0.033 |
| 1969 | 9,671 | CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-USDC/GOOGLc, CL1-USDC/KNTQ | 22.6 | 20.2% | 19.8% | 0.4306 | 0.616 | 3 | 0.98 | 0.0001 | 0.084 |
| 1960 | 23,108 | CL200-AERO/WETH, CL50-USDC/cbBTC, CL100-RSGP/USDC | 9.4 | 19.7% | 19.8% | 0.5085 | 0.670 | 2 | 0.99 | 0.0001 | 0.084 |
| 1277, 2272 | 731 | vAMM-AERO/USDC, CL10-USDC/MSTRc, CL100-RSGP/USDC, CL10-WETH/cbBTC | 27.8 | 18.6% | 21.1% | 0.7113 | 0.784 | 3 | 0.99 | 0.0002 | 0.088 |
| 1254 | 3,264 | CL10-USDC/SPCXc, CL100-RSGP/USDC, CL100-USDC/INFI | 27.6 | 25.6% | 21.0% | 0.1059 | 0.296 | 3 | 0.97 | 0.0002 | 0.088 |
| 11311 | 372,606 | CL100-WETH/VVV, CL10-USDC/AMZNc, CL10-USDC/MSTRc | 27.0 | 27.1% | 20.4% | 0.0130 | 0.082 | 2 | 0.99 | 0.0002 | 0.088 |

## Aero Autopilot USDC Maxi (stake 20366)

| Stakes | sAERO | Pools | Days in pools | APR | Average APR then | Selection p | q | Moves | Timing rank | p | q |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20366 | 53,132,371 | CL10-WETH/cbBTC, CL100-USDC/cbBTC, CL50-WETH/USDC, CL100-WETH/USDC | 17.2 | 22.8% | 22.2% | 0.0001 | 0.006 | 7 | 0.80 | 0.0150 | 0.402 | thin

"thin" marks a strategy that held more than 25% of a pool's power at some point. Placebos pay the same dilution, but such pools are rarely drawn.
