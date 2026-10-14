import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;

/** One JSON document Bureau keeps: read whole, changed under a lock. */
export interface Store<T> {
  read(): Promise<T>;
  update<R>(mutate: (state: T) => R | Promise<R>): Promise<R>;
}

/** Opens the document called `name`, starting from `initial` when there is none yet. */
export type Storage = <T>(name: string, initial: () => T) => Store<T>;

/** Each document as `<name>.json` in a directory: the default, and what development uses. */
export function fileStorage(dataDir: string): Storage {
  return (name, initial) => JsonStore.in(dataDir, `${name}.json`, initial);
}

/**
 * A tiny JSON-file store with atomic writes, safe for more than one process.
 *
 * Borrowed from fediverse-desk. Deliberately not SQLite: Bureau keeps a handful
 * of manual links, follower counts and analytics snapshots, and a file that can
 * be read with `cat` and fixed with an editor is worth more than indexes nobody
 * needs.
 *
 * It does have to tolerate concurrent writers: the web server and the MCP
 * server are separate processes over the same data directory. So there is no
 * in-memory cache (a second process's writes would be invisible behind one)
 * and every read-modify-write happens under a lock file.
 */
export class JsonStore<T> implements Store<T> {
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly initial: () => T,
  ) {}

  static in<T>(dataDir: string, filename: string, initial: () => T): JsonStore<T> {
    return new JsonStore<T>(join(dataDir, filename), initial);
  }

  /** Always from disk. Another process may have written since the last call. */
  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return this.initial();
      throw error;
    }
  }

  /**
   * Serialises mutations within this process, takes a lock file against the
   * others, and writes via a temporary file so an interrupted write cannot
   * truncate the state.
   */
  async update<R>(mutate: (state: T) => R | Promise<R>): Promise<R> {
    let result!: R;

    const next = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await this.lock();
      try {
        const state = await this.read();
        result = await mutate(state);
        const temporary = `${this.path}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.path);
      } finally {
        await this.unlock();
      }
    });

    this.writing = next.catch(() => undefined);
    await next;
    return result;
  }

  private get lockPath(): string {
    return `${this.path}.lock`;
  }

  private async lock(): Promise<void> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    for (;;) {
      try {
        // "wx" fails if the file exists, which is what makes this a lock.
        const handle = await open(this.lockPath, 'wx');
        await handle.writeFile(String(process.pid));
        await handle.close();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

        // A process killed mid-write leaves its lock behind. Break it once it is
        // older than any honest write could be.
        try {
          const info = await stat(this.lockPath);
          if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
            await rm(this.lockPath, { force: true });
            continue;
          }
        } catch {
          continue;
        }

        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for ${this.lockPath}. If no other process is running, delete it.`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }

  private async unlock(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }
}
