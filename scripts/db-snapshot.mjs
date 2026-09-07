/** Lossless Mimir public-schema snapshot. Never imports app/db (which runs DDL).
 * backup/verify use a single REPEATABLE READ, READ ONLY transaction.
 * restore requires TARGET_DATABASE_URL and an empty public schema; all writes
 * and verification commit together. No credentials are stored in the snapshot.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
neonConfig.webSocketConstructor = ws;

export const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const tableName = (name) => `public.${quote(name)}`;
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const rowsDigest = (rows) => digest(rows.map(row => JSON.stringify(row)).sort().join('\n'));

export const METRICS = {
  payments: `SELECT count(*)::text AS calls, coalesce(sum(amount_atomic),0)::text AS amount_atomic,
    count(DISTINCT payer)::text AS payers, count(DISTINCT seller)::text AS sellers FROM public.payments_v2`,
  resources: `SELECT resource, count(*)::text AS calls, sum(amount_atomic)::text AS amount_atomic
    FROM public.payments_v2 GROUP BY resource ORDER BY resource`,
  sellers: `SELECT seller, count(*)::text AS calls, sum(amount_atomic)::text AS amount_atomic
    FROM public.payments_v2 WHERE seller IS NOT NULL GROUP BY seller ORDER BY seller`,
  markets: `SELECT count(*)::text AS markets, coalesce(sum(gross_volume_atomic),0)::text AS gross,
    coalesce(sum(payout_atomic),0)::text AS payouts, coalesce(sum(platform_fee_atomic),0)::text AS platform,
    coalesce(sum(agent_owner_fee_atomic),0)::text AS agent_owner, coalesce(sum(dust_atomic),0)::text AS dust
    FROM public.market_settlements`,
  claims: `SELECT state, count(*)::text AS claims, sum(total_pot)::text AS total_pot
    FROM public.claims GROUP BY state ORDER BY state`,
};

async function metrics(client) {
  const out = {};
  for (const [key, sql] of Object.entries(METRICS)) out[key] = (await client.query(sql)).rows;
  return out;
}

async function readRows(client, table) {
  // Text casts preserve NUMERIC(78,0), bigint, timestamps and JSON byte content.
  const columns = table.columns.map(c => `${quote(c.name)}::text AS ${quote(c.name)}`).join(',');
  await client.query(`DECLARE snapshot_rows NO SCROLL CURSOR FOR SELECT ${columns} FROM ${tableName(table.name)}`);
  const rows = [];
  try {
    for (;;) {
      const batch = (await client.query('FETCH 2000 FROM snapshot_rows')).rows;
      if (!batch.length) break;
      rows.push(...batch);
    }
  } finally { await client.query('CLOSE snapshot_rows'); }
  return rows;
}

export async function capture(client) {
  // Refuse schema features this deliberately scoped application backup cannot
  // reproduce. Use pg_dump if the schema grows beyond plain application tables.
  const unsupported = (await client.query(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND (c.relkind IN ('v','m','f','p') OR c.relrowsecurity)
    UNION ALL SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
    UNION ALL SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typtype IN ('e','d')`)).rows;
  if (unsupported.length) throw new Error('Unsupported schema objects: use pg_dump instead');
  const names = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
  const tables = [];
  for (const { tablename: name } of names) {
    const columns = (await client.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default_expr,
      a.attidentity AS identity, a.attgenerated AS generated
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [tableName(name)])).rows;
    if (columns.some(c => c.identity || c.generated)) throw new Error('Identity/generated columns require pg_dump');
    const constraints = (await client.query(`SELECT conname AS name, pg_get_constraintdef(oid) AS definition,
      contype AS type FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname`, [tableName(name)])).rows;
    const indexes = (await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public'
      AND tablename=$1 AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid=$2::regclass)
      ORDER BY indexname`, [name, tableName(name)])).rows.map(r => r.indexdef);
    const table = { name, columns, constraints, indexes };
    table.rows = await readRows(client, table);
    table.sha256 = rowsDigest(table.rows);
    tables.push(table);
    console.log(`[backup] ${name}: ${table.rows.length} rows`);
  }
  const sequences = (await client.query(`SELECT sequencename AS name, data_type, start_value::text,
    min_value::text, max_value::text, increment_by::text, cycle, cache_size::text
    FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`)).rows;
  for (const seq of sequences) {
    Object.assign(seq, (await client.query(`SELECT last_value::text, is_called FROM ${tableName(seq.name)}`)).rows[0]);
    const owner = (await client.query(`SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_depend d JOIN pg_class c ON c.oid=d.refobjid
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.refobjsubid
      WHERE d.objid=$1::regclass AND d.deptype='a'`, [tableName(seq.name)])).rows[0];
    seq.owner = owner ?? null;
  }
  return { format: 'mimir-public-v1', capturedAt: new Date().toISOString(),
    baseline: { calls: process.env.PAYMENTS_BASELINE_CALLS ?? '0', usdc: process.env.PAYMENTS_BASELINE_USDC ?? '0' },
    tables, sequences, metrics: await metrics(client) };
}

export async function verifyDatabase(client, snapshot) {
  const names = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(r => r.tablename);
  if (JSON.stringify(names) !== JSON.stringify(snapshot.tables.map(t => t.name).sort())) throw new Error('Table set mismatch');
  for (const table of snapshot.tables) {
    const rows = await readRows(client, table);
    if (rows.length !== table.rows.length || rowsDigest(rows) !== table.sha256) throw new Error(`Row verification failed: ${table.name}`);
  }
  if (JSON.stringify(await metrics(client)) !== JSON.stringify(snapshot.metrics)) throw new Error('Frontend totals mismatch');
}

export async function restoreDatabase(client, snapshot) {
  const existing = (await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','S','v','m','f','p')`)).rows;
  if (existing.length) throw new Error('Target public schema must be empty; nothing was changed');
  for (const s of snapshot.sequences) {
    await client.query(`CREATE SEQUENCE ${tableName(s.name)} AS ${s.data_type} INCREMENT BY ${s.increment_by}
      MINVALUE ${s.min_value} MAXVALUE ${s.max_value} START WITH ${s.start_value} CACHE ${s.cache_size} ${s.cycle ? 'CYCLE' : 'NO CYCLE'}`);
  }
  for (const t of snapshot.tables) {
    await client.query(`CREATE TABLE ${tableName(t.name)} (${t.columns.map(c =>
      `${quote(c.name)} ${c.type}${c.default_expr ? ` DEFAULT ${c.default_expr}` : ''}${c.required ? ' NOT NULL' : ''}`).join(',')})`);
    for (let i = 0; i < t.rows.length; i += 500) {
      const batch = t.rows.slice(i, i + 500);
      const args = [];
      const values = batch.map(row => `(${t.columns.map(c => { args.push(row[c.name]); return `$${args.length}`; }).join(',')})`).join(',');
      await client.query(`INSERT INTO ${tableName(t.name)} (${t.columns.map(c => quote(c.name)).join(',')}) VALUES ${values}`, args);
      if ((i + 500) % 10000 === 0) console.log(`[restore] ${t.name}: ${i + batch.length}/${t.rows.length}`);
    }
    console.log(`[restore] ${t.name}: ${t.rows.length} rows loaded`);
  }
  // Foreign keys come after every referenced key has been created.
  for (const foreign of [false, true]) for (const t of snapshot.tables) for (const c of t.constraints) {
    if ((c.type === 'f') === foreign) await client.query(`ALTER TABLE ${tableName(t.name)} ADD CONSTRAINT ${quote(c.name)} ${c.definition}`);
  }
  for (const t of snapshot.tables) for (const index of t.indexes) await client.query(index);
  for (const s of snapshot.sequences) {
    if (s.owner) await client.query(`ALTER SEQUENCE ${tableName(s.name)} OWNED BY ${tableName(s.owner.table_name)}.${quote(s.owner.column_name)}`);
    // Sequence state is not MVCC: preserve at least the captured value AND row max.
    let value = BigInt(s.last_value);
    if (s.owner) {
      const max = (await client.query(`SELECT max(${quote(s.owner.column_name)})::text AS value FROM ${tableName(s.owner.table_name)}`)).rows[0].value;
      if (max !== null && BigInt(max) > value) value = BigInt(max);
    }
    await client.query('SELECT setval($1::regclass,$2::bigint,$3)', [tableName(s.name), value.toString(), s.is_called]);
  }
  console.log('[restore] verifying every table hash and frontend total before commit');
  await verifyDatabase(client, snapshot);
}

export function validateSnapshot(snapshot) {
  if (snapshot.format !== 'mimir-public-v1' || !snapshot.tables?.length) throw new Error('Unsupported/empty snapshot');
  for (const t of snapshot.tables) if (rowsDigest(t.rows) !== t.sha256) throw new Error(`Corrupt table: ${t.name}`);
}

async function main() {
  const [command, filename] = process.argv.slice(2);
  if (!['backup','restore','verify','inspect'].includes(command)) throw new Error('Usage: db-snapshot.mjs backup [file] | inspect/verify/restore <file>');
  let snapshot;
  if (command !== 'backup') {
    if (!filename) throw new Error('Snapshot filename is required');
    const bytes = await readFile(filename);
    const manifest = JSON.parse(await readFile(`${filename}.manifest.json`, 'utf8'));
    if (digest(bytes) !== manifest.sha256) throw new Error('Backup SHA-256 mismatch');
    snapshot = JSON.parse(gunzipSync(bytes).toString('utf8'));
    validateSnapshot(snapshot);
    if (command === 'inspect') { console.log(JSON.stringify(manifest, null, 2)); return; }
  }
  const url = command === 'restore' ? process.env.TARGET_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(command === 'restore' ? 'TARGET_DATABASE_URL is required' : 'DATABASE_URL is required');
  if (command === 'restore' && process.env.DATABASE_URL) {
    const a = new URL(url), b = new URL(process.env.DATABASE_URL);
    if (a.hostname.replace('-pooler','') === b.hostname.replace('-pooler','') && a.pathname === b.pathname) throw new Error('Target is the source database');
  }
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 });
  let client;
  try {
    client = await pool.connect();
    await client.query(command === 'restore' ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='120s'");
    if (command === 'backup') {
      snapshot = await capture(client);
      await client.query('COMMIT');
      const output = path.resolve(filename ?? `backups/neon-${new Date().toISOString().replace(/[:.]/g,'-')}.json.gz`);
      await mkdir(path.dirname(output), { recursive: true });
      const bytes = gzipSync(JSON.stringify(snapshot));
      await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
      const manifest = { format: snapshot.format, capturedAt: snapshot.capturedAt, sha256: digest(bytes), bytes: bytes.length,
        baseline: snapshot.baseline, tables: snapshot.tables.map(t => ({ name: t.name, rows: t.rows.length, sha256: t.sha256 })), metrics: snapshot.metrics };
      await writeFile(`${output}.manifest.json`, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(`Backup verified in memory and saved: ${output} (${bytes.length} bytes)`);
    } else {
      if (command === 'restore') await restoreDatabase(client, snapshot);
      else await verifyDatabase(client, snapshot);
      await client.query('COMMIT');
      console.log(`${command}: all table hashes and frontend totals match`);
    }
  } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client?.release(); await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database URL redacted]')); process.exitCode = 1; });
}
