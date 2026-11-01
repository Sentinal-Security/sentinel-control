# Sentinel Control Plane (`sentinel-control`)

Physically isolated Platform Super Admin Control Plane for **Sentinel Security**.

Unlike the customer-facing IAM portal (`web/`), which scopes administrators strictly to their own `company` tenant, `sentinel-control` operates at the root platform level across all workspaces using environment-backed operator credentials (`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_SECRET`).

## Core Capabilities

1. **Organization & Contract Governance**
   - View all distinct customer organizations, member counts, active sessions, connected applications, subscription tiers, and contract states.
   - **Suspend / Block Organization**: Marks `contractStatus = SUSPENDED`, immediately revokes 100% of active SSO sessions for that tenant, and blocks `/api/auth/login`, `/api/auth/google`, `/api/auth/register`, and `/api/auth/validate`.
   - **Reactivate Organization**: Restores `contractStatus = ACTIVE`.
   - **Override Subscription Tier & MFA Policy**: Directly set `COMMUNITY`, `PROFESSIONAL`, or `ENTERPRISE` and toggle organization MFA mandates.
   - **Terminate Contract (Purge Organization)**: Double-confirmed cascade purge of all sessions, app assignments, apps, recovery codes, MFA challenges, policy rows, and user accounts belonging to an organization.

2. **Cross-Tenant Global User Management**
   - Search and filter across all users globally.
   - Reassign user `company` workspace and `role` (`ADMIN`, `HR`, `FINANCE`, `DEVOPS`, `USER`).
   - Toggle `emailVerified`, lock/unlock accounts, force-logout active sessions, reset lost MFA enrollments, or delete accounts.

3. **Platform Emergency Controls & Global Audit Stream**
   - **Force Logout All Active Sessions**: Global emergency session kill switch.
   - **Purge All Tenants (Clean Slate)**: Wipes all tenant data and resets database sequences to `1` while preserving APK `build_records`.
   - **Global Security Audit Logs**: Cross-tenant audit log viewer (`PLATFORM_GOVERNANCE` and all tenant security events).

## Local Development

```bash
npm install
npm run dev
```

Runs on [http://localhost:3004](http://localhost:3004) by default and connects to `https://backend-pi68.onrender.com` (or `NEXT_PUBLIC_API_URL`, configurable directly from the login/header target selector).
