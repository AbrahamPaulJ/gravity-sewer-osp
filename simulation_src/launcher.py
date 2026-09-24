#!/usr/bin/env python3
"""
launcher.py - menu used by run_simulation.bat. Runs an experiment if its results are
missing, then opens the 3D viewer on its most informative run. Returns to the menu when
the viewer window is closed.
"""
import glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")
PY = sys.executable

MENU = [
    ("1", "Warning time: how early does a sensor at each chamber see an overflow coming", "warning"),
    ("2", "Load ladder: at what steady load does each chamber fill, surcharge, spill", "ladder"),
    ("3", "Growth: how much new development at each chamber before trouble, and where", "growth"),
    ("4", "Compare load splits: equal vs catchment vs along-pipe", "compare"),
    ("5", "Original exploration: equal inflow, ramp to 60 L/s per chamber", "original"),
    ("6", "Open any saved run", "pick"),
    ("r", "Re-run all experiments from scratch", "rerun"),
    ("q", "Quit", "quit"),
]


def call(*args):
    return subprocess.call([PY, *args], cwd=HERE)


def summary(name):
    p = os.path.join(RES, name, "summary.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def ensure(experiment, split="along"):
    s = summary(f"{experiment}_{split}")
    if s is None:
        print(f"\nRunning {experiment} ({split}), first time only...")
        if call("experiments.py", experiment, "--split", split) != 0:
            return None
        s = summary(f"{experiment}_{split}")
    return s


def view(run_dir):
    print(f"\nOpening {os.path.relpath(run_dir, HERE)}. Close the 3D window to return here.")
    print("Tabs: Simulation / Results / How it was built (TAB key). SPACE plays.")
    call("view3d.py", run_dir)


def main():
    while True:
        print("\n=== Sewer neighbourhood simulation, junction 441, Walkerville ===")
        for key, label, _ in MENU:
            print(f"  {key}  {label}")
        choice = input("Choose [Enter = 1]: ").strip().lower() or "1"
        action = next((a for k, _, a in MENU if k == choice), None)
        if action in (None,):
            print("Not an option.")
        elif action == "quit":
            return
        elif action in ("warning", "ladder", "growth"):
            s = ensure(action)
            if s:
                view(os.path.join(RES, f"{action}_along", s["default_run"]))
        elif action == "compare":
            if summary("compare") is None:
                print("\nRunning the ladder under all three splits, a few minutes...")
                call("experiments.py", "compare")
            print("\n" + "\n".join(summary("compare")["text"]))
            sp = input("Open which split? e = equal, c = catchment, a = along [Enter = a]: ").strip().lower()
            split = {"e": "equal", "c": "catchment"}.get(sp, "along")
            s = ensure("ladder", split)
            if s:
                view(os.path.join(RES, f"ladder_{split}", s["default_run"]))
        elif action == "original":
            d = os.path.join(RES, "runs", "equal_ramp_60")
            if not os.path.exists(os.path.join(d, "meta.json")):
                call("hydraulics.py", "--split", "equal", "--scenario", "ramp", "--unit", "60",
                     "--minutes", "60")
            view(d)
        elif action == "pick":
            runs = sorted(os.path.dirname(p) for p in
                          glob.glob(os.path.join(RES, "**", "meta.json"), recursive=True))
            if not runs:
                print("No saved runs yet.")
                continue
            for i, r in enumerate(runs, 1):
                print(f"  {i:3d}  {os.path.relpath(r, RES)}")
            pick = input("Number: ").strip()
            if pick.isdigit() and 1 <= int(pick) <= len(runs):
                view(runs[int(pick) - 1])
        elif action == "rerun":
            call("experiments.py", "all")


if __name__ == "__main__":
    main()
