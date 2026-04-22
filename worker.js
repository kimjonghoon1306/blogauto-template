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

    // CORS
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // API 라우팅
    if (path.startsWith("/api/")) {
      return handleAPI(request, env, path, cors);
    }

    // 페이지 라우팅
    if (path === "/" || path === "/index.html") return servePage("index", env);
    if (path.startsWith("/post/")) return servePage("post", env, path.split("/post/")[1]);
    if (path === "/admin" || path === "/admin.html") return servePage("admin", env);
    if (path === "/terms") return servePage("terms", env);
    if (path === "/privacy") return servePage("privacy", env);
    if (path === "/sitemap.xml") return serveSitemap(env);
    if (path === "/robots.txt") return serveRobots(request);

    return new Response("Not Found", { status: 404 });
  }
};

// ── API 핸들러 ──────────────────────────────────────────────
async function handleAPI(request, env, path, cors) {
  const headers = { ...cors, "Content-Type": "application/json" };

  // 글 목록
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

  // 글 상세
  if (path.startsWith("/api/posts/") && request.method === "GET") {
    const id = path.split("/api/posts/")[1];
    const post = await env.BLOG_KV.get(`post:${id}`);
    if (!post) return new Response(JSON.stringify({ ok: false, error: "없음" }), { status: 404, headers });

    // 조회수 증가
    const data = JSON.parse(post);
    data.views = (data.views || 0) + 1;
    await env.BLOG_KV.put(`post:${id}`, JSON.stringify(data));

    return new Response(JSON.stringify({ ok: true, post: data }), { headers });
  }

  // 글 작성/수정 (관리자)
  if (path === "/api/posts" && request.method === "POST") {
    if (!checkAuth(request)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });

    const body = await request.json();
    const id = body.id || `post_${Date.now()}`;
    const now = new Date().toISOString();

    const post = {
      id,
      title: body.title || "",
      content: body.content || "",
      summary: body.summary || body.content?.replace(/<[^>]*>/g, "").slice(0, 150) || "",
      category: body.category || "일반",
      thumbnail: body.thumbnail || "",
      tags: body.tags || [],
      views: body.views || 0,
      createdAt: body.createdAt || now,
      updatedAt: now,
    };

    await env.BLOG_KV.put(`post:${id}`, JSON.stringify(post));

    // 목록 업데이트
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    const idx = list.findIndex(p => p.id === id);
    const summary = { id, title: post.title, summary: post.summary, category: post.category, thumbnail: post.thumbnail, createdAt: post.createdAt };
    if (idx >= 0) list[idx] = summary;
    else list.unshift(summary);
    await env.BLOG_KV.put("post_list", JSON.stringify(list));

    return new Response(JSON.stringify({ ok: true, id }), { headers });
  }

  // 글 삭제
  if (path.startsWith("/api/posts/") && request.method === "DELETE") {
    if (!checkAuth(request)) return new Response(JSON.stringify({ ok: false, error: "인증 필요" }), { status: 401, headers });
    const id = path.split("/api/posts/")[1];
    await env.BLOG_KV.delete(`post:${id}`);
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    list = list.filter(p => p.id !== id);
    await env.BLOG_KV.put("post_list", JSON.stringify(list));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // Webhook (BlogAuto Pro 자동 발행)
  if (path === "/api/webhook" && request.method === "POST") {
    const secret = request.headers.get("X-API-Key") || request.headers.get("Authorization")?.replace("Bearer ", "");
    if (secret !== CONFIG.WEBHOOK_SECRET) return new Response(JSON.stringify({ ok: false, error: "인증 실패" }), { status: 401, headers });

    const body = await request.json();
    const id = `post_${Date.now()}`;
    const now = new Date().toISOString();

    const post = {
      id,
      title: body.title || "제목 없음",
      content: body.content || "",
      summary: body.excerpt || body.content?.replace(/<[^>]*>/g, "").slice(0, 150) || "",
      category: body.category || "일반",
      thumbnail: body.thumbnail || "",
      tags: body.tags ? (typeof body.tags === "string" ? body.tags.split(",") : body.tags) : [],
      views: 0,
      createdAt: now,
      updatedAt: now,
    };

    await env.BLOG_KV.put(`post:${id}`, JSON.stringify(post));
    const listRaw = await env.BLOG_KV.get("post_list");
    let list = listRaw ? JSON.parse(listRaw) : [];
    list.unshift({ id, title: post.title, summary: post.summary, category: post.category, thumbnail: post.thumbnail, createdAt: post.createdAt });
    await env.BLOG_KV.put("post_list", JSON.stringify(list));

    return new Response(JSON.stringify({ ok: true, id }), { headers });
  }

  // 카테고리 목록
  if (path === "/api/categories" && request.method === "GET") {
    const listRaw = await env.BLOG_KV.get("post_list");
    const list = listRaw ? JSON.parse(listRaw) : [];
    const cats = [...new Set(list.map(p => p.category))];
    return new Response(JSON.stringify({ ok: true, categories: cats }), { headers });
  }

  // 관리자 로그인
  if (path === "/api/login" && request.method === "POST") {
    const body = await request.json();
    if (body.password === CONFIG.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ ok: true, token: btoa(CONFIG.ADMIN_PASSWORD) }), { headers });
    }
    return new Response(JSON.stringify({ ok: false, error: "비밀번호 틀림" }), { status: 401, headers });
  }

  // 설정 조회
  if (path === "/api/config" && request.method === "GET") {
    return new Response(JSON.stringify({
      ok: true,
      blogName: CONFIG.BLOG_NAME,
      blogDesc: CONFIG.BLOG_DESC,
      blogOwner: CONFIG.BLOG_OWNER,
    }), { headers });
  }

  return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
}

function checkAuth(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${btoa(CONFIG.ADMIN_PASSWORD)}`;
}

async function serveSitemap(env) {
  const listRaw = await env.BLOG_KV.get("post_list");
  const list = listRaw ? JSON.parse(listRaw) : [];
  const urls = list.map(p => `<url><loc>/post/${p.id}</loc><lastmod>${p.createdAt?.split("T")[0]}</lastmod></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/</loc></url>${urls}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}

function serveRobots(request) {
  const host = new URL(request.url).origin;
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${host}/sitemap.xml`, { headers: { "Content-Type": "text/plain" } });
}

async function servePage(type, env, param = "") {
  const config = {
    blogName: CONFIG.BLOG_NAME,
    blogDesc: CONFIG.BLOG_DESC,
    adsenseClient: CONFIG.ADSENSE_CLIENT,
    slotTop: CONFIG.ADSENSE_SLOT_TOP,
    slotMid: CONFIG.ADSENSE_SLOT_MID,
    slotBottom: CONFIG.ADSENSE_SLOT_BOTTOM,
  };

  const pages = {
    index: getIndexHTML(config),
    post: getPostHTML(config, param),
    admin: getAdminHTML(config),
    terms: getTermsHTML(config),
    privacy: getPrivacyHTML(config),
  };

  const html = pages[type] || "<h1>Not Found</h1>";
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ── HTML 페이지들 ────────────────────────────────────────────

function getCommonCSS() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Noto+Serif+KR:wght@400;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #2563eb;
      --primary-dark: #1d4ed8;
      --text: #1e293b;
      --text-light: #64748b;
      --border: #e2e8f0;
      --bg: #f8fafc;
      --white: #ffffff;
      --card-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06);
    }
    body { font-family: 'Noto Sans KR', sans-serif; color: var(--text); background: var(--bg); line-height: 1.7; }
    a { color: inherit; text-decoration: none; }
    img { max-width: 100%; height: auto; }

    /* 헤더 */
    header { background: var(--white); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
    .header-inner { max-width: 1100px; margin: 0 auto; padding: 0 20px; height: 60px; display: flex; align-items: center; justify-content: space-between; }
    .blog-logo { font-family: 'Noto Serif KR', serif; font-size: 1.3rem; font-weight: 700; color: var(--primary); }
    nav a { margin-left: 20px; font-size: 0.9rem; color: var(--text-light); transition: color 0.2s; }
    nav a:hover { color: var(--primary); }

    /* 광고 */
    .ad-wrap { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 10px; text-align: center; margin: 20px 0; min-height: 90px; display: flex; align-items: center; justify-content: center; color: var(--text-light); font-size: 0.8rem; }

    /* 푸터 */
    footer { background: var(--text); color: rgba(255,255,255,0.6); padding: 40px 20px; margin-top: 60px; }
    .footer-inner { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
    .footer-links a { color: rgba(255,255,255,0.5); margin: 0 10px; font-size: 0.85rem; }
    .footer-links a:hover { color: white; }
    .footer-copy { font-size: 0.8rem; }

    /* 반응형 */
    @media (max-width: 768px) {
      .header-inner { padding: 0 16px; }
    }
  `;
}

function getAdScript(client) {
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
}

function getAdUnit(client, slot) {
  return `
    <div class="ad-wrap">
      <ins class="adsbygoogle" style="display:block" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </div>`;
}

function getCommonFooter(blogName) {
  const year = new Date().getFullYear();
  return `
    <footer>
      <div class="footer-inner">
        <div class="footer-links">
          <a href="/">홈</a>
          <a href="/terms">이용약관</a>
          <a href="/privacy">개인정보처리방침</a>
        </div>
        <p class="footer-copy">© ${year} ${blogName}. All rights reserved.</p>
      </div>
    </footer>`;
}

function getIndexHTML(cfg) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cfg.blogName}</title>
<meta name="description" content="${cfg.blogDesc}">
<meta property="og:title" content="${cfg.blogName}">
<meta property="og:description" content="${cfg.blogDesc}">
${getAdScript(cfg.adsenseClient)}
<style>
${getCommonCSS()}
.hero { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 60px 20px; text-align: center; }
.hero h1 { font-family: 'Noto Serif KR', serif; font-size: 2rem; margin-bottom: 12px; }
.hero p { font-size: 1rem; opacity: 0.85; }
.container { max-width: 1100px; margin: 0 auto; padding: 40px 20px; }
.section-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid var(--primary); display: inline-block; }
.category-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 30px; }
.cat-btn { padding: 6px 16px; border-radius: 20px; border: 1px solid var(--border); background: white; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; }
.cat-btn.active, .cat-btn:hover { background: var(--primary); color: white; border-color: var(--primary); }
.posts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
.post-card { background: white; border-radius: 12px; overflow: hidden; box-shadow: var(--card-shadow); transition: transform 0.2s; cursor: pointer; }
.post-card:hover { transform: translateY(-4px); }
.post-thumb { width: 100%; height: 200px; object-fit: cover; background: #e2e8f0; display: block; }
.post-thumb-placeholder { width: 100%; height: 200px; background: linear-gradient(135deg, #e2e8f0, #cbd5e1); display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 2rem; }
.post-body { padding: 20px; }
.post-category { font-size: 0.75rem; color: var(--primary); font-weight: 500; margin-bottom: 8px; }
.post-title { font-size: 1rem; font-weight: 700; margin-bottom: 8px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.post-summary { font-size: 0.85rem; color: var(--text-light); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.post-date { font-size: 0.75rem; color: var(--text-light); margin-top: 12px; }
.pagination { display: flex; justify-content: center; gap: 8px; margin-top: 40px; }
.page-btn { padding: 8px 14px; border-radius: 6px; border: 1px solid var(--border); background: white; cursor: pointer; font-size: 0.9rem; }
.page-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
.empty { text-align: center; padding: 60px 20px; color: var(--text-light); }
@media (max-width: 768px) { .posts-grid { grid-template-columns: 1fr; } .hero h1 { font-size: 1.5rem; } }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <a href="/" class="blog-logo" id="blogName">${cfg.blogName}</a>
    <nav>
      <a href="/">홈</a>
      <a href="/admin">관리</a>
    </nav>
  </div>
</header>

<div class="hero">
  <h1 id="heroTitle">${cfg.blogName}</h1>
  <p id="heroDesc">${cfg.blogDesc}</p>
</div>

<div class="container">
  ${getAdUnit(cfg.adsenseClient, cfg.slotTop)}

  <div class="category-tabs" id="categoryTabs">
    <button class="cat-btn active" onclick="filterCategory('')">전체</button>
  </div>

  <div class="posts-grid" id="postsGrid">
    <div class="empty">글을 불러오는 중...</div>
  </div>

  <div class="pagination" id="pagination"></div>

  ${getAdUnit(cfg.adsenseClient, cfg.slotBottom)}
</div>

${getCommonFooter(cfg.blogName)}

<script>
let currentPage = 1;
let currentCategory = '';

async function loadCategories() {
  try {
    const r = await fetch('/api/categories');
    const d = await r.json();
    const tabs = document.getElementById('categoryTabs');
    d.categories?.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'cat-btn';
      btn.textContent = cat;
      btn.onclick = () => filterCategory(cat);
      tabs.appendChild(btn);
    });
  } catch(e) {}
}

async function loadPosts(page = 1, category = '') {
  currentPage = page;
  currentCategory = category;
  const grid = document.getElementById('postsGrid');
  grid.innerHTML = '<div class="empty">불러오는 중...</div>';
  try {
    const r = await fetch('/api/posts?page=' + page + '&category=' + encodeURIComponent(category));
    const d = await r.json();
    if (!d.posts?.length) { grid.innerHTML = '<div class="empty">📝 아직 글이 없습니다</div>'; return; }
    grid.innerHTML = d.posts.map(p => \`
      <div class="post-card" onclick="location.href='/post/\${p.id}'">
        \${p.thumbnail ? '<img class="post-thumb" src="' + p.thumbnail + '" alt="' + p.title + '">' : '<div class="post-thumb-placeholder">📝</div>'}
        <div class="post-body">
          <div class="post-category">\${p.category}</div>
          <div class="post-title">\${p.title}</div>
          <div class="post-summary">\${p.summary}</div>
          <div class="post-date">\${new Date(p.createdAt).toLocaleDateString('ko-KR')}</div>
        </div>
      </div>
    \`).join('');
    renderPagination(d.total, d.limit, page);
  } catch(e) { grid.innerHTML = '<div class="empty">오류가 발생했습니다</div>'; }
}

function filterCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  loadPosts(1, cat);
}

function renderPagination(total, limit, current) {
  const pages = Math.ceil(total / limit);
  const pg = document.getElementById('pagination');
  pg.innerHTML = '';
  for (let i = 1; i <= pages; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (i === current ? ' active' : '');
    btn.textContent = i;
    btn.onclick = () => loadPosts(i, currentCategory);
    pg.appendChild(btn);
  }
}

loadCategories();
loadPosts();
</script>
</body>
</html>`;
}

function getPostHTML(cfg, postId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title id="pageTitle">${cfg.blogName}</title>
${getAdScript(cfg.adsenseClient)}
<style>
${getCommonCSS()}
.container { max-width: 780px; margin: 0 auto; padding: 40px 20px; }
.post-header { margin-bottom: 32px; }
.post-category-tag { display: inline-block; background: #eff6ff; color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; margin-bottom: 16px; }
.post-title { font-family: 'Noto Serif KR', serif; font-size: 1.8rem; font-weight: 700; line-height: 1.4; margin-bottom: 16px; }
.post-meta { display: flex; gap: 16px; color: var(--text-light); font-size: 0.85rem; flex-wrap: wrap; }
.post-thumb { width: 100%; border-radius: 12px; margin: 24px 0; max-height: 400px; object-fit: cover; }
.post-content { font-size: 1rem; line-height: 1.9; }
.post-content h2 { font-size: 1.4rem; font-weight: 700; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.post-content h3 { font-size: 1.2rem; font-weight: 700; margin: 24px 0 12px; }
.post-content p { margin-bottom: 16px; }
.post-content ul, .post-content ol { padding-left: 24px; margin-bottom: 16px; }
.post-content li { margin-bottom: 8px; }
.post-content img { border-radius: 8px; margin: 16px 0; }
.post-content blockquote { border-left: 4px solid var(--primary); padding: 12px 20px; background: #f8fafc; margin: 20px 0; border-radius: 0 8px 8px 0; }
.post-tags { margin-top: 32px; display: flex; gap: 8px; flex-wrap: wrap; }
.tag { background: #f1f5f9; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; color: var(--text-light); }
.back-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--text-light); font-size: 0.9rem; margin-bottom: 24px; transition: color 0.2s; }
.back-btn:hover { color: var(--primary); }
@media (max-width: 768px) { .post-title { font-size: 1.4rem; } }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <a href="/" class="blog-logo">${cfg.blogName}</a>
    <nav><a href="/">홈</a></nav>
  </div>
</header>

<div class="container">
  <a href="/" class="back-btn">← 목록으로</a>

  ${getAdUnit(cfg.adsenseClient, cfg.slotTop)}

  <article id="postArticle">
    <div style="text-align:center;padding:60px;color:#94a3b8">불러오는 중...</div>
  </article>

  <div id="adMid"></div>
  ${getAdUnit(cfg.adsenseClient, cfg.slotBottom)}
</div>

${getCommonFooter(cfg.blogName)}

<script>
const POST_ID = '${postId}';
async function loadPost() {
  try {
    const r = await fetch('/api/posts/' + POST_ID);
    const d = await r.json();
    if (!d.ok) { document.getElementById('postArticle').innerHTML = '<div style="text-align:center;padding:60px">글을 찾을 수 없습니다</div>'; return; }
    const p = d.post;
    document.title = p.title + ' - ${cfg.blogName}';
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', p.title);

    // 중간 광고 삽입
    const mid = document.getElementById('adMid');
    mid.innerHTML = \`${getAdUnit(cfg.adsenseClient, cfg.slotMid)}\`;

    document.getElementById('postArticle').innerHTML = \`
      <div class="post-header">
        <span class="post-category-tag">\${p.category}</span>
        <h1 class="post-title">\${p.title}</h1>
        <div class="post-meta">
          <span>📅 \${new Date(p.createdAt).toLocaleDateString('ko-KR')}</span>
          <span>👁 \${p.views?.toLocaleString()}회</span>
        </div>
      </div>
      \${p.thumbnail ? '<img class="post-thumb" src="' + p.thumbnail + '" alt="' + p.title + '">' : ''}
      <div class="post-content">\${p.content}</div>
      \${p.tags?.length ? '<div class="post-tags">' + p.tags.map(t => '<span class="tag">#' + t + '</span>').join('') + '</div>' : ''}
    \`;
  } catch(e) {
    document.getElementById('postArticle').innerHTML = '<div style="text-align:center;padding:60px">오류가 발생했습니다</div>';
  }
}
loadPost();
</script>
</body>
</html>`;
}

function getAdminHTML(cfg) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>관리자 - ${cfg.blogName}</title>
<style>
${getCommonCSS()}
body { background: #f1f5f9; }
.admin-wrap { max-width: 1000px; margin: 0 auto; padding: 40px 20px; }
.login-box { background: white; border-radius: 16px; padding: 40px; max-width: 400px; margin: 100px auto; box-shadow: var(--card-shadow); text-align: center; }
.login-box h2 { margin-bottom: 24px; font-family: 'Noto Serif KR', serif; }
.input { width: 100%; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; margin-bottom: 12px; outline: none; }
.input:focus { border-color: var(--primary); }
.btn { padding: 12px 24px; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: all 0.2s; }
.btn-primary { background: var(--primary); color: white; width: 100%; }
.btn-primary:hover { background: var(--primary-dark); }
.btn-danger { background: #ef4444; color: white; }
.btn-sm { padding: 6px 14px; font-size: 0.8rem; }
.panel { background: white; border-radius: 16px; padding: 32px; margin-bottom: 24px; box-shadow: var(--card-shadow); }
.panel-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.post-list-item { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.post-list-item:last-child { border-bottom: none; }
.post-list-title { flex: 1; font-size: 0.95rem; }
.post-list-meta { color: var(--text-light); font-size: 0.8rem; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 6px; }
.form-group input, .form-group select { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; outline: none; }
.form-group input:focus, .form-group select:focus { border-color: var(--primary); }
#contentEditor { width: 100%; min-height: 300px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: inherit; resize: vertical; outline: none; line-height: 1.7; }
#contentEditor:focus { border-color: var(--primary); }
.tabs { display: flex; gap: 4px; margin-bottom: 24px; }
.tab { padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 0.9rem; color: var(--text-light); }
.tab.active { background: var(--primary); color: white; }
.hidden { display: none; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; background: #eff6ff; color: var(--primary); }
</style>
</head>
<body>

<div id="loginSection">
  <div class="login-box">
    <h2>🔐 관리자 로그인</h2>
    <input class="input" type="password" id="pwInput" placeholder="비밀번호 입력" onkeydown="if(event.key==='Enter')login()">
    <button class="btn btn-primary" onclick="login()">로그인</button>
    <p id="loginErr" style="color:#ef4444;margin-top:12px;font-size:0.85rem"></p>
  </div>
</div>

<div id="adminSection" class="hidden">
  <header>
    <div class="header-inner">
      <a href="/" class="blog-logo">${cfg.blogName} 관리자</a>
      <nav>
        <a href="/">블로그 보기</a>
        <a href="#" onclick="logout()">로그아웃</a>
      </nav>
    </div>
  </header>

  <div class="admin-wrap">
    <div class="tabs">
      <div class="tab active" onclick="showTab('posts')">글 목록</div>
      <div class="tab" onclick="showTab('write')">글 쓰기</div>
    </div>

    <!-- 글 목록 -->
    <div id="tab-posts">
      <div class="panel">
        <div class="panel-title">전체 글 <span id="postCount" class="badge">0</span></div>
        <div id="adminPostList"><div style="text-align:center;padding:40px;color:#94a3b8">불러오는 중...</div></div>
      </div>
    </div>

    <!-- 글 쓰기/수정 -->
    <div id="tab-write" class="hidden">
      <div class="panel">
        <div class="panel-title" id="writeTitle">새 글 작성</div>
        <input type="hidden" id="editId">
        <div class="form-group">
          <label>제목</label>
          <input id="postTitle" placeholder="제목을 입력하세요">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label>카테고리</label>
            <input id="postCategory" placeholder="카테고리">
          </div>
          <div class="form-group">
            <label>태그 (쉼표 구분)</label>
            <input id="postTags" placeholder="태그1, 태그2">
          </div>
        </div>
        <div class="form-group">
          <label>썸네일 URL</label>
          <input id="postThumb" placeholder="https://...">
        </div>
        <div class="form-group">
          <label>내용 (HTML 가능)</label>
          <textarea id="contentEditor" placeholder="글 내용을 입력하세요..."></textarea>
        </div>
        <div style="display:flex;gap:12px">
          <button class="btn btn-primary" onclick="savePost()">저장하기</button>
          <button class="btn" style="background:#f1f5f9" onclick="clearForm()">초기화</button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
let token = localStorage.getItem('admin_token') || '';

async function login() {
  const pw = document.getElementById('pwInput').value;
  const r = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pw}) });
  const d = await r.json();
  if (d.ok) {
    token = d.token;
    localStorage.setItem('admin_token', token);
    showAdmin();
  } else {
    document.getElementById('loginErr').textContent = '비밀번호가 틀렸습니다';
  }
}

function logout() {
  localStorage.removeItem('admin_token');
  location.reload();
}

function showAdmin() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('adminSection').classList.remove('hidden');
  loadAdminPosts();
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['posts','write'][i] === tab));
  document.getElementById('tab-posts').classList.toggle('hidden', tab !== 'posts');
  document.getElementById('tab-write').classList.toggle('hidden', tab !== 'write');
  if (tab === 'posts') loadAdminPosts();
}

async function loadAdminPosts() {
  const r = await fetch('/api/posts?limit=100');
  const d = await r.json();
  document.getElementById('postCount').textContent = d.total || 0;
  const el = document.getElementById('adminPostList');
  if (!d.posts?.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">글이 없습니다</div>'; return; }
  el.innerHTML = d.posts.map(p => \`
    <div class="post-list-item">
      <div class="post-list-title">
        <a href="/post/\${p.id}" target="_blank">\${p.title}</a>
      </div>
      <span class="badge">\${p.category}</span>
      <span class="post-list-meta">\${new Date(p.createdAt).toLocaleDateString('ko-KR')}</span>
      <button class="btn btn-sm btn-primary" onclick="editPost('\${p.id}')">수정</button>
      <button class="btn btn-sm btn-danger" onclick="deletePost('\${p.id}')">삭제</button>
    </div>
  \`).join('');
}

async function editPost(id) {
  const r = await fetch('/api/posts/' + id);
  const d = await r.json();
  const p = d.post;
  document.getElementById('editId').value = p.id;
  document.getElementById('postTitle').value = p.title;
  document.getElementById('postCategory').value = p.category;
  document.getElementById('postTags').value = p.tags?.join(', ') || '';
  document.getElementById('postThumb').value = p.thumbnail || '';
  document.getElementById('contentEditor').value = p.content;
  document.getElementById('writeTitle').textContent = '글 수정';
  showTab('write');
}

async function savePost() {
  const id = document.getElementById('editId').value;
  const body = {
    id: id || undefined,
    title: document.getElementById('postTitle').value,
    category: document.getElementById('postCategory').value || '일반',
    tags: document.getElementById('postTags').value.split(',').map(t=>t.trim()).filter(Boolean),
    thumbnail: document.getElementById('postThumb').value,
    content: document.getElementById('contentEditor').value,
  };
  const r = await fetch('/api/posts', { method: 'POST', headers: {'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { alert('저장됐습니다!'); clearForm(); showTab('posts'); }
  else alert('오류: ' + d.error);
}

async function deletePost(id) {
  if (!confirm('삭제할까요?')) return;
  await fetch('/api/posts/' + id, { method: 'DELETE', headers: {'Authorization':'Bearer '+token} });
  loadAdminPosts();
}

function clearForm() {
  document.getElementById('editId').value = '';
  document.getElementById('postTitle').value = '';
  document.getElementById('postCategory').value = '';
  document.getElementById('postTags').value = '';
  document.getElementById('postThumb').value = '';
  document.getElementById('contentEditor').value = '';
  document.getElementById('writeTitle').textContent = '새 글 작성';
}

if (token) showAdmin();
</script>
</body>
</html>`;
}

function getTermsHTML(cfg) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>이용약관 - ${cfg.blogName}</title>
<style>
${getCommonCSS()}
.container { max-width: 780px; margin: 0 auto; padding: 40px 20px; }
.doc-title { font-family: 'Noto Serif KR', serif; font-size: 1.8rem; font-weight: 700; margin-bottom: 8px; }
.doc-date { color: var(--text-light); font-size: 0.9rem; margin-bottom: 40px; }
h2 { font-size: 1.1rem; font-weight: 700; margin: 32px 0 12px; color: var(--primary); }
p, li { font-size: 0.95rem; line-height: 1.9; margin-bottom: 12px; color: #334155; }
ul { padding-left: 20px; }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <a href="/" class="blog-logo">${cfg.blogName}</a>
    <nav><a href="/">홈</a></nav>
  </div>
</header>
<div class="container">
  <h1 class="doc-title">이용약관</h1>
  <p class="doc-date">시행일: ${year}년 1월 1일</p>

  <h2>제1조 (목적)</h2>
  <p>본 약관은 ${cfg.blogName}(이하 "블로그")가 제공하는 서비스의 이용과 관련하여 블로그와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>

  <h2>제2조 (서비스 이용)</h2>
  <p>본 블로그는 다양한 정보와 콘텐츠를 무료로 제공합니다. 이용자는 본 블로그에서 제공하는 서비스를 개인적, 비상업적 목적으로 이용할 수 있습니다.</p>
  <ul>
    <li>모든 콘텐츠의 저작권은 블로그 운영자에게 있습니다.</li>
    <li>콘텐츠를 무단으로 복제, 배포, 수정하는 행위를 금지합니다.</li>
    <li>블로그 콘텐츠를 상업적 목적으로 활용할 경우 사전 동의가 필요합니다.</li>
  </ul>

  <h2>제3조 (면책조항)</h2>
  <p>본 블로그에서 제공하는 정보는 일반적인 참고용으로만 제공됩니다. 블로그 운영자는 정보의 정확성, 완전성에 대해 보증하지 않으며, 이용자가 정보를 이용하여 발생한 손해에 대해 책임을 지지 않습니다.</p>

  <h2>제4조 (광고)</h2>
  <p>본 블로그는 Google AdSense 등의 광고 서비스를 운영합니다. 광고 내용은 광고주의 책임이며, 블로그 운영자는 광고 내용에 대한 책임을 지지 않습니다.</p>

  <h2>제5조 (링크)</h2>
  <p>본 블로그는 외부 사이트로의 링크를 포함할 수 있습니다. 외부 사이트의 내용 및 개인정보 보호 정책에 대해서는 책임을 지지 않습니다.</p>

  <h2>제6조 (약관 변경)</h2>
  <p>블로그 운영자는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 블로그에 공지함으로써 효력이 발생합니다.</p>

  <h2>제7조 (문의)</h2>
  <p>이용약관에 대한 문의사항은 블로그 내 문의 채널을 통해 연락해 주시기 바랍니다.</p>
</div>
${getCommonFooter(cfg.blogName)}
</body>
</html>`;
}

function getPrivacyHTML(cfg) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>개인정보처리방침 - ${cfg.blogName}</title>
<style>
${getCommonCSS()}
.container { max-width: 780px; margin: 0 auto; padding: 40px 20px; }
.doc-title { font-family: 'Noto Serif KR', serif; font-size: 1.8rem; font-weight: 700; margin-bottom: 8px; }
.doc-date { color: var(--text-light); font-size: 0.9rem; margin-bottom: 40px; }
h2 { font-size: 1.1rem; font-weight: 700; margin: 32px 0 12px; color: var(--primary); }
p, li { font-size: 0.95rem; line-height: 1.9; margin-bottom: 12px; color: #334155; }
ul { padding-left: 20px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.9rem; }
th, td { border: 1px solid var(--border); padding: 10px 14px; text-align: left; }
th { background: #f8fafc; font-weight: 600; }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <a href="/" class="blog-logo">${cfg.blogName}</a>
    <nav><a href="/">홈</a></nav>
  </div>
</header>
<div class="container">
  <h1 class="doc-title">개인정보처리방침</h1>
  <p class="doc-date">시행일: ${year}년 1월 1일</p>

  <p>${cfg.blogName}(이하 "블로그")은 이용자의 개인정보를 중요시하며, 개인정보 보호에 관한 법률을 준수하고 있습니다.</p>

  <h2>1. 수집하는 개인정보 항목</h2>
  <p>본 블로그는 별도의 회원가입 없이 이용 가능합니다. 다만, 아래와 같은 정보가 자동으로 수집될 수 있습니다.</p>
  <ul>
    <li>방문 기록, IP 주소, 브라우저 종류 및 OS</li>
    <li>서비스 이용 기록 및 접속 로그</li>
    <li>쿠키 및 유사한 기술을 통한 정보</li>
  </ul>

  <h2>2. 개인정보 수집 및 이용 목적</h2>
  <ul>
    <li>서비스 제공 및 운영</li>
    <li>서비스 개선 및 통계 분석</li>
    <li>광고 서비스 제공 (Google AdSense)</li>
  </ul>

  <h2>3. Google AdSense 및 쿠키</h2>
  <p>본 블로그는 Google AdSense를 통해 광고를 게재합니다. Google은 쿠키를 사용하여 이용자에게 맞춤형 광고를 표시할 수 있습니다.</p>
  <ul>
    <li>Google의 광고 쿠키 사용을 통해 관심 기반 광고가 표시될 수 있습니다.</li>
    <li>이용자는 <a href="https://www.google.com/settings/ads" target="_blank" style="color:var(--primary)">Google 광고 설정</a>에서 맞춤 광고를 비활성화할 수 있습니다.</li>
    <li>쿠키 설정은 브라우저 설정에서 변경할 수 있습니다.</li>
  </ul>

  <h2>4. 개인정보 보유 및 이용 기간</h2>
  <p>이용자의 개인정보는 서비스 이용 목적이 달성된 후에는 즉시 파기합니다. 단, 관련 법령에 의해 보존할 필요가 있는 경우 해당 기간 동안 보존합니다.</p>

  <h2>5. 개인정보 제3자 제공</h2>
  <p>본 블로그는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만, 법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우는 예외로 합니다.</p>

  <h2>6. 이용자의 권리</h2>
  <p>이용자는 언제든지 자신의 개인정보 처리에 관한 아래와 같은 권리를 행사할 수 있습니다.</p>
  <ul>
    <li>개인정보 처리 현황 조회 및 열람 요청</li>
    <li>개인정보 처리 정지 요청</li>
    <li>개인정보 삭제 요청</li>
  </ul>

  <h2>7. 개인정보처리방침 변경</h2>
  <p>본 개인정보처리방침은 법령 및 정책의 변경에 따라 내용이 변경될 수 있으며, 변경 사항은 블로그를 통해 공지합니다.</p>

  <h2>8. 문의처</h2>
  <p>개인정보 처리에 관한 문의사항은 블로그 내 문의 채널을 통해 연락해 주시기 바랍니다.</p>
</div>
${getCommonFooter(cfg.blogName)}
</body>
</html>`;
}
