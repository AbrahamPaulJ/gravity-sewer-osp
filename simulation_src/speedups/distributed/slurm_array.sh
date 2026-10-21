#!/bin/bash
# The Sim 2.5 fast grid as a SLURM job array on a university HPC cluster.
#
#   sbatch --array=0-15 speedups/distributed/slurm_array.sh      # from simulation_src
#   # when every task has finished:
#   python -m speedups.distributed.merge --out "$OUT"
#
# Each array task is one shard and runs one SWMM run per CPU it is given. Set SHARDS to the
# array's size, the partition and the module or environment lines to the cluster's own, and
# OUT to a folder on the shared file system. The cluster's documentation gives its limits.
#SBATCH --job-name=sim25-grid
#SBATCH --cpus-per-task=8
#SBATCH --mem=8G
#SBATCH --time=04:00:00
#SBATCH --output=sim25-grid-%A_%a.log

set -euo pipefail
SHARDS=${SHARDS:-16}
OUT=${OUT:-$PWD/results/sim25/grid_whole_fast}
CASES=${CASES:-all}

# module load Python/3.11      # or: source ~/venvs/sewer/bin/activate
python -m speedups.fast_grid --cases "$CASES" --workers "$SLURM_CPUS_PER_TASK" \
    --shard "$SLURM_ARRAY_TASK_ID/$SHARDS" --out "$OUT"
