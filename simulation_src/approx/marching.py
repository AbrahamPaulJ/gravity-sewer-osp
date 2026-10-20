"""marching.py - the one-pass approximation of Sim 2.5, without SWMM, kept for comparison.

    flows    loads summed down the network in the recorded direction (topological order);
             at a node with several outlets, shared in proportion to full-bore capacity; a
             pumped wet well's inflow passed to its discharge node
    levels   upstream from each outlet, per pipe, the energy standard step (gradually varied
             flow) from the larger of the downstream water level and critical depth (normal
             depth on a steep pipe), with full-pipe friction Sf = S0 (Q/Qfull)^2 once the pipe
             is full; never below normal depth at the upstream end. A chamber's level is the
             highest its outlets need, capped at its lid.

What it cannot do, and netsolve.py does: flow against the recorded direction (loops through
relief pipes in surcharge), water lost at a lid (it caps the level but passes the flow on),
and splits set by water level. The relief pipe that closes a loop through a pump (4433446,
back to N183's wet well) is dropped, as config.js's raised-overflow setting does.
"""
import math, os, sys

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SRC not in sys.path:
    sys.path.insert(0, SRC)
import model, sim25

G = 9.81


def geom(y, D):
    y = min(max(y, 1e-6), D)
    if y >= D:
        return math.pi * D * D / 4, D / 4
    th = 2 * math.acos(1 - 2 * y / D)
    A = D * D / 8 * (th - math.sin(th)); P = D * th / 2
    return A, A / P


def qman(y, D, S, n):
    A, R = geom(y, D)
    return A * R ** (2 / 3) * math.sqrt(S) / n


def ycrit(Q, D):
    """Critical depth in a circular pipe, m: Q^2/g = A^3/T. Capped at 0.95 D."""
    if Q <= 0:
        return 0.0

    def f(y):
        th = 2 * math.acos(1 - 2 * y / D); A = D * D / 8 * (th - math.sin(th)); T = D * math.sin(th / 2)
        return A ** 3 / max(T, 1e-9) - Q * Q / G
    lo, hi = 1e-6, 0.95 * D
    if f(hi) < 0:
        return hi
    for _ in range(40):
        mid = (lo + hi) / 2
        if f(mid) < 0: lo = mid
        else: hi = mid
    return (lo + hi) / 2


def ynorm(Q, D, S, n):
    if Q <= 0:
        return 0.0
    if Q >= qman(0.938 * D, D, S, n):
        return D
    lo, hi = 1e-6, 0.938 * D
    for _ in range(40):
        mid = (lo + hi) / 2
        if qman(mid, D, S, n) < Q: lo = mid
        else: hi = mid
    return (lo + hi) / 2


class Net:
    def __init__(self, m):
        self.m = m
        L = self.links = m.links
        self.n = [model.manning_of(lk.material) for lk in L]
        self.S = [max((lk.inv_up - lk.inv_down) / lk.length, 1e-4) if lk.length > 0 else 1e-3 for lk in L]
        self.qfull = [qman(lk.dia, lk.dia, s, n) for lk, s, n in zip(L, self.S, self.n)]
        ov = {p.asset_id for p in sim25.network().pipes if getattr(p, "overflow", False)}
        asset = {pi.label: pi.asset_id for pi in m.pipes}
        g = {}
        for lk in L: g.setdefault(lk.up, set()).add(lk.down)
        for _, w, d in m.pumps: g.setdefault(w, set()).add(d)

        def reach(a, b):
            st, seen = [a], {a}
            while st:
                x = st.pop()
                if x == b: return True
                for y in g.get(x, ()):
                    if y not in seen: seen.add(y); st.append(y)
            return False
        self.dropped = [lk.name for lk in L if asset.get(lk.name) in ov and reach(lk.down, lk.up)]
        self.outs = {}
        for k, lk in enumerate(L):
            if lk.name not in self.dropped:
                self.outs.setdefault(lk.up, []).append(k)
        self.share = {u: [(k, self.qfull[k] / sum(self.qfull[j] for j in ks)) for k in ks]
                      for u, ks in self.outs.items()}
        self.pump = {w: d for _, w, d in m.pumps}
        downs = {u: [L[k].down for k in ks] for u, ks in self.outs.items()}
        for w, d in self.pump.items(): downs.setdefault(w, []).append(d)
        indeg = {nm: 0 for nm in m.nodes}
        for u, ds in downs.items():
            for d in ds: indeg[d] += 1
        order, st = [], [nm for nm, v in indeg.items() if v == 0]
        while st:
            u = st.pop(); order.append(u)
            for d in downs.get(u, []):
                indeg[d] -= 1
                if indeg[d] == 0: st.append(d)
        assert len(order) == len(m.nodes), "cycle"
        self.order = order
        self.chambers = list(m.chambers)
        self.crown = {}
        for c in self.chambers:
            ks = self.outs.get(c)
            k = min(ks, key=lambda j: L[j].inv_up) if ks else None
            self.crown[c] = (L[k].inv_up - m.nodes[c].invert + L[k].dia) if k is not None else 9e9

    def _up_level(self, k, Q, Hd, steps):
        """Water level needed at the pipe's upstream end to pass Q into downstream level Hd."""
        lk = self.links[k]; D, S, n = lk.dia, self.S[k], self.n[k]
        yn = ynorm(Q, D, S, n)
        if Q <= 0:
            return max(lk.inv_up, Hd)       # no flow: the pond level from downstream, if any
        yc = ycrit(Q, D)
        Af = math.pi * D * D / 4

        def area(y): return Af if y >= D else geom(y, D)[0]

        def sf(y):
            if y >= D: return S * (Q / self.qfull[k]) ** 2
            A, R = geom(y, D); return (Q * n / (A * R ** (2 / 3))) ** 2

        def spec(y): return y + (Q / area(y)) ** 2 / (2 * G)
        steep = yn < yc and yn < D
        y = max(Hd - lk.inv_down, yc if not steep else yn, 1e-4)
        if (steep or yn < D) and y <= yn + 1e-6:
            return lk.inv_up + yn
        dx = lk.length / steps
        for i in range(1, steps + 1):
            z0 = lk.inv_down + (lk.inv_up - lk.inv_down) * (i - 1) / steps
            z1 = lk.inv_down + (lk.inv_up - lk.inv_down) * i / steps
            E0 = z0 + spec(y)
            ynew = y
            for _ in range(3):      # friction averaged over the slice, two corrections
                target = E0 + 0.5 * (sf(y) + sf(ynew)) * dx - z1
                lo = yc
                if spec(lo) >= target: ynew = lo; continue
                hi = max(y, D) + 50.0
                for _ in range(50):
                    mid = (lo + hi) / 2
                    if spec(mid) < target: lo = mid
                    else: hi = mid
                ynew = (lo + hi) / 2
            y = ynew
            if yn < D and y <= yn: y = yn; break
        # SWMM's upstream node is not drawn down below normal depth by a free drop downstream
        return lk.inv_up + (max(y, yn) if yn < D else y)

    def solve(self, loads, steps=10):
        """Depth (m) at every chamber for loads {node name: L/s}."""
        m, L = self.m, self.links
        q = dict.fromkeys(m.nodes, 0.0)
        for nm, v in loads.items(): q[nm] += v / 1000.0
        Q = [0.0] * len(L)
        for u in self.order:
            if u in self.share:
                for k, f in self.share[u]:
                    Q[k] = q[u] * f; q[L[k].down] += Q[k]
            elif u in self.pump:
                q[self.pump[u]] += q[u]
        H = {}
        for u in reversed(self.order):
            nd = m.nodes[u]
            if u not in self.outs:
                H[u] = nd.invert; continue
            lvl = max(self._up_level(k, Q[k], H[L[k].down], steps) for k in self.outs[u])
            if nd.kind == "chamber":
                lvl = min(lvl, nd.invert + nd.max_depth)
            H[u] = max(lvl, nd.invert)
        return {c: H[c] - m.nodes[c].invert for c in self.chambers}
