import { ImportError } from '../errors.js';

/**
 * The slice of `fetch` the provider clients use, so a test can pass a stub.
 * `body` and `method` exist for the POST-shaped APIs (AniList GraphQL); the
 * scrape fetchers below take their own seam.
 *
 * `headers` is optional because only some providers put anything there worth
 * reading (Trakt's page count), and a client that ignores it must not have to
 * fabricate one.
 */
export type FetchLike = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers?: Record<string, string>;
}>;

/** What a public web page expects to see; several providers 403 a bare client. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * One HTML page, fetched however the operator is willing to pay for it. Scrape
 * sources take this instead of a `fetch`: what Cloudflare refuses to plain HTTP,
 * a headless browser can still read, and the parser never knows which ran.
 */
export interface PageFetcher {
  get(url: string): Promise<{ status: number; body: string }>;
}

/** A fetcher that holds something open (a browser) and says so. */
export interface DisposablePageFetcher extends PageFetcher {
  dispose(): Promise<void>;
}

/** The slice of `fetch` a page fetcher needs: a status and the raw body. */
export type TextFetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface HttpFetcherOptions {
  /** Politeness delay between two requests; a plain scrape is a guest on the site. */
  requestSpacingMs?: number;
  /** Hard budget: past it the import stops rather than hammering a site. */
  maxRequests?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Injected transport, so tests need no network. */
  fetch?: TextFetchLike;
}

const DEFAULT_SPACING_MS = 1000;
const DEFAULT_MAX_REQUESTS = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The default fetcher: `fetch` with a browser user-agent, a delay between
 * requests, a timeout per request and a total request budget.
 */
export function createHttpFetcher(options: HttpFetcherOptions = {}): PageFetcher {
  const {
    requestSpacingMs = DEFAULT_SPACING_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    userAgent = BROWSER_USER_AGENT,
    fetch = globalThis.fetch as unknown as TextFetchLike,
  } = options;

  let requests = 0;
  let lastRequestAt = 0;

  async function get(url: string): Promise<{ status: number; body: string }> {
    if (requests >= maxRequests) {
      throw new ImportError(
        `stopped after ${maxRequests} requests — the import's request budget; raise maxRequests to go further`,
        'http',
        null,
      );
    }
    if (lastRequestAt > 0) await sleep(requestSpacingMs - (Date.now() - lastRequestAt));
    requests += 1;
    lastRequestAt = Date.now();

    let response: Awaited<ReturnType<TextFetchLike>>;
    try {
      response = await fetch(url, {
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ImportError(
        `could not reach ${new URL(url).host}: ${describe(error)}`,
        'http',
        null,
      );
    }
    return { status: response.status, body: await response.text() };
  }

  return { get };
}

interface BrowserResponse {
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}

interface BrowserPage {
  goto(
    url: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number },
  ): Promise<BrowserResponse | null>;
  content(): Promise<string>;
  close(): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface Browser {
  newContext(options: { userAgent: string }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface BrowserType {
  launch(options: { headless: boolean }): Promise<Browser>;
  connectOverCDP(endpoint: string): Promise<Browser>;
}

const BROWSER_INSTALL_HINT = 'pnpm add -w playwright && pnpm exec playwright install chromium';

export interface BrowserFetcherOptions {
  /** Attach to an already-running Chromium instead of launching one. */
  wsEndpoint?: string;
  userAgent?: string;
  timeoutMs?: number;
}

/**
 * Renders each page in headless Chromium, which is what gets past a Cloudflare
 * interstitial. `playwright` is deliberately not a dependency: the import only
 * works after the operator installs it, and a missing package is its own error
 * rather than something the whole package has to carry.
 *
 * The browser launches on the first `get`, and `dispose()` closes it — call it,
 * or the process keeps a Chromium alive.
 */
export function createBrowserFetcher(options: BrowserFetcherOptions = {}): DisposablePageFetcher {
  const wsEndpoint = options.wsEndpoint ?? process.env.PLAYWRIGHT_WS_ENDPOINT;
  const userAgent = options.userAgent ?? BROWSER_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? 30_000;

  let session: Promise<{ browser: Browser; context: BrowserContext }> | null = null;

  async function open(): Promise<{ browser: Browser; context: BrowserContext }> {
    let chromium: BrowserType;
    try {
      // A computed specifier keeps TypeScript from requiring the package to exist.
      const moduleName = 'playwright';
      ({ chromium } = (await import(moduleName)) as { chromium: BrowserType });
    } catch {
      throw new ImportError(
        `this source needs a browser and playwright is not installed — run: ${BROWSER_INSTALL_HINT}`,
        'browser',
        null,
      );
    }
    try {
      const browser = wsEndpoint
        ? await chromium.connectOverCDP(wsEndpoint)
        : await chromium.launch({ headless: true });
      return { browser, context: await browser.newContext({ userAgent }) };
    } catch (error) {
      throw new ImportError(`could not start the browser: ${describe(error)}`, 'browser', null);
    }
  }

  function ensureSession(): Promise<{ browser: Browser; context: BrowserContext }> {
    // A failed launch must not be cached: the next get retries instead of
    // replaying the same rejection forever.
    session ??= open().catch((error: unknown) => {
      session = null;
      throw error;
    });
    return session;
  }

  async function get(url: string): Promise<{ status: number; body: string }> {
    const { context } = await ensureSession();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      const status = response?.status() ?? 0;
      const contentType = response?.headers()['content-type'] ?? '';
      // Chromium wraps a JSON body in its own viewer, so `content()` is markup
      // around the payload. A scrape source that reads an endpoint wants the
      // body it asked for, not the viewer.
      if (response && /json/i.test(contentType)) {
        return { status, body: await response.text() };
      }
      return { status, body: await page.content() };
    } catch (error) {
      throw new ImportError(
        `the browser could not load ${url}: ${describe(error)}`,
        'browser',
        null,
      );
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async function dispose(): Promise<void> {
    const current = session ? await session.catch(() => null) : null;
    session = null;
    if (!current) return;
    await current.context.close().catch(() => undefined);
    await current.browser.close().catch(() => undefined);
  }

  return { get, dispose };
}

const CHALLENGE_MARKERS = [/just a moment/i, /cf-chl/i, /attention required/i];

/**
 * Cloudflare's interstitial, recognised from the response alone. The short-body
 * rule exists because the real page is served at more than one size, and a
 * challenge that fits in 2 KB is never a Letterboxd page.
 */
export function looksLikeChallenge(status: number, body: string): boolean {
  if (body.length < 2048 && /<title>\s*just a moment/i.test(body)) return true;
  if (status !== 403 && status !== 429) return false;
  return CHALLENGE_MARKERS.some((marker) => marker.test(body));
}

export type ImportFetchMode = 'http' | 'browser' | 'fallback';

export interface ImportFetcherOptions extends HttpFetcherOptions, BrowserFetcherOptions {
  /** Defaults to `IMPORT_FETCH_MODE`, then `'http'`. */
  mode?: ImportFetchMode;
}

function readFetchMode(): ImportFetchMode {
  const raw = process.env.IMPORT_FETCH_MODE?.trim().toLowerCase();
  if (!raw) return 'http';
  if (raw === 'http' || raw === 'browser' || raw === 'fallback') return raw;
  throw new ImportError(
    `unknown IMPORT_FETCH_MODE "${raw}" — use http, browser or fallback`,
    'http',
    null,
  );
}

/**
 * The scrape sources' entry point: one fetcher, chosen by the operator.
 *
 * `fallback` asks plain HTTP first and only escalates when the answer is a
 * Cloudflare challenge — then remembers the host, so a 500-item import does not
 * pay a doomed request per page.
 */
export function createImportFetcher(options: ImportFetcherOptions = {}): DisposablePageFetcher {
  const mode = options.mode ?? readFetchMode();

  if (mode === 'http') {
    const http = createHttpFetcher(options);
    return { get: http.get, dispose: async () => undefined };
  }

  const browser = createBrowserFetcher(options);
  if (mode === 'browser') return browser;

  const http = createHttpFetcher(options);
  const browserHosts = new Set<string>();

  async function get(url: string): Promise<{ status: number; body: string }> {
    const host = new URL(url).host;
    if (browserHosts.has(host)) return browser.get(url);
    const page = await http.get(url);
    if (!looksLikeChallenge(page.status, page.body)) return page;
    browserHosts.add(host);
    return browser.get(url);
  }

  return { get, dispose: browser.dispose };
}
