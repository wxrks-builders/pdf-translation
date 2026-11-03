#!/usr/bin/env python3
# Spike 7 — translate a PDF in place: keep every page's artwork, swap only the text.
# The DOCX route (spike 6) rebuilds the page in Word and loses design: on the CCEP LocWorld deck
# every CCEP Rhythm Narrow headline came back in Calibri. Here the original page stays as-is; the
# English text is removed (redaction of text only — images and vector art untouched) and the
# translation is drawn back on the same baselines, in a substitute font, shrunk to fit.
#
#   python spikes/07-inplace-pdf.py extract <in.pdf> <workdir>   → units.json + segments.json
#   node   spikes/07-translate-json.js <workdir> pt_br             → translated.json (via wxrks)
#   python spikes/07-inplace-pdf.py rebuild <in.pdf> <workdir> <fontsdir>
#       → translated.pdf (live text), translated-images.pdf (page images), compare/pNN.png
#
# Needs PyMuPDF (pip install pymupdf). Fonts: the PDF only embeds the glyphs the source used
# (no ã/ç/é), so every font is replaced by a full one — FONT_MAP below.
#
# VERDICT (run 2026-11-03, CCEP LocWorld56 deck, 16 slides, en → pt-BR via wxrks in 21s):
#   - Works: every photo, gradient, shape and icon is untouched; the Portuguese sits on the
#     original baselines in the original colors; most slides read like the source. Live-text PDF
#     14.1 MB (source 13.9 MB); page-image variant 4.7 MB at 150 dpi.
#   - Redaction removes any character whose box touches the rect, and display type has tall boxes:
#     a line-box redaction of "employees" took the 180pt "41K" above it. A band 10% of the size
#     tall, just above the baseline (baseline −0.25…−0.15 em), removes the line and spares it.
#   - Subset fonts carry only the source's characters (the CCEP Rhythm files we hold map 66–73
#     codepoints, no ã/ç/é), so every font is substituted; Barlow Condensed stands in for CCEP
#     Rhythm Narrow — close, wider.
#   - Open problems: (1) phrases split across design elements translate piecewise — "the /
#     TRANSLATION / Portal" → "o TRADUÇÃO Portal", "across" → "por toda parte"; needs fragments
#     translated as one sentence and split back. (2) Inline bold is lost (paragraph drawn in its
#     main font); outlined lettering comes back solid. (3) Dense cards (slide 15) cramp and
#     overlap. (4) Text inside images (UI screenshots) stays English — no OCR. (5) Rows of two
#     units on one baseline ("We delivered" + "flexibility") are laid out independently.
#   - Licensing: PyMuPDF/MuPDF are AGPL — a public web service needs the source published or an
#     Artifex commercial license.
import json
import re
import sys
from pathlib import Path

import pymupdf

# PDF base font (subset prefix stripped) → (alias, substitute font file)
FONT_MAP = {
    "CCEPRhythm-NarrowDark": ("dark", "BarlowCondensed-ExtraBold.ttf"),
    "CCEPRhythm-NarrowLight": ("light", "BarlowCondensed-Light.ttf"),
    "Montserrat-Regular": ("mont", "Montserrat-Regular.ttf"),
    "PressStart2P-Regular": ("press", "PressStart2P-Regular.ttf"),
    "CoveredByYourGrace": ("grace", "CoveredByYourGrace.ttf"),
}
FALLBACK = ("mont", "Montserrat-Regular.ttf")
MIN_SCALE = 0.7


def base_font(name):
    return name.split("+", 1)[-1]


def worth_translating(text):
    return re.search(r"[A-Za-z]{2,}", text) is not None


def overlap(a, b):
    ra, rb = pymupdf.Rect(a), pymupdf.Rect(b)
    inter = ra & rb
    if inter.is_empty:
        return 0.0
    return inter.get_area() / min(ra.get_area(), rb.get_area())


def distinct(a, b):
    """Spans that read as separate elements: very different sizes ("across" + "31"), or a
    different color (red "AI" before white "was the cure for all"; white "Simple when possible."
    before red "Professional when it matters."). A bold phrase in a paragraph (font changes,
    color doesn't) stays inline."""
    sizes = sorted([a["size"], b["size"]])
    return sizes[1] / sizes[0] > 1.25 or a["color"] != b["color"]


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
    """Text lines as style runs: spans that read as separate elements become one pseudo-line
    each; small inline changes (a bold phrase) keep the dominant style of the line."""
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            spans = [s for s in l["spans"] if s["text"].strip()]
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
                    "fonts": sorted({base_font(s["font"]) for s in run}),
                    "size": round(dom["size"], 2),
                    "color": dom["color"],
                })
    # Outlined lettering is drawn twice (font text + Type3 outline): keep one, erase both.
    for i, a in enumerate(out):
        for c in out[i + 1:]:
            if a["text"] == c["text"] and overlap(a["bbox"], c["bbox"]) > 0.5:
                keep, drop = (c, a) if a["font"].startswith("Type3") else (a, c)
                drop["duplicate_of"] = keep
    return out


def extract(pdf, workdir):
    doc = pymupdf.open(pdf)
    units = []
    for pno, page in enumerate(doc):
        lines = page_lines(page)
        groups = []
        # A line joins the group stacked right above it (any PDF block) when size and color match
        # and they share a font — so a paragraph survives a bold phrase, but a line set wholly in
        # another font ("(CCEP)" under "Partners") starts its own unit.
        for ln in sorted((l for l in lines if "duplicate_of" not in l), key=lambda l: l["baseline"]):
            home = None
            for g in groups:
                last = g["lines"][-1]
                stacked = 0 < ln["baseline"] - last["baseline"] < ln["size"] * 1.6
                x_overlap = min(ln["x1"], last["x1"]) - max(ln["x0"], last["x0"]) > 0
                if stacked and x_overlap and (g["size"], g["color"]) == (ln["size"], ln["color"]) and set(ln["fonts"]) & g["fonts"]:
                    home = g
                    break
            if home:
                home["lines"].append(ln)
                home["fonts"] |= set(ln["fonts"])
            else:
                groups.append({"size": ln["size"], "color": ln["color"], "fonts": set(ln["fonts"]), "lines": [ln]})
        for g in groups:
            weight = {}
            for ln in g["lines"]:
                weight[ln["font"]] = weight.get(ln["font"], 0) + len(ln["text"])
            g["font"] = max(weight, key=weight.get)
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
                "id": f"p{pno + 1:02d}_u{k:02d}",
                "page": pno,
                "text": re.sub(r"\s+", " ", text),
                "translate": worth_translating(text),
                "font": g["font"], "size": g["size"], "color": g["color"],
                "lines": [{k2: ln[k2] for k2 in ("text", "x0", "x1", "baseline", "bbox", "size")} for ln in g["lines"]],
                "redact_extra": [d["bbox"] for d in dups],
            })
    wd = Path(workdir)
    wd.mkdir(parents=True, exist_ok=True)
    (wd / "units.json").write_text(json.dumps({"pages": [[p.rect.width, p.rect.height] for p in doc], "units": units}, indent=1))
    segments = {u["id"]: u["text"] for u in units if u["translate"]}
    (wd / "segments.json").write_text(json.dumps(segments, ensure_ascii=False, indent=1))
    print(f"{len(units)} text units on {len(doc)} pages; {len(segments)} to translate "
          f"({sum(len(t.split()) for t in segments.values())} words) → {wd / 'segments.json'}")


def alignment(u, page_w, page_units):
    ls = u["lines"]
    if len(ls) == 1:
        # A single line that shares an edge with other text is part of a column (a checklist in
        # the right half is still left-aligned).
        others = [o for o in page_units if o is not u]
        if any(abs(o["lines"][0]["x0"] - ls[0]["x0"]) < 4 for o in others):
            return "left"
        if any(abs(max(l["x1"] for l in o["lines"]) - ls[0]["x1"]) < 4 for o in others):
            return "right"
    if len(ls) > 1:
        spread = lambda vals: max(vals) - min(vals)
        left = spread([l["x0"] for l in ls])
        right = spread([l["x1"] for l in ls])
        center = spread([(l["x0"] + l["x1"]) / 2 for l in ls])
        best = min(left, right, center)
        return "left" if best == left else "right" if best == right else "center"
    l = ls[0]
    cx = (l["x0"] + l["x1"]) / 2
    if abs(cx - page_w / 2) < page_w * 0.03:
        return "center"
    if l["x1"] > page_w * 0.8 and l["x0"] > page_w * 0.45:
        return "right"
    return "left"


def wrap(font, text, size, width):
    lines, cur = [], ""
    for w in text.split():
        trial = f"{cur} {w}".strip()
        if cur and font.text_length(trial, size) > width:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def unit_rect(u):
    return pymupdf.Rect(
        min(l["x0"] for l in u["lines"]), u["lines"][0]["baseline"] - u["size"] * 0.75,
        max(l["x1"] for l in u["lines"]), u["lines"][-1]["baseline"] + u["size"] * 0.2,
    )


def obstacles(page, data_units, pno):
    """What translated text must not grow into: other text, and images/vector shapes that are
    not page backgrounds."""
    area = page.rect.get_area()
    obs = [unit_rect(u) for u in data_units if u["page"] == pno]
    obs += [pymupdf.Rect(i["bbox"]) for i in page.get_image_info() if pymupdf.Rect(i["bbox"]).get_area() < area * 0.5]
    obs += [d["rect"] for d in page.get_drawings() if d["rect"].get_area() < area * 0.3]
    return obs


def container(u, obs):
    """The smallest shape the unit sits inside (a circle behind "consumers"), if any."""
    r = unit_rect(u)
    inside = [o for o in obs if o.contains(r) and o != r]
    return min(inside, key=lambda o: o.get_area()) if inside else None


def room(u, align, obs, page_w):
    """Width each original line may use: grow into free space beside that line, up to 40% wider
    and inside a 4% page margin, stopping at anything not behind the text (an icon after
    "became a"), and inside the shape that contains the text, if any."""
    box = container(u, obs)
    lo, hi = page_w * 0.04, page_w * 0.96
    if box:
        inset = box.width * 0.12
        lo, hi = max(lo, box.x0 + inset), min(hi, box.x1 - inset)
    widths = []
    for l in u["lines"]:
        r = pymupdf.Rect(l["x0"], l["baseline"] - l["size"] * 0.75, l["x1"], l["baseline"] + l["size"] * 0.2)
        # behind the text = covers most of the line (a shape, a photo); anything else blocks
        behind = lambda o: (o & r).get_area() > r.get_area() * 0.6
        band = [o for o in obs if o.y1 > r.y0 and o.y0 < r.y1 and not behind(o)]
        free_r = min([o.x0 for o in band if o.x0 >= r.x1 - 2] + [hi]) - 6
        free_l = max([o.x1 for o in band if o.x1 <= r.x0 + 2] + [lo]) + 6
        cap = r.width * 0.4
        grow_r, grow_l = max(0, min(cap, free_r - r.x1)), max(0, min(cap, r.x0 - free_l))
        if align == "left":
            widths.append(r.width + grow_r)
        elif align == "right":
            widths.append(r.width + grow_l)
        else:
            widths.append(r.width + 2 * min(grow_r, grow_l))
    if box:  # never wider than the shape
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


def layout(font, text, u, widths):
    """Biggest size (from the original down to the floor) at which the translation fits the
    per-line widths in the original line count — one extra line allowed for paragraphs.
    Breaks are balanced so a 2-line title stays two even lines."""
    n = len(u["lines"])
    max_lines = n + 1 if n >= 3 else n
    floor = 0.6 if n == 1 else MIN_SCALE
    scale = 1.0
    while scale >= floor - 1e-9:
        size = u["size"] * scale
        lines = wrap_widths(font, text, size, widths)
        fits = all(font.text_length(l, size) <= widths[min(i, len(widths) - 1)] for i, l in enumerate(lines))
        if len(lines) <= max_lines and fits:
            if len(lines) > 1:
                total = font.text_length(text, size)
                longest = max(font.text_length(w, size) for w in text.split())
                even = max(longest, total / len(lines) * 1.06)
                balanced = wrap_widths(font, text, size, [min(w, even) for w in widths])
                if len(balanced) == len(lines):
                    lines = balanced
            return lines, size
        scale -= 0.02
    size = u["size"] * floor
    lines = wrap_widths(font, text, size, widths)  # still too long: spill extra lines, evenly
    total = font.text_length(text, size)
    longest = max(font.text_length(w, size) for w in text.split())
    balanced = wrap_widths(font, text, size, [min(w, max(longest, total / len(lines) * 1.06)) for w in widths])
    return (balanced if len(balanced) == len(lines) else lines), size


def at_size(font, text, widths, size):
    """Lines for a fixed size (used when siblings share one size)."""
    lines = wrap_widths(font, text, size, widths)
    if len(lines) > 1:
        total = font.text_length(text, size)
        longest = max(font.text_length(w, size) for w in text.split())
        balanced = wrap_widths(font, text, size, [min(w, max(longest, total / len(lines) * 1.06)) for w in widths])
        if len(balanced) == len(lines):
            lines = balanced
    return lines


def sibling_key(u, align):
    """Units that started identical in style and edge (checklist items, labels in a row) should
    end up identical in size."""
    edge = round(u["lines"][0]["x0"] / 6) if align == "left" else round(max(l["x1"] for l in u["lines"]) / 6) if align == "right" else None
    return (u["page"], u["font"], u["size"], u["color"], align, edge)


def rebuild(pdf, workdir, fontsdir):
    wd = Path(workdir)
    data = json.loads((wd / "units.json").read_text())
    translated = json.loads((wd / "translated.json").read_text())
    fonts, files = {}, {}
    for alias, fname in list(FONT_MAP.values()) + [FALLBACK]:
        files[alias] = str(Path(fontsdir) / fname)
        fonts[alias] = pymupdf.Font(fontfile=files[alias])

    doc = pymupdf.open(pdf)
    report = []
    for pno, page in enumerate(doc):
        page_w = page.rect.width
        units = [u for u in data["units"] if u["page"] == pno and u["translate"] and u["id"] in translated]
        obs = obstacles(page, data["units"], pno)
        # A character is removed when its box touches a redaction rect, and display type has tall
        # boxes — so redact a thin band just above each baseline (every glyph of the line crosses
        # it) rather than the line box, or a "600M" above "consumers" disappears with it.
        for u in units:
            rects = [pymupdf.Rect(l["x0"], l["baseline"] - l["size"] * 0.25, l["x1"], l["baseline"] - l["size"] * 0.15) for l in u["lines"]]
            rects += [pymupdf.Rect(r) for r in u["redact_extra"]]
            for r in rects:
                page.add_redact_annot(r, fill=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)

        plans = []
        for u in units:
            alias = FONT_MAP.get(u["font"], FALLBACK)[0]
            font = fonts[alias]
            text = re.sub(r"\s+", " ", translated[u["id"]]).strip()
            own = [o for o in obs if o != unit_rect(u)]
            align = alignment(u, page_w, [x for x in data["units"] if x["page"] == pno])
            box = container(u, own)
            if box and len(u["lines"]) == 1 and abs(unit_rect(u).x0 + unit_rect(u).width / 2 - (box.x0 + box.width / 2)) < box.width * 0.08:
                align = "center"  # a single line centered in its shape stays centered
            widths = room(u, align, own, page_w)
            lines, size = layout(font, text, u, widths)
            plans.append({"u": u, "alias": alias, "font": font, "text": text, "align": align, "widths": widths, "lines": lines, "size": size})
        # siblings share the smallest scale any of them needed
        scale_of = {}
        for p in plans:
            k = sibling_key(p["u"], p["align"])
            scale_of[k] = min(scale_of.get(k, 1.0), p["size"] / p["u"]["size"])
        for p in plans:
            target = p["u"]["size"] * scale_of[sibling_key(p["u"], p["align"])]
            if target < p["size"] - 0.01:
                p["size"], p["lines"] = target, at_size(p["font"], p["text"], p["widths"], target)

        for p in plans:
            u, alias, font, text, align, lines, size = p["u"], p["alias"], p["font"], p["text"], p["align"], p["lines"], p["size"]
            base = [l["baseline"] for l in u["lines"]]
            pitch = (base[-1] - base[0]) / (len(base) - 1) if len(base) > 1 else u["size"] * 1.05
            pitch *= size / u["size"]
            # keep the block's vertical center where the original block was
            orig_mid = (base[0] + base[-1]) / 2
            first = orig_mid - pitch * (len(lines) - 1) / 2
            left = min(l["x0"] for l in u["lines"])
            right = max(l["x1"] for l in u["lines"])
            center = sum((l["x0"] + l["x1"]) / 2 for l in u["lines"]) / len(u["lines"])
            c = u["color"]
            rgb = (((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)
            for i, line in enumerate(lines):
                w = font.text_length(line, size)
                x = left if align == "left" else right - w if align == "right" else center - w / 2
                page.insert_text((x, first + i * pitch), line, fontname=alias, fontfile=files[alias], fontsize=size, color=rgb)
            report.append(f"{u['id']} {align:6s} {size / u['size']:.0%} {len(u['lines'])}→{len(lines)} lines  {text[:60]!r}")

    out = wd / "out"
    out.mkdir(exist_ok=True)
    doc.save(out / "translated.pdf", garbage=3, deflate=True)

    # Page-image variant: each translated page flattened to one picture.
    img_doc = pymupdf.open()
    for page in doc:
        pix = page.get_pixmap(dpi=150)
        p = img_doc.new_page(width=page.rect.width, height=page.rect.height)
        p.insert_image(p.rect, stream=pix.tobytes("jpeg", jpg_quality=85))
    img_doc.save(out / "translated-images.pdf", garbage=3, deflate=True)

    # Side-by-side: original | translated
    src, dst = pymupdf.open(pdf), pymupdf.open(out / "translated.pdf")
    (out / "compare").mkdir(exist_ok=True)
    for pno in range(len(src)):
        w, h = src[pno].rect.width, src[pno].rect.height
        cmp_doc = pymupdf.open()
        cp = cmp_doc.new_page(width=w * 2 + 40, height=h)
        cp.draw_rect(cp.rect, color=None, fill=(1, 1, 1))
        cp.show_pdf_page(pymupdf.Rect(0, 0, w, h), src, pno)
        cp.show_pdf_page(pymupdf.Rect(w + 40, 0, w * 2 + 40, h), dst, pno)
        cp.get_pixmap(dpi=40).save(out / "compare" / f"p{pno + 1:02d}.png")
    (out / "layout-report.txt").write_text("\n".join(report))
    print("\n".join(report))
    for f in ("translated.pdf", "translated-images.pdf"):
        print(f"{f}: {(out / f).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "extract" and len(sys.argv) == 4:
        extract(sys.argv[2], sys.argv[3])
    elif cmd == "rebuild" and len(sys.argv) == 5:
        rebuild(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(__doc__ or "usage: extract <in.pdf> <workdir> | rebuild <in.pdf> <workdir> <fontsdir>")
