import net from 'net';

export type NetworkDirection = 'outbound' | 'inbound';

export type NetworkExcludeReason =
  | 'localhost'
  | 'model_provider'
  | 'channel_provider'
  | 'denylist';

export interface NetworkPolicyConfig {
  logIncoming: boolean;
  excludeLocalhost: boolean;
  excludeModelHosts: boolean;
  excludeChannelHosts: boolean;
  denyHosts: string[];
  denyCidrs: string[];
  modelHosts: string[];
  modelCidrs: string[];
  channelHosts: string[];
  channelCidrs: string[];
}

export interface NetworkPolicyDecision {
  allow: boolean;
  reason?: NetworkExcludeReason;
}

const DEFAULT_MODEL_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.venice.ai'
];

const DEFAULT_CHANNEL_HOSTS = [
  'api.telegram.org',
  'discord.com',
  'slack.com',
  'api.whatsapp.com',
  'graph.facebook.com'
];

function parseBool(input: string | undefined, fallback: boolean): boolean {
  if (input == null || input === '') return fallback;
  const v = String(input).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parseCsv(input: string | undefined): string[] {
  if (!input) return [];
  return String(input)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.').map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return (((p[0]! << 24) >>> 0) | ((p[1]! << 16) >>> 0) | ((p[2]! << 8) >>> 0) | (p[3]! >>> 0)) >>> 0;
}

function ipInCidr(candidateIp: string, cidr: string): boolean {
  const [netIp, rawPrefix] = String(cidr || '').split('/');
  const prefix = Number(rawPrefix);
  const ipN = ipv4ToInt(candidateIp);
  const netN = ipv4ToInt(String(netIp || ''));
  if (ipN == null || netN == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipN & mask) === (netN & mask);
}

function hostMatchesCidrs(candidateHost: string, cidrs: string[]): boolean {
  const h = normalizeHost(candidateHost);
  if (net.isIP(h) !== 4) return false; // IPv4 only for now
  for (const c of cidrs) {
    if (ipInCidr(h, c)) return true;
  }
  return false;
}

function hostMatches(candidateHost: string, list: string[]): boolean {
  const h = normalizeHost(candidateHost);
  if (!h) return false;
  for (const raw of list) {
    const item = String(raw || '').trim().toLowerCase();
    if (!item) continue;

    // host:port exact entry support
    if (item.includes(':')) {
      if (h === item) return true;
      continue;
    }

    if (h === item || h.endsWith(`.${item}`)) return true;
  }
  return false;
}

export function normalizeHost(host: string): string {
  return String(host || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

export function isLocalhost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (h.startsWith('127.')) return true;

  const ipType = net.isIP(h);
  if (ipType === 4) {
    if (h.startsWith('10.')) return true;
    if (h.startsWith('192.168.')) return true;
    if (h.startsWith('169.254.')) return true;
    const m = h.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    return false;
  }

  if (ipType === 6) {
    if (h.startsWith('fe80:')) return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    return false;
  }

  return false;
}

export function loadNetworkPolicyConfig(env = process.env): NetworkPolicyConfig {
  const modelHosts = parseCsv(env.OBSERVECLAW_NETWORK_MODEL_HOSTS);
  const channelHosts = parseCsv(env.OBSERVECLAW_NETWORK_CHANNEL_HOSTS);

  return {
    logIncoming: parseBool(env.OBSERVECLAW_NETWORK_LOG_INCOMING, true),
    excludeLocalhost: parseBool(env.OBSERVECLAW_NETWORK_EXCLUDE_LOCALHOST, true),
    excludeModelHosts: parseBool(env.OBSERVECLAW_NETWORK_EXCLUDE_MODEL_HOSTS, true),
    excludeChannelHosts: parseBool(env.OBSERVECLAW_NETWORK_EXCLUDE_CHANNEL_HOSTS, true),
    denyHosts: parseCsv(env.OBSERVECLAW_NETWORK_DENY_HOSTS),
    denyCidrs: parseCsv(env.OBSERVECLAW_NETWORK_DENY_CIDRS),
    modelHosts: modelHosts.length ? modelHosts : DEFAULT_MODEL_HOSTS,
    modelCidrs: parseCsv(env.OBSERVECLAW_NETWORK_MODEL_CIDRS),
    channelHosts: channelHosts.length ? channelHosts : DEFAULT_CHANNEL_HOSTS,
    channelCidrs: parseCsv(env.OBSERVECLAW_NETWORK_CHANNEL_CIDRS)
  };
}

export function evaluateNetworkPolicy(
  cfg: NetworkPolicyConfig,
  direction: NetworkDirection,
  host: string
): NetworkPolicyDecision {
  const normalized = normalizeHost(host);

  if (cfg.excludeLocalhost && isLocalhost(normalized)) {
    return { allow: false, reason: 'localhost' };
  }

  if (direction === 'outbound') {
    if (cfg.excludeModelHosts && (hostMatches(normalized, cfg.modelHosts) || hostMatchesCidrs(normalized, cfg.modelCidrs))) {
      return { allow: false, reason: 'model_provider' };
    }
    if (cfg.excludeChannelHosts && (hostMatches(normalized, cfg.channelHosts) || hostMatchesCidrs(normalized, cfg.channelCidrs))) {
      return { allow: false, reason: 'channel_provider' };
    }
  }

  if (hostMatches(normalized, cfg.denyHosts) || hostMatchesCidrs(normalized, cfg.denyCidrs)) {
    return { allow: false, reason: 'denylist' };
  }

  return { allow: true };
}
