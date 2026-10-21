"""
one_pool/scheduler.py - submit every run of every case at once, the longest first.

sim25_grid.run_case calls pool.map once per case and waits for it, so the last runs of each
case leave workers idle until the slowest finishes, and the case's baseline runs alone before
its growth runs can start (on a whole-area case, one ~60 s baseline on 1 of 6 workers). Over 5
or 12 cases those tails add up; they cost most when runs differ in length, which they do once
each run stops when settled (converge): a wet case's runs are several times a dry case's.

run_all takes any concurrent.futures executor (a local ProcessPoolExecutor, or Dask's
Client.get_executor() from distributed/dask_pool.py), submits every task, most expensive first
by the given cost, and returns results in task order. Longest-first is the usual greedy for
spreading uneven jobs over a fixed number of workers (LPT scheduling): the short runs left at
the end fill the gaps.
"""
import time
from concurrent.futures import as_completed


def run_all(executor, fn, tasks, cost=None, label="runs", every=200):
    order = sorted(range(len(tasks)), key=lambda i: -(cost(tasks[i]) if cost else 0))
    futures = {executor.submit(fn, tasks[i]): i for i in order}
    out = [None] * len(tasks)
    t0 = time.time()
    for done, f in enumerate(as_completed(futures), 1):
        out[futures[f]] = f.result()
        if done % every == 0 or done == len(tasks):
            el = time.time() - t0
            print(f"  {label}: {done}/{len(tasks)} in {el/60:.1f} min, about "
                  f"{el / done * (len(tasks) - done) / 60:.0f} min left", flush=True)
    return out
