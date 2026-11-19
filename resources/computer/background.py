#!/usr/bin/env python3
"""
Draws the computer's desktop background: Nova, the app's mark, quiet in the
middle of a night screen, as an X bitmap that xsetroot lays on the screen.
The size must match the screen in start.sh. It uses nothing but Python.
"""
import sys

WIDTH, HEIGHT = 1280, 800
# Nova is drawn on a 48-unit square, here six screen pixels to the unit.
SCALE = 6
LEFT = (WIDTH - 48 * SCALE) // 2
TOP = (HEIGHT - 48 * SCALE) // 2


def in_rounded(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def nova(x, y):
    """True where Nova is drawn, at a point in its own 48-unit square."""
    head = (x - 24) ** 2 + (y - 19) ** 2 <= 14 ** 2
    shoulders = y <= 35 and (x - 24) ** 2 + (y - 35) ** 2 <= 10 ** 2
    body = 14 <= x <= 34 and 35 <= y <= 44
    if not (head or shoulders or body):
        return False
    if in_rounded(x, y, 12.5, 12, 35.5, 25.5, 6.75):
        # The visor is open, with its glint drawn in it.
        gx = min(max(x, 17), 22.5)
        return (x - gx) ** 2 + (y - 17) ** 2 <= 1.2 ** 2
    return True


def main():
    row_bytes = WIDTH // 8
    empty = ", ".join(["0x00"] * row_bytes)
    rows = []
    for py in range(HEIGHT):
        if not (TOP <= py < TOP + 48 * SCALE):
            rows.append(empty)
            continue
        y = (py - TOP + 0.5) / SCALE
        values = []
        for byte in range(row_bytes):
            value = 0
            for bit in range(8):
                px = byte * 8 + bit
                if LEFT <= px < LEFT + 48 * SCALE:
                    x = (px - LEFT + 0.5) / SCALE
                    if nova(x, y):
                        value |= 1 << bit
            values.append("0x%02x" % value)
        rows.append(", ".join(values))
    out = sys.stdout
    out.write("#define background_width %d\n" % WIDTH)
    out.write("#define background_height %d\n" % HEIGHT)
    out.write("static unsigned char background_bits[] = {\n")
    out.write(",\n".join(rows))
    out.write("};\n")


if __name__ == "__main__":
    main()
