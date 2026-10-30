"use strict";

const BASE = new URL(".", document.currentScript.src).href;
const PAGE = document.documentElement.dataset;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, f) => a + (b - a) * f;
const fmt = v => (Math.round(v * 100) / 100).toString();
const plural = (n, w) => `${n} ${w}${+n === 1 ? "" : "s"}`;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Mirrors TABLES in build_data.py.
const SCORING = {
  official: { label: "The rules of the day" },
  alldrop: { label: "Every result counts" },
  modern: { label: "Today's points, 25-18-15", table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] },
  t2003: { label: "2003–09 points, 10-8-6", table: [10, 8, 6, 5, 4, 3, 2, 1] },
  t1991: { label: "1991–2002 points, 10-6-4", table: [10, 6, 4, 3, 2, 1] },
  t1961: { label: "1961–90 points, 9-6-4", table: [9, 6, 4, 3, 2, 1] },
  wins: { label: "Most wins takes it", table: [1] },
};

const ERAS = [
  [1950, "#0d5a3e", "#fff"], [1960, "#1a3da6", "#fff"], [1970, "#e4540a", "#fff"],
  [1980, "#c9006b", "#fff"], [1990, "#008275", "#fff"], [2000, "#f2c200", "#0c0c0d"],
  [2010, "#5a2bd0", "#fff"], [2020, "#d3150f", "#fff"],
];

const st = {
  index: null, S: null, M: null, cache: {},
  t: 0, rd: -1, mode: "official", view: "gap", hide: true,
  playing: false, hiddenLines: new Set(), a: 0, b: 1, sort: "tn",
};

/* ---------- scoring model ---------- */

function counted(list, rule) {
  const top = (a, n) => [...a].sort((x, y) => y - x).slice(0, n).reduce((s, v) => s + v, 0);
  if (rule.t === "best") return top(list, rule.n);
  if (rule.t === "split") return top(list.slice(0, rule.at), rule.n1) + top(list.slice(rule.at), rule.n2);
  return list.reduce((s, v) => s + v, 0);
}

function buildModel(S, mode) {
  const n = S.drivers.length, D = S.done, R = S.rounds.length, table = SCORING[mode].table;
  const P = S.drivers.map(() => new Array(D + 1).fill(0));
  const rank = S.drivers.map(() => new Array(D + 1).fill(0));
  const byName = [...S.drivers.keys()].sort((a, b) => S.drivers[a].n.localeCompare(S.drivers[b].n));
  byName.forEach((i, r) => (rank[i][0] = r));

  // Points per round under this system
  const perRound = S.raw.map(r => r.slice());
  if (table) {
    for (let k = 0; k < R; k++) {
      const at = {};
      S.place.forEach(row => { if (typeof row[k] === "number") at[row[k]] = (at[row[k]] || 0) + 1; });
      S.place.forEach((row, i) => {
        const p = row[k];
        perRound[i][k] = typeof p === "number" && p <= table.length ? table[p - 1] / at[p] : 0;
      });
    }
  }

  for (let k = 1; k <= D; k++) {
    for (let i = 0; i < n; i++)
      P[i][k] = mode === "official" ? S.pts[i][k - 1] : P[i][k - 1] + perRound[i][k - 1];

    const places = i => {
      const c = new Array(11).fill(0);
      for (let q = 0; q < k; q++) { const p = S.place[i][q]; if (typeof p === "number" && p <= 10) c[p]++; }
      return c;
    };
    const order = [...Array(n).keys()];
    if (mode === "official") {
      order.sort((a, b) => (S.pos[a][k - 1] ?? 999) - (S.pos[b][k - 1] ?? 999));
    } else {
      const cb = order.map(places);
      order.sort((a, b) => {
        if (P[b][k] !== P[a][k]) return P[b][k] - P[a][k];
        for (let q = 1; q <= 10; q++) if (cb[a][q] !== cb[b][q]) return cb[b][q] - cb[a][q];
        return rank[a][k - 1] - rank[b][k - 1];
      });
    }
    order.forEach((i, r) => (rank[i][k] = r));
  }

  // Most a driver could reach from round k
  const reach = (i, k) => {
    if (table) return P[i][k] + table[0] * (R - k);
    const list = S.raw[i].map((v, q) => (q < k ? v : S.maxpts[q]));
    return mode === "official" ? counted(list, S.rule) : list.reduce((s, v) => s + v, 0);
  };

  const out = new Array(n).fill(null);
  let clinch = null;
  for (let k = 1; k <= D; k++) {
    const lead = rank.findIndex(r => r[k] === 0);
    let alive = 0;
    for (let i = 0; i < n; i++) {
      // Countback and retirements can end a fight before the arithmetic does,
      // so the official deciding round has the last word.
      const settled = k === R || (mode === "official" && D === R && S.decided && k >= S.decided);
      const dead = settled ? i !== lead : reach(i, k) < P[lead][k];
      if (dead && out[i] === null) out[i] = k;
      if (out[i] === null) alive++;
    }
    if (alive === 1 && mode === "official" && D === R && S.decided && k < S.decided) {
      out[rank.findIndex(r => r[k] === 1)] = null;
      alive = 2;
    }
    if (alive === 1 && clinch === null) clinch = k;
  }
  return { P, rank, reach, out, clinch, perRound, leaderAt: k => rank.findIndex(r => r[k] === 0) };
}

/* ---------- season loading ---------- */

async function loadSeason(y, opts = {}) {
  stopPlay();
  if (!st.cache[y]) st.cache[y] = await (await fetch(`${BASE}data/seasons/${y}.json`)).json();
  st.S = st.cache[y];
  st.hiddenLines.clear();
  remodel();
  const era = [...ERAS].reverse().find(e => y >= e[0]);
  document.documentElement.style.setProperty("--era", era[1]);
  document.documentElement.style.setProperty("--on-era", era[2]);
  $("pick").value = y;

  const S = st.S, D = S.done;
  $("slider").max = Math.max(D, 1);
  buildTicks();
  buildDuelPicks();
  st.rd = -1;
  drawAll();
  setT(opts.round != null ? clamp(opts.round, 0, D) : D);
  if (opts.autoplay && !calm) { setT(0); startPlay(); }
}

function remodel() {
  st.M = buildModel(st.S, st.mode);
  const fin = st.S.done;
  const order = [...st.S.drivers.keys()].sort((a, b) => st.M.rank[a][fin] - st.M.rank[b][fin]);
  st.a = order[0]; st.b = order[1] ?? order[0];
  st.order = order;
}

const isLive = () => st.S.done < st.S.rounds.length;
const hidingResult = () => st.hide && st.rd < st.S.done;
const name = i => st.S.drivers[i].n;
const byName = ids => [...ids].sort((a, b) => name(a).localeCompare(name(b)));

function roundLabel(k) {
  if (k === 0) return ["Start", "Before round 1"];
  const r = st.S.rounds[k - 1];
  const when = new Date(r.d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return [`Round ${k} of ${st.S.rounds.length}`, `${r.fn}, ${when}`];
}

function summary() {
  const S = st.S, M = st.M, D = S.done, a = st.order[0], b = st.order[1];
  if (!D) return "Season not yet started.";
  if (hidingResult()) return `${plural(S.rounds.length, "round")}. No spoilers.`;
  const gap = fmt(M.P[a][D] - M.P[b][D]);
  if (isLive()) {
    const left = S.rounds.length - D;
    return `${S.drivers[a].f} leads ${S.drivers[b].f} by ${gap} with ${plural(left, "round")} left.`;
  }
  const c = st.mode === "official" ? S.decided : M.clinch;
  const when = c === S.rounds.length ? "Settled at the final round."
    : c ? `Settled at ${S.rounds[c - 1].n}, ${plural(S.rounds.length - c, "round")} early.` : "";
  const unit = st.mode === "wins" ? "win" : "point";
  const by = +gap === 0 ? "on countback" : `by ${plural(gap, unit)}`;
  return `${S.drivers[a].f} beat ${S.drivers[b].f} ${by}. ${when}`;
}

/* ---------- drawing ---------- */

function drawAll() {
  $("summary").textContent = summary();
  drawWhatIf();
  drawTower();
  drawView();
  drawLog();
}

function drawWhatIf() {
  const box = $("whatif");
  if (st.mode === "official" || isLive() || hidingResult()) { box.hidden = true; return; }
  const real = buildModel(st.S, "official");
  const was = real.leaderAt(st.S.done), now = st.M.leaderAt(st.S.done);
  box.hidden = false;
  box.innerHTML = was === now
    ? `Same champion: ${esc(name(now))} wins under this system too.`
    : `Under this system the title goes to <b>${esc(st.S.drivers[now].f)}</b>, not ${esc(st.S.drivers[was].f)}.`;
}

/* Tower */
const rows = [];
const ROW_MAX = 20;

function drawTower() {
  const S = st.S, box = $("tower");
  box.innerHTML = "";
  rows.length = 0;
  const h = rowH();
  box.style.height = Math.min(S.drivers.length, ROW_MAX) * h + "px";
  S.drivers.forEach((d, i) => {
    const el = document.createElement("div");
    el.className = "row";
    el.innerHTML = `<span class="num"></span><span class="tag" style="background:${d.k}"></span>
      <span class="who">${esc(d.n)}<small>${esc(d.t)}</small></span>
      <span><span class="bar" style="display:block;background:${d.k}"></span></span>
      <span class="pts"></span><span class="gap"></span>`;
    box.append(el);
    rows.push({ el, i, num: el.children[0], bar: el.querySelector(".bar"), pts: el.children[4], gap: el.children[5] });
  });
  const extra = S.drivers.length - ROW_MAX;
  $("towerNote").textContent = extra > 0 ? `Top ${ROW_MAX} shown. ${plural(extra, "more driver")} scored this season.` : "";
}

const rowH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row")) || 36;

function paintTower(t) {
  const M = st.M, D = st.S.done;
  const k = Math.floor(t), f = t - k, k2 = Math.min(k + 1, D), h = rowH();
  const value = i => lerp(M.P[i][k], M.P[i][k2], f);
  const top = Math.max(...rows.map(r => value(r.i)), 1);
  const nearest = Math.round(t);
  // Rows hold their slots, then change places quickly as the round lands.
  const u = clamp((f - .6) / .4, 0, 1), swap = u * u * (3 - 2 * u);
  for (const r of rows) {
    const y = lerp(M.rank[r.i][k], M.rank[r.i][k2], swap) * h;
    r.el.style.transform = `translateY(${y.toFixed(1)}px)`;
    r.el.style.zIndex = 100 - M.rank[r.i][nearest];
    r.bar.style.transform = `scaleX(${(value(r.i) / top).toFixed(4)})`;
    const shown = Number.isInteger(t) ? fmt(M.P[r.i][k]) : String(Math.round(value(r.i)));
    if (r.pts.textContent !== shown) r.pts.textContent = shown;
  }
}

function paintTowerRound(k) {
  const M = st.M, S = st.S;
  const lead = M.leaderAt(k), leadPts = M.P[lead][k];
  const decidedAt = st.mode === "official" && !isLive() ? S.decided : M.clinch;
  for (const r of rows) {
    r.num.textContent = M.rank[r.i][k] + 1;
    const gap = leadPts - M.P[r.i][k];
    r.gap.textContent = k === 0 ? "" : r.i === lead ? "" : gap === 0 ? "level" : "-" + fmt(gap);
    const isOut = M.out[r.i] !== null && M.out[r.i] <= k && k > 0;
    r.el.classList.toggle("out", isOut);
    r.el.classList.toggle("champ", !!decidedAt && k >= decidedAt && r.i === lead);
    if (r.el.classList.contains("champ")) r.gap.textContent = "Champ";
  }
  $("towerHead").textContent = k === 0 ? "On the grid" : `After ${S.rounds[k - 1].n}`;
}

/* Shared plot frame */
function plotFrame(el, height, pad) {
  const w = Math.max(el.clientWidth || 640, 300);
  const R = st.S.rounds.length;
  return {
    w, h: height, pad,
    x: k => pad.l + (w - pad.l - pad.r) * (k / Math.max(R, 1)),
    invX: px => clamp(Math.round(((px - pad.l) / (w - pad.l - pad.r)) * R), 0, st.S.done),
  };
}

function niceStep(max, want) {
  const raw = max / want, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

function roundAxis(f) {
  const R = st.S.rounds.length, every = R > 16 ? 4 : R > 9 ? 2 : 1;
  let s = "";
  for (let k = 0; k <= R; k += every)
    s += `<text x="${f.x(k)}" y="${f.h - 6}" text-anchor="middle">${k === 0 ? "Start" : "R" + k}</text>`;
  return s;
}

/* Gap to leader */
function contenders() {
  const M = st.M, S = st.S, set = new Set(st.order.slice(0, 5));
  for (let k = 1; k <= S.done; k++) set.add(M.leaderAt(k));
  const list = st.order.filter(i => set.has(i)).slice(0, 8);
  return st.hide ? byName(list) : list;
}

function drawGap() {
  const el = $("gapChart"), S = st.S, M = st.M, D = S.done;
  const list = contenders();
  const narrow = el.clientWidth < 520;
  const f = plotFrame(el, narrow ? 340 : 410, { l: 38, r: narrow ? 74 : 104, t: 12, b: 26 });
  const shown = list.filter(i => !st.hiddenLines.has(i));
  const gapAt = (i, k) => M.P[M.leaderAt(k)][k] - M.P[i][k];
  const max = Math.max(1, ...shown.flatMap(i => M.P[i].map((_, k) => gapAt(i, k))));
  const step = niceStep(max, 5);
  const top = Math.ceil(max / step) * step;
  const y = v => f.pad.t + (f.h - f.pad.t - f.pad.b) * (v / top);
  const win = SCORING[st.mode].table ? SCORING[st.mode].table[0] : [...S.maxpts].sort((a, b) => a - b)[S.maxpts.length >> 1];

  let s = `<svg viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="Points behind the championship leader after each round">`;
  s += `<defs><clipPath id="past"><rect id="pastRect" x="0" y="0" width="0" height="${f.h}"/></clipPath></defs>`;
  s += `<rect x="${f.pad.l}" y="${y(0)}" width="${f.w - f.pad.l - f.pad.r}" height="${Math.max(0, y(Math.min(win, top)) - y(0))}" fill="#eff0f1"/>`;
  s += `<text x="${f.w - f.pad.r - 6}" y="${y(Math.min(win, top)) - 5}" text-anchor="end" style="font-size:11.5px">Within one win</text>`;
  for (let v = 0; v <= top + 1e-6; v += step) {
    s += `<line x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? "#d6d7d9" : "#0c0c0d"}" stroke-width="${v ? 1 : 2}"/>`;
    s += `<text x="${f.pad.l - 7}" y="${y(v) + 4}" text-anchor="end">${v ? "-" + fmt(v) : "P1"}</text>`;
  }
  s += roundAxis(f);

  const seen = {};
  let lines = "", dots = "";
  for (const i of shown) {
    const d = S.drivers[i], dash = seen[d.k] ? ' stroke-dasharray="7 4"' : "";
    seen[d.k] = 1;
    const pts = M.P[i].map((_, k) => `${f.x(k).toFixed(1)},${y(gapAt(i, k)).toFixed(1)}`).join(" ");
    lines += `<polyline points="${pts}" fill="none" stroke="${d.k}" stroke-width="2.5" stroke-linejoin="round"${dash}/>`;
    dots += `<circle class="dot" data-i="${i}" r="5" fill="${d.k}" stroke="#fff" stroke-width="2"/>`;
  }
  if (!st.hide) s += `<g opacity=".16">${lines}</g>`;
  s += `<g clip-path="url(#past)">${lines}</g>${dots}`;

  s += `<g id="endLabels"></g>`;
  s += `<line id="gapCur" y1="${f.pad.t - 6}" y2="${f.h - f.pad.b}" stroke="#0c0c0d" stroke-width="1.5"/></svg>`;
  el.innerHTML = s;
  el._f = f; el._y = y; el._shown = shown; el._gapAt = gapAt;
  hoverChart(el, k => [roundLabel(k).join(" · "),
    ...[...shown].sort((a, b) => M.rank[a][k] - M.rank[b][k]).map(i => [name(i), M.P[i][k] ? fmt(M.P[i][k]) : "0"])]);

  $("gapHead").textContent = `Points behind the leader`;
  $("gapLegend").innerHTML = list.map(i =>
    `<button data-i="${i}" aria-pressed="${!st.hiddenLines.has(i)}"><i style="background:${S.drivers[i].k}"></i>${esc(name(i))}</button>`).join("");
}

function paintGap(t) {
  const el = $("gapChart"), f = el._f;
  if (!f || st.view !== "gap") return;
  const M = st.M, D = st.S.done, k = Math.floor(t), k2 = Math.min(k + 1, D), fr = t - k;
  const px = f.x(t);
  $("pastRect").setAttribute("width", px);
  const cur = $("gapCur");
  cur.setAttribute("x1", px); cur.setAttribute("x2", px);
  const labels = [];
  el.querySelectorAll(".dot").forEach(c => {
    const i = +c.dataset.i, yy = el._y(lerp(el._gapAt(i, k), el._gapAt(i, k2), fr));
    c.setAttribute("cx", px); c.setAttribute("cy", yy);
    labels.push({ i, y: yy });
  });
  // Name each line beside the cursor end of the plot, nudged apart so none collide.
  labels.sort((a, b) => a.y - b.y);
  for (let j = 1; j < labels.length; j++) labels[j].y = Math.max(labels[j].y, labels[j - 1].y + 15);
  const over = labels.length ? labels[labels.length - 1].y - (f.h - f.pad.b) : 0;
  if (over > 0) {
    labels[labels.length - 1].y -= over;
    for (let j = labels.length - 2; j >= 0; j--) labels[j].y = Math.min(labels[j].y, labels[j + 1].y - 15);
  }
  $("endLabels").innerHTML = labels.map(l =>
    `<text class="lab" x="${f.w - f.pad.r + 8}" y="${l.y + 4}">${esc(name(l.i))}</text>`).join("");
}

/* Still alive */
function drawReach(k) {
  const S = st.S, M = st.M, box = $("reach");
  const lead = M.leaderAt(k), post = M.P[lead][k];
  const ids = [...st.order].sort((a, b) => M.rank[a][k] - M.rank[b][k]).slice(0, 12);
  const scale = Math.max(...ids.map(i => M.reach(i, k)), post, 1);
  const pc = v => (100 * v / scale).toFixed(2) + "%";
  const alive = S.drivers.filter((_, i) => M.out[i] === null || M.out[i] > k).length;
  const left = S.rounds.length - k;
  $("reachHead").textContent = k === 0 ? "Everyone starts alive"
    : left === 0 ? `${name(lead)} takes the title`
    : alive === 1 ? `${name(lead)} is out of reach with ${plural(left, "round")} to go`
    : `${alive} drivers can still win, ${plural(left, "round")} left`;
  box.innerHTML = ids.map(i => {
    const d = S.drivers[i], now = M.P[i][k], can = Math.max(M.reach(i, k), now);
    const dead = M.out[i] !== null && M.out[i] <= k && k > 0;
    const note = dead ? `Out, round ${M.out[i]}` : k === 0 ? `up to ${fmt(can)}`
      : left ? `up to ${fmt(can)}` : `${fmt(now)}`;
    return `<div class="rr${dead ? " dead" : ""}"><span>${esc(d.n)}</span>
      <span class="track2" style="--c:${d.k}"><i class="now" style="width:${pc(now)};background:${d.k}"></i>
      <i class="can" style="left:${pc(now)};width:${pc(can - now)}"></i>${k ? `<i class="post" style="left:${pc(post)}"></i>` : ""}</span>
      <span class="note">${note}</span></div>`;
  }).join("");
}

/* Tug of war */
function buildDuelPicks() {
  if (st.hide && name(st.a) > name(st.b)) [st.a, st.b] = [st.b, st.a];
  const pool = st.order.slice(0, 16);
  const opts = (st.hide ? byName(pool) : pool).map(i => `<option value="${i}">${esc(st.S.drivers[i].f)}</option>`).join("");
  $("duelA").innerHTML = opts; $("duelB").innerHTML = opts;
  $("duelA").value = st.a; $("duelB").value = st.b;
}

function duelColours() {
  const A = st.S.drivers[st.a].k, B = st.S.drivers[st.b].k;
  return [A, A === B ? "#8b8e94" : B];
}

function drawDuel() {
  const el = $("duelChart"), S = st.S, M = st.M, a = st.a, b = st.b, D = S.done;
  const [ca, cb] = duelColours();
  const f = plotFrame(el, 270, { l: 38, r: 14, t: 18, b: 26 });
  const diff = M.P[a].map((v, k) => v - M.P[b][k]);
  const max = Math.max(5, ...diff.map(Math.abs)), step = niceStep(max, 3), top = Math.ceil(max / step) * step;
  const y = v => f.pad.t + (f.h - f.pad.t - f.pad.b) * (1 - (v + top) / (2 * top));
  const line = diff.map((v, k) => `${f.x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${f.x(0)},${y(0)} ${line} ${f.x(D)},${y(0)}`;
  let s = `<svg viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="Running points difference between the two drivers">`;
  s += `<defs><clipPath id="duelPast"><rect id="duelRect" x="0" y="0" width="0" height="${f.h}"/></clipPath>
    <clipPath id="above"><rect x="0" y="0" width="${f.w}" height="${y(0)}"/></clipPath>
    <clipPath id="below"><rect x="0" y="${y(0)}" width="${f.w}" height="${f.h}"/></clipPath></defs>`;
  for (let v = -top; v <= top + 1e-6; v += step) {
    s += `<line x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#d6d7d9"/>`;
    if (v) s += `<text x="${f.pad.l - 7}" y="${y(v) + 4}" text-anchor="end">${fmt(Math.abs(v))}</text>`;
  }
  const shape = op => `<polygon points="${area}" fill="${ca}" clip-path="url(#above)" opacity="${op}"/>
    <polygon points="${area}" fill="${cb}" clip-path="url(#below)" opacity="${op}"/>`;
  if (!st.hide) s += `<g>${shape(.13)}</g>`;
  s += `<g clip-path="url(#duelPast)">${shape(.9)}</g>`;
  s += `<line x1="${f.pad.l}" x2="${f.w - f.pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#0c0c0d" stroke-width="2"/>`;
  s += `<text class="lab" x="${f.pad.l + 6}" y="13">▲ ${esc(name(a))} ahead</text>`;
  s += `<text class="lab" x="${f.pad.l + 6}" y="${f.h - f.pad.b - 6}">▼ ${esc(name(b))} ahead</text>`;
  s += roundAxis(f);
  s += `<line id="duelCur" y1="${f.pad.t - 8}" y2="${f.h - f.pad.b}" stroke="#0c0c0d" stroke-width="1.5"/></svg>`;
  el.innerHTML = s;
  el._f = f;
  hoverChart(el, k => {
    const d = diff[k];
    return [roundLabel(k).join(" · "), [name(a), fmt(M.P[a][k])], [name(b), fmt(M.P[b][k])],
      [d === 0 ? "Level" : `${name(d > 0 ? a : b)} ahead`, d === 0 ? "" : fmt(Math.abs(d))]];
  });

  // Round-by-round swing
  const el2 = $("duelBars"), g = plotFrame(el2, 118, { l: 38, r: 14, t: 16, b: 8 });
  const sw = M.perRound[a].map((v, k) => (k < D ? v - M.perRound[b][k] : 0));
  const mx = Math.max(1, ...sw.map(Math.abs));
  const yy = v => g.pad.t + (g.h - g.pad.t - g.pad.b) * (1 - (v + mx) / (2 * mx));
  const bw = Math.max(3, (g.x(1) - g.x(0)) * .62);
  let t = `<svg viewBox="0 0 ${g.w} ${g.h}" role="img" aria-label="Points swing between the two drivers at each round">`;
  t += `<text x="${g.pad.l}" y="10" style="font-size:12.5px">Points swing at each round</text>`;
  t += `<line x1="${g.pad.l}" x2="${g.w - g.pad.r}" y1="${yy(0)}" y2="${yy(0)}" stroke="#0c0c0d"/>`;
  sw.forEach((v, k) => {
    if (!v || k >= D) return;
    const top2 = Math.min(yy(v), yy(0)), hh = Math.abs(yy(v) - yy(0));
    t += `<rect class="swing" data-k="${k + 1}" x="${g.x(k + 1) - bw / 2}" y="${top2}" width="${bw}" height="${hh}" fill="${v > 0 ? ca : cb}"/>`;
  });
  el2.innerHTML = t + "</svg>";
  el2._sw = sw;
}

function paintDuel(t) {
  const el = $("duelChart"), f = el._f;
  if (!f || st.view !== "duel") return;
  const px = f.x(t);
  $("duelRect").setAttribute("width", px);
  $("duelCur").setAttribute("x1", px); $("duelCur").setAttribute("x2", px);
}

function duelRound(k) {
  const el2 = $("duelBars"), M = st.M, a = st.a, b = st.b;
  el2.querySelectorAll(".swing").forEach(r => r.setAttribute("opacity", +r.dataset.k <= k ? 1 : st.hide ? 0 : .16));
  const d = M.P[a][k] - M.P[b][k];
  let wa = 0, wb = 0;
  (el2._sw || []).slice(0, k).forEach(v => { if (v > 0) wa++; else if (v < 0) wb++; });
  $("duelHead").textContent = k === 0 ? "Pull the rope: press play"
    : `${d === 0 ? "Level on points" : `${name(d > 0 ? a : b)} up by ${fmt(Math.abs(d))}`}. Better round: ${name(a)} ${wa}, ${name(b)} ${wb}.`;
}

/* Race sheet */
function drawSheet() {
  const S = st.S, top = st.order.slice(0, 14), ids = st.hide ? byName(top) : top, box = $("sheet");
  const head = S.rounds.map((r, k) => `<th data-k="${k + 1}" title="${esc(r.n)}">${esc(r.a)}</th>`).join("");
  const body = ids.map(i => {
    const cells = S.place[i].map((p, k) => {
      let c = "", txt = "";
      if (p === null) c = "e";
      else if (p === 1) { c = "w"; txt = 1; }
      else if (p === 2 || p === 3) { c = "p"; txt = p; }
      else if (typeof p === "number") { c = st.M.perRound[i][k] > 0 ? "s" : ""; txt = p; }
      else { c = "x"; txt = p === "DNF" ? "R" : p; }
      return `<td class="${c}" data-k="${k + 1}">${txt}</td>`;
    }).join("");
    return `<tr><th>${esc(S.drivers[i].n)}</th>${cells}</tr>`;
  }).join("");
  box.innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function paintSheet(k) {
  const box = $("sheet");
  box.classList.toggle("hide", st.hide);
  box.querySelectorAll("td[data-k]").forEach(c => {
    const q = +c.dataset.k;
    c.classList.toggle("ahead", q > k);
    c.classList.toggle("cur", q === k);
  });
}

/* Turning points */
function drawLog() {
  const S = st.S, M = st.M, D = S.done, items = [];
  let bestLead = { v: 0 };
  for (let k = 1; k <= D; k++) {
    const l = M.leaderAt(k), second = M.rank.findIndex(r => r[k] === 1);
    if (k === 1) items.push([k, `${name(l)} leads after the opener`]);
    else if (l !== M.leaderAt(k - 1)) items.push([k, `${name(l)} takes the lead from ${name(M.leaderAt(k - 1))}`]);
    const m = second >= 0 ? M.P[l][k] - M.P[second][k] : 0;
    if (m > bestLead.v) bestLead = { v: m, k, l };
  }
  M.out.forEach((k, i) => {
    if (k && k < S.rounds.length && M.rank[i][k] < 6 && !(k === M.clinch))
      items.push([k, `${name(i)} is out of the running`]);
  });
  const clinchAt = st.mode === "official" && !isLive() ? S.decided : M.clinch;
  if (clinchAt) {
    const c = M.leaderAt(clinchAt);
    items.push([clinchAt, `${name(c)} clinches the title`]);
  }
  if (bestLead.k) items.push([bestLead.k, `${name(bestLead.l)}'s biggest lead of the year: ${fmt(bestLead.v)} points`]);
  items.sort((a, b) => a[0] - b[0]);
  $("log").innerHTML = items.map(([k, msg]) =>
    `<li data-k="${k}"><button data-k="${k}"><b>R${k}</b><span>${esc(msg)}</span></button></li>`).join("");
  paintLog(st.rd < 0 ? D : st.rd);
}

function paintLog(k) {
  document.querySelectorAll("#log li").forEach(li => {
    const later = +li.dataset.k > k;
    li.classList.toggle("ahead", later);
    li.hidden = later && st.hide;
  });
}

/* ---------- view + time ---------- */

function drawView() {
  if (st.view === "gap") drawGap();
  if (st.view === "duel") { drawDuel(); }
  if (st.view === "grid") drawSheet();
  st.rd = -1;
}

function setT(t) {
  t = clamp(t, 0, st.S.done);
  st.t = t;
  const s = $("slider");
  if (+s.value !== t) s.value = t;
  paintTower(t);
  paintGap(t);
  paintDuel(t);
  const k = Math.round(t);
  if (k !== st.rd) { st.rd = k; paintRound(k); }
}

function paintRound(k) {
  const [a, b] = roundLabel(k);
  $("roundNo").textContent = a;
  $("roundName").textContent = b;
  $("slider").setAttribute("aria-valuetext", `${a}, ${b}`);
  if (st.hide) { $("summary").textContent = summary(); drawWhatIf(); }
  if (k === st.S.done && $("recap")) $("recap").open = true;
  paintTowerRound(k);
  document.querySelectorAll("#ticks span").forEach(sp => sp.classList.toggle("on", +sp.dataset.k === k));
  if (st.view === "reach") drawReach(k);
  if (st.view === "duel") duelRound(k);
  if (st.view === "grid") paintSheet(k);
  paintLog(k);
}

function buildTicks() {
  const S = st.S, D = Math.max(S.done, 1), box = $("ticks");
  const narrow = box.clientWidth < 680;
  const every = S.rounds.length > 12 && narrow ? 2 : 1;
  box.innerHTML = S.rounds.slice(0, S.done).map((r, k) =>
    (k + 1) % every && k + 1 !== D ? "" :
    `<span data-k="${k + 1}" style="left:${(100 * (k + 1) / D).toFixed(2)}%">${esc(r.a)}</span>`).join("");
}

let raf = null;
function animateTo(target, ms) {
  cancelAnimationFrame(raf);
  if (calm || ms <= 0) return setT(target);
  const from = st.t, t0 = performance.now();
  const go = now => {
    const p = clamp((now - t0) / ms, 0, 1), e = 1 - (1 - p) ** 3;
    setT(p === 1 ? target : lerp(from, target, e));
    if (p < 1) raf = requestAnimationFrame(go);
  };
  raf = requestAnimationFrame(go);
}

function startPlay() {
  const D = st.S.done;
  if (!D) return;
  if (st.t >= D) setT(0);
  st.playing = true;
  $("play").textContent = "❚❚";
  $("play").setAttribute("aria-label", "Pause");
  if (calm) {
    const tick = () => {
      if (!st.playing) return;
      if (st.t >= D) return stopPlay();
      setT(Math.floor(st.t) + 1);
      raf = setTimeout(tick, 1000);
    };
    return void (raf = setTimeout(tick, 1000));
  }
  const speed = 1 / clamp(20000 / D, 550, 1500);
  let last = performance.now();
  const go = now => {
    if (!st.playing) return;
    const next = st.t + Math.max(0, now - last) * speed;
    last = now;
    if (next >= D) { setT(D); return stopPlay(); }
    setT(next);
    raf = requestAnimationFrame(go);
  };
  raf = requestAnimationFrame(go);
}

function stopPlay() {
  st.playing = false;
  cancelAnimationFrame(raf); clearTimeout(raf);
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play the season");
}

function pushHash() {
  if (!PAGE.home) history.replaceState(null, "", `#${Math.round(st.t)}`);
}

/* ---------- tooltip ---------- */

function showTip(x, y, lines) {
  const tip = $("tip");
  tip.innerHTML = `<b>${esc(lines[0])}</b>` + lines.slice(1).map(l => `<div><span>${esc(l[0])}</span><span>${esc(l[1])}</span></div>`).join("");
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = clamp(x + 14, 8, innerWidth - w - 8) + "px";
  tip.style.top = clamp(y - h - 10, 8, innerHeight - h - 8) + "px";
}

function hoverChart(el, describe) {
  el.onpointermove = e => {
    if (e.pointerType === "touch") return;
    const svg = el.querySelector("svg"), r = svg.getBoundingClientRect();
    const k = el._f.invX((e.clientX - r.left) * (el._f.w / r.width));
    if (st.hide && k > Math.ceil(st.t)) return void ($("tip").hidden = true);
    showTip(e.clientX, e.clientY, describe(k));
  };
  el.onpointerleave = () => ($("tip").hidden = true);
  el.onclick = e => {
    const svg = el.querySelector("svg"), r = svg.getBoundingClientRect();
    stopPlay();
    animateTo(el._f.invX((e.clientX - r.left) * (el._f.w / r.width)), 260);
    setTimeout(pushHash, 300);
  };
}

/* ---------- archive ---------- */

function spark(m) {
  const w = 200, h = 36, cap = 4;
  if (!m.length) return "";
  const x = i => (m.length < 2 ? 0 : (w * i) / (m.length - 1));
  const y = v => h - 1 - (Math.min(v, cap) / cap) * (h - 2);
  const line = m.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,${h} ${line} ${w},${h}" fill="#fff" opacity=".2"/>
    <polyline points="${line}" fill="none" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function drawTiles() {
  const all = st.index.seasons, by = st.sort;
  const list = [...all].filter(s => by !== "flip" || s.flip.length);
  const done = s => !s.live;
  if (by === "tn") list.sort((a, b) => (b.tn ?? -1) - (a.tn ?? -1));
  if (by === "gap") list.sort((a, b) => done(b) - done(a) || a.gapw - b.gapw || a.gap - b.gap);
  if (by === "chg") list.sort((a, b) => b.chg - a.chg);
  if (by === "flip") list.sort((a, b) => b.flip.length - a.flip.length || a.y - b.y);
  if (by === "y") list.sort((a, b) => b.y - a.y);
  $("arcNote").textContent = {
    tn: "The white trace is the leader's margin over the season. The lower it hugs the floor, the closer the fight.",
    gap: "Final margin, in race wins, so 1958 and 2021 compare fairly.",
    chg: "How many times the championship lead changed hands between rounds.",
    flip: `${list.length} of ${all.filter(done).length} finished seasons would have a different champion under at least one other scoring system.`,
    y: "Newest first.",
  }[by];
  const sub = s => s.live ? `Round ${s.done} of ${s.rounds}` : by === "chg" ? plural(s.chg, "change") : `Tension ${s.tn}`;
  const verb = s => s.live ? "leads" : "beat";
  $("tiles").innerHTML = list.map(s => {
    const flip = s.flip.length ? `${esc(s.flip[0][1])} under ${esc(SCORING[s.flip[0][0]].label.toLowerCase())}` : "";
    return `<a class="tile" data-y="${s.y}" href="${BASE}${s.y}/"><div class="h"><b>${s.y}</b><span>${sub(s)}</span></div>
      <div class="w">${esc(s.a)} <em>${verb(s)}</em> ${esc(s.b)} <em>by ${fmt(s.gap)}</em></div>
      ${spark(s.m)}<div class="f">${flip}</div></a>`;
  }).join("");
}

/* ---------- wiring ---------- */

function setView(v) {
  st.view = v;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.v === v));
  document.querySelectorAll(".panel").forEach(p => (p.hidden = p.id !== "p-" + v));
  drawView();
  setT(st.t);
}

function wire() {
  const sl = $("slider");
  let dragging = false;
  sl.addEventListener("pointerdown", () => { dragging = true; stopPlay(); cancelAnimationFrame(raf); });
  sl.addEventListener("input", () => { stopPlay(); cancelAnimationFrame(raf); setT(+sl.value); });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    animateTo(Math.round(st.t), 200);
    setTimeout(pushHash, 240);
  };
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
  sl.addEventListener("keydown", e => {
    const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (e.key === "Home" || e.key === "End" || by) e.preventDefault(); else return;
    stopPlay();
    const D = st.S.done;
    animateTo(e.key === "Home" ? 0 : e.key === "End" ? D : clamp(Math.round(st.t) + by, 0, D), 220);
    setTimeout(pushHash, 260);
  });
  $("play").onclick = () => {
    if (!st.playing) return startPlay();
    stopPlay();
    animateTo(Math.round(st.t), 200);
    setTimeout(pushHash, 240);
  };
  $("ticks").onclick = e => {
    const k = e.target.dataset.k;
    if (k) { stopPlay(); animateTo(+k, 300); setTimeout(pushHash, 340); }
  };

  $("pick").onchange = e => goSeason(+e.target.value);
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-y]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    goSeason(+a.dataset.y);
  });
  $("sorts").onclick = e => {
    if (!e.target.dataset.s) return;
    st.sort = e.target.dataset.s;
    [...$("sorts").children].forEach(b => b.classList.toggle("on", b === e.target));
    drawTiles();
  };

  $("scoring").onchange = e => {
    st.mode = e.target.value;
    remodel();
    buildDuelPicks();
    const t = Math.round(st.t);
    drawAll();
    st.rd = -1;
    setT(t);
  };
  $("spoil").onchange = e => {
    st.hide = e.target.checked;
    try { localStorage.setItem("hideAhead", st.hide ? "1" : "0"); } catch {}
    const t = st.hide ? 0 : st.t;
    buildDuelPicks();
    drawAll();
    st.rd = -1;
    setT(t);
  };

  document.querySelector(".tabs").onclick = e => { if (e.target.dataset.v) setView(e.target.dataset.v); };
  $("gapLegend").onclick = e => {
    const b = e.target.closest("button");
    if (!b) return;
    const i = +b.dataset.i;
    st.hiddenLines.has(i) ? st.hiddenLines.delete(i) : st.hiddenLines.add(i);
    drawGap();
    paintGap(st.t);
  };
  const duel = () => {
    st.a = +$("duelA").value; st.b = +$("duelB").value;
    drawDuel(); paintDuel(st.t); duelRound(Math.round(st.t));
  };
  $("duelA").onchange = duel; $("duelB").onchange = duel;
  $("log").onclick = e => {
    const b = e.target.closest("button");
    if (b) { stopPlay(); animateTo(+b.dataset.k, 300); setTimeout(pushHash, 340); }
  };
  $("sheet").onclick = e => {
    const k = e.target.dataset && e.target.dataset.k;
    if (k) { stopPlay(); animateTo(+k, 260); setTimeout(pushHash, 300); }
  };
  $("sheet").onmouseover = e => {
    const c = e.target;
    if (c.tagName !== "TD" || !c.dataset.k) return;
    const r = st.S.rounds[c.dataset.k - 1];
    c.title = r.n + " GP";
  };

  let timer;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!st.S) return;
      buildTicks();
      drawView();
      setT(st.t);
    }, 150);
  }).observe($("gapChart").parentElement.parentElement);
}

function goSeason(y) {
  if (y !== st.S.y) return void (location.href = `${BASE}${y}/#play`);
  stopPlay();
  setT(0);
  startPlay();
  scrollTo({ top: $("fight").offsetTop });
}

async function boot() {
  st.index = await (await fetch(`${BASE}data/index.json`)).json();
  const seasons = st.index.seasons;

  $("pick").innerHTML = [...seasons].reverse().map(s => `<option value="${s.y}">${s.y}</option>`).join("");
  $("scoring").innerHTML = Object.entries(SCORING).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  $("updated").textContent = `Results up to ${new Date(st.index.updated + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`;

  try { st.hide = localStorage.getItem("hideAhead") !== "0"; } catch {}
  $("spoil").checked = st.hide;

  wire();
  drawTiles();

  const link = location.hash.match(/^#(\d+)$/);
  const round = link ? +link[1] : st.hide ? 0 : null;
  await loadSeason(+PAGE.year, { round, autoplay: !link && (!!PAGE.home || location.hash === "#play") });
  const recap = $("recap");
  if (recap) recap.open = !st.hide;
  addEventListener("hashchange", () => {
    const m = location.hash.match(/^#(\d+)$/);
    if (m) { stopPlay(); setT(+m[1]); }
  });
}

boot().catch(err => {
  console.error(err);
  $("summary").textContent = "The data would not load. Refresh to try again.";
});
