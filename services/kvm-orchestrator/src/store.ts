import { promises as fs } from 'fs';
import path from 'path';
import type { StoreData } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'kvm-state.json');

const defaultStore: StoreData = {
  vms: [],
  sessions: [],
  quotas: [],
  events: [],
};

export class Store {
  private writeLock: Promise<void> = Promise.resolve();

  private async ensureFile(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(STORE_FILE);
    } catch {
      await fs.writeFile(STORE_FILE, JSON.stringify(defaultStore, null, 2), 'utf8');
    }
  }

  async read(): Promise<StoreData> {
    await this.ensureFile();
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    try {
      const parsed = JSON.parse(raw) as StoreData;
      return {
        vms: Array.isArray(parsed.vms) ? parsed.vms : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        quotas: Array.isArray(parsed.quotas) ? parsed.quotas : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch {
      return structuredClone(defaultStore);
    }
  }

  async write(data: StoreData): Promise<void> {
    await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  }

  async mutate<T>(mutator: (draft: StoreData) => Promise<T> | T): Promise<T> {
    const prev = this.writeLock;
    let release!: () => void;
    this.writeLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;
    try {
      const draft = await this.read();
      const result = await mutator(draft);
      await this.write(draft);
      return result;
    } finally {
      release();
    }
  }
}

export const store = new Store();
