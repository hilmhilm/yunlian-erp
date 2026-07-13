import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('yunlian_erp_migrations'))");
    await client.query("create table if not exists schema_migrations(version text primary key, applied_at timestamptz not null default now())");
    const applied = new Set((await client.query("select version from schema_migrations")).rows.map(row => row.version));
    const files = (await readdir(migrationsDirectory)).filter(file => file.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(`${migrationsDirectory}/${file}`, "utf8"));
      await client.query("insert into schema_migrations(version) values($1)", [file]);
      console.log(`Applied migration ${file}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
