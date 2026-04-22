# 블로그 템플릿 분양 가이드

## 파일 구성
- `worker.js` - 전체 블로그 (이것 하나로 다 됨)
- `wrangler.toml` - Cloudflare 배포 설정

---

## 고객 납품 순서 (5분 완성)

### 1단계 - worker.js 상단 CONFIG 수정
```js
const CONFIG = {
  BLOG_NAME: "고객 블로그 이름",
  BLOG_DESC: "블로그 설명",
  BLOG_OWNER: "운영자 이름",
  ADMIN_PASSWORD: "관리자 비밀번호",
  ADSENSE_CLIENT: "ca-pub-고객애드센스ID",
  ADSENSE_SLOT_TOP: "상단광고슬롯",
  ADSENSE_SLOT_MID: "중간광고슬롯",
  ADSENSE_SLOT_BOTTOM: "하단광고슬롯",
  WEBHOOK_SECRET: "BlogAutoPro연동키",
};
```

### 2단계 - Cloudflare 배포
```bash
# KV 네임스페이스 생성
wrangler kv:namespace create "BLOG_KV"

# wrangler.toml에 id 붙여넣기

# 배포
wrangler deploy
```

### 3단계 - 도메인 연결
- Cloudflare DNS에서 도메인 연결

---

## 기능 목록
- ✅ 메인 페이지 (글 목록, 카테고리 필터, 페이지네이션)
- ✅ 글 상세 페이지 (조회수, 태그)
- ✅ 관리자 페이지 (글 작성/수정/삭제)
- ✅ BlogAuto Pro Webhook 수신 (/api/webhook)
- ✅ 이용약관 (/terms)
- ✅ 개인정보처리방침 (/privacy)
- ✅ 애드센스 광고 (상단/중간/하단)
- ✅ SEO 최적화 (메타태그, sitemap, robots.txt)
- ✅ 모바일 반응형

## BlogAuto Pro 연동
배포 설정 → Webhook URL: https://블로그도메인/api/webhook
Auth Key: WEBHOOK_SECRET 값
