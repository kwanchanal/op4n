// Dependency timeouts (Feature Inventory Order 85). One place for every bound
// so the failure matrix in docs/operations/r1-failure-matrix.md stays true.
// The redirect Worker's lookup bound must exceed DATABASE_MS plus Edge
// Function cold start, so a slow database surfaces as the API's 503 rather
// than a Worker abort.
export const TIMEOUTS = Object.freeze({
  DATABASE_MS: 3500, // Edge Function -> PostgREST RPC
  SAFETY_MS: 3000, // Edge Function -> destination safety provider
  JWKS_MS: 3000, // Edge Function -> Supabase Auth JWKS
  REDIRECT_LOOKUP_MS: 5000, // redirect Worker -> internal lookup (includes cold start)
  CLICK_MS: 3000, // redirect Worker -> click recording (after the 302)
});

export class DependencyTimeout extends Error {
  constructor(dependency) {
    super(`${dependency} timed out`);
    this.name = "DependencyTimeout";
  }
}

// Resolves with the operation's result or rejects after `ms`.
export function withTimeout(promise, ms, dependency) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DependencyTimeout(dependency)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
