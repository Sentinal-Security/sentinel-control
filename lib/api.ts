export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

export interface RootSession {
  token: string;
  email: string;
  expiresAt: string;
  apiBaseUrl: string;
}

export interface PlatformOverview {
  totalOrganizations: number;
  suspendedOrganizations: number;
  totalUsers: number;
  verifiedUsers: number;
  mfaEnabledUsers: number;
  lockedUsers: number;
  activeSessions: number;
  totalServices: number;
  totalAuditLogs: number;
  databaseConnected: boolean;
  databasePingMs: number;
  emailDiagnostics?: Record<string, unknown>;
  timestamp: string;
}

export interface OrganizationRecord {
  company: string;
  userCount: number;
  adminEmails: string[];
  activeSessions: number;
  serviceCount: number;
  subscriptionTier: string;
  mfaEnforced: boolean;
  contractStatus: string;
  suspendedReason?: string | null;
  updatedAt?: string | null;
}

export interface GlobalUserRecord {
  id: number;
  email: string;
  fullName: string | null;
  company: string;
  role: string;
  subscriptionTier: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  accountLocked: boolean;
  failedAttempts: number;
  activeSessions: number;
  createdAt: string | null;
}

export interface AuditLogRecord {
  id: number;
  company: string | null;
  userId: number | null;
  userEmail: string | null;
  actionType: string;
  category: string;
  severity: string;
  targetResource: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const SESSION_KEY = "sentinel_control_root_session";
export const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://backend-pi68.onrender.com";

export function loadRootSession(): RootSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RootSession;
  } catch {
    return null;
  }
}

export function saveRootSession(session: RootSession): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearRootSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

async function requestSuperAdmin<T>(
  session: RootSession,
  path: string,
  options: RequestInit = {},
  onUnauthorized?: () => void
): Promise<ApiResponse<T>> {
  const base = session.apiBaseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      clearRootSession();
      if (onUnauthorized) onUnauthorized();
      return {
        success: false,
        message: "Root operator session expired or unauthorized. Please sign in again.",
      };
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as ApiResponse<T>;
    }
    return {
      success: false,
      message: `Unexpected gateway response (HTTP ${res.status}). Ensure backend Super Admin API is deployed.`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Network error contacting gateway (${base}): ${err instanceof Error ? err.message : "Failed to fetch"}`,
    };
  }
}

export async function loginSuperAdmin(
  apiBaseUrl: string,
  email: string,
  password: string
): Promise<ApiResponse<{ token: string; email: string; expiresAt: string }>> {
  const base = apiBaseUrl.trim().replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/superadmin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }
    if (res.status === 404) {
      return {
        success: false,
        message: "Endpoint /api/superadmin/auth/login not found (HTTP 404). Wait for Render deployment to complete or verify API URL.",
      };
    }
    return {
      success: false,
      message: `Gateway returned HTTP ${res.status}.`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Unable to reach gateway (${base}): ${err instanceof Error ? err.message : "Network failure"}`,
    };
  }
}

export function verifySuperAdminSession(
  session: RootSession,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ email: string; authenticated: boolean }>(
    session,
    "/api/superadmin/auth/verify",
    { method: "GET" },
    onUnauthorized
  );
}

export function fetchOverview(session: RootSession, onUnauthorized?: () => void) {
  return requestSuperAdmin<PlatformOverview>(
    session,
    "/api/superadmin/overview",
    { method: "GET" },
    onUnauthorized
  );
}

export function fetchOrganizations(session: RootSession, onUnauthorized?: () => void) {
  return requestSuperAdmin<OrganizationRecord[]>(
    session,
    "/api/superadmin/organizations",
    { method: "GET" },
    onUnauthorized
  );
}

export function suspendOrganization(
  session: RootSession,
  company: string,
  reason: string,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ company: string; contractStatus: string; revokedSessions: number }>(
    session,
    "/api/superadmin/organizations/suspend",
    {
      method: "POST",
      body: JSON.stringify({ company, reason }),
    },
    onUnauthorized
  );
}

export function activateOrganization(
  session: RootSession,
  company: string,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ company: string; contractStatus: string }>(
    session,
    "/api/superadmin/organizations/activate",
    {
      method: "POST",
      body: JSON.stringify({ company }),
    },
    onUnauthorized
  );
}

export function updateOrganizationPolicy(
  session: RootSession,
  company: string,
  subscriptionTier: string,
  mfaEnforced: boolean,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<Record<string, unknown>>(
    session,
    "/api/superadmin/organizations/tier",
    {
      method: "PUT",
      body: JSON.stringify({ company, subscriptionTier, mfaEnforced }),
    },
    onUnauthorized
  );
}

export function terminateOrganization(
  session: RootSession,
  company: string,
  confirmCompany: string,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ company: string; deletedUsers: number }>(
    session,
    "/api/superadmin/organizations/terminate",
    {
      method: "POST",
      body: JSON.stringify({ company, confirmCompany }),
    },
    onUnauthorized
  );
}

export function fetchAllUsers(session: RootSession, onUnauthorized?: () => void) {
  return requestSuperAdmin<GlobalUserRecord[]>(
    session,
    "/api/superadmin/users",
    { method: "GET" },
    onUnauthorized
  );
}

export function updateGlobalUser(
  session: RootSession,
  userId: number,
  payload: Partial<{
    fullName: string;
    company: string;
    role: string;
    subscriptionTier: string;
    emailVerified: boolean;
    accountLocked: boolean;
  }>,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<GlobalUserRecord>(
    session,
    `/api/superadmin/users/${userId}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
    onUnauthorized
  );
}

export function resetUserMfa(
  session: RootSession,
  userId: number,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ userId: number; mfaEnabled: boolean }>(
    session,
    `/api/superadmin/users/${userId}/reset-mfa`,
    { method: "POST" },
    onUnauthorized
  );
}

export function revokeUserSessions(
  session: RootSession,
  userId: number,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ revokedSessions: number }>(
    session,
    `/api/superadmin/users/${userId}/revoke-sessions`,
    { method: "POST" },
    onUnauthorized
  );
}

export function deleteGlobalUser(
  session: RootSession,
  userId: number,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ deletedUserId: number; email: string }>(
    session,
    `/api/superadmin/users/${userId}`,
    { method: "DELETE" },
    onUnauthorized
  );
}

export function revokeAllPlatformSessions(
  session: RootSession,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ revokedSessions: number }>(
    session,
    "/api/superadmin/system/revoke-all-sessions",
    { method: "POST" },
    onUnauthorized
  );
}

export function purgeAllTenants(
  session: RootSession,
  confirm: string,
  onUnauthorized?: () => void
) {
  return requestSuperAdmin<{ purgedUsers: number; purgedOrganizations: number }>(
    session,
    "/api/superadmin/system/purge-all-tenants",
    {
      method: "POST",
      body: JSON.stringify({ confirm }),
    },
    onUnauthorized
  );
}

export function fetchGlobalAuditLogs(
  session: RootSession,
  filters: {
    company?: string;
    category?: string;
    severity?: string;
    search?: string;
    limit?: number;
  },
  onUnauthorized?: () => void
) {
  const params = new URLSearchParams();
  if (filters.company) params.set("company", filters.company);
  if (filters.category) params.set("category", filters.category);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.search) params.set("search", filters.search);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return requestSuperAdmin<AuditLogRecord[]>(
    session,
    `/api/superadmin/audit-logs${qs ? `?${qs}` : ""}`,
    { method: "GET" },
    onUnauthorized
  );
}
