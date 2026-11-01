"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_API_BASE_URL,
  RootSession,
  PlatformOverview,
  OrganizationRecord,
  GlobalUserRecord,
  AuditLogRecord,
  loadRootSession,
  saveRootSession,
  clearRootSession,
  loginSuperAdmin,
  verifySuperAdminSession,
  fetchOverview,
  fetchOrganizations,
  suspendOrganization,
  activateOrganization,
  updateOrganizationPolicy,
  terminateOrganization,
  fetchAllUsers,
  updateGlobalUser,
  resetUserMfa,
  revokeUserSessions,
  deleteGlobalUser,
  revokeAllPlatformSessions,
  purgeAllTenants,
  fetchGlobalAuditLogs,
} from "@/lib/api";

type ActiveTab = "overview" | "organizations" | "users" | "audit";

interface UserDraft {
  fullName: string;
  company: string;
  role: string;
  subscriptionTier: string;
  emailVerified: boolean;
  accountLocked: boolean;
}

interface OrgDraft {
  subscriptionTier: string;
  mfaEnforced: boolean;
  suspendReason: string;
}

export default function SentinelControlPage() {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<RootSession | null>(null);

  // Login Gate State
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [loginEmail, setLoginEmail] = useState("root@sentinel.security");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Console Navigation & Feedback
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Data Stores
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [orgDrafts, setOrgDrafts] = useState<Record<string, OrgDraft>>({});
  const [users, setUsers] = useState<GlobalUserRecord[]>([]);
  const [userDrafts, setUserDrafts] = useState<Record<number, UserDraft>>({});
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  // Inline Confirmations & Filters
  const [confirmGlobalLogout, setConfirmGlobalLogout] = useState(false);
  const [purgeConfirmInput, setPurgeConfirmInput] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [terminatingOrg, setTerminatingOrg] = useState<string | null>(null);
  const [terminateOrgInput, setTerminateOrgInput] = useState("");

  const [userSearch, setUserSearch] = useState("");
  const [userCompanyFilter, setUserCompanyFilter] = useState("");
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);

  const [auditCompany, setAuditCompany] = useState("");
  const [auditCategory, setAuditCategory] = useState("");
  const [auditSeverity, setAuditSeverity] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditLimit, setAuditLimit] = useState(100);

  const handleUnauthorized = useCallback(() => {
    clearRootSession();
    setSession(null);
    setLoginError("Root operator session expired or invalidated. Please sign in again.");
  }, []);

  const syncOrgDrafts = (rows: OrganizationRecord[]) => {
    const next: Record<string, OrgDraft> = {};
    for (const r of rows) {
      next[r.company] = {
        subscriptionTier: r.subscriptionTier || "COMMUNITY",
        mfaEnforced: Boolean(r.mfaEnforced),
        suspendReason: r.suspendedReason || "Contract suspended by platform operations.",
      };
    }
    setOrgDrafts(next);
  };

  const syncUserDrafts = (rows: GlobalUserRecord[]) => {
    const next: Record<number, UserDraft> = {};
    for (const u of rows) {
      next[u.id] = {
        fullName: u.fullName || "",
        company: u.company || "default",
        role: u.role || "USER",
        subscriptionTier: u.subscriptionTier || "COMMUNITY",
        emailVerified: Boolean(u.emailVerified),
        accountLocked: Boolean(u.accountLocked),
      };
    }
    setUserDrafts(next);
  };

  const refreshAllData = useCallback(
    async (activeSession: RootSession) => {
      setBusyAction("refresh");
      const [ovRes, orgRes, usrRes, logRes] = await Promise.all([
        fetchOverview(activeSession, handleUnauthorized),
        fetchOrganizations(activeSession, handleUnauthorized),
        fetchAllUsers(activeSession, handleUnauthorized),
        fetchGlobalAuditLogs(
          activeSession,
          {
            company: auditCompany || undefined,
            category: auditCategory || undefined,
            severity: auditSeverity || undefined,
            search: auditSearch || undefined,
            limit: auditLimit,
          },
          handleUnauthorized
        ),
      ]);
      setBusyAction(null);

      if (ovRes.success && ovRes.data) setOverview(ovRes.data);
      if (orgRes.success && orgRes.data) {
        setOrganizations(orgRes.data);
        syncOrgDrafts(orgRes.data);
      }
      if (usrRes.success && usrRes.data) {
        setUsers(usrRes.data);
        syncUserDrafts(usrRes.data);
      }
      if (logRes.success && logRes.data) {
        setAuditLogs(logRes.data);
      }
      if (!ovRes.success) {
        setBanner({ type: "err", text: ovRes.message });
      }
    },
    [auditCategory, auditCompany, auditLimit, auditSearch, auditSeverity, handleUnauthorized]
  );

  useEffect(() => {
    const stored = loadRootSession();
    if (stored) {
      setApiBaseUrl(stored.apiBaseUrl);
      verifySuperAdminSession(stored, handleUnauthorized).then((res) => {
        if (res.success) {
          setSession(stored);
          refreshAllData(stored);
        } else {
          clearRootSession();
        }
        setHydrated(true);
      });
    } else {
      setHydrated(true);
    }
  }, [handleUnauthorized, refreshAllData]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    const res = await loginSuperAdmin(apiBaseUrl, loginEmail, loginPassword);
    setLoginLoading(false);

    if (!res.success || !res.data) {
      setLoginError(res.message || "Authentication failed.");
      return;
    }

    const newSession: RootSession = {
      token: res.data.token,
      email: res.data.email,
      expiresAt: res.data.expiresAt,
      apiBaseUrl: apiBaseUrl.trim().replace(/\/+$/, ""),
    };
    saveRootSession(newSession);
    setSession(newSession);
    setLoginPassword("");
    setBanner({ type: "ok", text: "Authenticated as Sentinel Root Operator." });
    refreshAllData(newSession);
  };

  const handleLogout = () => {
    clearRootSession();
    setSession(null);
    setOverview(null);
    setOrganizations([]);
    setUsers([]);
    setAuditLogs([]);
    setBanner(null);
  };

  // =========================================================================
  // Emergency Global Actions
  // =========================================================================

  const handleForceLogoutAll = async () => {
    if (!session) return;
    setBusyAction("global-logout");
    const res = await revokeAllPlatformSessions(session, handleUnauthorized);
    setBusyAction(null);
    setConfirmGlobalLogout(false);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handlePurgeAllTenants = async () => {
    if (!session) return;
    setBusyAction("global-purge");
    const res = await purgeAllTenants(session, purgeConfirmInput, handleUnauthorized);
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) {
      setPurgeConfirmInput("");
      refreshAllData(session);
    }
  };

  // =========================================================================
  // Organization Governance Actions
  // =========================================================================

  const handleSaveOrgPolicy = async (company: string) => {
    if (!session) return;
    const draft = orgDrafts[company];
    if (!draft) return;
    setBusyAction(`org-policy-${company}`);
    const res = await updateOrganizationPolicy(
      session,
      company,
      draft.subscriptionTier,
      draft.mfaEnforced,
      handleUnauthorized
    );
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleSuspendOrg = async (company: string) => {
    if (!session) return;
    const reason = orgDrafts[company]?.suspendReason || "Contract suspended by platform operations.";
    setBusyAction(`org-suspend-${company}`);
    const res = await suspendOrganization(session, company, reason, handleUnauthorized);
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleActivateOrg = async (company: string) => {
    if (!session) return;
    setBusyAction(`org-activate-${company}`);
    const res = await activateOrganization(session, company, handleUnauthorized);
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleTerminateOrg = async (company: string) => {
    if (!session) return;
    setBusyAction(`org-terminate-${company}`);
    const res = await terminateOrganization(
      session,
      company,
      terminateOrgInput,
      handleUnauthorized
    );
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) {
      setTerminatingOrg(null);
      setTerminateOrgInput("");
      refreshAllData(session);
    }
  };

  // =========================================================================
  // Global User Management Actions
  // =========================================================================

  const handleSaveUser = async (userId: number) => {
    if (!session) return;
    const draft = userDrafts[userId];
    if (!draft) return;
    setBusyAction(`user-save-${userId}`);
    const res = await updateGlobalUser(session, userId, draft, handleUnauthorized);
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleResetUserMfa = async (userId: number) => {
    if (!session) return;
    setBusyAction(`user-mfa-${userId}`);
    const res = await resetUserMfa(session, userId, handleUnauthorized);
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleRevokeUserSessions = async (userId: number) => {
    if (!session) return;
    setBusyAction(`user-logout-${userId}`);
    const res = await revokeUserSessions(session, userId, handleUnauthorized);
    setBusyAction(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleDeleteUser = async (userId: number) => {
    if (!session) return;
    setBusyAction(`user-delete-${userId}`);
    const res = await deleteGlobalUser(session, userId, handleUnauthorized);
    setBusyAction(null);
    setConfirmDeleteUserId(null);
    setBanner({ type: res.success ? "ok" : "err", text: res.message });
    if (res.success) refreshAllData(session);
  };

  const handleFilterAuditLogs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setBusyAction("audit-filter");
    const res = await fetchGlobalAuditLogs(
      session,
      {
        company: auditCompany || undefined,
        category: auditCategory || undefined,
        severity: auditSeverity || undefined,
        search: auditSearch || undefined,
        limit: auditLimit,
      },
      handleUnauthorized
    );
    setBusyAction(null);
    if (res.success && res.data) {
      setAuditLogs(res.data);
    } else {
      setBanner({ type: "err", text: res.message });
    }
  };

  // Filtered Lists
  const filteredOrgs = useMemo(() => {
    const q = orgFilter.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter(
      (o) =>
        o.company.toLowerCase().includes(q) ||
        o.contractStatus.toLowerCase().includes(q) ||
        o.adminEmails.some((e) => e.toLowerCase().includes(q))
    );
  }, [organizations, orgFilter]);

  const distinctUserCompanies = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      if (u.company) set.add(u.company);
    }
    return Array.from(set).sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (userCompanyFilter && u.company.toLowerCase() !== userCompanyFilter.toLowerCase()) {
        return false;
      }
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (u.fullName || "").toLowerCase().includes(q) ||
        u.company.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        String(u.id) === q
      );
    });
  }, [users, userSearch, userCompanyFilter]);

  if (!hydrated) {
    return <div>Initializing Sentinel Control Plane...</div>;
  }

  // =========================================================================
  // Unauthenticated View: Bare Root Operator Login Gate
  // =========================================================================

  if (!session) {
    return (
      <div style={{ maxWidth: "560px" }}>
        <h1>SENTINEL SECURITY - PLATFORM SUPER ADMIN CONTROL PLANE</h1>
        <p>
          Isolated root operator console. Authenticates against environment-backed platform
          credentials (immune to tenant database resets).
        </p>
        <hr />

        {loginError && <div className="banner-err">[AUTH ERROR] {loginError}</div>}

        <form onSubmit={handleLoginSubmit}>
          <fieldset>
            <legend>Root Operator Sign-In</legend>
            <div style={{ marginBottom: "8px" }}>
              <label htmlFor="api-url" style={{ display: "block", marginBottom: "3px" }}>
                API Gateway Base URL:
              </label>
              <div className="row-inline">
                <input
                  id="api-url"
                  type="url"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  style={{ width: "360px" }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setApiBaseUrl("https://backend-pi68.onrender.com")}
                >
                  Prod (Render)
                </button>
                <button
                  type="button"
                  onClick={() => setApiBaseUrl("http://localhost:8080")}
                >
                  Local (:8080)
                </button>
              </div>
            </div>

            <div style={{ marginBottom: "8px" }}>
              <label htmlFor="root-email" style={{ display: "block", marginBottom: "3px" }}>
                Root Operator Email (SUPER_ADMIN_EMAIL):
              </label>
              <input
                id="root-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                style={{ width: "360px" }}
                required
              />
            </div>

            <div style={{ marginBottom: "10px" }}>
              <label htmlFor="root-password" style={{ display: "block", marginBottom: "3px" }}>
                Root Operator Password (SUPER_ADMIN_PASSWORD):
              </label>
              <input
                id="root-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{ width: "360px" }}
                required
              />
            </div>

            <button type="submit" disabled={loginLoading}>
              {loginLoading ? "Authenticating..." : "Authenticate Root Session"}
            </button>
          </fieldset>
        </form>
      </div>
    );
  }

  // =========================================================================
  // Authenticated View: Root Control Plane Console
  // =========================================================================

  return (
    <div>
      <div className="row-inline" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>SENTINEL CONTROL PLANE [ROOT OPERATOR]</h1>
          <div>
            Operator: <strong>{session.email}</strong> | Gateway:{" "}
            <code>{session.apiBaseUrl}</code> | Token Expires:{" "}
            <code>{session.expiresAt}</code>
          </div>
        </div>
        <div className="row-inline">
          <button
            type="button"
            onClick={() => refreshAllData(session)}
            disabled={busyAction === "refresh"}
          >
            {busyAction === "refresh" ? "Refreshing..." : "Refresh All Data"}
          </button>
          <button type="button" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>

      <hr />

      {/* Navigation Bar */}
      <div className="row-inline" style={{ marginBottom: "12px" }}>
        <button
          type="button"
          className={activeTab === "overview" ? "active-tab" : ""}
          onClick={() => setActiveTab("overview")}
        >
          1. Overview &amp; Emergency Controls
        </button>
        <button
          type="button"
          className={activeTab === "organizations" ? "active-tab" : ""}
          onClick={() => setActiveTab("organizations")}
        >
          2. Organizations &amp; Contracts ({organizations.length})
        </button>
        <button
          type="button"
          className={activeTab === "users" ? "active-tab" : ""}
          onClick={() => setActiveTab("users")}
        >
          3. Global Users ({users.length})
        </button>
        <button
          type="button"
          className={activeTab === "audit" ? "active-tab" : ""}
          onClick={() => setActiveTab("audit")}
        >
          4. Global Security Audit Logs ({auditLogs.length})
        </button>
      </div>

      {banner && (
        <div className={banner.type === "ok" ? "banner-ok" : "banner-err"}>
          <div className="row-inline" style={{ justifyContent: "space-between" }}>
            <span>
              [{banner.type === "ok" ? "OK" : "ERROR"}] {banner.text}
            </span>
            <button type="button" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1: OVERVIEW & EMERGENCY CONTROLS                                */}
      {/* =================================================================== */}
      {activeTab === "overview" && (
        <div>
          <h2>Platform Telemetry &amp; Global Metrics</h2>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Total Organizations (Workspaces)</td>
                <td>{overview ? overview.totalOrganizations : "-"}</td>
                <td>
                  Suspended Contracts:{" "}
                  <strong>{overview ? overview.suspendedOrganizations : "-"}</strong>
                </td>
              </tr>
              <tr>
                <td>Total Registered Users</td>
                <td>{overview ? overview.totalUsers : "-"}</td>
                <td>
                  Verified: {overview ? overview.verifiedUsers : "-"} | MFA Active:{" "}
                  {overview ? overview.mfaEnabledUsers : "-"} | Locked:{" "}
                  {overview ? overview.lockedUsers : "-"}
                </td>
              </tr>
              <tr>
                <td>Active SSO Sessions</td>
                <td>{overview ? overview.activeSessions : "-"}</td>
                <td>Non-revoked, non-expired sessions across all workspaces</td>
              </tr>
              <tr>
                <td>Configured SSO Applications</td>
                <td>{overview ? overview.totalServices : "-"}</td>
                <td>Total tenant-registered application integrations</td>
              </tr>
              <tr>
                <td>Security Audit Log Entries</td>
                <td>{overview ? overview.totalAuditLogs : "-"}</td>
                <td>Cross-tenant + PLATFORM_GOVERNANCE audit records</td>
              </tr>
              <tr>
                <td>Database Vault Status</td>
                <td>
                  {overview ? (
                    <span className={overview.databaseConnected ? "status-active" : "status-suspended"}>
                      [{overview.databaseConnected ? "CONNECTED" : "UNREACHABLE"}]
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  Supabase PostgreSQL Ping:{" "}
                  {overview && overview.databasePingMs >= 0
                    ? `${overview.databasePingMs} ms`
                    : "N/A"}
                </td>
              </tr>
              <tr>
                <td>Transactional Email Gateway</td>
                <td>
                  {overview?.emailDiagnostics
                    ? String(overview.emailDiagnostics.primaryProvider || "Configured")
                    : "-"}
                </td>
                <td>
                  {overview?.emailDiagnostics
                    ? `Brevo: ${String(overview.emailDiagnostics.brevoStatus || "N/A")} | Sender: ${String(
                        overview.emailDiagnostics.brevoSender || "N/A"
                      )}`
                    : "Diagnostics unavailable"}
                </td>
              </tr>
            </tbody>
          </table>

          <hr />

          <h2>Global Emergency Platform Controls</h2>

          <fieldset>
            <legend>Emergency Control 1: Global Session Kill Switch</legend>
            <p>
              Immediately revokes 100% of active SSO tokens across every organization and forces
              all connected web/SSO sessions to re-authenticate.
            </p>
            {!confirmGlobalLogout ? (
              <button
                type="button"
                className="danger-btn"
                onClick={() => setConfirmGlobalLogout(true)}
              >
                Force Logout All Active Sessions...
              </button>
            ) : (
              <div className="row-inline">
                <span>Confirm global session revocation across all tenants?</span>
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busyAction === "global-logout"}
                  onClick={handleForceLogoutAll}
                >
                  {busyAction === "global-logout"
                    ? "Revoking..."
                    : "CONFIRM FORCE LOGOUT ALL"}
                </button>
                <button type="button" onClick={() => setConfirmGlobalLogout(false)}>
                  Cancel
                </button>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Emergency Control 2: Clean-Slate Tenant Purge</legend>
            <p>
              Permanently deletes all tenant users, sessions, app integrations, MFA challenges,
              recovery codes, organization policies, and audit logs, resetting sequences to 1.
              APK <code>build_records</code> are strictly preserved.
            </p>
            <div className="row-inline">
              <label htmlFor="purge-confirm">
                Type <code>PURGE_ALL_TENANTS</code> to unlock:
              </label>
              <input
                id="purge-confirm"
                type="text"
                value={purgeConfirmInput}
                onChange={(e) => setPurgeConfirmInput(e.target.value)}
                placeholder="PURGE_ALL_TENANTS"
              />
              <button
                type="button"
                className="danger-btn"
                disabled={
                  purgeConfirmInput.trim() !== "PURGE_ALL_TENANTS" ||
                  busyAction === "global-purge"
                }
                onClick={handlePurgeAllTenants}
              >
                {busyAction === "global-purge"
                  ? "Purging Platform..."
                  : "Execute Purge All Tenants"}
              </button>
            </div>
          </fieldset>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: ORGANIZATIONS & CONTRACT GOVERNANCE                          */}
      {/* =================================================================== */}
      {activeTab === "organizations" && (
        <div>
          <h2>Organization Workspaces &amp; Contract Governance</h2>
          <div className="row-inline" style={{ marginBottom: "8px" }}>
            <label htmlFor="org-search">Filter Organizations:</label>
            <input
              id="org-search"
              type="text"
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              placeholder="company domain, admin email, status..."
              style={{ width: "280px" }}
            />
          </div>

          {filteredOrgs.length === 0 ? (
            <p>No tenant organizations found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Company Workspace</th>
                  <th>Contract Status</th>
                  <th>Members / Admins</th>
                  <th>Sessions / Apps</th>
                  <th>Tier &amp; MFA Policy Override</th>
                  <th>Block / Suspend / Terminate Contract</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrgs.map((org) => {
                  const draft = orgDrafts[org.company] || {
                    subscriptionTier: org.subscriptionTier,
                    mfaEnforced: org.mfaEnforced,
                    suspendReason: org.suspendedReason || "Contract suspended by platform operations.",
                  };
                  const isSuspended = org.contractStatus === "SUSPENDED";

                  return (
                    <tr key={org.company}>
                      <td>
                        <strong>{org.company}</strong>
                        <div style={{ marginTop: "4px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setUserCompanyFilter(org.company);
                              setActiveTab("users");
                            }}
                          >
                            View Users
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={isSuspended ? "status-suspended" : "status-active"}>
                          [{org.contractStatus}]
                        </span>
                        {isSuspended && org.suspendedReason && (
                          <div style={{ marginTop: "4px", fontSize: "11px" }}>
                            Reason: {org.suspendedReason}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>Users: {org.userCount}</div>
                        <div style={{ fontSize: "11px" }}>
                          Admins:{" "}
                          {org.adminEmails.length > 0 ? org.adminEmails.join(", ") : "None"}
                        </div>
                      </td>
                      <td>
                        <div>Active Sessions: {org.activeSessions}</div>
                        <div>Connected Apps: {org.serviceCount}</div>
                      </td>
                      <td>
                        <div className="row-inline" style={{ marginBottom: "4px" }}>
                          <select
                            value={draft.subscriptionTier}
                            onChange={(e) =>
                              setOrgDrafts((prev) => ({
                                ...prev,
                                [org.company]: {
                                  ...draft,
                                  subscriptionTier: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="COMMUNITY">COMMUNITY</option>
                            <option value="PROFESSIONAL">PROFESSIONAL</option>
                            <option value="ENTERPRISE">ENTERPRISE</option>
                          </select>
                          <label className="row-inline">
                            <input
                              type="checkbox"
                              checked={draft.mfaEnforced}
                              onChange={(e) =>
                                setOrgDrafts((prev) => ({
                                  ...prev,
                                  [org.company]: {
                                    ...draft,
                                    mfaEnforced: e.target.checked,
                                  },
                                }))
                              }
                            />
                            Enforce MFA
                          </label>
                          <button
                            type="button"
                            disabled={busyAction === `org-policy-${org.company}`}
                            onClick={() => handleSaveOrgPolicy(org.company)}
                          >
                            Save Policy
                          </button>
                        </div>
                      </td>
                      <td>
                        {!isSuspended ? (
                          <div className="row-inline" style={{ marginBottom: "6px" }}>
                            <input
                              type="text"
                              value={draft.suspendReason}
                              onChange={(e) =>
                                setOrgDrafts((prev) => ({
                                  ...prev,
                                  [org.company]: {
                                    ...draft,
                                    suspendReason: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Suspension reason"
                              style={{ width: "200px" }}
                            />
                            <button
                              type="button"
                              className="danger-btn"
                              disabled={busyAction === `org-suspend-${org.company}`}
                              onClick={() => handleSuspendOrg(org.company)}
                            >
                              Suspend / Block Org
                            </button>
                          </div>
                        ) : (
                          <div style={{ marginBottom: "6px" }}>
                            <button
                              type="button"
                              disabled={busyAction === `org-activate-${org.company}`}
                              onClick={() => handleActivateOrg(org.company)}
                            >
                              Reactivate Contract
                            </button>
                          </div>
                        )}

                        {terminatingOrg !== org.company ? (
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => {
                              setTerminatingOrg(org.company);
                              setTerminateOrgInput("");
                            }}
                          >
                            Terminate Contract (Purge Org)...
                          </button>
                        ) : (
                          <div className="row-inline">
                            <input
                              type="text"
                              value={terminateOrgInput}
                              onChange={(e) => setTerminateOrgInput(e.target.value)}
                              placeholder={`Type ${org.company}`}
                              style={{ width: "160px" }}
                            />
                            <button
                              type="button"
                              className="danger-btn"
                              disabled={
                                terminateOrgInput.trim().toLowerCase() !==
                                  org.company.toLowerCase() ||
                                busyAction === `org-terminate-${org.company}`
                              }
                              onClick={() => handleTerminateOrg(org.company)}
                            >
                              Confirm Purge
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTerminatingOrg(null);
                                setTerminateOrgInput("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: CROSS-TENANT GLOBAL USERS                                    */}
      {/* =================================================================== */}
      {activeTab === "users" && (
        <div>
          <h2>Global Identity Directory (All Company Workspaces)</h2>
          <div className="row-inline" style={{ marginBottom: "8px" }}>
            <label htmlFor="user-search">Search:</label>
            <input
              id="user-search"
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="email, name, company, role, ID..."
              style={{ width: "260px" }}
            />
            <label htmlFor="user-company-filter">Workspace:</label>
            <select
              id="user-company-filter"
              value={userCompanyFilter}
              onChange={(e) => setUserCompanyFilter(e.target.value)}
            >
              <option value="">ALL WORKSPACES</option>
              {distinctUserCompanies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {userCompanyFilter && (
              <button type="button" onClick={() => setUserCompanyFilter("")}>
                Clear Workspace Filter
              </button>
            )}
          </div>

          {filteredUsers.length === 0 ? (
            <p>No users match the current filter.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID / Identity</th>
                  <th>Company Workspace</th>
                  <th>Role</th>
                  <th>Tier</th>
                  <th>Flags</th>
                  <th>MFA / Sessions</th>
                  <th>Operator Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const draft = userDrafts[u.id] || {
                    fullName: u.fullName || "",
                    company: u.company,
                    role: u.role,
                    subscriptionTier: u.subscriptionTier,
                    emailVerified: u.emailVerified,
                    accountLocked: u.accountLocked,
                  };

                  return (
                    <tr key={u.id}>
                      <td>
                        <div>
                          <strong>#{u.id}</strong> {u.email}
                        </div>
                        <div style={{ marginTop: "4px" }}>
                          <input
                            type="text"
                            value={draft.fullName}
                            onChange={(e) =>
                              setUserDrafts((prev) => ({
                                ...prev,
                                [u.id]: { ...draft, fullName: e.target.value },
                              }))
                            }
                            placeholder="Full Name"
                            style={{ width: "180px" }}
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={draft.company}
                          onChange={(e) =>
                            setUserDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, company: e.target.value },
                            }))
                          }
                          style={{ width: "145px" }}
                        />
                      </td>
                      <td>
                        <select
                          value={draft.role}
                          onChange={(e) =>
                            setUserDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, role: e.target.value },
                            }))
                          }
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="HR">HR</option>
                          <option value="FINANCE">FINANCE</option>
                          <option value="DEVOPS">DEVOPS</option>
                          <option value="USER">USER</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={draft.subscriptionTier}
                          onChange={(e) =>
                            setUserDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, subscriptionTier: e.target.value },
                            }))
                          }
                        >
                          <option value="COMMUNITY">COMMUNITY</option>
                          <option value="PROFESSIONAL">PROFESSIONAL</option>
                          <option value="ENTERPRISE">ENTERPRISE</option>
                        </select>
                      </td>
                      <td>
                        <div>
                          <label className="row-inline">
                            <input
                              type="checkbox"
                              checked={draft.emailVerified}
                              onChange={(e) =>
                                setUserDrafts((prev) => ({
                                  ...prev,
                                  [u.id]: { ...draft, emailVerified: e.target.checked },
                                }))
                              }
                            />
                            Verified
                          </label>
                        </div>
                        <div>
                          <label className="row-inline">
                            <input
                              type="checkbox"
                              checked={draft.accountLocked}
                              onChange={(e) =>
                                setUserDrafts((prev) => ({
                                  ...prev,
                                  [u.id]: { ...draft, accountLocked: e.target.checked },
                                }))
                              }
                            />
                            Locked
                          </label>
                        </div>
                      </td>
                      <td>
                        <div>MFA: {u.mfaEnabled ? "[ENABLED]" : "[OFF]"}</div>
                        <div>Sessions: {u.activeSessions}</div>
                      </td>
                      <td>
                        <div className="row-inline">
                          <button
                            type="button"
                            disabled={busyAction === `user-save-${u.id}`}
                            onClick={() => handleSaveUser(u.id)}
                          >
                            Save Changes
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === `user-logout-${u.id}`}
                            onClick={() => handleRevokeUserSessions(u.id)}
                          >
                            Force Logout
                          </button>
                          <button
                            type="button"
                            disabled={!u.mfaEnabled || busyAction === `user-mfa-${u.id}`}
                            onClick={() => handleResetUserMfa(u.id)}
                          >
                            Reset MFA
                          </button>
                          {confirmDeleteUserId !== u.id ? (
                            <button
                              type="button"
                              className="danger-btn"
                              onClick={() => setConfirmDeleteUserId(u.id)}
                            >
                              Delete
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="danger-btn"
                                disabled={busyAction === `user-delete-${u.id}`}
                                onClick={() => handleDeleteUser(u.id)}
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUserId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: GLOBAL SECURITY AUDIT LOGS                                   */}
      {/* =================================================================== */}
      {activeTab === "audit" && (
        <div>
          <h2>Global Cross-Tenant Security Audit Stream</h2>
          <form onSubmit={handleFilterAuditLogs} className="row-inline" style={{ marginBottom: "8px" }}>
            <input
              type="text"
              value={auditCompany}
              onChange={(e) => setAuditCompany(e.target.value)}
              placeholder="Company (e.g. acme)"
              style={{ width: "150px" }}
            />
            <select
              value={auditCategory}
              onChange={(e) => setAuditCategory(e.target.value)}
            >
              <option value="">ALL CATEGORIES</option>
              <option value="PLATFORM_GOVERNANCE">PLATFORM_GOVERNANCE</option>
              <option value="AUTHENTICATION">AUTHENTICATION</option>
              <option value="MFA_SECURITY">MFA_SECURITY</option>
              <option value="COMPLIANCE_OPS">COMPLIANCE_OPS</option>
              <option value="ADMIN_MANAGEMENT">ADMIN_MANAGEMENT</option>
              <option value="SSO_FEDERATION">SSO_FEDERATION</option>
            </select>
            <select
              value={auditSeverity}
              onChange={(e) => setAuditSeverity(e.target.value)}
            >
              <option value="">ALL SEVERITIES</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="SECURITY_ALERT">SECURITY_ALERT</option>
            </select>
            <input
              type="text"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Search actor, action, details..."
              style={{ width: "220px" }}
            />
            <select
              value={auditLimit}
              onChange={(e) => setAuditLimit(Number(e.target.value))}
            >
              <option value={50}>Limit 50</option>
              <option value={100}>Limit 100</option>
              <option value={250}>Limit 250</option>
              <option value={500}>Limit 500</option>
            </select>
            <button type="submit" disabled={busyAction === "audit-filter"}>
              {busyAction === "audit-filter" ? "Loading..." : "Apply Filters"}
            </button>
          </form>

          {auditLogs.length === 0 ? (
            <p>No audit log entries found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Timestamp</th>
                  <th>Company</th>
                  <th>Severity</th>
                  <th>Category / Action</th>
                  <th>Actor</th>
                  <th>Target / Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.id}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{log.createdAt}</td>
                    <td>{log.company || "-"}</td>
                    <td>
                      <span
                        className={
                          log.severity === "SECURITY_ALERT" ? "status-suspended" : ""
                        }
                      >
                        [{log.severity}]
                      </span>
                    </td>
                    <td>
                      <div>
                        <strong>{log.actionType}</strong>
                      </div>
                      <div style={{ fontSize: "11px" }}>{log.category}</div>
                    </td>
                    <td>{log.userEmail || "-"}</td>
                    <td>
                      {log.targetResource && (
                        <div>
                          <strong>Target:</strong> {log.targetResource}
                        </div>
                      )}
                      <div>{log.details}</div>
                    </td>
                    <td>{log.ipAddress || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
