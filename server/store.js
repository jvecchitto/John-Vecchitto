// Tiny JSON-file store. Plenty for two users; swap for SQLite if it grows.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(file, initial) {
    this.file = file;
    this.initial = initial;
    this.data = null;
    this.writing = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = structuredClone(this.initial);
    }
    return this.data;
  }

  async save() {
    // Serialize writes and write atomically so a crash can't truncate the file.
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2));
      await rename(tmp, this.file);
    });
    return this.writing;
  }
}
