#!/usr/bin/env python3
"""Generate the crawlable pages from template.html and data/.

    python3 build_pages.py

Run after build_data.py. Every statement on these pages is derived from the
season files, so a data refresh rewrites the text too. Set SITE_URL once the
site has a home, because canonical links and the sitemap are built from it.
"""
import json, os, re
from datetime import date
from html import escape as esc
from PIL import Image, ImageDraw, ImageFont

SITE_URL = os.environ.get("SITE_URL", "https://vmurthy45.github.io/clinched").rstrip("/")
ADSENSE_ID = os.environ.get("ADSENSE_ID", "")  # ca-pub-… once AdSense gives you one
ADMETA = f'<meta name="google-adsense-account" content="{ADSENSE_ID}">\n' if ADSENSE_ID else ""
HERE = os.path.dirname(os.path.abspath(__file__))
SEASONS = json.load(open(f"{HERE}/data/index.json", encoding="utf8"))
INDEX, UPDATED = SEASONS["seasons"], SEASONS["updated"]
DATA = {s["y"]: json.load(open(f"{HERE}/data/seasons/{s['y']}.json", encoding="utf8")) for s in INDEX}
TEMPLATE = open(f"{HERE}/template.html", encoding="utf8").read()
FINISHED = [s for s in INDEX if not s["live"]]
LIVE = next((s for s in INDEX if s["live"]), None)
BEST = max(FINISHED, key=lambda s: s["tn"])

ERAS = [(1950, "#0d5a3e", "#ffffff"), (1960, "#1a3da6", "#ffffff"), (1970, "#e4540a", "#ffffff"),
        (1980, "#c9006b", "#ffffff"), (1990, "#008275", "#ffffff"), (2000, "#f2c200", "#0c0c0d"),
        (2010, "#5a2bd0", "#ffffff"), (2020, "#d3150f", "#ffffff")]

SCORING = {"alldrop": "with every result counted", "modern": "today's 25-18-15 points",
           "t2003": "the 2003–09 points", "t1991": "the 1991–2002 points",
           "t1961": "the 1961–90 points", "wins": "most wins takes the title"}

GUIDES = [("closest-f1-title-fights", "Closest F1 title fights"),
          ("f1-titles-decided-at-the-last-race", "Titles decided at the last race"),
          ("earliest-f1-title-wins", "Earliest title wins"),
          ("f1-champions-under-other-points-systems", "Champions under other points systems"),
          ("f1-world-champions-list", "Every F1 world champion"),
          ("f1-points-system-history", "How F1 points changed")]


def num(v):
    v = round(v, 2)
    return str(int(v)) if v == int(v) else str(v)


def plural(n, w):
    return f"{n} {w}{'' if float(n) == 1 else 's'}"


def nice(d):
    y, m, dd = map(int, d.split("-"))
    return f"{dd} {date(y, m, dd):%B %Y}"


def spell(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def guides(root):
    return '<nav class="guides" aria-label="Guides">' + "".join(
        f'<a href="{root}{p}/">{t}</a>' for p, t in GUIDES) + "</nav>"


def table(head, rows):
    h = "".join(f"<th>{c}</th>" for c in head)
    b = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="tbl"><table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table></div>'


def ylink(root, y):
    return f'<a href="{root}{y}/" data-y="{y}">{y}</a>'


def ldjson(*items):
    return "\n".join('<script type="application/ld+json">' + json.dumps(i, ensure_ascii=False).replace("</", "<\\/")
                     + "</script>" for i in items)


def crumbs(*pairs):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(pairs)]}


def faq(qa):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]}


def strip(root, current):
    out = []
    for s in INDEX:
        h = 30 if s.get("tn") is None else 14 + s["tn"] * .86
        tag = f'{s["y"]} F1 title race'
        on = ' class="on"' if s["y"] == current else ""
        out.append(f'<a{on} href="{root}{s["y"]}/" data-y="{s["y"]}" title="{tag}" aria-label="{tag}"><span style="height:{h:.0f}%"></span></a>')
    return "".join(out)


def step(root, y, label, mark):
    if y not in DATA:
        return '<span class="step"></span>'
    return f'<a class="step" href="{root}{y}/" data-y="{y}" aria-label="{label}" id="{"prevY" if mark == "‹" else "nextY"}">{mark}</a>'


def write(path, html):
    full = os.path.join(HERE, path)
    os.makedirs(os.path.dirname(full) or HERE, exist_ok=True)
    open(full, "w", encoding="utf8").write(html)


def fill(**kw):
    html = TEMPLATE.replace("{{ADMETA}}", ADMETA)
    for k, v in kw.items():
        html = html.replace("{{" + k + "}}", str(v))
    assert "{{" not in html, re.findall(r"\{\{\w+\}\}", html)
    return html


def facts(s):
    """Plain facts about a season, used in text, tables and FAQs."""
    S = DATA[s["y"]]
    done, rounds, drivers = S["done"], S["rounds"], S["drivers"]
    order = sorted(range(len(drivers)), key=lambda i: S["pos"][i][done - 1] or 999)
    wins = [sum(1 for p in row if p == 1) for row in S["place"]]
    pts = lambda i, k=done - 1: S["pts"][i][k]
    log, leaders, top = [], [], (0, None, None)
    for k in range(done):
        o = sorted(range(len(drivers)), key=lambda i: S["pos"][i][k] or 999)
        lead = o[0]
        gap = pts(lead, k) - pts(o[1], k)
        if gap > top[0]:
            top = (gap, lead, k)
        leaders.append(lead)
        won = [drivers[i]["n"] for i in range(len(drivers)) if S["place"][i][k] == 1]
        log.append([k + 1, esc(rounds[k]["fn"]), nice(rounds[k]["d"]), esc(" / ".join(won)),
                    esc(drivers[lead]["n"]), num(gap)])
    return dict(S=S, order=order, wins=wins, pts=pts, log=log, leaders=leaders, top=top,
                a=order[0], b=order[1], d=drivers, done=done, n=len(rounds))


def rule_text(rule):
    if rule["t"] == "all":
        return "Every result counted towards the championship."
    if rule["t"] == "best":
        return f"Only each driver's best {rule['n']} results counted."
    return (f"Results were split into two halves: the best {rule['n1']} of the first {rule['at']} rounds "
            f"and the best {rule['n2']} of the rest counted.")


def alive_now(f):
    S, order = f["S"], f["order"]
    left = sum(S["maxpts"][f["done"]:])
    lead = f["pts"](f["a"])
    return left, [i for i in order if f["pts"](i) + left >= lead]


def season_copy(s, f):
    y, d, a, b = s["y"], f["d"], f["a"], f["b"]
    A, B = d[a]["f"], d[b]["f"]
    pa, pb = num(f["pts"](a)), num(f["pts"](b))
    gap = num(s["gap"])
    many = len(set(f["leaders"]))
    if s["live"]:
        left, alive = alive_now(f)
        rnd = f["S"]["rounds"][f["done"] - 1]
        lead = f'{A} leads the {y} Formula 1 drivers\' championship with {pa} points, {gap} ahead of {B} on {pb}, after the {rnd["fn"]} (round {f["done"]} of {f["n"]}).'
        names = spell([d[i]["f"] for i in alive])
        won = f["S"]["decided"]
        if won:
            at = f["S"]["rounds"][won - 1]["fn"]
            lead = f"{A} has won the {y} Formula 1 World Championship, clinching the title at the {at}. {d[a]['n']} has {pa} points with {plural(f['n'] - f['done'], 'round')} left."
            return lead, [(f"Who won the {y} F1 World Championship?", lead),
                          (f"When was the {y} F1 title decided?", f"At round {won} of {f['n']}, the {at} ({nice(f['S']['rounds'][won - 1]['d'])}).")]
        qa = [(f"Who is leading the {y} F1 drivers' championship?", lead),
              (f"Who can still win the {y} F1 title?",
               f"{names} can still win it mathematically. {left and num(left)} points remain across {plural(f['n'] - f['done'], 'round')}."),
              (f"What does {d[a]['n']} need to clinch the {y} title?",
               f"{d[a]['n']} clinches once the lead over every rival is bigger than the points still available. The lead is {gap} with {num(left)} available, as of {nice(rnd['d'])}.")]
        return lead, qa
    dec = f["S"]["decided"]
    where = f["S"]["rounds"][dec - 1]["fn"] if dec else None
    margin = f"by half a point" if s["gap"] == .5 else f"by {plural(gap, 'point')}"
    late = "at the final round" if dec == f["n"] else f"at the {where}, with {plural(f['n'] - dec, 'round')} to spare"
    lead = f"{A} won the {y} Formula 1 World Championship with {pa} points, beating {B} ({pb}) {margin}. The title was settled {late}."
    flips = [f"{w} under {SCORING[k]}" for k, w in s["flip"]]
    qa = [(f"Who won the {y} F1 World Championship?", f"{A} won with {pa} points and {plural(f['wins'][a], 'win')}, driving for {d[a]['t']}. {B} was second on {pb}."),
          (f"How close was the {y} F1 title race?", f"The final margin was {gap} {'point' if s['gap'] == 1 else 'points'}. The lead changed hands {plural(s['chg'], 'time')}, and {plural(many, 'driver')} led the standings during the season."),
          (f"When was the {y} F1 title decided?", f"At round {dec} of {f['n']}, the {where} ({nice(f['S']['rounds'][dec - 1]['d'])}).")]
    qa.append((f"Would the {y} F1 champion change under other points systems?",
               ("Yes: " + spell(flips) + "." if flips else f"No. {d[a]['n']} wins under all of the alternative systems we test.")))
    return lead, qa


def rival_title(f):
    return " vs ".join(sorted([f["d"][f["a"]]["n"], f["d"][f["b"]]["n"]]))


def recap_html(s, f, lead, qa):
    y, d = s["y"], f["d"]
    top = f["order"][:10]
    label = "Standings so far" if s["live"] else "Final standings"
    stand = table(["Pos", "Driver", "Team", "Wins", "Points"],
                  [[j + 1, esc(d[i]["f"]), esc(d[i]["t"]), f["wins"][i], num(f["pts"](i))] for j, i in enumerate(top)])
    rounds = table(["Rd", "Grand Prix", "Date", "Winner", "Leader after", "Lead"], f["log"])
    gap, who, k = f["top"]
    extra = f'<p>The biggest lead of the season was {num(gap)} points, held by {esc(d[who]["n"])} after the {esc(f["S"]["rounds"][k]["fn"])}. {rule_text(f["S"]["rule"])}</p>' if who is not None else ""
    q = "".join(f"<h3>{esc(a)}</h3><p>{esc(b)}</p>" for a, b in qa)
    hint = "Season report and results (contains the result)"
    return f'''<details class="recap" id="recap">
  <summary>{hint}</summary>
  <article class="recap-in">
    <h2>{y} F1 title race, in brief</h2>
    <p>{esc(lead)}</p>
    {extra}
    <h2>{label}</h2>{stand}
    <h2>Round by round</h2>{rounds}
    <h2>Questions</h2>{q}
  </article>
</details>'''


def og_image(name, big, small, era):
    # Impact is only on the Mac. Automated runs keep existing images and use a
    # plain bold font for any new season.
    bg, fg = era[1], era[2]
    impact = "/System/Library/Fonts/Supplemental/Impact.ttf"
    if not os.path.exists(impact):
        impact = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if os.path.exists(f"{HERE}/og/{name}.png") or not os.path.exists(impact):
            return
    img = Image.new("RGB", (1200, 630), bg)
    draw = ImageDraw.Draw(img)
    size = 330 if len(big) <= 4 else 150
    draw.text((60, 70), big, font=ImageFont.truetype(impact, size), fill=fg)
    draw.text((64, 500), small, font=ImageFont.truetype(impact, 58), fill=fg)
    os.makedirs(f"{HERE}/og", exist_ok=True)
    img.save(f"{HERE}/og/{name}.png", optimize=True)


def era_of(y):
    return [e for e in ERAS if y >= e[0]][-1]


def tiles():
    out = []
    for s in sorted(INDEX, key=lambda s: -(s.get("tn") or -1)):
        out.append(f'<a class="tile" data-y="{s["y"]}" href="{s["y"]}/"><div class="h"><b>{s["y"]}</b></div>'
                   f'<div class="w">{esc(s["a"])} and {esc(s["b"])}</div></a>')
    return "".join(out)


def build_season(s):
    y, root = s["y"], "../"
    f = facts(s)
    lead, qa = season_copy(s, f)
    versus = rival_title(f)
    title = f"{y} F1 Title Race: {versus}, Round by Round | Clinched"
    if s["live"]:
        title = f"{y} F1 Title Race: Standings and Results | Clinched" if f["S"]["decided"] else f"{y} F1 Title Race: Standings and Who Can Still Win | Clinched"
    url = f"{SITE_URL}/{y}/"
    desc = f"{lead} Replay the season race by race with moving standings and gap charts."
    jsonld = ldjson(faq(qa), crumbs(("Clinched", SITE_URL + "/"), (f"{y} title race", url)))
    html = fill(ROOT=root, TITLE=esc(title), DESC=esc(desc, quote=True), CANON=url, OGIMG=f"{SITE_URL}/og/{y}.png",
                HTMLATTR=f'data-year="{y}"', JSONLD=jsonld, H1=f"{y} F1 title race: {esc(versus)}", YEAR=y,
                SUMMARY=esc(lead), PREV=step(root, y - 1, "Previous season", "‹"), NEXT=step(root, y + 1, "Next season", "›"),
                STRIP=strip(root, y), RECAP=recap_html(s, f, lead, qa), TILES="", GUIDES=guides(root))
    write(f"{y}/index.html", html)
    og_image(str(y), str(y), f"F1 TITLE RACE: {versus.upper()}", era_of(y))
    return url


def build_home():
    y = BEST["y"]
    f = facts(BEST)
    lead, _ = season_copy(BEST, f)
    url = SITE_URL + "/"
    title = "Clinched: Every F1 Title Race Since 1950, Replayed Round by Round"
    desc = "Replay any Formula 1 championship since 1950. Drag through a season to see the standings move, who was still alive, and how close the title race really was."
    intro = f'''<section class="recap"><div class="recap-in">
  <h2>Every title race, not just the final table</h2>
  <p>Clinched replays all {len(INDEX)} Formula 1 drivers' championships from 1950, one round at a time. Pick a season and press play, or start with the <a href="{LIVE["y"] if LIVE else y}/">{LIVE["y"] if LIVE else y} title race</a>, the <a href="closest-f1-title-fights/">closest title fights ever</a>, or the <a href="f1-titles-decided-at-the-last-race/">titles that went to the last race</a>.</p>
</div></section>'''
    site = {"@context": "https://schema.org", "@type": "WebSite", "name": "Clinched", "url": url, "description": desc}
    dataset = {"@context": "https://schema.org", "@type": "Dataset", "name": "Formula 1 drivers' championship standings by round, 1950 to present",
               "description": "Round-by-round standings, title elimination and tension scores for every Formula 1 season.",
               "url": url, "license": "https://creativecommons.org/licenses/by/4.0/", "dateModified": UPDATED,
               "isBasedOn": "https://github.com/f1db/f1db"}
    html = fill(ROOT="", TITLE=esc(title), DESC=esc(desc, quote=True), CANON=url, OGIMG=f"{SITE_URL}/og/home.png",
                HTMLATTR=f'data-year="{y}" data-home="1"', JSONLD=ldjson(site, dataset),
                H1="Every F1 title race since 1950, replayed round by round", YEAR=y, SUMMARY=esc(lead),
                PREV=step("", y - 1, "Previous season", "‹"), NEXT=step("", y + 1, "Next season", "›"),
                STRIP=strip("", y), RECAP=intro, TILES=tiles(), GUIDES=guides(""))
    write("index.html", html)
    og_image("home", "CLINCHED", "EVERY F1 TITLE RACE, ROUND BY ROUND", ERAS[-1])


def shell(path, title, desc, h1, body, extra=()):
    root = "../"
    url = f"{SITE_URL}/{path}/"
    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc, quote=True)}">
{ADMETA}<link rel="canonical" href="{url}">
<link rel="icon" href="{root}favicon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Clinched">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc, quote=True)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE_URL}/og/home.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:ital,wght@0,500..900;1,500..900&family=Sofia+Sans+Semi+Condensed:ital,wght@0,400..800;1,400..800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}style.css">
{ldjson(crumbs(("Clinched", SITE_URL + "/"), (h1, url)), *extra)}
</head>
<body style="padding-bottom:0">
<header class="top"><a class="brand" href="{root}./">Clinch<i>ed</i></a><nav><a href="{root}how-it-works/">How it works</a></nav></header>
<div class="ad ad-leader" data-ad="leaderboard"></div>
<main class="prose">
<h1>{esc(h1)}</h1>
{body}
{guides(root)}
</main>
<div class="ad ad-foot" data-ad="footer"></div>
<footer class="foot">
  <p>Data from <a href="https://github.com/f1db/f1db">F1DB</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, adapted into per-season files. Results up to {nice(UPDATED)}.</p>
  <p>An unofficial fan project. Not associated with Formula 1 companies, the FIA or any team. F1 and Formula 1 are trademarks of Formula One Licensing B.V.</p>
  <p><a href="{root}how-it-works/">How it works</a> · <a href="{root}privacy/">Privacy</a></p>
</footer>
<script src="{root}ads.js"></script>
</body>
</html>
'''
    write(f"{path}/index.html", html)
    return url


def build_guides():
    urls, r = [], "../"

    # Closest
    rows = sorted(FINISHED, key=lambda s: (s["gapw"], s["gap"]))[:20]
    closest = rows[0]
    first = min(FINISHED, key=lambda s: s["gap"])
    text = (f'<p>The closest Formula 1 title fight by points was {first["y"]}, when {esc(first["a"])} beat {esc(first["b"])} by {num(first["gap"])} points. '
            f'A point meant more in some eras than others, so this table ranks by the margin measured in race wins, which lets 1958 sit fairly beside 2021.</p>')
    tb = table(["Season", "Champion", "Runner-up", "Margin", "In race wins", "Lead changes"],
               [[ylink(r, s["y"]), esc(s["a"]), esc(s["b"]), num(s["gap"]), f'{s["gapw"]:.2f}', s["chg"]] for s in rows])
    urls.append(shell("closest-f1-title-fights", "The Closest F1 Title Fights in History, Ranked | Clinched",
                      f'The closest F1 championship fights ever, ranked by final margin. {first["y"]} was decided by {num(first["gap"])} points. Replay each one round by round.',
                      "The closest F1 title fights", text + tb))

    # Last race
    last = [s for s in FINISHED if s["decided"] == s["rounds"]]
    share = round(100 * len(last) / len(FINISHED))
    text = (f'<p>{len(last)} of the {len(FINISHED)} completed Formula 1 seasons, or {share}%, went to the final round. '
            f'Other published counts differ slightly. We use the deciding round recorded in the F1DB dataset.</p>')
    tb = table(["Season", "Champion", "Runner-up", "Margin", "Final round"],
               [[ylink(r, s["y"]), esc(s["a"]), esc(s["b"]), num(s["gap"]), esc(DATA[s["y"]]["rounds"][-1]["fn"])]
                for s in sorted(last, key=lambda s: -s["y"])])
    urls.append(shell("f1-titles-decided-at-the-last-race", "How Many F1 Titles Were Decided at the Last Race? | Clinched",
                      f'{len(last)} of {len(FINISHED)} F1 seasons went to the final round. See every one, with the margin and the deciding Grand Prix.',
                      "F1 titles decided at the last race", text + tb))

    # Earliest
    rows = sorted(FINISHED, key=lambda s: s["decided"] - s["rounds"])[:20]
    e = rows[0]
    text = (f'<p>The earliest title win by rounds remaining was {esc(e["a"])} in {e["y"]}, who clinched with {plural(e["rounds"] - e["decided"], "round")} to spare at the {esc(DATA[e["y"]]["rounds"][e["decided"] - 1]["fn"])}.</p>')
    tb = table(["Season", "Champion", "Clinched at", "Round", "Rounds to spare"],
               [[ylink(r, s["y"]), esc(s["a"]), esc(DATA[s["y"]]["rounds"][s["decided"] - 1]["fn"]), f'{s["decided"]} of {s["rounds"]}', s["rounds"] - s["decided"]] for s in rows])
    urls.append(shell("earliest-f1-title-wins", "The Earliest F1 Title Wins in History | Clinched",
                      f'The earliest F1 championship clinch was {e["a"]} in {e["y"]}, with {plural(e["rounds"] - e["decided"], "round")} left. The 20 most dominant title wins, ranked.',
                      "The earliest F1 title wins", text + tb))

    # Flips
    rows = [s for s in FINISHED if s["flip"]]
    text = (f'<p>{len(rows)} of {len(FINISHED)} completed seasons would have a different champion under at least one other scoring system. '
            f'Each season here was re-scored from its finishing places, with every result counting and no sprints or fastest-lap points. Pick a season and use the "Score it by" menu to watch the title change hands.</p>')
    tb = table(["Season", "Real champion", "Who would win instead"],
               [[ylink(r, s["y"]), esc(s["a"]), esc("; ".join(f"{w} under {SCORING[k]}" for k, w in s["flip"]))] for s in rows])
    urls.append(shell("f1-champions-under-other-points-systems", "Which F1 Champions Would Change Under Other Points Systems? | Clinched",
                      f'{len(rows)} F1 seasons would have a different champion under another scoring system. See every what-if, from today\'s points to most wins.',
                      "F1 champions under other points systems", text + tb))

    # Champions
    tb = table(["Season", "Champion", "Team", "Points", "Runner-up", "Margin", "Rounds"], [])
    rows = []
    for s in reversed(FINISHED):
        f = facts(s)
        rows.append([ylink(r, s["y"]), esc(f["d"][f["a"]]["f"]), esc(f["d"][f["a"]]["t"]), num(f["pts"](f["a"])),
                     esc(f["d"][f["b"]]["f"]), num(s["gap"]), s["rounds"]])
    tb = table(["Season", "Champion", "Team", "Points", "Runner-up", "Margin", "Rounds"], rows)
    urls.append(shell("f1-world-champions-list", "Every F1 World Champion by Year, 1950 to Today | Clinched",
                      "Every Formula 1 world champion since 1950 with team, points, runner-up and winning margin. Open any year to replay the title race.",
                      "Every F1 world champion by year", f'<p>All {len(FINISHED)} completed world championships, newest first. Open any year to replay its title race.</p>' + tb))

    # Points history
    text = '''<p>Formula 1 has changed how it scores many times, and for most of its history not every result counted. That is why some champions scored fewer championship points than they earned on track.</p>'''
    pts = table(["Seasons", "Points for places", "Extras"], [
        ["1950–59", "8-6-4-3-2", "1 for fastest lap"], ["1960", "8-6-4-3-2-1", ""], ["1961–90", "9-6-4-3-2-1", ""],
        ["1991–2002", "10-6-4-3-2-1", ""], ["2003–09", "10-8-6-5-4-3-2-1", ""],
        ["2010 onward", "25-18-15-12-10-8-6-4-2-1", "1 for fastest lap in 2019–24; sprints from 2021"]])
    groups, cur = [], None
    for s in FINISHED + ([LIVE] if LIVE else []):
        t = rule_text(DATA[s["y"]]["rule"])
        key = re.sub(r"\d+", "#", t) if "split" in t else t
        if cur and cur[2] == key:
            cur[1] = s["y"]
        else:
            cur = [s["y"], s["y"], key, t]
            groups.append(cur)
    tb = table(["Seasons", "What counted"], [[f"{a}–{b}" if a != b else a, t if "split" not in t else "Split season: a set number of results counted from each half"] for a, b, _, t in groups])
    urls.append(shell("f1-points-system-history", "How the F1 Points System Changed, 1950 to Today | Clinched",
                      "Every F1 points system since 1950, including dropped scores, fastest-lap points and sprints, and how each affected the title race.",
                      "How the F1 points system changed", text + "<h2>Points</h2>" + pts + "<h2>Results that counted</h2>" + tb))

    # About
    body = '''<p>Clinched replays every Formula 1 drivers' championship round by round. It is an independent fan project.</p>
<h2>Tension score</h2>
<p>Each finished season is ranked on four things: how small the final margin was (measured in race wins, so eras compare fairly), how late the title was settled, how often the lead changed, and how much of the year the top two spent within one win. The score out of 100 is the average of those four rankings.</p>
<h2>Still alive</h2>
<p>After each round we give a driver the maximum from every remaining race, including sprints and fastest-lap points where they existed, and apply that season's dropped-score rule. A tie with the leader counts as alive, because countback could still settle it. For finished seasons the official record has the final say on when a title was won.</p>
<h2>Sprint weekends</h2>
<p>A sprint and its Grand Prix count as one round, so standings are shown after the whole weekend.</p>
<h2>What-if scoring</h2>
<p>The alternative systems apply to Grand Prix finishing places only, with no sprints, fastest-lap points or half-points races, and every result counts. Only drivers who scored officially are included, so the lower table is approximate.</p>
<h2>Data</h2>
<p>Results come from <a href="https://github.com/f1db/f1db">F1DB</a>. As a check, every driver's final total is recalculated from race points under that season's rules and compared with the official table before each update.</p>'''
    urls.append(shell("how-it-works", "How Clinched Works: Data and Methods", "How Clinched calculates title tension, title elimination and what-if scoring, and where its Formula 1 data comes from.", "How it works", body))

    body = '''<p>This site has no accounts and asks you for no personal information.</p>
<h2>On your device</h2>
<p>Your "Hide what's ahead" setting is saved in your browser's local storage. It stays on your device.</p>
<h2>Advertising</h2>
<p>This site shows ads served by Google AdSense. Google and its partners use cookies to serve ads based on your visits to this and other websites. You can turn off personalised advertising in <a href="https://adssettings.google.com">Google's Ad Settings</a>, and read how Google uses data at <a href="https://policies.google.com/technologies/partner-sites">policies.google.com</a>.</p>
<h2>Fonts</h2>
<p>Fonts are loaded from Google Fonts, so Google receives your IP address when the page loads.</p>'''
    urls.append(shell("privacy", "Privacy | Clinched", "How Clinched handles your data, including advertising cookies and fonts.", "Privacy", body))
    return urls


def build_crawler_files(urls):
    write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n")
    entries = []
    for u in urls:
        live = LIVE and (u == SITE_URL + "/" or u.endswith(f"/{LIVE['y']}/"))
        mod = f"<lastmod>{UPDATED}</lastmod>" if live else ""
        entries.append(f"<url><loc>{u}</loc>{mod}</url>")
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + "\n".join(entries) + "\n</urlset>\n")
    lines = ["# Clinched", "",
             f"> Round-by-round history of every Formula 1 drivers' championship from 1950, with results up to {nice(UPDATED)}.", "",
             "Each season page states the champion, margin, deciding round and a round-by-round table of the leader. Data comes from F1DB (CC BY 4.0). Please credit Clinched and link to the season page.", "",
             "## Guides"]
    lines += [f"- [{t}]({SITE_URL}/{p}/)" for p, t in GUIDES]
    lines += ["", "## Seasons"] + [f"- [{s['y']} F1 title race]({SITE_URL}/{s['y']}/)" for s in reversed(INDEX)]
    lines += ["", "## Method", f"- [How it works]({SITE_URL}/how-it-works/)"]
    write("llms.txt", "\n".join(lines) + "\n")


build_home()
urls = [SITE_URL + "/"] + [build_season(s) for s in reversed(INDEX)]
urls += build_guides()
build_crawler_files(urls)
print(f"{len(urls)} pages written for {SITE_URL}")
