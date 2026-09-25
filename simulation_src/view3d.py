#!/usr/bin/env python3
"""
view3d.py - play back a saved run in 3D (PyVista / VTK).

What is drawn (exaggeration stated on screen):
    ground      contour-reconstructed surface with 1 m contour lines
    shafts      one per chamber, floor (invert) to lid (cover)
    water       blue column in each shaft at the depth SWMM reports
    pipes       real plan route, falling straight between the recorded inverts. Under the
                `along` split each pipe is several SWMM segments, each coloured by its own
                fill, so a backwater profile along a pipe is visible. Red = full.
    arrows      flow direction and size on each pipe, from SWMM's signed flow
    spill       red ball on a lid while SWMM reports flooding there

Three tabs, buttons bottom-left or the TAB key:
    Simulation        the 3D playback
    Results           the experiment this run belongs to: table and chart (if any)
    How it was built  HOW_IT_WAS_BUILT.md with this run's details filled in
UP / DOWN scroll the text tabs. SPACE plays or pauses. R resets the camera.

Usage:
    python view3d.py                                   # most recent run
    python view3d.py results/ladder_along/q_1.14
    python view3d.py <run> --screenshot out.png --frame 250 [--tab results]
    python view3d.py <run> --gif run.gif
"""
import argparse, glob, json, os, re
from collections import defaultdict

import numpy as np
import pyvista as pv

HERE = os.path.dirname(os.path.abspath(__file__))
BUILT_DOC = os.path.join(HERE, "HOW_IT_WAS_BUILT.md")
PAGE_LINES = 62
SHAFT_R = 0.525          # m, 1050 mm chamber (H8)
SHAFT_DRAW = 2.5         # shafts drawn wider than true, stated on screen
COLOURS = dict(ground="#c9b79c", shaft="#8a8f98", pipe="#6b7280", water="#2f7fd1",
               spill="#e0312b", text="#1f2328", bg="#f4f1ea", arrow="#e8912d")
SERIES_COLOURS = {"A": "#2f7fd1", "B": "#e8912d", "J": "#3a9a5b", "D": "#9b59b6"}
TABS = (("sim", "Simulation"), ("results", "Results"), ("built", "How it was built"))


def latest_run():
    runs = sorted(glob.glob(os.path.join(HERE, "results", "**", "meta.json"), recursive=True),
                  key=os.path.getmtime)
    if not runs:
        raise SystemExit("no runs yet: python experiments.py all")
    return os.path.dirname(runs[-1])


class Scene:
    def __init__(self, run_dir, zexag=8.0, bore=8.0, off_screen=False):
        self.run_dir = os.path.abspath(run_dir)
        with open(os.path.join(run_dir, "meta.json"), encoding="utf-8") as f:
            self.meta = m = json.load(f)
        self.s = dict(np.load(os.path.join(run_dir, "series.npz")))
        self.zexag, self.bore = zexag, bore
        self.azimuth, self.elevation = -60.0, 22.0
        self.nodes = {n["name"]: n for n in m["nodes"]}
        self.chambers = m["chambers"]
        self.link_index = {lk["name"]: i for i, lk in enumerate(m["links"])}
        j = self.nodes["J"]
        self.ox, self.oy = j["x"], j["y"]
        self.oz = min(n["invert"] for n in m["nodes"]) - 0.5

        self.summary = None
        sp = os.path.join(os.path.dirname(self.run_dir), "summary.json")
        if os.path.exists(sp):
            with open(sp, encoding="utf-8") as f:
                self.summary = json.load(f)

        self.pl = pv.Plotter(off_screen=off_screen, window_size=(1500, 950))
        self.pl.set_background(COLOURS["bg"])
        self._static()
        self._dynamic()
        self.scene_actors = list(self.pl.renderer.actors.values())
        self.frame, self.playing, self.slider, self.tab = 0, False, None, "sim"
        self.pages = {"results": self.results_text().splitlines(),
                      "built": self.built_text().splitlines()}
        self.scroll = {"results": 0, "built": 0}
        self.page = self.pl.add_text("", position="upper_left", font_size=10,
                                     color=COLOURS["text"], font="courier")
        self.page.SetVisibility(False)
        self.chart = self._chart()

    # ------------------------------------------------------------ coordinates
    def P(self, x, y, z):
        return np.array([x - self.ox, y - self.oy, (z - self.oz) * self.zexag])

    def centreline(self, lk):
        xy = np.asarray(lk["line"], float)
        seg = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
        frac = seg / max(seg[-1], 1e-9)
        z = lk["inv_up"] + (lk["inv_down"] - lk["inv_up"]) * frac + lk["dia"] / 2
        return np.array([self.P(x, y, zz) for (x, y), zz in zip(xy, z)])

    # ----------------------------------------------------------------- static
    def _static(self):
        m, pl = self.meta, self.pl
        g = m["ground"]
        GX, GY = np.meshgrid(g["x"], g["y"])
        GZ = np.asarray(g["z"])
        grid = pv.StructuredGrid(GX - self.ox, GY - self.oy, (GZ - self.oz) * self.zexag)
        pl.add_mesh(grid, color=COLOURS["ground"], opacity=0.10)
        grid["z"] = GZ.ravel(order="F")
        levels = np.arange(np.floor(GZ.min()), np.ceil(GZ.max()) + 1, 1.0)
        pl.add_mesh(grid.contour(levels, scalars="z"), color="#9c8a6c", line_width=1.2, opacity=0.6)

        for c in self.chambers:
            n = self.nodes[c]
            h = n["max_depth"] * self.zexag
            ctr = self.P(n["x"], n["y"], n["invert"]) + [0, 0, h / 2]
            pl.add_mesh(pv.Cylinder(center=ctr, direction=(0, 0, 1), radius=SHAFT_R * SHAFT_DRAW,
                                    height=h, resolution=40, capping=False),
                        color=COLOURS["shaft"], opacity=0.25)
            pl.add_mesh(pv.Disc(center=ctr + [0, 0, h / 2], inner=0,
                                outer=SHAFT_R * SHAFT_DRAW * 1.25, normal=(0, 0, 1), c_res=40),
                        color="#3b3f45")
            pl.add_point_labels([ctr + [0, 0, h / 2 + 1.2]], [f"{c}  (MH {n['manhole_id']})"],
                                font_size=14, text_color=COLOURS["text"], shape_opacity=0.0,
                                show_points=False, always_visible=True)

        self.lines = [self.centreline(lk) for lk in m["links"]]
        for lk, pts in zip(m["links"], self.lines):
            ghost = lk["role"] != "study"
            pl.add_mesh(pv.lines_from_points(pts).tube(radius=lk["dia"] / 2 * self.bore * 1.08,
                                                       n_sides=24),
                        color=COLOURS["pipe"], opacity=0.10 if ghost else 0.22)
        for p in m["pipes"]:
            mid = self.lines[self.link_index[p["links"][len(p["links"]) // 2]]]
            at = mid[len(mid) // 2] if len(p["links"]) == 1 else mid[0]
            pl.add_point_labels([at + [0, 0, 1.5]],
                                [f"{p['label']}  {p['dia']*1000:.0f} mm  {p['length']:.0f} m"
                                 + ("  (outlet boundary)" if p["role"] != "study" else "")],
                                font_size=10, text_color="#555b63", shape_opacity=0.0,
                                show_points=False, always_visible=True)
        pl.add_text(f"Vertical x{self.zexag:g}, pipe bore x{self.bore:g}, shaft width "
                    f"x{SHAFT_DRAW:g}. Readings in the panel are unscaled.",
                    position="lower_left", font_size=9, color="#555b63")

    # ---------------------------------------------------------------- dynamic
    def _dynamic(self):
        pl, m = self.pl, self.meta
        self.shaft_water, self.spill = [], []
        for _ in self.chambers:
            w = pv.Cylinder(radius=0.01, height=0.01)
            pl.add_mesh(w, color=COLOURS["water"], opacity=0.85)
            self.shaft_water.append(w)
            s = pv.Sphere(radius=0.01)
            pl.add_mesh(s, color=COLOURS["spill"])
            self.spill.append(s)
        self.tubes = []
        for i, (lk, pts) in enumerate(zip(m["links"], self.lines)):
            tube = pv.lines_from_points(pts).tube(radius=lk["dia"] / 2 * self.bore * 0.9, n_sides=24)
            tube["fill"] = np.zeros(tube.n_points)
            pl.add_mesh(tube, scalars="fill", clim=[0, 1], cmap="Blues",
                        above_color=COLOURS["spill"], show_scalar_bar=(i == 0), opacity=0.95,
                        scalar_bar_args=dict(title="Pipe fill (depth / diameter), red = full",
                                             position_x=0.62, position_y=0.04, width=0.33,
                                             height=0.05, color=COLOURS["text"],
                                             title_font_size=12, label_font_size=10, n_labels=3))
            self.tubes.append(tube)
        self.arrows = []
        for _ in m["pipes"]:
            a = pv.Arrow()
            pl.add_mesh(a, color=COLOURS["arrow"])
            self.arrows.append(a)
        self.panel = pl.add_text("", position="upper_left", font_size=10,
                                 color=COLOURS["text"], font="courier")

    def draw(self, k):
        s, m = self.s, self.meta
        k = int(np.clip(k, 0, len(s["t"]) - 1))
        self.frame = k
        for i, c in enumerate(self.chambers):
            n = self.nodes[c]
            h = max(float(s["depth"][k, i]), 0.002) * self.zexag
            base = self.P(n["x"], n["y"], n["invert"])
            self.shaft_water[i].copy_from(pv.Cylinder(center=base + [0, 0, h / 2], direction=(0, 0, 1),
                                                      radius=SHAFT_R * SHAFT_DRAW * 0.9, height=h,
                                                      resolution=40))
            top = self.P(n["x"], n["y"], n["cover"]) + [0, 0, 0.6]
            self.spill[i].copy_from(pv.Sphere(center=top, radius=1.2 if s["flood"][k, i] > 1e-6 else 0.001))
        for i, lk in enumerate(m["links"]):
            fill = float(s["ldepth"][k, i]) / lk["dia"]
            self.tubes[i]["fill"] = np.full(self.tubes[i].n_points, 1.1 if fill >= 0.999 else fill)
        qmax = max(float(np.abs(s["lflow"]).max()), 1e-6)
        for a, p in zip(self.arrows, m["pipes"]):
            i = self.link_index[p["links"][len(p["links"]) // 2]]
            pts, q = self.lines[i], float(s["lflow"][k, i])
            d = (pts[-1] - pts[0]) * (1 if q >= 0 else -1)
            size = 0.001 if abs(q) < 0.02 else 4.0 + 10.0 * abs(q) / qmax
            ctr = pts[len(pts) // 2] if len(pts) > 2 else (pts[0] + pts[-1]) / 2
            a.copy_from(pv.Arrow(start=ctr + [0, 0, p["dia"] * self.bore + 0.6], direction=d,
                                 scale=size, tip_length=0.35, tip_radius=0.18, shaft_radius=0.07))
        self.panel.SetText(2, self.readout(k))

    def readout(self, k):
        s, m = self.s, self.meta
        lines = [f"Junction {m['junction']}   split: {m['split']}",
                 m["scenario_text"],
                 f"t = {s['t'][k]/60:6.1f} min   of {s['t'][-1]/60:.0f}", "",
                 "chamber  inflow     water    of shaft"]
        for i, c in enumerate(self.chambers):
            d = s["depth"][k, i]
            flag = "  SPILLING" if s["flood"][k, i] > 1e-6 else ""
            lines.append(f"   {c}   {s['inflow'][k, i]:6.2f} L/s  {d:5.2f} m  "
                         f"{100 * d / self.nodes[c]['max_depth']:5.0f}%{flag}")
        lines += ["", "pipe    flow out     fullest"]
        for p in m["pipes"]:
            idx = [self.link_index[n] for n in p["links"]]
            q = s["lflow"][k, idx[-1]]
            fill = max(s["ldepth"][k, i] / p["dia"] for i in idx)
            lines.append(f" {p['label']:6s} {q:7.2f} L/s   {100 * min(fill, 1):4.0f}%"
                         + ("  full" if fill >= 0.999 else ""))
        if len(m["links"]) > len(m["pipes"]):
            lines += ["", f"({len(m['links'])} SWMM segments; fullest = any segment)"]
        return "\n".join(lines)

    # ------------------------------------------------------------- text tabs
    def results_text(self):
        if not self.summary:
            return ("RESULTS\n\nThis run is a single scenario, not part of an experiment.\n"
                    "Run the experiments from the launcher, or:  python experiments.py all")
        here = os.path.basename(self.run_dir)
        return "\n".join(self.summary["text"] + ["", f"Showing run: {here}"])

    def built_text(self):
        m = self.meta
        pipe_lines = "\n".join(
            f"  {p['label']:6s} {p['dia']*1000:4.0f} mm  {p['length']:5.1f} m  slope "
            f"{100 * p['slope']:4.2f}%  {p['material']} {p['year']}  "
            f"{len(p['links'])} segment(s)" + ("   (outlet)" if p["role"] != "study" else "")
            for p in m["pipes"])
        ext = ", ".join(f"{c} {v/1000:.2f} km" for c, v in m["external_m"].items() if v > 0) or "none"
        values = defaultdict(lambda: "?", {
            "fetched": m.get("data_fetched", "?"), "junction": m["junction"],
            "pipe_lines": pipe_lines, "pyswmm": m.get("pyswmm", "?"), "manning_n": m["manning_n"],
            "scenario_text": m["scenario_text"], "split": m["split"], "unit_label": m["unit_label"],
            "external": ext, "seg_len": f"{m['seg_len']:g}", "adwf_ref": f"{m['adwf_ref']:g}",
            "total_load": f"{sum(m['loads_lps'].values()):.2f}",
            "route_s": m["route_s"], "report_s": m["report_s"],
            "minutes": m["scenario"]["minutes"], "err": f"{m['routing_error_pct']:.2f}",
            "zexag": f"{self.zexag:g}", "bore": f"{self.bore:g}", "shaft": f"{SHAFT_DRAW:g}"})
        try:
            with open(BUILT_DOC, encoding="utf-8") as f:
                raw = f.read().format_map(values)
        except OSError:
            return "HOW_IT_WAS_BUILT.md not found next to view3d.py"
        out, started = [], False
        for line in raw.splitlines():
            if line.startswith("## "):
                started = True
                out += ["", line[3:].upper(), "-" * len(line[3:])]
            elif line.startswith("# "):
                out += [line[2:].upper(), ""]
            elif started:
                out.append(re.sub(r"\*\*|`", "", line))
        return "\n".join(out)

    def _chart(self):
        ch = (self.summary or {}).get("chart")
        if not ch:
            return None
        chart = pv.Chart2D(size=(0.46, 0.55), loc=(0.52, 0.30), x_label=ch["x_label"],
                           y_label=ch["title"])
        for c, ys in ch["series"].items():
            chart.line(ch["x"], np.minimum(ys, 100), color=SERIES_COLOURS.get(c, "black"),
                       width=3.0, label=c)
            chart.scatter(ch["x"], np.minimum(ys, 100), color=SERIES_COLOURS.get(c, "black"),
                          size=6, style="o")
        chart.x_axis.log_scale = True
        chart.y_range = [0, 105]
        chart.visible = False
        self.pl.add_chart(chart)
        return chart

    def show_page(self):
        lines = self.pages[self.tab]
        n = len(lines)
        self.scroll[self.tab] = int(np.clip(self.scroll[self.tab], 0, max(n - PAGE_LINES, 0)))
        a = self.scroll[self.tab]
        page = lines[a:a + PAGE_LINES]
        more = (f"\n\n[lines {a + 1}-{a + len(page)} of {n}   UP / DOWN to scroll]"
                if n > PAGE_LINES else "")
        self.page.SetText(2, "\n".join(page) + more)

    def set_tab(self, tab):
        self.tab = tab
        sim = tab == "sim"
        if not sim:
            self.playing = False
            self.show_page()
        for a in self.scene_actors:
            a.SetVisibility(sim)
        self.page.SetVisibility(not sim)
        if self.chart is not None:
            self.chart.visible = tab == "results"
        if self.slider is not None:
            (self.slider.On if sim else self.slider.Off)()
        for key, b in getattr(self, "tab_buttons", {}).items():
            b.GetRepresentation().SetState(key == tab)
        self.pl.render()

    def add_tabs(self):
        self.tab_buttons = {}
        for i, (key, label) in enumerate(TABS):
            x = 12 + i * 170
            self.tab_buttons[key] = self.pl.add_checkbox_button_widget(
                lambda _s, key=key: self.set_tab(key), value=(key == self.tab), position=(x, 40),
                size=22, border_size=2, color_on="#2f7fd1", color_off="#d9d4ca",
                background_color="#8a8f98")
            self.pl.add_text(label, position=(x + 30, 42), font_size=11, color=COLOURS["text"])

    # ------------------------------------------------------------ interaction
    def interactive(self):
        pl, n = self.pl, len(self.s["t"])
        self.slider = pl.add_slider_widget(lambda v: self.draw(v), [0, n - 1], value=0,
                                           title="frame", pointa=(0.35, 0.93), pointb=(0.95, 0.93),
                                           style="modern", fmt="%.0f", title_height=0.015)

        def toggle():
            self.playing = not self.playing

        def tick(*_):
            if self.playing and self.tab == "sim":
                nxt = (self.frame + 1) % n
                self.slider.GetRepresentation().SetValue(nxt)
                self.draw(nxt)
                pl.render()

        def scroll(delta):
            if self.tab != "sim":
                self.scroll[self.tab] += delta
                self.show_page()
                pl.render()

        def cycle():
            keys = [k for k, _ in TABS]
            self.set_tab(keys[(keys.index(self.tab) + 1) % len(keys)])

        self.add_tabs()
        pl.add_key_event("space", toggle)
        pl.add_key_event("Tab", cycle)
        pl.add_key_event("Up", lambda: scroll(-3))
        pl.add_key_event("Down", lambda: scroll(3))
        pl.add_timer_event(max_steps=10**9, duration=60, callback=tick)
        self.draw(0)
        self.camera()
        pl.show(title=f"Sewer neighbourhood, SWMM playback: {os.path.basename(self.run_dir)}")

    def camera(self):
        self.pl.reset_camera()
        cam = self.pl.camera
        f = np.array(cam.focal_point)
        dist = np.linalg.norm(np.array(cam.position) - f)
        az, el = np.radians(self.azimuth), np.radians(self.elevation)
        cam.position = f + dist * 0.8 * np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az),
                                                 np.sin(el)])
        cam.up = (0, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", nargs="?")
    ap.add_argument("--zexag", type=float, default=8.0)
    ap.add_argument("--bore", type=float, default=8.0)
    ap.add_argument("--screenshot")
    ap.add_argument("--frame", type=int, default=-1)
    ap.add_argument("--gif")
    ap.add_argument("--tab", choices=[k for k, _ in TABS], default="sim")
    args = ap.parse_args()
    sc = Scene(args.run or latest_run(), args.zexag, args.bore,
               off_screen=bool(args.screenshot or args.gif))
    if args.screenshot:
        sc.draw(args.frame if args.frame >= 0 else len(sc.s["t"]) - 1)
        sc.camera()
        sc.add_tabs()
        sc.set_tab(args.tab)
        sc.pl.screenshot(args.screenshot)
        print("wrote", args.screenshot)
    elif args.gif:
        sc.draw(0)
        sc.camera()
        sc.pl.open_gif(args.gif, fps=20)
        for k in range(0, len(sc.s["t"]), 3):
            sc.draw(k)
            sc.pl.write_frame()
        sc.pl.close()
        print("wrote", args.gif)
    else:
        sc.interactive()


if __name__ == "__main__":
    main()
