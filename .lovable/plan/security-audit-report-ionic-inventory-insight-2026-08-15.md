# Security Audit Report — Ionic / Inventory Insight

This document records the findings, hardening actions, and validation results from **Security Audit & Hardening Pass 1** for the Ionic / Inventory Insight application.

## Scope

Database security, Supabase security, Row-Level Security (RLS), multi-tenant isolation, security-definer functions, database privileges, audit-log protection, and Supabase Storage.

## Audit Process

1. Inventoried database functions, migrations, RLS policies, and table grants.
2. Reviewed role-based access and security-definer function definitions.
3. Identified cross-tenant and over-privilege risks.
4. Executed a targeted security hardening migration.
5. Verified tenant isolation via live PostgREST API tests with two separate user identities.

## Key Findings

### 1. Over-privileged `anon` role

**Finding:** The `anon` role held broad DML privileges on application tables. While these were blocked by RLS, the presence of unnecessary privileges increased the attack surface and violated the principle of least privilege.

**Risk:** If any RLS policy were misconfigured or bypassed, anonymous users could potentially write data.

**Action:** Revoked all table-level privileges from the `anon` role.

### 2. `authenticated` role privileges were too broad

**Finding:** The `authenticated` role had privileges beyond what RLS policies explicitly allowed, such as `DELETE` and `UPDATE` on `audit_logs`, which is intentionally append-only.

**Risk:** Users could alter or delete audit history, undermining the audit trail.

**Action:** Narrowed `authenticated` privileges to match the RLS policy set exactly:
- `audit_logs` restricted to `SELECT` and `INSERT` only.
- Other tables restricted to only the operations permitted by their RLS policies.

### 3. Cross-tenant foreign-key injection risk

**Finding:** Foreign keys from child tables (`inventory`, `sales`, `recommendations`, `purchase_orders`) to `products` and `suppliers` referenced only the primary `id` column. Because `id` is globally unique, the database could not enforce that a child record in Organization A must reference a product or supplier also in Organization A. A malicious or compromised user with write access to a child table could link records across organizations.

**Risk:** Indirect cross-tenant data leakage or corruption through FK references.

**Action:** Implemented composite foreign keys:
- Added `UNIQUE (org_id, id)` constraints on `products` and `suppliers`.
- Updated referencing tables to use composite FKs `(org_id, product_id)` and `(org_id, supplier_id)`.
- This ensures that a record in one organization cannot reference a product or supplier belonging to another organization.

### 4. Audit-log integrity could be weakened

**Finding:** `audit_logs.org_id` and `audit_logs.user_id` were nullable, allowing the possibility of orphaned or un-attributed audit entries.

**Risk:** Loss of accountability and difficulty tracing actions to a tenant or user.

**Action:** Set `audit_logs.org_id` and `audit_logs.user_id` to `NOT NULL`.

## Hardening Actions Taken

| Area | Action |
|------|--------|
| `anon` role | Revoked all table-level privileges. |
| `authenticated` role | Restricted privileges to match RLS policy allowances. |
| Cross-tenant FKs | Added composite unique constraints and composite foreign keys on `products`/`suppliers` and child tables. |
| Audit logs | Made `org_id` and `user_id` `NOT NULL`. |
| Security-definer functions | Preserved `is_org_member` and `has_org_role` as `SECURITY DEFINER` with `SET search_path = public`, executable by authenticated users to prevent RLS recursion. |
| `handle_new_user` | Confirmed it is not executable by non-privileged roles. |

## RLS and Tenant Isolation

The application uses a fail-closed RLS model:
- Every tenant-scoped table is protected by RLS policies.
- Policies check organization membership via `is_org_member` / `has_org_role` security-definer functions.
- Users can only access data belonging to organizations of which they are members.

## Validation Results

Tenant isolation was tested with two fresh user identities against the live PostgREST API:

- **User A cannot read Organization B data.** ✅ Confirmed
- **User A cannot insert, update, or delete Organization B data.** ✅ Confirmed
- **Cross-tenant foreign key linking is blocked by the database.** ✅ Confirmed
- **Self-privilege escalation is blocked.** ✅ Confirmed
- **Arbitrary organization creation is blocked.** ✅ Confirmed
- **Spoofing `user_id` or `org_id` in audit logs is blocked.** ✅ Confirmed

No RLS bypass or tenant leak was found.

## Security Memory

The project’s security memory document was updated to reflect the deliberate fail-closed architecture and the rationale for keeping `is_org_member` and `has_org_role` as security-definer functions executable by authenticated users.

## Conclusion

Security Audit & Hardening Pass 1 fixed three real weaknesses: over-privileged `anon`/`authenticated` roles, cross-tenant foreign-key risk, and nullable audit-log attribution. The multi-tenant isolation model was validated under live testing and remains fail-closed by design.