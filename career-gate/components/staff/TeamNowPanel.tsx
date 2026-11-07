"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { dateTime } from "@/lib/format";
import {
  parsePresencePacket, presenceHref, presenceSection, PRESENCE_STALE_MS, safeStaffPresencePath,
  selectCurrentPresence, type StaffPresencePacket, type TeamPresenceClient, type TeamPresenceMember,
} from "@/lib/presence-model";
import styles from "./TeamNowPanel.module.css";

type ChannelState = "SUBSCRIBED" | "connecting" | "offline";
type PresenceStatus = "active" | "idle" | "offline" | "unknown";
type TeamRow = { member: TeamPresenceMember; packet: StaffPresencePacket | null; status: PresenceStatus; lastSeen: number | null };
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join(""); }

/** Manager-only read surface; each employee's authenticated channel fixes identity. */
export function TeamNowPanel() {
  const { t, dir } = useStaffLanguage();
  const [members, setMembers] = useState<TeamPresenceMember[]>([]);
  const [packets, setPackets] = useState<Record<string, StaffPresencePacket[]>>({});
  const [channelStates, setChannelStates] = useState<Record<string, ChannelState>>({});
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const [clientLabels, setClientLabels] = useState<Record<string, TeamPresenceClient>>({});
  const [error, setError] = useState<"unavailable" | "forbidden" | "not_configured" | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    let refreshAgain = false;
    let connecting = false;
    let allowed = false;
    let serverOffset = 0;
    let supabase: SupabaseClient | null = null;
    let currentMembers: TeamPresenceMember[] = [];
    let rosterTimer: ReturnType<typeof setTimeout> | null = null;
    const channels = new Map<string, RealtimeChannel>();
    const viewedClients = new Map<string, string | null>();
    const knownClientIds = new Set<string>();
    const controller = new AbortController();

    const clearChannels = () => {
      for (const channel of channels.values()) void supabase?.removeChannel(channel);
      channels.clear();
    };
    const syncChannels = () => {
      if (disposed || !supabase) return;
      const wanted = new Set(currentMembers.map(member => member.auth_user_id));
      for (const [authId, channel] of channels) {
        if (!wanted.has(authId)) { void supabase.removeChannel(channel); channels.delete(authId); viewedClients.delete(authId); }
      }
      for (const member of currentMembers) {
        const authId = member.auth_user_id;
        if (channels.has(authId)) continue;
        const channel = supabase.channel(`team-presence:${authId}`, { config: { private: true } });
        channels.set(authId, channel);
        setChannelStates(previous => ({ ...previous, [authId]: "connecting" }));
        const sync = () => {
          if (disposed) return;
          const next = Object.values(channel.presenceState()).flat().map(parsePresencePacket).filter((packet): packet is StaffPresencePacket => packet !== null);
          setPackets(previous => ({ ...previous, [authId]: next }));
          const observed = Math.max(0, ...next.map(packet => packet.observed_at).filter(at => at <= Date.now() + serverOffset + 30_000));
          if (observed) setLastSeen(previous => ({ ...previous, [authId]: Math.max(previous[authId] ?? 0, observed) }));
          const current = selectCurrentPresence(next, Date.now() + serverOffset);
          viewedClients.set(authId, current?.active_client_id ?? null);
          // Client names are read through manager RLS, never trusted from a packet.
          if (current?.active_client_id && !knownClientIds.has(current.active_client_id) && !rosterTimer) {
            rosterTimer = setTimeout(() => { rosterTimer = null; void refresh(); }, 2_000);
          }
        };
        channel.on("presence", { event: "sync" }, sync).subscribe(status => {
          if (disposed) return;
          const next = status === "SUBSCRIBED" ? "SUBSCRIBED" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting";
          setChannelStates(previous => ({ ...previous, [authId]: next }));
        });
      }
    };

    const connect = async () => {
      if (disposed || connecting || !allowed) return;
      connecting = true;
      try {
        const response = await fetch("/api/staff/realtime-token", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json().catch(() => null);
        if (disposed) return;
        if (!data?.ok) { setError(data?.error?.code === "NOT_CONFIGURED" ? "not_configured" : "unavailable"); return; }
        if (!supabase) supabase = createClient(data.url, data.anon_key, { auth: { persistSession: false, autoRefreshToken: false } });
        await supabase.realtime.setAuth(data.token);
        if (!disposed) { setError(null); syncChannels(); }
      } catch { if (!disposed) setError("unavailable"); }
      finally { connecting = false; }
    };

    const refresh = async () => {
      if (disposed) return;
      if (refreshing) { refreshAgain = true; return; }
      refreshing = true;
      try {
        const ids = [...new Set([...viewedClients.values()].filter((id): id is string => id !== null))].slice(0, 64);
        const query = ids.length ? `?clients=${ids.join(",")}` : "";
        const response = await fetch(`/api/staff/presence${query}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json().catch(() => null);
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          allowed = false;
          currentMembers = [];
          clearChannels();
          setMembers([]); setPackets({}); setLastSeen({}); setClientLabels({}); setChannelStates({}); setError("forbidden");
          return;
        }
        if (!response.ok || !data?.ok || !Array.isArray(data.members)) { setError("unavailable"); return; }
        allowed = true;
        currentMembers = data.members;
        setMembers(currentMembers);
        const labels: Record<string, TeamPresenceClient> = {};
        for (const member of currentMembers) {
          if (member.active_client_id && member.active_client_name && member.active_client_ref) {
            labels[member.active_client_id] = { id: member.active_client_id, ref: member.active_client_ref, full_name: member.active_client_name };
            knownClientIds.add(member.active_client_id);
          }
        }
        if (Array.isArray(data.clients)) for (const client of data.clients as TeamPresenceClient[]) labels[client.id] = client;
        for (const id of ids) knownClientIds.add(id);
        setClientLabels(previous => ({ ...previous, ...labels }));
        const serverTime = Date.parse(data.server_time);
        if (Number.isFinite(serverTime)) { serverOffset = serverTime - Date.now(); setClockOffset(serverOffset); }
        setError(null);
        if (supabase) syncChannels(); else await connect();
      } catch { if (!disposed) setError("unavailable"); }
      finally {
        refreshing = false;
        if (!disposed) {
          setLoading(false);
          if (refreshAgain && !rosterTimer) {
            refreshAgain = false;
            rosterTimer = setTimeout(() => { rosterTimer = null; void refresh(); }, 2_000);
          }
        }
      }
    };
    const onFocus = () => { void refresh(); };
    const onOnline = () => { void refresh(); void connect(); };
    const refreshTimer = setInterval(() => { void refresh(); }, 60_000);
    const tokenTimer = setInterval(() => { void connect(); }, 4 * 60_000);
    const clockTimer = setInterval(() => setClock(Date.now()), 15_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    void refresh();
    return () => {
      disposed = true; controller.abort(); clearChannels();
      if (rosterTimer) clearTimeout(rosterTimer);
      clearInterval(refreshTimer); clearInterval(tokenTimer); clearInterval(clockTimer);
      window.removeEventListener("focus", onFocus); window.removeEventListener("online", onOnline);
    };
  }, [retry]);

  const now = clock + clockOffset;
  const rows = useMemo<TeamRow[]>(() => members.map(member => {
    const raw = packets[member.auth_user_id] ?? [];
    const current = selectCurrentPresence(raw, now);
    const latest = raw.filter(packet => packet.observed_at <= now + 30_000).sort((a, b) => b.observed_at - a.observed_at)[0] ?? null;
    const packet = current ?? latest;
    const verified = channelStates[member.auth_user_id] === "SUBSCRIBED" && !error;
    const status: PresenceStatus = !verified ? "unknown" : !packet ? "offline" : packet.visible && packet.state === "active" && now - packet.observed_at <= PRESENCE_STALE_MS ? "active" : "idle";
    const durable = member.seen_at ? Date.parse(member.seen_at) : 0;
    const observed = Math.max(lastSeen[member.auth_user_id] ?? 0, Number.isFinite(durable) ? durable : 0, packet?.observed_at ?? 0);
    return { member, packet, status, lastSeen: observed || null };
  }), [members, packets, channelStates, now, error, lastSeen]);
  const live = members.length > 0 && !error && members.every(member => channelStates[member.auth_user_id] === "SUBSCRIBED");
  const activeCount = rows.filter(row => row.status === "active").length;
  const statusLabel = (status: PresenceStatus) => status === "active" ? t("Active", "نشط") : status === "idle" ? t("Idle", "خامل") : status === "offline" ? t("Offline", "غير متصل") : t("Unverified", "غير متحقق");

  return <section className={styles.panel} dir={dir} aria-labelledby="team-now-heading" data-testid="team-now-panel">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>{t("SHARED WORKSPACE", "مساحة الفريق")}</span><h2 id="team-now-heading">{t("Team now", "الفريق الآن")} <span className={styles.total}>{activeCount}/{members.length}</span></h2></div>
      <div className={styles.tools}><span className={`${styles.connection} ${live ? styles.live : ""}`} role="status"><span aria-hidden="true" />{live ? t("Live", "مباشر") : loading ? t("Connecting…", "جارٍ الاتصال…") : t("Connection unverified", "الاتصال غير متحقق")}</span><button type="button" className={styles.refresh} onClick={() => setRetry(value => value + 1)} aria-label={t("Refresh team presence", "تحديث حالة الفريق")} title={t("Refresh", "تحديث")}>↻</button></div>
    </header>
    <p className={styles.note}>{t("Current viewing activity · idle after 5 minutes", "نشاط المشاهدة الحالي · خمول بعد 5 دقائق")}</p>
    {error && <div className={styles.error} role="status">{error === "forbidden" ? t("Management access is required to view the team.", "عرض الفريق متاح للإدارة فقط.") : error === "not_configured" ? t("Live presence is not configured. Last recorded activity is shown.", "الحضور المباشر غير مهيأ. يظهر آخر نشاط مسجل.") : t("Live presence is unavailable. Connection status is unverified.", "تعذر تحديث الحضور المباشر. حالة الاتصال غير متحققة.")}</div>}
    {loading && members.length === 0 ? <div className={styles.empty}>{t("Loading team activity…", "جارٍ تحميل نشاط الفريق…")}</div> : rows.length === 0 ? <div className={styles.empty}>{t("No connected staff accounts to display.", "لا توجد حسابات موظفين مرتبطة لعرضها.")}</div> : <ul className={styles.list}>
      {rows.map(({ member, packet, status, lastSeen: at }) => {
        const path = safeStaffPresencePath(packet?.path ?? member.path);
        const workspaceSection = packet ? packet.workspace_section : member.workspace_section;
        const href = presenceHref(path, workspaceSection);
        const section = presenceSection(path, workspaceSection);
        const clientId = packet ? packet.active_client_id : member.active_client_id;
        const client = clientId ? clientLabels[clientId] : null;
        const peers = clientId && status !== "offline" && status !== "unknown" ? rows.filter(row => row.member.staff_id !== member.staff_id && (row.status === "active" || row.status === "idle") && row.packet?.active_client_id === clientId) : [];
        return <li key={member.staff_id} className={styles.member} data-state={status}>
          <div className={styles.avatar} aria-hidden="true">{initials(member.display_name)}<span className={styles.dot} /></div>
          <div className={styles.details}><div className={styles.nameRow}><bdi className={styles.name}>{member.display_name}</bdi><span className={styles.badge}>{statusLabel(status)}</span></div>
            {href ? <Link href={href} prefetch={false} className={styles.sectionLink}>{t(section.en, section.ar)} <span aria-hidden="true">↗</span></Link> : <span className={styles.sectionLink}>{t("No workspace recorded", "لم تُسجّل مساحة عمل")}</span>}
            {clientId && <Link href={`/staff/client/${clientId}`} prefetch={false} className={styles.clientLink}><bdi>{client?.ref ?? t("Client file", "ملف العميل")}{client?.full_name ? ` · ${client.full_name}` : ""}</bdi></Link>}
            {peers.length > 0 && <div className={styles.coViewing}><span className={styles.avatarStack} aria-hidden="true">{peers.slice(0, 3).map(peer => <span key={peer.member.staff_id} title={peer.member.display_name}>{initials(peer.member.display_name)}</span>)}</span><span>{t("Also viewing: ", "يشاهد أيضًا: ")}{peers.map(peer => peer.member.display_name).join(t(", ", "، "))}</span></div>}
            <span className={styles.lastSeen}>{t("Last seen: ", "آخر ظهور: ")}{at ? <time dateTime={new Date(at).toISOString()}>{dateTime(new Date(at))}</time> : t("No activity recorded", "لا يوجد نشاط مسجل")}</span>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
