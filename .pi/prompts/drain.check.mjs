import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const prompt = readFileSync(new URL('./drain.md', import.meta.url), 'utf8');

for (const clause of [
  'ready-for-agent',
  'every native blocker is closed',
  'no open sub-issues',
  'one source writer',
  'Never auto-merge',
  'Maximum two fix rounds',
  'Closes #<number>',
  'ready-for-human',
  "${1:-all}",
]) assert.ok(prompt.includes(clause), `missing drain contract clause: ${clause}`);

assert.ok(!prompt.includes('.fleet/'), 'drain must not depend on Fleet state');
console.log('drain prompt contract OK');
