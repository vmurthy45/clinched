#!/usr/bin/env python3
"""Turn an unpacked F1DB CSV release into the site's static JSON.

    python3 build_data.py /path/to/f1db-csv

Writes data/index.json plus data/seasons/<year>.json. Before writing, it
re-derives every driver's final total from race points under that season's
dropped-score rule and reports anything that disagrees with the official table.
"""
import csv, json, os, sys
from collections import Counter, defaultdict

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(os.path.join(OUT, "seasons"), exist_ok=True)


def read(name):
    with open(os.path.join(SRC, f"f1db-{name}.csv"), encoding="utf8") as f:
        return list(csv.DictReader(f))


def num(v):
    return float(v) if v not in ("", None) else 0.0


def tidy(v):
    """Whole points as ints; keep the odd fractions from shared drives."""
    v = round(v, 2)
    return int(v) if v == int(v) else v


# How many results counted. "split" seasons took the best n1 of the first
# `at` rounds and the best n2 of the rest.
def rule_for(year):
    best = {1950: 4, 1951: 4, 1952: 4, 1953: 4, 1954: 5, 1955: 5, 1956: 5,
            1957: 5, 1958: 6, 1959: 5, 1960: 6, 1961: 5, 1962: 5, 1963: 6,
            1964: 6, 1965: 6, 1966: 5}
    split = {1967: (6, 5, 4), 1968: (6, 5, 5), 1969: (6, 5, 4), 1970: (7, 6, 5),
             1971: (6, 5, 4), 1972: (6, 5, 5), 1973: (8, 7, 6), 1974: (8, 7, 6),
             1975: (7, 6, 6), 1976: (8, 7, 7), 1977: (9, 8, 7), 1978: (8, 7, 7),
             1979: (7, 4, 4), 1980: (7, 5, 5)}
    if year in best:
        return {"t": "best", "n": best[year]}
    if year in split:
        at, n1, n2 = split[year]
        return {"t": "split", "at": at, "n1": n1, "n2": n2}
    if 1981 <= year <= 1990:
        return {"t": "best", "n": 11}
    return {"t": "all"}


def counted(scores, rule):
    """Championship total from a per-round list of points."""
    if rule["t"] == "all":
        return sum(scores)
    if rule["t"] == "best":
        return sum(sorted(scores, reverse=True)[: rule["n"]])
    a = sorted(scores[: rule["at"]], reverse=True)[: rule["n1"]]
    b = sorted(scores[rule["at"]:], reverse=True)[: rule["n2"]]
    return sum(a) + sum(b)


# Alternative scoring. None means the points as awarded, with nothing dropped.
# Mirrored by SCORING in app.js.
TABLES = {"alldrop": None, "modern": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
          "t2003": [10, 8, 6, 5, 4, 3, 2, 1], "t1991": [10, 6, 4, 3, 2, 1],
          "t1961": [9, 6, 4, 3, 2, 1], "wins": [1]}


def rescore(raw, place, table, n):
    if table is None:
        return [sum(row) for row in raw]
    total = [0.0] * len(raw)
    for k in range(n):
        at = Counter(row[k] for row in place if isinstance(row[k], int))
        for i, row in enumerate(place):
            p = row[k]
            if isinstance(p, int) and p <= len(table):
                total[i] += table[p - 1] / at[p]  # shared drives split the score
    return total


def fl_bonus(year):
    return 1 if 1950 <= year <= 1959 or 2019 <= year <= 2024 else 0


# Constructor colours, chosen to stay readable as thin lines on white.
TEAM = {
    "ferrari": "#d40a1e", "mercedes": "#00a19b", "red-bull": "#16307a",
    "williams": "#0a6fd6", "lotus": "#0b6b3a", "renault": "#e0a800",
    "brabham": "#2f7d5b", "benetton": "#12a150", "force-india": "#f07f13",
    "tyrrell": "#1c4f9c", "sauber": "#3a7ca5", "toro-rosso": "#2342a0",
    "brm": "#5b6f2f", "cooper": "#1f6f4a", "alpine": "#1e7fd0",
    "ligier": "#2a7fbf", "jordan": "#d9a300", "aston-martin": "#0f6a56",
    "haas": "#7c8087", "alfa-romeo": "#a3162c", "maserati": "#8e1b2e",
    "toyota": "#c0272d", "bmw-sauber": "#2c5fa8", "lotus-f1": "#a8872b",
    "arrows": "#d2691e", "bar": "#8d8d8d", "march": "#c04a2a",
    "alphatauri": "#2b4562", "matra": "#2257b4", "honda": "#b5b5b5",
    "racing-point": "#e36fa8", "racing-bulls": "#3f60d8", "brawn": "#b8c400",
    "kurtis-kraft": "#a06a2c", "shadow": "#333333", "surtees": "#b13a6a",
    "jaguar": "#1f6b45", "vanwall": "#1d6b4c", "stewart": "#9a9a9a",
    "wolf": "#232323", "porsche": "#909090", "lola": "#a23b3b",
    "minardi": "#3c3c3c", "fittipaldi": "#c8a018", "prost": "#2752a8",
    "kick-sauber": "#2cb84c", "rb": "#3f60d8", "cadillac": "#232323",
    "audi": "#b4122b",
}


def team_colour(team, year):
    if team == "mclaren":
        if year <= 1973:
            return "#f07a00"
        return "#c81e3a" if year <= 1996 else ("#7d8891" if year <= 2013 else "#f07a00")
    if team == "lotus" and 1972 <= year <= 1986:
        return "#1c1c1c"
    if team == "williams" and year <= 1993:
        return "#1a4aa0"
    return TEAM.get(team, "#8a8f98")


races = read("races")
gps = {g["id"]: g for g in read("grands-prix")}
people = {d["id"]: d for d in read("drivers")}
teams = {c["id"]: c for c in read("constructors")}
results = read("races-race-results")
sprints = read("races-sprint-race-results")
standings = read("races-driver-standings")
finals = read("seasons-driver-standings")

by_year = defaultdict(list)
for r in races:
    by_year[int(r["year"])].append(r)

index, problems = [], []

for year in sorted(by_year):
    cal = sorted(by_year[year], key=lambda r: int(r["round"]))
    n = len(cal)
    rule = rule_for(year)
    res = [r for r in results if int(r["year"]) == year]
    spr = [r for r in sprints if int(r["year"]) == year]
    stand = [s for s in standings if int(s["year"]) == year]
    final = sorted((f for f in finals if int(f["year"]) == year),
                   key=lambda f: int(f["positionDisplayOrder"]))
    done = max([int(r["round"]) for r in res], default=0)

    # Everyone who earned a point, plus every regular entrant in the modern
    # era. A 1950s field with 90 one-off entries would drown the tower.
    ids = [f["driverId"] for f in final if num(f["points"]) > 0]
    entries = Counter(r["driverId"] for r in res)
    scored = {r["driverId"] for r in res + spr if num(r["points"]) > 0}
    for s in stand:
        if num(s["points"]) > 0 and s["driverId"] not in ids:
            ids.append(s["driverId"])
    for d in scored:
        if d not in ids:
            ids.append(d)  # scored, but every score later dropped
    if done:
        for d, c in entries.most_common():
            if d not in ids and year >= 1981 and c >= max(2, done // 3):
                ids.append(d)
    slot = {d: i for i, d in enumerate(ids)}

    # Per-round grids
    raw = [[0.0] * n for _ in ids]    # race + sprint points, as awarded
    place = [[None] * n for _ in ids]  # finish, or text like DNF
    for r in res:
        d = r["driverId"]
        if d not in slot:
            continue
        i, k = slot[d], int(r["round"]) - 1
        raw[i][k] += num(r["points"])
        p = int(r["positionNumber"]) if r["positionNumber"] else r["positionText"]
        cur = place[i][k]
        # A shared drive can list a driver twice: keep the better finish.
        if cur is None or (isinstance(p, int) and (not isinstance(cur, int) or p < cur)):
            place[i][k] = p
    for r in spr:
        if r["driverId"] in slot:
            raw[slot[r["driverId"]]][int(r["round"]) - 1] += num(r["points"])

    # Official cumulative points and order, carried forward across any gap.
    table = defaultdict(dict)
    for s in stand:
        table[int(s["round"])][s["driverId"]] = s
    pts = [[0] * n for _ in ids]
    pos = [[None] * n for _ in ids]
    for k in range(done):
        rows = table.get(k + 1, {})
        order = sorted(rows.values(), key=lambda s: int(s["positionDisplayOrder"]))
        rank = {s["driverId"]: j + 1 for j, s in enumerate(order)}
        tail = len(order)
        prev = sorted(range(len(ids)), key=lambda i: (pos[i][k - 1] or 999) if k else i)
        for i in prev:
            d = ids[i]
            if d in rows:
                pts[i][k], pos[i][k] = tidy(num(rows[d]["points"])), rank[d]
            else:
                pts[i][k] = pts[i][k - 1] if k else 0
                tail += 1
                pos[i][k] = tail

    # The most one driver could take from each round.
    cal_out, maxpts = [], []

    def race_top(rnd):
        return max((num(x["points"]) - (1 if x["fastestLap"] == "true" and fl_bonus(year) else 0)
                    for x in res if int(x["round"]) == rnd), default=0)

    # Nobody knew a race would pay half points until it was stopped, so a
    # race is never worth less than the season's usual win.
    usual = Counter(race_top(k) for k in range(1, done + 1)).most_common(1)[0][0] if done else 25
    for k, r in enumerate(cal):
        rnd = k + 1
        sp = [x for x in spr if int(x["round"]) == rnd]
        if rnd <= done:
            total = max(race_top(rnd), usual) + fl_bonus(year)
            total += max((num(x["points"]) for x in sp), default=0)
        else:
            total = 25 + (8 if r["sprintRaceDate"] else 0)
        maxpts.append(tidy(total))
        g = gps[r["grandPrixId"]]
        cal_out.append({"a": g["abbreviation"], "n": g["name"], "fn": g["fullName"], "d": r["date"],
                        "s": 1 if r["sprintRaceDate"] else 0})

    # Self-check against the official final table.
    if done == n:
        for f in final:
            d = f["driverId"]
            if d in slot:
                got = counted(raw[slot[d]], rule)
                if abs(got - num(f["points"])) > 0.011:
                    problems.append((year, d, got, num(f["points"])))

    # Display names
    last_seen = Counter(people[d]["lastName"] for d in ids)
    drivers = []
    for d in ids:
        p = people[d]
        mine = Counter(r["constructorId"] for r in res if r["driverId"] == d)
        team = mine.most_common(1)[0][0] if mine else ""
        short = p["lastName"]
        if last_seen[short] > 1:
            short = f'{p["firstName"][0]}. {short}'
        drivers.append({"id": d, "n": short, "f": p["name"], "c": p["abbreviation"],
                        "t": teams[team]["name"] if team else "", "k": team_colour(team, year)})

    decided = next((int(r["round"]) for r in cal if r["driversChampionshipDecider"] == "true"), None)

    def order_at(k):
        return sorted(range(len(ids)), key=lambda i: pos[i][k] or 999)

    # Season-level numbers for the archive
    win_pts = usual or 1
    margins, leaders = [], []
    for k in range(done):
        o = order_at(k)
        margins.append(tidy((pts[o[0]][k] - pts[o[1]][k]) / win_pts) if len(o) > 1 else 0)
        leaders.append(o[0])
    changes = sum(1 for a, b in zip(leaders, leaders[1:]) if a != b)
    distinct = len(set(leaders))
    close = sum(1 for m in margins if m <= 1)
    o = order_at(done - 1) if done else []

    # Would another scoring system have crowned someone else?
    flips = []
    if done == n and o:
        for key, tab in TABLES.items():
            total = rescore(raw, place, tab, n)
            champ = max(range(len(ids)), key=lambda i: (total[i], *[
                sum(1 for p in place[i] if p == q) for q in range(1, 11)]))
            if champ != o[0]:
                flips.append([key, drivers[champ]["n"]])

    json.dump({"y": year, "rule": rule, "done": done, "decided": decided,
               "fl": fl_bonus(year), "rounds": cal_out, "maxpts": maxpts,
               "drivers": drivers,
               "raw": [[tidy(v) for v in row] for row in raw],
               "pts": pts, "pos": pos, "place": place},
              open(os.path.join(OUT, "seasons", f"{year}.json"), "w"),
              separators=(",", ":"), ensure_ascii=False)

    index.append({"y": year, "rounds": n, "done": done, "decided": decided,
                  "a": drivers[o[0]]["n"] if o else "", "ak": drivers[o[0]]["k"] if o else "#8a8f98",
                  "b": drivers[o[1]]["n"] if len(o) > 1 else "",
                  "gap": tidy(pts[o[0]][done - 1] - pts[o[1]][done - 1]) if len(o) > 1 else 0,
                  "gapw": margins[-1] if margins else 0, "chg": changes, "ldrs": distinct,
                  "close": round(close / done, 3) if done else 0, "m": margins, "flip": flips,
                  "live": 1 if done < n else 0})

# Tension: the mean percentile of four plain measures, finished seasons only.
over = [s for s in index if not s["live"]]


def pct(key, reverse=False):
    vals = sorted(key(s) for s in over)
    for s in over:
        v = key(s)
        below = sum(1 for x in vals if x < v)
        same = sum(1 for x in vals if x == v)
        p = (below + (same - 1) / 2) / (len(vals) - 1)
        s.setdefault("_p", []).append(1 - p if reverse else p)


pct(lambda s: s["gapw"], reverse=True)                       # tight at the flag
pct(lambda s: ((s["decided"] or s["rounds"]) / s["rounds"]))  # settled late
pct(lambda s: s["chg"] / max(s["rounds"] - 1, 1))            # lead kept changing
pct(lambda s: s["close"])                                    # within one win
for s in over:
    s["tn"] = round(100 * sum(s.pop("_p")) / 4)

json.dump({"updated": max(r["date"] for r in races if int(r["round"]) <= next(
    s["done"] for s in index if s["y"] == int(r["year"]))), "seasons": index},
    open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"), ensure_ascii=False)

print(f"{len(index)} seasons written")
print(f"{len(problems)} final totals disagree with the official table")
for p in problems[:40]:
    print("  ", p)
