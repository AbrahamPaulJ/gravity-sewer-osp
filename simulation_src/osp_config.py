"""
osp_config.py - the project's settings, read from the one file that holds them all.

config.js at the repository root is a browser script (it sets window.OSP_CONFIG) so the site
can load it, and the object it sets is plain JSON so this can read it too. One file, so a
setting is changed once and every part of the project, Python and browser, sees the same value.

    import osp_config
    cfg = osp_config.load()
    cfg["loads"]["people_per_new_dwelling"]
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "config.js")
_cache = {}


def load(path=PATH):
    """The settings object, parsed once per path. A parse failure names the file and says
    what went wrong, since the likeliest cause is an edit that broke the JSON."""
    if path in _cache:
        return _cache[path]
    with open(path, encoding="utf-8") as f:
        text = f.read()
    marker = ".OSP_CONFIG ="
    at = text.find(marker)
    if at < 0:
        raise ValueError(f"{path}: no '{marker}' in it")
    start, end = text.index("{", at), text.rindex("}")
    try:
        cfg = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"{path}: the settings are not valid JSON ({e.msg}, line "
                         f"{text[:start].count(chr(10)) + e.lineno}). Keep them plain JSON: "
                         "double quotes, no comments, no trailing commas.") from None
    _cache[path] = cfg
    return cfg


def plain(d):
    """A settings dict without its "_note"-style keys, for code that iterates its entries."""
    return {k: v for k, v in d.items() if not k.startswith("_")}
