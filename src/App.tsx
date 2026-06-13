import {
  Activity,
  Cable,
  Gauge,
  Globe2,
  LayoutDashboard,
  ListX,
  LogOut,
  Moon,
  Network,
  PlugZap,
  RefreshCw,
  Route,
  Search,
  Send,
  Settings,
  Sun,
  TerminalSquare,
  Wifi,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/images/icon.png';
import { Sparkline } from './components/Sparkline';
import { ApiSettings, ConnectionData, ObserveResponse, OutboundInfo, PathState, RequestResponse, RouterMode, TrafficEntry, api } from './lib/api';
import { formatBytes, formatDurationFromEpoch, formatLatency, formatRate, formatTime, sumBy } from './lib/format';

type View = 'overview' | 'proxies' | 'connections' | 'traffic' | 'tools' | 'settings';
type ThemeMode = 'dark' | 'light';
type RateSample = { upload: number; download: number };
type TrafficSnapshot = RateSample & { timestamp: number };

const emptyRateSeries = (): RateSample[] => Array.from({ length: 18 }, () => ({ upload: 0, download: 0 }));
const RATE_SMOOTHING_WINDOW_MS = 8000;
const LOGO_FILTERS: Record<ThemeMode, string> = {
  dark: 'hue-rotate(-58deg) saturate(0.88) brightness(1.04)',
  light: 'hue-rotate(-68deg) saturate(0.78) brightness(0.96)',
};

const defaultSettings: ApiSettings = {
  baseUrl: localStorage.getItem('quicproxy.apiBase') || '',
  password: localStorage.getItem('quicproxy.password') || '',
  refreshIntervalMs: readRefreshInterval(),
};

const navItems: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: 'overview', label: 'Overview', icon: LayoutDashboard },
  { view: 'proxies', label: 'Proxies', icon: Network },
  { view: 'connections', label: 'Connections', icon: Cable },
  { view: 'traffic', label: 'Traffic', icon: Activity },
  { view: 'tools', label: 'Tools', icon: TerminalSquare },
  { view: 'settings', label: 'Settings', icon: Settings },
];

export function App() {
  const [view, setView] = useState<View>(() => viewFromHash());
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('quicproxy.theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  const [settings, setSettings] = useState(defaultSettings);
  const [observe, setObserve] = useState<ObserveResponse | null>(null);
  const [outbounds, setOutbounds] = useState<OutboundInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [traffic, setTraffic] = useState<TrafficEntry[]>([]);
  const [mode, setMode] = useState<RouterMode>('rule');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [trafficSeries, setTrafficSeries] = useState<RateSample[]>(emptyRateSeries);
  const trafficHistory = useRef<TrafficSnapshot[]>([]);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [observeData, outboundData, connectionData, modeData] = await Promise.all([
        api.observe(settings),
        api.outbounds(settings),
        api.connections(settings),
        api.mode(settings),
      ]);
      setObserve(observeData);
      setOutbounds(outboundData.sort((a, b) => a.tag.localeCompare(b.tag)));
      setConnections(connectionData.sort((a, b) => b.start_time - a.start_time));
      setMode(modeData.mode);
      const now = Date.now();
      const traffic = observedTraffic(observeData);
      const sample = smoothedRateSample(trafficHistory.current, { ...traffic, timestamp: now });
      setTrafficSeries((series) => [...series.slice(1), sample]);
      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach QuicProxy API');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    trafficHistory.current = [];
    setTrafficSeries(emptyRateSeries());
    refresh();
    const id = window.setInterval(() => refresh(true), settings.refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [settings.baseUrl, settings.password, settings.refreshIntervalMs]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('quicproxy.theme', theme);
    updateFavicon(theme);
  }, [theme]);

  useEffect(() => {
    function syncViewFromHash() {
      setView(viewFromHash());
    }

    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/overview');
    }

    window.addEventListener('hashchange', syncViewFromHash);
    syncViewFromHash();
    return () => window.removeEventListener('hashchange', syncViewFromHash);
  }, []);

  const totals = useMemo(() => {
    const inboundStats = Object.values(observe?.inbounds ?? {});
    return {
      upload: sumBy(inboundStats, (item) => item.upload),
      download: sumBy(inboundStats, (item) => item.download),
      tcp: sumBy(inboundStats, (item) => item.tcp_conns),
      udp: sumBy(inboundStats, (item) => item.udp_sessions),
      memory: observe?.memory_usage ?? 0,
    };
  }, [observe]);

  const activeView = {
    overview: <Overview settings={settings} observe={observe} outbounds={outbounds} setOutbounds={setOutbounds} onRefresh={refresh} connections={connections} totals={totals} mode={mode} series={trafficSeries} />,
    proxies: <Proxies settings={settings} outbounds={outbounds} setOutbounds={setOutbounds} onRefresh={refresh} />,
    connections: <Connections settings={settings} connections={connections} onRefresh={refresh} />,
    traffic: <Traffic settings={settings} traffic={traffic} setTraffic={setTraffic} />,
    tools: <Tools settings={settings} outbounds={outbounds} />,
    settings: <SettingsView settings={settings} setSettings={setSettings} />,
  }[view];

  async function changeMode(nextMode: RouterMode) {
    const previousMode = mode;
    setMode(nextMode);
    try {
      await api.setMode(settings, nextMode);
      refresh(true);
    } catch (err) {
      setMode(previousMode);
      setError(err instanceof Error ? err.message : 'Unable to change router mode');
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">
            <img src={logoUrl} alt="" aria-hidden="true" />
          </div>
          <div>
            <strong>QuicProxy</strong>
            <span>Control center</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => navigateToView(item.view)} title={item.label}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.view === view)?.label}</h1>
            <p>{lastUpdated ? `Synced ${lastUpdated.toLocaleTimeString()}` : 'Connect to QuicProxy API'}</p>
          </div>
          <div className="topbar-actions">
            <div className="segmented" aria-label="Router mode">
              {(['rule', 'proxy', 'direct'] as RouterMode[]).map((item) => (
                <button key={item} className={mode === item ? 'selected' : ''} onClick={() => changeMode(item)}>
                  {item}
                </button>
              ))}
            </div>
            <button
              className="icon-button"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to bright mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to bright mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="icon-button" onClick={() => refresh()} title="Refresh" aria-label="Refresh">
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </header>

        {error && (
          <div className="notice">
            <Wifi size={18} />
            <span>{error}. Check API address, password, and whether QuicProxy API is listening.</span>
          </div>
        )}

        {activeView}
      </main>

      <nav className="mobile-dock" aria-label="Mobile navigation">
        {navItems.map((item) => (
          <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => navigateToView(item.view)} title={item.label}>
            <item.icon size={20} />
          </button>
        ))}
      </nav>
    </div>
  );
}

function Overview({ settings, observe, outbounds, setOutbounds, onRefresh, connections, totals, mode, series }: {
  settings: ApiSettings;
  observe: ObserveResponse | null;
  outbounds: OutboundInfo[];
  setOutbounds: React.Dispatch<React.SetStateAction<OutboundInfo[]>>;
  onRefresh: (silent?: boolean) => Promise<void>;
  connections: ConnectionData[];
  totals: { upload: number; download: number; tcp: number; udp: number; memory: number };
  mode: RouterMode;
  series: RateSample[];
}) {
  const [busy, setBusy] = useState('');
  const [openSelector, setOpenSelector] = useState('');
  const selectors = outbounds.filter((item) => item.tag === 'default_server' && item.outbounds?.length);
  const fastest = outbounds.filter((item) => item.latency > 0).sort((a, b) => a.latency - b.latency)[0];
  const latestRate = series[series.length - 1] ?? { upload: 0, download: 0 };

  async function select(outbound: string, selected: string) {
    setBusy(`${outbound}:${selected}`);
    setOpenSelector('');
    const previousOutbounds = outbounds;
    setOutbounds((items) => items.map((item) => item.tag === outbound ? { ...item, selected_node: selected } : item));
    try {
      await api.select(settings, outbound, selected);
      onRefresh(true);
    } catch (err) {
      setOutbounds(previousOutbounds);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="view-stack">
      <div className="metrics-grid">
        <Metric icon={Gauge} label="Mode" value={capitalizeMode(mode)} detail={`${connections.length} active connections`} />
        <Metric icon={Activity} label="Transfer" value={formatBytes(totals.upload + totals.download)} detail={`${formatBytes(totals.upload)} up / ${formatBytes(totals.download)} down`} />
        <Metric icon={Cable} label="Sessions" value={`${totals.tcp + totals.udp}`} detail={`${totals.tcp} TCP / ${totals.udp} UDP`} />
        <Metric
          icon={PlugZap}
          label="Memory"
          value={formatBytes(totals.memory)}
          detail={
            <span className="latency-pair">
              <LatencyBadge label="DNS" latencyUs={observe?.dns_avg_time_us ?? 0} />
              <LatencyBadge label="Route" latencyUs={observe?.route_avg_time_us ?? 0} />
            </span>
          }
        />
      </div>

      <section className="panel hero-panel">
        <div className="rate-summary">
          <span className="eyebrow">Realtime</span>
          <div className="rate-split">
            <div>
              <span>Down</span>
              <strong>{formatRate(latestRate.download)}</strong>
            </div>
            <div>
              <span>Up</span>
              <strong>{formatRate(latestRate.upload)}</strong>
            </div>
          </div>
        </div>
        <div className="rate-chart" aria-label="Upload and download rate trend">
          <Sparkline values={series.map((item) => item.download)} className="hero-sparkline download-line" />
          <Sparkline values={series.map((item) => item.upload)} className="hero-sparkline upload-line" />
        </div>
      </section>

      <div className="overview-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>Proxy groups</h2>
          </div>
          <div className="selector-grid">
            {selectors.map((selector) => (
              <div className="mini-group" key={selector.tag}>
                <div className="mini-group-label">
                  <span>{selector.tag}</span>
                  <strong>{selector.selected_node || 'none'}</strong>
                </div>
                <div className="selector-menu">
                  <button
                    className="selector-trigger"
                    onClick={() => setOpenSelector((current) => current === selector.tag ? '' : selector.tag)}
                    disabled={!!busy}
                    aria-expanded={openSelector === selector.tag}
                    aria-label={`Select proxy for ${selector.tag}`}
                  >
                    <span>{selector.selected_node || 'Select proxy'}</span>
                    {busy.startsWith(`${selector.tag}:`) ? <RefreshCw size={14} className="spin" /> : <ChevronDownIcon />}
                  </button>
                  {openSelector === selector.tag && (
                    <div className="selector-options">
                      {selector.outbounds?.map((choice) => (
                        <button key={choice} className={selector.selected_node === choice ? 'selected' : ''} onClick={() => select(selector.tag, choice)}>
                          <span>{choice}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!selectors.length && <Empty title="No selector groups" />}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Best route</h2>
            <Route size={18} />
          </div>
          {fastest ? (
            <div className="route-card">
              <strong>{fastest.tag}</strong>
              <span>{fastest.protocol}</span>
              <LatencyBadge latencyUs={fastest.latency} />
              <small>{fastest.ip || 'No IP'} {fastest.loc && `- ${fastest.loc}`}</small>
            </div>
          ) : (
            <Empty title="No latency data yet" />
          )}
        </section>
      </div>
    </section>
  );
}

function Proxies({
  settings,
  outbounds,
  setOutbounds,
  onRefresh,
}: {
  settings: ApiSettings;
  outbounds: OutboundInfo[];
  setOutbounds: React.Dispatch<React.SetStateAction<OutboundInfo[]>>;
  onRefresh: (silent?: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState('');

  async function select(outbound: string, selected: string) {
    setBusy(`${outbound}:${selected}`);
    const previousOutbounds = outbounds;
    setOutbounds((items) => items.map((item) => item.tag === outbound ? { ...item, selected_node: selected } : item));
    try {
      await api.select(settings, outbound, selected);
      onRefresh(true);
    } catch (err) {
      setOutbounds(previousOutbounds);
    } finally {
      setBusy('');
    }
  }

  async function trace(tag: string) {
    setBusy(`trace:${tag}`);
    try {
      await api.trace(settings, tag);
      await onRefresh(true);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="view-stack">
      <div className="proxy-grid">
        {outbounds.map((outbound) => (
          <article className="proxy-card" key={outbound.tag}>
            <div className="proxy-head">
              <div>
                <strong>{outbound.tag}</strong>
                <span>{outbound.protocol}</span>
              </div>
              <button className="icon-button small" title="Trace route" onClick={() => trace(outbound.tag)}>
                <Globe2 size={16} className={busy === `trace:${outbound.tag}` ? 'spin' : ''} />
              </button>
            </div>
            <div className="proxy-meta">
              <LatencyBadge latencyUs={outbound.latency} />
              {hasPacketLoss(outbound.uplink_path_stats?.packet_loss_rate) && (
                <PacketLossBadge label="Up loss" pathState={outbound.uplink_path_stats} />
              )}
              {hasPacketLoss(outbound.downlink_path_stats?.packet_loss_rate) && (
                <PacketLossBadge label="Down loss" pathState={outbound.downlink_path_stats} />
              )}
              <span>{outbound.ip || 'no ip'}</span>
              <span>{outbound.loc || 'unknown'}</span>
            </div>
            {outbound.outbounds?.length ? (
              <div className="choice-list">
                {outbound.outbounds.map((choice) => (
                  <button key={choice} className={outbound.selected_node === choice ? 'selected' : ''} onClick={() => select(outbound.tag, choice)} disabled={!!busy}>
                    <span>{choice}</span>
                    {busy === `${outbound.tag}:${choice}` && <RefreshCw size={14} className="spin" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="plain-node">Standalone outbound</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Connections({ settings, connections, onRefresh }: { settings: ApiSettings; connections: ConnectionData[]; onRefresh: (silent?: boolean) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const filtered = connections.filter((item) => `${item.dst} ${item.ip} ${item.outbound_tag} ${item.inbound_tag}`.toLowerCase().includes(query.toLowerCase()));

  async function close(id: string) {
    await api.closeConnection(settings, id);
    await onRefresh(true);
  }

  async function closeAll() {
    await api.closeAllConnections(settings);
    await onRefresh(true);
  }

  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter connections" />
        </div>
        <button className="danger-button" onClick={closeAll}><ListX size={16} />Close all</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Path</th>
              <th>Traffic</th>
              <th>Age</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.dst}</strong><span>{item.ip}</span></td>
                <td><span>{item.inbound_tag} {'>'} {item.outbound_tag}</span><small>{item.is_udp ? 'UDP' : 'TCP'} {item.is_fakeip && 'FakeIP'}</small></td>
                <td>{formatBytes(item.upload)} / {formatBytes(item.download)}</td>
                <td>{formatDurationFromEpoch(item.start_time)}</td>
                <td><button className="icon-button small" title="Close connection" onClick={() => close(item.id)}><X size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <Empty title="No matching connections" />}
    </section>
  );
}

function Traffic({ settings, traffic, setTraffic }: { settings: ApiSettings; traffic: TrafficEntry[]; setTraffic: (traffic: TrafficEntry[]) => void }) {
  async function drainTraffic() {
    setTraffic(await api.traffic(settings));
  }

  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <h2>Destination traffic</h2>
        <button className="secondary-button" onClick={drainTraffic}><RefreshCw size={16} />Drain sample</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Destination</th>
              <th>Outbound</th>
              <th>Upload</th>
              <th>Download</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {traffic.map((item) => (
              <tr key={`${item.domain}:${item.ip}:${item.outbound_tag}`}>
                <td><strong>{item.domain || item.ip}</strong><span>{item.ip}</span></td>
                <td>{item.outbound_tag}</td>
                <td>{formatBytes(item.upload)}</td>
                <td>{formatBytes(item.download)}</td>
                <td>{formatTime(item.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!traffic.length && <Empty title="No drained traffic sample" />}
    </section>
  );
}

function Tools({ settings, outbounds }: { settings: ApiSettings; outbounds: OutboundInfo[] }) {
  const [tag, setTag] = useState(outbounds[0]?.tag || '');
  const [url, setUrl] = useState('https://www.cloudflare.com/cdn-cgi/trace');
  const [result, setResult] = useState<RequestResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tag && outbounds[0]) setTag(outbounds[0].tag);
  }, [outbounds, tag]);

  async function run() {
    setBusy(true);
    try {
      setResult(await api.testRequest(settings, tag, url));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view-stack">
      <div className="panel form-panel">
        <label>
          <span>Outbound</span>
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            {outbounds.map((item) => <option key={item.tag} value={item.tag}>{item.tag}</option>)}
          </select>
        </label>
        <label>
          <span>URL</span>
          <input value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <button className="primary-button" onClick={run} disabled={!tag || busy}>
          <Send size={16} />Send request
        </button>
      </div>
      {result && (
        <section className="panel response-panel">
          <div className="panel-head">
            <h2>HTTP {result.status}</h2>
            <span>{result.duration_ms} ms</span>
          </div>
          <pre>{result.body.slice(0, 3000)}</pre>
        </section>
      )}
    </section>
  );
}

function SettingsView({ settings, setSettings }: { settings: ApiSettings; setSettings: (settings: ApiSettings) => void }) {
  const [draft, setDraft] = useState(settings);

  function save() {
    const refreshIntervalMs = clampRefreshInterval(draft.refreshIntervalMs);
    localStorage.setItem('quicproxy.apiBase', draft.baseUrl.trim());
    localStorage.setItem('quicproxy.password', draft.password);
    localStorage.setItem('quicproxy.refreshIntervalMs', String(refreshIntervalMs));
    setSettings({ ...draft, baseUrl: draft.baseUrl.trim(), refreshIntervalMs });
    setDraft({ ...draft, baseUrl: draft.baseUrl.trim(), refreshIntervalMs });
  }

  async function quit() {
    await api.quit(settings);
  }

  return (
    <section className="panel form-panel settings-panel">
      <label>
        <span>API base URL</span>
        <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="Same origin, or http://127.0.0.1:1235" />
      </label>
      <label>
        <span>Password</span>
        <input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
      </label>
      <label>
        <span>Refresh interval</span>
        <div className="number-field">
          <input
            type="number"
            min="1"
            max="60"
            step="1"
            value={Math.round(draft.refreshIntervalMs / 1000)}
            onChange={(event) => setDraft({ ...draft, refreshIntervalMs: Number(event.target.value) * 1000 })}
          />
          <span>sec</span>
        </div>
      </label>
      <div className="settings-actions">
        <button className="primary-button" onClick={save}><Settings size={16} />Save</button>
        <button className="danger-button" onClick={quit}><LogOut size={16} />Quit core</button>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: string; detail: React.ReactNode }) {
  return (
    <article className="metric-card">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Empty({ title }: { title: string }) {
  return <div className="empty">{title}</div>;
}

function ChevronDownIcon() {
  return <span className="chevron-icon" aria-hidden="true" />;
}

function LatencyBadge({ latencyUs, label }: { latencyUs: number; label?: string }) {
  return (
    <span className={`latency-badge ${latencyQualityClass(latencyUs)}`}>
      {label && <span>{label}</span>}
      <strong>{formatLatency(latencyUs)}</strong>
    </span>
  );
}

function PacketLossBadge({ pathState, label }: { pathState?: PathState | null; label: string }) {
  const packetLossRate = pathState?.packet_loss_rate ?? 0;

  return (
    <span className={`latency-badge ${packetLossQualityClass(packetLossRate)}`} title={formatPathStateTitle(label, pathState)}>
      <span>{label}</span>
      <strong>{formatPacketLoss(packetLossRate)}</strong>
    </span>
  );
}

function observedTraffic(observe: ObserveResponse) {
  const inbounds = Object.values(observe.inbounds);
  return {
    upload: sumBy(inbounds, (item) => item.upload),
    download: sumBy(inbounds, (item) => item.download),
  };
}

function smoothedRateSample(history: TrafficSnapshot[], current: TrafficSnapshot): RateSample {
  history.push(current);
  const cutoff = current.timestamp - RATE_SMOOTHING_WINDOW_MS;
  while (history.length > 1 && history[0].timestamp < cutoff) {
    history.shift();
  }

  const previous = history[0];
  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
  if (history.length < 2 || elapsedSeconds <= 0) {
    return { upload: 0, download: 0 };
  }

  return {
    upload: Math.max(0, (current.upload - previous.upload) / elapsedSeconds),
    download: Math.max(0, (current.download - previous.download) / elapsedSeconds),
  };
}

function latencyQualityClass(latencyUs: number) {
  if (!latencyUs) return 'latency-pending';
  const latencyMs = latencyUs / 1000;
  if (latencyMs < 80) return 'latency-good';
  if (latencyMs < 180) return 'latency-fair';
  if (latencyMs < 350) return 'latency-poor';
  return 'latency-bad';
}

function packetLossQualityClass(packetLossRate: number) {
  if (packetLossRate < 1) return 'latency-good';
  if (packetLossRate < 3) return 'latency-fair';
  if (packetLossRate < 8) return 'latency-poor';
  return 'latency-bad';
}

function hasPacketLoss(packetLossRate: number | null | undefined) {
  return typeof packetLossRate === 'number' && Number.isFinite(packetLossRate);
}

function formatPacketLoss(packetLossRate: number) {
  if (packetLossRate < 10) return `${packetLossRate.toFixed(2)}%`;
  return `${Math.round(packetLossRate)}%`;
}

function formatPathStateTitle(label: string, pathState?: PathState | null) {
  if (!pathState) return label;
  return `${label}: ${formatPacketLoss(pathState.packet_loss_rate)} | RTT: ${formatPathRtt(pathState.rtt)} | MTU: ${pathState.mtu}`;
}

function formatPathRtt(rtt: number) {
  if (!Number.isFinite(rtt)) return 'unknown';
  return rtt < 1000 ? `${Math.round(rtt)} ms` : `${(rtt / 1000).toFixed(2)} s`;
}

function capitalizeMode(mode: RouterMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function navigateToView(view: View) {
  const nextHash = `#/${view}`;
  if (window.location.hash === nextHash) return;
  window.location.hash = nextHash;
}

function updateFavicon(theme: ThemeMode) {
  const image = new Image();
  image.src = logoUrl;
  image.onload = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.filter = LOGO_FILTERS[theme];
    context.drawImage(image, 0, 0, size, size);

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
  };
}

function viewFromHash(): View {
  const view = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return isView(view) ? view : 'overview';
}

function isView(value: string): value is View {
  return navItems.some((item) => item.view === value);
}

function readRefreshInterval() {
  return clampRefreshInterval(Number(localStorage.getItem('quicproxy.refreshIntervalMs')) || 3000);
}

function clampRefreshInterval(value: number) {
  if (!Number.isFinite(value)) return 3000;
  return Math.min(60000, Math.max(1000, Math.round(value)));
}
