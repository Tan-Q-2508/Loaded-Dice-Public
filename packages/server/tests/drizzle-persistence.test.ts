import { describe, expect, it } from 'vitest';
import {
  createDrizzlePersistence,
  drizzlePersistenceContractSmoke,
  postgresClientOptions,
} from '../src/drizzle-persistence.js';

describe('DrizzlePersistence wiring', () => {
  it('contract smoke documents adapter selection', () => {
    expect(drizzlePersistenceContractSmoke()).toEqual({
      requiresUrl: true,
      adapterName: 'DrizzlePersistence',
    });
  });

  it('createDrizzlePersistence rejects empty DATABASE_URL', () => {
    expect(() => createDrizzlePersistence('')).toThrow(/DATABASE_URL/);
    expect(() => createDrizzlePersistence('   ')).toThrow(/DATABASE_URL/);
  });

  it('postgresClientOptions disables prepared statements and requires SSL off-localhost', () => {
    expect(postgresClientOptions('postgres://u:p@db.example.supabase.co:5432/postgres')).toEqual({
      max: 10,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      connection: { statement_timeout: 8_000 },
      ssl: 'require',
    });
    expect(postgresClientOptions('postgres://u:p@127.0.0.1:5432/shaatir_test')).toEqual({
      max: 10,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      connection: { statement_timeout: 8_000 },
    });
  });

  it('createDrizzlePersistence constructs with a URL (no query issued)', () => {
    // postgres.js is lazy — construction does not require a live server.
    const persist = createDrizzlePersistence(
      'postgres://user:pass@127.0.0.1:5432/shaatir_test',
    );
    expect(persist.isAvailable()).toBe(true);
    persist.setAvailable(false);
    expect(persist.isAvailable()).toBe(false);
    void persist.close();
  });
});
