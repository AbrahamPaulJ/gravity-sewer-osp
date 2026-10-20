"""netsolve.py - steady state of the whole Sim 2.5 network by Newton's method, without SWMM.

Unknowns: the water level H at every node. Each pipe's flow is a function of the levels at
its two ends, so flow can run either way (loops through relief pipes, reversal in
surcharge), and every node must balance (inflow - outflow + load = 0):

    Q = A(ybar) R(ybar)^(2/3) / n * sqrt(Sw),   Sw = (H_a - H_b) / L      a = the higher end
        end b  if the water there is below min(critical, normal) depth for the flow arriving,
               the end depth is that, as SWMM sets a free-falling end
        ybar   mean of the two end depths. Below 0.985 of the bore: the part-full section.
               Above it: SWMM's Preissmann slot (SURCHARGE_METHOD SLOT), area
               Afull + (ybar - D) x slot width (Sjoberg's width up to 1.78 bores deep, 1% of
               the bore beyond) and hydraulic radius held at full
        limit  flowing forward on a free surface, Q <= Manning normal flow at the upstream
               depth whenever Sw < S0 or the upstream Froude number >= 1
               (SWMM's NORMAL_FLOW_LIMITED BOTH)

This is SWMM's dynamic-wave momentum balance at steady state with the inertial terms dropped,
which INERTIAL_DAMPING PARTIAL does as flow nears critical. Three changes make it solvable by
Newton, each small where it acts:
    BLEND   SWMM's conveyance jumps about 4.5% where the slot starts (R switches from the
            part-full value to full at 0.985 of the bore), so no steady state exists across
            it (SWMM oscillates there). R and A are blended into the slot from 0.93.
    S_EPS   below this water-surface gradient, flow is linear in the gradient, not its root,
            so a pipe with level water at both ends (short pipes, flow about to reverse) has
            a finite derivative.
    EPS_K   a negligible conductance on every pipe, so a dry node's level stays determined.

Boundary conditions: outfalls and wet wells hold their invert level (an ideal pump keeps its
wet well empty and passes what reaches it to its discharge node); a chamber cannot rise above
its lid and spills the surplus (ALLOW_PONDING NO); inline junctions never spill (SurDepth
100 m). Manhole minor losses are not modelled, because the SWMM model has none.
"""
import os, sys
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SRC not in sys.path:
    sys.path.insert(0, SRC)
import model

G = 9.81
BLEND = [True]         # make the slot onset continuous
S_EPS = 3e-4           # gradient below which flow is linear in it, not its root
SLOT = [True]          # emulate SWMM's slot conveyance in surcharge (False: a real full pipe)
EPS_K = 1e-7           # m2/s, a negligible conductance on every pipe so dry nodes stay determined


def geom_v(y, D):
    """Area, hydraulic radius and top width of a circular section at depth y (arrays)."""
    full = y >= D
    yy = np.clip(y, 1e-8, D)
    th = 2 * np.arccos(np.clip(1 - 2 * yy / D, -1.0, 1.0))
    A = D * D / 8 * (th - np.sin(th))
    P = D * th / 2
    R = A / np.maximum(P, 1e-12)
    T = D * np.sin(th / 2)
    Af = np.pi * D * D / 4
    return np.where(full, Af, A), np.where(full, D / 4, R), np.where(full, 0.0, T)


def qn_v(y, D, S, n):
    """Manning normal flow at depth y."""
    A, R, _ = geom_v(y, D)
    return A * R ** (2 / 3) * np.sqrt(S) / n


def yn_v(Q, D, S, n):
    """Normal depth for flow Q (the bore where Q exceeds the part-full maximum)."""
    qmax = qn_v(0.938 * D, D, S, n)
    lo, hi = np.full_like(Q, 1e-8), 0.938 * D
    for _ in range(30):
        mid = (lo + hi) / 2
        low = qn_v(mid, D, S, n) < Q
        lo = np.where(low, mid, lo); hi = np.where(low, hi, mid)
    y = (lo + hi) / 2
    return np.where(Q <= 0, 0.0, np.where(Q >= qmax, D, y))


def yc_v(Q, D):
    """Critical depth for flow Q, capped at 0.95 of the bore."""
    lo, hi = np.full_like(Q, 1e-8), 0.95 * D
    A, _, T = geom_v(hi, D)
    cap = A ** 3 / np.maximum(T, 1e-12) < Q * Q / G
    for _ in range(30):
        mid = (lo + hi) / 2
        A, _, T = geom_v(mid, D)
        low = A ** 3 / np.maximum(T, 1e-12) < Q * Q / G
        lo = np.where(low, mid, lo); hi = np.where(low, hi, mid)
    y = (lo + hi) / 2
    return np.where(Q <= 0, 0.0, np.where(cap, 0.95 * D, y))


def q_links_v(Hu, Hd, zu, zd, D, Lk, n, S0):
    """Flow in every pipe (m3/s, positive in the recorded direction) from the levels at its
    two ends, as the module docstring sets out."""
    fwd = Hu >= Hd
    Ha = np.where(fwd, Hu, Hd); Hb = np.where(fwd, Hd, Hu)
    za = np.where(fwd, zu, zd); zb = np.where(fwd, zd, zu)
    S = np.where(fwd, S0, -S0)
    sgn = np.where(fwd, 1.0, -1.0)
    leak = EPS_K * (Hu - Hd)
    ya = Ha - za
    yac = np.clip(ya, 0.0, D)
    Sm = np.maximum(S, 1e-4)
    qn_up = qn_v(yac, D, Sm, n)
    yb = Hb - zb
    ye = np.minimum(yc_v(qn_up, D), yn_v(qn_up, D, Sm, n))
    yb = np.where((yb < D) & (yb < ye), ye, yb)
    yb = np.maximum(yb, 0.0)
    Sw = (Ha - (zb + yb)) / Lk
    if SLOT[0]:
        ybar = 0.5 * (np.maximum(ya, 0.0) + yb)
        yN = ybar / D
        w = np.where(yN > 1.78, 0.01 * D, D * 0.5423 * np.exp(-np.minimum(yN, 1.78) ** 2.4))
        A0, R0, _ = geom_v(ybar, D)
        slot = yN >= 0.985078
        As = np.pi * D * D / 4 + (ybar - D) * w
        A = np.where(slot, As, A0)
        R = np.where(slot, D / 4, R0)
        if BLEND[0]:
            s = np.clip((yN - 0.93) / (0.985078 - 0.93), 0.0, 1.0)
            s = s * s * (3 - 2 * s)
            yb_ = np.minimum(ybar, 0.985078 * D)
            A_on, R_on, _ = geom_v(yb_, D)
            A_slot_on = np.pi * D * D / 4 + (0.985078 * D - D) * D * 0.5423 * np.exp(-0.985078 ** 2.4)
            A = np.where(slot, As, A0 + s * (A_slot_on - A_on))
            R = np.where(slot, D / 4, R0 + s * (D / 4 - R_on))
    else:
        ybar = np.where((ya >= D) & (yb >= D), D, 0.5 * (yac + np.minimum(yb, D)))
        A, R, _ = geom_v(ybar, D)
    Swp = np.maximum(Sw, 0.0)
    root = Swp / (Swp * Swp + S_EPS * S_EPS) ** 0.25 if S_EPS > 0 else np.sqrt(Swp)
    Q = A * R ** (2 / 3) * root / n
    A1, _, T1 = geom_v(yac, D)
    fr = (Q / np.maximum(A1, 1e-12)) / np.sqrt(G * A1 / np.maximum(T1, 1e-9))
    lim = fwd & (ya < D) & (S > 0) & ((Sw < S) | (fr >= 1.0))
    Q = np.where(lim, np.minimum(Q, qn_up), Q)
    Q = np.where((ya <= 0) | (Sw <= 0), 0.0, Q)
    return sgn * Q + leak


class NetSolve:
    """The steady state of a sim25.Sim25Model's network."""

    def __init__(self, m):
        self.m = m
        L = self.links = m.links
        names = list(m.nodes)
        self.idx = {nm: i for i, nm in enumerate(names)}
        self.names = names
        self.N = len(names)
        self.inv = np.array([m.nodes[nm].invert for nm in names])
        self.rim = np.array([m.nodes[nm].invert + m.nodes[nm].max_depth
                             if m.nodes[nm].kind == "chamber" else np.inf for nm in names])
        self.up = np.array([self.idx[lk.up] for lk in L])
        self.dn = np.array([self.idx[lk.down] for lk in L])
        self.zu = np.array([lk.inv_up for lk in L])
        self.zd = np.array([lk.inv_down for lk in L])
        self.D = np.array([lk.dia for lk in L])
        self.len = np.array([max(lk.length, 0.1) for lk in L])
        self.n = np.array([model.manning_of(lk.material) for lk in L])
        self.S0 = np.array([(lk.inv_up - lk.inv_down) / max(lk.length, 0.1) for lk in L])
        self.fixed0 = np.zeros(self.N, bool)
        for nm, nd in m.nodes.items():
            if nd.kind == "outfall":
                self.fixed0[self.idx[nm]] = True
        self.pump = [(self.idx[w], self.idx[d]) for _, w, d in m.pumps]
        for w, _ in self.pump:
            self.fixed0[w] = True
        self.chambers = list(m.chambers)
        self.crown = {}
        outs = {}
        for k, lk in enumerate(L):
            outs.setdefault(lk.up, []).append(k)
        for c in self.chambers:
            ks = outs.get(c)
            k = min(ks, key=lambda j: L[j].inv_up) if ks else None
            self.crown[c] = (L[k].inv_up - m.nodes[c].invert + L[k].dia) if k is not None else 9e9

    # ------------------------------------------------------------ the network
    def _q(self, Hu, Hd):
        return q_links_v(Hu, Hd, self.zu, self.zd, self.D, self.len, self.n, self.S0)

    def _resid(self, H, load, fixed):
        Q = self._q(H[self.up], H[self.dn])
        r = load.copy()
        np.add.at(r, self.dn, Q)
        np.add.at(r, self.up, -Q)
        for w, d in self.pump:
            r[d] += r[w]          # an ideal pump passes all that reaches its wet well
        return r, Q

    def _jac(self, H, Q, fixed, h=1e-6):
        Hu, Hd = H[self.up], H[self.dn]
        a = (self._q(Hu + h, Hd) - Q) / h
        b = (self._q(Hu, Hd + h) - Q) / h
        u, d = self.up, self.dn
        rows = [d, d, u, u]; cols = [u, d, u, d]; vals = [a, b, -a, -b]
        for w, p in self.pump:
            into = d == w
            rows += [np.full(into.sum(), p), np.full(into.sum(), p)]
            cols += [u[into], d[into]]; vals += [a[into], b[into]]
        return sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
                             shape=(self.N, self.N))

    def _load(self, loads_lps):
        load = np.zeros(self.N)
        for nm, v in loads_lps.items():
            load[self.idx[nm]] += v / 1000.0
        return load

    def _finish(self, H, Q, it, lid, load):
        self.H, self.Q, self.iters, self.lid = H, Q, it + 1, lid
        r, _ = self._resid(H, load, self.fixed0 | lid)
        self.spill = {self.names[i]: float(r[i] * 1000) for i in np.where(lid)[0] if r[i] > 1e-7}
        return {c: float(H[self.idx[c]] - self.inv[self.idx[c]]) for c in self.chambers}

    def solve_newton(self, loads_lps, H0=None, maxit=60, tol=1e-6, verbose=False):
        """Damped Newton with a lid active set. loads_lps: {node name: L/s}; H0: a starting
        level at every node (a baseline's self.H). Returns depth (m) at every chamber;
        self.converged, self.spill ({chamber: L/s} lost at the lid), self.H, self.Q."""
        load = self._load(loads_lps)
        H = (self.inv + 0.02) if H0 is None else H0.copy()
        H[self.fixed0] = self.inv[self.fixed0]
        H = np.minimum(H, self.rim)
        lid = np.zeros(self.N, bool)
        self.converged = False
        for it in range(maxit):
            fx = self.fixed0 | lid
            r, Q = self._resid(H, load, fx)
            fi = np.where(~fx)[0]
            res = np.abs(r[fi]).max() if fi.size else 0.0
            changed = False
            rel = lid & (r < -1e-9)
            if rel.any():
                lid[rel] = False; changed = True
            over = (~self.fixed0) & (~lid) & (H > self.rim + 1e-6)
            if over.any():
                lid[over] = True; H[over] = self.rim[over]; changed = True
            if res < tol and not changed:
                self.converged = True
                break
            if changed:
                continue
            J = self._jac(H, Q, fx)[fi][:, fi]
            try:
                dH = spla.spsolve(J.tocsc(), -r[fi])
            except Exception:
                break
            if not np.all(np.isfinite(dH)):
                break
            dH = np.clip(dH, -0.5, 0.5)
            lam, base = 1.0, np.linalg.norm(r[fi])
            for _ in range(8):
                Hn = H.copy(); Hn[fi] += lam * dH
                rn, _ = self._resid(Hn, load, fx)
                if np.linalg.norm(rn[fi]) < base or lam < 0.02:
                    break
                lam *= 0.5
            H = Hn
            if verbose:
                print(it, "max residual %.3g L/s, lid %d" % (res * 1000, lid.sum()))
        return self._finish(H, Q, it, lid, load)

    def solve_ptc(self, loads_lps, H0=None, maxit=600, tol=1e-6, verbose=False, dt0=20.0, dt_max=1e6):
        """Pseudo-transient continuation: implicit steps of A dH/dt = r(H) with dt growing as
        the residual falls (switched evolution relaxation), and a step that worsens the
        residual threefold undone. The fallback where Newton does not converge."""
        load = self._load(loads_lps)
        if not hasattr(self, "area"):
            area = np.zeros(self.N)
            np.add.at(area, self.up, 0.5 * self.D * self.len)
            np.add.at(area, self.dn, 0.5 * self.D * self.len)
            self.area = np.maximum(area, 0.87)
        H = (self.inv + 0.02) if H0 is None else H0.copy()
        H[self.fixed0] = self.inv[self.fixed0]
        H = np.minimum(H, self.rim)
        lid = np.zeros(self.N, bool)
        dt, res_old = dt0, None
        self.converged = False
        for it in range(maxit):
            fx = self.fixed0 | lid
            r, Q = self._resid(H, load, fx)
            fi = np.where(~fx)[0]
            res = np.abs(r[fi]).max() if fi.size else 0.0
            rel = lid & (r < -1e-9)
            if rel.any():
                lid[rel] = False
                continue
            if res < tol:
                self.converged = True
                break
            if res_old is not None:
                dt = min(dt * min(max(res_old / max(res, 1e-30), 0.5), 2.0), dt_max)
            res_old = res
            J = self._jac(H, Q, fx)[fi][:, fi]
            M = (J - sp.diags(self.area[fi] / dt)).tocsc()
            try:
                dH = spla.spsolve(M, -r[fi])
            except Exception:
                dt *= 0.25
                continue
            if not np.all(np.isfinite(dH)):
                dt *= 0.25
                continue
            Hn = H.copy(); Hn[fi] += np.clip(dH, -0.3, 0.3)
            rn, _ = self._resid(np.minimum(Hn, np.where(self.fixed0, np.inf, self.rim)), load, fx)
            if np.abs(rn[fi]).max() > 3 * res and dt > 1e-3:
                dt *= 0.3
                res_old = None
                continue
            H = Hn
            over = (~self.fixed0) & (H > self.rim)
            if over.any():
                H[over] = self.rim[over]
                lid |= over
            if verbose and it % 10 == 0:
                print(it, "max residual %.3g L/s, dt %.3g, lid %d" % (res * 1000, dt, lid.sum()))
        return self._finish(H, Q, it, lid, load)

    def solve(self, loads_lps, H0=None, verbose=False, ptc_iters=1500, dt_max=120.0):
        """Newton first; if it does not converge, pseudo-transient stepping from H0."""
        d = self.solve_newton(loads_lps, H0=H0, verbose=verbose)
        self.method = "newton"
        if self.converged:
            return d
        it0 = self.iters
        d = self.solve_ptc(loads_lps, H0=H0, maxit=ptc_iters, verbose=verbose, dt_max=dt_max)
        self.iters += it0
        self.method = "ptc"
        return d
