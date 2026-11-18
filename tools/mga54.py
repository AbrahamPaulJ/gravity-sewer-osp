"""Lat/lon to MGA zone 54 easting/northing in metres, the transform used for the Sim 3 buildings (GDA treated as WGS84 at this scale)."""
import math
def to_mga54(lon, lat):
    a, f = 6378137.0, 1 / 298.257222101
    k0, lon0 = 0.9996, math.radians(141.0)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    ph, la = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(ph) ** 2)
    T = math.tan(ph) ** 2; C = ep2 * math.cos(ph) ** 2; A = math.cos(ph) * (la - lon0)
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * ph - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*ph)
             + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*ph) - (35*e2**3/3072) * math.sin(6*ph))
    E = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T*T+72*C-58*ep2)*A**5/120) + 500000
    Nn = k0 * (M + N*math.tan(ph)*(A*A/2 + (5-T+9*C+4*C*C)*A**4/24 + (61-58*T+T*T+600*C-330*ep2)*A**6/720)) + 10000000
    return E, Nn
