"""
Generate the Effro. installer brand art (NSIS bitmaps) from brand tokens.

Outputs (24-bit BMP, the format NSIS expects):
  src-tauri/installer/sidebar.bmp   164 x 314  — welcome/finish left panel
  src-tauri/installer/header.bmp    150 x  57  — interior page header chip

Everything is drawn vector-style and supersampled 3x for crisp edges, so the
fork mark and wordmark match the splash screen exactly. Re-run any time:
    python scripts/gen-installer-art.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "src-tauri", "installer")
FONT = os.path.join(ROOT, ".build-assets", "Geist.ttf")

# ── Brand tokens ─────────────────────────────────────────────────────────────
PITCH      = (15, 14, 12)      # #0F0E0C
PITCH_2    = (24, 23, 20)      # #181714
MINT       = (16, 185, 129)    # #10B981
PAPER_D    = (237, 234, 227)   # #EDEAE3
PAPER_SD   = (168, 164, 158)   # #A8A49E
PAPER_MD   = (107, 104, 98)    # #6B6862
STONE_DARK = (56, 53, 47)      # #38352F

SS = 3  # supersample factor

def font(weight, px):
    f = ImageFont.truetype(FONT, px * SS)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f

def quad(p0, p1, p2, n=64):
    """Sample a quadratic bezier into n points."""
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0]
        y = u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]
        pts.append((x, y))
    return pts

def stroke(draw, pts, color, width):
    """Thick line with round caps + joins through sampled points."""
    draw.line(pts, fill=color, width=width, joint="curve")
    r = width / 2
    for (x, y) in (pts[0], pts[-1]):
        draw.ellipse([x-r, y-r, x+r, y+r], fill=color)

def draw_mark(draw, cx, cy, size):
    """
    Draw the V3 curved fork mark centred at (cx, cy), `size` px wide.
    Paths come from the 0..100 viewBox used everywhere else in the brand.
    Top branch = mint; stem + bottom branch = paper.
    """
    s = size * SS / 100.0
    ox = cx * SS - 50 * s
    oy = cy * SS - 50 * s
    def P(x, y): return (ox + x * s, oy + y * s)
    w = int(12 * s)  # stroke width = 12 viewBox units

    # stem (paper) + bottom branch (paper)
    stroke(draw, [P(22, 50), P(50, 50)], PAPER_D, w)
    stroke(draw, quad(P(78, 78), P(64, 58), P(50, 50)), PAPER_D, w)
    # top branch (mint) — drawn last so it sits cleanly over the junction
    stroke(draw, quad(P(78, 22), P(64, 42), P(50, 50)), MINT, w)

def radial_glow(img, cx, cy, radius, color, max_alpha):
    """Soft mint radial glow composited onto img."""
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 48
    for i in range(steps, 0, -1):
        a = int(max_alpha * (i / steps) ** 2)
        r = radius * i / steps
        gd.ellipse([cx-r, cy-r, cx+r, cy+r], fill=color + (a,))
    img.alpha_composite(glow)

def text_centered(draw, cx, y, s, fnt, fill):
    bbox = draw.textbbox((0, 0), s, font=fnt)
    w = bbox[2] - bbox[0]
    draw.text((cx - w/2 - bbox[0], y), s, font=fnt, fill=fill)
    return bbox[3] - bbox[1]

def wordmark(draw, cx, y, px):
    """ 'Effro' + mint dot, centred on cx, returns drawn height. """
    fnt = font("SemiBold", px)
    dot_r = max(2, int(px * 0.085)) * SS
    gap   = int(px * 0.06) * SS
    bbox = draw.textbbox((0, 0), "Effro", font=fnt)
    tw = bbox[2] - bbox[0]
    total = tw + gap + dot_r * 2
    x0 = cx * SS - total / 2
    draw.text((x0 - bbox[0], y * SS), "Effro", font=fnt, fill=PAPER_D)
    # mint dot sits on the baseline, to the right
    dot_cx = x0 + tw + gap + dot_r
    dot_cy = y * SS + (bbox[3] - bbox[1]) - dot_r
    draw.ellipse([dot_cx-dot_r, dot_cy-dot_r, dot_cx+dot_r, dot_cy+dot_r], fill=MINT)

# ── Sidebar 164 x 314 ────────────────────────────────────────────────────────
def build_sidebar():
    W, H = 164 * SS, 314 * SS
    img = Image.new("RGBA", (W, H), PITCH + (255,))
    # subtle mint glow behind the mark, upper third
    radial_glow(img, W*0.5, H*0.30, W*0.85, MINT, 26)
    d = ImageDraw.Draw(img)

    # fork mark
    draw_mark(d, 82, 86, 70)

    # wordmark
    wordmark(d, 82, 150, 30)

    # slogan
    text_centered(d, W/2, 196 * SS, "Stay across everything.",
                  font("Regular", 11), PAPER_SD)

    # thin mint divider near the bottom
    d.rectangle([40*SS, 270*SS, 124*SS, 270*SS + SS], fill=STONE_DARK)
    # domain stamp
    text_centered(d, W/2, 280 * SS, "effro.io", font("Medium", 10), PAPER_MD)

    img = img.convert("RGB").resize((164, 314), Image.LANCZOS)
    img.save(os.path.join(OUT, "sidebar.bmp"))
    print("wrote sidebar.bmp (164x314)")

# ── Header 150 x 57 ──────────────────────────────────────────────────────────
def build_header():
    W, H = 150 * SS, 57 * SS
    img = Image.new("RGBA", (W, H), PITCH + (255,))
    d = ImageDraw.Draw(img)
    # mark on the left, wordmark to its right — a compact logo lockup
    draw_mark(d, 30, 28, 30)
    fnt = font("SemiBold", 18)
    bbox = d.textbbox((0, 0), "Effro", font=fnt)
    ty = (H - (bbox[3]-bbox[1])) / 2 - bbox[1]
    d.text((52*SS, ty), "Effro", font=fnt, fill=PAPER_D)
    tw = bbox[2]-bbox[0]
    dr = 3 * SS
    d.ellipse([52*SS+tw+4*SS, ty+(bbox[3]-bbox[1])-dr, 52*SS+tw+4*SS+2*dr, ty+(bbox[3]-bbox[1])+dr], fill=MINT)

    img = img.convert("RGB").resize((150, 57), Image.LANCZOS)
    img.save(os.path.join(OUT, "header.bmp"))
    print("wrote header.bmp (150x57)")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    build_sidebar()
    build_header()
    print("done ->", OUT)
