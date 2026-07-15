# VELIX — Supabase Migration

This project no longer stores content in IndexedDB, localStorage, or seed/mock
data. Every piece of content (projects, news, media, settings) lives in
Supabase (Postgres + Auth + Storage) and is shared by every visitor and every
device in real time.

## 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → New project.
2. Open **SQL Editor** → paste the entire contents of `supabase/schema.sql` →
   Run. This creates every table, index, trigger, RLS policy, and the public
   `media` Storage bucket.

## 2. Wire the frontend (public, static site)
Edit `assets/js/supabase-config.js`:
```js
window.VELIX_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
window.VELIX_SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```
Both values are from **Project Settings → API**. The anon key is meant to be
public — it can only do what the RLS policies in `schema.sql` allow (read
published content; write nothing without a signed-in staff session).

## 3. Wire the backend (Vercel serverless functions)
Set these as environment variables in your Vercel project (`vercel env add …`
or the dashboard):
```
ANTHROPIC_API_KEY=...
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...   # Project Settings → API → service_role — NEVER expose this client-side
```
See `.env.example`.

## 4. Create your first admin user
1. Supabase Dashboard → Authentication → Users → **Add user** (set an email +
   password).
2. That's it — a database trigger (`handle_new_user`) automatically creates a
   matching row in `profiles` and makes the **first** user an `admin`. Every
   user after that defaults to `editor`; promote someone to `admin` by editing
   their row in the `profiles` table.
3. Sign in at `/admin.html` with that email + password.

## 5. Deploy
`vercel --prod` (or push to your connected git branch). No build step is
required for the static pages; the `/api` functions deploy as Vercel
Functions automatically.

---

## What changed
- **Removed entirely:** IndexedDB, localStorage/sessionStorage used for
  content, all seed/demo/mock project and news data, the shared single
  admin password, `@vercel/kv`, and the now-redundant `/api/admin/*` read
  endpoints (the admin panel now reads Supabase directly, protected by RLS).
- **`assets/js/store.js`** — fully rewritten. Same public `VELIX.*` API the
  rest of the site already called, new engine underneath: every read/write
  goes to Supabase, with an in-memory cache kept live via Supabase Realtime
  (Postgres Changes) so edits appear for every open tab/visitor without a
  refresh.
- **`lib/store.js`** (server-side) — rewritten to use the Supabase
  service-role client instead of Vercel KV.
- **Images** — never base64/embedded. `VELIX.uploadFile()` uploads straight
  to the `media` Storage bucket and stores the public URL; every upload is
  also recorded in the `media` table for the Media Library.
- **Auth** — real Supabase Auth (email + password), sessions, and
  role-based access (`admin`/`editor` in `profiles`) instead of a
  localStorage flag and a shared password in Settings.
- **CRUD** — projects and news both support publish/unpublish, feature/
  unfeature, duplicate, soft delete + restore, and bulk publish/unpublish/
  delete from the admin table toolbar. Soft-deleted rows keep `deleted_at`
  set so they can be restored (`VELIX.projects.restore(id)` /
  `VELIX.projects.permanentlyDelete(id)` are also exposed for a future
  trash-bin UI).
- **SEO** — `/sitemap.xml` is now generated on request (`api/sitemap.js`)
  from whatever is actually published in Supabase, instead of a hand-edited
  static file that could drift from real content.
- **Security** — Row Level Security on every table: anonymous visitors can
  only ever `select` published, non-deleted rows; all writes require a
  `profiles.role IN ('admin','editor')` session. The Storage bucket has the
  same split (public read, staff-only write).

## Known follow-ups (not completed in this pass)
This is a large migration; the items below are real gaps worth knowing about
rather than silently leaving unfinished:
- **JSON-LD structured data / full OpenGraph coverage** on `news-post.html`
  and `about.html`/`services.html` — `project.html` and the sitemap are done;
  the rest of the meta-tag wiring is straightforward but wasn't fully audited
  page-by-page.
- **News page realtime** — `portfolio.html`/`index.html` repaint live on any
  change (Supabase Realtime → `velix:updated` event). `news.html` does too;
  `news-post.html` and `project.html` (single-article detail pages) do not
  auto-refresh if that specific article is edited while someone is already
  viewing it — low-risk, but worth wiring the same listener if it matters to
  you.
- **Image optimization/resizing** — uploads go to Storage as-is; Supabase
  Storage's on-the-fly image transformation (resize/webp) is not yet wired
  into `<img>` tags.
- **Media Library folders/pagination** — `VELIX.media.list()` supports a
  `folder` filter and a `limit`, but the admin UI itself doesn't yet expose
  folder browsing or a "load more" control.
- **Trash / restore UI** — the store API (`restore`, `permanentlyDelete`,
  bulk `restore`) is implemented; there's no dedicated "Trash" tab in
  `admin.html` yet to drive it from.
