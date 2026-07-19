"use strict";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* 封面统一走服务端代理，绕过第三方 CDN 的 Referer 防盗链 */
const coverUrl = (u) => (u ? `/api/cover?u=${encodeURIComponent(u)}` : "");

// ---------------- state ----------------
const state = {
  quarter: null,
  label: "",
  groups: [],
  ratings: {}, // key `${animeId}#${ep}` -> {animeId, episode, score, comment, updatedAt}
  view: "list", // list | stats
  pageMode: "today", // today(主分页: 今日更新) | all(副分页: 本季全部) | rated(已评分)
  todayPage: 1,
  allPage: 0, // 副分页按星期几分页的索引
  pageSize: 12,
  search: "",
  loading: false,
};

// ---------------- helpers ----------------
function scoreColor(score) {
  if (score == null) return "#c2c7cf";
  if (score >= 9) return "#2bb673";
  if (score >= 8) return "#7ac143";
  if (score >= 6.5) return "#f5a623";
  if (score >= 5) return "#fb8c00";
  return "#e8503a";
}
function avgForAnime(animeId) {
  const vals = Object.values(state.ratings).filter((r) => r.animeId === animeId).map((r) => r.score);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function countForAnime(animeId) {
  return Object.values(state.ratings).filter((r) => r.animeId === animeId).length;
}
function ratingsForAnime(animeId) {
  return Object.values(state.ratings)
    .filter((r) => r.animeId === animeId)
    .sort((a, b) => a.episode - b.episode);
}
function episodeList(anime) {
  const known = anime.epCount ? Array.from({ length: anime.epCount }, (_, i) => i + 1) : [];
  const rated = ratingsForAnime(anime.id).map((r) => r.episode);
  const all = new Set([...known, ...rated]);
  return [...all].sort((a, b) => a - b);
}

// ---------------- API ----------------
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function loadSeason(force) {
  if (state.loading) return;
  state.loading = true;
  $("#loading").classList.remove("hidden");
  $("#error").classList.add("hidden");
  try {
    const data = await api(`/api/season?quarter=${state.quarter}${force ? "&force=1" : ""}`);
    state.groups = data.groups || [];
    renderList();
    updateCacheNote(data);
  } catch (e) {
    $("#loading").classList.add("hidden");
    const err = $("#error");
    err.classList.remove("hidden");
    err.innerHTML = `获取失败：${esc(e.message)} <button class="text-btn" onclick="loadSeason(true)">重试</button>`;
  } finally {
    $("#loading").classList.add("hidden");
    state.loading = false;
  }
}
function updateCacheNote(data) {
  const el = document.getElementById("cacheNote");
  if (!el) return;
  const t = data && data.updatedAt ? new Date(data.updatedAt) : null;
  if (!t) { el.textContent = ""; return; }
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${t.getMonth() + 1}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  el.textContent = (data.cached ? "缓存于 " : "更新于 ") + when + " · 点「刷新」获取最新";
}
async function loadRatings() {
  try {
    const data = await api("/api/ratings");
    state.ratings = {};
    for (const r of data.ratings || []) state.ratings[`${r.animeId}#${r.episode}`] = r;
  } catch {}
}
async function saveRating(animeId, episode, score, comment) {
  const res = await api("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ animeId, episode, score, comment: comment || "" }),
  });
  state.ratings[`${animeId}#${episode}`] = res;
  return res;
}
async function deleteRating(animeId, episode) {
  await api(`/api/ratings?animeId=${encodeURIComponent(animeId)}&episode=${episode}`, { method: "DELETE" });
  delete state.ratings[`${animeId}#${episode}`];
}

// ---------------- render: list (分页) ----------------
const WEEKDAY_ORDER = ["周一", "周二", "周三", "周四", "周五", "周六", "周日", "网络放送"];
// 已评分分页的 5 个档位（按平均分划分：9/10=夯，8=顶级，7=人上人，6=NPC）
const RATED_BANDS = [
  { key: "夯", cls: "b-hang", test: (s) => s >= 9 },
  { key: "顶级", cls: "b-top", test: (s) => s >= 8 && s < 9 },
  { key: "人上人", cls: "b-ren", test: (s) => s >= 7 && s < 8 },
  { key: "NPC", cls: "b-npc", test: (s) => s >= 6 && s < 7 },
  { key: "拉完了", cls: "b-done", test: (s) => s < 6 },
];
function flatAll() {
  const out = [];
  for (const g of state.groups)
    for (const a of g.items) out.push(Object.assign({}, a, { airWeekday: g.label }));
  return out;
}
function todayWeekdayLabel() {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date().getDay()];
}
// 按“更新时间”（放送时刻）排序；无时刻的排到最后
function airMinutes(a) {
  if (!a.airTime) return 9999;
  const m = a.airTime.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9999;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function sortByAir(items) {
  return items.slice().sort((a, b) => airMinutes(a) - airMinutes(b));
}
function emptyNote(text) {
  return el("div", "center-state", esc(text));
}

function renderList() {
  if (state.view !== "list") return;
  if (state.pageMode === "today") renderToday();
  else if (state.pageMode === "all") renderAll();
  else renderRated();
}

// 主分页：当天更新的动漫（按所在星期匹配今天），按更新时间排序
function renderToday() {
  const wrap = $("#groups");
  wrap.innerHTML = "";
  const q = state.search.trim().toLowerCase();
  let items = flatAll().filter((a) => a.airWeekday === todayWeekdayLabel());
  if (q) items = items.filter((a) => a.title.toLowerCase().includes(q));
  items = sortByAir(items);

  const total = items.length;
  const pageSize = state.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  state.todayPage = Math.min(Math.max(1, state.todayPage), pages);
  const start = (state.todayPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  if (total === 0) {
    wrap.appendChild(
      emptyNote(q ? "没有匹配的番剧" : `今天（${todayWeekdayLabel()}）当前季度暂未收录更新，去“副分页”看看全部列表吧。`)
    );
  } else {
    const sec = el("section", "group");
    sec.appendChild(el("h2", "group-title", `今日更新 · ${todayWeekdayLabel()}（共 ${total} 部）`));
    const grid = el("div", "grid");
    for (const a of pageItems) grid.appendChild(renderCard(a));
    sec.appendChild(grid);
    wrap.appendChild(sec);
  }
  renderPager(wrap, { mode: "today", pages, current: state.todayPage });
  $("#emptySearch").classList.add("hidden");
}

// 副分页：本季全部动漫，仍按星期几分类，每一“页”为一个星期分组
function renderAll() {
  const wrap = $("#groups");
  wrap.innerHTML = "";
  const q = state.search.trim().toLowerCase();
  const groupsOn = state.groups
    .filter((g) => WEEKDAY_ORDER.includes(g.label))
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.label) - WEEKDAY_ORDER.indexOf(b.label));
  if (!groupsOn.length) {
    wrap.appendChild(emptyNote("本季度暂无番剧数据。"));
    return;
  }
  state.allPage = Math.min(Math.max(0, state.allPage), groupsOn.length - 1);
  const g = groupsOn[state.allPage];
  let items = g.items.filter((a) => !q || a.title.toLowerCase().includes(q));
  items = sortByAir(items);

  if (items.length === 0) {
    wrap.appendChild(emptyNote(q ? "没有匹配的番剧" : `${g.title} 暂无番剧`));
  } else {
    const sec = el("section", "group");
    sec.appendChild(el("h2", "group-title", `${g.title}（共 ${items.length} 部）`));
    const grid = el("div", "grid");
    for (const a of items) grid.appendChild(renderCard(a));
    sec.appendChild(grid);
    wrap.appendChild(sec);
  }
  renderPager(wrap, {
    mode: "all",
    pages: groupsOn.length,
    current: state.allPage,
    labels: groupsOn.map((x) => x.label),
  });
  $("#emptySearch").classList.add("hidden");
}

// 已评分分页：把用户评过分的番按平均分归入 5 个档位，以「看板」形式一屏展示
function renderRatedRow(a) {
  const avg = avgForAnime(a.id);
  const row = el("div", "rated-row");
  row.addEventListener("click", () => openModal(a));
  if (a.cover) {
    const img = el("img", "rated-thumb");
    img.src = coverUrl(a.cover);
    img.loading = "lazy";
    img.onerror = () => {
      if (a.coverYuc && a.coverYuc !== a.cover) {
        img.src = coverUrl(a.coverYuc);
        img.onerror = () => img.replaceWith(Object.assign(el("div", "rated-thumb ph"), { textContent: "—" }));
      } else {
        img.replaceWith(Object.assign(el("div", "rated-thumb ph"), { textContent: "—" }));
      }
    };
    row.appendChild(img);
  } else {
    row.appendChild(el("div", "rated-thumb ph", "—"));
  }
  row.appendChild(el("div", "rated-name", esc(a.title)));
  const avgEl = el("div", "rated-avg", avg != null ? avg.toFixed(1) : "—");
  avgEl.style.color = scoreColor(avg);
  row.appendChild(avgEl);
  return row;
}
function renderRated() {
  const wrap = $("#groups");
  wrap.innerHTML = "";
  const meta = {};
  for (const a of flatAll()) meta[a.id] = a;
  const ids = [...new Set(Object.values(state.ratings).map((r) => r.animeId))];
  const rated = ids.map((id) => ({ id, avg: avgForAnime(id), a: meta[id] })).filter((x) => x.a);
  if (!rated.length) {
    wrap.appendChild(emptyNote("还没有评分记录，去列表里给喜欢的番剧打分吧。"));
    return;
  }
  const board = el("div", "rated-board");
  for (const band of RATED_BANDS) {
    const items = rated
      .filter((x) => band.test(x.avg))
      .sort((x, y) => y.avg - x.avg)
      .map((x) => x.a);
    const col = el("div", "rated-col");
    col.appendChild(el("div", "rated-col-h " + band.cls, `${band.key}（${items.length}）`));
    const body = el("div", "rated-col-body");
    if (!items.length) body.appendChild(el("div", "band-empty", "暂无"));
    else for (const a of items) body.appendChild(renderRatedRow(a));
    col.appendChild(body);
    board.appendChild(col);
  }
  wrap.appendChild(board);
  $("#emptySearch").classList.add("hidden");
}

function renderPager(wrap, opts) {
  const pager = el("div", "pager");
  const prev = el("button", "pg-btn", "‹ 上一页");
  const next = el("button", "pg-btn", "下一页 ›");
  const isFirst = opts.mode === "all" ? opts.current <= 0 : opts.current <= 1;
  const isLast = opts.mode === "all" ? opts.current >= opts.pages - 1 : opts.current >= opts.pages;
  prev.disabled = isFirst;
  next.disabled = isLast;
  prev.addEventListener("click", () => goPage(opts.mode, -1));
  next.addEventListener("click", () => goPage(opts.mode, 1));
  pager.appendChild(prev);

  if (opts.mode === "all" && opts.labels) {
    const chips = el("div", "pg-chips");
    opts.labels.forEach((lbl, i) => {
      const c = el("button", "pg-chip" + (i === opts.current ? " active" : ""), lbl);
      c.addEventListener("click", () => {
        state.allPage = i;
        renderList();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      chips.appendChild(c);
    });
    pager.appendChild(chips);
  } else {
    pager.appendChild(el("div", "pg-info", `第 ${opts.current} / ${opts.pages} 页`));
  }
  pager.appendChild(next);
  wrap.appendChild(pager);
}
function goPage(mode, delta) {
  if (mode === "all") state.allPage = Math.max(0, state.allPage + delta);
  else state.todayPage = Math.max(1, state.todayPage + delta);
  renderList();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCard(a) {
  const card = el("div", "card");
  card.addEventListener("click", () => openModal(a));

  if (a.cover) {
    const img = el("img", "card-cover");
    img.src = coverUrl(a.cover);
    img.loading = "lazy";
    img.onerror = () => {
      if (a.coverYuc && a.coverYuc !== a.cover) {
        img.src = coverUrl(a.coverYuc);
        img.onerror = () => img.replaceWith(Object.assign(el("div", "card-cover ph"), { textContent: "无封面" }));
      } else {
        img.replaceWith(Object.assign(el("div", "card-cover ph"), { textContent: "无封面" }));
      }
    };
    card.appendChild(img);
  } else {
    card.appendChild(el("div", "card-cover ph", "无封面"));
  }

  const avg = avgForAnime(a.id);
  const cnt = countForAnime(a.id);
  if (avg != null) {
    const s = el("div", "card-score", `${avg.toFixed(1)}<small>${cnt}集</small>`);
    s.style.background = `rgba(31,35,41,.82)`;
    s.style.color = scoreColor(avg);
    card.appendChild(s);
  }

  const body = el("div", "card-body");
  body.appendChild(el("div", "card-title", esc(a.title)));

  const meta = el("div", "card-meta");
  if (a.airTime) meta.appendChild(el("span", "badge", `🕒 ${esc(a.airTime)}`));
  if (a.startDate) meta.appendChild(el("span", "badge", `开播 ${esc(a.startDate)}`));
  if (a.epCount) meta.appendChild(el("span", "badge ep", `全${a.epCount}话`));
  else if (a.epCountText) meta.appendChild(el("span", "badge ep", esc(a.epCountText)));
  if (a.bgmScore != null) meta.appendChild(el("span", "badge bgm", `Bangumi ${a.bgmScore}`));
  body.appendChild(meta);

  if (a.regionTags && a.regionTags.length) {
    const tags = el("div", "tags");
    for (const t of a.regionTags) {
      const link = el("a", "tag", esc(t.name));
      link.href = t.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.addEventListener("click", (e) => e.stopPropagation());
      tags.appendChild(link);
    }
    body.appendChild(tags);
  }

  card.appendChild(body);
  return card;
}

// ---------------- modal: episode rating ----------------
let modalAnime = null;
function openModal(a) {
  modalAnime = a;
  const body = $("#modalBody");
  body.innerHTML = "";

  const head = el("div", "modal-head");
  if (a.cover) {
    const img = el("img");
    img.src = coverUrl(a.cover);
    img.onerror = () => {
      if (a.coverYuc && a.coverYuc !== a.cover) {
        img.src = coverUrl(a.coverYuc);
        img.onerror = () => (img.style.visibility = "hidden");
      } else {
        img.style.visibility = "hidden";
      }
    };
    head.appendChild(img);
  }
  const info = el("div", "mh-info");
  info.appendChild(el("h2", null, esc(a.title)));
  const meta = el("div", "mh-meta");
  if (a.airTime) meta.appendChild(el("span", "badge", `🕒 ${esc(a.airTime)}`));
  if (a.startDate) meta.appendChild(el("span", "badge", `开播 ${esc(a.startDate)}`));
  if (a.epCount) meta.appendChild(el("span", "badge ep", `全${a.epCount}话`));
  if (a.bgmScore != null) meta.appendChild(el("span", "badge bgm", `Bangumi ${a.bgmScore}`));
  for (const t of a.regionTags || []) {
    const link = el("a", "tag", esc(t.name));
    link.href = t.url; link.target = "_blank"; link.rel = "noopener";
    meta.appendChild(link);
  }
  info.appendChild(meta);
  head.appendChild(info);
  body.appendChild(head);

  // summary
  const avg = avgForAnime(a.id);
  const cnt = countForAnime(a.id);
  const summ = el("div", "modal-summary");
  summ.appendChild(
    el("div", "big-avg", `${avg != null ? avg.toFixed(1) : "—"}<small>本作均分</small>`)
  );
  const right = el("div", "summary-right");
  right.innerHTML = `已评 <b>${cnt}</b> 集` + (a.epCount ? ` / 共 ${a.epCount} 集` : "（话数未知，可手动添加）");
  summ.appendChild(right);
  body.appendChild(summ);

  // episode list
  const listWrap = el("div", "ep-list");
  listWrap.id = "epList";
  body.appendChild(listWrap);
  renderEpisodes(a);

  const addBtn = el("button", "add-ep-btn", "+ 添加一集");
  addBtn.addEventListener("click", () => addEpisode(a));
  body.appendChild(addBtn);

  $("#modal").classList.remove("hidden");
}
function renderEpisodes(a) {
  const list = $("#epList");
  list.innerHTML = "";
  const eps = episodeList(a);
  if (!eps.length) {
    list.appendChild(el("div", "ep-status", "还没有集数信息，点下方“添加一集”开始评分。"));
    return;
  }
  for (const ep of eps) {
    list.appendChild(renderEpRow(a, ep));
    const panel = el("div", "shot-panel hidden");
    panel.id = `shot-${a.id}-${ep}`;
    list.appendChild(panel);
  }
}
function renderEpRow(a, ep) {
  const rec = state.ratings[`${a.id}#${ep}`];
  const row = el("div", "ep-row");

  const num = el("div", "ep-num");
  num.appendChild(document.createTextNode(`第${ep}集`));
  const shotBtn = el("button", "ep-shot-btn", "📷");
  const shotCount = el("span", "shot-count", "");
  shotBtn.appendChild(shotCount);
  shotBtn.title = "为本集添加截图";
  shotBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleShotPanel(a, ep, shotCount);
  });
  num.appendChild(shotBtn);
  row.appendChild(num);

  const wrap = el("div", "ep-slider-wrap");
  const slider = el("input");
  slider.type = "range"; slider.min = "1"; slider.max = "10"; slider.step = "0.5";
  slider.value = rec ? rec.score : 5;
  const status = el("div", "ep-status");
  const comment = el("input", "ep-comment");
  comment.type = "text"; comment.placeholder = "评语（可选）";
  comment.value = rec ? rec.comment || "" : "";
  const scoreNum = el("div", rec ? "ep-score-num" : "ep-score-num unrated", rec ? rec.score.toFixed(1) : "未评");
  scoreNum.style.color = rec ? scoreColor(rec.score) : "";

  slider.addEventListener("input", () => {
    scoreNum.textContent = parseFloat(slider.value).toFixed(1);
    scoreNum.classList.remove("unrated");
  });
  let saveTimer = null;
  slider.addEventListener("change", () => {
    status.textContent = "保存中…"; status.className = "ep-status";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveRating(a.id, ep, parseFloat(slider.value), comment.value);
        status.textContent = "已保存"; status.className = "ep-status saved";
        refreshSummary(a);
      } catch { status.textContent = "保存失败"; status.className = "ep-status"; }
    }, 300);
  });
  comment.addEventListener("blur", () => {
    if (!comment.value && !(state.ratings[`${a.id}#${ep}`])) return;
    status.textContent = "保存中…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveRating(a.id, ep, rec ? rec.score : parseFloat(slider.value), comment.value);
        status.textContent = "已保存"; status.className = "ep-status saved";
        refreshSummary(a);
      } catch { status.textContent = "保存失败"; }
    }, 300);
  });

  wrap.appendChild(slider);
  wrap.appendChild(comment);
  wrap.appendChild(status);
  row.appendChild(wrap);
  row.appendChild(scoreNum);

  const del = el("button", "ep-del", "×");
  del.title = "删除此集评分";
  del.addEventListener("click", async () => {
    if (!state.ratings[`${a.id}#${ep}`]) { renderEpisodes(a); return; }
    await deleteRating(a.id, ep);
    refreshSummary(a);
    renderEpisodes(a);
  });
  row.appendChild(del);

  return row;
}
function addEpisode(a) {
  const eps = episodeList(a);
  const next = (eps.length ? Math.max(...eps) : 0) + 1;
  const list = $("#epList");
  if (list.querySelector(".ep-status")) list.innerHTML = "";
  list.appendChild(renderEpRow(a, next));
  const panel = el("div", "shot-panel hidden");
  panel.id = `shot-${a.id}-${next}`;
  list.appendChild(panel);
  refreshSummary(a);
}
function refreshSummary(a) {
  const avg = avgForAnime(a.id);
  const cnt = countForAnime(a.id);
  const summ = $("#modalBody").querySelector(".modal-summary");
  if (summ) {
    summ.querySelector(".big-avg").innerHTML = `${avg != null ? avg.toFixed(1) : "—"}<small>本作均分</small>`;
    summ.querySelector(".summary-right").innerHTML =
      `已评 <b>${cnt}</b> 集` + (a.epCount ? ` / 共 ${a.epCount} 集` : "（话数未知，可手动添加）");
  }
  renderList(); // update card badge
}

function closeModal() {
  $("#modal").classList.add("hidden");
  modalAnime = null;
}

// ---------------- per-episode screenshots ----------------
function toggleShotPanel(a, ep, shotCount) {
  const panel = document.getElementById(`shot-${a.id}-${ep}`);
  if (!panel) return;
  const hidden = panel.classList.toggle("hidden");
  if (!hidden) loadShots(a, ep, panel, shotCount);
}
async function loadShots(a, ep, panel, shotCount) {
  panel.innerHTML = "";
  const drop = el("div", "shot-drop");
  const input = el("input");
  input.type = "file"; input.accept = "image/*"; input.multiple = true; input.hidden = true;
  drop.appendChild(input);
  drop.appendChild(el("div", "shot-tip", "点击选择截图，或将图片拖入此处"));
  const grid = el("div", "shot-grid");
  panel.appendChild(drop);
  panel.appendChild(grid);

  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files && input.files.length) handleFiles(a, ep, input.files, panel, shotCount);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("drag"); })
  );
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)
      handleFiles(a, ep, e.dataTransfer.files, panel, shotCount);
  });

  try {
    const r = await fetch(`/api/screenshot?animeId=${encodeURIComponent(a.id)}&ep=${encodeURIComponent(ep)}`);
    const j = await r.json();
    shotCount.textContent = j.items.length ? String(j.items.length) : "";
    for (const it of j.items) grid.appendChild(shotThumb(it, a, ep, panel, shotCount));
  } catch {}
}
async function handleFiles(a, ep, files, panel, shotCount) {
  const arr = Array.from(files).filter((f) => (f.type || "").startsWith("image/"));
  if (!arr.length) return;
  for (const f of arr) {
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(f);
    });
    const base64 = String(dataUrl).split(",")[1] || "";
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    try {
      await fetch("/api/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animeId: a.id, episode: ep, name: f.name, ext, data: base64 }),
      });
    } catch {}
  }
  await loadShots(a, ep, panel, shotCount);
}
function shotThumb(it, a, ep, panel, shotCount) {
  const card = el("div", "shot-thumb");
  const img = el("img");
  img.src = it.url; img.loading = "lazy"; img.alt = it.name || "截图";
  img.onerror = () => img.replaceWith(el("div", "shot-broken", "图"));
  const del = el("button", "shot-del", "×");
  del.title = "删除该截图";
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await fetch("/api/screenshot", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animeId: a.id, episode: ep, id: it.id }),
      });
    } catch {}
    await loadShots(a, ep, panel, shotCount);
  });
  card.appendChild(img);
  card.appendChild(del);
  return card;
}

// ---------------- stats ----------------
function renderStats() {
  const view = $("#statsView");
  view.innerHTML = "";
  const titleMap = {};
  for (const g of state.groups) for (const a of g.items) titleMap[a.id] = a.title;

  const byAnime = {};
  for (const r of Object.values(state.ratings)) (byAnime[r.animeId] ||= []).push(r);
  const animeStats = Object.entries(byAnime).map(([id, list]) => ({
    id, title: titleMap[id] || id,
    avg: list.reduce((s, r) => s + r.score, 0) / list.length, count: list.length,
  })).sort((a, b) => b.avg - a.avg);

  const totalEp = Object.keys(state.ratings).length;
  const totalAvg = totalEp ? Object.values(state.ratings).reduce((s, r) => s + r.score, 0) / totalEp : null;

  const cards = el("div", "stat-cards");
  cards.appendChild(statCard(animeStats.length, "已评分动画"));
  cards.appendChild(statCard(totalEp, "已评分集数"));
  cards.appendChild(statCard(totalAvg != null ? totalAvg.toFixed(2) : "—", "总平均得分"));
  view.appendChild(cards);

  // TOP5
  const topSec = el("div", "stat-section");
  topSec.appendChild(el("h3", null, "本季高分 TOP5"));
  const max = animeStats.length ? animeStats[0].avg : 10;
  for (let i = 0; i < Math.min(5, animeStats.length); i++) {
    const s = animeStats[i];
    const item = el("div", "top-item");
    item.appendChild(el("div", "top-rank", String(i + 1)));
    const name = el("div", "top-name", esc(s.title));
    const track = el("div", "top-bar-track");
    const fill = el("div", "top-bar-fill");
    fill.style.width = `${(s.avg / 10) * 100}%`;
    track.appendChild(fill);
    item.appendChild(name); item.appendChild(track);
    item.appendChild(el("div", "top-val", `${s.avg.toFixed(1)} · ${s.count}集`));
    topSec.appendChild(item);
  }
  if (!animeStats.length) topSec.appendChild(el("div", "ep-status", "还没有评分，去列表里给喜欢的番剧打分吧。"));
  view.appendChild(topSec);

  // recent
  const recSec = el("div", "stat-section");
  recSec.appendChild(el("h3", null, "最近评分"));
  const recent = Object.values(state.ratings)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 12);
  for (const r of recent) {
    const item = el("div", "recent-item");
    item.appendChild(el("div", "r-title", `${esc(titleMap[r.animeId] || r.animeId)} · 第${r.episode}集`));
    const meta = el("div", "r-meta", r.comment ? esc(r.comment) : new Date(r.updatedAt).toLocaleString("zh-CN"));
    const score = el("div", "r-score", r.score.toFixed(1));
    score.style.color = scoreColor(r.score);
    item.appendChild(meta); item.appendChild(score);
    recSec.appendChild(item);
  }
  if (!recent.length) recSec.appendChild(el("div", "ep-status", "暂无评分记录。"));
  view.appendChild(recSec);
}
function statCard(num, lbl) {
  const c = el("div", "stat-card");
  c.appendChild(el("div", "num", String(num)));
  c.appendChild(el("div", "lbl", lbl));
  return c;
}

// ---------------- view switching ----------------
function setView(v) {
  state.view = v;
  $("#statsBtn").classList.toggle("active", v === "stats");
  $("#seasonView").classList.toggle("hidden", v === "stats");
  $("#statsView").classList.toggle("hidden", v !== "stats");
  if (v === "stats") renderStats();
  else renderList();
}
function setPageMode(m) {
  if (state.pageMode === m) return;
  state.pageMode = m;
  if (m === "all") state.allPage = 0; else state.todayPage = 1;
  $("#tabToday").classList.toggle("active", m === "today");
  $("#tabAll").classList.toggle("active", m === "all");
  $("#tabRated").classList.toggle("active", m === "rated");
  renderList();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------- events ----------------
function bindEvents() {
  $("#prevQuarter").addEventListener("click", () => shiftQuarter(-1));
  $("#nextQuarter").addEventListener("click", () => shiftQuarter(1));
  $("#refreshBtn").addEventListener("click", () => loadSeason(true));
  $("#statsBtn").addEventListener("click", () => setView(state.view === "stats" ? "list" : "stats"));
  $("#tabToday").addEventListener("click", () => setPageMode("today"));
  $("#tabAll").addEventListener("click", () => setPageMode("all"));
  $("#tabRated").addEventListener("click", () => setPageMode("rated"));
  $("#searchInput").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
}
function shiftQuarter(delta) {
  // compute from current label slug
  const y = parseInt(state.quarter.slice(0, 4), 10);
  const m = parseInt(state.quarter.slice(4, 6), 10);
  const idx = [1, 4, 7, 10].indexOf(m);
  let ni = idx + delta, ny = y;
  if (ni < 0) { ni += 4; ny -= 1; }
  if (ni > 3) { ni -= 4; ny += 1; }
  state.quarter = `${ny}${String([1, 4, 7, 10][ni]).padStart(2, "0")}`;
  $("#quarterLabel").textContent = `${ny}年${[1, 4, 7, 10][ni]}月`;
  state.todayPage = 1; state.allPage = 0;
  renderList();
  loadSeason(false);
}

// ---------------- init ----------------
async function init() {
  bindEvents();
  $("#tabToday").classList.toggle("active", state.pageMode === "today");
  $("#tabAll").classList.toggle("active", state.pageMode === "all");
  $("#tabRated").classList.toggle("active", state.pageMode === "rated");
  try {
    const cur = await api("/api/current");
    state.quarter = cur.quarter;
    state.label = cur.label;
    $("#quarterLabel").textContent = cur.label;
  } catch {
    state.quarter = "202607";
    $("#quarterLabel").textContent = "2026年7月";
  }
  await loadRatings();
  await loadSeason(false);
}
init();
