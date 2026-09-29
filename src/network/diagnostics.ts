import { decodeSession } from './codes.ts';
import type { PeerLink } from './link.ts';
import { ICE_SERVERS, answerInvite, createInvite } from './webrtc.ts';

/**
 * "Test my connection": finds out, in the player's own browser, whether this network is likely to let them join or host
 * a game, and writes the answer as plain text a friend can paste into a message. It looks up the public address the way a
 * game does (STUN), checks whether the router hands out one public port or a new one per destination (the difference
 * between direct connections working and not), and makes a real connection to itself with the game's own invite and reply
 * codes. The report leaves out every IP address.
 */

/** The STUN servers the game itself uses, then one more from another company, to compare against. */
export const TEST_STUN_URLS: readonly string[] = [
  ...ICE_SERVERS.flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]),
  'stun:stun.cloudflare.com:3478',
];
const PROBE_LIMIT_MS = 5000;
const SELF_TEST_LIMIT_MS = 12000;

export interface ParsedCandidate { protocol: string; address: string; port: number; type: string }

/** The parts of an ICE candidate line (`candidate:… 1 udp 2113937151 host.local 5000 typ host …`) this test needs. */
export function parseCandidate(line: string | null | undefined): ParsedCandidate | null {
  if (!line) return null;
  const parts = line.replace(/^a=/, '').replace(/^candidate:/, '').trim().split(/\s+/);
  const [, , protocol, , address, port, typ, type] = parts;
  if (typ !== 'typ' || !address || !type) return null;
  return { protocol: protocol.toLowerCase(), address, port: Number(port), type };
}

export interface StunAnswer {
  url: string;
  ok: boolean;
  ms: number;
  /** Which kinds of public address it reported. */
  families: { v4: boolean; v6: boolean };
  /** Why not, when it did not answer. */
  problem?: string;
}

export interface Addresses {
  /** Different public IPv4 addresses and ports seen from one socket: more than one means the router changes port by destination. */
  publicV4: number;
  publicV6: boolean;
  /** The browser shows local addresses as random `.local` names, which only another machine on the same network can look up. */
  localHidden: boolean;
  localShown: number;
  relay: number;
  /**
   * 'same': one public port whichever server was asked (direct connections work); 'differs': a new port per server ("symmetric"
   * NAT, which usually blocks them); 'unknown': found an address but could not compare; 'none': no public IPv4 address at all.
   */
  mapping: 'same' | 'differs' | 'unknown' | 'none';
}

/** What the candidates from one gathering, with all the STUN servers in it, say about this network. */
export function summariseAddresses(candidates: readonly ParsedCandidate[], serversAnswering: number): Addresses {
  const udp = candidates.filter(candidate => candidate.protocol === 'udp');
  const publicV4 = new Set(udp.filter(c => c.type === 'srflx' && !c.address.includes(':')).map(c => `${c.address}:${c.port}`)).size;
  const hosts = udp.filter(c => c.type === 'host');
  const mapping: Addresses['mapping'] = publicV4 === 0 ? 'none' : publicV4 > 1 ? 'differs' : serversAnswering >= 2 ? 'same' : 'unknown';
  return {
    publicV4,
    publicV6: udp.some(c => c.type === 'srflx' && c.address.includes(':')),
    localHidden: hosts.some(c => c.address.endsWith('.local')),
    localShown: hosts.filter(c => !c.address.endsWith('.local')).length,
    relay: udp.filter(c => c.type === 'relay').length,
    mapping,
  };
}

export interface SelfTest {
  ok: boolean;
  ms: number;
  /** How long the game's own invite code took to make (it waits for the addresses to be found), and to connect after that. */
  inviteMs?: number;
  connectMs?: number;
  /** Which data channels carried a message across. */
  reliable?: boolean;
  fast?: boolean;
  codeLength?: number;
  /** The invite code's addresses by kind. */
  codeAddresses?: { host: number; public: number; relay: number };
  problem?: string;
}

export interface ConnectionReport {
  build: string;
  protocol: number;
  browser: string;
  /** ISO time. */
  at: string;
  online: boolean;
  /** The kind of connection ("wifi", "cellular") where the browser says; only some Android browsers do. */
  connection?: string;
  stun: StunAnswer[];
  addresses: Addresses;
  self: SelfTest;
  durationMs: number;
}

export type Level = 'good' | 'warn' | 'bad';
export interface Verdict { level: Level; headline: string; detail: string }

/** What to tell the player: one line, and a sentence or two on why. */
export function judge(report: Pick<ConnectionReport, 'online' | 'stun' | 'addresses' | 'self'>): Verdict {
  const { addresses, self } = report;
  if (!report.online) return { level: 'bad', headline: 'You look to be offline.',
    detail: 'The browser says there is no network connection. Check the connection and run the test again.' };
  if (!self.ok) return { level: 'bad', headline: 'This browser could not make a test connection to itself.',
    detail: `Something is blocking WebRTC, the browser feature games use to connect (a browser setting, a privacy extension or a firewall). ${self.problem ?? ''}`.trim() };
  if (addresses.mapping === 'none' && !addresses.publicV6) return { level: 'bad',
    headline: 'Could not find a public address: the address lookup is being blocked.',
    detail: 'This network or a firewall seems to block the UDP traffic that games use, which is common at work, at school and on some VPNs. Direct connections to other networks will almost certainly fail. Try another network or turn a VPN off.' };
  if (addresses.mapping === 'differs') return addresses.publicV6
    ? { level: 'warn', headline: 'Direct connections will probably fail, except with someone who also has IPv6.',
      detail: 'Your router gives a different public port to every destination (a "symmetric NAT", common on mobile data, hotspots and some broadband). That usually blocks direct connections to players on other networks. IPv6 was found, so it can work with a player who has IPv6 too. The game has no relay server yet, which is the fix.' }
    : { level: 'bad', headline: 'Direct connections to other networks will probably fail.',
      detail: 'Your router gives a different public port to every destination (a "symmetric NAT", common on mobile data, hotspots and some broadband). That usually blocks direct connections to players on other networks. The game has no relay server yet, which is the fix.' };
  if (addresses.mapping === 'none') return { level: 'warn', headline: 'Only IPv6 was found: it works only with someone who also has IPv6.',
    detail: 'No public IPv4 address came back. If the other player has no IPv6, you will not be able to connect.' };
  if (addresses.mapping === 'unknown') return { level: 'warn', headline: 'Found your address, but could not tell how your router handles it.',
    detail: 'Fewer than two of the address servers answered, so the ports could not be compared. It may well work; see which servers did not answer below.' };
  return { level: 'good', headline: 'This network looks fine for direct connections.',
    detail: 'If a connection still fails, the other player’s network is the likely cause: ask them to run this test too and send you the result.' };
}

/** A short "Chrome 141 on Windows" from a user-agent string. */
export function describeBrowser(userAgent: string): string {
  const browsers: Array<[string, RegExp]> = [['Edge', /Edg(?:A|iOS)?\/(\d+)/], ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Opera', /OPR\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
  const found = browsers.map(([name, pattern]) => [name, pattern.exec(userAgent)?.[1]] as const).find(([, version]) => version);
  const browser = found ? `${found[0]} ${found[1]}` : 'Unknown browser';
  const system = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
    : /Mac OS X/.test(userAgent) ? 'macOS' : /CrOS/.test(userAgent) ? 'ChromeOS' : /Linux/.test(userAgent) ? 'Linux' : 'unknown system';
  return `${browser} on ${system}`;
}

const SECONDS = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The whole report as plain text to paste into a message. No IP addresses. */
export function formatReport(report: ConnectionReport): string {
  const verdict = judge(report);
  const { addresses, self } = report;
  const tag = { good: 'GOOD', warn: 'MAYBE', bad: 'PROBLEM' }[verdict.level];
  const mapping = {
    same: 'same public port for every server, so the router keeps your port (good)',
    differs: `${addresses.publicV4} different public ports for the same socket, so the router changes port per destination (bad: "symmetric NAT")`,
    unknown: 'could not compare ports (fewer than two servers answered)',
    none: 'not found',
  }[addresses.mapping];
  const lines = [
    'ZOMBONZ CONNECTION TEST',
    `Result: ${tag} - ${verdict.headline}`,
    verdict.detail,
    '',
    `Build ${report.build} (protocol ${report.protocol}) - ${report.browser} - ${report.at.slice(0, 16).replace('T', ' ')} UTC`,
    `Network: ${report.online ? 'online' : 'OFFLINE'}${report.connection ? `, browser says "${report.connection}"` : ''}`,
    '',
    'Public address lookup (STUN)',
    ...report.stun.map(answer => {
      const families = [answer.families.v4 && 'IPv4', answer.families.v6 && 'IPv6'].filter(Boolean).join(' and ');
      return `  ${answer.url.replace(/^stun:/, '')} - ${answer.ok ? `answered in ${answer.ms} ms (${families || 'no address'})` : `NO ANSWER (${answer.problem ?? 'unknown'})`}`;
    }),
    `Public IPv4: ${mapping}`,
    `Public IPv6: ${addresses.publicV6 ? 'found' : 'not found'}`,
    `Local addresses: ${addresses.localHidden ? 'hidden by the browser (.local names)' : addresses.localShown ? `${addresses.localShown} shown` : 'none found'}`,
    `Relay (TURN): ${addresses.relay ? `${addresses.relay} found` : 'none (this version has no relay server)'}`,
    '',
    'Connection to itself, with the game\'s own codes',
    self.ok
      ? `  ok in ${SECONDS(self.ms)}: reliable channel ${self.reliable ? 'ok' : 'FAILED'}, fast channel ${self.fast ? 'ok' : 'FAILED'}`
      + (self.inviteMs !== undefined ? ` (invite made in ${SECONDS(self.inviteMs)}, connected in ${SECONDS(self.connectMs ?? 0)})` : '')
      : `  FAILED after ${SECONDS(self.ms)}: ${self.problem ?? 'unknown'}`,
    ...(self.codeLength ? [`  invite code ${self.codeLength} characters, addresses: ${self.codeAddresses!.host} local, ${self.codeAddresses!.public} public, ${self.codeAddresses!.relay} relay`] : []),
    '',
    `Test took ${SECONDS(report.durationMs)}. IP addresses are left out on purpose.`,
  ];
  return lines.join('\n');
}

/** The browser pieces the test uses, so tests can stand in for them. */
export interface TestEnvironment {
  createConnection(configuration: RTCConfiguration): RTCPeerConnection;
  createInvite: typeof createInvite;
  answerInvite: typeof answerInvite;
  now(): number;
  userAgent: string;
  online: boolean;
  connection?: string;
  build: string;
  protocol: number;
}

/** Asks one STUN server for this browser's public address, and how long it took. */
async function probeStun(env: TestEnvironment, url: string): Promise<StunAnswer> {
  const start = env.now();
  const families = { v4: false, v6: false };
  let pc: RTCPeerConnection;
  try { pc = env.createConnection({ iceServers: [{ urls: url }] }); pc.createDataChannel('probe'); } catch (error) {
    return { url, ok: false, ms: 0, families, problem: error instanceof Error ? error.message : 'the browser refused' };
  }
  let errorCode = 0;
  const outcome = new Promise<void>(resolve => {
    const timer = setTimeout(resolve, PROBE_LIMIT_MS);
    const finish = () => { clearTimeout(timer); resolve(); };
    pc.addEventListener('icecandidate', event => {
      const candidate = parseCandidate(event.candidate?.candidate);
      if (candidate?.type === 'srflx') { if (candidate.address.includes(':')) families.v6 = true; else families.v4 = true; }
    });
    pc.addEventListener('icecandidateerror', event => { errorCode = (event as RTCPeerConnectionIceErrorEvent).errorCode || errorCode; });
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') finish(); });
  });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await outcome;
  } catch (error) {
    pc.close();
    return { url, ok: false, ms: env.now() - start, families, problem: error instanceof Error ? error.message : 'the browser refused' };
  }
  pc.close();
  const ms = Math.round(env.now() - start);
  const ok = families.v4 || families.v6;
  return { url, ok, ms, families, problem: ok ? undefined : errorCode ? `error ${errorCode}, the server could not be reached` : `no reply in ${Math.round(PROBE_LIMIT_MS / 1000)} s` };
}

/** All the STUN servers at once from one socket: a router that changes port by destination shows as several public ports. */
async function gatherAll(env: TestEnvironment): Promise<ParsedCandidate[]> {
  const found: ParsedCandidate[] = [];
  let pc: RTCPeerConnection;
  try { pc = env.createConnection({ iceServers: [{ urls: [...TEST_STUN_URLS] }] }); pc.createDataChannel('gather'); } catch { return found; }
  const done = new Promise<void>(resolve => {
    const timer = setTimeout(resolve, PROBE_LIMIT_MS);
    pc.addEventListener('icecandidate', event => { const candidate = parseCandidate(event.candidate?.candidate); if (candidate) found.push(candidate); });
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } });
  });
  try { await pc.setLocalDescription(await pc.createOffer()); await done; } catch { /* reported by having no addresses */ }
  pc.close();
  return found;
}

/** Makes an invite, answers it, connects the two, and sends a message each way on both channels. */
async function selfTest(env: TestEnvironment): Promise<SelfTest> {
  const start = env.now();
  const links: PeerLink[] = [];
  const pending: Array<{ cancel(): void }> = [];
  const result: SelfTest = { ok: false, ms: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`did not connect within ${SECONDS(SELF_TEST_LIMIT_MS)}`)), SELF_TEST_LIMIT_MS); });
    const run = async () => {
      const invite = await env.createInvite();
      result.inviteMs = Math.round(env.now() - start);
      pending.push(invite);
      result.codeLength = invite.code.length;
      const kinds = decodeSession('invite', invite.code).candidates;
      result.codeAddresses = {
        host: kinds.filter(c => c.type === 'host').length, relay: kinds.filter(c => c.type === 'relay').length,
        public: kinds.filter(c => c.type === 'srflx' || c.type === 'prflx').length,
      };
      const join = await env.answerInvite(invite.code, SELF_TEST_LIMIT_MS);
      pending.push(join);
      const [hostLink, joinLink] = await Promise.all([invite.accept(join.reply, SELF_TEST_LIMIT_MS), join.connected]);
      links.push(hostLink, joinLink);
      result.connectMs = Math.round(env.now() - start) - result.inviteMs;
      const received = { reliable: false, fast: false };
      joinLink.onMessage(delivery => { if (delivery === 'reliable') received.reliable = true; else received.fast = true; });
      hostLink.sendReliable(new Uint8Array([1, 2, 3]));
      // The fast channel drops packets by design, so it gets a few tries.
      for (let attempt = 0; attempt < 8 && !(received.reliable && received.fast); attempt++) {
        hostLink.sendUnreliable(new Uint8Array([attempt]));
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      result.reliable = received.reliable; result.fast = received.fast;
      if (!received.reliable || !received.fast) throw new Error(`connected, but ${!received.reliable ? 'the reliable' : 'the fast'} channel carried nothing`);
      result.ok = true;
    };
    await Promise.race([run(), limit]);
  } catch (error) {
    result.problem = error instanceof Error ? error.message : 'unknown error';
  }
  clearTimeout(timer);
  for (const link of links) link.close();
  for (const one of pending) one.cancel();
  result.ms = Math.round(env.now() - start);
  return result;
}

/** The environment of the running page. */
export function browserEnvironment(build: string, protocol: number): TestEnvironment {
  const connection = (navigator as unknown as { connection?: { type?: string } }).connection;
  return {
    createConnection: configuration => {
      if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser has no WebRTC.');
      return new RTCPeerConnection(configuration);
    },
    createInvite, answerInvite,
    now: () => performance.now(),
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    connection: connection?.type,
    build, protocol,
  };
}

/** Runs every check. The address lookups run together; `progress` is told what is happening. */
export async function runConnectionTest(env: TestEnvironment, progress: (step: string) => void = () => {}): Promise<ConnectionReport> {
  const start = env.now();
  progress('Looking up your public address…');
  const [stun, candidates] = await Promise.all([
    Promise.all(TEST_STUN_URLS.map(url => probeStun(env, url))),
    gatherAll(env),
  ]);
  // After those, not alongside: the invite waits for its own addresses, and would be timing everyone else's traffic too.
  progress('Connecting to yourself with the game’s own codes…');
  const self = await selfTest(env);
  return {
    build: env.build, protocol: env.protocol, browser: describeBrowser(env.userAgent), at: new Date().toISOString(),
    online: env.online, connection: env.connection, stun,
    addresses: summariseAddresses(candidates, stun.filter(answer => answer.ok).length),
    self, durationMs: Math.round(env.now() - start),
  };
}
