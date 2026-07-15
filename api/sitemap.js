// api/sitemap.js
// Dynamic sitemap: static marketing pages + every published project and
// news article currently in Supabase. Replaces the old hand-maintained
// static sitemap.xml (which could never know about admin-created content).

const { createClient } = require('@supabase/supabase-js');

const SITE = 'https://www.velixwebsolutions.com';

module.exports = async (req, res) => {
  const staticUrls = [
    { loc: '/index.html', priority: '1.0' },
    { loc: '/services.html', priority: '0.8' },
    { loc: '/portfolio.html', priority: '0.8' },
    { loc: '/about.html', priority: '0.7' },
    { loc: '/news.html', priority: '0.6' },
    { loc: '/contact.html', priority: '0.7' }
  ];

  let dynamicUrls = [];

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: projects }, { data: news }] = await Promise.all([
      supabase.from('projects').select('slug, updated_at').eq('published', true).is('deleted_at', null),
      supabase.from('news').select('id, updated_at').eq('published', true).is('deleted_at', null)
    ]);
    (projects || []).forEach(p => dynamicUrls.push({ loc: `/projects/${p.slug}`, priority: '0.7', lastmod: p.updated_at }));
    (news || []).forEach(n => dynamicUrls.push({ loc: `/news-post.html?id=${n.id}`, priority: '0.5', lastmod: n.updated_at }));
  }

  const all = staticUrls.concat(dynamicUrls);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map(u =>
    `  <url><loc>${SITE}${u.loc}</loc><priority>${u.priority}</priority>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}</url>`
  ).join('\n')}\n</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).send(xml);
};
