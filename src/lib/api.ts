export type RouterMode = 'rule' | 'proxy' | 'direct';

export interface StatsData {
  protocol: string;
  tcp_conns: number;
  udp_sessions: number;
  upload: number;
  download: number;
  latency: number;
  ip: string;
  loc: string;
  outbounds?: string[] | null;
  selected_node?: string | null;
}

export interface PathState {
  packet_loss_rate: number;
  mtu: number;
  rtt: number;
}

export interface ObserveResponse {
  inbounds: Record<string, StatsData>;
  outbounds: Record<string, StatsData>;
  dns_avg_time_us: number;
  route_avg_time_us: number;
  memory_usage: number;
}

export interface OutboundInfo {
  tag: string;
  protocol: string;
  latency: number;
  ip: string;
  loc: string;
  outbounds?: string[] | null;
  selected_node?: string | null;
  uplink_path_stats?: PathState | null;
  downlink_path_stats?: PathState | null;
}

export interface ConnectionData {
  id: string;
  inbound_tag: string;
  outbound_tag: string;
  matched_rule_index?: number | null;
  dst: string;
  ip: string;
  is_fakeip: boolean;
  is_udp: boolean;
  upload: number;
  download: number;
  start_time: number;
}

export interface TrafficEntry {
  domain: string;
  ip: string;
  outbound_tag: string;
  upload: number;
  download: number;
  last_active: number;
}

export interface TraceResponse {
  ip: string;
  loc: string;
  duration_ms: number;
}

export interface RequestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  duration_ms: number;
}

export interface ApiSettings {
  baseUrl: string;
  password: string;
  refreshIntervalMs: number;
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withProtocol = trimmed.startsWith('/') || /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  if (shouldUseSameOriginProxy(withProtocol)) {
    return '';
  }

  return withProtocol;
}

function shouldUseSameOriginProxy(baseUrl: string) {
  if (typeof window === 'undefined') return false;

  try {
    const url = new URL(baseUrl, window.location.origin);
    const isQuicProxyLocalApi =
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      url.port === '1235' &&
      !url.pathname.replace(/\/+$/, '');
    return import.meta.env.DEV && isQuicProxyLocalApi;
  } catch {
    return false;
  }
}

async function request<T>(
  settings: ApiSettings,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (settings.password.trim()) {
    headers.set('Authorization', `Bearer ${settings.password.trim()}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = response.status === 401 ? 'Unauthorized' : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`Expected JSON from ${response.url}, got ${contentType || 'unknown content type'}: ${preview}`);
  }

  return JSON.parse(text) as T;
}

export const api = {
  observe: (settings: ApiSettings) => request<ObserveResponse>(settings, '/observe'),
  outbounds: (settings: ApiSettings) => request<OutboundInfo[]>(settings, '/outbounds'),
  mode: (settings: ApiSettings) => request<{ mode: RouterMode }>(settings, '/mode'),
  setMode: (settings: ApiSettings, mode: RouterMode) =>
    request<void>(settings, '/mode', { method: 'PUT', body: JSON.stringify({ mode }) }),
  select: (settings: ApiSettings, outbound: string, selected: string) =>
    request<void>(settings, '/selector', {
      method: 'PUT',
      body: JSON.stringify({ outbound, selected }),
    }),
  connections: (settings: ApiSettings) => request<ConnectionData[]>(settings, '/connections'),
  closeConnection: (settings: ApiSettings, id: string) =>
    request<void>(settings, `/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  closeAllConnections: (settings: ApiSettings) =>
    request<void>(settings, '/connections?all=true', { method: 'DELETE' }),
  closeOutboundConnections: (settings: ApiSettings, outbound: string) =>
    request<void>(settings, `/connections?outbound=${encodeURIComponent(outbound)}`, { method: 'DELETE' }),
  trace: (settings: ApiSettings, tag: string) =>
    request<TraceResponse>(settings, `/trace?tag=${encodeURIComponent(tag)}`),
  traffic: (settings: ApiSettings) => request<TrafficEntry[]>(settings, '/traffic'),
  testRequest: (settings: ApiSettings, tag: string, url: string, maxRedirects = 5) =>
    request<RequestResponse>(
      settings,
      `/request?tag=${encodeURIComponent(tag)}&url=${encodeURIComponent(url)}&max_redirects=${maxRedirects}`,
    ),
  quit: (settings: ApiSettings) => request<void>(settings, '/quit'),
};
