#!/usr/bin/env python3
"""
Design-kept PDF translation (beta). Keeps every page's artwork and swaps only the text: the
source text is removed by redaction (text only — images and vector art untouched) and the
translation is drawn back on the original baselines, in the original colors, in a substitute
font, shrunk to fit. Proven on spike 7 (spikes/07-inplace-pdf.py has the verdict and the cases).

  pdf_layout.py extract <in.pdf> <out_dir>
      → out_dir/units.json (layout) + out_dir/segments.json ({id: source text}, sent to wxrks)
  pdf_layout.py rebuild <in.pdf> <units.json> <translated.json> <out_dir>
      → out_dir/design.pdf (live text) + out_dir/images.pdf (one picture per page)
  pdf_layout.py preview <in.pdf> <out.jpg>
      → page 1 as a JPEG, PREVIEW_WIDTH px wide (the free tier shows it before the email step)
  pdf_layout.py excerpt <in.pdf> <out.pdf> <max_words>
      → page 1 alone as a PDF, when it has at most max_words words (a free document over the
        limit gets it translated as a preview); prints {"pages", "words", "total_pages"}
  pdf_layout.py ocr <in.pdf> <out.pdf> <languages>
      → reads the text off scanned pages (pictures of pages) with Tesseract, built into PyMuPDF,
        and lays it invisibly over each page's own picture, so a converter can read it. Writes
        out.pdf only when it read something; prints {"scanned", "pages", "words", "reason"}.
        languages: Tesseract codes joined by "+" ("por+eng"); the first one must be installed.

Exit codes: 0 ok · 3 a translation needs characters the bundled fonts lack (non-Latin script)
· 4 too many pages (LAYOUT_MAX_PAGES) · 5 a scan: its text is an OCR layer over pictures, so a
design-kept PDF would draw over words still in the picture · anything else is a crash.

PyMuPDF is AGPL-3.0, which is why this repository is AGPL-3.0 too.
"""
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

FONTS = Path(__file__).parent / "fonts"
MAX_PAGES = int(os.environ.get("LAYOUT_MAX_PAGES", "100"))
MIN_SCALE = 0.7
PREVIEW_WIDTH = 720

# A PDF embeds only the glyphs its source text used (no ã/ç/é for an English source), so every
# font is replaced by a full one: by family where we bundle it, otherwise by look — condensed,
# serif or sans, and weight — read from the font name and span flags.
EXACT = {
    "montserrat": {"regular": "Montserrat-Regular.ttf"},
    "pressstart2p": {"regular": "PressStart2P-Regular.ttf"},
    "coveredbyyourgrace": {"regular": "CoveredByYourGrace.ttf"},
}
FAMILIES = {
    "condensed": {w: f"BarlowCondensed-{n}.ttf" for w, n in
                  [("light", "Light"), ("regular", "Regular"), ("bold", "Bold"), ("extrabold", "ExtraBold"), ("black", "Black")]},
    "sans": {w: f"Barlow-{n}.ttf" for w, n in
             [("light", "Light"), ("regular", "Regular"), ("bold", "Bold"), ("extrabold", "ExtraBold"), ("black", "Black"),
              ("italic", "Italic"), ("bolditalic", "BoldItalic")]},
    "serif": {"regular": "PTSerif-Regular.ttf", "bold": "PTSerif-Bold.ttf", "italic": "PTSerif-Italic.ttf", "bolditalic": "PTSerif-BoldItalic.ttf"},
}
SERIF_HINTS = r"serif|times|georgia|garamond|minion|caslon|baskerville|cambria|palatino|bookman|century|didot|bodoni"

# Symbols the bundled fonts may lack get a plain stand-in, so one arrow doesn't cost the whole PDF
# (live, 2026-11-03: "English (US) → Spanish (US)" in the Context Sensitivity paper). Missing
# letters are different: they mean the target script isn't covered at all.
SYMBOL_STAND_INS = {
    "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇐": "<=", "⇔": "<=>", "↑": "^", "↓": "v",
    "✓": "v", "✔": "v", "✗": "x", "✘": "x", "★": "*", "☆": "*", "●": "•", "▪": "•", "■": "•",
    "◦": "·", "□": "·", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "×": "x", "÷": "/", "−": "-",
    "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "•": "·",
}


class Unsupported(Exception):
    pass


class Scanned(Exception):
    pass


# Tesseract language models (tessdata_fast). The Docker image puts them in TESSDATA_PREFIX.
TESSDATA_DIRS = [os.environ.get("TESSDATA_PREFIX"), "/opt/tessdata", "/usr/share/tesseract-ocr/5/tessdata", "/opt/homebrew/share/tessdata"]
OCR_DPI = 300
# Invisible text that OCR tools lay over a scan (Tesseract, OCRmyPDF): it marks a scanned page.
OCR_FONTS = ("GlyphLessFont",)


def base_font(name):
    return name.split("+", 1)[-1]


def pick_font(name, flags):
    n = base_font(name).lower().replace(" ", "")
    italic = bool(flags & 2) or "italic" in n or "oblique" in n
    axis = re.search(r"wght([0-9a-f]{3})0000", n)  # variable-font instance, weight in hex (2bc = 700)
    if axis:
        w = int(axis.group(1), 16)
        weight = "black" if w >= 850 else "extrabold" if w >= 750 else "bold" if w >= 600 else "light" if w <= 300 else "regular"
    elif re.search(r"black|heavy|ultra", n):
        weight = "black"
    elif re.search(r"extrabold|xbold|dark", n):
        weight = "extrabold"
    elif flags & 16 or re.search(r"bold|semibold|demi", n):
        weight = "bold"
    elif re.search(r"light|thin|hairline", n):
        weight = "light"
    else:
        weight = "regular"
    for key, files in EXACT.items():
        if key in n and weight in files and not italic:
            return files[weight]
    if re.search(r"cond|narrow|compress|compact", n):
        return FAMILIES["condensed"][weight]
    family = "serif" if (flags & 4 or re.search(SERIF_HINTS, n)) else "sans"
    files = FAMILIES[family]
    if italic:
        return files["bolditalic" if weight in ("bold", "extrabold", "black") else "italic"]
    if weight not in files:
        weight = "bold" if weight in ("extrabold", "black") else "regular"
    return files[weight]


def worth_translating(text):
    return re.search(r"[^\W\d_]{2,}", text) is not None


def overlap(a, b):
    ra, rb = pymupdf.Rect(a), pymupdf.Rect(b)
    inter = ra & rb
    if inter.is_empty:
        return 0.0
    return inter.get_area() / min(ra.get_area(), rb.get_area())


# --- extract ---


def color_gap(a, b):
    return max(abs(((a >> s) & 255) - ((b >> s) & 255)) for s in (16, 8, 0))


def distinct(a, b):
    """Spans that read as separate elements: very different sizes ("across" + "31") or a clearly
    different color (red "AI" + white "was the cure for all"). A bold phrase inside a paragraph
    stays inline, even when it's a shade darker (#252a31 in #3d434b body text)."""
    sizes = sorted([a["size"], b["size"]])
    return sizes[1] / sizes[0] > 1.25 or color_gap(a["color"], b["color"]) > 64


def font_names(page):
    """Browser-made PDFs (Chrome/Skia) set all text in Type3 fonts that spans report only as
    "Type3 (10 0 R)"; the real name ("SourceSerif4Roman-Regular_wght2BC0000…") is in the font
    descriptor, and it's what tells serif from sans and bold from regular."""
    doc, names = page.parent, {}
    for f in page.get_fonts():
        if f[2] != "Type3":
            continue
        fd = doc.xref_get_key(f[0], "FontDescriptor")
        if fd[0] == "xref":
            fn = doc.xref_get_key(int(fd[1].split()[0]), "FontName")
            if fn[0] == "name":
                names[f"Type3 ({f[0]} 0 R)"] = fn[1].lstrip("/")
    return names


def join_spans(run):
    # Spans are often placed without a space character between them ("AI" + "was").
    text = run[0]["text"]
    for prev, s in zip(run, run[1:]):
        gap = s["bbox"][0] - prev["bbox"][2]
        if gap > s["size"] * 0.12 and not text.endswith(" ") and not s["text"].startswith(" "):
            text += " "
        text += s["text"]
    return text.strip()


def page_lines(page):
    out = []
    real = font_names(page)
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            spans = [s for s in l["spans"] if s["text"].strip()]
            for s in spans:
                s["font"] = real.get(s["font"], s["font"])
            if not spans or tuple(round(v, 3) for v in l["dir"]) != (1.0, 0.0):
                continue  # rotated text is left alone
            runs = [[spans[0]]]
            for s in spans[1:]:
                if distinct(runs[-1][-1], s):
                    runs.append([s])
                else:
                    runs[-1].append(s)
            for run in runs:
                dom = max(run, key=lambda s: len(s["text"].strip()))
                out.append({
                    "text": join_spans(run),
                    "x0": min(s["bbox"][0] for s in run),
                    "x1": max(s["bbox"][2] for s in run),
                    "baseline": dom["origin"][1],
                    "bbox": list(pymupdf.Rect(run[0]["bbox"]).include_rect(run[-1]["bbox"])),
                    "font": base_font(dom["font"]),
                    "flags": dom["flags"],
                    "fonts": sorted({base_font(s["font"]) for s in run}),
                    "size": round(dom["size"], 2),
                    "color": dom["color"],
                })
    # Outlined lettering is often drawn twice (font text + Type3 outline): keep one, erase both.
    for i, a in enumerate(out):
        for c in out[i + 1:]:
            if a["text"] == c["text"] and overlap(a["bbox"], c["bbox"]) > 0.5:
                keep, drop = (c, a) if a["font"].startswith("Type3") else (a, c)
                drop["duplicate_of"] = keep
    return out


def extract(pdf, out_dir):
    doc = pymupdf.open(pdf)
    if len(doc) > MAX_PAGES:
        print(f"{len(doc)} pages > LAYOUT_MAX_PAGES={MAX_PAGES}", file=sys.stderr)
        sys.exit(4)
    if any(base_font(f[3]).startswith(OCR_FONTS) for page in doc for f in page.get_fonts(full=True)):
        raise Scanned("the text is an OCR layer over scanned pages")
    units = []
    for pno, page in enumerate(doc):
        lines = page_lines(page)
        groups = []
        # A line joins the group stacked right above it when size and color match and they share
        # a font — a paragraph survives a bold phrase, but a line set wholly in another font
        # (a short label under a heading) starts its own unit.
        for ln in sorted((l for l in lines if "duplicate_of" not in l), key=lambda l: l["baseline"]):
            home = None
            for g in groups:
                last = g["lines"][-1]
                # Body text (≤16pt) runs up to ~1.7× line spacing (the Context Sensitivity paper);
                # display type at that spacing is a list (the deck's checklist), not a paragraph.
                reach = 2.0 if ln["size"] <= 16 else 1.6
                stacked = 0 < ln["baseline"] - last["baseline"] < ln["size"] * reach
                x_overlap = min(ln["x1"], last["x1"]) - max(ln["x0"], last["x0"]) > 0
                same_style = abs(g["size"] - ln["size"]) < 0.5 and color_gap(g["color"], ln["color"]) <= 64
                if stacked and x_overlap and same_style and set(ln["fonts"]) & g["fonts"]:
                    home = g
                    break
            if home:
                home["lines"].append(ln)
                home["fonts"] |= set(ln["fonts"])
            else:
                groups.append({"size": ln["size"], "color": ln["color"], "fonts": set(ln["fonts"]), "lines": [ln]})
        for g in groups:
            # drawn in the font and color that carry most of the paragraph's characters
            weight, tint = {}, {}
            for ln in g["lines"]:
                weight[(ln["font"], ln["flags"])] = weight.get((ln["font"], ln["flags"]), 0) + len(ln["text"])
                tint[ln["color"]] = tint.get(ln["color"], 0) + len(ln["text"])
            g["font"], g["flags"] = max(weight, key=weight.get)
            g["color"] = max(tint, key=tint.get)
        groups.sort(key=lambda g: (round(g["lines"][0]["baseline"] / 20), g["lines"][0]["x0"]))
        for k, g in enumerate(groups, 1):
            text = ""
            for ln in g["lines"]:
                if text.endswith("-") and ln["text"][:1].islower():
                    text += ln["text"]
                else:
                    text = f"{text} {ln['text']}".strip()
            dups = [d for d in lines if d.get("duplicate_of") in g["lines"]]
            units.append({
                "id": f"p{pno + 1:03d}_u{k:03d}",
                "page": pno,
                "text": re.sub(r"\s+", " ", text),
                "translate": worth_translating(text),
                "font": g["font"], "flags": g["flags"], "size": g["size"], "color": g["color"],
                "lines": [{k2: ln[k2] for k2 in ("text", "x0", "x1", "baseline", "bbox", "size")} for ln in g["lines"]],
                "redact_extra": [d["bbox"] for d in dups],
            })
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "units.json").write_text(json.dumps({"units": units}))
    segments = {u["id"]: u["text"] for u in units if u["translate"]}
    (out / "segments.json").write_text(json.dumps(segments, ensure_ascii=False, indent=1))
    print(json.dumps({"pages": len(doc), "units": len(units), "segments": len(segments),
                      "words": sum(len(t.split()) for t in segments.values())}))


# --- rebuild ---


def unit_rect(u):
    return pymupdf.Rect(
        min(l["x0"] for l in u["lines"]), u["lines"][0]["baseline"] - u["size"] * 0.75,
        max(l["x1"] for l in u["lines"]), u["lines"][-1]["baseline"] + u["size"] * 0.2,
    )


def obstacles(page, units, pno):
    """What translated text must not grow into: other text, and images/vector shapes that are
    not page backgrounds."""
    area = page.rect.get_area()
    obs = [unit_rect(u) for u in units if u["page"] == pno]
    obs += [pymupdf.Rect(i["bbox"]) for i in page.get_image_info() if pymupdf.Rect(i["bbox"]).get_area() < area * 0.5]
    obs += [d["rect"] for d in page.get_drawings() if d["rect"].get_area() < area * 0.3]
    return obs


def alignment(u, page_w, page_units):
    ls = u["lines"]
    if len(ls) == 1:
        # A single line that shares an edge with other text is part of a column.
        others = [o for o in page_units if o is not u]
        if any(abs(o["lines"][0]["x0"] - ls[0]["x0"]) < 4 for o in others):
            return "left"
        if any(abs(max(l["x1"] for l in o["lines"]) - ls[0]["x1"]) < 4 for o in others):
            return "right"
        cx = (ls[0]["x0"] + ls[0]["x1"]) / 2
        if abs(cx - page_w / 2) < page_w * 0.03:
            return "center"
        if ls[0]["x1"] > page_w * 0.8 and ls[0]["x0"] > page_w * 0.45:
            return "right"
        return "left"
    spread = lambda vals: max(vals) - min(vals)
    left = spread([l["x0"] for l in ls])
    right = spread([l["x1"] for l in ls])
    center = spread([(l["x0"] + l["x1"]) / 2 for l in ls])
    best = min(left, right, center)
    return "left" if best == left else "right" if best == right else "center"


def container(u, obs):
    """The smallest shape the unit sits inside (a circle behind "consumers"), if any."""
    r = unit_rect(u)
    inside = [o for o in obs if o.contains(r) and o != r]
    return min(inside, key=lambda o: o.get_area()) if inside else None


def room(u, align, obs, page_w):
    """Width each original line may use: grow into free space beside that line, up to 40% wider
    and inside a 4% page margin, stopping at anything not behind the text, and inside the shape
    that contains the text, if any."""
    box = container(u, obs)
    lo, hi = page_w * 0.04, page_w * 0.96
    if box:
        inset = box.width * 0.12
        lo, hi = max(lo, box.x0 + inset), min(hi, box.x1 - inset)
    paragraph = len(u["lines"]) >= 3
    px0, px1 = min(l["x0"] for l in u["lines"]), max(l["x1"] for l in u["lines"])
    widths = []
    for l in u["lines"]:
        r = pymupdf.Rect(l["x0"], l["baseline"] - l["size"] * 0.75, l["x1"], l["baseline"] + l["size"] * 0.2)
        behind = lambda o: (o & r).get_area() > r.get_area() * 0.6
        band = [o for o in obs if o.y1 > r.y0 and o.y0 < r.y1 and not behind(o)]
        free_r = min([o.x0 for o in band if o.x0 >= r.x1 - 2] + [hi]) - 6
        free_l = max([o.x1 for o in band if o.x1 <= r.x0 + 2] + [lo]) + 6
        if paragraph:
            # A reflowed paragraph's lines don't map to the original ones (its short last line
            # says nothing about the new last line): measure every line from the paragraph's
            # edges, widen at most 15% (it grows downward first, see lines_below).
            cap = (px1 - px0) * 0.15
            right_edge, left_edge = min(free_r, px1 + cap), max(free_l, px0 - cap)
            widths.append(right_edge - px0 if align == "left" else px1 - left_edge if align == "right"
                          else (px1 - px0) + 2 * max(0, min(right_edge - px1, px0 - left_edge)))
            continue
        cap = r.width * 0.4
        grow_r, grow_l = max(0, min(cap, free_r - r.x1)), max(0, min(cap, r.x0 - free_l))
        widths.append(r.width + (grow_r if align == "left" else grow_l if align == "right" else 2 * min(grow_r, grow_l)))
    if paragraph:
        widths = [min(widths)]  # the tightest line's room is the column's
    if box:
        widths = [min(w, hi - lo) for w in widths]
    return widths


def wrap_widths(font, text, size, widths):
    lines, cur = [], ""
    for w in text.split():
        width = widths[min(len(lines), len(widths) - 1)]
        trial = f"{cur} {w}".strip()
        if cur and font.text_length(trial, size) > width:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def balanced(font, text, size, widths, lines):
    if len(lines) < 2:
        return lines
    total = font.text_length(text, size)
    longest = max(font.text_length(w, size) for w in text.split())
    even = wrap_widths(font, text, size, [min(w, max(longest, total / len(lines) * 1.06)) for w in widths])
    return even if len(even) == len(lines) else lines


def lines_below(u, obs):
    """Extra lines a paragraph can take in the free space under it, before the next thing in its
    column (at least one, at most doubling it)."""
    n = len(u["lines"])
    if n < 3:
        return 0
    r = unit_rect(u)
    base = [l["baseline"] for l in u["lines"]]
    pitch = (base[-1] - base[0]) / (n - 1)
    below = [o.y0 for o in obs if o.y0 >= r.y1 - 1 and o.x1 > r.x0 and o.x0 < r.x1]
    free = (min(below) if below else r.y1 + pitch * n) - r.y1 - u["size"] * 0.3
    return max(1, min(n, int(free // pitch)))


def layout(font, text, u, widths, extra=0):
    """Biggest size (original down to the floor) at which the translation fits the per-line
    widths in the original line count, plus the `extra` lines a paragraph has room for below."""
    n = len(u["lines"])
    max_lines = n + extra
    floor = 0.6 if n == 1 else MIN_SCALE
    scale = 1.0
    while scale >= floor - 1e-9:
        size = u["size"] * scale
        lines = wrap_widths(font, text, size, widths)
        fits = all(font.text_length(l, size) <= widths[min(i, len(widths) - 1)] for i, l in enumerate(lines))
        if len(lines) <= max_lines and fits:
            return balanced(font, text, size, widths, lines), size
        scale -= 0.02
    size = u["size"] * floor
    return balanced(font, text, size, widths, wrap_widths(font, text, size, widths)), size


def sibling_key(u, align):
    """Units that started identical in style and edge (checklist items) end identical in size."""
    edge = round(u["lines"][0]["x0"] / 6) if align == "left" else round(max(l["x1"] for l in u["lines"]) / 6) if align == "right" else None
    return (u["page"], u["font"], u["size"], u["color"], align, edge)


def rebuild(pdf, units_path, translated_path, out_dir):
    units = json.loads(Path(units_path).read_text())["units"]
    translated = json.loads(Path(translated_path).read_text())
    fonts = {}

    def load(fname):
        if fname not in fonts:
            fonts[fname] = pymupdf.Font(fontfile=str(FONTS / fname))
        return fonts[fname]

    def covers(f, s):
        return all(f.has_glyph(ord(c)) for c in s if not c.isspace())

    def font_for(u, text):
        """(font file, font, text to draw), or None when the unit can't be drawn. Prefers the
        matched font, then plain sans and serif. Otherwise symbols get stand-ins and a few stray
        uncovered letters are dropped ("Faça o 申博" — a translation glitch — draws "Faça o");
        a unit mostly in an uncovered script is None."""
        fname = pick_font(u["font"], u.get("flags", 0))
        for candidate in (fname, FAMILIES["sans"]["regular"], FAMILIES["serif"]["regular"]):
            if covers(load(candidate), text):
                return candidate, load(candidate), text
        f = load(fname)
        missing = {c for c in text if not c.isspace() and not f.has_glyph(ord(c))}
        letters = [c for c in text if unicodedata.category(c)[0] in "LM"]
        lost = [c for c in letters if c in missing]
        if letters and len(lost) / len(letters) > 0.2:
            return None
        stand_in = lambda c: c if c not in missing else (SYMBOL_STAND_INS.get(c, "") if covers(f, SYMBOL_STAND_INS.get(c, "")) else "")
        return fname, f, "".join(stand_in(c) for c in text)

    # A target script the fonts don't cover shows up as most units undrawable: refuse the PDF
    # (the DOCX still delivers). A handful of undrawable units just keep their source text.
    wanted = [u for u in units if u["translate"] and translated.get(u["id"])]
    drawable = {}
    for u in wanted:
        got = font_for(u, re.sub(r"\s+", " ", translated[u["id"]]).strip())
        if got and got[2].strip():
            drawable[u["id"]] = got
    if wanted and len(drawable) < len(wanted) * 0.8:
        raise Unsupported(f"the bundled fonts cover only {len(drawable)} of {len(wanted)} translated units")

    doc = pymupdf.open(pdf)
    for pno, page in enumerate(doc):
        page_w = page.rect.width
        todo = [u for u in wanted if u["page"] == pno and u["id"] in drawable]
        if not todo:
            continue
        page_units = [u for u in units if u["page"] == pno]
        obs = obstacles(page, units, pno)
        plans = []
        for u in todo:
            fname, font, text = drawable[u["id"]]
            own = [o for o in obs if o != unit_rect(u)]
            align = alignment(u, page_w, page_units)
            box = container(u, own)
            r = unit_rect(u)
            if box and len(u["lines"]) == 1 and abs(r.x0 + r.width / 2 - (box.x0 + box.width / 2)) < box.width * 0.08:
                align = "center"  # a single line centered in its shape stays centered
            widths = room(u, align, own, page_w)
            lines, size = layout(font, text, u, widths, lines_below(u, own))
            plans.append({"u": u, "fname": fname, "font": font, "text": text, "align": align, "widths": widths, "lines": lines, "size": size})
        scale_of = {}
        for p in plans:
            k = sibling_key(p["u"], p["align"])
            scale_of[k] = min(scale_of.get(k, 1.0), p["size"] / p["u"]["size"])
        for p in plans:
            target = p["u"]["size"] * scale_of[sibling_key(p["u"], p["align"])]
            if target < p["size"] - 0.01:
                p["size"] = target
                p["lines"] = balanced(p["font"], p["text"], target, p["widths"], wrap_widths(p["font"], p["text"], target, p["widths"]))

        # A character is removed when its box touches a redaction rect, and display type has tall
        # boxes — redact a band 10% of the size tall just above each baseline (every glyph of the
        # line crosses it), or a big figure above a caption disappears with it.
        for p in plans:
            u = p["u"]
            for l in u["lines"]:
                page.add_redact_annot(pymupdf.Rect(l["x0"], l["baseline"] - l["size"] * 0.25, l["x1"], l["baseline"] - l["size"] * 0.15), fill=False)
            for rect in u["redact_extra"]:
                page.add_redact_annot(pymupdf.Rect(rect), fill=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)

        for p in plans:
            u, lines, size, font = p["u"], p["lines"], p["size"], p["font"]
            base = [l["baseline"] for l in u["lines"]]
            pitch = ((base[-1] - base[0]) / (len(base) - 1) if len(base) > 1 else u["size"] * 1.05) * size / u["size"]
            if len(u["lines"]) >= 3:  # a paragraph hangs from its first line and grows downward
                first = base[0] - (u["size"] - size) * 0.7
            else:  # display type stays centered on where it was
                first = (base[0] + base[-1]) / 2 - pitch * (len(lines) - 1) / 2
            left = min(l["x0"] for l in u["lines"])
            right = max(l["x1"] for l in u["lines"])
            center = sum((l["x0"] + l["x1"]) / 2 for l in u["lines"]) / len(u["lines"])
            c = u["color"]
            rgb = (((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)
            alias = re.sub(r"\W", "", Path(p["fname"]).stem)[:20]
            for i, line in enumerate(lines):
                w = font.text_length(line, size)
                x = left if p["align"] == "left" else right - w if p["align"] == "right" else center - w / 2
                page.insert_text((x, first + i * pitch), line, fontname=alias, fontfile=str(FONTS / p["fname"]), fontsize=size, color=rgb)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    doc.save(out / "design.pdf", garbage=3, deflate=True)
    img_doc = pymupdf.open()
    for page in doc:
        pix = page.get_pixmap(dpi=150)
        p = img_doc.new_page(width=page.rect.width, height=page.rect.height)
        p.insert_image(p.rect, stream=pix.tobytes("jpeg", jpg_quality=85))
    img_doc.save(out / "images.pdf", garbage=3, deflate=True)
    print(json.dumps({"pages": len(doc)}))


def preview(pdf, out_path):
    doc = pymupdf.open(pdf)
    page = doc[0]
    zoom = min(PREVIEW_WIDTH / page.rect.width, 3)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    Path(out_path).write_bytes(pix.tobytes("jpeg", jpg_quality=82))


def excerpt(pdf, out_path, max_words):
    doc = pymupdf.open(pdf)
    words = len(doc[0].get_text("words")) if len(doc) else 0
    pages = 1 if 0 < words <= max_words else 0
    if pages:
        out = pymupdf.open()
        out.insert_pdf(doc, from_page=0, to_page=0)
        out.save(out_path, garbage=3, deflate=True)
    print(json.dumps({"pages": pages, "words": words, "total_pages": len(doc)}))


def needs_ocr(page):
    """A scanned page: nothing to select, and a picture covering most of it."""
    if len(page.get_text("words")) >= 3:
        return False
    covered = sum(abs(pymupdf.Rect(i["bbox"]) & page.rect) for i in page.get_image_info())
    return covered >= abs(page.rect) * 0.5


def ocr(pdf, out_path, languages):
    doc = pymupdf.open(pdf)
    scanned = [i for i, page in enumerate(doc) if needs_ocr(page)]
    result = {"scanned": len(scanned), "pages": 0, "words": 0, "reason": None}
    data = next((d for d in TESSDATA_DIRS if d and Path(d, "eng.traineddata").exists()), None)
    wanted = [l for l in languages.split("+") if l]
    have = [l for l in wanted if data and Path(data, f"{l}.traineddata").exists()]
    # A text PDF with a few picture-only pages (a cover, a full-page figure) is not a scan: an
    # OCR layer there would cost it its design-kept PDF (extract refuses one) for little text.
    if not scanned or len(scanned) * 2 < len(doc):
        result["scanned"] = 0
        print(json.dumps(result))
        return
    if len(scanned) > MAX_PAGES:
        print(f"{len(doc)} pages > LAYOUT_MAX_PAGES={MAX_PAGES}", file=sys.stderr)
        sys.exit(4)
    if not data or not wanted or wanted[0] not in have:
        result["reason"] = "language" if data else "no_models"
        print(json.dumps(result))
        return
    # Tesseract reads a 300 dpi rendering; only its invisible text is kept (the rendering is
    # dropped), drawn over the page's own picture, so the file stays the size it was.
    for i in scanned:
        page = doc[i]
        pix = page.get_pixmap(dpi=OCR_DPI)
        pix.set_dpi(OCR_DPI, OCR_DPI)
        layer = pymupdf.open("pdf", pix.pdfocr_tobytes(compress=True, language="+".join(have), tessdata=data))
        for img in layer[0].get_images():
            layer[0].delete_image(img[0])
        page.show_pdf_page(page.rect, layer, 0, overlay=True)
        result["words"] += len(page.get_text("words"))
    result["pages"] = len(scanned)
    if result["words"]:
        doc.save(out_path, garbage=3, deflate=True)
    else:
        result["reason"] = "no_text"
    print(json.dumps(result))


if __name__ == "__main__":
    args = sys.argv[1:]
    try:
        if args[:1] == ["extract"] and len(args) == 3:
            extract(args[1], args[2])
        elif args[:1] == ["rebuild"] and len(args) == 5:
            rebuild(args[1], args[2], args[3], args[4])
        elif args[:1] == ["preview"] and len(args) == 3:
            preview(args[1], args[2])
        elif args[:1] == ["excerpt"] and len(args) == 4:
            excerpt(args[1], args[2], int(args[3]))
        elif args[:1] == ["ocr"] and len(args) == 4:
            ocr(args[1], args[2], args[3])
        else:
            sys.exit(__doc__)
    except Unsupported as e:
        print(str(e), file=sys.stderr)
        sys.exit(3)
    except Scanned as e:
        print(str(e), file=sys.stderr)
        sys.exit(5)
