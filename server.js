/*
 * 动漫季度打分 —— 本地 Web 应用（零依赖 Node 后端 + 原生前端）
 *
 * 数据来源与署名（依 CC BY-NC-SA 4.0 署名原则：注明来源、提供链接、说明改编、非商业用途）：
 *   - yuc.wiki  (https://yuc.wiki/)        主要来源：番剧列表、封面、话数
 *   - Bangumi  (https://bgm.tv/)           补充来源：评分与译名（不可达时自动降级，不影响主流程）
 * 本站仅对原始数据进行抓取与整理，用于非商业用途；相关内容的版权归原作者所有。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const RATINGS_FILE = path.join(DATA_DIR, "ratings.json");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const PORT = process.env.PORT || 3000;
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6h

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(COVERS_DIR, { recursive: true });

/* 仅允许这些域名作为封面源，防止 SSRF */
const COVER_ALLOW = [
  "hdslb.com", "bilibili.com", "i0.hdslb.com", "i1.hdslb.com", "i2.hdslb.com",
  "bgm.tv", "lain.bgm.tv", "api.bgm.tv",
  "githubusercontent.com", "github.com",
];
function coverAllowed(u) {
  try {
    const hu = new URL(u);
    if (hu.protocol !== "http:" && hu.protocol !== "https:") return false;
    return COVER_ALLOW.some((d) => hu.hostname === d || hu.hostname.endsWith("." + d));
  } catch {
    return false;
  }
}
if (!fs.existsSync(RATINGS_FILE)) {
  fs.writeFileSync(RATINGS_FILE, JSON.stringify({ ratings: [] }, null, 2));
}

/* ----------------------------- helpers ----------------------------- */
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function normalize(s = "") {
  return (s || "")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[《》「」『』()（）\[\]【】\/\\\-_·:：,.，。!！?？'’"“”~～]/g, "")
    .replace(/第\d+期|第\d+季|part\.?\d+|#\d+~?\d*/gi, "");
}
function quarterFromDate(d = new Date()) {
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) * 3 + 1;
  return `${y}${String(q).padStart(2, "0")}`;
}
function quarterLabel(slug) {
  const y = slug.slice(0, 4);
  const m = slug.slice(4, 6);
  return `${y}年${Number(m)}月`;
}
function shiftQuarter(slug, delta) {
  const y = parseInt(slug.slice(0, 4), 10);
  const m = parseInt(slug.slice(4, 6), 10); // 1,4,7,10
  const idx = [1, 4, 7, 10].indexOf(m);
  let ni = idx + delta;
  let ny = y;
  if (ni < 0) { ni += 4; ny -= 1; }
  if (ni > 3) { ni -= 4; ny += 1; }
  return `${ny}${String([1, 4, 7, 10][ni]).padStart(2, "0")}`;
}

/* --------------------------- yuc.wiki parse --------------------------- */
function parseYuc(html, quarter) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const groupRe = /<!--\s*(周[一二三四五六日]|网络放送|其他)[^>]*-->/g;
  const markers = [...body.matchAll(groupRe)].map((m) => ({
    name: m[1],
    idx: m.index,
  }));
  if (markers.length === 0) return [];

  const groups = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].idx;
    const end = i + 1 < markers.length ? markers[i + 1].idx : body.length;
    const seg = body.slice(start, end);
    const label =
      markers[i].name === "网络放送" ? "网络放送 & 其他" : `${markers[i].name}（${weekdayJa(markers[i].name)}）`;
    const items = parseGroup(seg, quarter);
    if (items.length) groups.push({ label: markers[i].name, title: label, items });
  }
  return groups;
}
function weekdayJa(n) {
  return { 周一: "月", 周二: "火", 周三: "水", 周四: "木", 周五: "金", 周六: "土", 周日: "日", 网络放送: "NET" }[n] || "";
}
function parseGroup(seg, quarter) {
  const parts = seg.split(/<div style="float:left">/);
  const items = [];
  for (const chunk of parts) {
    const tMatch = chunk.match(/class="date_title_"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/td>/);
    if (!tMatch) continue;
    const titleAttr = tMatch[1] ? tMatch[1].trim() : "";
    const titleText = tMatch[2]
      ? tMatch[2]
          .replace(/<br\s*\/?>/gi, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "";
    const title = (titleAttr || titleText).replace(/\.\.\.$/, "").trim();
    if (!title) continue;

    const timeMatch = chunk.match(/<p class="imgtext\d*">([^<]+)</);
    const airTime = timeMatch ? timeMatch[1].replace(/~$/, "").trim() : "";

    const imgepMatch = chunk.match(/<p class="imgep">([^<]*)</);
    const imgep = imgepMatch ? imgepMatch[1].trim() : "";

    let epCount = null;
    let startDate = null;
    const epM = imgep.match(/全\s*(\d+)\s*话/) || imgep.match(/(\d+)\s*话/);
    if (epM) epCount = parseInt(epM[1], 10);
    const dateM = imgep.match(/(\d{1,2})\/(\d{1,2})~/) || chunk.match(/(\d{1,2})\/(\d{1,2})~/);
    if (dateM) startDate = `${dateM[1]}/${dateM[2]}`;

    const imgMatch = chunk.match(/<img[^>]*data-src="([^"]+)"/);
    const coverYuc = imgMatch ? imgMatch[1] : null;

    const regionTags = [];
    const areaRe = /<a\s+href="([^"]+)"[^>]*>[\s\S]*?<p class="area">([^<]+)<\/p>/g;
    let a;
    while ((a = areaRe.exec(chunk))) {
      regionTags.push({ name: a[2].trim(), url: a[1] });
    }

    const id = djb2(normalize(title) + "|" + (airTime || ""));
    items.push({
      id,
      title,
      airTime,
      startDate,
      epCount,
      epCountText: imgep,
      coverYuc,
      regionTags,
      cover: coverYuc,
      bgmScore: null,
      bgmId: null,
    });
  }
  return items;
}

/* ----------------------------- Bangumi ----------------------------- */
async function fetchBangumi() {
  try {
    const res = await fetch("https://api.bgm.tv/calendar", {
      headers: { "User-Agent": "anime-rater/1.0", Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out = [];
    for (const day of data) {
      for (const it of day.items || []) {
        out.push({
          id: it.id,
          name: it.name || "",
          name_cn: it.name_cn || "",
          cover: it.images?.common || it.images?.large || null,
          score: it.rating?.score ?? null,
          air_weekday: it.air_weekday,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
function mergeBangumi(groups, bgmList) {
  const byNorm = [];
  for (const b of bgmList) {
    const keys = [normalize(b.name_cn), normalize(b.name)].filter(Boolean);
    for (const k of keys) byNorm.push({ k, b });
  }
  const findHit = (title) => {
    const nt = normalize(title);
    if (!nt) return null;
    // 1) exact
    let x = byNorm.find((y) => y.k === nt);
    if (x) return { b: x.b, strength: "exact" };
    // 2) 去掉季度/话数后缀后精确匹配
    const stripped = normalize(title.replace(/\s*[#（(第].*$/, ""));
    x = byNorm.find((y) => y.k === stripped);
    if (x) return { b: x.b, strength: "season" };
    // 3) 前缀匹配（处理 yuc 截断），但仅用于补充评分信息，不覆盖封面
    const cand = byNorm.find(
      (y) => (y.k.startsWith(nt) || nt.startsWith(y.k)) && y.k.length >= 3 && nt.length >= 3
    );
    if (cand) return { b: cand.b, strength: "prefix" };
    return null;
  };
  for (const g of groups) {
    for (const an of g.items) {
      const hit = findHit(an.title);
      if (hit) {
        an.bgmId = hit.b.id;
        an.bgmScore = hit.b.score;
        // 仅在强匹配时覆盖封面，避免张冠李戴
        if (hit.strength !== "prefix" && hit.b.cover) an.cover = hit.b.cover;
      }
    }
  }
  return groups;
}

/* ----------------------------- cache ----------------------------- */
function cacheGet(quarter) {
  const f = path.join(CACHE_DIR, `${quarter}.json`);
  try {
    if (fs.existsSync(f)) {
      const obj = JSON.parse(fs.readFileSync(f, "utf8"));
      if (Date.now() - obj.ts < CACHE_TTL) return obj.data;
    }
  } catch {}
  return null;
}
function cacheSet(quarter, data) {
  const f = path.join(CACHE_DIR, `${quarter}.json`);
  try {
    fs.writeFileSync(f, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function getSeason(quarter, force = false) {
  if (!force) {
    const cached = cacheGet(quarter);
    if (cached) return { quarter, groups: cached, cached: true };
  }
  const url = `https://yuc.wiki/${quarter}/`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`yuc.wiki ${res.status}`);
  const html = await res.text();
  let groups = parseYuc(html, quarter);
  try {
    const bgm = await fetchBangumi();
    groups = mergeBangumi(groups, bgm);
  } catch {}
  cacheSet(quarter, groups);
  return { quarter, groups, cached: false };
}

/* ----------------------------- ratings ----------------------------- */
function readRatings() {
  try {
    return JSON.parse(fs.readFileSync(RATINGS_FILE, "utf8")).ratings || [];
  } catch {
    return [];
  }
}
function writeRatings(ratings) {
  fs.writeFileSync(RATINGS_FILE, JSON.stringify({ ratings }, null, 2));
}
function upsertRating({ animeId, episode, score, comment }) {
  const ratings = readRatings();
  const ep = Number(episode);
  const i = ratings.findIndex((r) => r.animeId === animeId && r.episode === ep);
  const rec = { animeId, episode: ep, score: Number(score), comment: comment || "", updatedAt: new Date().toISOString() };
  if (i >= 0) ratings[i] = rec;
  else ratings.push(rec);
  writeRatings(ratings);
  return rec;
}
function deleteRating(animeId, episode) {
  const ratings = readRatings().filter(
    (r) => !(r.animeId === animeId && r.episode === Number(episode))
  );
  writeRatings(ratings);
}

/* ----------------------------- stats ----------------------------- */
function computeStats(groups) {
  const ratings = readRatings();
  const titleMap = {};
  for (const g of groups) for (const a of g.items) titleMap[a.id] = a.title;
  const byAnime = {};
  for (const r of ratings) {
    (byAnime[r.animeId] ||= []).push(r);
  }
  const animeStats = Object.entries(byAnime).map(([animeId, list]) => {
    const avg = list.reduce((s, r) => s + r.score, 0) / list.length;
    return { animeId, title: titleMap[animeId] || animeId, avg: +avg.toFixed(2), count: list.length };
  });
  animeStats.sort((a, b) => b.avg - a.avg);
  const recent = [...ratings].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 10);
  const recentMapped = recent.map((r) => ({ ...r, title: titleMap[r.animeId] || r.animeId }));
  const totalAvg = ratings.length
    ? +(ratings.reduce((s, r) => s + r.score, 0) / ratings.length).toFixed(2)
    : null;
  return {
    ratedAnime: animeStats.length,
    ratedEpisodes: ratings.length,
    totalAvg,
    top: animeStats.slice(0, 5),
    recent: recentMapped,
  };
}

/* --------------------------- cover proxy --------------------------- */
/* 浏览器直连 bilibili/bgm 等 CDN 会被 Referer 防盗链挡成 403，
   这里由服务端拉取并以同源地址返回，同时磁盘缓存，开关机不丢。 */
const COVER_CT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
function coverExt(u) {
  const m = u.split("?")[0].split("#")[0].match(/\.(jpg|jpeg|png|webp|gif|avif)$/i);
  return m ? m[1].toLowerCase() : "jpg";
}
async function proxyCover(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("u");
  if (!u || !coverAllowed(u)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("bad url");
  }
  const ext = coverExt(u);
  const ct = COVER_CT[ext] || "image/jpeg";
  const file = path.join(COVERS_DIR, `${djb2(u)}.${ext}`);
  if (fs.existsSync(file)) {
    res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=2592000" });
    return fs.createReadStream(file).pipe(res);
  }
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    try {
      fs.writeFileSync(file, buf);
    } catch {}
    res.writeHead(200, { "Content-Type": r.headers.get("content-type") || ct, "Cache-Control": "public, max-age=2592000" });
    return res.end(buf);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("fetch failed: " + (e && e.message ? e.message : e));
  }
}

/* ----------------------------- server ----------------------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/api/season") {
      const quarter = url.searchParams.get("quarter") || quarterFromDate();
      const force = url.searchParams.get("force") === "1";
      const data = await getSeason(quarter, force);
      return sendJSON(res, 200, data);
    }
    if (p === "/api/current") {
      return sendJSON(res, 200, { quarter: quarterFromDate(), label: quarterLabel(quarterFromDate()) });
    }
    if (p === "/api/ratings") {
      if (req.method === "GET") return sendJSON(res, 200, { ratings: readRatings() });
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.animeId || !b.episode) return sendJSON(res, 400, { error: "animeId & episode required" });
        const rec = upsertRating(b);
        return sendJSON(res, 200, rec);
      }
      if (req.method === "DELETE") {
        const animeId = url.searchParams.get("animeId");
        const episode = url.searchParams.get("episode");
        if (!animeId || !episode) return sendJSON(res, 400, { error: "animeId & episode required" });
        deleteRating(animeId, episode);
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }
    if (p === "/api/stats") {
      const quarter = url.searchParams.get("quarter") || quarterFromDate();
      let groups = cacheGet(quarter) || [];
      if (!groups.length) {
        try {
          groups = (await getSeason(quarter)).groups;
        } catch {}
      }
      return sendJSON(res, 200, computeStats(groups));
    }
    if (p === "/api/cover") {
      return proxyCover(req, res);
    }
    if (p.startsWith("/api/")) {
      return sendJSON(res, 404, { error: "not found" });
    }
    return serveStatic(req, res);
  } catch (e) {
    return sendJSON(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, () => {
    console.log(`动漫打分服务已启动: http://localhost:${PORT}`);
  });
}

export { getSeason, computeStats, quarterFromDate, quarterLabel, shiftQuarter, readRatings, normalize, mergeBangumi };
