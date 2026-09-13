// api/sitemap.js
// Live sitemap route — same output as the static sitemap.xml file that
// lib/publish.js writes on every publish (both are built by the single
// shared lib/sitemap.js so they can never drift apart). Kept as a working
// route for whenever the server happens to be running; the public site no
// longer depends on it, since /sitemap.xml is a real static file now (see
// lib/publish.js and robots.txt).

const { getDb } = require('../lib/db');
const { buildSitemapXml } = require('../lib/sitemap');

module.exports = async (req, res) => {
  const xml = buildSitemapXml(getDb());
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).send(xml);
};
