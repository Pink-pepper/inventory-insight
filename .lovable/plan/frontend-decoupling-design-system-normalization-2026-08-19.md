# Frontend Decoupling & Design-System Normalization

A boundary-only hardening pass. No migration, no schema/RLS/auth/privilege changes, no visual change, no new dependencies. All Supabase access stays exactly where it is today: inside server functions and the repository.

## What is already correct (preserve, do not rewrite)

- No UI component or client hook queries the database. The only client-side Supabase usage is auth (`signOut`, `getUser`, `getSession`, `signUp`, password reset) — that is auth SDK usage, not data access, and it stays.
- `src/lib/data/repository.ts` is the single data-access boundary; every server function resolves the organization server-side via `resolveOrg`.
- `src/lib/domain/model.ts` already holds canonical, non-database domain types.

So the work is narrow: close the few places where raw database row shapes still reach the UI, and tidy the token layer.

## 1. Close the remaining schema leaks

Three payloads still hand snake_case database columns straight to components:

- `getWorkspace` → `dataSources` (`rows_ingested`, `error_count`, `last_sync_at`) consumed in `data-sources.tsx`
- `getAuditLog` → `created_at`, `detail` consumed in `data-sources.tsx` and `settings.tsx`
- `buildRecommendationView` rows spread database-derived fields into the view model

Fix: add mapper functions in the repository layer that convert those rows into domain shapes (`DataSource`, `AuditEvent`, `RecommendationView`) with camelCase fields, and update the three call sites in the routes to read the new field names. Rendered output stays identical.

## 2. Domain types

Extend `src/lib/domain/model.ts` with the application-level types the UI consumes — `Organization`, `UserProfile`, `Membership role`, `DataSource`, `AuditEvent`, `PurchaseOrder`, `RecommendationView` — defined in application terms, not copied from `types.ts`. Database→domain mapping lives only in the repository. No `any`. No new folders, no provider/interface abstraction, no client-side service layer.

## 3. Design-system normalization (appearance unchanged)

Per your answer, the hex block is treated as illustrative only; the current warm-stone / forest-green oklch palette is kept byte-for-byte.

- Keep all existing `:root` / `.dark` token values exactly as they are.
- Group and comment the token block in `src/styles.css` by role (surfaces, text, brand, status, chart, sidebar) so the structure is legible.
- Replace the four hardcoded `bg-black/80` overlays in `dialog`, `sheet`, `drawer`, and `alert-dialog` with a new semantic `--overlay` token set to the same computed color, so no non-token color literals remain in app or UI code.
- No other class or layout changes.

## Verification

Typecheck, build, then a Playwright pass through sign-in → load demo data → overview, recommendations, inventory, SKU detail, data sources, settings, comparing against current rendering.

## Out of scope / stop conditions

If any step would require moving a query client-side, broadening a policy or grant, or altering organization resolution, I stop and report instead.
