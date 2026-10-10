// Runs before `vite build`. On Vercel, fail fast if the API location was never configured, instead of shipping a
// site whose /api calls go to a placeholder host.
import { readFileSync } from 'node:fs';

if (process.env.VERCEL) {
  const direct = (process.env.VITE_API_BASE_URL || '').trim();
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const proxy = (cfg.rewrites || []).find((r) => r.source.startsWith('/api'));
  const problems = [];

  if (direct) {
    if (!/^https:\/\/.+/.test(direct)) problems.push('VITE_API_BASE_URL must be an https:// URL (e.g. https://YOUR-BACKEND.onrender.com/api).');
    if (/localhost|127\.0\.0\.1/.test(direct)) problems.push('VITE_API_BASE_URL points at localhost; production builds must target the deployed backend.');
    if (/YOUR-BACKEND/.test(direct)) problems.push('VITE_API_BASE_URL still contains the YOUR-BACKEND placeholder.');
  } else if (!proxy || /YOUR-BACKEND/.test(proxy.destination) || /localhost|127\.0\.0\.1/.test(proxy.destination)) {
    problems.push('frontend/vercel.json: the /api rewrite destination still has the YOUR-BACKEND placeholder (or is missing). Replace it with your Render service URL, or set VITE_API_BASE_URL for direct mode. See DEPLOYMENT.md.');
  }

  if (problems.length) {
    console.error(`\nVercel build blocked - API location not configured:\n - ${problems.join('\n - ')}\n`);
    process.exit(1);
  }
  console.log(`API location OK (${direct ? 'direct mode' : 'Vercel rewrite'}).`);
}
