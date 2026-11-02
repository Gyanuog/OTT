/* Local Tube — Android app UI logic. Separate from the web UI (index.html).
   Privacy: nothing about what is watched or searched is ever stored. */
"use strict";
const $ = id => document.getElementById(id);
const qsa = (s, el = document) => el.querySelectorAll(s);

// ---------- native bridge (MainActivity → LTNative) ----------
const native = (fn, ...args) => { try { const n = window.LTNative; if (n && n[fn]) return n[fn](...args); } catch {} };
const haptic = () => native("haptic");

// ---------- prefs (settings only — no history) ----------
const store = {
  get(k, d) { try { const x = localStorage.getItem("lta:" + k); return x === null ? d : JSON.parse(x); } catch { return d; } },
  set(k, x) { try { localStorage.setItem("lta:" + k, JSON.stringify(x)); } catch {} },
};
const BEST = 99999, DEFAULT_H = 1080;
const prefs = Object.assign({ codec: "vp9", maxH: DEFAULT_H, mxMaxH: DEFAULT_H, sonyMaxH: DEFAULT_H, audioOnly: false, sb: true, speed: 1, src: "yt", theme: "dark", ytCat: 0 }, store.get("prefs", {}));
const savePrefs = () => store.set("prefs", prefs);

// ---------- helpers ----------
const fmtDur = s => { if (!s && s !== 0) return ""; s = Math.max(0, Math.round(s)); const h = s / 3600 | 0, m = (s % 3600) / 60 | 0, x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const fmtNum = n => n == null ? "" : n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
const fmtDate = d => { const m = String(d || "").match(/^(\d{4})-?(\d\d)-?(\d\d)/); if (!m) return ""; return new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (n, c = "sm") => `<svg class="i ${c}"><use href="#i-${n}"/></svg>`;
const ytThumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HUES = [345, 15, 200, 160, 265, 35, 290, 120];
const avatar = name => { const s = String(name || "?"); let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return `<span class="ava" style="background:hsl(${HUES[Math.abs(h) % HUES.length]} 65% 45%)">${esc(s.trim()[0] || "?").toUpperCase()}</span>`; };
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2000); }
async function api(path, signal) {
  const r = await fetch(path, { signal });
  const j = await r.json().catch(() => ({ error: "HTTP " + r.status }));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
// Fade images in once decoded.
document.addEventListener("load", e => { if (e.target.tagName === "IMG") e.target.classList.add("ok"); }, true);
const img = src => src ? `<img loading="lazy" decoding="async" src="${esc(src)}" alt="">` : "";

// ---------- theme ----------
function applyTheme() {
  const dark = prefs.theme === "dark" || (prefs.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  syncBars();
}
function syncBars() {
  const dark = document.documentElement.dataset.theme !== "light";
  const watching = !$("watch").hidden && !watchEl.classList.contains("mini");
  native("setSystemBars", watching ? "#000000" : dark ? "#0a0a0c" : "#f6f6f9", !watching && !dark);
}

// ---------- cards ----------
const ytItem = x => ({ href: "#/watch/" + x.id, key: x.id, ytId: x.id, img: ytThumb(x.id), title: x.title, channel: x.channel,
  sub: [x.channel, x.views != null && fmtNum(x.views) + " views"].filter(Boolean).join(" · "), dur: x.live ? "LIVE" : fmtDur(x.duration) });
const MX_LABEL = { tvshow: "Show", movie: "Movie", episode: "Episode", shorts: "Clip", season: "Season" };
const mxHref = (type, id) => type === "tvshow" ? "#/mx/show/" + id : type === "season" ? "#/mx/season/" + id : `#/mx/watch/${type}/${id}`;
function mxItem(x) {
  const sub = x.type === "episode" ? [x.show, x.seq && "E" + x.seq, fmtDate(x.date)] : [MX_LABEL[x.type], fmtDate(x.date)];
  return { href: mxHref(x.type, x.id), key: x.id, img: x.img, poster: x.poster, title: x.title, sub: sub.filter(Boolean).join(" · "),
    dur: fmtDur(x.duration), tag: x.type === "tvshow" ? "Show" : "", kind: MX_LABEL[x.type], locked: x.playable === false };
}
const badges = c => (c.locked ? `<span class="badge tag">${icon("lock", "xs")}</span>` : c.tag ? `<span class="badge tag">${esc(c.tag)}</span>` : "")
  + (c.dur ? `<span class="badge${c.dur === "LIVE" ? " live" : ""}">${c.dur}</span>` : "");
const vcard = c => `<a class="vcard${c.locked ? " locked" : ""}" href="${c.href}"${c.ytId ? ` data-id="${c.ytId}"` : ""}>
  <div class="thumb">${img(c.img)}${badges(c)}</div>
  <div class="info">${c.channel !== undefined ? avatar(c.channel) : ""}<div style="min-width:0"><div class="t">${esc(c.title)}</div><div class="s">${esc(c.sub || "")}</div></div></div></a>`;
const pcard = c => `<a class="pcard${c.locked ? " locked" : ""}" href="${c.href}">
  <div class="thumb">${img(c.poster || c.img)}${c.locked ? `<span class="badge tag">${icon("lock", "xs")}</span>` : ""}</div>
  <div class="t">${esc(c.title)}</div><div class="s">${esc(c.kind || "")}</div></a>`;
const miniItem = (c, cur) => `<a class="mini-i${cur ? " cur" : ""}${c.locked ? " locked" : ""}" href="${c.href}"${c.ytId ? ` data-id="${c.ytId}"` : ""}>
  <div class="thumb">${img(c.img)}${c.dur ? `<span class="badge">${c.dur}</span>` : ""}</div>
  <div style="min-width:0"><div class="t">${esc(c.title)}</div><div class="s">${esc(c.sub || "")}</div></div></a>`;
const sec = (title, body, extra = "") => `<section class="sec"><div class="sec-h"><h2>${title}</h2>${extra}</div>${body}</section>`;
const hrow = (title, items, fn) => sec(esc(title), `<div class="hrow">${items.map(fn).join("")}</div>`);
const skVideos = n => `<div class="vlist">${Array.from({ length: n }, () => `<div><div class="sk" style="aspect-ratio:16/9;border-radius:16px"></div><div class="sk sk-line" style="width:85%"></div><div class="sk sk-line" style="width:50%"></div></div>`).join("")}</div>`;
const skPosters = n => `<div class="sec"><div class="hrow">${Array.from({ length: n }, () => `<div class="pcard"><div class="sk" style="aspect-ratio:2/3;border-radius:14px"></div></div>`).join("")}</div></div>`;
const skHero = () => `<div class="hero-car"><div class="slide sk"></div></div><div class="dots"></div>`;
const errBox = msg => `<div class="empty"><div class="big">${icon("info", "")}</div><h3>Load nahi hua</h3><div class="err">${esc(msg)}</div><div style="margin-top:16px"><button class="btn accent press" data-retry>${icon("refresh")} Retry</button></div></div>`;
const noResults = `<div class="empty"><div class="big">${icon("search", "")}</div><h3>Kuch nahi mila</h3><div>Doosre shabd try karo.</div></div>`;

// ---------- hero carousel (native swipe + autoplay + dots) ----------
function hero(items, signal) {
  if (!items.length) return "";
  setTimeout(() => {
    const car = $("heroCar"), dots = $("heroDots"); if (!car) return;
    let at = 0, touching = false;
    const set = i => { at = i; dots.querySelectorAll("i").forEach((d, k) => d.classList.toggle("on", k === i)); };
    car.addEventListener("scroll", () => { const i = Math.round(car.scrollLeft / car.firstElementChild.offsetWidth); if (i !== at) set(i); }, { passive: true });
    car.addEventListener("touchstart", () => { touching = true; }, { passive: true });
    car.addEventListener("touchend", () => { setTimeout(() => { touching = false; }, 4000); }, { passive: true });
    const t = setInterval(() => {
      if (touching || document.hidden || !car.isConnected || !watchEl.hidden && !watchEl.classList.contains("mini")) return;
      const n = (at + 1) % items.length; car.scrollTo({ left: n * (car.firstElementChild.offsetWidth + 10), behavior: "smooth" });
    }, 6000);
    signal.addEventListener("abort", () => clearInterval(t));
  });
  return `<div class="hero-car" id="heroCar">${items.map((x, i) => `
    <a class="slide" href="${x.href}"${x.ytId ? ` data-id="${x.ytId}"` : ""}>
      <img class="bg" src="${esc(x.bg)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>
      <div class="slide-in">
        <div class="eyebrow">${esc(x.eyebrow)}</div>
        ${x.logo ? `<img class="lg" src="${esc(x.logo)}" alt="${esc(x.title)}">` : `<h3>${esc(x.title)}</h3>`}
        <p>${esc(x.desc || "")}</p>
        <div class="btns"><span class="btn primary">${icon("play", "sm fill")} Dekho</span></div>
      </div></a>`).join("")}</div>
    <div class="dots" id="heroDots">${items.map((_, i) => `<i${i ? "" : ' class="on"'}></i>`).join("")}</div>`;
}

// ---------- app bar ----------
const SRC_NAME = { yt: "YouTube", mx: "MX Player", sony: "Sony LIV", settings: "Settings" };
function setBar(opts) {
  const b = $("bar");
  b.classList.toggle("sub", !!opts.back);
  b.innerHTML = (opts.back
    ? `<button class="ib" data-act="back" aria-label="Back">${icon("back", "")}</button><div class="bar-title">${esc(opts.title || "")}</div>`
    : `<div class="brand"><span class="logo">${icon("play", "fill")}</span>Local Tube<small>· ${esc(opts.title || "")}</small></div><span class="sp"></span>`)
    + (opts.search !== false ? `<button class="ib" data-act="audio" aria-label="Audio only">${icon("headphones", "")}</button><button class="ib" data-act="search" aria-label="Search">${icon("search", "")}</button>` : "");
  syncAudioBtns();
}
$("bar").addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return; haptic();
  if (b.dataset.act === "back") history.back();
  else if (b.dataset.act === "search") openSearch();
  else if (b.dataset.act === "audio") toggleAudioOnly();
});
// Hide the bar while scrolling down, bring it back on scroll up.
let lastY = 0;
window.addEventListener("scroll", () => {
  const y = scrollY, hide = y > 120 && y > lastY + 4, show = y < lastY - 4 || y < 60;
  if (hide) { $("bar").classList.add("hide"); document.body.classList.add("bar-hidden"); }
  else if (show) { $("bar").classList.remove("hide"); document.body.classList.remove("bar-hidden"); }
  lastY = y;
}, { passive: true });

// ---------- tabs ----------
const TABS = ["yt", "mx", "sony", "settings"];
function setTab(t) { for (const b of qsa(".tab")) b.classList.toggle("on", b.dataset.tab === t); }
$("tabs").addEventListener("click", e => {
  const b = e.target.closest(".tab"); if (!b) return; haptic();
  const t = b.dataset.tab;
  if (listHash === "/" + t || (t === prefs.src && listHash === "/")) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  location.replace("#/" + t); // tabs never stack up history
});

// ---------- list pages ----------
const view = $("view");
let listAbort, listHash = null, lastYtResults = [];
const cache = { ytHome: null, ytCat: {}, mxHome: null, sonyHome: null };
function page(html) { view.innerHTML = html; view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter"); }
function newSignal() { listAbort?.abort(); listAbort = new AbortController(); return listAbort.signal; }

const YT_CATS = [["Trending", ""], ["Music", "new hindi songs trending"], ["Trailers", "latest movie trailers hindi"], ["Comedy", "trending comedy videos india"],
  ["Cricket", "cricket highlights india match"], ["News", "top news headlines hindi today"], ["Bhojpuri", "new bhojpuri song trending"], ["Tech", "latest tech unboxing hindi"], ["Gaming", "trending gaming videos india"]];

function showYtHome() {
  setBar({ title: "YouTube" }); setTab("yt"); prefs.src = "yt"; savePrefs();
  const signal = newSignal();
  page(`<div class="chips" id="cats">${YT_CATS.map(([n], i) => `<button class="chip" data-i="${i}">${i ? "" : icon("trend")}${n}</button>`).join("")}</div><div id="ytBody"></div>`);
  $("cats").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b) return; haptic(); b.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" }); loadYtCat(+b.dataset.i, signal); });
  loadYtCat(prefs.ytCat || 0, signal);
}
async function loadYtCat(i, signal) {
  prefs.ytCat = i; savePrefs();
  for (const b of $("cats").children) b.classList.toggle("on", +b.dataset.i === i);
  const body = $("ytBody");
  if (i === 0) {
    if (!cache.ytHome) body.innerHTML = skHero() + skVideos(3);
    try {
      const j = cache.ytHome ??= await api("/api/yt/home", signal);
      if (prefs.ytCat !== 0 || signal.aborted) return;
      lastYtResults = (j.rows || []).flatMap(r => r.items || []);
      body.innerHTML = hero((j.hero || []).map(x => ({ href: "#/watch/" + x.id, ytId: x.id, bg: x.banner || x.img || `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`, title: x.title,
        eyebrow: "Trending · YouTube India", desc: [x.channel, x.views && fmtNum(x.views) + " views"].filter(Boolean).join(" · ") })), signal)
        + (j.rows || []).map(r => hrow(r.title, r.items || [], x => vcard(ytItem(x)))).join("");
      body.classList.add("enter");
    } catch (e) { if (e.name !== "AbortError") body.innerHTML = errBox(e.message); }
    return;
  }
  const q = YT_CATS[i][1];
  if (!cache.ytCat[q]) body.innerHTML = skVideos(4);
  try {
    const res = cache.ytCat[q] ??= (await api("/api/search?q=" + encodeURIComponent(q), signal)).results;
    if (prefs.ytCat !== i || signal.aborted) return;
    lastYtResults = res;
    body.innerHTML = res.length ? `<div class="vlist enter">${res.map(x => vcard(ytItem(x))).join("")}</div>` : noResults;
  } catch (e) { if (e.name !== "AbortError") body.innerHTML = errBox(e.message); }
}

const MX_HOME_PAGES = 6;
async function showMxHome() {
  setBar({ title: "MX Player" }); setTab("mx"); prefs.src = "mx"; savePrefs();
  const signal = newSignal();
  if (!cache.mxHome) {
    page(skHero() + skPosters(4) + skPosters(4));
    try { const j = await api("/api/mx/home", signal); cache.mxHome = { rows: j.rows, next: j.next, pages: 1, done: !j.next }; }
    catch (e) { if (e.name !== "AbortError") page(errBox(e.message)); return; }
  }
  const h = cache.mxHome, top = h.rows[0];
  const heroItems = (top?.items || []).filter(x => x.banner).slice(0, 6).map(x => ({ href: mxHref(x.type, x.id), bg: x.banner, logo: x.logo, title: x.title, desc: x.desc, eyebrow: (top.title || "MX") + " · " + (MX_LABEL[x.type] || "") }));
  page(hero(heroItems, signal) + `<div id="mxRows">${h.rows.slice(1).map(mxRow).join("")}</div><div id="more" style="height:1px"></div>`);
  let loading = false;
  const io = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting) || loading) return;
    if (h.done || h.pages >= MX_HOME_PAGES) { io.disconnect(); return; }
    loading = true;
    try {
      const j = await api("/api/mx/home?next=" + encodeURIComponent(h.next), signal);
      h.rows.push(...j.rows); h.next = j.next; h.pages++; h.done = !j.next;
      $("mxRows")?.insertAdjacentHTML("beforeend", j.rows.map(mxRow).join(""));
    } catch { io.disconnect(); }
    loading = false;
  }, { rootMargin: "800px" });
  io.observe($("more")); signal.addEventListener("abort", () => io.disconnect());
}
const mxRow = r => hrow(r.title, r.items, x => pcard(mxItem(x)));

async function showSonyHome() {
  setBar({ title: "Sony LIV" }); setTab("sony"); prefs.src = "sony"; savePrefs();
  const signal = newSignal();
  if (!cache.sonyHome) page(skHero() + skPosters(4) + skPosters(4));
  try {
    const j = cache.sonyHome ??= await api("/api/sony/home", signal);
    if (signal.aborted) return;
    page(hero((j.hero || []).map(x => ({ href: "#/sony/show/" + x.id, bg: x.banner || x.img, title: x.title, desc: x.desc, eyebrow: "Sony LIV · " + (x.category || "Featured") })), signal)
      + (j.rows || []).map(r => hrow(r.title, r.items, x => pcard({ href: "#/sony/show/" + x.id, img: x.img, poster: x.poster || x.img, title: x.title, kind: x.category || "Show" }))).join(""));
  } catch (e) { if (e.name !== "AbortError") page(errBox(e.message)); }
}

async function loadInto(path, render, sk) {
  const signal = newSignal();
  page(sk);
  try { const j = await api(path, signal); if (!signal.aborted) render(j, signal); }
  catch (e) { if (e.name !== "AbortError") page(errBox(e.message)); }
}

function showSearchResults(src, q) {
  setBar({ back: true, title: q }); setTab(src);
  if (src === "mx") return loadInto("/api/mx/search?q=" + encodeURIComponent(q), j => {
    if (j.direct) return location.replace(mxHref(j.direct.type, j.direct.id));
    if (!j.results.length) return page(noResults);
    const groups = [["tvshow", "Shows"], ["movie", "Movies"], ["episode", "Episodes"], ["shorts", "Clips"], ["season", "Seasons"]];
    page(groups.map(([t, label]) => { const it = j.results.filter(x => x.type === t); if (!it.length) return "";
      return t === "tvshow" || t === "movie" ? sec(label, `<div class="pgrid">${it.map(x => pcard(mxItem(x))).join("")}</div>`)
        : sec(label, `<div class="vlist">${it.map(x => vcard(mxItem(x))).join("")}</div>`); }).join(""));
  }, skVideos(3));
  if (src === "sony") return loadInto("/api/sony/search?q=" + encodeURIComponent(q), j => {
    if (j.direct) return location.replace(j.direct.type === "tvshow" ? "#/sony/show/" + j.direct.id : "#/sony/watch/" + j.direct.id);
    if (!j.results?.length) return page(noResults);
    page(sec(`Results`, `<div class="vlist">${j.results.map(x => vcard({ href: (x.type === "tvshow" || !x.type) ? "#/sony/show/" + x.id : "#/sony/watch/" + x.id,
      img: x.img || x.poster, title: x.title, sub: x.desc ? x.desc.slice(0, 80) + "…" : "", tag: x.type === "tvshow" || !x.type ? "Show" : "Video" })).join("")}</div>`, `<span class="m">${j.results.length}</span>`));
  }, skVideos(3));
  return loadInto("/api/search?q=" + encodeURIComponent(q), j => {
    if (j.direct) return location.replace("#/watch/" + j.direct);
    lastYtResults = j.results;
    page(j.results.length ? sec("Results", `<div class="vlist">${j.results.map(x => vcard(ytItem(x))).join("")}</div>`, `<span class="m">${j.results.length} videos</span>`) : noResults);
  }, skVideos(3));
}

// Show page (MX / Sony): backdrop hero, season chips, episode list.
let mxQueue = { seasonId: null, eps: [] };
async function seasonEpisodes(seasonId, signal) {
  if (mxQueue.seasonId === seasonId) return mxQueue.eps;
  const j = await api("/api/mx/season?id=" + seasonId, signal);
  mxQueue = { seasonId, eps: j.episodes };
  return j.episodes;
}
const epRow = (href, e, locked) => `<a class="ep${locked ? " locked" : ""}" href="${href}">
  <div class="thumb">${img(e.img)}${locked ? `<span class="badge tag">${icon("lock", "xs")}</span>` : ""}${e.duration ? `<span class="badge">${fmtDur(e.duration)}</span>` : ""}</div>
  <div style="min-width:0"><div class="no">EPISODE ${e.seq ?? ""}</div><div class="t">${esc(e.title)}</div><div class="s">${[fmtDur(e.duration), fmtDate(e.date)].filter(Boolean).join(" · ")}</div></div></a>`;
function showPage(src, id, seasonId) {
  setBar({ back: true, title: "" }); setTab(src);
  const isMx = src === "mx";
  loadInto(`/api/${src}/show?id=${id}`, (show, signal) => {
    const bg = isMx ? show.img : show.bg || show.poster;
    page(`<div class="show-hero">${bg ? `<div class="bd" style="background-image:url('${esc(bg)}')"></div>` : ""}
        <div class="eyebrow">${isMx ? "MX Player" : "Sony LIV"} · Show</div><h1>${esc(show.title)}</h1>
        <p id="showDesc">${esc(show.description || "")}</p><div class="btns" id="heroBtns"></div></div>
      <div class="chips" id="seasons">${show.seasons.map(s => `<button class="chip" data-id="${s.id}">${esc(s.title)}</button>`).join("")}</div>
      <div class="eps" id="eps"></div>`);
    $("showDesc").addEventListener("click", e => e.currentTarget.classList.toggle("open"));
    const barTitle = $("bar").querySelector(".bar-title");
    const onScroll = () => { if (barTitle) barTitle.textContent = scrollY > 200 ? show.title : ""; };
    window.addEventListener("scroll", onScroll, { passive: true }); signal.addEventListener("abort", () => window.removeEventListener("scroll", onScroll));
    const pick = sid => {
      for (const b of $("seasons").children) b.classList.toggle("on", b.dataset.id === sid);
      $("eps").innerHTML = skVideos(2);
      const load = isMx ? seasonEpisodes(sid, signal) : api("/api/sony/season?id=" + sid, signal).then(j => j.episodes || []);
      load.then(eps => {
        const href = e => isMx ? "#/mx/watch/episode/" + e.id : "#/sony/watch/" + e.id;
        const list = isMx ? [...eps].reverse() : eps;
        $("eps").innerHTML = eps.length ? list.map(e => epRow(href(e), e, e.playable === false)).join("") : `<div class="empty">Koi episode nahi.</div>`;
        const ok = eps.filter(e => e.playable !== false), latest = ok[ok.length - 1], first = ok[0];
        $("heroBtns").innerHTML = (latest ? `<a class="btn accent press" href="${href(latest)}">${icon("play", "sm fill")} Latest · E${latest.seq}</a>` : "")
          + (first && first !== latest ? `<a class="btn press" href="${href(first)}">E${first.seq} se shuru</a>` : "");
      }, e => { if (e.name !== "AbortError") $("eps").innerHTML = errBox(e.message); });
      history.replaceState(null, "", `#/${src}/show/${id}/${sid}`); listHash = `/${src}/show/${id}/${sid}`;
    };
    $("seasons").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { haptic(); pick(b.dataset.id); } });
    if (show.seasons.length) pick(show.seasons.some(s => s.id === seasonId) ? seasonId : isMx ? show.seasons[0].id : show.seasons[show.seasons.length - 1].id);
    else $("eps").innerHTML = `<div class="empty">Koi season nahi mila.</div>`;
  }, `<div class="show-hero"><div class="sk" style="position:absolute;inset:0;border-radius:0"></div></div>` + skVideos(2));
}
function showMxSeason(id) {
  setBar({ back: true, title: "Episodes" }); setTab("mx");
  const signal = newSignal(); page(skVideos(3));
  seasonEpisodes(id, signal).then(eps => page(`<div class="eps" style="padding-top:8px">${[...eps].reverse().map(e => epRow("#/mx/watch/episode/" + e.id, e, e.playable === false)).join("")}</div>`),
    e => { if (e.name !== "AbortError") page(errBox(e.message)); });
}

// ---------- settings ----------
const CODECS = [["vp9", "VP9", "GPU · recommended"], ["h264", "H.264", "Sabse compatible"], ["av1", "AV1", "Kam data, CPU heavy"], ["any", "Any", "Auto"]];
const QUALS = [[BEST, "Best available"], [2160, "2160p (4K)"], [1440, "1440p"], [1080, "1080p"], [720, "720p"], [480, "480p · data saver"], [360, "360p"], [240, "240p"]];
const qName = h => (QUALS.find(q => q[0] === h) || [0, h + "p"])[1];
function showSettings() {
  setBar({ title: "Settings", search: false }); setTab("settings"); newSignal();
  const row = (act, ic, title, sub, right) => `<button class="row-i" data-set="${act}"><span class="ic">${icon(ic)}</span><span class="tx"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${right}</button>`;
  const tog = on => `<span class="tog${on ? " on" : ""}"></span>`;
  page(`<div class="group-t">Appearance</div>
    <div class="group" style="padding:14px 16px"><div class="segc" id="themeSeg">${[["dark", "Dark"], ["light", "Light"], ["auto", "System"]].map(([k, n]) => `<button data-th="${k}" class="${prefs.theme === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="group-t">Playback</div>
    <div class="group">
      ${row("q", "hd", "YouTube quality", "Default resolution", `<span class="val">${qName(prefs.maxH)}</span>`)}
      ${row("mxq", "film", "MX / Sony quality", "Default resolution", `<span class="val">${qName(prefs.mxMaxH)}</span>`)}
      ${row("codec", "chip", "Video codec", "YouTube streams", `<span class="val">${CODECS.find(c => c[0] === prefs.codec)?.[1] || "VP9"}</span>`)}
      ${row("speed", "gauge", "Playback speed", "", `<span class="val">${prefs.speed}x</span>`)}
      ${row("audio", "headphones", "Audio only", "YouTube — sabse kam data", tog(prefs.audioOnly))}
      ${row("sb", "shield", "SponsorBlock", "Sponsor / intro skip", tog(prefs.sb))}
    </div>
    <div class="group-t">Privacy</div>
    <div class="group">${row("cache", "refresh", "Feeds refresh karo", "Home cache clear", "")}
      <div class="row-i"><span class="ic">${icon("lock")}</span><span class="tx"><b>Koi history nahi</b><span>Watch / search history kabhi save nahi hoti</span></span></div></div>
    <div class="group-t">About</div>
    <div class="group"><div class="row-i"><span class="ic">${icon("info")}</span><span class="tx"><b>Local Tube for Android</b><span>Ad-free · YouTube · MX Player · Sony LIV</span></span></div></div>`);
  $("themeSeg").addEventListener("click", e => { const b = e.target.closest("[data-th]"); if (!b) return; haptic(); prefs.theme = b.dataset.th; savePrefs(); applyTheme(); showSettings(); });
  for (const b of qsa("[data-set]", view)) b.addEventListener("click", () => {
    haptic();
    const k = b.dataset.set, rerender = () => { savePrefs(); showSettings(); };
    if (k === "q") sheet("YouTube quality", QUALS.map(([h, n]) => ({ v: h, label: n })), prefs.maxH, v => { prefs.maxH = +v; rerender(); });
    else if (k === "mxq") sheet("MX / Sony quality", QUALS.map(([h, n]) => ({ v: h, label: n })), prefs.mxMaxH, v => { prefs.mxMaxH = prefs.sonyMaxH = +v; rerender(); });
    else if (k === "codec") sheet("Video codec", CODECS.map(([v, n, s]) => ({ v, label: n, sub: s })), prefs.codec, v => { prefs.codec = v; rerender(); });
    else if (k === "speed") speedSheet(rerender);
    else if (k === "audio") { toggleAudioOnly(); showSettings(); }
    else if (k === "sb") { prefs.sb = !prefs.sb; rerender(); }
    else if (k === "cache") { cache.ytHome = cache.mxHome = cache.sonyHome = null; cache.ytCat = {}; toast("Feeds refresh ho jayenge"); }
  });
}

// ---------- bottom sheet (drag to dismiss) ----------
let sheetCb = null;
function sheet(title, items, current, onPick) {
  $("sheetT").textContent = title;
  $("sheetO").innerHTML = items.map(it => { const on = String(it.v) === String(current);
    return `<button class="opt${on ? " on" : ""}" data-v="${esc(it.v)}">${it.icon ? `<span class="ic">${icon(it.icon, "")}</span>` : ""}<span class="tx">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>${it.val ? `<span class="val">${esc(it.val)}</span>` : ""}${on ? icon("check") : ""}</button>`; }).join("");
  sheetCb = onPick;
  const s = $("sheet"), sc = $("scrim");
  s.hidden = sc.hidden = false; s.style.transform = "";
  requestAnimationFrame(() => { s.classList.add("show"); sc.classList.add("show"); });
}
function closeSheet() {
  const s = $("sheet"), sc = $("scrim"); if (s.hidden) return false;
  s.classList.remove("show"); sc.classList.remove("show"); s.style.transform = "";
  setTimeout(() => { if (!s.classList.contains("show")) s.hidden = sc.hidden = true; }, 300);
  sheetCb = null; return true;
}
$("scrim").addEventListener("click", closeSheet);
$("sheetO").addEventListener("click", e => { const b = e.target.closest(".opt"); if (!b) return; haptic(); const cb = sheetCb; closeSheet(); cb?.(b.dataset.v); });
{
  let y0 = null, dy = 0; const s = $("sheet");
  $("grab").addEventListener("touchstart", e => { y0 = e.touches[0].clientY; dy = 0; s.style.transition = "none"; }, { passive: true });
  $("grab").addEventListener("touchmove", e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); s.style.transform = `translateY(${dy}px)`; }, { passive: true });
  $("grab").addEventListener("touchend", () => { s.style.transition = ""; if (dy > 90) closeSheet(); else s.style.transform = ""; y0 = null; });
}
function speedSheet(after) {
  sheet("Playback speed", [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(x => ({ v: x, label: x === 1 ? "Normal" : x + "x" })), prefs.speed, val => {
    prefs.speed = +val; savePrefs(); v.playbackRate = a.playbackRate = prefs.speed; renderActs(); toast("Speed " + prefs.speed + "x"); after?.();
  });
}

// ---------- search screen ----------
const SUGG = { yt: ["New Hindi Songs 2026", "Latest Bollywood Trailers", "Cricket Highlights India", "Trending Comedy", "Tech News Hindi", "Lofi Music"],
  mx: ["Aashram", "Ek Badnaam Aashram", "Campus Diaries", "Bhaukaal", "Hindi movies"], sony: ["Shark Tank India", "Scam 1992", "Gullak", "Kaun Banega Crorepati", "Taarak Mehta"] };
let searchSrc = "yt";
function openSearch(q = "") {
  searchSrc = TABS.includes(prefs.src) && prefs.src !== "settings" ? prefs.src : "yt";
  $("search").hidden = false; $("sInput").value = q; $("sClear").hidden = !q;
  renderSearchSrc(); setTimeout(() => $("sInput").focus(), 80);
}
function closeSearch() { if ($("search").hidden) return false; $("search").hidden = true; $("sInput").blur(); return true; }
function renderSearchSrc() {
  for (const b of qsa("#sSrc button")) b.classList.toggle("on", b.dataset.src === searchSrc);
  $("sInput").placeholder = searchSrc === "mx" ? "Shows, movies ya MX link…" : searchSrc === "sony" ? "Shows ya Sony LIV link…" : "Search ya YouTube link…";
  $("sBody").innerHTML = `<div class="group-t" style="margin:6px 4px 4px">Popular</div>` + SUGG[searchSrc].map(s => `<button class="s-sug" data-q="${esc(s)}">${icon("trend")}<span>${esc(s)}</span>${icon("ext", "xs")}</button>`).join("");
}
function doSearch(q) {
  q = q.trim(); if (!q) return;
  const src = /mxplayer\.in/.test(q) ? "mx" : /sonyliv\.com/.test(q) ? "sony" : /youtu\.?be/.test(q) ? "yt" : searchSrc;
  closeSearch();
  location.hash = `#/search/${src}/${encodeURIComponent(q)}`;
}
$("sBack").addEventListener("click", closeSearch);
$("sSrc").addEventListener("click", e => { const b = e.target.closest("[data-src]"); if (!b) return; haptic(); searchSrc = b.dataset.src; renderSearchSrc(); $("sInput").focus(); });
$("sForm").addEventListener("submit", e => { e.preventDefault(); doSearch($("sInput").value); });
$("sInput").addEventListener("input", () => { $("sClear").hidden = !$("sInput").value; });
$("sClear").addEventListener("click", () => { $("sInput").value = ""; $("sClear").hidden = true; $("sInput").focus(); });
$("sBody").addEventListener("click", e => { const b = e.target.closest("[data-q]"); if (b) { haptic(); doSearch(b.dataset.q); } });

// ---------- pull to refresh ----------
{
  let y0 = null, d = 0; const ptr = $("ptr");
  window.addEventListener("touchstart", e => { y0 = scrollY <= 0 && (watchEl.hidden || watchEl.classList.contains("mini")) ? e.touches[0].clientY : null; d = 0; }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (y0 == null || !$("search").hidden || !$("sheet").hidden) return;
    if (e.target.closest(".hrow,.hero-car,.chips,.watch")) { y0 = null; return; }
    d = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(1, d / 110);
    ptr.style.opacity = p; ptr.style.transform = `translateY(${Math.min(d, 110) * .7}px) scale(${.6 + p * .4}) rotate(${d * 2}deg)`;
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (y0 == null) return; y0 = null;
    if (d > 110) {
      haptic(); ptr.classList.add("spin");
      cache.ytHome = cache.mxHome = cache.sonyHome = null; cache.ytCat = {};
      listHash = null; route();
      setTimeout(() => { ptr.classList.remove("spin"); ptr.style.opacity = 0; ptr.style.transform = ""; }, 700);
    } else { ptr.style.opacity = 0; ptr.style.transform = ""; }
  }, { passive: true });
}
view.addEventListener("click", e => { if (e.target.closest("[data-retry]")) { listHash = null; route(); } });

// ---------- YouTube prefetch (cards on screen / touched) ----------
const prefetched = new Set(), urgent = new Set();
function prefetch(id, now) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) return;
  if (now ? urgent.has(id) : prefetched.has(id)) return;
  prefetched.add(id); if (now) urgent.add(id);
  fetch(`/api/prefetch?id=${id}${now ? "&now=1" : ""}`).catch(() => {});
}
const seenIO = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { seenIO.unobserve(e.target); prefetch(e.target.dataset.id); } }, { threshold: 0.6 });
new MutationObserver(() => { for (const el of qsa("[data-id]:not([data-pf])")) { el.dataset.pf = "1"; if (el.closest(".vcard,.mini-i,.slide")) seenIO.observe(el); } }).observe(document.body, { childList: true, subtree: true });
document.addEventListener("touchstart", e => { const c = e.target.closest?.(".vcard[data-id],.mini-i[data-id],.slide[data-id]"); if (c) prefetch(c.dataset.id, true); }, { passive: true });

// =====================================================================
// PLAYER — YouTube: separate video + audio kept in sync. MX: HLS. Sony: DASH.
// =====================================================================
const watchEl = $("watch"), stage = $("stage"), vids = [$("v"), $("v2")], a = $("a");
let v = vids[0];
const onV = (type, fn) => { for (const el of vids) el.addEventListener(type, e => { if (e.currentTarget === v) fn(e); }); };
let kind = "yt", hls = null, dashPlayer = null, retried = false, retryTimer = 0, cur = null, curV = null, curA = null, sbSegs = [], audioStall = false, syncTimer = 0, watchAbort, curHash = "";
const audioMode = () => kind === "yt" && prefs.audioOnly;
const split = () => kind === "yt" && !prefs.audioOnly;
const master = () => audioMode() ? a : v;

function playable(el, f) { return el.canPlayType(`${f.mime}; codecs="${f.codecs}"`) !== ""; }
const CODEC_ORDER = { vp9: ["vp9", "h264"], h264: ["h264", "vp9"], av1: ["av1", "vp9", "h264"], any: ["vp9", "av1", "h264"] };
function videoPool(info) {
  const order = CODEC_ORDER[prefs.codec] || CODEC_ORDER.vp9;
  const ok = info.videos.filter(f => playable(v, f)), allowed = ok.filter(f => order.includes(f.codec)), pool = allowed.length ? allowed : ok;
  const rank = f => (order.indexOf(f.codec) + 1) || 99;
  return pool.sort((x, y) => y.height - x.height || rank(x) - rank(y) || y.fps - x.fps || y.tbr - x.tbr);
}
const pickVideo = info => { const p = videoPool(info); return p.find(f => f.height <= prefs.maxH) || p[p.length - 1] || null; };
const pickAudio = info => info.audios.find(f => playable(a, f)) || null;
let qLabel = "";
const setQLabel = t => { qLabel = t; renderActs(); };
function setSrc(el, url, t) { el.src = url; if (t > 0) el.addEventListener("loadedmetadata", () => { el.currentTime = t; }, { once: true }); }

function stopPlayback() {
  clearInterval(syncTimer); unfreeze(); switchSeq++;
  if (hls) { hls.destroy(); hls = null; }
  if (dashPlayer) { dashPlayer.reset(); dashPlayer = null; }
  for (const el of [...vids, a]) { el.pause(); el.removeAttribute("src"); el.load(); }
  native("keepScreenOn", false);
}

// ----- watch layer state: open (full) / mini / closed -----
function openWatchLayer() {
  if (!watchEl.hidden && !watchEl.classList.contains("mini")) return;
  watchEl.hidden = false; watchEl.classList.remove("mini");
  document.body.classList.add("lock", "watching"); document.body.classList.remove("has-mini");
  requestAnimationFrame(() => watchEl.classList.add("open"));
  syncBars(); showCtl();
}
function setMini() {
  if (watchEl.hidden) return;
  if (document.fullscreenElement) exitFs();
  watchEl.classList.add("mini"); watchEl.classList.remove("open");
  document.body.classList.remove("lock", "watching"); document.body.classList.add("has-mini");
  $("wscroll").scrollTop = 0; syncBars();
}
function closeWatch() {
  stopPlayback(); cur = null; curHash = ""; watchAbort?.abort();
  watchEl.classList.remove("open", "mini");
  document.body.classList.remove("lock", "watching", "has-mini");
  setTimeout(() => { if (!watchEl.classList.contains("open")) watchEl.hidden = true; syncBars(); }, 340);
  native("setOrientation", "portrait");
}
const minimize = () => { haptic(); history.back(); }; // route() turns a list hash + open player into the mini player

function beginWatch(k, extHref, poster) {
  openWatchLayer(); $("wscroll").scrollTo({ top: 0 });
  watchAbort?.abort(); watchAbort = new AbortController();
  stopPlayback(); cur = null; sbSegs = []; kind = k; retried = false; curExt = extHref; qLabel = "";
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
  stage.classList.add("loading"); stage.classList.toggle("audio-mode", audioMode());
  $("poster").src = poster || "";
  for (const id of ["wtitle", "wmeta", "desc", "cTitle", "mbTitle", "mbSub"]) $(id).textContent = "";
  $("desc").classList.remove("open"); $("chaps").innerHTML = ""; $("epnav").innerHTML = ""; $("sideTitle").textContent = ""; $("side").innerHTML = "";
  updateSeek(); renderActs();
}
let curExt = "";
function setInfo(title, meta, desc) {
  $("wtitle").textContent = $("cTitle").textContent = $("mbTitle").textContent = title;
  $("wmeta").textContent = $("mbSub").textContent = meta; $("desc").textContent = desc || "";
}
const showErr = msg => { stage.classList.remove("loading"); $("wtitle").innerHTML = `<span class="err">${esc(msg)}</span>`; $("mbTitle").textContent = msg; };
let memPos = null;
const resumeAt = id => { const t = memPos?.id === id ? memPos.t : 0; memPos = null; return t; };
function savePos() { if (cur && master().currentTime > 0) memPos = { id: cur.id, t: master().currentTime }; }
function renderSide(title, cards, curKey) {
  $("sideTitle").textContent = cards.length ? title : "";
  $("side").innerHTML = cards.map(c => miniItem(c, c.key === curKey)).join("");
}

// Action pills under the title.
function renderActs() {
  const yt = kind === "yt";
  $("acts").innerHTML = [
    `<button class="act" data-a="quality">${icon("hd")}${esc(audioMode() ? "Audio" : qLabel || "Quality")}</button>`,
    `<button class="act${prefs.speed !== 1 ? " on" : ""}" data-a="speed">${icon("gauge")}${prefs.speed}x</button>`,
    yt && `<button class="act${prefs.audioOnly ? " on" : ""}" data-a="audio">${icon("headphones")}Audio only</button>`,
    yt && `<button class="act${prefs.sb ? " on" : ""}" data-a="sb">${icon("shield")}SponsorBlock</button>`,
    `<button class="act" data-a="share">${icon("share")}Share</button>`,
    curExt && `<button class="act" data-a="open">${icon("ext")}${yt ? "YouTube" : kind === "mx" ? "MX Player" : "Sony LIV"}</button>`,
  ].filter(Boolean).join("");
}
$("acts").addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b) return; haptic();
  const k = b.dataset.a;
  if (k === "quality") qualitySheet();
  else if (k === "speed") speedSheet();
  else if (k === "audio") toggleAudioOnly();
  else if (k === "sb") { prefs.sb = !prefs.sb; savePrefs(); toast("SponsorBlock " + (prefs.sb ? "on" : "off")); if (!prefs.sb) sbSegs = []; else if (cur && kind === "yt") loadSponsorBlock(cur.id); renderActs(); paintSb(); }
  else if (k === "share") shareCur();
  else if (k === "open") openExternal(curExt);
});
function shareCur() {
  if (!curExt) return;
  const title = cur?.title || "";
  if (native("share", title, curExt) !== undefined) return;
  if (navigator.share) navigator.share({ title, url: curExt }).catch(() => {});
  else navigator.clipboard?.writeText(curExt).then(() => toast("Link copied"));
}
function openExternal(url) { if (native("openExternal", url) === undefined) window.open(url, "_blank"); }

function qualitySheet() {
  if (audioMode()) { toast("Audio only mode on hai"); return; }
  let items = [], curVal;
  if (kind === "mx" && hls) {
    const hs = [...new Set(hls.levels.map(l => l.height))].sort((x, y) => y - x);
    items = hs.map(h => ({ v: h, label: h + "p" })); curVal = prefs.mxMaxH;
  } else if (kind === "sony" && dashPlayer) {
    items = [...new Set(sonyLevels().map(l => l.height))].map(h => ({ v: h, label: h + "p" })); curVal = prefs.sonyMaxH;
  } else if (cur && kind === "yt") {
    const seen = new Set();
    for (const f of videoPool(cur)) { const k = f.height + (f.fps > 30 ? "p" + f.fps : "p"); if (!seen.has(f.height)) { seen.add(f.height); items.push({ v: f.height, label: k, sub: f.codec.toUpperCase() }); } }
    curVal = prefs.maxH === BEST ? BEST : curV?.height;
  } else return;
  items.unshift({ v: BEST, label: "Best available", sub: items[0] ? items[0].label : "" });
  if (!items.some(i => String(i.v) === String(curVal))) curVal = BEST;
  sheet("Video quality", items, curVal, val => {
    const h = +val;
    if (kind === "mx") { prefs.mxMaxH = h; savePrefs(); if (hls) hls.nextLevel = mxLevelFor(h); }
    else if (kind === "sony") { prefs.sonyMaxH = h; savePrefs(); setSonyQuality(); }
    else { prefs.maxH = h; savePrefs(); switchVideo(); }
    toast("Quality: " + (h === BEST ? "Best" : h + "p"));
  });
}
function settingsSheet() {
  const items = [
    !audioMode() && { v: "quality", icon: "hd", label: "Quality", val: qLabel || "Auto" },
    { v: "speed", icon: "gauge", label: "Playback speed", val: prefs.speed === 1 ? "Normal" : prefs.speed + "x" },
    kind === "yt" && { v: "codec", icon: "chip", label: "Codec", val: (CODECS.find(c => c[0] === prefs.codec) || CODECS[0])[1] },
    kind === "yt" && { v: "audio", icon: "headphones", label: "Audio only", val: prefs.audioOnly ? "On" : "Off" },
    kind === "yt" && { v: "sb", icon: "shield", label: "SponsorBlock", val: prefs.sb ? "On" : "Off" },
  ].filter(Boolean);
  sheet("Player", items, null, k => {
    if (k === "quality") setTimeout(qualitySheet, 320);
    else if (k === "speed") setTimeout(speedSheet, 320);
    else if (k === "codec") setTimeout(() => sheet("Video codec", CODECS.map(([v, n, s]) => ({ v, label: n, sub: s })), prefs.codec, c => {
      prefs.codec = c; savePrefs(); if (cur && split()) switchVideo();
    }), 320);
    else if (k === "audio") toggleAudioOnly();
    else if (k === "sb") { prefs.sb = !prefs.sb; savePrefs(); renderActs(); if (!prefs.sb) { sbSegs = []; paintSb(); } else if (cur) loadSponsorBlock(cur.id); toast("SponsorBlock " + (prefs.sb ? "on" : "off")); }
  });
}
function toggleAudioOnly() {
  if (cur && kind === "yt") savePos();
  prefs.audioOnly = !prefs.audioOnly; savePrefs(); syncAudioBtns(); renderActs();
  toast(prefs.audioOnly ? "Audio only: on" : "Audio only: off");
  if (cur && kind === "yt") openVideo(cur.id);
}
function syncAudioBtns() { for (const b of qsa('[data-act="audio"], #cAudio')) b.classList.toggle("on", prefs.audioOnly); }

async function openVideo(id, fresh) {
  beginWatch("yt", "https://www.youtube.com/watch?v=" + id, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  renderSide("Up next", lastYtResults.filter(x => x.id !== id).map(ytItem), id);
  if (prefs.sb) loadSponsorBlock(id, watchAbort.signal);
  let info;
  try { info = await api("/api/video?id=" + id + (fresh ? "&fresh=1" : ""), watchAbort.signal); }
  catch (e) { if (e.name !== "AbortError") showErr(e.message); return; }
  cur = info;
  setInfo(info.title, [info.channel, info.views != null && fmtNum(info.views) + " views", fmtDate(info.upload_date)].filter(Boolean).join(" · "), info.description);
  $("chaps").innerHTML = (info.chapters || []).map(c => `<button class="chip" data-t="${c.start}">${fmtDur(c.start)} · ${esc(c.title)}</button>`).join("");
  if (info.live) { stage.classList.remove("loading"); $("wmeta").textContent = "Live streams abhi supported nahi hain"; return; }
  curV = pickVideo(info); curA = pickAudio(info);
  if (!curA || (!audioMode() && !curV)) { stage.classList.remove("loading"); toast("Koi playable format nahi mila"); return; }
  setQLabel(audioMode() ? "Audio" : curV.height + "p");
  const start = resumeAt(id);
  setSrc(a, curA.url, start);
  if (!audioMode()) setSrc(v, curV.url, start);
  applyVolume(); v.playbackRate = a.playbackRate = prefs.speed;
  master().play().catch(() => {});
  if (!audioMode()) syncTimer = setInterval(syncDrift, 500);
}

let hlsLib, dashLib;
const loadScript = (src, global) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = () => res(window[global]); s.onerror = () => rej(new Error(src + " load nahi hua")); document.head.appendChild(s); });
const loadHls = () => hlsLib ??= loadScript("/static/vendor/hls.min.js", "Hls").catch(e => { hlsLib = null; throw e; });
const loadDash = () => dashLib ??= loadScript("/static/vendor/dash.all.min.js", "dashjs").catch(e => { dashLib = null; throw e; });
function mxLevelFor(maxH) {
  if (!hls) return -1; let best = 0;
  hls.levels.forEach((l, i) => { if (l.height <= maxH && l.height >= hls.levels[best].height) best = i; });
  return best;
}
async function openMx(type, id) {
  beginWatch("mx", `https://www.mxplayer.in/detail/${type}/${id}`);
  let info, Hls;
  try { [info, Hls] = await Promise.all([api(`/api/mx/video?type=${type}&id=${id}`, watchAbort.signal), loadHls()]); }
  catch (e) { if (e.name !== "AbortError") showErr(e.message); return; }
  cur = info; $("poster").src = info.img || "";
  setInfo((info.seq && type === "episode" ? `E${info.seq} · ` : "") + info.title, [info.show, info.season, fmtDate(info.date)].filter(Boolean).join(" · "), info.description);
  if (info.season_id) epNav(info, "mx", watchAbort.signal);
  if (!info.hls) { stage.classList.remove("loading"); $("wmeta").innerHTML = `<span class="err">${info.drm ? "Ye title DRM protected hai — supported nahi." : "Open stream nahi mila (locked title)."}</span>`; return; }
  const start = resumeAt(id);
  applyVolume(); v.playbackRate = prefs.speed;
  if (Hls.isSupported()) {
    hls = new Hls({ startPosition: start || -1, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, enableWorker: true });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { hls.currentLevel = mxLevelFor(prefs.mxMaxH); v.play().catch(() => {}); });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => { const h = hls.levels[d.level]?.height; if (h) setQLabel(h + "p"); });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else { stage.classList.remove("loading"); toast("Playback error: " + d.details); }
    });
    hls.loadSource(info.hls); hls.attachMedia(v);
  } else if (v.canPlayType("application/vnd.apple.mpegurl")) { setSrc(v, info.hls, start); v.play().catch(() => {}); }
  else { stage.classList.remove("loading"); toast("HLS supported nahi"); }
}
async function openSony(id) {
  beginWatch("sony", "https://www.sonyliv.com");
  let info, Dash;
  try { [info, Dash] = await Promise.all([api(`/api/sony/video?id=${id}`, watchAbort.signal), loadDash()]); }
  catch (e) { if (e.name !== "AbortError") showErr(e.message); return; }
  cur = info; $("poster").src = info.img || "";
  setInfo((info.seq ? `E${info.seq} · ` : "") + info.title, [info.show, fmtDate(info.date)].filter(Boolean).join(" · "), info.description);
  if (info.season_id) epNav(info, "sony", watchAbort.signal);
  if (!info.manifest) { stage.classList.remove("loading"); $("wmeta").innerHTML = `<span class="err">${info.drm ? "Ye title DRM protected hai — supported nahi." : "Stream nahi mila."}</span>`; return; }
  const start = resumeAt(id);
  applyVolume(); v.playbackRate = prefs.speed;
  const ev = Dash.MediaPlayer.events;
  dashPlayer = Dash.MediaPlayer().create();
  dashPlayer.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false, audio: false } }, buffer: { bufferTimeAtTopQuality: 30, bufferToKeep: 20 } } });
  dashPlayer.on(ev.STREAM_INITIALIZED, () => { setSonyQuality(); v.play().catch(() => {}); });
  dashPlayer.on(ev.QUALITY_CHANGE_RENDERED, e => { if (e.mediaType !== "video") return; const h = dashPlayer?.getBitrateInfoListFor("video")[e.newQuality]?.height; if (h) setQLabel(h + "p"); });
  dashPlayer.on(ev.ERROR, e => { stage.classList.remove("loading"); toast("Playback error: " + (e.error?.message || "Dash error")); });
  dashPlayer.initialize(v, info.manifest, true, start > 0 ? start : NaN);
}
const sonyLevels = () => (dashPlayer?.getBitrateInfoListFor("video") || []).filter(l => l.height).sort((x, y) => y.height - x.height || y.bitrate - x.bitrate);
function setSonyQuality() {
  const lv = sonyLevels(); if (!lv.length) return;
  const pick = lv.find(l => l.height <= prefs.sonyMaxH) || lv[lv.length - 1];
  dashPlayer.setQualityFor("video", pick.qualityIndex, true); setQLabel(pick.height + "p");
}
// Prev / next / all-episodes + the season list under the player.
async function epNav(info, src, signal) {
  let eps;
  try { eps = src === "mx" ? await seasonEpisodes(info.season_id, signal) : ((await api("/api/sony/season?id=" + info.season_id, signal)).episodes || []); } catch { return; }
  if (cur !== info) return;
  const href = e => src === "mx" ? "#/mx/watch/episode/" + e.id : "#/sony/watch/" + e.id;
  const i = eps.findIndex(e => String(e.id) === String(info.id)), prev = eps[i - 1], next = eps[i + 1];
  cur.next = next; cur.prev = prev; cur.nextHref = next && href(next);
  $("epnav").innerHTML = [
    prev && `<a class="act" href="${href(prev)}">${icon("prev")}E${prev.seq}</a>`,
    next && `<a class="act on" href="${href(next)}">Next · E${next.seq}${icon("next")}</a>`,
    info.show_id && `<a class="act" href="#/${src}/show/${info.show_id}/${info.season_id}">${icon("list")}Saare episodes</a>`,
  ].filter(Boolean).join("");
  renderSide([info.show, info.season].filter(Boolean).join(" · ") || "Episodes",
    eps.map(e => ({ href: href(e), key: String(e.id), img: e.img, title: `E${e.seq} · ${e.title}`, sub: [fmtDur(e.duration), fmtDate(e.date)].filter(Boolean).join(" · "), dur: fmtDur(e.duration), locked: e.playable === false })), String(info.id));
  const el = $("side").querySelector(".cur"); if (el) el.scrollIntoView({ block: "nearest" });
}

// ----- A/V sync for YouTube split streams -----
function syncDrift() {
  if (v.paused || v.seeking || a.seeking || !split()) return;
  const d = a.currentTime - v.currentTime, base = v.playbackRate;
  if (Math.abs(d) > 0.3) { a.currentTime = v.currentTime; a.playbackRate = base; }
  else if (Math.abs(d) > 0.04) a.playbackRate = base * (d > 0 ? 0.97 : 1.03);
  else if (a.playbackRate !== base) a.playbackRate = base;
}
const alignAudio = () => { if (Math.abs(a.currentTime - v.currentTime) > 0.3) a.currentTime = v.currentTime; };
onV("play", () => { if (split()) { alignAudio(); a.play().catch(() => {}); } });
onV("pause", () => { if (split() && !audioStall) a.pause(); });
onV("seeking", () => { if (split()) a.currentTime = v.currentTime; });
onV("waiting", () => { if (split()) a.pause(); stage.classList.add("loading"); });
onV("playing", () => { retried = false; unfreeze(); stage.classList.remove("loading"); if (split()) { alignAudio(); a.play().catch(() => {}); } });
onV("ratechange", () => { a.playbackRate = v.playbackRate; });
a.addEventListener("waiting", () => { if (split() && !v.paused) { audioStall = true; v.pause(); stage.classList.add("loading"); } else if (audioMode()) stage.classList.add("loading"); });
const audioReady = () => { if (audioStall) { audioStall = false; v.play().catch(() => {}); } else if (audioMode()) stage.classList.remove("loading"); };
a.addEventListener("playing", () => { retried = false; audioReady(); });
a.addEventListener("canplaythrough", audioReady);
const onEnded = () => {
  a.pause();
  if ((kind === "mx" || kind === "sony") && cur?.nextHref) { toast("Up next: E" + cur.next.seq); location.replace(cur.nextHref); }
  else showCtl(true);
};
onV("ended", () => { if (!audioMode()) onEnded(); });
a.addEventListener("ended", () => { if (audioMode()) onEnded(); });
for (const el of [...vids, a]) el.addEventListener("error", () => {
  if ((el !== v && el !== a) || kind !== "yt" || !el.getAttribute("src") || !cur) return;
  if (el === a && cur.audios?.length > 1) {
    const i = cur.audios.findIndex(x => x.id === curA?.id);
    if (i >= 0 && i + 1 < cur.audios.length) { curA = cur.audios[i + 1]; setSrc(a, curA.url, master().currentTime); a.play().catch(() => {}); return; }
  }
  if (retryTimer) return;
  if (!retried) { retried = true; toast("Stream refresh ho raha hai…"); savePos(); retryTimer = setTimeout(() => { retryTimer = 0; openVideo(cur.id, true); }, 150); }
  else { stage.classList.remove("loading"); toast("Playback error"); }
});
const onTime = () => {
  const el = master();
  for (const s of sbSegs) if (el.currentTime >= s[0] && el.currentTime < s[1] - 0.5) { el.currentTime = s[1]; toast("Sponsor skip kiya"); break; }
  updateSeek();
};
onV("timeupdate", () => { if (!audioMode()) onTime(); });
a.addEventListener("timeupdate", () => { if (audioMode()) onTime(); });
onV("progress", updateSeek); a.addEventListener("progress", () => { if (audioMode()) updateSeek(); });
onV("durationchange", () => { updateSeek(); paintSb(); }); a.addEventListener("durationchange", () => { updateSeek(); paintSb(); });
async function loadSponsorBlock(id, signal) {
  try {
    const cats = encodeURIComponent('["sponsor","selfpromo","interaction","intro","outro"]');
    const r = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${id}&categories=${cats}`, { signal });
    if (r.ok) { sbSegs = (await r.json()).map(s => s.segment); paintSb(); }
  } catch {}
}
function applyVolume() {
  for (const el of [v, a]) { el.volume = 1; el.muted = false; }
  for (const el of vids) if (el !== v) el.muted = true;
}

// ----- seamless quality switch (standby <video> swap) -----
let switchSeq = 0, switchLead = 1.5;
const until = (el, type) => new Promise((res, rej) => {
  const ok = () => { el.removeEventListener("error", bad); res(); };
  const bad = () => { el.removeEventListener(type, ok); rej(el.error); };
  el.addEventListener(type, ok, { once: true }); el.addEventListener("error", bad, { once: true });
});
async function switchVideo() {
  if (!cur || audioMode()) return;
  const f = pickVideo(cur); if (!f || f === curV) return;
  const id = ++switchSeq, stale = () => switchSeq !== id;
  curV = f; setQLabel(f.height + "p");
  if (v.paused && !audioStall || document.fullscreenElement) return reloadVideo(f);
  const nv = vids.find(x => x !== v);
  nv.muted = true; nv.playbackRate = prefs.speed;
  try {
    const loadAt = performance.now();
    nv.src = f.url;
    await until(nv, "loadedmetadata"); if (stale()) return;
    switchLead = Math.min(4, Math.max(switchLead, (performance.now() - loadAt) / 1000 * 1.5));
    for (;;) {
      const began = performance.now();
      nv.currentTime = Math.min(a.currentTime + switchLead * prefs.speed, Math.max(0, nv.duration - 0.3));
      await until(nv, "seeked"); if (stale()) return;
      if (nv.readyState < 3) { await until(nv, "canplay"); if (stale()) return; }
      const took = (performance.now() - began) / 1000 * 1.3;
      if (v.paused && !audioStall) { nv.currentTime = v.currentTime; await until(nv, "seeked"); if (stale()) return; break; }
      const ahead = (nv.currentTime - a.currentTime) / prefs.speed;
      if (ahead >= 0 && ahead < switchLead + 1) {
        switchLead = Math.min(4, Math.max(0.5, (switchLead + took) / 2));
        if (ahead > 0) { await sleep(ahead * 1000); if (stale()) return; }
        await nv.play(); if (stale()) return;
        break;
      }
      if (ahead < 0) switchLead = Math.min(6, Math.max(switchLead * 1.5, took));
    }
  } catch {
    if (stale()) return;
    nv.removeAttribute("src"); nv.load();
    return reloadVideo(f);
  }
  const old = v; v = nv;
  v.classList.remove("standby"); old.classList.add("standby");
  applyVolume(); old.pause(); old.removeAttribute("src"); old.load();
}
function reloadVideo(f) {
  const t = v.currentTime, playing = !v.paused || audioStall;
  freezeFrame(); setSrc(v, f.url, t); if (playing) v.play().catch(() => {});
  const reveal = () => {
    v.removeEventListener("seeked", reveal); v.removeEventListener("loadeddata", reveal); v.removeEventListener("playing", reveal);
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(unfreeze); else unfreeze();
  };
  v.addEventListener(t > 0 ? "seeked" : "loadeddata", reveal, { once: true });
  v.addEventListener("playing", reveal, { once: true });
}
let freezeT;
function freezeFrame() {
  const c = $("freeze"), w = v.videoWidth, h = v.videoHeight; if (!w || !h) return;
  const k = Math.min(1, 1280 / w); c.width = Math.round(w * k); c.height = Math.round(h * k);
  try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); } catch { return; }
  stage.classList.add("switching"); clearTimeout(freezeT); freezeT = setTimeout(unfreeze, 3000);
}
function unfreeze() { clearTimeout(freezeT); stage.classList.remove("switching"); }

// =====================================================================
// CUSTOM TOUCH CONTROLS
// =====================================================================
let ctlT;
function showCtl(stay) {
  stage.classList.add("show-ctl"); clearTimeout(ctlT);
  if (!stay && !master().paused) ctlT = setTimeout(hideCtl, 3200);
}
function hideCtl() { if (seeking) return; stage.classList.remove("show-ctl"); }
function togglePlay() {
  const m = master(); haptic();
  if (m.paused) { if (m.ended) m.currentTime = 0; m.play().catch(() => {}); } else m.pause();
}
function syncPlayIcons() {
  const paused = master().paused;
  $("cPlay").innerHTML = icon(paused ? "play" : "pause", "lg fill");
  $("mbPlay").innerHTML = icon(paused ? "play" : "pause", "fill");
  native("keepScreenOn", !paused);
  if (paused) showCtl(true); else if (stage.classList.contains("show-ctl")) showCtl();
}
for (const el of [...vids, a]) for (const t of ["play", "pause", "ended"]) el.addEventListener(t, () => { if (el === master()) syncPlayIcons(); });

// seek bar
const seekEl = $("seek");
let seeking = false;
const dur = () => { const d = master().duration; return isFinite(d) ? d : 0; };
function updateSeek() {
  const m = master(), d = dur(), t = seeking ? seekT : m.currentTime || 0, p = d ? Math.min(1, t / d) * 100 : 0;
  $("sPos").style.width = $("thin").style.width = p + "%"; $("sKnob").style.left = p + "%";
  let b = 0; try { for (let i = 0; i < m.buffered.length; i++) if (m.buffered.start(i) <= t + 1) b = m.buffered.end(i); } catch {}
  $("sBuf").style.width = (d ? Math.min(1, b / d) * 100 : 0) + "%";
  $("tCur").textContent = fmtDur(t); $("tDur").textContent = fmtDur(d);
}
function paintSb() {
  const d = dur();
  $("sSb").innerHTML = d && kind === "yt" ? sbSegs.map(s => `<div class="sb" style="left:${s[0] / d * 100}%;width:${(s[1] - s[0]) / d * 100}%"></div>`).join("") : "";
}
let seekT = 0;
const seekAt = x => { const r = seekEl.querySelector(".rail").getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur(); };
seekEl.addEventListener("pointerdown", e => {
  if (!dur()) return;
  seeking = true; seekEl.classList.add("drag"); seekEl.setPointerCapture(e.pointerId); clearTimeout(ctlT);
  seekT = seekAt(e.clientX); moveBubble(e.clientX); updateSeek();
});
seekEl.addEventListener("pointermove", e => { if (!seeking) return; seekT = seekAt(e.clientX); moveBubble(e.clientX); updateSeek(); });
const endSeek = () => { if (!seeking) return; seeking = false; seekEl.classList.remove("drag"); $("bubble").classList.remove("show"); master().currentTime = seekT; haptic(); showCtl(); };
seekEl.addEventListener("pointerup", endSeek); seekEl.addEventListener("pointercancel", endSeek);
function moveBubble(x) {
  const b = $("bubble"), r = stage.getBoundingClientRect();
  b.textContent = fmtDur(seekT); b.classList.add("show");
  b.style.left = Math.max(30, Math.min(r.width - 30, x - r.left)) + "px";
}

// tap / double-tap / long-press / swipe on the stage
let tapT = 0, lastTap = 0, lastSide = null, seekAcc = 0, ripT, lpT, longPress = false, tStart = null, swipe = 0;
const rateBefore = { v: 1 };
stage.addEventListener("pointerdown", e => {
  if (watchEl.classList.contains("mini") || e.target.closest("button,.seek")) return;
  tStart = { x: e.clientX, y: e.clientY, t: Date.now() }; swipe = 0;
  clearTimeout(lpT);
  lpT = setTimeout(() => { // hold = 2x speed
    if (!tStart || master().paused) return;
    longPress = true; rateBefore.v = master().playbackRate; v.playbackRate = a.playbackRate = 2; haptic();
    hint(`${icon("ff", "xs")} 2x speed`, true);
  }, 480);
});
stage.addEventListener("pointermove", e => {
  if (!tStart || longPress) return;
  const dx = e.clientX - tStart.x, dy = e.clientY - tStart.y;
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) clearTimeout(lpT);
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
    swipe = dy;
    if (!document.fullscreenElement && dy > 0) { watchEl.classList.add("drag"); watchEl.style.transform = `translateY(${dy * .9}px)`; watchEl.style.borderRadius = Math.min(24, dy / 6) + "px"; }
  }
});
const endPress = e => {
  clearTimeout(lpT);
  if (longPress) { longPress = false; v.playbackRate = a.playbackRate = prefs.speed; hint("", false); tStart = null; return; }
  if (!tStart) return;
  const st = tStart; tStart = null;
  if (watchEl.classList.contains("drag")) { watchEl.classList.remove("drag"); watchEl.style.transform = ""; watchEl.style.borderRadius = ""; }
  if (e.type === "pointercancel") return;
  if (swipe > 80) { if (document.fullscreenElement) exitFs(); else minimize(); return; }
  if (swipe < -80) { if (!document.fullscreenElement) enterFs(); return; }
  if (Math.abs(swipe) > 12 || Date.now() - st.t > 450) return;
  // tap / double tap
  const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  const side = x < .35 ? "l" : x > .65 ? "r" : "c", now = Date.now();
  if (now - lastTap < 300 && side === lastSide && side !== "c" || (seekAcc && side === lastSide && now - lastTap < 700 && side !== "c")) {
    clearTimeout(tapT); lastTap = now; doubleSeek(side); return;
  }
  if (now - lastTap < 300 && side === "c" && lastSide === "c") { clearTimeout(tapT); lastTap = 0; toggleFs(); return; }
  lastTap = now; lastSide = side;
  clearTimeout(tapT);
  tapT = setTimeout(() => { seekAcc = 0; stage.classList.contains("show-ctl") ? hideCtl() : showCtl(); }, 260);
};
stage.addEventListener("pointerup", endPress); stage.addEventListener("pointercancel", endPress);
stage.addEventListener("contextmenu", e => e.preventDefault());
function doubleSeek(side) {
  const m = master(); if (!dur()) return;
  const d = side === "l" ? -10 : 10;
  seekAcc = (Math.sign(seekAcc) === Math.sign(d) ? seekAcc : 0) + d;
  m.currentTime = Math.max(0, Math.min(dur() - .2, m.currentTime + d)); haptic();
  const rip = $(side === "l" ? "ripL" : "ripR"), other = $(side === "l" ? "ripR" : "ripL");
  other.classList.remove("show");
  rip.querySelector("span").textContent = Math.abs(seekAcc) + " sec"; rip.classList.add("show");
  clearTimeout(ripT); ripT = setTimeout(() => { rip.classList.remove("show"); seekAcc = 0; }, 700);
  updateSeek();
}
let hintT;
function hint(html, stay) { const h = $("hint"); h.innerHTML = html; h.classList.toggle("show", !!html); clearTimeout(hintT); if (html && !stay) hintT = setTimeout(() => h.classList.remove("show"), 1200); }

$("cPlay").addEventListener("click", e => { e.stopPropagation(); togglePlay(); });
$("cPrev").addEventListener("click", e => { e.stopPropagation(); master().currentTime = Math.max(0, master().currentTime - 10); haptic(); showCtl(); });
$("cNext").addEventListener("click", e => { e.stopPropagation(); master().currentTime = Math.min(dur(), master().currentTime + 10); haptic(); showCtl(); });
$("cMin").addEventListener("click", e => { e.stopPropagation(); if (document.fullscreenElement) exitFs(); else minimize(); });
$("cSet").addEventListener("click", e => { e.stopPropagation(); haptic(); settingsSheet(); });
$("cAudio").addEventListener("click", e => { e.stopPropagation(); haptic(); toggleAudioOnly(); });
$("cFs").addEventListener("click", e => { e.stopPropagation(); haptic(); toggleFs(); });
$("chaps").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (b) { haptic(); master().currentTime = +b.dataset.t; master().play().catch(() => {}); } });
$("desc").addEventListener("click", e => e.currentTarget.classList.toggle("open"));

// Inside the player, episode / related links replace the current watch entry so Back
// always leads straight back to the list (and "Saare episodes" keeps playing in mini).
$("wbody").addEventListener("click", e => {
  const l = e.target.closest('a[href^="#/"]'); if (!l) return;
  e.preventDefault(); haptic();
  const href = l.getAttribute("href");
  location.replace(href); // a list page opens with the player minimized on top
});

// mini player
$("minibar").addEventListener("click", e => {
  if (e.target.closest("#mbPlay")) { togglePlay(); return; }
  if (e.target.closest("#mbClose")) { haptic(); closeWatch(); return; }
  expand();
});
stage.addEventListener("click", () => { if (watchEl.classList.contains("mini")) expand(); });
function expand() { if (!curHash) return; haptic(); location.hash = "#" + curHash; }

// fullscreen (WebView → onShowCustomView); landscape for landscape videos
function enterFs() {
  const r = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (r) Promise.resolve(r.call(stage)).catch(() => {});
}
function exitFs() { const x = document.exitFullscreen || document.webkitExitFullscreen; if (x && document.fullscreenElement) Promise.resolve(x.call(document)).catch(() => {}); }
const toggleFs = () => document.fullscreenElement ? exitFs() : enterFs();
document.addEventListener("fullscreenchange", () => {
  const fs = !!document.fullscreenElement;
  stage.classList.toggle("fs", fs);
  $("cFs").innerHTML = icon(fs ? "fsx" : "fs", "");
  if (fs) {
    const portrait = !audioMode() && v.videoHeight > v.videoWidth;
    native("setOrientation", portrait ? "portrait" : "landscape");
    if (!window.LTNative) screen.orientation?.lock?.(portrait ? "portrait" : "landscape").catch(() => {});
  } else { native("setOrientation", "portrait"); stage.classList.remove("fill"); }
  showCtl();
});
// Pinch in fullscreen: zoom-to-fill / fit.
{
  let p0 = 0; const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  stage.addEventListener("touchstart", e => { p0 = e.touches.length === 2 ? dist(e.touches) : 0; if (p0) { clearTimeout(lpT); tStart = null; } }, { passive: true });
  stage.addEventListener("touchmove", e => {
    if (e.touches.length !== 2) return; e.preventDefault();
    if (!p0 || !document.fullscreenElement) return;
    const r = dist(e.touches) / p0;
    if (r > 1.15 && !stage.classList.contains("fill")) { stage.classList.add("fill"); hint("Zoom to fill"); p0 = 0; }
    else if (r < .87 && stage.classList.contains("fill")) { stage.classList.remove("fill"); hint("Original"); p0 = 0; }
  }, { passive: false });
}

// Media Session: lock-screen / headset controls.
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => master().play());
  ms.setActionHandler("pause", () => master().pause());
  ms.setActionHandler("seekbackward", () => { master().currentTime -= 10; });
  ms.setActionHandler("seekforward", () => { master().currentTime += 10; });
  ms.setActionHandler("nexttrack", () => { if (cur?.nextHref) location.replace(cur.nextHref); });
  const meta = () => cur && (ms.metadata = new MediaMetadata({ title: cur.title, artist: cur.channel || cur.show || "",
    artwork: [{ src: kind === "yt" ? `https://i.ytimg.com/vi/${cur.id}/hqdefault.jpg` : cur.img || "" }] }));
  onV("loadedmetadata", meta); a.addEventListener("loadedmetadata", () => { if (audioMode()) meta(); });
}

// =====================================================================
// ROUTER
// =====================================================================
const WATCH_RE = [/^\/watch\/([A-Za-z0-9_-]{11})/, /^\/mx\/watch\/(movie|episode|shorts)\/([0-9a-f]{32})/, /^\/sony\/watch\/(\d{10})/];
const isWatchHash = h => WATCH_RE.some(r => r.test(h));
const isRoot = h => h === "/" || TABS.some(t => h === "/" + t);
function route() {
  closeSheet(); closeSearch();
  const h = location.hash.slice(1) || "/";
  let m;
  if (isWatchHash(h)) {
    if (listHash === null) renderList("/" + (prefs.src === "settings" ? "yt" : prefs.src)); // something to come back to
    const same = h === curHash && cur;
    curHash = h;
    if ((m = h.match(WATCH_RE[0]))) { if (!same || kind !== "yt") openVideo(m[1]); else openWatchLayer(); }
    else if ((m = h.match(WATCH_RE[1]))) { if (!same) openMx(m[1], m[2]); else openWatchLayer(); }
    else if ((m = h.match(WATCH_RE[2]))) { if (!same) openSony(m[1]); else openWatchLayer(); }
    return;
  }
  if (!watchEl.hidden && !watchEl.classList.contains("mini")) setMini();
  if (h !== listHash) renderList(h);
}
function renderList(h) {
  listHash = h; let m;
  $("bar").classList.remove("hide"); document.body.classList.remove("bar-hidden");
  window.scrollTo(0, 0);
  if ((m = h.match(/^\/search\/(yt|mx|sony)\/(.+)/))) showSearchResults(m[1], decodeURIComponent(m[2]));
  else if ((m = h.match(/^\/(mx|sony)\/show\/(\w+)(?:\/(\w+))?/))) showPage(m[1], m[2], m[3]);
  else if ((m = h.match(/^\/mx\/season\/([0-9a-f]{32})/))) showMxSeason(m[1]);
  else {
    const t = h === "/" ? (prefs.src === "settings" ? "yt" : prefs.src) : h.slice(1);
    if (t === "mx") showMxHome(); else if (t === "sony") showSonyHome(); else if (t === "settings") showSettings(); else showYtHome();
  }
}

// Android back button / gesture (called from MainActivity).
window.handleAppBack = function () {
  if (closeSheet()) return true;
  if (closeSearch()) return true;
  if (document.fullscreenElement) { exitFs(); return true; }
  const h = location.hash.slice(1) || "/";
  if (!watchEl.hidden && !watchEl.classList.contains("mini")) { minimize(); return true; }
  if (!isRoot(h)) { history.back(); return true; }
  if (!watchEl.hidden) { closeWatch(); return true; }
  if (h !== "/yt" && h !== "/") { location.replace("#/yt"); return true; }
  return false;
};

applyTheme(); syncAudioBtns();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (prefs.theme === "auto") applyTheme(); });
window.addEventListener("hashchange", route);
route();
