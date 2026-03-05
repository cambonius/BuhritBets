import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
const eventsFile = path.join(dataDir, 'events.jsonl');
const tokenFile = path.join(dataDir, 'token.json');

export async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function appendEvent(event) {
  const line = JSON.stringify(event);
  await fs.appendFile(eventsFile, `${line}\n`, 'utf8');
}

// --- Token persistence ---
export async function saveToken(tokenData) {
  await fs.writeFile(tokenFile, JSON.stringify(tokenData, null, 2), 'utf8');
}

export async function loadToken() {
  try {
    const content = await fs.readFile(tokenFile, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

export async function readLastEvents(limit = 50) {
  try {
    const content = await fs.readFile(eventsFile, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const slice = lines.slice(Math.max(0, lines.length - limit));
    return slice.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { parse_error: true, raw: l };
      }
    });
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
}
