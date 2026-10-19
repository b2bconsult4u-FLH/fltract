// Production static-asset boundary. Keep in sync with .assetsignore.
const pages = ['', 'regions', 'brevard', 'indian-river', 'st-lucie', 'martin', 'okeechobee', 'tract-desk', 'landowner-guides', 'contact'];
const publicPaths = new Set(['/robots.txt', '/sitemap.xml', '/assets/css/site.css', '/assets/js/property-records.js', '/assets/js/florida-places.js', '/assets/js/location-fields.js']);
for (const page of pages) {
  const prefix = page ? '/' + page : '';
  publicPaths.add(prefix + '/');
  publicPaths.add(prefix + '/index.html');
  if (page) publicPaths.add(prefix);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!publicPaths.has(path)) return new Response('Not Found', {
      status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
    return env.ASSETS.fetch(request);
  }
};
