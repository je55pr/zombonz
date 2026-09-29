import { CodeError, buildSdp, decodeSession, encodeSession, parseSdp } from './codes.ts';
import { Listeners, type PeerLink } from './link.ts';
import type { DeliveryClass, TransportPayload } from './transport.ts';

/**
 * Browser-to-browser links set up by copy-paste codes, with no server of our own. Public STUN servers
 * tell each browser its internet-facing address; players on one home network don't even need those.
 */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const GATHER_TIMEOUT_MS = 4000;

/**
 * Both sides must start connecting at about the same moment. A browser sends its first probes as soon as it has both halves of
 * the exchange, and its router drops what comes back until the other side has sent something too, so whoever starts first sends
 * into a wall, and gives up after a few seconds (Chrome about ten, Firefox five). Pasting a code into a chat takes a person longer
 * than that. So each side makes an offer of its own and does not apply the other's until a start time, which the joiner names in
 * its reply. Neither has a remote end before then, so neither browser has anything to try, or to give up on.
 * (Giving the joiner the host's offer early but withholding its addresses does not work: Firefox fails after five seconds of that.)
 */
export const START_DELAY_MS = 45000;
/** A host this late still starts at once: the joiner has only been trying for a moment. */
const LATE_GRACE_MS = 4000;
/** More than this ahead means the two clocks disagree, not that anyone is waiting. */
const MAX_WAIT_MS = 2 * 60 * 1000;
/** Once started, how long a connection has to come up. */
const CONNECT_TIMEOUT_MS = 20000;

/**
 * How long to wait, in milliseconds, before a start time given in the game server's clock. Throws when it has gone by.
 * `clockOffset` is how far this computer's clock is behind the server's.
 */
export function timeUntilStart(start: number, clockOffset: number, now: number): number {
  const wait = start - clockOffset - now;
  if (wait < -LATE_GRACE_MS) throw new CodeError('That reply code has expired: the countdown on your friend\'s screen ran out first. Ask them to make a new reply code, and press Connect before their countdown ends.');
  if (wait > MAX_WAIT_MS) throw new CodeError('That reply code starts too far ahead, so the two computers\' clocks disagree by a long way. Set both clocks to the right time automatically and try again.');
  return Math.max(0, wait);
}

let measuredOffset: Promise<number> | null = null;
/**
 * How far this computer's clock is behind the game server's, in milliseconds (negative when it is ahead): from the `Date` header
 * of a request to the page's own server, with the seconds it was cached for added. Good to about a second. Zero if it can't be
 * measured, which is right for most computers.
 */
export function clockOffset(): Promise<number> {
  measuredOffset ??= (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const before = Date.now();
      const response = await fetch(`${location.pathname}?clock=${before}`, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
      const after = Date.now();
      const date = Date.parse(response.headers.get('date') ?? '');
      if (Number.isNaN(date)) return 0;
      const age = Number(response.headers.get('age') ?? 0);
      // A Date header is whole seconds, cut off: the real time is half a second later on average.
      return date + (Number.isFinite(age) ? age * 1000 : 0) + 500 - (before + after) / 2;
    } catch { return 0; } finally { clearTimeout(timer); }
  })();
  return measuredOffset;
}

/** What happened to one connection, in order, to send back when it does not work. No addresses. */
class ConnectionLog {
  private readonly began = Date.now();
  private readonly lines: string[] = [];
  add(text: string): void { this.lines.push(`+${((Date.now() - this.began) / 1000).toFixed(1)} s  ${text}`); }
  text(): string { return this.lines.join('\n'); }
}

/** The host's side of one invitation: a code to send, and the reply code to paste back. */
export interface PendingInvite {
  readonly code: string;
  /**
   * Connects using the friend's reply code, at the start time in it; resolves once the link is open. `scheduled` is told, once the
   * code has been read, when the connection will start (a time by this computer's clock), so the screen can count down to it.
   */
  accept(replyCode: string, options?: { timeoutMs?: number; scheduled?: (startsAt: number) => void }): Promise<PeerLink>;
  /** What happened on this connection so far. */
  log(): string;
  cancel(): void;
}
/** A joiner's side: the reply code to send back, and the link once the host has pasted it. */
export interface PendingJoin {
  readonly reply: string;
  /** When both sides start connecting, by this computer's clock. */
  readonly startsAt: number;
  readonly connected: Promise<PeerLink>;
  log(): string;
  cancel(): void;
}

function openChannels(pc: RTCPeerConnection) {
  // Negotiated channels exist on both sides without a separate announcement.
  const reliable = pc.createDataChannel('reliable', { negotiated: true, id: 0, ordered: true });
  const fast = pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
  reliable.binaryType = 'arraybuffer'; fast.binaryType = 'arraybuffer';
  return { reliable, fast };
}

/** Waits for every address to be found (or a few seconds), so one code carries them all. */
function gatherCandidates(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    function done() { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
    function check() { if (pc.iceGatheringState === 'complete') done(); }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** Writes the connection's state changes to the log, and which kinds of address it ended up using. */
function watch(pc: RTCPeerConnection, log: ConnectionLog): void {
  pc.addEventListener('icegatheringstatechange', () => log.add(`addresses: ${pc.iceGatheringState}`));
  pc.addEventListener('iceconnectionstatechange', () => log.add(`ice: ${pc.iceConnectionState}`));
  pc.addEventListener('connectionstatechange', () => {
    log.add(`connection: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') void pc.getStats().then(stats => {
      const byId = new Map<string, Record<string, unknown>>();
      stats.forEach(report => byId.set(report.id, report as Record<string, unknown>));
      stats.forEach(report => {
        if (report.type !== 'transport' || !report.selectedCandidatePairId) return;
        const pair = byId.get(report.selectedCandidatePairId as string);
        const kind = (id: unknown) => (byId.get(id as string)?.candidateType as string | undefined) ?? '?';
        if (pair) log.add(`using: ${kind(pair.localCandidateId)} to ${kind(pair.remoteCandidateId)}`);
      });
    }).catch(() => {});
  });
  pc.addEventListener('icecandidateerror', event => {
    const error = event as RTCPeerConnectionIceErrorEvent;
    log.add(`address lookup error ${error.errorCode} from ${error.url}`);
  });
}

function linkWhenOpen(pc: RTCPeerConnection, channels: ReturnType<typeof openChannels>, timeoutMs: number, failure: string): Promise<PeerLink> {
  const { reliable, fast } = channels;
  const messages = new Listeners<[DeliveryClass, TransportPayload]>();
  const closes = new Listeners<string | undefined>();
  let closed = false;
  const close = (reason?: string) => {
    if (closed) return;
    closed = true;
    try { pc.close(); } catch { /* already closed */ }
    closes.emit(reason);
  };
  const receive = (delivery: DeliveryClass) => (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) messages.emit([delivery, new Uint8Array(event.data)]);
  };
  reliable.addEventListener('message', receive('reliable'));
  fast.addEventListener('message', receive('unreliable'));
  reliable.addEventListener('close', () => close('The connection closed'));
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') close('The connection was lost');
  });
  const link: PeerLink = {
    sendReliable: payload => { if (!closed && reliable.readyState === 'open') reliable.send(payload as Uint8Array<ArrayBuffer>); },
    sendUnreliable: payload => { if (!closed && fast.readyState === 'open') fast.send(payload as Uint8Array<ArrayBuffer>); },
    onMessage: listener => messages.add(([delivery, payload]) => listener(delivery, payload)),
    onClose: listener => closes.add(listener),
    close,
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { close('Timed out'); reject(new CodeError(failure)); }, timeoutMs);
    const opened = () => {
      if (reliable.readyState !== 'open' || fast.readyState !== 'open') return;
      clearTimeout(timer); resolve(link);
    };
    reliable.addEventListener('open', opened); fast.addEventListener('open', opened);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') { clearTimeout(timer); reject(new CodeError(failure)); }
    });
    opened();
  });
}

const HOST_FAILURE = 'Could not connect. Your friend has to be counting down to the same moment, and one of the networks may be blocking direct connections. Make a new invite and try again.';
const JOIN_FAILURE = 'Could not connect. The host has to paste your reply and press Connect before your countdown ends; if they did, one of the networks may be blocking direct connections. Make a new reply code and try again.';

export async function createInvite(): Promise<PendingInvite> {
  const log = new ConnectionLog();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  watch(pc, log);
  const channels = openChannels(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gatherCandidates(pc);
  const session = parseSdp(pc.localDescription!.sdp);
  const code = encodeSession('invite', session);
  log.add(`invite made: ${session.candidates.map(candidate => candidate.type).join(', ')}`);
  let used = false, cancelled = false, wake: (() => void) | null = null;
  return {
    code,
    async accept(replyCode, { timeoutMs = CONNECT_TIMEOUT_MS, scheduled } = {}) {
      if (used) throw new CodeError('This invite was already used. Make a new invite for each player.');
      const session = decodeSession('reply', replyCode);
      if (session.start === undefined) throw new CodeError('That reply code is from an older version of the game.');
      const offset = await clockOffset();
      const wait = timeUntilStart(session.start, offset, Date.now());
      used = true;
      log.add(`reply read: ${session.candidates.map(candidate => candidate.type).join(', ')}; clock ${offset >= 0 ? 'behind' : 'ahead'} by ${Math.abs(Math.round(offset))} ms; starting in ${(wait / 1000).toFixed(1)} s`);
      scheduled?.(Date.now() + wait);
      // Nothing is tried until the moment both sides named: see START_DELAY_MS.
      if (wait > 0) await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, wait); });
      if (cancelled) throw new CodeError('Cancelled.');
      log.add('starting');
      const opened = linkWhenOpen(pc, channels, timeoutMs, HOST_FAILURE);
      opened.catch(() => {}); // Reported through the returned promise.
      try {
        // The joiner's session is an offer of its own, used here as the answer to ours: the host is the DTLS server, the joiner the client.
        await pc.setRemoteDescription({ type: 'answer', sdp: buildSdp({ ...session, setup: 'active' }) });
      } catch {
        pc.close();
        throw new CodeError('That reply code could not be used. Ask your friend to send it again.');
      }
      return opened;
    },
    log: () => log.text(),
    cancel: () => { cancelled = true; wake?.(); pc.close(); },
  };
}

export async function answerInvite(inviteCode: string, options: { timeoutMs?: number; startDelayMs?: number } = {}): Promise<PendingJoin> {
  const { timeoutMs = CONNECT_TIMEOUT_MS, startDelayMs = START_DELAY_MS } = options;
  const host = decodeSession('invite', inviteCode);
  const log = new ConnectionLog();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  watch(pc, log);
  const channels = openChannels(pc);
  // An offer of its own, like the host's: with no remote end yet the browser has nothing to try, so nothing to give up on.
  await pc.setLocalDescription(await pc.createOffer());
  await gatherCandidates(pc);
  const own = parseSdp(pc.localDescription!.sdp);
  const offset = await clockOffset();
  const startsAt = Date.now() + startDelayMs;
  const reply = encodeSession('reply', { ...own, start: Math.round(startsAt + offset) });
  log.add(`reply made: ${own.candidates.map(candidate => candidate.type).join(', ')}; clock ${offset >= 0 ? 'behind' : 'ahead'} by ${Math.abs(Math.round(offset))} ms; starting in ${(startDelayMs / 1000).toFixed(0)} s`);
  let unusable: (error: Error) => void = () => {};
  const rejected = new Promise<never>((_, reject) => { unusable = reject; });
  const connected = Promise.race([linkWhenOpen(pc, channels, startDelayMs + timeoutMs, JOIN_FAILURE), rejected]);
  connected.catch(() => {}); // Reported through the returned promise.
  const timer = setTimeout(() => {
    log.add('starting');
    // The host's invite is used here as the answer to our offer: the host is the DTLS server, this side the client.
    pc.setRemoteDescription({ type: 'answer', sdp: buildSdp({ ...host, setup: 'passive' }) }).catch(() => {
      log.add('the invite could not be used');
      pc.close();
      unusable(new CodeError('That invite code could not be used. Ask the host for a new one.'));
    });
  }, startDelayMs);
  return { reply, startsAt, connected, log: () => log.text(), cancel: () => { clearTimeout(timer); pc.close(); } };
}
