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

// ── 공통 CSS ────────────────────────────────────────────────
function commonCSS() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&family=Noto+Serif+KR:wght@400;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #1a56db;
      --primary-light: #e8f0fe;
      --accent: #f59e0b;
      --text: #111827;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --bg: #f9fafb;
      --white: #ffffff;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
      --shadow: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04);
      --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04);
      --radius: 12px;
    }
    html { scroll-behavior: smooth; }
    body { font-family: 'Noto Sans KR', sans-serif; color: var(--text); background: var(--bg); line-height: 1.7; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; height: auto; display: block; }

    /* 헤더 */
    header { background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
    .header-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 64px; display: flex; align-items: center; justify-content: space-between; }
    .blog-logo { font-family: 'Noto Serif KR', serif; font-size: 1.25rem; font-weight: 700; color: var(--primary); letter-spacing: -0.5px; }
    nav { display: flex; align-items: center; gap: 8px; }
    nav a { padding: 6px 14px; border-radius: 8px; font-size: 0.875rem; color: var(--text-muted); font-weight: 500; transition: all 0.15s; }
    nav a:hover { background: var(--primary-light); color: var(--primary); }

    /* 광고 */
    .ad-wrap { background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1px dashed #cbd5e1; border-radius: 10px; padding: 12px; text-align: center; margin: 24px 0; min-height: 100px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.75rem; }

    /* 푸터 */
    footer { background: #111827; color: rgba(255,255,255,0.5); padding: 48px 24px 32px; margin-top: 80px; }
    .footer-inner { max-width: 1200px; margin: 0 auto; text-align: center; }
    .footer-logo { font-family: 'Noto Serif KR', serif; font-size: 1.1rem; color: white; margin-bottom: 16px; }
    .footer-links { display: flex; justify-content: center; gap: 24px; margin-bottom: 20px; }
    .footer-links a { font-size: 0.85rem; color: rgba(255,255,255,0.4); transition: color 0.15s; }
    .footer-links a:hover { color: white; }
    .footer-copy { font-size: 0.8rem; }

    @media (max-width: 768px) {
      .header-inner { padding: 0 16px; }
      .blog-logo { font-size: 1.1rem; }
    }
  `;
}

function adUnit(slot) {
  return '<div class="ad-wrap"><ins class="adsbygoogle" style="display:block" data-ad-client="' + CONFIG.ADSENSE_CLIENT + '" data-ad-slot="' + slot + '" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script></div>';
}

function footerHTML() {
  const year = new Date().getFullYear();
  return '<footer><div class="footer-inner"><div class="footer-logo">' + CONFIG.BLOG_NAME + '</div><div class="footer-links"><a href="/">홈</a><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a></div><p class="footer-copy">© ' + year + ' ' + CONFIG.BLOG_NAME + '. All rights reserved.</p></div></footer>';
}

// ── 메인 페이지 ──────────────────────────────────────────────
function getIndexHTML() {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + CONFIG.BLOG_NAME + '</title><meta name="description" content="' + CONFIG.BLOG_DESC + '"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CONFIG.ADSENSE_CLIENT + '" crossorigin="anonymous"><\/script><style>' + commonCSS() + `
    .hero { background: linear-gradient(135deg, #1e3a8a 0%, #1a56db 50%, #3b82f6 100%); color: white; padding: 72px 24px; text-align: center; position: relative; overflow: hidden; }
    .hero::before { content: ''; position: absolute; inset: 0; background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
    .hero-content { position: relative; z-index: 1; }
    .hero h1 { font-family: 'Noto Serif KR', serif; font-size: 2.5rem; font-weight: 700; margin-bottom: 16px; letter-spacing: -1px; }
    .hero p { font-size: 1.1rem; opacity: 0.85; max-width: 500px; margin: 0 auto; }
    .container { max-width: 1200px; margin: 0 auto; padding: 48px 24px; }
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .section-title { font-family: 'Noto Serif KR', serif; font-size: 1.3rem; font-weight: 700; color: var(--text); }
    .category-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 32px; }
    .cat-btn { padding: 7px 18px; border-radius: 100px; border: 1.5px solid var(--border); background: white; font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: all 0.15s; color: var(--text-muted); font-family: 'Noto Sans KR', sans-serif; }
    .cat-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
    .cat-btn:hover:not(.active) { border-color: var(--primary); color: var(--primary); }
    .posts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 24px; }
    .post-card { background: white; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; border: 1px solid var(--border); }
    .post-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
    .post-thumb { width: 100%; height: 210px; object-fit: cover; }
    .post-thumb-ph { width: 100%; height: 210px; background: linear-gradient(135deg, #e0e7ff, #dbeafe); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
    .post-body { padding: 20px; }
    .post-cat-tag { display: inline-block; background: var(--primary-light); color: var(--primary); font-size: 0.75rem; font-weight: 600; padding: 3px 10px; border-radius: 100px; margin-bottom: 10px; }
    .post-title { font-weight: 700; font-size: 1rem; line-height: 1.6; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .post-summary { font-size: 0.85rem; color: var(--text-muted); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .post-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
    .post-date { font-size: 0.75rem; color: var(--text-muted); }
    .post-views { font-size: 0.75rem; color: var(--text-muted); }
    .pagination { display: flex; justify-content: center; gap: 6px; margin-top: 48px; }
    .page-btn { width: 40px; height: 40px; border-radius: 10px; border: 1.5px solid var(--border); background: white; cursor: pointer; font-size: 0.9rem; font-weight: 500; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
    .page-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
    .page-btn:hover:not(.active) { border-color: var(--primary); color: var(--primary); }
    .empty { text-align: center; padding: 80px 20px; color: var(--text-muted); }
    .empty-icon { font-size: 3rem; margin-bottom: 16px; }
    @media (max-width: 768px) { .posts-grid { grid-template-columns: 1fr; } .hero h1 { font-size: 1.8rem; } }
  ` + '</style></head><body><header><div class="header-inner"><a href="/" class="blog-logo">' + CONFIG.BLOG_NAME + '</a><nav><a href="/">홈</a><a href="/admin">관리</a></nav></div></header><div class="hero"><div class="hero-content"><h1>' + CONFIG.BLOG_NAME + '</h1><p>' + CONFIG.BLOG_DESC + '</p></div></div><div class="container">' + adUnit(CONFIG.ADSENSE_SLOT_TOP) + '<div class="category-tabs" id="categoryTabs"><button class="cat-btn active" data-cat="">전체</button></div><div class="posts-grid" id="postsGrid"><div class="empty"><div class="empty-icon">✨</div><p>글을 불러오는 중...</p></div></div><div class="pagination" id="pagination"></div>' + adUnit(CONFIG.ADSENSE_SLOT_BOTTOM) + '</div>' + footerHTML() + `<script>
var currentPage=1,currentCategory='';
async function loadCategories(){
  try{
    var r=await fetch('/api/categories'),d=await r.json();
    var tabs=document.getElementById('categoryTabs');
    (d.categories||[]).forEach(function(cat){
      var btn=document.createElement('button');
      btn.className='cat-btn';btn.textContent=cat;btn.dataset.cat=cat;
      btn.onclick=function(){filterCategory(cat,btn);};
      tabs.appendChild(btn);
    });
  }catch(e){}
}
async function loadPosts(page,cat){
  page=page||1;cat=cat===undefined?currentCategory:cat;
  currentPage=page;currentCategory=cat;
  var grid=document.getElementById('postsGrid');
  grid.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><p>불러오는 중...</p></div>';
  try{
    var r=await fetch('/api/posts?page='+page+'&category='+encodeURIComponent(cat)),d=await r.json();
    if(!d.posts||!d.posts.length){grid.innerHTML='<div class="empty"><div class="empty-icon">📝</div><p>아직 글이 없습니다</p></div>';return;}
    grid.innerHTML=d.posts.map(function(p){
      var thumb=p.thumbnail?'<img class="post-thumb" src="'+p.thumbnail+'" alt="'+p.title+'" loading="lazy">':`<div class="post-thumb-ph">📝</div>`;
      var date=new Date(p.createdAt).toLocaleDateString('ko-KR');
      return '<div class="post-card" onclick="location.href=\'/post/'+p.id+'\'">'+thumb+'<div class="post-body"><span class="post-cat-tag">'+p.category+'</span><div class="post-title">'+p.title+'</div><div class="post-summary">'+p.summary+'</div><div class="post-footer"><span class="post-date">📅 '+date+'</span></div></div></div>';
    }).join('');
    renderPagination(d.total,d.limit,page);
  }catch(e){grid.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><p>오류가 발생했습니다</p></div>';}
}
function filterCategory(cat,btn){
  currentCategory=cat;
  document.querySelectorAll('.cat-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  loadPosts(1,cat);
}
function renderPagination(total,limit,current){
  var pages=Math.ceil(total/limit),pg=document.getElementById('pagination');
  pg.innerHTML='';
  for(var i=1;i<=pages;i++){
    var btn=document.createElement('button');
    btn.className='page-btn'+(i===current?' active':'');
    btn.textContent=i;
    (function(i){btn.onclick=function(){loadPosts(i,currentCategory);};})(i);
    pg.appendChild(btn);
  }
}
loadCategories();loadPosts();
<\/script></body></html>`;
}

// ── 글 상세 페이지 ───────────────────────────────────────────
function getPostHTML(postId) {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + CONFIG.BLOG_NAME + '</title><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CONFIG.ADSENSE_CLIENT + '" crossorigin="anonymous"><\/script><style>' + commonCSS() + `
    .container { max-width: 800px; margin: 0 auto; padding: 48px 24px; }
    .back-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 0.875rem; margin-bottom: 32px; padding: 8px 16px; border-radius: 8px; background: white; border: 1px solid var(--border); transition: all 0.15s; }
    .back-btn:hover { border-color: var(--primary); color: var(--primary); }
    .post-cat-tag { display: inline-block; background: var(--primary-light); color: var(--primary); font-size: 0.8rem; font-weight: 600; padding: 4px 12px; border-radius: 100px; margin-bottom: 16px; }
    .post-title { font-family: 'Noto Serif KR', serif; font-size: 2rem; font-weight: 700; line-height: 1.4; margin-bottom: 20px; letter-spacing: -0.5px; }
    .post-meta { display: flex; align-items: center; gap: 20px; color: var(--text-muted); font-size: 0.875rem; padding-bottom: 24px; border-bottom: 2px solid var(--border); margin-bottom: 32px; flex-wrap: wrap; }
    .post-thumb { width: 100%; border-radius: var(--radius); margin-bottom: 32px; max-height: 460px; object-fit: cover; box-shadow: var(--shadow); }
    .post-content { font-size: 1.05rem; line-height: 2; color: #1f2937; }
    .post-content h2 { font-family: 'Noto Serif KR', serif; font-size: 1.5rem; font-weight: 700; margin: 40px 0 16px; padding-bottom: 10px; border-bottom: 2px solid var(--primary-light); color: var(--text); }
    .post-content h3 { font-size: 1.2rem; font-weight: 700; margin: 28px 0 12px; color: var(--text); }
    .post-content p { margin-bottom: 20px; }
    .post-content ul, .post-content ol { padding-left: 28px; margin-bottom: 20px; }
    .post-content li { margin-bottom: 8px; }
    .post-content img { border-radius: 10px; margin: 24px 0; box-shadow: var(--shadow); }
    .post-content blockquote { border-left: 4px solid var(--primary); padding: 16px 24px; background: var(--primary-light); margin: 24px 0; border-radius: 0 10px 10px 0; }
    .post-content a { color: var(--primary); text-decoration: underline; }
    .post-tags { margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; }
    .tag { background: var(--bg); border: 1px solid var(--border); padding: 5px 14px; border-radius: 100px; font-size: 0.8rem; color: var(--text-muted); }
    @media (max-width: 768px) { .post-title { font-size: 1.5rem; } .container { padding: 32px 16px; } }
  ` + '</style></head><body><header><div class="header-inner"><a href="/" class="blog-logo">' + CONFIG.BLOG_NAME + '</a><nav><a href="/">홈</a></nav></div></header><div class="container"><a href="/" class="back-btn">← 목록으로</a>' + adUnit(CONFIG.ADSENSE_SLOT_TOP) + '<article id="postArticle"><div style="text-align:center;padding:80px 0;color:var(--text-muted)">불러오는 중...</div></article><div id="adMid"></div>' + adUnit(CONFIG.ADSENSE_SLOT_BOTTOM) + '</div>' + footerHTML() + `<script>
var POST_ID='` + postId + `';
async function loadPost(){
  try{
    var r=await fetch('/api/posts/'+POST_ID),d=await r.json();
    if(!d.ok){document.getElementById('postArticle').innerHTML='<div style="text-align:center;padding:80px 0;color:var(--text-muted)">글을 찾을 수 없습니다</div>';return;}
    var p=d.post;
    document.title=p.title+' - ` + CONFIG.BLOG_NAME + `';
    document.getElementById('adMid').innerHTML='` + adUnit(CONFIG.ADSENSE_SLOT_MID) + `';
    var thumb=p.thumbnail?'<img class="post-thumb" src="'+p.thumbnail+'" alt="'+p.title+'">':'';
    var tags=p.tags&&p.tags.length?'<div class="post-tags">'+p.tags.map(function(t){return '<span class="tag">#'+t+'</span>';}).join('')+'</div>':'';
    var date=new Date(p.createdAt).toLocaleDateString('ko-KR');
    var views=(p.views||0).toLocaleString();
    document.getElementById('postArticle').innerHTML='<span class="post-cat-tag">'+p.category+'</span><h1 class="post-title">'+p.title+'</h1><div class="post-meta"><span>📅 '+date+'</span><span>👁 '+views+'회</span></div>'+thumb+'<div class="post-content">'+p.content+'</div>'+tags;
  }catch(e){document.getElementById('postArticle').innerHTML='<div style="text-align:center;padding:80px 0;color:var(--text-muted)">오류가 발생했습니다</div>';}
}
loadPost();
<\/script></body></html>`;
}

// ── 관리자 페이지 ────────────────────────────────────────────
function getAdminHTML() {
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>관리자 - ' + CONFIG.BLOG_NAME + '</title><style>' + commonCSS() + `
    body { background: #f1f5f9; }
    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .login-box { background: white; border-radius: 20px; padding: 48px 40px; width: 100%; max-width: 420px; box-shadow: var(--shadow-lg); text-align: center; border: 1px solid var(--border); }
    .login-icon { font-size: 2.5rem; margin-bottom: 16px; }
    .login-title { font-family: 'Noto Serif KR', serif; font-size: 1.5rem; font-weight: 700; margin-bottom: 8px; }
    .login-sub { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 32px; }
    .input { width: 100%; padding: 12px 16px; border: 1.5px solid var(--border); border-radius: 10px; font-size: 1rem; font-family: 'Noto Sans KR', sans-serif; outline: none; transition: border-color 0.15s; margin-bottom: 12px; }
    .input:focus { border-color: var(--primary); }
    .btn { padding: 12px 24px; border-radius: 10px; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: all 0.15s; font-family: 'Noto Sans KR', sans-serif; }
    .btn-primary { background: var(--primary); color: white; width: 100%; }
    .btn-primary:hover { background: #1744b8; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }
    .btn-sm { padding: 6px 14px; font-size: 0.8rem; border-radius: 7px; }
    .btn-outline { background: white; border: 1.5px solid var(--border); color: var(--text-muted); }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); }
    .admin-layout { display: flex; min-height: calc(100vh - 64px); }
    .admin-main { flex: 1; padding: 32px; max-width: 1100px; margin: 0 auto; width: 100%; }
    .tabs { display: flex; gap: 4px; background: white; padding: 6px; border-radius: 12px; border: 1px solid var(--border); display: inline-flex; margin-bottom: 28px; }
    .tab { padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 0.875rem; font-weight: 500; color: var(--text-muted); transition: all 0.15s; }
    .tab.active { background: var(--primary); color: white; }
    .panel { background: white; border-radius: var(--radius); padding: 28px; border: 1px solid var(--border); box-shadow: var(--shadow-sm); }
    .panel-title { font-weight: 700; font-size: 1rem; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
    .badge { background: var(--primary-light); color: var(--primary); font-size: 0.75rem; font-weight: 600; padding: 2px 10px; border-radius: 100px; }
    .post-list-item { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border); }
    .post-list-item:last-child { border-bottom: none; }
    .post-list-title { font-size: 0.9rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .post-list-title a { color: var(--text); }
    .post-list-title a:hover { color: var(--primary); }
    .post-list-date { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; color: var(--text); }
    .form-group input, .form-group select { width: 100%; padding: 10px 14px; border: 1.5px solid var(--border); border-radius: 10px; font-size: 0.9rem; font-family: 'Noto Sans KR', sans-serif; outline: none; transition: border-color 0.15s; }
    .form-group input:focus, .form-group select:focus { border-color: var(--primary); }
    textarea#editor { width: 100%; min-height: 320px; padding: 16px; border: 1.5px solid var(--border); border-radius: 10px; font-size: 0.9rem; font-family: 'Noto Sans KR', sans-serif; resize: vertical; outline: none; line-height: 1.8; transition: border-color 0.15s; }
    textarea#editor:focus { border-color: var(--primary); }
    .form-actions { display: flex; gap: 12px; margin-top: 20px; }
    .hidden { display: none !important; }
    .err { color: #dc2626; font-size: 0.85rem; margin-top: 10px; }
    @media (max-width: 768px) { .form-row { grid-template-columns: 1fr; } .post-list-item { grid-template-columns: 1fr auto; } }
  ` + '</style></head><body><div id="loginWrap" class="login-wrap"><div class="login-box"><div class="login-icon">🔐</div><h2 class="login-title">관리자 로그인</h2><p class="login-sub">' + CONFIG.BLOG_NAME + ' 관리자 페이지</p><input class="input" type="password" id="pwInput" placeholder="비밀번호를 입력하세요" onkeydown="if(event.key===\'Enter\')login()"><button class="btn btn-primary" onclick="login()">로그인</button><p class="err" id="loginErr"></p></div></div><div id="adminWrap" class="hidden"><header><div class="header-inner"><a href="/" class="blog-logo">' + CONFIG.BLOG_NAME + ' 관리자</a><nav><a href="/" style="font-size:0.85rem">블로그 보기</a><a href="#" onclick="logout()" style="font-size:0.85rem;color:#dc2626">로그아웃</a></nav></div></header><div class="admin-main"><div class="tabs"><div class="tab active" id="tabPostsBtn" onclick="showTab(\'posts\')">📋 글 목록</div><div class="tab" id="tabWriteBtn" onclick="showTab(\'write\')">✏️ 글 쓰기</div></div><div id="tabPosts"><div class="panel"><div class="panel-title">전체 글 <span class="badge" id="postCount">0</span></div><div id="adminPostList"><div style="text-align:center;padding:40px;color:var(--text-muted)">불러오는 중...</div></div></div></div><div id="tabWrite" class="hidden"><div class="panel"><div class="panel-title" id="writeTitle">✏️ 새 글 작성</div><input type="hidden" id="editId"><div class="form-row"><div class="form-group"><label>제목 *</label><input id="postTitle" placeholder="글 제목을 입력하세요"></div><div class="form-group"><label>카테고리</label><input id="postCategory" placeholder="카테고리 (예: 생활, 여행)"></div></div><div class="form-row"><div class="form-group"><label>태그 (쉼표로 구분)</label><input id="postTags" placeholder="태그1, 태그2, 태그3"></div><div class="form-group"><label>썸네일 URL</label><input id="postThumb" placeholder="https://..."></div></div><div class="form-group"><label>내용 (HTML 사용 가능)</label><textarea id="editor" placeholder="글 내용을 입력하세요..."></textarea></div><div class="form-actions"><button class="btn btn-primary" onclick="savePost()">💾 저장하기</button><button class="btn btn-outline" onclick="clearForm()">초기화</button></div></div></div></div></div>' + `<script>
var token=localStorage.getItem('admin_token')||'';
async function login(){
  var pw=document.getElementById('pwInput').value;
  try{
    var r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    var d=await r.json();
    if(d.ok){token=d.token;localStorage.setItem('admin_token',token);showAdmin();}
    else{document.getElementById('loginErr').textContent='비밀번호가 틀렸습니다';}
  }catch(e){document.getElementById('loginErr').textContent='오류가 발생했습니다';}
}
function logout(){localStorage.removeItem('admin_token');location.reload();}
function showAdmin(){document.getElementById('loginWrap').classList.add('hidden');document.getElementById('adminWrap').classList.remove('hidden');loadAdminPosts();}
function showTab(tab){
  document.getElementById('tabPostsBtn').classList.toggle('active',tab==='posts');
  document.getElementById('tabWriteBtn').classList.toggle('active',tab==='write');
  document.getElementById('tabPosts').classList.toggle('hidden',tab!=='posts');
  document.getElementById('tabWrite').classList.toggle('hidden',tab!=='write');
  if(tab==='posts')loadAdminPosts();
}
async function loadAdminPosts(){
  try{
    var r=await fetch('/api/posts?limit=100'),d=await r.json();
    document.getElementById('postCount').textContent=d.total||0;
    var el=document.getElementById('adminPostList');
    if(!d.posts||!d.posts.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-muted)">📝 글이 없습니다</div>';return;}
    el.innerHTML=d.posts.map(function(p){
      var date=new Date(p.createdAt).toLocaleDateString('ko-KR');
      return '<div class="post-list-item"><div class="post-list-title"><a href="/post/'+p.id+'" target="_blank">'+p.title+'</a></div><span class="badge">'+p.category+'</span><span class="post-list-date">'+date+'</span><div style="display:flex;gap:6px"><button class="btn btn-sm btn-primary" onclick="editPost(\''+p.id+'\')">수정</button><button class="btn btn-sm btn-danger" onclick="deletePost(\''+p.id+'\')">삭제</button></div></div>';
    }).join('');
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
  document.getElementById('writeTitle').textContent='✏️ 글 수정';
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
  if(d.ok){alert('저장됐습니다!');clearForm();showTab('posts');}
  else alert('오류: '+(d.error||'알 수 없는 오류'));
}
async function deletePost(id){
  if(!confirm('정말 삭제할까요?'))return;
  await fetch('/api/posts/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+token}});
  loadAdminPosts();
}
function clearForm(){
  ['editId','postTitle','postCategory','postTags','postThumb','editor'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('writeTitle').textContent='✏️ 새 글 작성';
}
if(token)showAdmin();
<\/script></body></html>`;
}

// ── 이용약관 ─────────────────────────────────────────────────
function getTermsHTML() {
  const year = new Date().getFullYear();
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>이용약관 - ' + CONFIG.BLOG_NAME + '</title><style>' + commonCSS() + '.container{max-width:780px;margin:0 auto;padding:48px 24px}.doc-title{font-family:"Noto Serif KR",serif;font-size:2rem;font-weight:700;margin-bottom:8px}.doc-date{color:var(--text-muted);margin-bottom:40px}h2{font-size:1.1rem;font-weight:700;margin:32px 0 12px;color:var(--primary)}p,li{font-size:.95rem;line-height:1.9;margin-bottom:12px;color:#374151}ul{padding-left:20px}</style></head><body><header><div class="header-inner"><a href="/" class="blog-logo">' + CONFIG.BLOG_NAME + '</a><nav><a href="/">홈</a></nav></div></header><div class="container"><h1 class="doc-title">이용약관</h1><p class="doc-date">시행일: ' + year + '년 1월 1일</p><h2>제1조 (목적)</h2><p>본 약관은 ' + CONFIG.BLOG_NAME + '(이하 "블로그")가 제공하는 서비스의 이용과 관련하여 블로그와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p><h2>제2조 (서비스 이용)</h2><p>본 블로그는 다양한 정보와 콘텐츠를 무료로 제공합니다.</p><ul><li>모든 콘텐츠의 저작권은 블로그 운영자에게 있습니다.</li><li>콘텐츠를 무단으로 복제, 배포, 수정하는 행위를 금지합니다.</li><li>블로그 콘텐츠를 상업적 목적으로 활용할 경우 사전 동의가 필요합니다.</li></ul><h2>제3조 (면책조항)</h2><p>본 블로그에서 제공하는 정보는 일반적인 참고용으로만 제공됩니다. 블로그 운영자는 정보의 정확성에 대해 보증하지 않으며, 이용자가 정보를 이용하여 발생한 손해에 대해 책임을 지지 않습니다.</p><h2>제4조 (광고)</h2><p>본 블로그는 Google AdSense 등의 광고 서비스를 운영합니다. 광고 내용은 광고주의 책임이며, 블로그 운영자는 광고 내용에 대한 책임을 지지 않습니다.</p><h2>제5조 (약관 변경)</h2><p>블로그 운영자는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 블로그에 공지함으로써 효력이 발생합니다.</p></div>' + footerHTML() + '</body></html>';
}

// ── 개인정보처리방침 ─────────────────────────────────────────
function getPrivacyHTML() {
  const year = new Date().getFullYear();
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>개인정보처리방침 - ' + CONFIG.BLOG_NAME + '</title><style>' + commonCSS() + '.container{max-width:780px;margin:0 auto;padding:48px 24px}.doc-title{font-family:"Noto Serif KR",serif;font-size:2rem;font-weight:700;margin-bottom:8px}.doc-date{color:var(--text-muted);margin-bottom:40px}h2{font-size:1.1rem;font-weight:700;margin:32px 0 12px;color:var(--primary)}p,li{font-size:.95rem;line-height:1.9;margin-bottom:12px;color:#374151}ul{padding-left:20px}</style></head><body><header><div class="header-inner"><a href="/" class="blog-logo">' + CONFIG.BLOG_NAME + '</a><nav><a href="/">홈</a></nav></div></header><div class="container"><h1 class="doc-title">개인정보처리방침</h1><p class="doc-date">시행일: ' + year + '년 1월 1일</p><p>' + CONFIG.BLOG_NAME + '은 이용자의 개인정보를 중요시하며, 개인정보 보호에 관한 법률을 준수하고 있습니다.</p><h2>1. 수집하는 개인정보</h2><ul><li>방문 기록, IP 주소, 브라우저 종류 및 OS</li><li>서비스 이용 기록 및 접속 로그</li><li>쿠키 및 유사한 기술을 통한 정보</li></ul><h2>2. 개인정보 수집 목적</h2><ul><li>서비스 제공 및 운영</li><li>서비스 개선 및 통계 분석</li><li>광고 서비스 제공 (Google AdSense)</li></ul><h2>3. Google AdSense 및 쿠키</h2><p>본 블로그는 Google AdSense를 통해 광고를 게재합니다. Google은 쿠키를 사용하여 이용자에게 맞춤형 광고를 표시할 수 있습니다.</p><ul><li>이용자는 <a href="https://www.google.com/settings/ads" target="_blank" style="color:var(--primary)">Google 광고 설정</a>에서 맞춤 광고를 비활성화할 수 있습니다.</li><li>쿠키 설정은 브라우저 설정에서 변경할 수 있습니다.</li></ul><h2>4. 개인정보 보유 기간</h2><p>이용자의 개인정보는 서비스 이용 목적이 달성된 후에는 즉시 파기합니다.</p><h2>5. 개인정보처리방침 변경</h2><p>본 개인정보처리방침은 법령 및 정책의 변경에 따라 내용이 변경될 수 있으며, 변경 사항은 블로그를 통해 공지합니다.</p></div>' + footerHTML() + '</body></html>';
}
