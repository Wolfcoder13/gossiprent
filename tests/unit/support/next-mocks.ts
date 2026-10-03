/**
 * Stand-ins for Next's request APIs in unit tests: next/headers (a fake
 * visitor's request headers and cookie jar), next/navigation (redirect throws
 * a RedirectSignal) and next/cache (spies).
 *
 * This module imports nothing from the app, so the vi.mock factories in a test
 * file can load it without an import cycle. Wire it up as shown in harness.ts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { vi } from "vitest";

/** One fake browser: its IP (null = the server can't tell), request headers and cookie jar. */
export type Visitor = { ip: string | null; headers: Headers; cookies: Map<string, string> };

/** A new visitor whose cookie jar starts with `lang=en`, so actions answer in English. */
export function makeVisitor(ip: string | null): Visitor {
  return {
    ip,
    headers: new Headers(ip ? { "x-real-ip": ip } : {}),
    cookies: new Map([["lang", "en"]]),
  };
}

let current = makeVisitor(null);
// Lets simultaneous simulated requests each have their own visitor (see asVisitor).
const scope = new AsyncLocalStorage<Visitor>();

/** The visitor making the request that's running now. */
export function activeVisitor(): Visitor {
  return scope.getStore() ?? current;
}

/** Make `visitor` the one every request uses from now on (outside asVisitor). */
export function setCurrentVisitor(visitor: Visitor): void {
  current = visitor;
}

/** Run `request` as `visitor`, even while other requests run at the same time. */
export function asVisitor<T>(visitor: Visitor, request: () => Promise<T>): Promise<T> {
  return scope.run(visitor, request);
}

type CookieOptions = Record<string, unknown>;

export const nextHeadersMock = {
  headers: async () => activeVisitor().headers,
  cookies: async () => {
    const jar = activeVisitor().cookies;
    return {
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      has: (name: string) => jar.has(name),
      set: (nameOrCookie: string | ({ name: string; value: string } & CookieOptions), value?: string) => {
        if (typeof nameOrCookie === "string") jar.set(nameOrCookie, value ?? "");
        else jar.set(nameOrCookie.name, nameOrCookie.value);
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    };
  },
};

/** Thrown by the fake redirect(); outcome() in harness.ts turns it into `{ redirect }`. */
export class RedirectSignal extends Error {
  constructor(
    readonly url: string,
    readonly type?: "push" | "replace",
  ) {
    super(`redirect to ${url}`);
  }
}

/** Thrown by the fake notFound(). */
export class NotFoundSignal extends Error {
  constructor() {
    super("not found");
  }
}

export const nextNavigationMock = {
  redirect: (url: string, type?: "push" | "replace"): never => {
    throw new RedirectSignal(url, type);
  },
  permanentRedirect: (url: string, type?: "push" | "replace"): never => {
    throw new RedirectSignal(url, type);
  },
  notFound: (): never => {
    throw new NotFoundSignal();
  },
  RedirectType: { push: "push", replace: "replace" } as const,
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal || error instanceof NotFoundSignal) throw error;
  },
};

export const nextCacheMock = {
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  refresh: vi.fn(),
};
