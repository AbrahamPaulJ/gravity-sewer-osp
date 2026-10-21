"""
distributed/dask_pool.py - a concurrent.futures executor backed by a Dask cluster.

For a few lab or team machines on one network, without a scheduler like SLURM. Dask is not in
requirements.txt; install it only where it is used: pip install "distributed>=2024.1".

    # on one machine (the scheduler; it does no SWMM work itself)
    dask scheduler                                   # prints tcp://<host>:8786
    # on each machine with the repository and its Python environment, from simulation_src
    dask worker tcp://<host>:8786 --nworkers 6 --nthreads 1
    # anywhere, from simulation_src
    python -m speedups.fast_grid --cases all --executor dask --scheduler tcp://<host>:8786

--nthreads 1 because a SWMM run holds one core and pyswmm allows one simulation per process.
--nworkers is the machine's physical core count. Tasks carry their hotstart as bytes and write
their run folders to each worker's own temp directory, so the machines share no disk; the
results come back to the machine that ran fast_grid.
"""


def executor(address):
    from distributed import Client
    client = Client(address)
    n = sum(w["nthreads"] for w in client.scheduler_info()["workers"].values())
    print(f"dask: {address}, {n} worker threads", flush=True)
    return client.get_executor()
