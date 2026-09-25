#!/usr/bin/env python3
"""
fetch_data.py - cache the public Walkerville sewer layers locally, raw and unmodified.

Everything downstream reads these files, never the endpoints, so a run is reproducible
offline and a publisher update cannot change a result silently between runs.

Every layer is requested with outSR=28354 (GDA94 / MGA zone 54), so the server does
all reprojection and every coordinate is in metres. The layers disagree natively
(manholes are wkid 8059, contours 28354) and a caller-side mix-up fails silently.

Usage:
    python simulation/fetch_data.py            # skips layers already cached
    python simulation/fetch_data.py --force    # re-download everything
"""
import argparse, json, os, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")

OUT_SR = 28354
HDRS = {"User-Agent": "UofA-capstone-OSP/1.0 (academic research)"}
WV = "https://services-ap1.arcgis.com/38lmAqtkEsaNGT6T/arcgis/rest/services"
NET = WV + "/SA_Water_Sewer_Network/FeatureServer"

LAYERS = {
    "mains":     (NET + "/6", "*"),
    "manholes":  (NET + "/2", "*"),
    "contours":  (WV + "/Contours_1m/FeatureServer/0", "ELEVATION"),
    # Layer 4, one point per connected property, carrying PARCELID on every record.
    # This is what replaces the assumed dwelling density in ASSUMPTIONS L5: load can be
    # counted per pipe instead of inferred from how much sewer there is.
    "inspection_points": (NET + "/4", "ID,PARCELID,CUSTOMERID,TRADEWASTE,CONST_YEAR"),
    # Layer 7, the actual connection pipe from each property to the main it joins. Measured
    # 16 Sep: median 6.7 m long, and the end that meets a main sits 0.00 m from one. So a
    # property can be attributed to the main it really drains to rather than to whichever
    # main happens to be nearest.
    "connections": (NET + "/7", "ID,FLOWDIRECT,NOMINALDIA"),
    # Added 24 Sep for the domain upgrade (HANDOFF, P0). None of these feed the growth
    # catchment above 583 directly, but the rising mains discharge into the trunk BELOW it,
    # which the free outfall currently cuts off. Shafts and inspection openings are used for
    # hydraulics only (replacing sealed-junction guesses, H10), never as sensor candidates.
    "shafts":            (NET + "/1", "*"),
    "inspection_openings": (NET + "/3", "*"),
    "rising_structures": (NET + "/5", "*"),
    "rising_mains":      (NET + "/8", "*"),
}

# The statewide layers (DEW / the utility on the SA Government geodata server). Not clipped to
# the council, so they are fetched inside a box around the cached mains, buffered by
# SW_BUFFER_M. That box, not the council boundary, is the outer limit of any extension; it
# is recorded in the cached file so a later wider fetch is visible rather than silent.
SW = "https://agsplus.geodata.sa.gov.au/arcgis/rest/services/Infrastructure_Utilities/MapServer"
SW_LAYERS = {
    "sw_gravity": SW + "/9",
    "sw_pumping": SW + "/11",
}
SW_BUFFER_M = 2500.0


def get(url, params, tries=3):
    q = dict(params, f="json")
    full = url + "/query?" + urllib.parse.urlencode(q)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(full, headers=HDRS)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def harvest(url, fields, envelope=None):
    base = {"where": "1=1", "outFields": fields, "outSR": str(OUT_SR),
            "returnGeometry": "true"}
    if envelope:
        base.update({"geometry": ",".join(f"{v:.1f}" for v in envelope),
                     "geometryType": "esriGeometryEnvelope", "inSR": str(OUT_SR),
                     "spatialRel": "esriSpatialRelIntersects"})
    total = get(url, {**base, "returnCountOnly": "true"}).get("count", 0)
    if envelope:
        # Stable paging on the statewide server. Must not go on the count request, which
        # then returns an error body and reads as zero features.
        base["orderByFields"] = "objectid"
    feats = []
    while len(feats) < total:
        batch = get(url, {**base, "resultOffset": len(feats),
                          "resultRecordCount": 1000}).get("features", [])
        if not batch:
            break
        feats.extend(batch)
    return feats, total


def mains_envelope(buffer_m):
    """Bounding box of the cached council mains, grown by buffer_m, in OUT_SR metres."""
    with open(os.path.join(RAW, "mains.json"), encoding="utf-8") as f:
        pts = [p for ft in json.load(f)["features"]
               for path in ft["geometry"]["paths"] for p in path]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs) - buffer_m, min(ys) - buffer_m, max(xs) + buffer_m, max(ys) + buffer_m)


def save(path, url, feats, **extra):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"source": url, "outSR": OUT_SR, "fetched": time.strftime("%Y-%m-%d"),
                   **extra, "features": feats}, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    for name, (url, fields) in LAYERS.items():
        path = os.path.join(RAW, name + ".json")
        if os.path.exists(path) and not args.force:
            print(f"  {name:9s} cached")
            continue
        feats, total = harvest(url, fields)
        save(path, url, feats)
        print(f"  {name:9s} {len(feats)}/{total} features")
    env = mains_envelope(SW_BUFFER_M)
    for name, url in SW_LAYERS.items():
        path = os.path.join(RAW, name + ".json")
        if os.path.exists(path) and not args.force:
            print(f"  {name:9s} cached")
            continue
        feats, total = harvest(url, "*", envelope=env)
        save(path, url, feats, envelope=env, buffer_m=SW_BUFFER_M)
        print(f"  {name:9s} {len(feats)}/{total} features inside the buffered box")


if __name__ == "__main__":
    main()
