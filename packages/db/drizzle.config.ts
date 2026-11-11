import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: './dist/schema/tables.js',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : {}),
});
