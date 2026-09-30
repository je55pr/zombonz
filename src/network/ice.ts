export const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
] as const;

export interface IceEnvironment {
  VITE_STUN_URLS?: string;
  VITE_TURN_URLS?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

export interface IceConfiguration {
  servers: RTCIceServer[];
  stunUrls: string[];
  turnServers: RTCIceServer[];
  turnConfigured: boolean;
  problem: string | null;
}

function urls(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,]+/).map(url => url.trim()).filter(Boolean);
}

/**
 * Builds the browser ICE configuration from deployment environment values.
 * TURN credentials are intentionally not hard-coded. A TURN URL without both credential fields is ignored and reported.
 */
export function buildIceConfiguration(env: IceEnvironment): IceConfiguration {
  const configuredStun = urls(env.VITE_STUN_URLS);
  const stunUrls = configuredStun.length ? configuredStun : [...DEFAULT_STUN_URLS];
  const turnUrls = urls(env.VITE_TURN_URLS);
  const username = env.VITE_TURN_USERNAME?.trim() ?? '';
  const credential = env.VITE_TURN_CREDENTIAL?.trim() ?? '';
  let problem: string | null = null;
  const turnServers: RTCIceServer[] = [];

  if (turnUrls.length) {
    if (!username || !credential) {
      problem = 'TURN URLs are configured, but the TURN username or credential is missing.';
    } else {
      turnServers.push({ urls: turnUrls, username, credential });
    }
  } else if (username || credential) {
    problem = 'TURN credentials are configured, but no TURN URL is set.';
  }

  return {
    servers: [{ urls: stunUrls }, ...turnServers],
    stunUrls,
    turnServers,
    turnConfigured: turnServers.length > 0,
    problem,
  };
}

const built = buildIceConfiguration(import.meta.env as IceEnvironment);

export const ICE_SERVERS: RTCIceServer[] = built.servers;
export const STUN_URLS: readonly string[] = built.stunUrls;
export const TURN_SERVERS: readonly RTCIceServer[] = built.turnServers;
export const TURN_CONFIGURED = built.turnConfigured;
export const ICE_CONFIG_PROBLEM = built.problem;

export function connectivityFailure(context: 'host' | 'join' | 'room'): string {
  if (ICE_CONFIG_PROBLEM) return `Could not connect because this build's network relay configuration is incomplete: ${ICE_CONFIG_PROBLEM}`;
  if (TURN_CONFIGURED) {
    return context === 'join'
      ? 'Could not connect even with the configured TURN relay. Check that the host is still connecting, then try another network or run Test my connection.'
      : 'Could not connect even with the configured TURN relay. One of the networks, a firewall, or the relay service may be blocking WebRTC.';
  }
  return context === 'join'
    ? 'Could not connect. The host has to paste your reply and press Connect before your countdown ends; if they did, this build has no TURN relay configured for restrictive networks.'
    : 'Could not connect directly. One of the networks may block direct WebRTC, and this build has no TURN relay configured.';
}
