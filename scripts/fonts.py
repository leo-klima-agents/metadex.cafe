# Makes the fonts in fonts/ from Google Fonts' sources, at a pinned commit: Latin subsets, as WOFF2, without hinting.
# Needs Python 3, with fonttools 4.67.0 and brotli 1.2.0. Run it from the repository's root: python3 scripts/fonts.py
# The same sources and versions give the same files.

import hashlib
import io
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
SOURCES = {
    "next": (
        "ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf",
        "5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745",
    ),
    "mono": (
        "ofl/atkinsonhyperlegiblemono/AtkinsonHyperlegibleMono%5Bwght%5D.ttf",
        "5ce8b1698d1ded7dff2178c1a3ad159470085a58ea239e8b2cb88f4fb4a6f646",
    ),
    "serif": (
        "ofl/youngserif/YoungSerif-Regular.ttf",
        "42bb2602364b28569fdce5eeb6ab3d81cf8090ba81b211f1229ed69f33155523",
    ),
}
# Each file: its source, and the weight to instantiate a variable source at.
FONTS = {
    "atkinson-hyperlegible-next-400.woff2": ("next", 400),
    "atkinson-hyperlegible-next-700.woff2": ("next", 700),
    "atkinson-hyperlegible-mono-400.woff2": ("mono", 400),
    "young-serif-400.woff2": ("serif", None),
}
# Latin, as Google Fonts subsets it, with the arrows and ≈ the page uses.
UNICODES = [
    *range(0x0000, 0x0100),
    0x0131,
    0x0152,
    0x0153,
    0x02BB,
    0x02BC,
    0x02C6,
    0x02DA,
    0x02DC,
    0x0304,
    0x0308,
    0x0329,
    *range(0x2000, 0x2070),
    0x20AC,
    0x2122,
    *range(0x2190, 0x219A),
    0x2212,
    0x2215,
    0x2248,
    0xFEFF,
    0xFFFD,
]
# The features the page relies on: figures that line up, the slashed zero, and fractions.
FEATURES = ["tnum", "pnum", "lnum", "onum", "zero", "case", "frac", "numr", "dnom", "sups"]


def source(name: str) -> bytes:
    path, digest = SOURCES[name]
    with urllib.request.urlopen(f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/{path}") as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"{path} does not match its hash")
    return data


def main() -> None:
    out = Path("fonts")
    out.mkdir(exist_ok=True)
    sources = {name: source(name) for name in SOURCES}
    for file, (name, weight) in FONTS.items():
        font = TTFont(io.BytesIO(sources[name]), recalcTimestamp=False)
        if weight is not None:
            font = instancer.instantiateVariableFont(font, {"wght": weight}, updateFontNames=True)
        options = subset.Options()
        options.layout_features += FEATURES
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        options.hinting = False
        options.recalc_timestamp = False
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=UNICODES)
        subsetter.subset(font)
        font.flavor = "woff2"
        font.save(out / file)
        print(f"{out / file}: {(out / file).stat().st_size} bytes")


if __name__ == "__main__":
    main()
