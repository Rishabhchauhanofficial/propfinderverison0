// SEO slug helpers.

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '');
}

// A readable, near-unique slug: "3-bhk-apartment-in-dlf-phase-2-gurugram-k3x9f"
export function uniqueSlug(input) {
  const base = slugify(input) || 'property';
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}
