"""Split the Noto Sans KR variable font into unicode-range slices.

  python3 scripts/split-noto-font.py <NotoSansKR.woff2> public/fonts > /tmp/faces.css

Slice 1 (Latin, punctuation, jamo, the 2,350 KS X 1001 Hangul) covers almost all Korean text,
so a first visit downloads ~330KB instead of the full ~3.8MB font. Paste the printed @font-face
rules into public/document-fonts.css. Slice 1 is printed last: with overlapping ranges the last
rule is checked first. Source: git history of public/fonts/noto-sans-kr.woff2 (removed).
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

src, out = sys.argv[1], sys.argv[2]
cmap = TTFont(src).getBestCmap()
common = set()
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try:
            common.add(ord(bytes([hi, lo]).decode("euc-kr")))
        except UnicodeDecodeError:
            pass
common = {c for c in common if 0xAC00 <= c <= 0xD7A3}
# UI symbols too (→ ⌘ ① ▪ ◦ ✓), or one arrow would pull in the 700KB "other" slice.
basic = {c for c in cmap if c <= 0x24F or 0x2000 <= c <= 0x206F or 0x2190 <= c <= 0x21FF
         or 0x2300 <= c <= 0x23FF or 0x2460 <= c <= 0x24FF or 0x2500 <= c <= 0x27BF
         or 0x3000 <= c <= 0x303F or 0x3130 <= c <= 0x318F or 0xFF00 <= c <= 0xFFEF}
hangul = {c for c in cmap if 0xAC00 <= c <= 0xD7A3}
han = {c for c in cmap if 0x4E00 <= c <= 0x9FFF}
slices = {"1": basic | common, "2": hangul - common, "3": han}
slices["4"] = set(cmap) - set().union(*slices.values())
broad = {"2": "U+AC00-D7A3", "3": "U+4E00-9FFF"}  # slice 1 wins where they overlap


def ranges(cps):
    cps, parts, start = sorted(cps), [], None
    for i, c in enumerate(cps):
        start = c if start is None else start
        if i + 1 == len(cps) or cps[i + 1] != c + 1:
            parts.append(f"U+{start:X}" if start == c else f"U+{start:X}-{c:X}")
            start = None
    return ", ".join(parts)


for name in ("4", "3", "2", "1"):
    opts = subset.Options()
    opts.flavor, opts.layout_features, opts.name_IDs, opts.notdef_outline = "woff2", ["*"], ["*"], True
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=slices[name])
    sub.subset(font)
    path = os.path.join(out, f"noto-sans-kr-{name}.woff2")
    font.flavor = "woff2"
    font.save(path)
    print(f"slice {name}: {len(slices[name])} chars, {os.path.getsize(path) // 1024}KB", file=sys.stderr)
    print("@font-face {\n  font-family: 'Noto Sans KR';\n  font-style: normal;\n  font-weight: 100 900;\n"
          f"  font-display: swap;\n  src: url('/fonts/noto-sans-kr-{name}.woff2') format('woff2');\n"
          f"  unicode-range: {broad.get(name) or ranges(slices[name])};\n}}")
