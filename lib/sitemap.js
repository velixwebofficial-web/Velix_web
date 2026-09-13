// lib/sitemap.js
// ============================================================================
// Sitemap XML builder — the same logic api/sitemap.js has always used,
// pulled out into its own module so it has exactly one implementation. It
// is now called from two places:
//   1. api/sitemap.js — still a live route, for a server that is running.
//   2. lib/publish.js — writes the SAME xml to a plain sitemap.xml file at
//      the project root on every publish, so the sitemap works as a static
//      file with no backend involved (required: SEO must not depend on a
//      backend runtime). robots.txt already points at
//      https://velixweb.xyz/sitemap.xml, and that URL is now a real file,
//      not a route.
// ============================================================================

const SITE = 'https://velixweb.xyz';

const STATIC_URLS = [
  { loc: '/index.html', priority: '1.0' },
  { loc: '/services.html', priority: '0.8' },
  { loc: '/portfolio.html', priority: '0.8' },
  { loc: '/about.html', priority: '0.7' },
  { loc: '/news.html', priority: '0.6' },
  { loc: '/contact.html', priority: '0.7' }
];

function buildSitemapXml(db) {
  let dynamicUrls = [];
  try {
    const projects = db.prepare(
      `SELECT slug, updated_at FROM projects WHERE published = 1 AND deleted_at IS NULL`
    ).all();
    const news = db.prepare(
      `SELECT id, updated_at FROM news WHERE published = 1 AND deleted_at IS NULL`
    ).all();

    projects.forEach((p) => dynamicUrls.push({ loc: `/projects/${p.slug}`, priority: '0.7', lastmod: p.updated_at }));
    news.forEach((n) => dynamicUrls.push({ loc: `/news-post.html?id=${n.id}`, priority: '0.5', lastmod: n.updated_at }));
  } catch (err) {
    console.error('[lib/sitemap] could not read from the database, building static URLs only:', err);
  }

  const all = STATIC_URLS.concat(dynamicUrls);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map(u =>
    `  <url><loc>${SITE}${u.loc}</loc><priority>${u.priority}</priority>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}</url>`
  ).join('\n')}\n</urlset>`;
}

module.exports = { buildSitemapXml, SITE };
