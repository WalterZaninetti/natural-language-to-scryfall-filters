import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchGroundingIndex } from './refresh.ts';

const target = path.join(import.meta.dirname, 'snapshot.json');
const index = await fetchGroundingIndex();
await writeFile(target, `${JSON.stringify(index, null, 2)}\n`);

console.log(
  `snapshot.json written: ${String(index.sets.length)} sets, ${String(index.keywords.length)} keywords, ` +
    `${String(index.types.length)} types, ${String(index.watermarks.length)} watermarks`,
);
