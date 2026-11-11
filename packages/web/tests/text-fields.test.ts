import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');

function walkTsx(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkTsx(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

describe('text fields', () => {
  it('exist only on the home screen — lobby/game have no typing', () => {
    const textField = /<input\b[^>]*type=["']text["']|<textarea\b|contentEditable\s*=\s*\{?true/;
    const hits = walkTsx(SRC)
      .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
      .filter((row) => textField.test(row.text))
      .map((row) => path.relative(SRC, row.file).replaceAll('\\', '/'));
    expect(hits).toEqual(['screens/HomeScreen.tsx']);
  });
});
