import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const match = env.match(/^DATABASE_URL=(.*)$/m);
let url = match[1].trim();
if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
  url = url.slice(1, -1);
}

console.log('Testing URL host:', url.split('@')[1]?.split('/')[0]);
const start = Date.now();
const sql = neon(url);
try {
  const rows = await sql`
    select
      to_regclass('public.account') is not null as account_ready,
      to_regclass('public.chat') is not null as chat_ready,
      to_regclass('public.chat_event') is not null as chat_event_ready,
      to_regclass('public.session') is not null as session_ready,
      to_regclass('public."user"') is not null as user_ready,
      to_regclass('public.verification') is not null as verification_ready;
  `;
  console.log('Neon connected in', Date.now() - start, 'ms');
  console.log('Result:', JSON.stringify(rows[0]));
} catch (err) {
  console.error('Neon Error after', Date.now() - start, 'ms:', err);
}
