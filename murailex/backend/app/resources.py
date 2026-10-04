"""CPU budget actually available to this process.

os.cpu_count() reports the host's CPUs; in a container the cgroup CPU quota (and the affinity
mask) can be far smaller. Sizing decode threads to the host count oversubscribes the quota and
makes inference many times slower, so thread pools use the effective budget below."""
from __future__ import annotations

import math
import os


def _cgroup_quota() -> float | None:
    try:  # cgroup v2
        quota, period = open("/sys/fs/cgroup/cpu.max").read().split()[:2]
        if quota != "max":
            return int(quota) / int(period)
    except (OSError, ValueError):
        pass
    try:  # cgroup v1
        quota = int(open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read())
        period = int(open("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read())
        if quota > 0 and period > 0:
            return quota / period
    except (OSError, ValueError):
        pass
    return None


def effective_cpus() -> int:
    n = os.cpu_count() or 1
    try:
        n = min(n, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        pass
    quota = _cgroup_quota()
    if quota is not None:
        n = min(n, max(1, math.floor(quota)))
    return max(1, n)


def worker_threads() -> int:
    """Leave one core for the API/UI when there is more than one."""
    n = effective_cpus()
    return max(1, n - 1) if n > 1 else 1
