// ============================================================
//  블로그 설정 (분양시 이것만 수정)
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
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (path.startsWith("/api/")) return handleAPI(request, env, path, cors);
    if (path === "/" || path === "/index.html") return html(getIndexHTML());
    if (path.startsWith("/post/")) return html(getPostHTML(path.replace("/post/", "")));
    if (path === "/admin" || path === "/admin.html") return html(getAdminHTML());
    if (path === "/terms") return html(getTermsHTML());
    if (path === "/privacy") return html(getPrivacyHTML());
    if (path === "/sitemap.xml") return serveSitemap(env);
    if (path === "/robots.txt") return serveRobots(request);
    return new Response("Not Found", { status: 404 });
  }
};

function html(body) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleAPI(request, env, path, cors) {
  const headers = { ...cors, "Content-Type": "application/json" };

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

  if (path.startsWith("/api/posts/") && request.method === "GET") {
    const id = path.replace("/api/posts/", "");
    const post = await env.BLOG_KV.get("post:" + id);
    if (!post) return new Response(JSON.stringify({ ok: false, error: "없음" }), { status: 404, headers });
    const data = JSON.parse(post);
    data.views = (data.views || 0) + 1;
    await env.BLOG_KV.put("post:" + id, JSON.stringify(data));
    return new Response(JSON.stringify({ ok: true, post: data }), { headers });
  }

  if (path === "/api/posts" && request.method === "POST") {
    if (!checkAuth(request)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
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

  if (path.startsWith("/api/posts/") && request.method === "DELETE") {
    if (!checkAuth(request)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
    const id = path.replace("/api/posts/", "");
    await env.BLOG_KV.delete("post:" + id);
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    list = list.filter(p => p.id !== id);
    await env.BLOG_KV.put("post_list", JSON.stringify(list));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  if (path === "/api/webhook" && request.method === "POST") {
    const secret = request.headers.get("X-API-Key") || (request.headers.get("Authorization") || "").replace("Bearer ", "");
    if (secret !== CONFIG.WEBHOOK_SECRET) return new Response(JSON.stringify({ ok: false, error: "인증 실패" }), { status: 401, headers });
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

  if (path === "/api/categories" && request.method === "GET") {
    const listRaw = await env.BLOG_KV.get("post_list");
    const list = listRaw ? JSON.parse(listRaw) : [];
    const cats = [...new Set(list.map(p => p.category))];
    return new Response(JSON.stringify({ ok: true, categories: cats }), { headers });
  }

  if (path === "/api/login" && request.method === "POST") {
    const body = await request.json();
    if (body.password === CONFIG.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ ok: true, token: btoa(CONFIG.ADMIN_PASSWORD) }), { headers });
    }
    return new Response(JSON.stringify({ ok: false, error: "비밀번호 틀림" }), { status: 401, headers });
  }

  if (path === "/api/config" && request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, blogName: CONFIG.BLOG_NAME, blogDesc: CONFIG.BLOG_DESC }), { headers });
  }

  return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
}

function checkAuth(request) {
  return (request.headers.get("Authorization") || "") === ("Bearer " + btoa(CONFIG.ADMIN_PASSWORD));
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

// ── 공통 CSS (Bloomberg 스타일) ──────────────────────────────
function commonCSS() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --black: #000000;
      --white: #ffffff;
      --orange: #ff8000;
      --red: #d9142b;
      --text: #1a1a1a;
      --text-muted: #666666;
      --text-light: #999999;
      --border: #e0e0e0;
      --border-dark: #cccccc;
      --bg: #f5f5f5;
      --bg-card: #ffffff;
    }
    html { scroll-behavior: smooth; }
    body { font-family: 'Noto Sans KR', 'Helvetica Neue', Arial, sans-serif; color: var(--text); background: var(--bg); line-height: 1.6; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; height: auto; display: block; }

    /* ── 상단 알림바 ── */
    .ticker-bar {
      background: var(--black);
      color: rgba(255,255,255,0.55);
      font-size: 11px;
      letter-spacing: 0.04em;
      padding: 6px 0;
      border-bottom: 1px solid #222;
      overflow: hidden;
    }
    .ticker-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .ticker-label {
      background: var(--orange);
      color: var(--black);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      padding: 2px 8px;
      flex-shrink: 0;
    }
    .ticker-text { white-space: nowrap; }

    /* ── 헤더 ── */
    header {
      background: var(--black);
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 3px solid var(--orange);
    }
    .header-top {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .blog-logo {
      font-size: 22px;
      font-weight: 700;
      color: var(--white);
      letter-spacing: -0.5px;
      text-transform: uppercase;
    }
    .blog-logo span { color: var(--orange); }
    .header-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .header-right a {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      color: rgba(255,255,255,0.6);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      transition: color 0.15s;
    }
    .header-right a:hover { color: var(--orange); }

    /* ── 광고 ── */
    .ad-wrap {
      background: #f9f9f9;
      border: 1px dashed #ccc;
      padding: 10px;
      text-align: center;
      margin: 20px 0;
      min-height: 90px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #aaa;
      font-size: 11px;
      letter-spacing: 0.06em;
    }

    /* ── 푸터 ── */
    footer {
      background: var(--black);
      color: rgba(255,255,255,0.35);
      padding: 40px 24px 28px;
      margin-top: 60px;
      border-top: 3px solid var(--orange);
    }
    .footer-inner {
      max-width: 1280px;
      margin: 0 auto;
    }
    .footer-logo {
      font-size: 18px;
      font-weight: 700;
      color: var(--white);
      text-transform: uppercase;
      letter-spacing: -0.3px;
      margin-bottom: 20px;
    }
    .footer-logo span { color: var(--orange); }
    .footer-divider {
      border: none;
      border-top: 1px solid #222;
      margin: 20px 0;
    }
    .footer-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .footer-links {
      display: flex;
      gap: 20px;
    }
    .footer-links a {
      font-size: 11px;
      color: rgba(255,255,255,0.35);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      transition: color 0.15s;
    }
    .footer-links a:hover { color: var(--orange); }
    .footer-copy { font-size: 11px; letter-spacing: 0.04em; }

    @media (max-width: 768px) {
      .header-top { padding: 0 16px; height: 48px; }
      .blog-logo { font-size: 17px; }
      .footer-bottom { flex-direction: column; gap: 8px; }
    }
  `;
}

function adUnit(slot) {
  return '<div class="ad-wrap"><ins class="adsbygoogle" style="display:block" data-ad-client="' + CONFIG.ADSENSE_CLIENT + '" data-ad-slot="' + slot + '" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script></div>';
}

function footerHTML() {
  const year = new Date().getFullYear();
  const name = CONFIG.BLOG_NAME;
  return '<footer><div class="footer-inner"><div class="footer-logo">' + name + '</div><hr class="footer-divider"><div class="footer-bottom"><div class="footer-links"><a href="/">홈</a><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a></div><p class="footer-copy">&copy; ' + year + ' ' + name + '. All rights reserved.</p></div></div></footer>';
}

function headerHTML(extra) {
  extra = extra || '';
  return '<div class="ticker-bar"><div class="ticker-inner"><span class="ticker-label">LIVE</span><span class="ticker-text">' + CONFIG.BLOG_NAME + ' &mdash; ' + CONFIG.BLOG_DESC + '</span></div></div><header><div class="header-top"><a href="/" class="blog-logo">' + CONFIG.BLOG_NAME + '</a><div class="header-right"><a href="/">홈</a>' + extra + '</div></div></header>';
}

// ── 메인 페이지 ──────────────────────────────────────────────
function getIndexHTML() {
  const css = `
    .page-wrap { max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
    .section-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 3px solid var(--black);
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
      margin-bottom: 24px;
    }
    .section-bar-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .cat-tabs {
      display: flex;
      gap: 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .cat-tabs::-webkit-scrollbar { display: none; }
    .cat-btn {
      padding: 7px 16px;
      border: none;
      border-right: 1px solid var(--border);
      background: transparent;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      color: var(--text-muted);
      white-space: nowrap;
      font-family: 'Noto Sans KR', sans-serif;
      transition: background 0.1s, color 0.1s;
    }
    .cat-btn:first-child { border-left: 1px solid var(--border); }
    .cat-btn.active { background: var(--black); color: var(--white); }
    .cat-btn:hover:not(.active) { background: var(--bg); color: var(--text); }

    /* 피처드 레이아웃 */
    .featured-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      margin-bottom: 1px;
    }
    .featured-main {
      background: var(--white);
      position: relative;
      cursor: pointer;
    }
    .featured-main:hover .featured-title { color: var(--orange); }
    .featured-img {
      width: 100%;
      height: 340px;
      object-fit: cover;
      display: block;
    }
    .featured-img-ph {
      width: 100%;
      height: 340px;
      background: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: #333;
    }
    .featured-body { padding: 20px 24px 24px; }
    .featured-cat {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--orange);
      margin-bottom: 10px;
    }
    .featured-title {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.35;
      letter-spacing: -0.3px;
      transition: color 0.15s;
      margin-bottom: 10px;
    }
    .featured-summary {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.7;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .featured-meta {
      margin-top: 14px;
      font-size: 11px;
      color: var(--text-light);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .featured-sidebar {
      background: var(--white);
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .side-card {
      background: var(--white);
      padding: 16px 20px;
      cursor: pointer;
      flex: 1;
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
    }
    .side-card:last-child { border-bottom: none; }
    .side-card:hover { background: #fafafa; }
    .side-card:hover .side-title { color: var(--orange); }
    .side-cat {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--orange);
      margin-bottom: 6px;
    }
    .side-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.4;
      letter-spacing: -0.2px;
      transition: color 0.15s;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .side-meta {
      margin-top: 8px;
      font-size: 10px;
      color: var(--text-light);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* 일반 글 목록 */
    .posts-list { background: var(--border); display: flex; flex-direction: column; gap: 1px; }
    .post-row {
      background: var(--white);
      display: grid;
      grid-template-columns: 1fr 160px;
      gap: 0;
      cursor: pointer;
      transition: background 0.1s;
    }
    .post-row:hover { background: #fafafa; }
    .post-row:hover .pr-title { color: var(--orange); }
    .pr-body { padding: 18px 20px; }
    .pr-cat {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--orange);
      margin-bottom: 6px;
    }
    .pr-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.4;
      letter-spacing: -0.2px;
      margin-bottom: 6px;
      transition: color 0.15s;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pr-summary {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pr-meta {
      margin-top: 10px;
      font-size: 10px;
      color: var(--text-light);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .pr-thumb {
      width: 160px;
      height: 110px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .pr-thumb-ph {
      width: 160px;
      height: 110px;
      background: #eee;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      color: #ccc;
      flex-shrink: 0;
    }

    /* 페이지네이션 */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      margin-top: 32px;
    }
    .page-btn {
      width: 36px;
      height: 36px;
      border: 1px solid var(--border);
      background: var(--white);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.04em;
      font-family: 'Noto Sans KR', sans-serif;
      transition: all 0.1s;
      color: var(--text-muted);
    }
    .page-btn.active { background: var(--black); color: var(--white); border-color: var(--black); }
    .page-btn:hover:not(.active) { border-color: var(--orange); color: var(--orange); }

    .empty { text-align: center; padding: 80px 20px; color: var(--text-light); background: var(--white); }
    .empty-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; }

    @media (max-width: 900px) {
      .featured-grid { grid-template-columns: 1fr; }
      .featured-sidebar { flex-direction: row; overflow-x: auto; }
      .side-card { min-width: 200px; }
    }
    @media (max-width: 600px) {
      .post-row { grid-template-columns: 1fr; }
      .pr-thumb, .pr-thumb-ph { width: 100%; height: 180px; }
      .featured-img, .featured-img-ph { height: 220px; }
    }
  `;

  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${CONFIG.BLOG_NAME}</title>
<meta name="description" content="${CONFIG.BLOG_DESC}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CONFIG.ADSENSE_CLIENT}" crossorigin="anonymous"><\/script>
<style>${commonCSS()}${css}</style>
</head><body>
${headerHTML('<a href="/admin">관리</a>')}
<div class="page-wrap">
  ${adUnit(CONFIG.ADSENSE_SLOT_TOP)}
  <div class="section-bar">
    <span class="section-bar-title">최신 뉴스</span>
  </div>
  <div class="cat-tabs" id="catTabs">
    <button class="cat-btn active" data-cat="">전체</button>
  </div>
  <div id="mainContent"><div class="empty"><p class="empty-label">불러오는 중...</p></div></div>
  <div class="pagination" id="pagination"></div>
  ${adUnit(CONFIG.ADSENSE_SLOT_BOTTOM)}
</div>
${footerHTML()}
<script>
var curPage=1,curCat='';
async function loadCats(){
  try{
    var r=await fetch('/api/categories'),d=await r.json();
    var tabs=document.getElementById('catTabs');
    (d.categories||[]).forEach(function(c){
      var b=document.createElement('button');
      b.className='cat-btn';b.textContent=c;b.dataset.cat=c;
      b.onclick=function(){filterCat(c,b);};
      tabs.appendChild(b);
    });
  }catch(e){}
}
async function loadPosts(page,cat){
  page=page||1;
  cat=cat===undefined?curCat:cat;
  curPage=page;curCat=cat;
  var mc=document.getElementById('mainContent');
  mc.innerHTML='<div class="empty"><p class="empty-label">불러오는 중...</p></div>';
  try{
    var r=await fetch('/api/posts?page='+page+'&category='+encodeURIComponent(cat)),d=await r.json();
    if(!d.posts||!d.posts.length){
      mc.innerHTML='<div class="empty"><p class="empty-label">등록된 글이 없습니다</p></div>';
      document.getElementById('pagination').innerHTML='';
      return;
    }
    var html='';
    var featured=d.posts[0];
    var rest=d.posts.slice(1);
    var fThumb=featured.thumbnail
      ?'<img class="featured-img" src="'+featured.thumbnail+'" alt="'+featured.title+'" loading="lazy">'
      :'<div class="featured-img-ph">&#128240;</div>';
    var fDate=new Date(featured.createdAt).toLocaleDateString('ko-KR');
    html+='<div class="featured-grid"><div class="featured-main" onclick="location.href=\'/post/'+featured.id+'\'">'+fThumb+'<div class="featured-body"><span class="featured-cat">'+featured.category+'</span><div class="featured-title">'+featured.title+'</div><div class="featured-summary">'+featured.summary+'</div><div class="featured-meta">'+fDate+'</div></div></div>';
    if(rest.length){
      html+='<div class="featured-sidebar">';
      rest.slice(0,3).forEach(function(p){
        var d2=new Date(p.createdAt).toLocaleDateString('ko-KR');
        html+='<div class="side-card" onclick="location.href=\'/post/'+p.id+'\'"><div class="side-cat">'+p.category+'</div><div class="side-title">'+p.title+'</div><div class="side-meta">'+d2+'</div></div>';
      });
      html+='</div>';
    }
    html+='</div>';
    if(rest.length>3){
      html+='<div class="posts-list">';
      rest.slice(3).forEach(function(p){
        var d2=new Date(p.createdAt).toLocaleDateString('ko-KR');
        var thumb=p.thumbnail
          ?'<img class="pr-thumb" src="'+p.thumbnail+'" alt="'+p.title+'" loading="lazy">'
          :'<div class="pr-thumb-ph">&#128240;</div>';
        html+='<div class="post-row" onclick="location.href=\'/post/'+p.id+'\'"><div class="pr-body"><div class="pr-cat">'+p.category+'</div><div class="pr-title">'+p.title+'</div><div class="pr-summary">'+p.summary+'</div><div class="pr-meta">'+d2+'</div></div>'+thumb+'</div>';
      });
      html+='</div>';
    }
    mc.innerHTML=html;
    renderPagination(d.total,d.limit,page);
  }catch(e){
    mc.innerHTML='<div class="empty"><p class="empty-label">오류가 발생했습니다</p></div>';
  }
}
function filterCat(cat,btn){
  curCat=cat;
  document.querySelectorAll('.cat-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  loadPosts(1,cat);
}
function renderPagination(total,limit,cur){
  var pages=Math.ceil(total/limit),pg=document.getElementById('pagination');
  pg.innerHTML='';
  if(pages<=1)return;
  for(var i=1;i<=pages;i++){
    var b=document.createElement('button');
    b.className='page-btn'+(i===cur?' active':'');
    b.textContent=i;
    (function(i){b.onclick=function(){loadPosts(i,curCat);};})(i);
    pg.appendChild(b);
  }
}
loadCats();loadPosts();
<\/script>
</body></html>`;
}

// ── 글 상세 페이지 ───────────────────────────────────────────
function getPostHTML(postId) {
  const css = `
    .post-wrap { max-width: 1280px; margin: 0 auto; padding: 32px 24px; display: grid; grid-template-columns: 1fr 300px; gap: 32px; }
    .post-main {}
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 24px;
      transition: color 0.15s;
    }
    .back-link:hover { color: var(--orange); }
    .post-cat-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--orange);
      margin-bottom: 14px;
    }
    .post-headline {
      font-size: 32px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.5px;
      margin-bottom: 16px;
    }
    .post-byline {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 0;
      border-top: 1px solid var(--border);
      border-bottom: 3px solid var(--black);
      margin-bottom: 24px;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-light);
    }
    .byline-sep { color: var(--border-dark); }
    .post-hero { width: 100%; max-height: 500px; object-fit: cover; margin-bottom: 28px; display: block; }
    .post-content { font-size: 16px; line-height: 1.9; color: #1a1a1a; }
    .post-content h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; margin: 40px 0 14px; padding-top: 16px; border-top: 3px solid var(--black); }
    .post-content h3 { font-size: 18px; font-weight: 700; margin: 30px 0 12px; }
    .post-content p { margin-bottom: 20px; }
    .post-content ul, .post-content ol { padding-left: 24px; margin-bottom: 20px; }
    .post-content li { margin-bottom: 8px; }
    .post-content img { width: 100%; margin: 28px 0; }
    .post-content blockquote {
      border-left: 4px solid var(--orange);
      padding: 14px 20px;
      margin: 28px 0;
      background: #fffbf5;
      font-style: italic;
      color: var(--text-muted);
    }
    .post-content a { color: var(--orange); border-bottom: 1px solid rgba(255,128,0,0.3); }
    .post-content a:hover { border-color: var(--orange); }
    .post-tags {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tag {
      padding: 4px 12px;
      border: 1px solid var(--border-dark);
      font-size: 11px;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .post-sidebar {}
    .sidebar-section {
      border-top: 3px solid var(--black);
      margin-bottom: 28px;
    }
    .sidebar-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 0;
    }
    @media (max-width: 900px) {
      .post-wrap { grid-template-columns: 1fr; }
      .post-sidebar { display: none; }
      .post-headline { font-size: 24px; }
    }
  `;

  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${CONFIG.BLOG_NAME}</title>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CONFIG.ADSENSE_CLIENT}" crossorigin="anonymous"><\/script>
<style>${commonCSS()}${css}</style>
</head><body>
${headerHTML()}
<div class="post-wrap">
  <div class="post-main">
    <a href="/" class="back-link">&larr; 목록으로</a>
    ${adUnit(CONFIG.ADSENSE_SLOT_TOP)}
    <article id="postArticle">
      <div class="empty" style="padding:80px 0;background:none;"><p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#aaa;">불러오는 중...</p></div>
    </article>
    <div id="adMid"></div>
    ${adUnit(CONFIG.ADSENSE_SLOT_BOTTOM)}
  </div>
  <aside class="post-sidebar">
    <div class="sidebar-section">
      <div class="sidebar-title">관련 정보</div>
    </div>
  </aside>
</div>
${footerHTML()}
<script>
var POST_ID='${postId}';
async function loadPost(){
  try{
    var r=await fetch('/api/posts/'+POST_ID),d=await r.json();
    if(!d.ok){
      document.getElementById('postArticle').innerHTML='<div style="text-align:center;padding:80px 0;color:#aaa;font-size:11px;letter-spacing:.1em;text-transform:uppercase;">글을 찾을 수 없습니다</div>';
      return;
    }
    var p=d.post;
    document.title=p.title+' — ${CONFIG.BLOG_NAME}';
    document.getElementById('adMid').innerHTML='${adUnit(CONFIG.ADSENSE_SLOT_MID)}';
    var thumb=p.thumbnail?'<img class="post-hero" src="'+p.thumbnail+'" alt="'+p.title+'">':'';
    var tags=p.tags&&p.tags.length?'<div class="post-tags">'+p.tags.map(function(t){return '<span class="tag">#'+t+'</span>';}).join('')+'</div>':'';
    var date=new Date(p.createdAt).toLocaleDateString('ko-KR');
    var views=(p.views||0).toLocaleString();
    document.getElementById('postArticle').innerHTML=
      '<div class="post-cat-label">'+p.category+'</div>'+
      '<h1 class="post-headline">'+p.title+'</h1>'+
      '<div class="post-byline">'+
        '<span>'+date+'</span>'+
        '<span class="byline-sep">/</span>'+
        '<span>조회 '+views+'</span>'+
      '</div>'+
      thumb+
      '<div class="post-content">'+p.content+'</div>'+
      tags;
  }catch(e){
    document.getElementById('postArticle').innerHTML='<div style="text-align:center;padding:80px 0;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.1em;">오류가 발생했습니다</div>';
  }
}
loadPost();
<\/script>
</body></html>`;
}

// ── 관리자 페이지 (레이아웃 완전 수정) ──────────────────────
function getAdminHTML() {
  const css = `
    body { background: #f0f0f0; }

    /* 로그인 */
    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--black); }
    .login-box { background: var(--white); width: 100%; max-width: 380px; padding: 0; border-top: 4px solid var(--orange); }
    .login-header { padding: 28px 32px 20px; border-bottom: 1px solid var(--border); }
    .login-logo { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .login-logo span { color: var(--orange); }
    .login-sub { font-size: 11px; color: var(--text-light); letter-spacing: 0.06em; text-transform: uppercase; }
    .login-body { padding: 24px 32px 28px; }
    .input {
      width: 100%;
      padding: 11px 14px;
      border: 1px solid var(--border-dark);
      background: var(--white);
      font-size: 14px;
      font-family: 'Noto Sans KR', sans-serif;
      outline: none;
      transition: border-color 0.15s;
      margin-bottom: 12px;
      border-radius: 0;
    }
    .input:focus { border-color: var(--black); }
    .btn {
      padding: 11px 20px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-family: 'Noto Sans KR', sans-serif;
      transition: all 0.15s;
      border-radius: 0;
    }
    .btn-primary { background: var(--black); color: var(--white); width: 100%; }
    .btn-primary:hover { background: #222; }
    .btn-orange { background: var(--orange); color: var(--black); }
    .btn-orange:hover { background: #e67300; }
    .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border-dark); }
    .btn-ghost:hover { border-color: var(--black); color: var(--text); }
    .btn-del { background: transparent; color: #cc0000; border: 1px solid #ecc; }
    .btn-del:hover { background: #fef2f2; border-color: #cc0000; }
    .btn-sm { padding: 6px 12px; font-size: 11px; }
    .err-msg { font-size: 12px; color: #cc0000; margin-top: 8px; letter-spacing: 0.04em; }

    /* 관리자 레이아웃 */
    .admin-header {
      background: var(--black);
      border-bottom: 3px solid var(--orange);
    }
    .admin-header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .admin-logo { font-size: 15px; font-weight: 700; color: var(--white); text-transform: uppercase; letter-spacing: 0.05em; }
    .admin-logo span { color: var(--orange); }
    .admin-nav { display: flex; gap: 4px; align-items: center; }
    .admin-nav a { font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 10px; transition: color 0.15s; }
    .admin-nav a:hover { color: var(--orange); }
    .admin-nav .nav-sep { color: #333; }

    .admin-wrap { max-width: 1200px; margin: 0 auto; padding: 28px 24px; }
    .tab-nav {
      display: flex;
      gap: 0;
      border-bottom: 2px solid var(--black);
      margin-bottom: 24px;
    }
    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: transparent;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      color: var(--text-light);
      font-family: 'Noto Sans KR', sans-serif;
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
      transition: all 0.15s;
    }
    .tab-btn.active { color: var(--black); border-bottom-color: var(--orange); }
    .tab-btn:hover:not(.active) { color: var(--text); }

    /* 글 목록 패널 */
    .panel { background: var(--white); border-top: 3px solid var(--black); }
    .panel-head {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .count-badge {
      background: var(--orange);
      color: var(--black);
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      letter-spacing: 0.06em;
    }

    /* 글 목록 아이템 - flexbox로 수정 */
    .post-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 13px 20px;
      border-bottom: 1px solid var(--border);
    }
    .post-item:last-child { border-bottom: none; }
    .pi-cat {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--orange);
      flex-shrink: 0;
      min-width: 60px;
    }
    .pi-title {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .pi-title a { color: var(--text); transition: color 0.15s; }
    .pi-title a:hover { color: var(--orange); }
    .pi-date {
      font-size: 11px;
      color: var(--text-light);
      letter-spacing: 0.04em;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .pi-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .empty-state {
      padding: 60px 20px;
      text-align: center;
      color: var(--text-light);
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    /* 글 작성 폼 */
    .write-panel { background: var(--white); border-top: 3px solid var(--black); padding: 24px; }
    .write-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border-dark);
      background: var(--white);
      font-size: 14px;
      font-family: 'Noto Sans KR', sans-serif;
      outline: none;
      transition: border-color 0.15s;
      border-radius: 0;
    }
    .form-input:focus { border-color: var(--black); }
    .form-textarea {
      width: 100%;
      min-height: 340px;
      padding: 14px;
      border: 1px solid var(--border-dark);
      background: var(--white);
      font-size: 14px;
      font-family: 'Noto Sans KR', sans-serif;
      outline: none;
      resize: vertical;
      line-height: 1.8;
      transition: border-color 0.15s;
      border-radius: 0;
    }
    .form-textarea:focus { border-color: var(--black); }
    .form-actions { display: flex; gap: 10px; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
    .hidden { display: none !important; }

    @media (max-width: 768px) {
      .form-grid { grid-template-columns: 1fr; }
      .pi-date { display: none; }
      .admin-wrap { padding: 20px 16px; }
    }
  `;

  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>관리자 — ${CONFIG.BLOG_NAME}</title>
<style>${commonCSS()}${css}</style>
</head><body>

<div id="loginWrap" class="login-wrap">
  <div class="login-box">
    <div class="login-header">
      <div class="login-logo">${CONFIG.BLOG_NAME}</div>
      <div class="login-sub">Admin Access</div>
    </div>
    <div class="login-body">
      <input class="input" type="password" id="pwInput" placeholder="비밀번호" onkeydown="if(event.key==='Enter')login()">
      <button class="btn btn-primary" onclick="login()">로그인</button>
      <p class="err-msg" id="loginErr"></p>
    </div>
  </div>
</div>

<div id="adminWrap" class="hidden">
  <div class="admin-header">
    <div class="admin-header-inner">
      <div class="admin-logo">${CONFIG.BLOG_NAME} <span>Admin</span></div>
      <div class="admin-nav">
        <a href="/" target="_blank">블로그 보기</a>
        <span class="nav-sep">/</span>
        <a href="#" onclick="logout()">로그아웃</a>
      </div>
    </div>
  </div>

  <div class="admin-wrap">
    <div class="tab-nav">
      <button class="tab-btn active" id="tabListBtn" onclick="showTab('list')">글 목록</button>
      <button class="tab-btn" id="tabWriteBtn" onclick="showTab('write')">글 작성</button>
    </div>

    <!-- 글 목록 탭 -->
    <div id="tabList">
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">전체 글</span>
          <span class="count-badge" id="postCount">0</span>
        </div>
        <div id="adminPostList">
          <div class="empty-state">불러오는 중...</div>
        </div>
      </div>
    </div>

    <!-- 글 작성 탭 -->
    <div id="tabWrite" class="hidden">
      <div class="write-panel">
        <div class="write-title" id="writeTitle">새 글 작성</div>
        <input type="hidden" id="editId">
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">제목 *</label>
            <input class="form-input" id="postTitle" placeholder="글 제목">
          </div>
          <div class="form-group">
            <label class="form-label">카테고리</label>
            <input class="form-input" id="postCategory" placeholder="예: 생활, 여행, IT">
          </div>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">태그 (쉼표로 구분)</label>
            <input class="form-input" id="postTags" placeholder="태그1, 태그2">
          </div>
          <div class="form-group">
            <label class="form-label">썸네일 URL</label>
            <input class="form-input" id="postThumb" placeholder="https://...">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">내용 (HTML 사용 가능)</label>
          <textarea class="form-textarea" id="editor" placeholder="글 내용을 입력하세요..."></textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-orange" onclick="savePost()">저장하기</button>
          <button class="btn btn-ghost" onclick="clearForm()">초기화</button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
var token=localStorage.getItem('admin_token')||'';
async function login(){
  var pw=document.getElementById('pwInput').value;
  try{
    var r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    var d=await r.json();
    if(d.ok){token=d.token;localStorage.setItem('admin_token',token);showAdmin();}
    else{document.getElementById('loginErr').textContent='비밀번호가 틀렸습니다.';}
  }catch(e){document.getElementById('loginErr').textContent='오류가 발생했습니다.';}
}
function logout(){localStorage.removeItem('admin_token');location.reload();}
function showAdmin(){
  document.getElementById('loginWrap').classList.add('hidden');
  document.getElementById('adminWrap').classList.remove('hidden');
  loadAdminPosts();
}
function showTab(tab){
  document.getElementById('tabListBtn').classList.toggle('active',tab==='list');
  document.getElementById('tabWriteBtn').classList.toggle('active',tab==='write');
  document.getElementById('tabList').classList.toggle('hidden',tab!=='list');
  document.getElementById('tabWrite').classList.toggle('hidden',tab!=='write');
  if(tab==='list')loadAdminPosts();
}
async function loadAdminPosts(){
  try{
    var r=await fetch('/api/posts?limit=100'),d=await r.json();
    document.getElementById('postCount').textContent=d.total||0;
    var el=document.getElementById('adminPostList');
    if(!d.posts||!d.posts.length){
      el.innerHTML='<div class="empty-state">등록된 글이 없습니다</div>';
      return;
    }
    el.innerHTML=d.posts.map(function(p){
      var date=new Date(p.createdAt).toLocaleDateString('ko-KR');
      return '<div class="post-item">'+
        '<span class="pi-cat">'+p.category+'</span>'+
        '<div class="pi-title"><a href="/post/'+p.id+'" target="_blank">'+p.title+'</a></div>'+
        '<span class="pi-date">'+date+'</span>'+
        '<div class="pi-actions">'+
          '<button class="btn btn-ghost btn-sm" data-action="edit" data-id="'+p.id+'">수정</button>'+
          '<button class="btn btn-del btn-sm" data-action="del" data-id="'+p.id+'">삭제</button>'+
        '</div>'+
      '</div>';
    }).join('');
    el.onclick=function(e){
      var btn=e.target.closest('button[data-action]');
      if(!btn)return;
      var id=btn.dataset.id;
      if(btn.dataset.action==='edit')editPost(id);
      else if(btn.dataset.action==='del')deletePost(id);
    };
  }catch(e){}
}
async function editPost(id){
  var r=await fetch('/api/posts/'+id),d=await r.json(),p=d.post;
  document.getElementById('editId').value=p.id;
  document.getElementById('postTitle').value=p.title;
  document.getElementById('postCategory').value=p.category;
  document.getElementById('postTags').value=(p.tags||[]).join(', ');
  document.getElementById('postThumb').value=p.thumbnail||'';
  document.getElementById('editor').value=p.content;
  document.getElementById('writeTitle').textContent='글 수정';
  showTab('write');
}
async function savePost(){
  var title=document.getElementById('postTitle').value;
  if(!title){alert('제목을 입력하세요');return;}
  var body={
    id:document.getElementById('editId').value||undefined,
    title:title,
    category:document.getElementById('postCategory').value||'일반',
    tags:document.getElementById('postTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean),
    thumbnail:document.getElementById('postThumb').value,
    content:document.getElementById('editor').value,
  };
  var r=await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});
  var d=await r.json();
  if(d.ok){alert('저장했습니다.');clearForm();showTab('list');}
  else alert('오류: '+(d.error||'알 수 없는 오류'));
}
async function deletePost(id){
  if(!confirm('이 글을 삭제할까요?'))return;
  await fetch('/api/posts/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+token}});
  loadAdminPosts();
}
function clearForm(){
  ['editId','postTitle','postCategory','postTags','postThumb','editor'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('writeTitle').textContent='새 글 작성';
}
if(token)showAdmin();
<\/script>
</body></html>`;
}

// ── 이용약관 ─────────────────────────────────────────────────
function getTermsHTML() {
  const year = new Date().getFullYear();
  const css = `.doc-wrap{max-width:780px;margin:0 auto;padding:48px 24px}.doc-kicker{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--orange);margin-bottom:12px}.doc-title{font-size:32px;font-weight:700;letter-spacing:-.3px;margin-bottom:8px}.doc-date{font-size:12px;color:var(--text-light);letter-spacing:.06em;text-transform:uppercase;padding-bottom:20px;border-bottom:3px solid var(--black);margin-bottom:32px}h2{font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:32px 0 12px;padding-top:20px;border-top:1px solid var(--border)}p,li{font-size:15px;line-height:1.9;margin-bottom:12px;color:#333}ul{padding-left:20px}`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>이용약관 — ${CONFIG.BLOG_NAME}</title><style>${commonCSS()}${css}</style></head><body>${headerHTML()}<div class="doc-wrap"><p class="doc-kicker">Legal</p><h1 class="doc-title">이용약관</h1><p class="doc-date">시행일: ${year}년 1월 1일</p><h2>제1조 (목적)</h2><p>본 약관은 ${CONFIG.BLOG_NAME}(이하 "블로그")가 제공하는 서비스의 이용과 관련하여 블로그와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p><h2>제2조 (서비스 이용)</h2><p>본 블로그는 다양한 정보와 콘텐츠를 무료로 제공합니다.</p><ul><li>모든 콘텐츠의 저작권은 블로그 운영자에게 있습니다.</li><li>콘텐츠를 무단으로 복제, 배포, 수정하는 행위를 금지합니다.</li><li>블로그 콘텐츠를 상업적 목적으로 활용할 경우 사전 동의가 필요합니다.</li></ul><h2>제3조 (면책조항)</h2><p>본 블로그에서 제공하는 정보는 일반적인 참고용으로만 제공됩니다. 블로그 운영자는 정보의 정확성에 대해 보증하지 않으며, 이용자가 정보를 이용하여 발생한 손해에 대해 책임을 지지 않습니다.</p><h2>제4조 (광고)</h2><p>본 블로그는 Google AdSense 등의 광고 서비스를 운영합니다. 광고 내용은 광고주의 책임이며, 블로그 운영자는 광고 내용에 대한 책임을 지지 않습니다.</p><h2>제5조 (약관 변경)</h2><p>블로그 운영자는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 블로그에 공지함으로써 효력이 발생합니다.</p></div>${footerHTML()}</body></html>`;
}

// ── 개인정보처리방침 ─────────────────────────────────────────
function getPrivacyHTML() {
  const year = new Date().getFullYear();
  const css = `.doc-wrap{max-width:780px;margin:0 auto;padding:48px 24px}.doc-kicker{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--orange);margin-bottom:12px}.doc-title{font-size:32px;font-weight:700;letter-spacing:-.3px;margin-bottom:8px}.doc-date{font-size:12px;color:var(--text-light);letter-spacing:.06em;text-transform:uppercase;padding-bottom:20px;border-bottom:3px solid var(--black);margin-bottom:32px}h2{font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:32px 0 12px;padding-top:20px;border-top:1px solid var(--border)}p,li{font-size:15px;line-height:1.9;margin-bottom:12px;color:#333}ul{padding-left:20px}a{color:var(--orange)}`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>개인정보처리방침 — ${CONFIG.BLOG_NAME}</title><style>${commonCSS()}${css}</style></head><body>${headerHTML()}<div class="doc-wrap"><p class="doc-kicker">Legal</p><h1 class="doc-title">개인정보처리방침</h1><p class="doc-date">시행일: ${year}년 1월 1일</p><p>${CONFIG.BLOG_NAME}은 이용자의 개인정보를 중요시하며, 개인정보 보호에 관한 법률을 준수하고 있습니다.</p><h2>1. 수집하는 개인정보</h2><ul><li>방문 기록, IP 주소, 브라우저 종류 및 OS</li><li>서비스 이용 기록 및 접속 로그</li><li>쿠키 및 유사한 기술을 통한 정보</li></ul><h2>2. 개인정보 수집 목적</h2><ul><li>서비스 제공 및 운영</li><li>서비스 개선 및 통계 분석</li><li>광고 서비스 제공 (Google AdSense)</li></ul><h2>3. Google AdSense 및 쿠키</h2><p>본 블로그는 Google AdSense를 통해 광고를 게재합니다. Google은 쿠키를 사용하여 이용자에게 맞춤형 광고를 표시할 수 있습니다.</p><ul><li>이용자는 <a href="https://www.google.com/settings/ads" target="_blank">Google 광고 설정</a>에서 맞춤 광고를 비활성화할 수 있습니다.</li><li>쿠키 설정은 브라우저 설정에서 변경할 수 있습니다.</li></ul><h2>4. 개인정보 보유 기간</h2><p>이용자의 개인정보는 서비스 이용 목적이 달성된 후에는 즉시 파기합니다.</p><h2>5. 개인정보처리방침 변경</h2><p>본 개인정보처리방침은 법령 및 정책의 변경에 따라 내용이 변경될 수 있으며, 변경 사항은 블로그를 통해 공지합니다.</p></div>${footerHTML()}</body></html>`;
}
