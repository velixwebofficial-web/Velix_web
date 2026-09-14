// lib/models.js
// ============================================================================
// Shared row<->app-shape mapping for projects/news, plus slugify. Used by
// both the privileged admin gateway (api/admin/data.js) and the public
// read-only API (api/public/*.js) so the two can never drift apart on
// field names or JSON encoding — there is exactly one definition of what a
// "project" or "news article" object looks like on the wire.
// ============================================================================

const { fromJson } = require('./db');

function slugify(str) {
  return (str || '').toString().toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';
}

function projectFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle || '',
    client: r.client || '',
    category: r.category || '',
    location: r.location || '',
    completionDate: r.completion_date || '',
    featured: !!r.featured,
    published: !!r.published,
    websiteUrl: r.website_url || '',
    description: r.short_description || '',
    overview: r.overview || '',
    challenge: r.challenge || '',
    solution: r.solution || '',
    results: fromJson(r.results, []),
    services: fromJson(r.services, []),
    technologies: fromJson(r.technologies, []),
    cover: r.cover_image || '',
    gallery: fromJson(r.gallery, []),
    seoTitle: r.seo_title || '',
    seoDescription: r.seo_description || '',
    sortOrder: r.sort_order || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at || null
  };
}

function projectToRow(p) {
  return {
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle || '',
    client: p.client || '',
    category: p.category || '',
    location: p.location || '',
    completion_date: p.completionDate || null,
    featured: p.featured ? 1 : 0,
    published: p.published !== false ? 1 : 0,
    website_url: p.websiteUrl || '',
    short_description: p.description || '',
    full_description: p.fullDescription || p.description || '',
    overview: p.overview || '',
    challenge: p.challenge || '',
    solution: p.solution || '',
    results: JSON.stringify(Array.isArray(p.results) ? p.results : []),
    services: JSON.stringify(Array.isArray(p.services) ? p.services : []),
    technologies: JSON.stringify(Array.isArray(p.technologies) ? p.technologies : []),
    cover_image: p.cover || '',
    gallery: JSON.stringify(Array.isArray(p.gallery) ? p.gallery : []),
    seo_title: p.seoTitle || p.title || '',
    seo_description: p.seoDescription || p.description || ''
  };
}

function newsFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category || '',
    cover: r.cover_image || '',
    video: r.video_url || '',
    excerpt: r.excerpt || '',
    body: r.content || '',
    author: r.author || '',
    published: !!r.published,
    seoTitle: r.seo_title || '',
    seoDescription: r.seo_description || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at || null
  };
}

function newsToRow(n) {
  return {
    slug: n.slug,
    title: n.title,
    category: n.category || '',
    cover_image: n.cover || '',
    video_url: n.video || '',
    excerpt: n.excerpt || '',
    content: n.body || '',
    author: n.author || '',
    published: n.published !== false ? 1 : 0,
    seo_title: n.seoTitle || n.title || '',
    seo_description: n.seoDescription || n.excerpt || ''
  };
}

module.exports = { slugify, projectFromRow, projectToRow, newsFromRow, newsToRow };
