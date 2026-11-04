// Knowledge graph of "Statistics for Chemical Engineers" (no dependencies; data from data.js)
(() => {
  const D = window.BOOK_GRAPH;
  const NS = "http://www.w3.org/2000/svg";
  // The map and the subpages share this script; elements a page lacks are stood in by detached ones
  const stubs = new Map();
  const $ = (id) => document.getElementById(id) ?? stubs.get(id) ?? stubs.set(id, document.createElement("div")).get(id);
  const ON_MAP = !!document.getElementById("graph");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (x) => Number(x).toLocaleString("en-US");
  const el = (tag, attrs = {}) => {
    const x = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, String(v));
    return x;
  };

  const fam = Object.fromEntries(D.families.map((f) => [f.id, f]));
  const famOrder = D.families.map((f) => f.id);
  const byId = new Map(D.nodes.map((n) => [n.id, n]));
  const chTitle = (n) => D.chapters[n - 1]?.title ?? "";
  const concepts = D.nodes.filter((n) => n.family !== "app");
  const rankOf = (key) => {
    const r = new Map();
    concepts.filter((n) => n[key] != null).sort((a, b) => b[key] - a[key]).forEach((n, i) => r.set(n.id, i + 1));
    return r;
  };
  const hubRank = rankOf("hub"), bridgeRank = rankOf("bridge");
  const TOP_HUBS = new Set([...hubRank].filter(([, r]) => r <= 8).map(([id]) => id));

  const state = {
    families: new Set(famOrder),
    sizeBy: "hub",
    minShared: 2,
    selected: null,
    hovered: null,
    showPath: false,
    chapter: null, // 1..7 when the map is focused on one chapter
  };

  // ------------------------------------------------------------------ controls
  $("families").innerHTML = D.families.map((f) => {
    const n = D.nodes.filter((x) => x.family === f.id).length;
    return `<label class="check"><input type="checkbox" value="${f.id}" ${state.families.has(f.id) ? "checked" : ""}/>` +
      `<span class="dot" style="background:${f.color}"></span><span title="${esc(f.full)}">${esc(f.label)}</span> <span class="muted">(${n})</span></label>`;
  }).join("");
  $("legend").innerHTML = D.families.map((f) => `<li data-f="${f.id}" title="${esc(f.full)}"><span class="dot" style="background:${f.color}"></span>${esc(f.label)}</li>`).join("");
  $("topic-names").innerHTML = D.nodes.map((n) => `<option value="${esc(n.name)}">${n.label !== n.name ? esc(n.label) : ""}</option>`).join("");

  // ------------------------------------------------------------------ geometry helpers
  const svg = $("graph"), vp = $("viewport"), edgeLayer = $("edges"), nodeLayer = $("nodes");
  let view = { k: 1, x: 0, y: 0 };
  let fitBox = null;
  const applyView = () => {
    vp.setAttribute("transform", `translate(${view.x.toFixed(1)},${view.y.toFixed(1)}) scale(${view.k.toFixed(4)})`);
    // Labels keep a readable on-screen size whatever the zoom
    vp.style.setProperty("--inv", (1 / view.k).toFixed(4));
    svg.classList.toggle("zoomed", view.k > fitK() * 1.35);
  };
  let fitScale = 1;
  const fitK = () => fitScale;
  function fit() {
    if (!fitBox) return;
    const w = svg.clientWidth, h = svg.clientHeight;
    const [x0, y0, x1, y1] = fitBox;
    const k = Math.min(w / (x1 - x0), h / (y1 - y0)) * 0.99;
    fitScale = k;
    view = { k, x: w / 2 - k * (x0 + x1) / 2, y: h / 2 - k * (y0 + y1) / 2 };
    applyView();
  }
  function zoomAt(f, px = svg.clientWidth / 2, py = svg.clientHeight / 2) {
    const k = Math.max(fitScale * 0.5, Math.min(fitScale * 8, view.k * f));
    const r = k / view.k;
    view = { k, x: px - (px - view.x) * r, y: py - (py - view.y) * r };
    applyView();
  }

  // ------------------------------------------------------------------ visible graph
  const visibleNodes = () => D.nodes.filter((n) => state.families.has(n.family));
  const visibleEdges = (ids) => D.edges.filter((e) => e.shared >= state.minShared && ids.has(e.source) && ids.has(e.target));
  let shown = [], shownEdges = [], neighbors = new Map();

  function metric(n) {
    if (state.chapter) return n.byChapter[state.chapter - 1];
    if (state.sizeBy === "degree") return neighbors.get(n.id)?.size ?? 0; // links currently shown
    const v = n[state.sizeBy];
    if (v == null) return 0;
    return v;
  }
  function radius(n) {
    const max = Math.max(...concepts.map((x) => metric(x) || 0), 1);
    let v = metric(n);
    if (n.family === "app" && state.sizeBy === "hub" && !state.chapter) v = (n.units / Math.max(...concepts.map((x) => x.units))) * max;
    return 4 + 22 * Math.sqrt(Math.max(0, v) / max);
  }

  // ------------------------------------------------------------------ ring layout (as on the collaboration page)
  const ringPos = new Map();
  let ringStep = 20;
  function ringLayout() {
    const ns = shown.slice().sort((a, b) => famOrder.indexOf(a.family) - famOrder.indexOf(b.family) || (metric(b) - metric(a)) || a.label.localeCompare(b.label));
    // Each topic gets an arc of the ring as wide as its circle (at least one line of label text),
    // so large hubs have room to stand out
    ringStep = 17.5;
    const rs = ns.map((n) => 3 + 27 * Math.max(0, radius(n) - 4) / 22);
    const slots = rs.map((r) => Math.max(ringStep, 2 * r + 4));
    const total = slots.reduce((a, b) => a + b, 0);
    const R = Math.max(200, total / (2 * Math.PI));
    ringPos.clear();
    let acc = 0;
    ns.forEach((n, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * (acc + slots[i] / 2)) / total;
      acc += slots[i];
      ringPos.set(n.id, { x: R * Math.cos(a), y: R * Math.sin(a), a, r: rs[i] });
    });
  }
  const P = (id) => ringPos.get(id);

  // ------------------------------------------------------------------ drawing
  const nodeEls = new Map(), edgeEls = [];
  function draw() {
    shown = visibleNodes();
    const ids = new Set(shown.map((n) => n.id));
    shownEdges = visibleEdges(ids);
    neighbors = new Map(shown.map((n) => [n.id, new Set()]));
    for (const e of shownEdges) { neighbors.get(e.source).add(e.target); neighbors.get(e.target).add(e.source); }
    ringLayout();

    edgeLayer.replaceChildren(); edgeEls.length = 0;
    for (const e of shownEdges) {
      const x = el("path", { "stroke-width": (0.6 + 2.6 * e.w).toFixed(2) });
      x.dataset.s = e.source; x.dataset.t = e.target;
      if (state.chapter && !(byId.get(e.source).byChapter[state.chapter - 1] && byId.get(e.target).byChapter[state.chapter - 1])) x.classList.add("off");
      edgeLayer.append(x); edgeEls.push([x, e]);
    }
    nodeLayer.replaceChildren(); nodeEls.clear();
    for (const n of shown) {
      const r = ringPos.get(n.id).r;
      const ch = state.chapter;
      const cls = ch ? (n.byChapter[ch - 1] ? "" : " off") + (n.intro === ch ? " new" : "") : (TOP_HUBS.has(n.id) ? " hub" : "");
      const g = el("g", { class: "node" + cls, tabindex: 0, role: "button", "aria-label": n.name });
      g.dataset.id = n.id;
      g.append(el("circle", { r: r.toFixed(1), fill: fam[n.family].color }));
      const t = el("text");
      t.textContent = n.label;
      const tt = el("title"); tt.textContent = n.name; g.append(tt);
      g.append(t);
      nodeLayer.append(g); nodeEls.set(n.id, { g, t, r });
    }
    place();
    // Fit to the drawing
    const xs = shown.map((n) => P(n.id));
    if (xs.length) {
      const pad = ringStep * (1.2 * 0.56 * Math.max(...shown.map((n) => n.label.length)) + 0.3) + 32;
      fitBox = [Math.min(...xs.map((p) => p.x)) - pad, Math.min(...xs.map((p) => p.y)) - pad, Math.max(...xs.map((p) => p.x)) + pad, Math.max(...xs.map((p) => p.y)) + pad];
      // On the map, fit to the drawing as actually rendered (labels included), so long names don't waste space
      if (ON_MAP && vp.getBBox) { const b = vp.getBBox(); if (b.width) fitBox = [b.x - 6, b.y - 6, b.x + b.width + 6, b.y + b.height + 6]; }
      fit();
    }
    svg.classList.toggle("chapter", !!state.chapter);
    $("hint").textContent = "Hover or click a topic to see its links · drag to pan · ⌘/ctrl + scroll, pinch or double-click to zoom · " + (state.chapter
      ? `sized by mentions in Chapter ${state.chapter}; outlined circles are introduced in this chapter; faded topics do not appear in it`
      : "outlined circles are the top hub topics");
    highlight();
    renderTotals();
  }
  function place() {
    for (const [id, { g, t, r }] of nodeEls) {
      const p = P(id);
      g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      {
        const deg = (p.a * 180) / Math.PI, flip = Math.cos(p.a) < 0, gap = r + ringStep * 0.25;
        // As on the collaboration page, ring labels scale with the drawing (one line of text per slot)
        t.style.fontSize = `${(ringStep * 1.2).toFixed(1)}px`;
        t.setAttribute("transform", `rotate(${flip ? deg + 180 : deg})`);
        t.setAttribute("x", flip ? -gap : gap); t.setAttribute("y", 0); t.setAttribute("dy", "0.35em");
        t.setAttribute("text-anchor", flip ? "end" : "start");
      }
    }
    for (const [x, e] of edgeEls) {
      const p = P(e.source), q = P(e.target);
      // Curve each link slightly toward the center, as on the collaboration page
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      x.setAttribute("d", `M${p.x.toFixed(1)},${p.y.toFixed(1)}Q${(mx * 0.8).toFixed(1)},${(my * 0.8).toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`);
    }
  }

  // "Builds on" chain: follow each topic's strongest links to topics introduced earlier
  function foundations(id, depth = 4, perStep = 3) {
    const nodes = new Set([id]), edges = new Set();
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = [];
      for (const cur of frontier) {
        const inc = shownEdges.filter((e) => e.directed && e.target === cur).sort((a, b) => b.w - a.w).slice(0, perStep);
        for (const e of inc) {
          edges.add(e);
          if (!nodes.has(e.source)) { nodes.add(e.source); next.push(e.source); }
        }
      }
      frontier = next;
    }
    return { nodes, edges };
  }

  function highlight() {
    const f = state.hovered ?? state.selected;
    const near = f ? neighbors.get(f) ?? new Set() : null;
    const path = state.showPath && state.selected && !state.hovered ? foundations(state.selected) : null;
    svg.classList.toggle("focus", !!f);
    for (const [id, { g }] of nodeEls) {
      const on = !!f && (id === f || (path ? path.nodes.has(id) : near.has(id)));
      g.classList.toggle("on", on);
      g.classList.toggle("me", id === f);
      g.classList.toggle("selected", id === state.selected);
      g.classList.toggle("anc", !!path && path.nodes.has(id) && id !== f);
    }
    for (const [x, e] of edgeEls) {
      const on = !!f && !path && (e.source === f || e.target === f);
      const inPath = !!path && path.edges.has(e);
      x.classList.toggle("on", on);
      x.classList.toggle("path", inPath);
      if (on || inPath) edgeLayer.append(x);
    }
  }

  // ------------------------------------------------------------------ details panel
  const panel = $("panel");
  const chip = (id) => { const n = byId.get(id); return `<button class="chip linkchip" data-id="${id}" title="${esc(n.name)}"><span class="dot" style="background:${fam[n.family].color};width:.55rem;height:.55rem"></span> ${esc(n.label)}</button>`; };
  function showPanel(id) {
    panel.hidden = !id && !state.chapter;
    $("net-wrap").classList.toggle("has-panel", !panel.hidden);
    if (!id) { if (state.chapter) showChapterPanel(state.chapter); return; }
    const n = byId.get(id);
    const mine = D.edges.filter((e) => e.source === id || e.target === id);
    const buildsOn = mine.filter((e) => e.directed && e.target === id).sort((a, b) => b.w - a.w);
    const leadsTo = mine.filter((e) => e.directed && e.source === id).sort((a, b) => b.w - a.w);
    const alongside = mine.filter((e) => !e.directed).sort((a, b) => b.w - a.w);
    const other = (e) => (e.source === id ? e.target : e.source);
    const maxCh = Math.max(...n.byChapter, 1);
    const hr = hubRank.get(id), br = bridgeRank.get(id);
    panel.innerHTML = `
      <h3>${esc(n.name)}</h3>
      <div class="small"><span class="dot" style="background:${fam[n.family].color}"></span> ${esc(fam[n.family].full)}</div>
      <p class="muted small" style="margin:.4rem 0">${esc(n.desc)}</p>
      <div class="kv">
        <div><b>${fmt(n.mentions)}</b><span>mentions</span></div>
        <div><b>${n.sections}</b><span>subsections</span></div>
        <div><b>${n.chapters}/7</b><span>chapters</span></div>
        <div><b>${n.examples}</b><span>examples</span></div>
        <div><b>${n.exercises}</b><span>exercises</span></div>
        <div><b>${n.frames}</b><span>slides</span></div>
      </div>
      ${hr ? `<div class="small">Hub score <strong>${n.hub}</strong> (#${hr} of ${hubRank.size}) · bridge #${br}</div>` : ""}
      ${n.intro ? `<div class="small">Introduced in <strong>Chapter ${n.intro}</strong>: ${esc(chTitle(n.intro))}</div>` : ""}
      <h4>Mentions by chapter</h4>
      <div class="spark">${n.byChapter.map((v, i) => `<div title="Ch. ${i + 1} ${esc(D.chapters[i].title)}: ${v}" style="height:${(100 * v / maxCh).toFixed(0)}%;opacity:${v ? 1 : .15}"></div>`).join("")}</div>
      <div class="spark-l">${n.byChapter.map((_, i) => `<span>Ch${i + 1}</span>`).join("")}</div>
      <h4>Where it appears most</h4>
      <ul class="plist">${n.top.map((t) => `<li>§${t.loc} ${esc(t.title)} <span class="muted">(${t.n})</span></li>`).join("")}</ul>
      ${buildsOn.length ? `<h4>Builds on</h4><div>${buildsOn.slice(0, 10).map((e) => chip(other(e))).join("")}</div>` : ""}
      ${leadsTo.length ? `<h4>Leads to</h4><div>${leadsTo.slice(0, 10).map((e) => chip(other(e))).join("")}</div>` : ""}
      ${alongside.length ? `<h4>Used alongside</h4><div>${alongside.slice(0, 10).map((e) => chip(other(e))).join("")}</div>` : ""}
      <p style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:1rem">
        ${buildsOn.length ? `<button class="btn secondary ${state.showPath ? "active" : ""}" id="path-btn" type="button">${state.showPath ? "Hide" : "Show"} path to foundations</button>` : ""}
        ${n.gitbook ? `<a class="btn secondary" href="${esc(n.gitbook.url)}" target="_blank" rel="noopener">Read online: ${esc(n.gitbook.title)}</a>` : ""}
        <button class="btn secondary" id="clear-sel" type="button">Clear</button>
      </p>`;
    panel.querySelector("#clear-sel").addEventListener("click", () => select(null));
    panel.querySelector("#path-btn")?.addEventListener("click", () => { state.showPath = !state.showPath; showPanel(id); highlight(); });
    panel.querySelectorAll(".linkchip").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
    // Hovering a link chip previews the edge
    panel.querySelectorAll(".linkchip").forEach((b) => {
      b.addEventListener("pointerenter", () => { const e = mine.find((x) => other(x) === b.dataset.id); if (e) tipShow(b, `Used together in ${e.shared} places, e.g. ${e.where.map((w) => "§" + w.loc + " " + w.title).join("; ")}`); });
      b.addEventListener("pointerleave", tipHide);
    });
  }
  // ------------------------------------------------------------------ chapters
  const conceptEdges = D.edges.filter((e) => e.directed && byId.get(e.source).family !== "app" && byId.get(e.target).family !== "app");
  const NCH = D.chapters.length;
  const flow = Array.from({ length: NCH + 1 }, () => Array(NCH + 1).fill(0));
  const flowEdges = Array.from({ length: NCH + 1 }, () => Array.from({ length: NCH + 1 }, () => []));
  for (const e of conceptEdges) {
    const a = byId.get(e.source).intro, b = byId.get(e.target).intro;
    if (a && b && a < b) { flow[a][b]++; flowEdges[a][b].push(e); }
  }
  const chapterTopics = (c) => D.nodes.filter((n) => n.family !== "app" && n.byChapter[c - 1]).sort((a, b) => b.byChapter[c - 1] - a.byChapter[c - 1]);
  function showChapterPanel(c) {
    const C = D.chapters[c - 1];
    const used = chapterTopics(c);
    const introduced = used.filter((n) => n.intro === c);
    const apps = D.nodes.filter((n) => n.family === "app" && n.byChapter[c - 1]).sort((a, b) => b.byChapter[c - 1] - a.byChapter[c - 1]);
    // Earlier topics that this chapter's new topics build on (and later topics that build on them)
    const pre = new Map(), post = new Map();
    for (const e of conceptEdges) {
      if (byId.get(e.target).intro === c && byId.get(e.source).intro < c) pre.set(e.source, (pre.get(e.source) ?? 0) + e.w);
      if (byId.get(e.source).intro === c && byId.get(e.target).intro > c) post.set(e.target, (post.get(e.target) ?? 0) + e.w);
    }
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => chip(id)).join("");
    const from = D.chapters.slice(0, c - 1).map((x) => [x.n, flow[x.n][c]]).filter(([, v]) => v);
    const to = D.chapters.slice(c).map((x) => [x.n, flow[c][x.n]]).filter(([, v]) => v);
    const chipCh = ([n, v]) => `<button class="chip chchip" data-ch="${n}">Ch. ${n} ${esc(D.chapters[n - 1].title)} <span class="muted">(${v})</span></button>`;
    const maxU = used[0]?.byChapter[c - 1] || 1;
    panel.innerHTML = `
      <div class="small muted">Chapter ${c} of ${NCH}</div>
      <h3>${esc(C.title)}</h3>
      <div class="kv">
        <div><b>${C.sections}</b><span>sections</span></div>
        <div><b>${C.subsections}</b><span>subsections</span></div>
        <div><b>${C.examples}</b><span>examples</span></div>
        <div><b>${C.exercises}</b><span>exercises</span></div>
        <div><b>${used.length}</b><span>topics mentioned</span></div>
        <div><b>${introduced.length}</b><span>introduced here</span></div>
      </div>
      <h4>Most mentioned topics</h4>
      <div class="bars">${used.slice(0, 10).map((x) => `<div class="bar-row" data-id="${x.id}" role="button" tabindex="0" style="grid-template-columns:9.5rem 1fr 2.4rem">
        <span class="name" title="${esc(x.name)}">${esc(x.label)}</span><span class="track"><span class="fill" style="display:block;width:${(100 * x.byChapter[c - 1] / maxU).toFixed(1)}%;background:${fam[x.family].color}"></span></span>
        <span class="val">${x.byChapter[c - 1]}</span></div>`).join("")}</div>
      ${introduced.length ? `<h4>Introduced in this chapter</h4><div>${introduced.map((x) => chip(x.id)).join("")}</div>` : ""}
      ${pre.size ? `<h4>Builds on earlier topics</h4><div>${top(pre)}</div>` : ""}
      ${from.length ? `<h4>Draws on chapters</h4><div>${from.map(chipCh).join("")}</div>` : ""}
      ${post.size ? `<h4>Leads to later topics</h4><div>${top(post)}</div>` : ""}
      ${to.length ? `<h4>Feeds into chapters</h4><div>${to.map(chipCh).join("")}</div>` : ""}
      ${apps.length ? `<h4>Applications</h4><div>${apps.slice(0, 8).map((x) => chip(x.id)).join("")}</div>` : ""}
      <p class="small muted">Numbers in brackets count “builds on” links between topics introduced in the two chapters.</p>
      <p style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem">
        ${c > 1 ? `<button class="btn secondary" data-go="${c - 1}" type="button">← Ch. ${c - 1}</button>` : ""}
        ${c < NCH ? `<button class="btn secondary" data-go="${c + 1}" type="button">Ch. ${c + 1} →</button>` : ""}
        <button class="btn secondary" data-go="0" type="button">All chapters</button>
      </p>`;
    panel.querySelectorAll(".linkchip, .bar-row").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
    panel.querySelectorAll(".chchip").forEach((b) => b.addEventListener("click", () => setChapter(+b.dataset.ch)));
    panel.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => setChapter(+b.dataset.go || null)));
  }
  function setChapter(c, { scroll = false } = {}) {
    if (!ON_MAP) { location.href = c ? `./?chapter=${c}` : "./"; return; }
    state.chapter = c || null;
    $("chapter").value = state.chapter ?? "";
    state.selected = null; state.showPath = false;
    draw(false);
    showPanel(null);
    renderFlow();
    if (scroll) $("map").scrollIntoView({ behavior: "smooth" });
    const u = new URL(location.href);
    u.searchParams.delete("topic");
    state.chapter ? u.searchParams.set("chapter", state.chapter) : u.searchParams.delete("chapter");
    history.replaceState(null, "", u);
  }

  // Chapter flow: arcs from the chapter where a topic is introduced to the chapters whose new topics build on it
  // One color per chapter (shared by the arcs, circles and cards on the Chapters page)
  const CH_COLORS = ["#1e88f0", "#8e44ad", "#00897b", "#c5050c", "#ef6c00", "#2e7d32", "#d81b60"];
  const chColor = (n) => CH_COLORS[(n - 1) % CH_COLORS.length];
  const introCount = (n) => D.nodes.filter((t) => t.family !== "app" && t.intro === n).length;
  function renderFlow() {
    const W = 1000, H = 330, base = 250, x = (n) => 80 + (n - 1) * ((W - 160) / (NCH - 1));
    const maxF = Math.max(...flow.flat(), 1);
    const maxI = Math.max(...D.chapters.map((c) => introCount(c.n)), 1);
    let defs = "", arcs = "";
    for (let a = 1; a <= NCH; a++) for (let b = a + 1; b <= NCH; b++) {
      const v = flow[a][b]; if (!v) continue;
      const x1 = x(a), x2 = x(b), h = (x2 - x1) * 0.34;
      const on = !state.chapter || state.chapter === a || state.chapter === b;
      const ex = flowEdges[a][b].sort((p, q) => q.w - p.w).slice(0, 3).map((e) => `${byId.get(e.source).label} → ${byId.get(e.target).label}`).join("; ");
      // Each arc fades from the color of the chapter it starts in to the color of the chapter it feeds
      defs += `<linearGradient id="g${a}${b}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0">
        <stop offset="0" stop-color="${chColor(a)}"/><stop offset="1" stop-color="${chColor(b)}"/></linearGradient>`;
      arcs += `<path class="arc" data-a="${a}" data-b="${b}" d="M${x1},${base} C${x1},${base - h} ${x2},${base - h} ${x2},${base}" fill="none" stroke="url(#g${a}${b})" stroke-linecap="round"
        stroke-width="${(1.5 + 14 * v / maxF).toFixed(1)}" stroke-opacity="${on ? 0.7 : 0.08}" data-tip="<strong>Ch. ${a} → Ch. ${b}</strong>: ${v} link${v > 1 ? "s" : ""}<br>e.g. ${esc(ex)}"/>`;
    }
    const nodes = D.chapters.map((c) => {
      const r = 12 + 18 * Math.sqrt(introCount(c.n) / maxI), sel = state.chapter === c.n, col = chColor(c.n);
      const words = c.title.split(" "), lines = [];
      for (const w of words) { if (lines.length && (lines[lines.length - 1] + " " + w).length <= 16) lines[lines.length - 1] += " " + w; else lines.push(w); }
      return `<g class="flow-ch" data-ch="${c.n}" role="button" tabindex="0" aria-label="Chapter ${c.n}: ${esc(c.title)}" style="cursor:pointer">
        <circle cx="${x(c.n)}" cy="${base}" r="${r.toFixed(1)}" fill="${col}" stroke="${sel ? "var(--text)" : "var(--card)"}" stroke-width="${sel ? 4 : 3}"/>
        <text x="${x(c.n)}" y="${base + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${c.n}</text>
        ${lines.map((l, i) => `<text x="${x(c.n)}" y="${base + r + 18 + i * 15}" text-anchor="middle" font-size="12.5" font-weight="${i === 0 ? 600 : 400}" fill="${col}">${esc(l)}</text>`).join("")}
        <title>${introCount(c.n)} topics introduced</title></g>`;
    }).join("");
    // Crop the drawing to the tallest arc and the chapter titles
    const top = base - 0.75 * (x(NCH) - x(1)) * 0.34 - 12;
    $("flow").innerHTML = `<svg viewBox="0 ${top.toFixed(0)} ${W} ${(base + 90 - top).toFixed(0)}" style="width:100%;display:block"><defs>${defs}</defs>${arcs}${nodes}</svg>`;
    renderChapterCards();
  }
  // Hovering a chapter brings out its own arcs
  $("flow").addEventListener("pointerover", (e) => {
    const g = e.target.closest(".flow-ch"); if (!g || state.chapter) return;
    $("flow").querySelectorAll(".arc").forEach((p) => p.setAttribute("stroke-opacity", p.dataset.a === g.dataset.ch || p.dataset.b === g.dataset.ch ? 0.85 : 0.06));
  });
  $("flow").addEventListener("pointerout", (e) => {
    if (!e.target.closest(".flow-ch") || state.chapter) return;
    $("flow").querySelectorAll(".arc").forEach((p) => p.setAttribute("stroke-opacity", 0.7));
  });

  // One card per chapter under the diagram
  function renderChapterCards() {
    $("flow-cards").innerHTML = D.chapters.map((c) => {
      const col = chColor(c.n);
      const fresh = D.nodes.filter((t) => t.family !== "app" && t.intro === c.n).sort((a, b) => b.mentions - a.mentions);
      const from = D.chapters.filter((x) => x.n < c.n && flow[x.n][c.n]).map((x) => x.n);
      return `<div class="card ch-card" data-ch="${c.n}" role="button" tabindex="0" style="border-top:5px solid ${col}">
        <div class="ch-num" style="color:${col}">Chapter ${c.n}</div>
        <h3>${esc(c.title)}</h3>
        <div class="ch-stats">
          <span><b style="color:${col}">${fresh.length}</b> new topics</span><span><b style="color:${col}">${c.sections}</b> sections</span>
          <span><b style="color:${col}">${c.examples}</b> examples</span><span><b style="color:${col}">${c.exercises}</b> exercises</span>
        </div>
        ${fresh.length ? `<div class="ch-sub">Introduces</div><div>${fresh.slice(0, 4).map((t) => chip(t.id)).join("")}${fresh.length > 4 ? `<span class="muted small">+${fresh.length - 4}</span>` : ""}</div>` : ""}
        ${from.length ? `<div class="ch-sub">Builds on</div><div>${from.map((n) => `<span class="ch-pill" style="background:${chColor(n)}">Ch. ${n}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("");
  }
  $("flow-cards").addEventListener("click", (e) => {
    const chipEl = e.target.closest(".linkchip");
    if (chipEl) { select(chipEl.dataset.id); return; }
    const card = e.target.closest(".ch-card"); if (card) setChapter(+card.dataset.ch);
  });
  $("flow-cards").addEventListener("keydown", (e) => {
    const card = e.target.closest(".ch-card");
    if (card && e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setChapter(+card.dataset.ch); }
  });
  $("flow").addEventListener("click", (e) => { const g = e.target.closest(".flow-ch"); if (g) setChapter(state.chapter === +g.dataset.ch ? null : +g.dataset.ch, { scroll: true }); });
  $("flow").addEventListener("keydown", (e) => { const g = e.target.closest(".flow-ch"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setChapter(+g.dataset.ch, { scroll: true }); } });
  $("flow").addEventListener("pointermove", (e) => { const p = e.target.closest("path[data-tip]"); p ? tipShow(null, p.dataset.tip, e) : tipHide(); });
  $("flow").addEventListener("pointerleave", () => tipHide());

  function select(id, { scroll = false } = {}) {
    if (!ON_MAP) { if (id) location.href = `./?topic=${encodeURIComponent(id)}`; return; }
    if (id && !state.families.has(byId.get(id).family)) {
      state.families.add(byId.get(id).family);
      $("families").querySelector(`input[value="${byId.get(id).family}"]`).checked = true;
      draw();
    }
    if (id !== state.selected) state.showPath = false;
    state.selected = id;
    showPanel(id);
    highlight();
    if (scroll) $("map").scrollIntoView({ behavior: "smooth" });
    const u = new URL(location.href);
    id ? u.searchParams.set("topic", id) : u.searchParams.delete("topic");
    history.replaceState(null, "", u);
  }

  // ------------------------------------------------------------------ tooltip
  const tip = $("tip");
  function tipShow(target, html, ev) {
    tip.innerHTML = html; tip.style.display = "block";
    const b = ev ? { left: ev.clientX + 12, top: ev.clientY + 12 } : (() => { const r = target.getBoundingClientRect(); return { left: r.left, top: r.bottom + 6 }; })();
    tip.style.left = Math.min(b.left, innerWidth - 320) + "px"; tip.style.top = b.top + "px";
  }
  const tipHide = () => (tip.style.display = "none");

  // ------------------------------------------------------------------ interaction
  let drag = null, dragged = false;
  svg.addEventListener("pointerdown", (e) => {
    const g = e.target.closest(".node");
    dragged = false;
    drag = { node: g?.dataset.id, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add("dragging");
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) dragged = true;
      if (dragged) { view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; applyView(); }
      return;
    }
    const g = e.target.closest(".node");
    if (g) {
      const n = byId.get(g.dataset.id);
      tipShow(null, `<strong>${esc(n.name)}</strong> <span class="muted">· ${esc(fam[n.family].full)}</span><br>${fmt(n.mentions)} mentions · ${n.sections} subsections · ${n.chapters} chapters${n.hub != null ? `<br>hub score ${n.hub}` : ""}`, e);
      if (state.hovered !== n.id) { state.hovered = n.id; highlight(); }
    } else if (state.hovered) { state.hovered = null; tipHide(); highlight(); }
  });
  svg.addEventListener("pointerup", (e) => {
    if (drag && !dragged) select(drag.node ?? null);
    drag = null; svg.classList.remove("dragging");
  });
  svg.addEventListener("pointerleave", () => { if (state.hovered) { state.hovered = null; highlight(); } tipHide(); });
  svg.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain scrolling still scrolls the page
    e.preventDefault();
    const b = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - b.left, e.clientY - b.top);
  }, { passive: false });
  nodeLayer.addEventListener("keydown", (e) => {
    const g = e.target.closest(".node");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(g.dataset.id); }
  });
  svg.addEventListener("dblclick", (e) => { e.preventDefault(); const b = svg.getBoundingClientRect(); zoomAt(e.shiftKey ? 1 / 2 : 2, e.clientX - b.left, e.clientY - b.top); });
  $("zoom-in").addEventListener("click", () => zoomAt(1.5));
  $("zoom-out").addEventListener("click", () => zoomAt(1 / 1.5));
  $("zoom-reset").addEventListener("click", fit);
  // Refit when the graph area changes size (window resize, details panel opening or closing)
  let lastW = 0;
  new ResizeObserver(() => { if (svg.clientWidth !== lastW) { lastW = svg.clientWidth; fit(); } }).observe(svg);

  $("families").addEventListener("change", (e) => {
    const b = e.target; b.checked ? state.families.add(b.value) : state.families.delete(b.value);
    if (state.selected && !state.families.has(byId.get(state.selected).family)) select(null);
    draw();
  });
  $("chapter").innerHTML = `<option value="">All chapters</option>` + D.chapters.map((c) => `<option value="${c.n}">Ch. ${c.n} ${esc(c.title)}</option>`).join("");
  $("chapter").addEventListener("change", (e) => setChapter(+e.target.value || null));
  $("size-by").addEventListener("change", (e) => { state.sizeBy = e.target.value; draw(); });
  $("min-shared").addEventListener("change", (e) => { state.minShared = +e.target.value; draw(); });
  const find = $("find");
  const lookup = (q) => {
    q = q.trim().toLowerCase();
    if (!q) return null;
    const keys = (n) => [n.name.toLowerCase(), n.label.toLowerCase()];
    return D.nodes.find((n) => keys(n).includes(q)) ?? D.nodes.find((n) => keys(n).some((k) => k.startsWith(q))) ?? D.nodes.find((n) => keys(n).some((k) => k.includes(q)) || n.id.includes(q));
  };
  find.addEventListener("change", () => { const n = lookup(find.value); if (n) select(n.id); });
  find.addEventListener("keydown", (e) => { if (e.key === "Enter") { const n = lookup(find.value); if (n) select(n.id); } });

  // ------------------------------------------------------------------ numbers
  function renderTotals() {
    const conceptShown = shown.filter((n) => n.family !== "app").length;
    $("totals").innerHTML = [
      [shown.length, "topics"], [shownEdges.length, "links"], [D.totals.chapters, "chapters"],
      [D.totals.examples, "examples"], [D.totals.exercises, "exercises"],
    ].map(([v, l], i) => `${i ? " · " : ""}<strong>${fmt(v)}</strong> ${l}`).join("");
    void conceptShown;
  }
  const T = D.totals;
  $("stat-cards").innerHTML = [
    [T.chapters, "chapters"], [T.sections, "sections"], [T.subsections, "subsections"], [T.examples, "worked examples"],
    [T.exercises, "exercises"], [T.slideFrames, "lecture slides"], [T.indexEntries, "index entries"], [T.topics, "topics mapped"], [T.links, "topic links"],
  ].map(([v, l]) => `<div class="card"><div class="stat">${fmt(v)}</div><div class="stat-label">${l}</div></div>`).join("");

  function bars(target, key, n = 12, label = (v) => fmt(v)) {
    const rows = concepts.filter((x) => x[key] != null).sort((a, b) => b[key] - a[key]).slice(0, n);
    const max = rows[0]?.[key] || 1;
    $(target).innerHTML = rows.map((x) => `<div class="bar-row" data-id="${x.id}" role="button" tabindex="0">
      <span class="name" title="${esc(x.name)}">${esc(x.label)}</span>
      <span class="track"><span class="fill" style="display:block;width:${(100 * x[key] / max).toFixed(1)}%;background:${fam[x.family].color}"></span></span>
      <span class="val">${label(x[key])}</span></div>`).join("");
  }
  bars("bars-hub", "hub", 12, (v) => v.toFixed(0));
  bars("bars-mentions", "mentions");
  bars("bars-units", "units");
  bars("bars-bridge", "bridge", 12, (v) => v.toFixed(0));
  document.querySelectorAll(".bars").forEach((b) => b.addEventListener("click", (e) => {
    const r = e.target.closest(".bar-row"); if (r) select(r.dataset.id, { scroll: true });
  }));

  // ------------------------------------------------------------------ heatmap
  function heat() {
    const sort = $("heat-sort").value, n = +$("heat-n").value, apps = true; // applications always included
    let rows = D.nodes.filter((x) => apps || x.family !== "app");
    // "top N" is by hub score (applications by reach), then ordered as requested
    // Applications have no hub score; rank them by mentions on the same 0–100 scale
    const maxM = Math.max(...concepts.map((x) => x.mentions));
    const score = (x) => x.hub ?? (100 * x.mentions) / maxM;
    rows = rows.slice().sort((a, b) => score(b) - score(a)).slice(0, n);
    const cmp = {
      intro: (a, b) => (a.intro ?? 9) - (b.intro ?? 9) || b.mentions - a.mentions,
      hub: (a, b) => (b.hub ?? -1) - (a.hub ?? -1),
      mentions: (a, b) => b.mentions - a.mentions,
      family: (a, b) => famOrder.indexOf(a.family) - famOrder.indexOf(b.family) || b.mentions - a.mentions,
    }[sort];
    rows.sort(cmp);
    const head = `<thead><tr><th></th>${D.chapters.map((c) => `<th class="ch" title="${esc(c.title)}"><span style="color:${chColor(c.n)}">Ch. ${c.n}</span><br><span class="ch-t">${esc(c.title)}</span></th>`).join("")}<th>Total</th></tr></thead>`;
    const body = rows.map((x) => {
      const tot = x.byChapter.reduce((s, v) => s + v, 0) || 1;
      const color = fam[x.family].color;
      return `<tr><td class="name" data-id="${x.id}"><span class="dot" style="background:${color};width:.6rem;height:.6rem"></span> <span title="${esc(x.name)}">${esc(x.label)}</span></td>` +
        x.byChapter.map((v, i) => {
          const s = v / tot;
          const bg = v ? `background:color-mix(in srgb, var(--red) ${(8 + 82 * Math.sqrt(s)).toFixed(0)}%, var(--bg-soft))` : "background:var(--bg-soft)";
          const fg = s > 0.3 ? "color:#fff" : "";
          return `<td class="cell" style="${bg};${fg}" title="${esc(x.name)} · Ch. ${i + 1}: ${v} mentions (${(100 * s).toFixed(0)}%)">${v || ""}</td>`;
        }).join("") + `<td class="tot">${fmt(x.mentions)}</td></tr>`;
    }).join("");
    $("heat").innerHTML = head + `<tbody>${body}</tbody>`;
  }
  ["heat-sort", "heat-n"].forEach((id) => $(id).addEventListener("change", heat));
  $("heat").addEventListener("click", (e) => { const c = e.target.closest("td.name"); if (c) select(c.dataset.id, { scroll: true }); });


  // ------------------------------------------------------------------ start
  draw();
  heat();
  const q = new URLSearchParams(location.search).get("topic");
  renderFlow();
  const qc = +new URLSearchParams(location.search).get("chapter");
  if (qc >= 1 && qc <= NCH) setChapter(qc);
  if (q && byId.has(q)) select(q);
})();
