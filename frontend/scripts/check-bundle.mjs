// Runs after `vite build`: proves no backend secret (or secret-shaped string) ended up in the browser bundle.
// Never prints a secret value - only which pattern/variable name matched and in which file.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (!existsSync(dist)) { console.error('dist/ not found - run the build first.'); process.exit(1); }

const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(dist).filter((f) => /\.(js|css|html|json|map|svg|txt)$/.test(f));

// 1. Secret-shaped strings.
const patterns = {
  'JWT / Supabase key': /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/,
  'service_role marker': /service_role/i,
  'postgres connection string': /postgres(ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  'Resend API key': /\bre_[A-Za-z0-9]{20,}/,
  'server variable name': /SUPABASE_SERVICE_ROLE_KEY|JWT_REFRESH_SECRET|JWT_SECRET|RESEND_API_KEY|IDENTITY_WEBHOOK_SECRET|DATABASE_URL/,
};

// 2. The literal values of server-side secrets, taken from the environment and from the local .env if present.
const secretNames = /KEY|SECRET|PASSWORD|DATABASE_URL|TOKEN/i;
const literals = new Map();
const addVars = (obj) => { for (const [k, v] of Object.entries(obj)) if (secretNames.test(k) && typeof v === 'string' && v.length >= 16 && !k.startsWith('VITE_')) literals.set(k, v); };
addVars(process.env);
for (const f of [path.join(root, '..', '.env'), path.join(root, '..', 'backend', '.env')]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) addVars({ [m[1]]: m[2].replace(/\s+#.*$/, '').trim() });
  }
}

const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [label, re] of Object.entries(patterns)) if (re.test(text)) hits.push(`${label} in ${path.relative(dist, f)}`);
  for (const [name, value] of literals) if (text.includes(value)) hits.push(`value of ${name} in ${path.relative(dist, f)}`);
}

if (hits.length) {
  console.error(`\nSECRET EXPOSURE CHECK FAILED - the browser bundle contains:\n - ${[...new Set(hits)].join('\n - ')}\n`);
  process.exit(1);
}
console.log(`Bundle secret scan passed: ${files.length} files, ${Object.keys(patterns).length} patterns, ${literals.size} secret values checked.`);
