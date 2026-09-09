import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = process.env.CONTRACTOR_DATABASE_URL || process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error("CONTRACTOR_DATABASE_URL is not configured.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const migrationsDir = join(process.cwd(), "db", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));

for (const file of migrationFiles) {
  const migration = readFileSync(join(migrationsDir, file), "utf8");
  for (const statement of migration.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean)) {
    await sql.query(`${statement};`);
  }
}

console.log(`Contractor portal migrations applied: ${migrationFiles.length}`);
