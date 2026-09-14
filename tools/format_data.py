#!/usr/bin/env python3
"""Rewrite osp_data.js as readable JSON without exploding it.

WHY NOT json.dumps(indent=2)

The payload is 25,636 scalars, and most of them live in parallel arrays: 1,010
node coordinates, 1,001 pipe diameters, and polylines that are lists of coordinate
pairs. Indenting every one of those onto its own line turns a 182 KB file into
607 KB and 38,000 lines, which is harder to read rather than easier: you cannot
see the shape of the payload when a single array occupies a thousand screens.

So structure is indented and bulk data is not. Objects and lists of objects get
one entry per line, which is what makes the file browsable. A list whose contents
are all numbers stays inline and wraps at a column, which is what keeps it short.
Coordinate pairs are kept whole on a line, never split across two.

The result is about 240 KB in 900-odd lines: every key visible, every array
readable, and the diff of a data rebuild still legible.

build_demo_data.py writes single-line JSON, so run this after a rebuild to restore
the readable layout. It asserts the payload is unchanged before writing anything.

Usage:  python3 tools/format_data.py [--check]
"""
import argparse, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "osp_data.js")

WRAP = 96          # target column for wrapped numeric arrays
INDENT = "  "


def _num(v):
    """Compact scalar: keeps ints as ints, drops float noise, JSON-legal."""
    if v is True or v is False or v is None:
        return json.dumps(v)
    if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
        return str(int(v))
    return json.dumps(v)


def _is_flat_numeric(o):
    return isinstance(o, list) and o and all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in o)


def _is_pair_list(o):
    """Polyline shape: a list of short all-numeric lists."""
    return isinstance(o, list) and o and all(_is_flat_numeric(v) for v in o)


def _wrap(tokens, pad):
    """Join tokens with commas, breaking near WRAP. Returns list of lines."""
    lines, cur = [], ""
    for i, t in enumerate(tokens):
        piece = t + ("," if i < len(tokens) - 1 else "")
        if cur and len(pad) + len(cur) + 1 + len(piece) > WRAP:
            lines.append(pad + cur)
            cur = piece
        else:
            cur = piece if not cur else cur + " " + piece
    if cur:
        lines.append(pad + cur)
    return lines


def dumps(o, level=0):
    pad = INDENT * level
    inner = INDENT * (level + 1)

    if _is_flat_numeric(o):
        toks = [_num(v) for v in o]
        one = "[" + ", ".join(toks) + "]"
        if len(pad) + len(one) <= WRAP:
            return one
        return "[\n" + "\n".join(_wrap(toks, inner)) + "\n" + pad + "]"

    if _is_pair_list(o):
        toks = ["[" + ", ".join(_num(v) for v in pair) + "]" for pair in o]
        one = "[" + ", ".join(toks) + "]"
        if len(pad) + len(one) <= WRAP:
            return one
        return "[\n" + "\n".join(_wrap(toks, inner)) + "\n" + pad + "]"

    if isinstance(o, list):
        if not o:
            return "[]"
        parts = [inner + dumps(v, level + 1) for v in o]
        return "[\n" + ",\n".join(parts) + "\n" + pad + "]"

    if isinstance(o, dict):
        if not o:
            return "{}"
        parts = [inner + json.dumps(k) + ": " + dumps(v, level + 1)
                 for k, v in o.items()]
        return "{\n" + ",\n".join(parts) + "\n" + pad + "}"

    return _num(o)


def split(src):
    """Header comments, and the payload object, from an osp_data.js text."""
    at = src.index("window.OSP_DATA")
    head = src[:at]
    body = src[src.index("{", at):].rstrip().rstrip(";")
    return head, json.loads(body)


def render(head, payload):
    return head + "window.OSP_DATA = " + dumps(payload) + ";\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report what would change, write nothing")
    args = ap.parse_args()

    src = open(DATA, encoding="utf8").read()
    head, payload = split(src)
    out = render(head, payload)

    # A formatter that alters the data is a bug, not a formatter.
    assert split(out)[1] == payload, "round trip changed the data"

    print("before: %8d bytes %6d lines" % (len(src), src.count("\n") + 1))
    print("after : %8d bytes %6d lines" % (len(out), out.count("\n") + 1))
    if args.check:
        print("check only, not written")
        return
    open(DATA, "w", encoding="utf8").write(out)
    print("wrote", DATA)


if __name__ == "__main__":
    main()
