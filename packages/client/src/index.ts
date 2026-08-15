/**
 * `@trackt/client` — everything below the render (ADR-0008 §4).
 *
 * The Zod-validated fetch functions, the React Query hooks that wrap them, the
 * query keys and the `invalidateTracking` fan-out, plus the pure display
 * helpers both clients would otherwise re-derive: generated cover gradients,
 * URL safety, relative timestamps, history grouping.
 *
 * Nothing here renders. Components stay in their app — `GlassCard`, Radix and
 * `<View>` have no common ancestor, and a cross-platform component layer is how
 * both clients end up mediocre.
 *
 * Configure it once at startup with `configureClient()`; see `runtime.ts`.
 */
export * from './cover.js';
export * from './friends.js';
export * from './history.js';
export * from './home.js';
export * from './http.js';
export * from './kinds.js';
export * from './lists.js';
export * from './media.js';
export * from './news.js';
export * from './profile.js';
export * from './query-client.js';
export * from './runtime.js';
export * from './search.js';
export * from './url.js';
export * from './use-debounced.js';
