# Minimal fix: Vercel SSR `createCsrfMiddleware is not a function`

## What the investigation found

Evidence gathered from the repository and installed tree (no changes made):

- `src/start.ts` usage is correct: `createCsrfMiddleware({ filter: ctx => ctx.handlerType === "serverFn" })` imported from `@tanstack/react-start`, registered in `requestMiddleware`. Identical on `origin/main` and `Security-Update-Branch`.
- The installed runtime *does* export the function: `@tanstack/react-start@1.168.32` re-exports `createCsrfMiddleware` from `@tanstack/start-client-core@1.170.14`, and that file exists in `node_modules` (runtime export, not just a type declaration).
- The TanStack dependency tree is internally consistent: `react-start` pins exact versions (`start-client-core 1.170.14`, `start-server-core 1.169.17`, `react-router 1.170.18`); no duplicate/nested copies of `start-client-core` exist in either lockfile.
- So the import is valid and the code is correct. The failure is environment-specific, not source-code specific.

The one concrete inconsistency found is the lockfile situation:

- The project contains **two lockfiles**: `bun.lock` and `package-lock.json`.
- `bun.lock` is current (`@lovable.dev/vite-tanstack-config` 2.13.1, matching `package.json`).
- `package-lock.json` is **stale**: it records `@lovable.dev/vite-tanstack-config` `^2.10.0` / resolved 2.10.0, while `package.json` pins `2.13.1`.

Vercel selects the package manager from the lockfile it detects and prefers `package-lock.json` over `bun.lock`. That means Vercel builds with a *different, stale* dependency resolution than the Lovable preview — including an older TanStack Start build plugin, whose SSR bundling/externalization behaviour differs. A stale/mismatched `npm ci` also fails or silently falls back to `npm install`, producing yet another tree. This is the most likely reason the same source builds locally but resolves a different runtime module shape on Vercel.

This is the only inconsistency the repository can prove. Whether the deployed runtime actually loaded a different `@tanstack/start-client-core` can only be confirmed from the Vercel build log.

## Plan

### Step 1 — Confirm from the Vercel build log (before changing anything)
Read the deployment's **Install** section and check:
- which package manager ran (`npm ci` / `npm install` / `bun install`)
- the installed versions of `@tanstack/react-start`, `@tanstack/start-client-core`, `@lovable.dev/vite-tanstack-config`
- any peer/resolution warnings

If it shows npm + a `start-client-core` older than 1.170.x (or a 2.10.0 build plugin), the diagnosis is confirmed. If it shows the expected versions, stop and report — do not make broad dependency changes.

### Step 2 — Make the deployed dependency tree match the verified one
Single-lockfile fix, no version bumps:
- Remove the stale `package-lock.json` so `bun.lock` (the current, verified tree) is authoritative, **or**, if the Vercel project must use npm, regenerate `package-lock.json` from the current `package.json` so it records the exact same versions as `bun.lock`.
- No `--force`, no `--legacy-peer-deps`, no unrelated upgrades, no changes to any TanStack version in `package.json`.

### Step 3 — Only if Step 1 proves an incompatible resolution remains
Pin the directly implicated TanStack packages to the exact versions already verified working (`@tanstack/react-start` 1.168.32 with its pinned `start-client-core` 1.170.14) via explicit resolutions, rather than upgrading anything.

### Not in scope for this fix
- `createServerFn().inputValidator()` deprecation warnings — cosmetic, unrelated to the runtime crash; address in a separate pass so this change stays minimal and reviewable.
- The >500 kB chunk warning — build-size advisory only.

## Security invariants preserved
No change to `src/start.ts`. `createCsrfMiddleware` stays registered in `requestMiddleware` with the `serverFn` filter. No change to auth, authorization, RLS, grants, tenant isolation, the repository boundary, or the Supabase setup.

## Validation
1. Production build completes.
2. SSR server starts; deployment boots without module-init errors.
3. `GET /` returns the rendered page, no `createCsrfMiddleware` error.
4. CSRF active: a server-function request with a foreign `Origin` returns 403; same-origin succeeds.
5. Authentication: sign-in, session persistence, `/auth` redirect for guests.
6. Server functions: workspace load, demo ingest, recommendations regenerate.
7. Tenant isolation: cross-tenant read returns empty, cross-tenant insert rejected (unchanged DB layer, re-verified as a regression check).
