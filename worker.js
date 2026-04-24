// ============================================================
//  BlogAuto Template — MZ Edition
//  분양시 CONFIG 블록만 수정 (나머지는 관리자 페이지에서 설정)
// ============================================================
const CONFIG = {
  BLOG_NAME: "내 블로그",
  BLOG_DESC: "유익한 정보를 나누는 공간",
  BLOG_OWNER: "운영자",
  ADMIN_PASSWORD: "admin1234",
  ADSENSE_CLIENT: "ca-pub-XXXXXXXXXXXXXXXX",
  ADSENSE_SLOT_TOP: "1234567890",
  ADSENSE_SLOT_MID: "0987654321",
  ADSENSE_SLOT_BOTTOM: "1122334455",
  WEBHOOK_SECRET: "your-secret-key",
};
// ============================================================

export default {
  async fetch(request, env) {
    // 요청별 설정 (KV가 CONFIG를 오버라이드)
    const cfg = {
      BLOG_NAME: CONFIG.BLOG_NAME, BLOG_DESC: CONFIG.BLOG_DESC,
      BLOG_OWNER: CONFIG.BLOG_OWNER, ADMIN_PASSWORD: CONFIG.ADMIN_PASSWORD,
      ADSENSE_CLIENT: CONFIG.ADSENSE_CLIENT, ADSENSE_SLOT_TOP: CONFIG.ADSENSE_SLOT_TOP,
      ADSENSE_SLOT_MID: CONFIG.ADSENSE_SLOT_MID, ADSENSE_SLOT_BOTTOM: CONFIG.ADSENSE_SLOT_BOTTOM,
      WEBHOOK_SECRET: CONFIG.WEBHOOK_SECRET, accent: '#b3ff00',
    };
    try {
      const raw = await env.BLOG_KV.get('blog_config');
      if (raw) {
        const kv = JSON.parse(raw);
        if (kv.name) cfg.BLOG_NAME = kv.name;
        if (kv.desc) cfg.BLOG_DESC = kv.desc;
        if (kv.accent) cfg.accent = kv.accent;
        if (kv.adClient) cfg.ADSENSE_CLIENT = kv.adClient;
        if (kv.slotTop) cfg.ADSENSE_SLOT_TOP = kv.slotTop;
        if (kv.slotMid) cfg.ADSENSE_SLOT_MID = kv.slotMid;
        if (kv.slotBottom) cfg.ADSENSE_SLOT_BOTTOM = kv.slotBottom;
        if (kv.webhook) cfg.WEBHOOK_SECRET = kv.webhook;
        if (kv.password) cfg.ADMIN_PASSWORD = kv.password;
      }
    } catch(e) {}

    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (path.startsWith("/api/")) return handleAPI(request, env, path, cors, cfg);
    if (path === "/" || path === "/index.html") return html(getIndexHTML(cfg));
    if (path.startsWith("/post/")) return html(getPostHTML(cfg, path.replace("/post/", "")));
    if (path === "/admin" || path === "/admin.html") return html(getAdminHTML(cfg));
    if (path === "/terms") return html(getTermsHTML(cfg));
    if (path === "/privacy") return html(getPrivacyHTML(cfg));
    if (path === "/sitemap.xml") return serveSitemap(env);
    if (path === "/robots.txt") return serveRobots(request);
    return new Response("Not Found", { status: 404 });
  }
};

function html(body) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ═══════════════════════ API ══════════════════════════════════
async function handleAPI(request, env, path, cors, cfg) {
  const headers = { ...cors, "Content-Type": "application/json" };

  // ── 글 목록 ──
  if (path === "/api/posts" && request.method === "GET") {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || "";
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 10;
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    if (category) list = list.filter(p => p.category === category);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = list.length;
    const posts = list.slice((page - 1) * limit, page * limit);
    return new Response(JSON.stringify({ ok: true, posts, total, page, limit }), { headers });
  }

  // ── 글 상세 ──
  if (path.startsWith("/api/posts/") && request.method === "GET") {
    const id = path.replace("/api/posts/", "");
    const post = await env.BLOG_KV.get("post:" + id);
    if (!post) return new Response(JSON.stringify({ ok: false, error: "없음" }), { status: 404, headers });
    const data = JSON.parse(post);
    data.views = (data.views || 0) + 1;
    await env.BLOG_KV.put("post:" + id, JSON.stringify(data));
    return new Response(JSON.stringify({ ok: true, post: data }), { headers });
  }

  // ── 글 저장 ──
  if (path === "/api/posts" && request.method === "POST") {
    if (!checkAuth(request, cfg)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
    const body = await request.json();
    const id = body.id || ("post_" + Date.now());
    const now = new Date().toISOString();
    const post = {
      id, title: body.title || "", content: body.content || "",
      summary: body.summary || (body.content || "").replace(/<[^>]*>/g, "").slice(0, 150),
      category: body.category || "일반", thumbnail: body.thumbnail || "",
      tags: body.tags || [], views: body.views || 0,
      createdAt: body.createdAt || now, updatedAt: now,
    };
    await env.BLOG_KV.put("post:" + id, JSON.stringify(post));
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    const idx = list.findIndex(p => p.id === id);
    const summary = { id, title: post.title, summary: post.summary, category: post.category, thumbnail: post.thumbnail, createdAt: post.createdAt };
    if (idx >= 0) list[idx] = summary; else list.unshift(summary);
    await env.BLOG_KV.put("post_list", JSON.stringify(list));
    return new Response(JSON.stringify({ ok: true, id }), { headers });
  }

  // ── 글 삭제 ──
  if (path.startsWith("/api/posts/") && request.method === "DELETE") {
    if (!checkAuth(request, cfg)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
    const id = path.replace("/api/posts/", "");
    await env.BLOG_KV.delete("post:" + id);
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    list = list.filter(p => p.id !== id);
    await env.BLOG_KV.put("post_list", JSON.stringify(list));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // ── 웹훅 ──
  if (path === "/api/webhook" && request.method === "POST") {
    const secret = request.headers.get("X-API-Key") || (request.headers.get("Authorization") || "").replace("Bearer ", "");
    if (secret !== cfg.WEBHOOK_SECRET) return new Response(JSON.stringify({ ok: false, error: "인증 실패" }), { status: 401, headers });
    const body = await request.json();
    const id = "post_" + Date.now();
    const now = new Date().toISOString();
    const post = {
      id, title: body.title || "제목 없음", content: body.content || "",
      summary: body.excerpt || (body.content || "").replace(/<[^>]*>/g, "").slice(0, 150),
      category: body.category || "일반", thumbnail: body.thumbnail || "",
      tags: body.tags ? (typeof body.tags === "string" ? body.tags.split(",") : body.tags) : [],
      views: 0, createdAt: now, updatedAt: now,
    };
    await env.BLOG_KV.put("post:" + id, JSON.stringify(post));
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    list.unshift({ id, title: post.title, summary: post.summary, category: post.category, thumbnail: post.thumbnail, createdAt: post.createdAt });
    await env.BLOG_KV.put("post_list", JSON.stringify(list));
    return new Response(JSON.stringify({ ok: true, id }), { headers });
  }

  // ── 카테고리 조회 ──
  if (path === "/api/categories" && request.method === "GET") {
    const managed = await env.BLOG_KV.get("category_list");
    if (managed) return new Response(JSON.stringify({ ok: true, categories: JSON.parse(managed) }), { headers });
    const listRaw = await env.BLOG_KV.get("post_list");
    const list = listRaw ? JSON.parse(listRaw) : [];
    const cats = [...new Set(list.map(p => p.category))];
    return new Response(JSON.stringify({ ok: true, categories: cats }), { headers });
  }

  // ── 카테고리 관리 (add / rename / delete) ──
  if (path === "/api/categories" && request.method === "POST") {
    if (!checkAuth(request, cfg)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
    const body = await request.json();
    const managed = await env.BLOG_KV.get("category_list");
    let cats = managed ? JSON.parse(managed) : [];
    if (body.action === "add" && body.name && !cats.includes(body.name)) {
      cats.push(body.name);
    } else if (body.action === "rename" && body.oldName && body.newName) {
      const idx = cats.indexOf(body.oldName);
      if (idx >= 0) cats[idx] = body.newName;
    } else if (body.action === "delete" && body.name) {
      cats = cats.filter(c => c !== body.name);
    }
    await env.BLOG_KV.put("category_list", JSON.stringify(cats));
    return new Response(JSON.stringify({ ok: true, categories: cats }), { headers });
  }

  // ── 블로그 설정 조회 ──
  if (path === "/api/config" && request.method === "GET") {
    const raw = await env.BLOG_KV.get("blog_config");
    const kv = raw ? JSON.parse(raw) : {};
    return new Response(JSON.stringify({
      ok: true,
      name: kv.name || cfg.BLOG_NAME,
      desc: kv.desc || cfg.BLOG_DESC,
      accent: kv.accent || '#b3ff00',
      adClient: kv.adClient || cfg.ADSENSE_CLIENT,
      slotTop: kv.slotTop || cfg.ADSENSE_SLOT_TOP,
      slotMid: kv.slotMid || cfg.ADSENSE_SLOT_MID,
      slotBottom: kv.slotBottom || cfg.ADSENSE_SLOT_BOTTOM,
      webhook: kv.webhook || cfg.WEBHOOK_SECRET,
    }), { headers });
  }

  // ── 블로그 설정 저장 ──
  if (path === "/api/config" && request.method === "POST") {
    if (!checkAuth(request, cfg)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
    const body = await request.json();
    await env.BLOG_KV.put("blog_config", JSON.stringify(body));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // ── 로그인 ──
  if (path === "/api/login" && request.method === "POST") {
    const body = await request.json();
    if (body.password === cfg.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ ok: true, token: btoa(cfg.ADMIN_PASSWORD) }), { headers });
    }
    return new Response(JSON.stringify({ ok: false, error: "비밀번호 틀림" }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
}

function checkAuth(request, cfg) {
  return (request.headers.get("Authorization") || "") === ("Bearer " + btoa(cfg.ADMIN_PASSWORD));
}

async function serveSitemap(env) {
  const listRaw = await env.BLOG_KV.get("post_list");
  const list = listRaw ? JSON.parse(listRaw) : [];
  const urls = list.map(p => "<url><loc>/post/" + p.id + "</loc></url>").join("");
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/</loc></url>' + urls + "</urlset>", { headers: { "Content-Type": "application/xml" } });
}

function serveRobots(request) {
  return new Response("User-agent: *\nAllow: /\nSitemap: " + new URL(request.url).origin + "/sitemap.xml", { headers: { "Content-Type": "text/plain" } });
}

// ═══════════════════════ HTML 헬퍼 ═══════════════════════════

function adUnit(cfg, slot) {
  return '<div class="ad-wrap"><ins class="adsbygoogle" style="display:block" data-ad-client="' + cfg.ADSENSE_CLIENT + '" data-ad-slot="' + slot + '" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script></div>';
}

// 액센트 색상 대비 계산 (밝으면 검정 텍스트)
function accentCSS(accent) {
  if (!accent || accent === '#b3ff00') return '';
  var hex = accent.replace('#', '');
  var r = parseInt(hex.substr(0,2),16)||0;
  var g = parseInt(hex.substr(2,2),16)||0;
  var b = parseInt(hex.substr(4,2),16)||0;
  var lum = (0.299*r + 0.587*g + 0.114*b)/255;
  var act = lum > 0.5 ? '#000' : '#fff';
  return ':root{--ac:' + accent + ';--act:' + act + '}[data-theme=light]{--ac:' + accent + ';--act:' + act + '}';
}

function themeJS() {
  return `(function(){
  var t=localStorage.getItem('bt')||'dark';
  document.documentElement.setAttribute('data-theme',t);
  var b=document.getElementById('themeBtn');
  if(b)b.textContent=t==='dark'?'☀ LIGHT':'☾ DARK';
}());
function toggleTheme(){
  var c=document.documentElement.getAttribute('data-theme')||'dark';
  var n=c==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',n);
  localStorage.setItem('bt',n);
  var b=document.getElementById('themeBtn');
  if(b)b.textContent=n==='dark'?'☀ LIGHT':'☾ DARK';
}`;
}

function commonCSS() {
  return `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
:root{--bg:#0a0a0a;--bg2:#0f0f0f;--sf:#111;--sf2:#161616;--br:#1e1e1e;--br2:#2a2a2a;--ac:#b3ff00;--act:#000;--rd:#ff3b3b;--t1:#fff;--t2:#888;--t3:#555;--t4:#2a2a2a}
[data-theme=light]{--bg:#f0f0eb;--bg2:#fff;--sf:#fff;--sf2:#f5f5f0;--br:#e0e0d8;--br2:#bbb;--ac:#b3ff00;--act:#000;--rd:#cc2222;--t1:#0a0a0a;--t2:#666;--t3:#aaa;--t4:#ddd}
@keyframes tickScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes barW{from{width:0}to{width:var(--w,60%)}}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Noto Sans KR','Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--t1);line-height:1.6;-webkit-font-smoothing:antialiased;transition:background .3s,color .3s}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block;height:auto}
.ticker{background:var(--sf);border-bottom:1px solid var(--br);height:32px;display:flex;align-items:center;overflow:hidden;transition:background .3s}
.tk-badge{background:var(--ac);color:var(--act);font-size:9px;font-weight:800;letter-spacing:.18em;padding:0 14px;flex-shrink:0;height:100%;display:flex;align-items:center;text-transform:uppercase}
.tk-track{overflow:hidden;flex:1;height:100%}
.tk-inner{display:flex;white-space:nowrap;animation:tickScroll 28s linear infinite;height:100%;align-items:center}
.tk-item{font-size:11px;color:var(--t2);padding:0 28px;border-right:1px solid var(--br);height:100%;display:flex;align-items:center;gap:8px;flex-shrink:0}
.tk-item b{color:var(--t1);font-weight:600}
.tk-up{color:var(--ac);font-size:10px;font-weight:700}
.tk-dn{color:var(--rd);font-size:10px;font-weight:700}
header{background:var(--bg);border-bottom:2px solid var(--ac);position:sticky;top:0;z-index:100;transition:background .3s,border-color .3s}
.h-inner{max-width:1280px;margin:0 auto;padding:0 24px;height:56px;display:flex;align-items:center}
.h-logo{font-size:18px;font-weight:900;letter-spacing:-1px;color:var(--t1);text-transform:uppercase;margin-right:auto;transition:color .3s}
.h-logo em{color:var(--ac);font-style:normal;transition:color .3s}
.h-nav{display:flex}
.h-nav a{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--t2);padding:8px 14px;transition:color .15s}
.h-nav a:hover{color:var(--ac)}
.h-live{display:flex;align-items:center;gap:6px;font-size:9px;font-weight:800;letter-spacing:.16em;color:var(--rd);margin:0 14px}
.h-dot{width:6px;height:6px;border-radius:50%;background:var(--rd);animation:blink 1.2s ease-in-out infinite;flex-shrink:0}
.theme-btn{background:transparent;border:1px solid var(--br2);color:var(--t2);font-size:9px;font-weight:700;letter-spacing:.1em;padding:6px 12px;cursor:pointer;text-transform:uppercase;font-family:inherit;transition:all .15s;white-space:nowrap}
.theme-btn:hover{border-color:var(--ac);color:var(--ac)}
footer{background:var(--sf);border-top:2px solid var(--ac);padding:32px 24px;transition:background .3s,border-color .3s}
.f-inner{max-width:1280px;margin:0 auto}
.f-logo{font-size:16px;font-weight:900;letter-spacing:-1px;text-transform:uppercase;margin-bottom:14px;color:var(--t1)}
.f-logo em{color:var(--ac);font-style:normal}
.f-hr{border:none;border-top:1px solid var(--br);margin:14px 0}
.f-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.f-links{display:flex;gap:20px}
.f-links a{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--t2);transition:color .15s}
.f-links a:hover{color:var(--ac)}
.f-copy{font-size:10px;color:var(--t3);letter-spacing:.06em}
.ad-wrap{background:var(--sf2);border:1px dashed var(--br2);padding:10px;text-align:center;margin:20px 0;min-height:90px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:10px;letter-spacing:.08em}
@media(max-width:768px){.h-inner{padding:0 16px}.h-nav a{padding:6px 10px;font-size:9px}.h-logo{font-size:15px}.h-live{display:none}}`;
}

function headerHTML(cfg, extraNav) {
  extraNav = extraNav || '';
  var items = '<div class="tk-item"><b>IT</b> AI 자동화로 블로그 월 수익 달성 <span class="tk-up">▲</span></div><div class="tk-item"><b>트렌드</b> MZ세대 부업 관심 역대 최고 <span class="tk-up">▲</span></div><div class="tk-item"><b>경제</b> 애드센스 CPC 상승세 지속 <span class="tk-up">▲</span></div><div class="tk-item"><b>라이프</b> 재택 블로거 수 전년比 2배 증가</div><div class="tk-item"><b>IT</b> Cloudflare Workers 성능 개선 발표</div><div class="tk-item"><b>SEO</b> 구글 고품질 콘텐츠 우대 <span class="tk-up">▲</span></div>';
  return '<div class="ticker"><div class="tk-badge">LIVE</div><div class="tk-track"><div class="tk-inner">' + items + items + '</div></div></div>' +
    '<header><div class="h-inner"><a href="/" class="h-logo">' + cfg.BLOG_NAME + '</a><nav class="h-nav"><a href="/">홈</a>' + extraNav + '</nav><div class="h-live"><div class="h-dot"></div>LIVE</div><button class="theme-btn" id="themeBtn" onclick="toggleTheme()">☀ LIGHT</button></div></header>';
}

function footerHTML(cfg) {
  var year = new Date().getFullYear();
  return '<footer><div class="f-inner"><div class="f-logo"><em>' + cfg.BLOG_NAME + '</em></div><hr class="f-hr"><div class="f-row"><div class="f-links"><a href="/">홈</a><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a></div><p class="f-copy">&copy; ' + year + ' ' + cfg.BLOG_NAME + '. All rights reserved.</p></div></div></footer>';
}

// ── 메인 페이지 ───────────────────────────────────────────────
function getIndexHTML(cfg) {
  var css = `
.idx-wrap{max-width:1280px;margin:0 auto;padding:28px 24px}
.feat-wrap{margin-bottom:1px;animation:fadeIn .5s ease}
.feat-grid{display:grid;grid-template-columns:2fr 1fr;gap:1px;background:var(--br);border:1px solid var(--br)}
.feat-main{background:var(--bg);cursor:pointer;overflow:hidden;transition:background .2s}
.feat-main:hover{background:var(--sf2)}
.feat-main:hover .feat-title{color:var(--ac)}
.feat-main:hover .feat-img{transform:scale(1.02)}
.feat-img{width:100%;height:320px;object-fit:cover;display:block;transition:transform .4s}
.feat-img-ph{width:100%;height:320px;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:48px}
.feat-body{padding:20px 24px 24px}
.feat-cat{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--ac);margin-bottom:12px}
.feat-title{font-size:28px;font-weight:900;line-height:1.15;letter-spacing:-1px;margin-bottom:10px;transition:color .2s}
.feat-desc{font-size:13px;color:var(--t2);line-height:1.7;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feat-meta{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;margin-top:14px}
.feat-side{background:var(--bg);display:flex;flex-direction:column;gap:1px}
.side-card{background:var(--sf);padding:16px 20px;cursor:pointer;flex:1;border-bottom:1px solid var(--br);transition:background .15s;display:flex;flex-direction:column;justify-content:space-between}
.side-card:last-child{border-bottom:none}
.side-card:hover{background:var(--sf2)}
.side-card:hover .side-title{color:var(--ac)}
.side-cat{font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ac);margin-bottom:6px}
.side-title{font-size:14px;font-weight:700;line-height:1.4;color:var(--t1);transition:color .15s;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.side-meta{font-size:10px;color:var(--t3);margin-top:8px;letter-spacing:.04em;text-transform:uppercase}
.stats-bar{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--br);margin:1px 0;animation:slideUp .5s .2s ease both}
.stat-item{background:var(--sf);padding:16px 20px}
.stat-n{font-size:22px;font-weight:900;letter-spacing:-1px;color:var(--t1)}
.stat-n em{color:var(--ac);font-style:normal}
.stat-l{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--t3);margin-top:4px}
.stat-bar-wrap{height:2px;background:var(--br2);margin-top:12px;overflow:hidden}
.stat-fill{height:100%;background:var(--ac);animation:barW 1s .6s ease both}
.sec-head{display:flex;align-items:center;justify-content:space-between;padding:20px 0 12px;animation:fadeIn .5s .3s ease both;opacity:0;animation-fill-mode:both;flex-wrap:wrap;gap:10px}
.sec-ttl{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--ac)}
.cat-tabs{display:flex;gap:0;overflow-x:auto;scrollbar-width:none}
.cat-tabs::-webkit-scrollbar{display:none}
.cat-btn{padding:6px 14px;border:none;border-right:1px solid var(--br);background:transparent;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;color:var(--t2);white-space:nowrap;font-family:inherit;transition:background .1s,color .1s}
.cat-btn:first-child{border-left:1px solid var(--br)}
.cat-btn.active{background:var(--ac);color:var(--act);border-color:var(--ac)}
.cat-btn:hover:not(.active){color:var(--t1)}
.posts-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--br)}
.card{background:var(--sf);cursor:pointer;position:relative;overflow:hidden;transition:background .2s;animation:slideUp .4s ease both}
.card:hover{background:var(--sf2)}
.card:hover .card-title{color:var(--ac)}
.card:hover .card-arr{opacity:1;transform:translate(0,0)}
.card:hover .card-img img{transform:scale(1.05)}
.card-n{position:absolute;top:10px;right:12px;font-size:32px;font-weight:900;color:var(--br2);line-height:1;pointer-events:none;z-index:1}
.card-img{height:160px;overflow:hidden;background:var(--sf2)}
.card-img img{width:100%;height:100%;object-fit:cover;transition:transform .4s;display:block}
.card-img-ph{height:160px;background:var(--sf2);display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--br2)}
.card-body{padding:16px}
.card-cat{font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ac);margin-bottom:7px}
.card-title{font-size:15px;font-weight:700;line-height:1.35;letter-spacing:-.2px;transition:color .2s;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-desc{font-size:12px;color:var(--t2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--br)}
.card-date{font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--t3)}
.card-arr{font-size:14px;color:var(--ac);opacity:0;transform:translate(-6px,6px);transition:all .2s}
.pagi{display:flex;justify-content:center;gap:2px;margin:24px 0}
.pg-btn{width:36px;height:36px;border:1px solid var(--br);background:var(--sf);cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;color:var(--t2);transition:all .15s}
.pg-btn.on{background:var(--ac);color:var(--act);border-color:var(--ac)}
.pg-btn:hover:not(.on){border-color:var(--ac);color:var(--ac)}
.st-load,.st-empty{padding:60px 20px;text-align:center;color:var(--t3);background:var(--sf);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
@media(max-width:900px){.feat-grid{grid-template-columns:1fr}.feat-side{flex-direction:row;overflow-x:auto}.side-card{min-width:200px}.stats-bar{grid-template-columns:repeat(2,1fr)}.posts-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.posts-grid{grid-template-columns:1fr}.feat-img,.feat-img-ph{height:220px}.feat-title{font-size:22px}.idx-wrap{padding:20px 16px}}`;

  return `<!DOCTYPE html><html lang="ko" data-theme="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${cfg.BLOG_NAME}</title><meta name="description" content="${cfg.BLOG_DESC}">
<script>(function(){var t=localStorage.getItem('bt')||'dark';document.documentElement.setAttribute('data-theme',t);})()<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.ADSENSE_CLIENT}" crossorigin="anonymous"><\/script>
<style>${commonCSS()}${accentCSS(cfg.accent)}${css}</style></head><body>
${headerHTML(cfg, '<a href="/admin">관리</a>')}
<main class="idx-wrap">
  ${adUnit(cfg, cfg.ADSENSE_SLOT_TOP)}
  <div id="featWrap" class="feat-wrap"></div>
  <div class="stats-bar">
    <div class="stat-item"><div class="stat-n"><em id="sc">--</em>개</div><div class="stat-l">발행된 글</div><div class="stat-bar-wrap"><div class="stat-fill" style="--w:70%"></div></div></div>
    <div class="stat-item"><div class="stat-n">AdSense</div><div class="stat-l">광고 운영중</div><div class="stat-bar-wrap"><div class="stat-fill" style="--w:100%"></div></div></div>
    <div class="stat-item"><div class="stat-n">24/7</div><div class="stat-l">자동 운영</div><div class="stat-bar-wrap"><div class="stat-fill" style="--w:100%"></div></div></div>
    <div class="stat-item"><div class="stat-n">SEO</div><div class="stat-l">최적화 완료</div><div class="stat-bar-wrap"><div class="stat-fill" style="--w:90%"></div></div></div>
  </div>
  <div class="sec-head">
    <div class="sec-ttl">최신 아티클</div>
    <div id="catTabs" class="cat-tabs"><button class="cat-btn active" data-cat="">전체</button></div>
  </div>
  <div id="postsGrid" class="posts-grid"><div class="st-load">불러오는 중...</div></div>
  <div id="pagi" class="pagi"></div>
  ${adUnit(cfg, cfg.ADSENSE_SLOT_BOTTOM)}
</main>
${footerHTML(cfg)}
<script>
${themeJS()}
var curPage=1,curCat='';
document.getElementById('catTabs').addEventListener('click',function(e){
  var b=e.target.closest('[data-cat]');if(!b)return;
  document.querySelectorAll('.cat-btn').forEach(function(x){x.classList.remove('active');});
  b.classList.add('active');curCat=b.dataset.cat;curPage=1;loadPosts();
});
document.getElementById('postsGrid').addEventListener('click',function(e){
  var c=e.target.closest('.card[data-id]');if(c)location.href='/post/'+c.dataset.id;
});
document.getElementById('featWrap').addEventListener('click',function(e){
  var el=e.target.closest('[data-id]');if(el)location.href='/post/'+el.dataset.id;
});
document.getElementById('pagi').addEventListener('click',function(e){
  var b=e.target.closest('[data-pg]');if(!b)return;
  curPage=parseInt(b.dataset.pg);loadPosts();window.scrollTo({top:0,behavior:'smooth'});
});
async function loadCats(){
  try{var r=await fetch('/api/categories'),d=await r.json();
  var tabs=document.getElementById('catTabs');
  (d.categories||[]).forEach(function(c){
    var b=document.createElement('button');
    b.className='cat-btn';b.textContent=c;b.setAttribute('data-cat',c);
    tabs.appendChild(b);
  });}catch(e){}
}
async function loadPosts(){
  var grid=document.getElementById('postsGrid');
  grid.innerHTML='<div class="st-load">불러오는 중...</div>';
  try{
    var r=await fetch('/api/posts?page='+curPage+'&category='+encodeURIComponent(curCat));
    var d=await r.json();
    if(!d.posts||!d.posts.length){
      grid.innerHTML='<div class="st-empty">아직 글이 없습니다</div>';
      document.getElementById('featWrap').innerHTML='';
      document.getElementById('pagi').innerHTML='';
      return;
    }
    var sc=document.getElementById('sc');if(sc)sc.textContent=d.total;
    if(curPage===1){buildFeat(d.posts);buildGrid(d.posts.slice(1));}
    else{document.getElementById('featWrap').innerHTML='';buildGrid(d.posts);}
    buildPagi(d.total,d.limit,d.page);
  }catch(e){grid.innerHTML='<div class="st-empty">오류가 발생했습니다</div>';}
}
function buildFeat(posts){
  var fw=document.getElementById('featWrap');
  if(!posts.length){fw.innerHTML='';return;}
  var f=posts[0],sides=posts.slice(1,4);
  var dt=new Date(f.createdAt).toLocaleDateString('ko-KR');
  var th=f.thumbnail?'<img class="feat-img" src="'+f.thumbnail+'" alt="">':'<div class="feat-img-ph">📰</div>';
  var sh=sides.map(function(p){
    var d=new Date(p.createdAt).toLocaleDateString('ko-KR');
    return '<div class="side-card" data-id="'+p.id+'"><div><div class="side-cat">'+p.category+'</div><div class="side-title">'+p.title+'</div></div><div class="side-meta">'+d+'</div></div>';
  }).join('');
  fw.innerHTML='<div class="feat-grid"><div class="feat-main" data-id="'+f.id+'">'+th+'<div class="feat-body"><div class="feat-cat">'+f.category+'</div><div class="feat-title">'+f.title+'</div><div class="feat-desc">'+f.summary+'</div><div class="feat-meta">'+dt+'</div></div></div><div class="feat-side">'+sh+'</div></div>';
}
function buildGrid(posts){
  var grid=document.getElementById('postsGrid');
  if(!posts.length){grid.innerHTML='';return;}
  grid.innerHTML=posts.map(function(p,i){
    var dt=new Date(p.createdAt).toLocaleDateString('ko-KR');
    var num=String(i+2).padStart(2,'0');
    var th=p.thumbnail?'<div class="card-img"><img src="'+p.thumbnail+'" alt=""></div>':'<div class="card-img-ph">📝</div>';
    return '<article class="card" data-id="'+p.id+'" style="animation-delay:'+(i*0.07)+'s"><span class="card-n">'+num+'</span>'+th+'<div class="card-body"><div class="card-cat">'+p.category+'</div><div class="card-title">'+p.title+'</div><div class="card-desc">'+p.summary+'</div><div class="card-foot"><span class="card-date">'+dt+'</span><span class="card-arr">&#8599;</span></div></div></article>';
  }).join('');
}
function buildPagi(total,limit,cur){
  var pages=Math.ceil(total/limit),pg=document.getElementById('pagi');
  if(pages<=1){pg.innerHTML='';return;}
  pg.innerHTML=Array.from({length:pages},function(_,i){
    var p=i+1;
    return '<button class="pg-btn'+(p===cur?' on':'')+'" data-pg="'+p+'">'+p+'</button>';
  }).join('');
}
loadCats();loadPosts();
<\/script></body></html>`;
}

// ── 글 상세 ───────────────────────────────────────────────────
function getPostHTML(cfg, postId) {
  var css = `
.post-wrap{max-width:800px;margin:0 auto;padding:36px 24px}
.back-lnk{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--t2);margin-bottom:28px;transition:color .15s}
.back-lnk:hover{color:var(--ac)}
.post-kicker{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--ac);margin-bottom:14px}
.post-hl{font-size:36px;font-weight:900;line-height:1.15;letter-spacing:-1.5px;margin-bottom:16px;animation:slideUp .5s ease}
.post-byline{display:flex;align-items:center;gap:12px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);padding:14px 0;border-top:1px solid var(--br);border-bottom:2px solid var(--t1);margin-bottom:28px}
.bdot{width:3px;height:3px;border-radius:50%;background:var(--br2)}
.post-hero{width:100%;max-height:500px;object-fit:cover;margin-bottom:28px;display:block}
.post-content{font-size:16px;line-height:1.9}
.post-content h2{font-size:22px;font-weight:900;letter-spacing:-.5px;margin:40px 0 14px;padding-top:16px;border-top:2px solid var(--t1)}
.post-content h3{font-size:18px;font-weight:700;margin:28px 0 12px}
.post-content p{margin-bottom:20px;color:var(--t2)}
.post-content ul,.post-content ol{padding-left:24px;margin-bottom:20px}
.post-content li{margin-bottom:8px;color:var(--t2)}
.post-content img{width:100%;margin:28px 0}
.post-content blockquote{border-left:3px solid var(--ac);padding:14px 20px;margin:28px 0;background:var(--sf)}
.post-content a{color:var(--ac);border-bottom:1px solid rgba(179,255,0,.3)}
.post-tags{margin-top:40px;padding-top:20px;border-top:1px solid var(--br);display:flex;flex-wrap:wrap;gap:6px}
.p-tag{padding:4px 12px;border:1px solid var(--br2);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--t2);transition:all .15s}
.p-tag:hover{border-color:var(--ac);color:var(--ac)}
.p-err{text-align:center;padding:60px;color:var(--t3);font-size:10px;letter-spacing:.1em;text-transform:uppercase}
@media(max-width:768px){.post-hl{font-size:26px}.post-wrap{padding:24px 16px}}`;

  return `<!DOCTYPE html><html lang="ko" data-theme="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${cfg.BLOG_NAME}</title>
<script>(function(){var t=localStorage.getItem('bt')||'dark';document.documentElement.setAttribute('data-theme',t);})()<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.ADSENSE_CLIENT}" crossorigin="anonymous"><\/script>
<style>${commonCSS()}${accentCSS(cfg.accent)}${css}</style></head><body>
${headerHTML(cfg)}
<div class="post-wrap">
  <a href="/" class="back-lnk">&#8592; 목록으로</a>
  ${adUnit(cfg, cfg.ADSENSE_SLOT_TOP)}
  <article id="postBody"><div class="p-err">불러오는 중...</div></article>
  ${adUnit(cfg, cfg.ADSENSE_SLOT_MID)}
  ${adUnit(cfg, cfg.ADSENSE_SLOT_BOTTOM)}
</div>
${footerHTML(cfg)}
<script>
${themeJS()}
var PID="${postId}";
async function loadPost(){
  try{
    var r=await fetch('/api/posts/'+PID),d=await r.json();
    if(!d.ok){document.getElementById('postBody').innerHTML='<div class="p-err">글을 찾을 수 없습니다</div>';return;}
    var p=d.post;
    document.title=p.title+' — ${cfg.BLOG_NAME}';
    var dt=new Date(p.createdAt).toLocaleDateString('ko-KR');
    var vw=(p.views||0).toLocaleString();
    var th=p.thumbnail?'<img class="post-hero" src="'+p.thumbnail+'" alt="">':'';
    var tags='';
    if(p.tags&&p.tags.length)tags='<div class="post-tags">'+p.tags.map(function(t){return '<span class="p-tag">#'+t+'</span>';}).join('')+'</div>';
    document.getElementById('postBody').innerHTML=
      '<div class="post-kicker">'+p.category+'</div>'+
      '<h1 class="post-hl">'+p.title+'</h1>'+
      '<div class="post-byline"><span>'+dt+'</span><span class="bdot"></span><span>조회 '+vw+'</span></div>'+
      th+'<div class="post-content">'+p.content+'</div>'+tags;
  }catch(e){document.getElementById('postBody').innerHTML='<div class="p-err">오류가 발생했습니다</div>';}
}
loadPost();
<\/script></body></html>`;
}

// ── 관리자 페이지 (사이드바 + 색상 설정) ──────────────────────
function getAdminHTML(cfg) {
  var accent = cfg.accent || '#b3ff00';
  var css = `
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg)}
.login-box{background:var(--sf);width:100%;max-width:360px;border-top:3px solid var(--ac)}
.login-hd{padding:24px 28px 18px;border-bottom:1px solid var(--br)}
.login-logo{font-size:15px;font-weight:900;text-transform:uppercase;color:var(--t1)}
.login-logo em{color:var(--ac);font-style:normal}
.login-sub{font-size:10px;color:var(--t2);letter-spacing:.1em;text-transform:uppercase;margin-top:4px}
.login-bd{padding:22px 28px}
.inp{width:100%;padding:10px 12px;border:1px solid var(--br2);background:var(--bg);color:var(--t1);font-size:14px;font-family:inherit;outline:none;transition:border-color .15s;margin-bottom:10px}
.inp:focus{border-color:var(--ac)}
.btn{padding:10px 18px;border:none;cursor:pointer;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-family:inherit;transition:all .15s}
.btn-ac{background:var(--ac);color:var(--act);width:100%}
.btn-ac:hover{opacity:.85}
.btn-ok{background:var(--ac);color:var(--act)}
.btn-ok:hover{opacity:.85}
.btn-gh{background:transparent;color:var(--t2);border:1px solid var(--br2)}
.btn-gh:hover{border-color:var(--t1);color:var(--t1)}
.btn-dl{background:transparent;color:var(--rd);border:1px solid rgba(255,59,59,.3)}
.btn-dl:hover{background:rgba(255,59,59,.1)}
.btn-sm{padding:5px 10px;font-size:9px}
.err-msg{font-size:11px;color:var(--rd);margin-top:8px}
.a-head{background:var(--bg);border-bottom:2px solid var(--ac);position:sticky;top:0;z-index:100;transition:background .3s,border-color .3s}
.a-hi{max-width:100%;padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between}
.a-logo{font-size:14px;font-weight:900;text-transform:uppercase;color:var(--t1)}
.a-logo em{color:var(--ac);font-style:normal}
.a-nav{display:flex;gap:4px;align-items:center}
.a-nav a,.a-nav button{font-size:10px;color:var(--t2);letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;transition:color .15s;background:none;border:none;cursor:pointer;font-family:inherit}
.a-nav a:hover,.a-nav button:hover{color:var(--ac)}
.a-sep{color:var(--br2);margin:0 2px}
.a-body{display:grid;grid-template-columns:210px 1fr;min-height:calc(100vh - 52px)}
.a-sidebar{background:var(--sf);border-right:1px solid var(--br);display:flex;flex-direction:column;transition:background .3s}
.sb-hd{font-size:9px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--ac);padding:14px 16px 12px;border-bottom:1px solid var(--br)}
.sb-add{padding:12px 16px;border-bottom:1px solid var(--br)}
.sb-row{display:flex;gap:6px}
.sb-inp{flex:1;padding:7px 10px;border:1px solid var(--br2);background:var(--bg);color:var(--t1);font-size:12px;font-family:inherit;outline:none;transition:border-color .15s;min-width:0}
.sb-inp:focus{border-color:var(--ac)}
.sb-add-btn{background:var(--ac);color:var(--act);border:none;padding:7px 12px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .15s;flex-shrink:0}
.sb-add-btn:hover{opacity:.8}
.sb-cats{padding:6px 0;flex:1;overflow-y:auto}
.sb-cat{display:flex;align-items:center;padding:9px 16px;gap:8px;cursor:pointer;transition:background .15s;border-left:2px solid transparent}
.sb-cat:hover{background:var(--sf2)}
.sb-cat.cur{background:var(--sf2);border-left-color:var(--ac)}
.sb-cat-name{flex:1;font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sb-cat-acts{display:flex;gap:2px;opacity:0;transition:opacity .15s;flex-shrink:0}
.sb-cat:hover .sb-cat-acts{opacity:1}
.sb-btn{background:transparent;border:none;color:var(--t3);font-size:10px;cursor:pointer;padding:3px 5px;font-family:inherit;transition:color .15s;letter-spacing:.06em}
.sb-btn:hover{color:var(--t1)}
.sb-del:hover{color:var(--rd) !important}
.sb-empty{padding:24px 16px;font-size:11px;color:var(--t3);text-align:center;letter-spacing:.08em;text-transform:uppercase}
.a-main{padding:20px 24px;overflow:auto}
.tab-nav{display:flex;border-bottom:2px solid var(--t1);margin-bottom:20px}
.tab-btn{padding:10px 18px;border:none;background:transparent;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;color:var(--t2);font-family:inherit;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s}
.tab-btn.on{color:var(--t1);border-bottom-color:var(--ac)}
.panel{background:var(--sf);border-top:2px solid var(--t1)}
.p-hd{padding:14px 18px;border-bottom:1px solid var(--br);display:flex;align-items:center;justify-content:space-between}
.p-ttl{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--t1)}
.cnt-badge{background:var(--ac);color:var(--act);font-size:10px;font-weight:800;padding:2px 8px}
.pi{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--br)}
.pi:last-child{border-bottom:none}
.pi-cat{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ac);flex-shrink:0;min-width:56px}
.pi-ttl{flex:1;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.pi-ttl a{color:var(--t1);transition:color .15s}
.pi-ttl a:hover{color:var(--ac)}
.pi-dt{font-size:10px;color:var(--t2);flex-shrink:0;white-space:nowrap}
.pi-acts{display:flex;gap:6px;flex-shrink:0}
.p-empty{padding:48px 20px;text-align:center;color:var(--t3);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.w-panel{background:var(--sf);border-top:2px solid var(--t1);padding:22px}
.w-ttl{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding-bottom:14px;border-bottom:1px solid var(--br);margin-bottom:18px;color:var(--t1)}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.fg2{margin-bottom:12px}
.fl{display:block;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--t2);margin-bottom:6px}
.fi{width:100%;padding:9px 12px;border:1px solid var(--br2);background:var(--bg);color:var(--t1);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.fi:focus{border-color:var(--ac)}
.fta{width:100%;min-height:320px;padding:12px;border:1px solid var(--br2);background:var(--bg);color:var(--t1);font-size:13px;font-family:inherit;resize:vertical;outline:none;line-height:1.8;transition:border-color .15s}
.fta:focus{border-color:var(--ac)}
.f-acts{display:flex;gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid var(--br)}
.set-panel{background:var(--sf);border-top:2px solid var(--t1)}
.set-sec{padding:20px 22px;border-bottom:1px solid var(--br)}
.set-sec-ttl{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ac);margin-bottom:16px}
.color-presets{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.cp{width:34px;height:34px;border-radius:50%;cursor:pointer;transition:transform .15s,box-shadow .15s;border:3px solid transparent;flex-shrink:0}
.cp:hover{transform:scale(1.15)}
.cp.sel{box-shadow:0 0 0 3px var(--t1)}
.accent-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.accent-preview{width:80px;height:36px;border-radius:4px;border:1px solid var(--br2);transition:background .15s}
.fg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px}
.hidden{display:none!important}
@media(max-width:900px){.a-body{grid-template-columns:1fr}.a-sidebar{border-right:none;border-bottom:1px solid var(--br)}.sb-cats{max-height:200px}}
@media(max-width:768px){.fg{grid-template-columns:1fr}.fg3{grid-template-columns:1fr}.pi-dt{display:none}.a-main{padding:16px}}`;

  return `<!DOCTYPE html><html lang="ko" data-theme="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>관리자 — ${cfg.BLOG_NAME}</title>
<script>(function(){var t=localStorage.getItem('bt')||'dark';document.documentElement.setAttribute('data-theme',t);})()<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>${commonCSS()}${accentCSS(accent)}${css}</style></head><body>

<!-- 로그인 화면 -->
<div id="loginWrap" class="login-wrap">
<div class="login-box">
  <div class="login-hd">
    <div class="login-logo"><em>${cfg.BLOG_NAME}</em></div>
    <div class="login-sub">Admin Access</div>
  </div>
  <div class="login-bd">
    <input class="inp" type="password" id="pwInp" placeholder="비밀번호" onkeydown="if(event.key==='Enter')doLogin()">
    <button class="btn btn-ac" onclick="doLogin()">로그인</button>
    <p class="err-msg" id="loginErr"></p>
  </div>
</div>
</div>

<!-- 관리자 본체 -->
<div id="adminWrap" class="hidden">
  <div class="a-head">
    <div class="a-hi">
      <div class="a-logo"><em>${cfg.BLOG_NAME}</em> Admin</div>
      <div class="a-nav">
        <button class="theme-btn" id="themeBtn" onclick="toggleTheme()">☀ LIGHT</button>
        <span class="a-sep">/</span>
        <a href="/" target="_blank">블로그 보기</a>
        <span class="a-sep">/</span>
        <button onclick="doLogout()">로그아웃</button>
      </div>
    </div>
  </div>

  <div class="a-body">
    <!-- 카테고리 사이드바 -->
    <div class="a-sidebar">
      <div class="sb-hd">카테고리</div>
      <div class="sb-add">
        <div class="sb-row">
          <input class="sb-inp" id="newCatInp" placeholder="카테고리 이름" onkeydown="if(event.key==='Enter')addCat()">
          <button class="sb-add-btn" onclick="addCat()">+</button>
        </div>
      </div>
      <div class="sb-cats" id="catList"><div class="sb-empty">불러오는 중...</div></div>
    </div>

    <!-- 메인 영역 -->
    <div class="a-main">
      <div class="tab-nav">
        <button class="tab-btn on" id="tListBtn" onclick="showTab('list')">글 목록</button>
        <button class="tab-btn" id="tWriteBtn" onclick="showTab('write')">글 작성</button>
        <button class="tab-btn" id="tSetBtn" onclick="showTab('settings')">설정</button>
      </div>

      <!-- 글 목록 탭 -->
      <div id="tabList">
        <div class="panel">
          <div class="p-hd"><span class="p-ttl">전체 글</span><span class="cnt-badge" id="pCnt">0</span></div>
          <div id="aPostList"><div class="p-empty">불러오는 중...</div></div>
        </div>
      </div>

      <!-- 글 작성 탭 -->
      <div id="tabWrite" class="hidden">
        <div class="w-panel">
          <div class="w-ttl" id="wTitle">새 글 작성</div>
          <input type="hidden" id="eId">
          <div class="fg">
            <div><label class="fl">제목 *</label><input class="fi" id="pTitle" placeholder="글 제목"></div>
            <div><label class="fl">카테고리</label><input class="fi" id="pCat" list="catDL" placeholder="카테고리 선택"></div>
          </div>
          <datalist id="catDL"></datalist>
          <div class="fg">
            <div><label class="fl">태그 (쉼표 구분)</label><input class="fi" id="pTags" placeholder="태그1, 태그2"></div>
            <div><label class="fl">썸네일 URL</label><input class="fi" id="pThumb" placeholder="https://..."></div>
          </div>
          <div class="fg2"><label class="fl">내용 (HTML 가능)</label><textarea class="fta" id="pContent" placeholder="글 내용을 입력하세요..."></textarea></div>
          <div class="f-acts">
            <button class="btn btn-ok" onclick="savePost()">저장하기</button>
            <button class="btn btn-gh" onclick="clearForm()">초기화</button>
          </div>
        </div>
      </div>

      <!-- 설정 탭 -->
      <div id="tabSettings" class="hidden">
        <div class="set-panel">
          <div class="set-sec">
            <div class="set-sec-ttl">기본 설정</div>
            <div class="fg">
              <div><label class="fl">블로그 이름</label><input class="fi" id="sName" value="${cfg.BLOG_NAME}"></div>
              <div><label class="fl">블로그 설명</label><input class="fi" id="sDesc" value="${cfg.BLOG_DESC}"></div>
            </div>
          </div>
          <div class="set-sec">
            <div class="set-sec-ttl">테마 색상</div>
            <div class="color-presets" id="colorPresets">
              <div class="cp" data-color="#b3ff00" style="background:#b3ff00" title="라임"></div>
              <div class="cp" data-color="#00d4ff" style="background:#00d4ff" title="시안"></div>
              <div class="cp" data-color="#ff6b00" style="background:#ff6b00" title="오렌지"></div>
              <div class="cp" data-color="#ff3b8f" style="background:#ff3b8f" title="핑크"></div>
              <div class="cp" data-color="#7c3aed" style="background:#7c3aed" title="퍼플"></div>
              <div class="cp" data-color="#22c55e" style="background:#22c55e" title="그린"></div>
              <div class="cp" data-color="#f59e0b" style="background:#f59e0b" title="앰버"></div>
              <div class="cp" data-color="#ef4444" style="background:#ef4444" title="레드"></div>
              <div class="cp" data-color="#60a5fa" style="background:#60a5fa" title="블루"></div>
              <div class="cp" data-color="#ffffff" style="background:#fff;border-color:#333" title="화이트"></div>
            </div>
            <div class="accent-row">
              <div><label class="fl">직접 입력</label><input type="color" id="sAccent" value="${accent}"></div>
              <div class="accent-preview" id="accentPreview" style="background:${accent}"></div>
              <div style="font-size:12px;color:var(--t2)" id="accentHex">${accent}</div>
            </div>
          </div>
          <div class="set-sec">
            <div class="set-sec-ttl">애드센스 설정</div>
            <div class="fg2"><label class="fl">Publisher ID (ca-pub-...)</label><input class="fi" id="sAdClient" value="${cfg.ADSENSE_CLIENT}" placeholder="ca-pub-XXXXXXXXXX"></div>
            <div class="fg3">
              <div><label class="fl">상단 슬롯</label><input class="fi" id="sSlotTop" value="${cfg.ADSENSE_SLOT_TOP}"></div>
              <div><label class="fl">중간 슬롯</label><input class="fi" id="sSlotMid" value="${cfg.ADSENSE_SLOT_MID}"></div>
              <div><label class="fl">하단 슬롯</label><input class="fi" id="sSlotBot" value="${cfg.ADSENSE_SLOT_BOTTOM}"></div>
            </div>
          </div>
          <div class="set-sec">
            <div class="set-sec-ttl">웹훅 설정</div>
            <div class="fg2"><label class="fl">Webhook Secret Key</label><input class="fi" id="sWebhook" value="${cfg.WEBHOOK_SECRET}"></div>
          </div>
          <div class="set-sec">
            <div class="set-sec-ttl">비밀번호 변경</div>
            <p style="font-size:12px;color:var(--t2);margin-bottom:14px;line-height:1.7">변경한 비밀번호는 KV에 저장되어 <b style="color:var(--t1)">재배포 후에도 유지</b>됩니다.</p>
            <div class="fg">
              <div><label class="fl">새 비밀번호</label><input class="fi" type="password" id="sNewPw" placeholder="새 비밀번호 입력"></div>
              <div><label class="fl">새 비밀번호 확인</label><input class="fi" type="password" id="sNewPw2" placeholder="다시 입력"></div>
            </div>
          </div>
          <div class="f-acts" style="padding:20px 22px">
            <button class="btn btn-ok" onclick="saveSettings()">저장 및 적용</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
${themeJS()}
var tok=localStorage.getItem('adm_tok')||'';
var filterCat='';

// ── 로그인 / 로그아웃 ──
async function doLogin(){
  var pw=document.getElementById('pwInp').value;
  try{
    var r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    var d=await r.json();
    if(d.ok){tok=d.token;localStorage.setItem('adm_tok',tok);showAdmin();}
    else document.getElementById('loginErr').textContent='비밀번호가 틀렸습니다.';
  }catch(e){document.getElementById('loginErr').textContent='오류가 발생했습니다.';}
}
function doLogout(){localStorage.removeItem('adm_tok');location.reload();}
function showAdmin(){
  document.getElementById('loginWrap').classList.add('hidden');
  document.getElementById('adminWrap').classList.remove('hidden');
  loadCats();loadAPosts();
}

// ── 탭 전환 ──
function showTab(t){
  ['list','write','settings'].forEach(function(x){
    document.getElementById('tListBtn'+(x==='list'?'':x==='write'?'Write':'Set')+'Btn'||'t'+x.charAt(0).toUpperCase()+x.slice(1)+'Btn');
  });
  document.getElementById('tListBtn').classList.toggle('on',t==='list');
  document.getElementById('tWriteBtn').classList.toggle('on',t==='write');
  document.getElementById('tSetBtn').classList.toggle('on',t==='settings');
  document.getElementById('tabList').classList.toggle('hidden',t!=='list');
  document.getElementById('tabWrite').classList.toggle('hidden',t!=='write');
  document.getElementById('tabSettings').classList.toggle('hidden',t!=='settings');
  if(t==='list')loadAPosts();
  if(t==='write')populateCatDatalist();
}

// ── 카테고리 사이드바 ──
async function loadCats(){
  try{
    var r=await fetch('/api/categories'),d=await r.json();
    renderCats(d.categories||[]);
  }catch(e){}
}
function renderCats(cats){
  var el=document.getElementById('catList');
  if(!cats.length){el.innerHTML='<div class="sb-empty">카테고리가 없습니다</div>';return;}
  el.innerHTML=cats.map(function(c){
    return '<div class="sb-cat'+(filterCat===c?' cur':'')+'" data-cat="'+c+'">'+
      '<span class="sb-cat-name">'+c+'</span>'+
      '<div class="sb-cat-acts">'+
        '<button class="sb-btn" data-action="edit" data-name="'+c+'">편집</button>'+
        '<button class="sb-btn sb-del" data-action="del" data-name="'+c+'">삭제</button>'+
      '</div>'+
    '</div>';
  }).join('');
  el.onclick=function(e){
    var btn=e.target.closest('[data-action]');
    if(btn){
      if(btn.dataset.action==='edit')editCat(btn.dataset.name);
      else if(btn.dataset.action==='del')delCat(btn.dataset.name);
      return;
    }
    var card=e.target.closest('.sb-cat[data-cat]');
    if(card){
      filterCat=filterCat===card.dataset.cat?'':card.dataset.cat;
      document.querySelectorAll('.sb-cat').forEach(function(x){x.classList.remove('cur');});
      if(filterCat)card.classList.add('cur');
      loadAPosts();
    }
  };
}
async function addCat(){
  var name=document.getElementById('newCatInp').value.trim();
  if(!name)return;
  var r=await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'add',name:name})});
  var d=await r.json();
  if(d.ok){document.getElementById('newCatInp').value='';renderCats(d.categories);}
}
async function editCat(name){
  var newName=prompt('새 카테고리 이름:',name);
  if(!newName||newName===name)return;
  var r=await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'rename',oldName:name,newName:newName})});
  var d=await r.json();
  if(d.ok){if(filterCat===name)filterCat=newName;renderCats(d.categories);}
}
async function delCat(name){
  if(!confirm(name+' 카테고리를 삭제할까요?'))return;
  var r=await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({action:'delete',name:name})});
  var d=await r.json();
  if(d.ok){if(filterCat===name)filterCat='';renderCats(d.categories);}
}

// ── 글 목록 ──
async function loadAPosts(){
  try{
    var url='/api/posts?limit=100'+(filterCat?'&category='+encodeURIComponent(filterCat):'');
    var r=await fetch(url),d=await r.json();
    document.getElementById('pCnt').textContent=d.total||0;
    var el=document.getElementById('aPostList');
    if(!d.posts||!d.posts.length){el.innerHTML='<div class="p-empty">등록된 글이 없습니다</div>';return;}
    el.innerHTML=d.posts.map(function(p){
      var dt=new Date(p.createdAt).toLocaleDateString('ko-KR');
      return '<div class="pi"><span class="pi-cat">'+p.category+'</span><div class="pi-ttl"><a href="/post/'+p.id+'" target="_blank">'+p.title+'</a></div><span class="pi-dt">'+dt+'</span><div class="pi-acts"><button class="btn btn-gh btn-sm" data-action="edit" data-id="'+p.id+'">수정</button><button class="btn btn-dl btn-sm" data-action="del" data-id="'+p.id+'">삭제</button></div></div>';
    }).join('');
    el.onclick=function(e){
      var b=e.target.closest('button[data-action]');if(!b)return;
      if(b.dataset.action==='edit')editPost(b.dataset.id);
      else if(b.dataset.action==='del')delPost(b.dataset.id);
    };
  }catch(e){}
}
async function editPost(id){
  var r=await fetch('/api/posts/'+id),d=await r.json(),p=d.post;
  document.getElementById('eId').value=p.id;
  document.getElementById('pTitle').value=p.title;
  document.getElementById('pCat').value=p.category;
  document.getElementById('pTags').value=(p.tags||[]).join(', ');
  document.getElementById('pThumb').value=p.thumbnail||'';
  document.getElementById('pContent').value=p.content;
  document.getElementById('wTitle').textContent='글 수정';
  showTab('write');
}
async function savePost(){
  var title=document.getElementById('pTitle').value;
  if(!title){alert('제목을 입력하세요');return;}
  var body={
    id:document.getElementById('eId').value||undefined,
    title:title,category:document.getElementById('pCat').value||'일반',
    tags:document.getElementById('pTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean),
    thumbnail:document.getElementById('pThumb').value,
    content:document.getElementById('pContent').value,
  };
  var r=await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body)});
  var d=await r.json();
  if(d.ok){alert('저장했습니다.');clearForm();showTab('list');}
  else alert('오류: '+(d.error||'알 수 없는 오류'));
}
async function delPost(id){
  if(!confirm('이 글을 삭제할까요?'))return;
  await fetch('/api/posts/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+tok}});
  loadAPosts();
}
function clearForm(){
  ['eId','pTitle','pCat','pTags','pThumb','pContent'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('wTitle').textContent='새 글 작성';
}
async function populateCatDatalist(){
  try{
    var r=await fetch('/api/categories'),d=await r.json();
    var dl=document.getElementById('catDL');
    dl.innerHTML=(d.categories||[]).map(function(c){return '<option value="'+c+'">';}).join('');
  }catch(e){}
}

// ── 색상 설정 ──
function isLight(hex){
  var h=hex.replace('#','');
  var r=parseInt(h.substr(0,2),16)||0,g=parseInt(h.substr(2,2),16)||0,b=parseInt(h.substr(4,2),16)||0;
  return (0.299*r+0.587*g+0.114*b)/255>0.5;
}
function applyAccent(color){
  document.documentElement.style.setProperty('--ac',color);
  document.documentElement.style.setProperty('--act',isLight(color)?'#000':'#fff');
  document.getElementById('accentPreview').style.background=color;
  document.getElementById('accentHex').textContent=color;
  document.getElementById('sAccent').value=color;
  document.querySelectorAll('.cp').forEach(function(el){el.classList.toggle('sel',el.dataset.color===color);});
}
document.getElementById('colorPresets').addEventListener('click',function(e){
  var cp=e.target.closest('.cp[data-color]');if(!cp)return;
  applyAccent(cp.dataset.color);
});
document.getElementById('sAccent').addEventListener('input',function(){
  applyAccent(this.value);
});
// 초기 선택 표시
(function(){
  var cur='${accent}';
  document.querySelectorAll('.cp').forEach(function(el){el.classList.toggle('sel',el.dataset.color===cur);});
}());

async function saveSettings(){
  var pw1=document.getElementById('sNewPw').value;
  var pw2=document.getElementById('sNewPw2').value;
  if(pw1||pw2){
    if(pw1!==pw2){alert('비밀번호가 일치하지 않습니다.');return;}
    if(pw1.length<4){alert('비밀번호는 4자 이상으로 설정해주세요.');return;}
  }
  var body={
    name:document.getElementById('sName').value,
    desc:document.getElementById('sDesc').value,
    accent:document.getElementById('sAccent').value,
    adClient:document.getElementById('sAdClient').value,
    slotTop:document.getElementById('sSlotTop').value,
    slotMid:document.getElementById('sSlotMid').value,
    slotBottom:document.getElementById('sSlotBot').value,
    webhook:document.getElementById('sWebhook').value,
  };
  if(pw1)body.password=pw1;
  var r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body)});
  var d=await r.json();
  if(d.ok){
    if(pw1){
      alert('저장했습니다.\n비밀번호가 변경되었습니다. 다시 로그인해주세요.');
      localStorage.removeItem('adm_tok');
      location.reload();
    } else {
      alert('저장했습니다. 블로그에 즉시 반영됩니다.');
      location.reload();
    }
  } else alert('오류: '+(d.error||'저장 실패'));
}

if(tok)showAdmin();
<\/script></body></html>`;
}

// ── 이용약관 / 개인정보처리방침 ───────────────────────────────
function getTermsHTML(cfg) {
  var year=new Date().getFullYear();
  var css='.doc{max-width:780px;margin:0 auto;padding:48px 24px}.dk{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--ac);margin-bottom:12px}.dh{font-size:32px;font-weight:900;letter-spacing:-1px;margin-bottom:8px}.dd{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;padding-bottom:20px;border-bottom:2px solid var(--t1);margin-bottom:32px}h2{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin:32px 0 12px;padding-top:20px;border-top:1px solid var(--br);color:var(--t1)}p,li{font-size:15px;line-height:1.9;margin-bottom:12px;color:var(--t2)}ul{padding-left:20px}';
  return '<!DOCTYPE html><html lang="ko" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>이용약관 — '+cfg.BLOG_NAME+'</title><script>(function(){var t=localStorage.getItem("bt")||"dark";document.documentElement.setAttribute("data-theme",t);})()\<\/script><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet"><style>'+commonCSS()+accentCSS(cfg.accent)+css+'</style></head><body>'+headerHTML(cfg)+'<div class="doc"><p class="dk">Legal</p><h1 class="dh">이용약관</h1><p class="dd">시행일: '+year+'년 1월 1일</p><h2>제1조 (목적)</h2><p>본 약관은 '+cfg.BLOG_NAME+'이 제공하는 서비스의 이용과 관련하여 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p><h2>제2조 (서비스 이용)</h2><ul><li>모든 콘텐츠의 저작권은 블로그 운영자에게 있습니다.</li><li>콘텐츠를 무단으로 복제, 배포, 수정하는 행위를 금지합니다.</li></ul><h2>제3조 (면책조항)</h2><p>제공하는 정보는 일반적인 참고용으로만 제공됩니다.</p><h2>제4조 (광고)</h2><p>본 블로그는 Google AdSense 광고 서비스를 운영합니다.</p><h2>제5조 (약관 변경)</h2><p>필요한 경우 약관을 변경할 수 있으며 블로그에 공지합니다.</p></div>'+footerHTML(cfg)+'<script>'+themeJS()+'<\/script></body></html>';
}

function getPrivacyHTML(cfg) {
  var year=new Date().getFullYear();
  var css='.doc{max-width:780px;margin:0 auto;padding:48px 24px}.dk{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--ac);margin-bottom:12px}.dh{font-size:32px;font-weight:900;letter-spacing:-1px;margin-bottom:8px}.dd{font-size:10px;color:var(--t3);letter-spacing:.06em;text-transform:uppercase;padding-bottom:20px;border-bottom:2px solid var(--t1);margin-bottom:32px}h2{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin:32px 0 12px;padding-top:20px;border-top:1px solid var(--br);color:var(--t1)}p,li{font-size:15px;line-height:1.9;margin-bottom:12px;color:var(--t2)}ul{padding-left:20px}a{color:var(--ac)}';
  return '<!DOCTYPE html><html lang="ko" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>개인정보처리방침 — '+cfg.BLOG_NAME+'</title><script>(function(){var t=localStorage.getItem("bt")||"dark";document.documentElement.setAttribute("data-theme",t);})()\<\/script><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet"><style>'+commonCSS()+accentCSS(cfg.accent)+css+'</style></head><body>'+headerHTML(cfg)+'<div class="doc"><p class="dk">Legal</p><h1 class="dh">개인정보처리방침</h1><p class="dd">시행일: '+year+'년 1월 1일</p><p>'+cfg.BLOG_NAME+'은 이용자의 개인정보를 중요시합니다.</p><h2>1. 수집하는 개인정보</h2><ul><li>방문 기록, IP 주소, 브라우저 종류</li><li>서비스 이용 기록 및 접속 로그</li></ul><h2>2. 수집 목적</h2><ul><li>서비스 제공 및 운영</li><li>광고 서비스 제공 (Google AdSense)</li></ul><h2>3. Google AdSense 및 쿠키</h2><p><a href="https://www.google.com/settings/ads" target="_blank">Google 광고 설정</a>에서 맞춤 광고를 비활성화할 수 있습니다.</p><h2>4. 보유 기간</h2><p>목적 달성 후 즉시 파기합니다.</p></div>'+footerHTML(cfg)+'<script>'+themeJS()+'<\/script></body></html>';
}
