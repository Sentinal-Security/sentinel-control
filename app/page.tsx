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
  fetchUserServices,
  UserVaultServiceRecord,
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
  const [loginEmail, setLoginEmail] = useState("");
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

  // User Credentials & Vault Inspection Modal State
  const [credentialUser, setCredentialUser] = useState<GlobalUserRecord | null>(null);
  const [userVaultServices, setUserVaultServices] = useState<UserVaultServiceRecord[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [revealPasswordHash, setRevealPasswordHash] = useState(false);
  const [revealMfaSecret, setRevealMfaSecret] = useState(false);
  const [revealedVaultPasswords, setRevealedVaultPasswords] = useState<Record<number, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [passwordOverrideLoading, setPasswordOverrideLoading] = useState(false);
  const [passwordOverrideMessage, setPasswordOverrideMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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

  // Emergency Global Actions
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

  // Organization Governance Actions
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

  // Global User Management Actions
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

  const openCredentialsModal = async (u: GlobalUserRecord) => {
    setCredentialUser(u);
    setRevealPasswordHash(false);
    setRevealMfaSecret(false);
    setRevealedVaultPasswords({});
    setNewPasswordValue("");
    setPasswordOverrideMessage(null);
    setCopiedField(null);

    if (!session) return;
    setVaultLoading(true);
    const res = await fetchUserServices(session, u.id, handleUnauthorized);
    setVaultLoading(false);
    if (res.success && res.data) {
      setUserVaultServices(res.data);
    } else {
      setUserVaultServices([]);
    }
  };

  const handleCopyText = (text: string, fieldKey: string) => {
    if (!text) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleGenerateRandomPassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let pass = "";
    for (let i = 0; i < 14; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPasswordValue(pass);
  };

  const handleOverridePassword = async () => {
    if (!session || !credentialUser) return;
    const trimmed = newPasswordValue.trim();
    if (!trimmed) {
      setPasswordOverrideMessage({ type: "err", text: "Please enter a new password." });
      return;
    }
    if (trimmed.length < 6) {
      setPasswordOverrideMessage({ type: "err", text: "Password must be at least 6 characters long." });
      return;
    }

    setPasswordOverrideLoading(true);
    setPasswordOverrideMessage(null);

    const res = await updateGlobalUser(session, credentialUser.id, { password: trimmed }, handleUnauthorized);
    setPasswordOverrideLoading(false);

    if (res.success && res.data) {
      setPasswordOverrideMessage({ type: "ok", text: `Successfully updated password for ${credentialUser.email}.` });
      setNewPasswordValue("");
      setCredentialUser(res.data);
      setUsers((prev) => prev.map((u) => (u.id === credentialUser.id ? res.data! : u)));
    } else {
      setPasswordOverrideMessage({ type: "err", text: res.message || "Failed to update password." });
    }
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
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-zinc-400 font-mono text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></span>
          <span>Initializing Sentinel Control Plane...</span>
        </div>
      </div>
    );
  }

  // =========================================================================
  // Unauthenticated View: Shadcn Root Operator Login Gate
  // =========================================================================

  if (!session) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col justify-center items-center px-4 py-12">
        <div className="w-full max-w-md bg-[#121215] border border-[#27272a] rounded-xl p-8 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-lg bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-100 tracking-tight">Sentinel Control Plane</h1>
              <p className="text-xs text-zinc-400 font-mono">Isolated Root Operator Enclave</p>
            </div>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed mb-6">
            Authenticates against environment-backed platform credentials. Controls global organization kill switches and fleet session management.
          </p>

          {loginError && (
            <div className="mb-6 p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs font-mono">
              [AUTH ERROR] {loginError}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label htmlFor="api-url" className="block text-xs font-medium text-zinc-300 mb-1.5">
                API Gateway Base URL
              </label>
              <input
                id="api-url"
                type="url"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                required
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setApiBaseUrl("https://backend-pi68.onrender.com")}
                  className="px-2.5 py-1 text-[11px] font-mono rounded bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-300 border border-zinc-700/50 transition-colors"
                >
                  Prod (Render)
                </button>
                <button
                  type="button"
                  onClick={() => setApiBaseUrl("http://localhost:8080")}
                  className="px-2.5 py-1 text-[11px] font-mono rounded bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-300 border border-zinc-700/50 transition-colors"
                >
                  Local (:8080)
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="root-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Root Operator Email
              </label>
              <input
                id="root-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="operator@domain.com"
                className="w-full px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                required
              />
            </div>

            <div>
              <label htmlFor="root-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Root Operator Password
              </label>
              <input
                id="root-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 mt-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs rounded-lg transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {loginLoading ? "Authenticating Root Session..." : "Authenticate Root Session"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // Authenticated View: Shadcn Minimalist Technical Control Plane
  // =========================================================================

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      {/* Top Header Command Bar */}
      <header className="border-b border-[#27272a] bg-[#121215]/80 backdrop-blur sticky top-0 z-30 px-4 sm:px-8 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">SENTINEL CONTROL</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-950 border border-cyan-500/30 text-cyan-300">
                ROOT ENCLAVE
              </span>
            </div>
            <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-2 mt-0.5">
              <span>Operator: <strong className="text-zinc-200">{session.email}</strong></span>
              <span>&bull;</span>
              <span>Gateway: <span className="text-cyan-300">{session.apiBaseUrl}</span></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => refreshAllData(session)}
            disabled={busyAction === "refresh"}
            className="px-3 py-1.5 rounded-lg bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-xs font-medium text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${busyAction === "refresh" ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{busyAction === "refresh" ? "Refreshing..." : "Refresh"}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg bg-zinc-800/40 hover:bg-rose-950/40 border border-zinc-700/50 hover:border-rose-500/30 text-xs font-medium text-zinc-300 hover:text-rose-200 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Navigation Sub-Header */}
      <div className="border-b border-[#27272a] bg-[#121215]/40 px-4 sm:px-8 py-2.5 flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === "overview"
              ? "bg-zinc-100 text-zinc-950 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181b]"
          }`}
        >
          <span>Overview &amp; Telemetry</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("organizations")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === "organizations"
              ? "bg-zinc-100 text-zinc-950 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181b]"
          }`}
        >
          <span>Organizations &amp; Contracts</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#27272a] text-zinc-300">
            {organizations.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === "users"
              ? "bg-zinc-100 text-zinc-950 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181b]"
          }`}
        >
          <span>Global Users</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#27272a] text-zinc-300">
            {users.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("audit")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === "audit"
              ? "bg-zinc-100 text-zinc-950 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-[#18181b]"
          }`}
        >
          <span>Security Audit Stream</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#27272a] text-zinc-300">
            {auditLogs.length}
          </span>
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 px-4 sm:px-8 py-6 max-w-7xl w-full mx-auto space-y-6">
        {/* Banner Notification */}
        {banner && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              banner.type === "ok"
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-200"
                : "bg-rose-950/40 border-rose-500/30 text-rose-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${banner.type === "ok" ? "bg-emerald-400" : "bg-rose-400"}`}></span>
              <span className="font-mono">{banner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-zinc-400 hover:text-white p-1 rounded cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 1: OVERVIEW & EMERGENCY PLATFORM CONTROLS                       */}
        {/* =================================================================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1 */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a]">
                <div className="text-xs font-medium text-zinc-400">Total Workspaces</div>
                <div className="text-2xl font-bold text-white mt-1.5">
                  {overview ? overview.totalOrganizations : "-"}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-2 flex items-center gap-1.5">
                  <span className="text-rose-400 font-semibold">{overview?.suspendedOrganizations ?? 0}</span>
                  <span>suspended contracts</span>
                </div>
              </div>

              {/* Card 2 */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a]">
                <div className="text-xs font-medium text-zinc-400">Global Identities</div>
                <div className="text-2xl font-bold text-white mt-1.5">
                  {overview ? overview.totalUsers : "-"}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-2">
                  <span className="text-emerald-400">{overview?.verifiedUsers ?? 0}</span> verified &bull;{" "}
                  <span className="text-cyan-400">{overview?.mfaEnabledUsers ?? 0}</span> MFA active
                </div>
              </div>

              {/* Card 3 */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a]">
                <div className="text-xs font-medium text-zinc-400">Active SSO Sessions</div>
                <div className="text-2xl font-bold text-white mt-1.5">
                  {overview ? overview.activeSessions : "-"}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-2">
                  Across {overview?.totalServices ?? 0} registered applications
                </div>
              </div>

              {/* Card 4 */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a]">
                <div className="text-xs font-medium text-zinc-400">Database Vault</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${overview?.databaseConnected ? "bg-emerald-400" : "bg-rose-400 animate-ping"}`}></span>
                  <span className="text-lg font-bold text-white">
                    {overview?.databaseConnected ? "CONNECTED" : "OFFLINE"}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-zinc-400 mt-2">
                  Supabase Ping: {overview && overview.databasePingMs >= 0 ? `${overview.databasePingMs} ms` : "N/A"}
                </div>
              </div>
            </div>

            {/* Emergency Platform Controls (Danger Zone) */}
            <div className="p-5 rounded-xl bg-[#121215] border border-rose-500/30 space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                  <h2 className="text-sm font-bold text-white">Global Emergency Platform Controls</h2>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  High-privilege root operator overrides affecting fleet-wide security, sessions, and tenant isolation.
                </p>
              </div>

              {/* Kill Switch 1 */}
              <div className="p-4 rounded-lg bg-[#18181b]/80 border border-[#27272a] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-zinc-200">Emergency Control 1: Global Session Kill Switch</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Immediately revokes 100% of active SSO tokens across every organization, forcing all connected workstations to re-authenticate.
                  </div>
                </div>

                {!confirmGlobalLogout ? (
                  <button
                    type="button"
                    onClick={() => setConfirmGlobalLogout(true)}
                    className="px-3.5 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/40 text-rose-200 text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                  >
                    Force Logout All Active Sessions...
                  </button>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction === "global-logout"}
                      onClick={handleForceLogoutAll}
                      className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {busyAction === "global-logout" ? "Revoking..." : "CONFIRM FORCE LOGOUT"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmGlobalLogout(false)}
                      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Kill Switch 2 */}
              <div className="p-4 rounded-lg bg-[#18181b]/80 border border-[#27272a] space-y-3">
                <div>
                  <div className="text-xs font-semibold text-zinc-200">Emergency Control 2: Clean-Slate Tenant Purge</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Permanently purges tenant users, sessions, apps, MFA records, and policies, resetting user IDs to 1. APK build records are strictly preserved.
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
                  <span className="text-xs font-mono text-zinc-400">Type <code className="text-rose-300">PURGE_ALL_TENANTS</code>:</span>
                  <input
                    type="text"
                    value={purgeConfirmInput}
                    onChange={(e) => setPurgeConfirmInput(e.target.value)}
                    placeholder="PURGE_ALL_TENANTS"
                    className="px-3 py-1.5 bg-[#121215] border border-[#27272a] rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-rose-500 w-48"
                  />
                  <button
                    type="button"
                    disabled={purgeConfirmInput.trim() !== "PURGE_ALL_TENANTS" || busyAction === "global-purge"}
                    onClick={handlePurgeAllTenants}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/40 text-rose-200 text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {busyAction === "global-purge" ? "Purging Platform..." : "Execute Purge All Tenants"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: ORGANIZATIONS & CONTRACT GOVERNANCE                          */}
        {/* =================================================================== */}
        {activeTab === "organizations" && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Organization Workspaces</h2>
                <p className="text-xs text-zinc-400">Manage tenant isolation, subscription tier overrides, and contract kill switches.</p>
              </div>

              <input
                type="text"
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                placeholder="Filter by company, admin email, status..."
                className="px-3 py-1.5 bg-[#121215] border border-[#27272a] rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 w-full sm:w-72"
              />
            </div>

            {filteredOrgs.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400 font-mono border border-[#27272a] rounded-xl bg-[#121215]">
                No tenant organizations match your search filter.
              </div>
            ) : (
              <div className="border border-[#27272a] rounded-xl overflow-hidden bg-[#121215] overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] bg-[#18181b]/60 text-zinc-400 font-mono text-[11px]">
                      <th className="py-3 px-4 font-semibold">Workspace</th>
                      <th className="py-3 px-4 font-semibold">Contract Status</th>
                      <th className="py-3 px-4 font-semibold">Members</th>
                      <th className="py-3 px-4 font-semibold">Sessions / Apps</th>
                      <th className="py-3 px-4 font-semibold">Policy Override</th>
                      <th className="py-3 px-4 font-semibold">Contract Operations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a] text-zinc-300">
                    {filteredOrgs.map((org) => {
                      const draft = orgDrafts[org.company] || {
                        subscriptionTier: org.subscriptionTier,
                        mfaEnforced: org.mfaEnforced,
                        suspendReason: org.suspendedReason || "Contract suspended by platform operations.",
                      };
                      const isSuspended = org.contractStatus === "SUSPENDED";

                      return (
                        <tr key={org.company} className="hover:bg-[#18181b]/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white uppercase tracking-wide">{org.company}</div>
                            <button
                              type="button"
                              onClick={() => {
                                setUserCompanyFilter(org.company);
                                setActiveTab("users");
                              }}
                              className="text-[11px] text-cyan-400 hover:text-cyan-300 underline font-mono mt-1 cursor-pointer"
                            >
                              View Users &rarr;
                            </button>
                          </td>

                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                isSuspended
                                  ? "bg-rose-950 border border-rose-500/40 text-rose-300"
                                  : "bg-emerald-950 border border-emerald-500/40 text-emerald-300"
                              }`}
                            >
                              {org.contractStatus}
                            </span>
                            {isSuspended && org.suspendedReason && (
                              <div className="text-[10px] text-rose-300/80 font-mono mt-1 max-w-xs truncate">
                                {org.suspendedReason}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-semibold text-white">{org.userCount} users</div>
                            <div className="text-[11px] text-zinc-400 font-mono truncate max-w-xs">
                              {org.adminEmails.length > 0 ? org.adminEmails.join(", ") : "No Admin"}
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px]">
                            <div>Active: <strong className="text-zinc-200">{org.activeSessions}</strong></div>
                            <div>Apps: <strong className="text-zinc-200">{org.serviceCount}</strong></div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <select
                                value={draft.subscriptionTier}
                                onChange={(e) =>
                                  setOrgDrafts((prev) => ({
                                    ...prev,
                                    [org.company]: { ...draft, subscriptionTier: e.target.value },
                                  }))
                                }
                                className="px-2 py-1 bg-[#18181b] border border-[#27272a] rounded text-[11px] text-zinc-200 font-mono focus:outline-none"
                              >
                                <option value="COMMUNITY">COMMUNITY</option>
                                <option value="PROFESSIONAL">PROFESSIONAL</option>
                                <option value="ENTERPRISE">ENTERPRISE</option>
                              </select>

                              <label className="flex items-center gap-1 text-[11px] text-zinc-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={draft.mfaEnforced}
                                  onChange={(e) =>
                                    setOrgDrafts((prev) => ({
                                      ...prev,
                                      [org.company]: { ...draft, mfaEnforced: e.target.checked },
                                    }))
                                  }
                                  className="rounded border-[#27272a] bg-[#18181b] accent-cyan-400"
                                />
                                <span>MFA</span>
                              </label>

                              <button
                                type="button"
                                disabled={busyAction === `org-policy-${org.company}`}
                                onClick={() => handleSaveOrgPolicy(org.company)}
                                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Save
                              </button>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-1.5">
                              {!isSuspended ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={draft.suspendReason}
                                    onChange={(e) =>
                                      setOrgDrafts((prev) => ({
                                        ...prev,
                                        [org.company]: { ...draft, suspendReason: e.target.value },
                                      }))
                                    }
                                    placeholder="Suspension reason"
                                    className="px-2 py-1 bg-[#18181b] border border-[#27272a] rounded text-[11px] text-zinc-200 w-36 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={busyAction === `org-suspend-${org.company}`}
                                    onClick={() => handleSuspendOrg(org.company)}
                                    className="px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                                  >
                                    Suspend
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busyAction === `org-activate-${org.company}`}
                                  onClick={() => handleActivateOrg(org.company)}
                                  className="px-2.5 py-1 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  Reactivate Contract
                                </button>
                              )}

                              {terminatingOrg !== org.company ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTerminatingOrg(org.company);
                                    setTerminateOrgInput("");
                                  }}
                                  className="text-[10px] text-rose-400 hover:text-rose-300 font-mono underline block cursor-pointer"
                                >
                                  Terminate &amp; Purge Org...
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={terminateOrgInput}
                                    onChange={(e) => setTerminateOrgInput(e.target.value)}
                                    placeholder={`Type ${org.company}`}
                                    className="px-2 py-0.5 bg-[#18181b] border border-rose-500/50 rounded text-[10px] font-mono text-zinc-200 w-28 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={
                                      terminateOrgInput.trim().toLowerCase() !== org.company.toLowerCase() ||
                                      busyAction === `org-terminate-${org.company}`
                                    }
                                    onClick={() => handleTerminateOrg(org.company)}
                                    className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-colors disabled:opacity-40 cursor-pointer"
                                  >
                                    Purge
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setTerminatingOrg(null)}
                                    className="text-[10px] text-zinc-400 hover:text-white"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: CROSS-TENANT GLOBAL USERS                                    */}
        {/* =================================================================== */}
        {activeTab === "users" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Global Identities</h2>
                <p className="text-xs text-zinc-400">Directory across all tenant company workspaces.</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by email, name, role, ID..."
                  className="px-3 py-1.5 bg-[#121215] border border-[#27272a] rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 w-56"
                />

                <select
                  value={userCompanyFilter}
                  onChange={(e) => setUserCompanyFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-[#121215] border border-[#27272a] rounded-lg text-xs text-zinc-300 font-mono focus:outline-none"
                >
                  <option value="">ALL WORKSPACES</option>
                  {distinctUserCompanies.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>

                {userCompanyFilter && (
                  <button
                    type="button"
                    onClick={() => setUserCompanyFilter("")}
                    className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-mono transition-colors"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400 font-mono border border-[#27272a] rounded-xl bg-[#121215]">
                No users match the search criteria.
              </div>
            ) : (
              <div className="border border-[#27272a] rounded-xl overflow-hidden bg-[#121215] overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] bg-[#18181b]/60 text-zinc-400 font-mono text-[11px]">
                      <th className="py-3 px-4 font-semibold">User</th>
                      <th className="py-3 px-4 font-semibold">Workspace</th>
                      <th className="py-3 px-4 font-semibold">Role</th>
                      <th className="py-3 px-4 font-semibold">Tier</th>
                      <th className="py-3 px-4 font-semibold">Status Flags</th>
                      <th className="py-3 px-4 font-semibold">MFA &amp; Sessions</th>
                      <th className="py-3 px-4 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a] text-zinc-300">
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
                        <tr key={u.id} className="hover:bg-[#18181b]/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                              <span className="text-zinc-500 font-mono mr-1">#{u.id}</span>
                              <span>{u.email}</span>
                              <button
                                type="button"
                                onClick={() => openCredentialsModal(u)}
                                title="Inspect user credentials, password hash, MFA secret, and vault apps"
                                className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono underline ml-1 cursor-pointer"
                              >
                                Inspect
                              </button>
                            </div>
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
                              className="px-2 py-0.5 bg-[#18181b] border border-[#27272a] rounded text-[11px] text-zinc-300 w-36 mt-1 focus:outline-none"
                            />
                          </td>

                          <td className="py-3 px-4">
                            <input
                              type="text"
                              value={draft.company}
                              onChange={(e) =>
                                setUserDrafts((prev) => ({
                                  ...prev,
                                  [u.id]: { ...draft, company: e.target.value },
                                }))
                              }
                              className="px-2 py-1 bg-[#18181b] border border-[#27272a] rounded text-[11px] font-mono text-zinc-200 w-32 focus:outline-none"
                            />
                          </td>

                          <td className="py-3 px-4">
                            <select
                              value={draft.role}
                              onChange={(e) =>
                                setUserDrafts((prev) => ({
                                  ...prev,
                                  [u.id]: { ...draft, role: e.target.value },
                                }))
                              }
                              className="px-2 py-1 bg-[#18181b] border border-[#27272a] rounded text-[11px] font-mono text-zinc-200 focus:outline-none"
                            >
                              <option value="ADMIN">ADMIN</option>
                              <option value="HR">HR</option>
                              <option value="FINANCE">FINANCE</option>
                              <option value="DEVOPS">DEVOPS</option>
                              <option value="USER">USER</option>
                              <option value="EMPLOYEE">EMPLOYEE</option>
                            </select>
                          </td>

                          <td className="py-3 px-4">
                            <select
                              value={draft.subscriptionTier}
                              onChange={(e) =>
                                setUserDrafts((prev) => ({
                                  ...prev,
                                  [u.id]: { ...draft, subscriptionTier: e.target.value },
                                }))
                              }
                              className="px-2 py-1 bg-[#18181b] border border-[#27272a] rounded text-[11px] font-mono text-zinc-200 focus:outline-none"
                            >
                              <option value="COMMUNITY">COMMUNITY</option>
                              <option value="PROFESSIONAL">PROFESSIONAL</option>
                              <option value="ENTERPRISE">ENTERPRISE</option>
                            </select>
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-1 text-[11px]">
                              <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300">
                                <input
                                  type="checkbox"
                                  checked={draft.emailVerified}
                                  onChange={(e) =>
                                    setUserDrafts((prev) => ({
                                      ...prev,
                                      [u.id]: { ...draft, emailVerified: e.target.checked },
                                    }))
                                  }
                                  className="rounded border-[#27272a] bg-[#18181b] accent-emerald-500"
                                />
                                <span>Verified</span>
                              </label>

                              <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300">
                                <input
                                  type="checkbox"
                                  checked={draft.accountLocked}
                                  onChange={(e) =>
                                    setUserDrafts((prev) => ({
                                      ...prev,
                                      [u.id]: { ...draft, accountLocked: e.target.checked },
                                    }))
                                  }
                                  className="rounded border-[#27272a] bg-[#18181b] accent-rose-500"
                                />
                                <span className={draft.accountLocked ? "text-rose-400 font-bold" : ""}>Locked</span>
                              </label>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px]">
                            <div className="flex items-center gap-1">
                              <span>MFA:</span>
                              <span className={u.mfaEnabled ? "text-emerald-400 font-semibold" : "text-zinc-500"}>
                                {u.mfaEnabled ? "ENABLED" : "OFF"}
                              </span>
                            </div>
                            <div className="text-zinc-400 mt-0.5">Sessions: {u.activeSessions}</div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => openCredentialsModal(u)}
                                className="px-2 py-1 bg-cyan-950/40 hover:bg-cyan-900/40 border border-cyan-500/30 text-cyan-300 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <svg className="w-3 h-3 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                <span>Credentials &amp; Vault</span>
                              </button>

                              <button
                                type="button"
                                disabled={busyAction === `user-save-${u.id}`}
                                onClick={() => handleSaveUser(u.id)}
                                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Save
                              </button>

                              <button
                                type="button"
                                disabled={busyAction === `user-logout-${u.id}`}
                                onClick={() => handleRevokeUserSessions(u.id)}
                                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Revoke
                              </button>

                              <button
                                type="button"
                                disabled={!u.mfaEnabled || busyAction === `user-mfa-${u.id}`}
                                onClick={() => handleResetUserMfa(u.id)}
                                className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/40 border border-amber-500/30 text-amber-300 rounded text-[11px] font-medium transition-colors disabled:opacity-40 cursor-pointer"
                              >
                                Reset MFA
                              </button>

                              {confirmDeleteUserId !== u.id ? (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUserId(u.id)}
                                  className="px-2 py-1 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-500/30 text-rose-300 rounded text-[11px] font-medium transition-colors cursor-pointer"
                                >
                                  Delete
                                </button>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={busyAction === `user-delete-${u.id}`}
                                    onClick={() => handleDeleteUser(u.id)}
                                    className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold cursor-pointer"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteUserId(null)}
                                    className="text-[10px] text-zinc-400 hover:text-white"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: GLOBAL SECURITY AUDIT LOGS                                   */}
        {/* =================================================================== */}
        {activeTab === "audit" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Global Forensic Audit Stream</h2>
              <p className="text-xs text-zinc-400">Immutable cross-tenant security and administrative audit records.</p>
            </div>

            {/* Filter Toolbar */}
            <form onSubmit={handleFilterAuditLogs} className="p-3.5 rounded-xl bg-[#121215] border border-[#27272a] flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={auditCompany}
                onChange={(e) => setAuditCompany(e.target.value)}
                placeholder="Company (e.g. acme)"
                className="px-2.5 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs font-mono text-zinc-200 w-36 focus:outline-none"
              />

              <select
                value={auditCategory}
                onChange={(e) => setAuditCategory(e.target.value)}
                className="px-2.5 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-zinc-300 font-mono focus:outline-none"
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
                className="px-2.5 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-zinc-300 font-mono focus:outline-none"
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
                className="px-2.5 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-zinc-200 w-52 focus:outline-none"
              />

              <select
                value={auditLimit}
                onChange={(e) => setAuditLimit(Number(e.target.value))}
                className="px-2.5 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-zinc-300 font-mono focus:outline-none"
              >
                <option value={50}>Limit 50</option>
                <option value={100}>Limit 100</option>
                <option value={250}>Limit 250</option>
                <option value={500}>Limit 500</option>
              </select>

              <button
                type="submit"
                disabled={busyAction === "audit-filter"}
                className="px-3.5 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {busyAction === "audit-filter" ? "Loading..." : "Filter Logs"}
              </button>
            </form>

            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400 font-mono border border-[#27272a] rounded-xl bg-[#121215]">
                No security audit records match the selected parameters.
              </div>
            ) : (
              <div className="border border-[#27272a] rounded-xl overflow-hidden bg-[#121215] overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] bg-[#18181b]/60 text-zinc-400 font-mono text-[11px]">
                      <th className="py-3 px-4 font-semibold">ID</th>
                      <th className="py-3 px-4 font-semibold">Timestamp</th>
                      <th className="py-3 px-4 font-semibold">Company</th>
                      <th className="py-3 px-4 font-semibold">Severity</th>
                      <th className="py-3 px-4 font-semibold">Action &amp; Category</th>
                      <th className="py-3 px-4 font-semibold">Actor</th>
                      <th className="py-3 px-4 font-semibold">Target &amp; Details</th>
                      <th className="py-3 px-4 font-semibold">Origin IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a] text-zinc-300 font-mono text-[11px]">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#18181b]/40 transition-colors">
                        <td className="py-2.5 px-4 text-zinc-500">#{log.id}</td>
                        <td className="py-2.5 px-4 whitespace-nowrap text-zinc-400">{log.createdAt}</td>
                        <td className="py-2.5 px-4 font-semibold text-zinc-200 uppercase">{log.company || "-"}</td>

                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              log.severity === "SECURITY_ALERT"
                                ? "bg-rose-950 border border-rose-500/40 text-rose-300"
                                : log.severity === "WARN"
                                ? "bg-amber-950 border border-amber-500/40 text-amber-300"
                                : "bg-zinc-800 text-zinc-300"
                            }`}
                          >
                            {log.severity}
                          </span>
                        </td>

                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-white">{log.actionType}</div>
                          <div className="text-[10px] text-zinc-400 font-sans">{log.category}</div>
                        </td>

                        <td className="py-2.5 px-4 text-zinc-300">{log.userEmail || "-"}</td>

                        <td className="py-2.5 px-4 font-sans text-xs max-w-md">
                          {log.targetResource && (
                            <span className="text-cyan-400 font-mono font-medium mr-1">
                              [{log.targetResource}]
                            </span>
                          )}
                          <span className="text-zinc-300">{log.details}</span>
                        </td>

                        <td className="py-2.5 px-4 text-zinc-400">{log.ipAddress || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* ROOT SUPER ADMIN CREDENTIALS & VAULT INSPECTION MODAL               */}
        {/* =================================================================== */}
        {credentialUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="relative w-full max-w-2xl rounded-2xl bg-[#09090b] border border-cyan-500/40 p-6 shadow-2xl text-white max-h-[90vh] overflow-y-auto space-y-5">
              {/* Modal Header */}
              <div className="flex items-start justify-between pb-3 border-b border-[#27272a]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white">Identity Credentials &amp; Vault Store</h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                        ROOT OPERATOR
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                      User #{credentialUser.id} &bull; {credentialUser.email} &bull; {credentialUser.company.toUpperCase()} ({credentialUser.role})
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCredentialUser(null)}
                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 1. Account Password & Cryptographic Identity */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a] space-y-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-200">Account Authentication Password</h4>
                    <p className="text-[11px] text-zinc-400">Cryptographic hash and root password management.</p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                    BCrypt 12-Rounds
                  </span>
                </div>

                {/* BCrypt Hash Display */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono text-zinc-400 flex items-center justify-between">
                    <span>Cryptographic Password Hash (Database):</span>
                    <button
                      type="button"
                      onClick={() => setRevealPasswordHash(!revealPasswordHash)}
                      className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                    >
                      {revealPasswordHash ? "Mask Hash" : "Reveal Hash"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 p-2 bg-[#18181b] border border-[#27272a] rounded-lg font-mono text-xs text-zinc-300 truncate select-all">
                      {revealPasswordHash
                        ? credentialUser.passwordHash || "No password hash available."
                        : (credentialUser.passwordHash
                            ? credentialUser.passwordHash.slice(0, 10) + "••••••••••••••••••••••••••••••••••••••••••••••••"
                            : "••••••••••••••••••••••••••••••••••••••••")}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyText(credentialUser.passwordHash || "", "hash")}
                      className="px-2.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium cursor-pointer transition-colors shrink-0"
                    >
                      {copiedField === "hash" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    Notice: In accordance with NIST SP 800-63B, plaintext account passwords are not stored in the database. Instead, an adaptive salted BCrypt hash is preserved. You can override or assign a new password below.
                  </p>
                </div>

                {/* Direct Root Password Override */}
                <div className="pt-2 border-t border-[#27272a]/60 space-y-2">
                  <div className="text-[11px] font-semibold text-zinc-300">Set / Override User Password (Root Super Admin):</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newPasswordValue}
                      onChange={(e) => setNewPasswordValue(e.target.value)}
                      placeholder="Enter new plaintext password (min 6 chars)"
                      className="flex-1 px-3 py-1.5 bg-[#18181b] border border-[#27272a] rounded-lg text-xs text-white placeholder-zinc-500 font-mono focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={handleGenerateRandomPassword}
                      className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-mono transition-colors cursor-pointer shrink-0"
                    >
                      Generate
                    </button>
                    <button
                      type="button"
                      disabled={passwordOverrideLoading || !newPasswordValue.trim()}
                      onClick={handleOverridePassword}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {passwordOverrideLoading ? "Saving..." : "Set Password"}
                    </button>
                  </div>

                  {passwordOverrideMessage && (
                    <div className={`p-2 rounded-lg text-xs font-medium ${
                      passwordOverrideMessage.type === "ok"
                        ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-300"
                        : "bg-rose-950/40 border border-rose-500/30 text-rose-300"
                    }`}>
                      {passwordOverrideMessage.text}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. MFA Possession Factor Seed */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-200">Multi-Factor Authentication (MFA) Seed</h4>
                    <p className="text-[11px] text-zinc-400">Hardware token possession factor configuration.</p>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className={`px-2 py-0.5 rounded font-bold ${
                      credentialUser.mfaEnabled
                        ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                        : "bg-zinc-800 text-zinc-500"
                    }`}>
                      {credentialUser.mfaEnabled ? "MFA ACTIVE" : "MFA DISABLED"}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      METHOD: {credentialUser.preferredMfaMethod || "APP"}
                    </span>
                  </div>
                </div>

                {credentialUser.mfaSecret ? (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-mono text-zinc-400 flex items-center justify-between">
                      <span>Base32 TOTP Seed Key (RFC 6238):</span>
                      <button
                        type="button"
                        onClick={() => setRevealMfaSecret(!revealMfaSecret)}
                        className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                      >
                        {revealMfaSecret ? "Mask Secret" : "Reveal Secret"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 p-2 bg-[#18181b] border border-[#27272a] rounded-lg font-mono text-xs text-zinc-200 tracking-wider">
                        {revealMfaSecret ? credentialUser.mfaSecret : "•••• •••• •••• •••• •••• •••• •••• ••••"}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText(credentialUser.mfaSecret || "", "mfa")}
                        className="px-2.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium cursor-pointer transition-colors shrink-0"
                      >
                        {copiedField === "mfa" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 italic">User has not paired an authenticator app yet.</p>
                )}
              </div>

              {/* 3. Credential Vault & Workstation Services */}
              <div className="p-4 rounded-xl bg-[#121215] border border-[#27272a] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-200">Credential Vault &amp; Target Applications</h4>
                    <p className="text-[11px] text-zinc-400">Stored passwords for external websites and single sign-on apps.</p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    {userVaultServices.length} Registered
                  </span>
                </div>

                {vaultLoading ? (
                  <div className="p-6 text-center text-xs text-zinc-400 font-mono">
                    Loading user vault credentials...
                  </div>
                ) : userVaultServices.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500 font-mono border border-dashed border-[#27272a] rounded-lg">
                    No workstation applications or vaulted website credentials found for this identity.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {userVaultServices.map((svc) => {
                      const isRevealed = Boolean(revealedVaultPasswords[svc.id]);
                      return (
                        <div key={svc.id} className="p-3 bg-[#18181b] border border-[#27272a] rounded-xl space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{svc.name}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                                {svc.category || "Service"}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                svc.authProtocol === "vault"
                                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                                  : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              }`}>
                                {svc.authProtocol.toUpperCase()}
                              </span>
                            </div>
                            {svc.mfaRequired && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                MFA Mandated
                              </span>
                            )}
                          </div>

                          {svc.loginUrl && (
                            <div className="text-[11px] text-zinc-400 truncate font-mono">
                              URL: <a href={svc.loginUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{svc.loginUrl}</a>
                            </div>
                          )}

                          {/* Vault Credential Details */}
                          {svc.vaultUsername || svc.vaultPassword ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[#27272a]/60">
                              {/* Vault Username */}
                              <div className="p-2 rounded-lg bg-[#121215] border border-[#27272a] flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[10px] text-zinc-500 font-mono uppercase">Vault Username</div>
                                  <div className="text-xs font-mono text-zinc-200 truncate">{svc.vaultUsername || "—"}</div>
                                </div>
                                {svc.vaultUsername && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyText(svc.vaultUsername || "", `svc-user-${svc.id}`)}
                                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300 font-medium cursor-pointer shrink-0"
                                  >
                                    {copiedField === `svc-user-${svc.id}` ? "Copied" : "Copy"}
                                  </button>
                                )}
                              </div>

                              {/* Vault Password */}
                              <div className="p-2 rounded-lg bg-[#121215] border border-[#27272a] flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10px] text-zinc-500 font-mono uppercase">Vault Password</div>
                                  <div className="text-xs font-mono text-amber-300 truncate font-bold">
                                    {isRevealed ? svc.vaultPassword || "—" : "••••••••••••"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRevealedVaultPasswords((prev) => ({
                                        ...prev,
                                        [svc.id]: !isRevealed,
                                      }))
                                    }
                                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300 font-medium cursor-pointer"
                                  >
                                    {isRevealed ? "Hide" : "Show"}
                                  </button>
                                  {svc.vaultPassword && (
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(svc.vaultPassword || "", `svc-pass-${svc.id}`)}
                                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300 font-medium cursor-pointer"
                                    >
                                      {copiedField === `svc-pass-${svc.id}` ? "Copied" : "Copy"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-zinc-500 italic">
                              SSO Application (Federated Token Access - No static credentials stored)
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="pt-2 border-t border-[#27272a] flex items-center justify-between">
                <div className="text-[11px] text-zinc-500 font-mono">
                  Operator Action Audited &bull; Sentinel Control Plane
                </div>
                <button
                  type="button"
                  onClick={() => setCredentialUser(null)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
