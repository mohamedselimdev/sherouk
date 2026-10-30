import { createContext } from "react-router";
import { createDb, type Db, type DbHandle } from "./db";
import type { AppEnv } from "./env";
import { buildPaymob } from "./payments";

/**
 * Per-request resources. Database pools are opened lazily (a request that never touches the DB never connects)
 * and closed together when the response is finished.
 */
export class RequestScope {
  private handles: DbHandle[] = [];
  private _db?: Db;
  private _catalogDb?: Db;

  constructor(
    readonly env: AppEnv,
    readonly correlationId: string,
  ) {}

  /** Cache-disabled Hyperdrive binding: sessions, permissions, cart, checkout, stock, payments, admin. */
  get db(): Db {
    if (!this._db) {
      const h = createDb(this.env.HYPERDRIVE.connectionString);
      this.handles.push(h);
      this._db = h.db;
    }
    return this._db;
  }

  /** Cached binding. Public catalog/content reads only; never use it for stock, price validation or anything after a write. */
  get catalogDb(): Db {
    if (!this._catalogDb) {
      const h = createDb(this.env.HYPERDRIVE_CATALOG.connectionString);
      this.handles.push(h);
      this._catalogDb = h.db;
    }
    return this._catalogDb;
  }

  get authConfig() {
    return { sessionSecret: this.env.SESSION_SECRET, mfaKey: this.env.MFA_ENCRYPTION_KEY };
  }

  /** Paymob adapter, or null while credentials are missing. */
  get paymob() {
    return buildPaymob(this.env);
  }

  get onlinePaymentsEnabled(): boolean {
    return this.paymob !== null;
  }

  get allowCod(): boolean {
    return this.env.ENABLE_COD === "true";
  }

  get secureCookies(): boolean {
    return this.env.SITE_URL.startsWith("https://");
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.handles.map((h) => h.close()));
    this.handles = [];
  }
}

export const scopeContext = createContext<RequestScope>();
