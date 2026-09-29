/**
 * Short copy-paste codes for WebRTC's connection setup. An offer or answer (SDP) runs to hundreds of
 * characters, but a data-channel-only connection needs just the ICE credentials, the DTLS certificate
 * fingerprint, the media id, the setup role and the candidate addresses. Those pack into about 90
 * bytes, and the far side rebuilds a minimal SDP from them.
 *
 * A reply code also carries the moment both sides start connecting (`start`): the joiner picks it, and the host waits for it
 * before it begins. Connecting has to begin at both ends at about the same time, because each end's router drops what the
 * other sends until it has sent something of its own, and a browser gives up after roughly ten seconds. Pasting a code takes
 * a human much longer than that.
 */
export type CodeKind = 'invite' | 'reply';
export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';
export interface SessionCandidate { type: CandidateType; address: string; port: number }
export interface CompactSession {
  ufrag: string;
  pwd: string;
  /** The SHA-256 certificate fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  mid: string;
  candidates: SessionCandidate[];
  /** Reply codes only: when both sides start connecting, in milliseconds since 1970 by the game server's clock. */
  start?: number;
}

const PREFIX: Record<CodeKind, string> = { invite: 'ZBI1-', reply: 'ZBR2-' };
const CANDIDATE_TYPES: CandidateType[] = ['host', 'srflx', 'prflx', 'relay'];
const SETUPS: CompactSession['setup'][] = ['actpass', 'active', 'passive'];
const TYPE_PREFERENCE: Record<CandidateType, number> = { host: 126, prflx: 110, srflx: 100, relay: 0 };
const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export class CodeError extends Error {}

/** Reads what a code needs out of a browser's SDP. UDP candidates only: TCP ones rarely help here. */
export function parseSdp(sdp: string): CompactSession {
  const lines = sdp.split(/\r?\n/);
  const value = (prefix: string) => lines.find(line => line.startsWith(prefix))?.slice(prefix.length).trim();
  const ufrag = value('a=ice-ufrag:'), pwd = value('a=ice-pwd:'), fingerprint = value('a=fingerprint:');
  const setup = value('a=setup:') as CompactSession['setup'] | undefined, mid = value('a=mid:') ?? '0';
  if (!ufrag || !pwd || !fingerprint || !setup || !SETUPS.includes(setup)) throw new CodeError('Incomplete connection details.');
  const [algorithm, hex] = fingerprint.split(/\s+/);
  if (algorithm.toLowerCase() !== 'sha-256' || !hex) throw new CodeError('Unsupported certificate fingerprint.');
  const bytes = hex.split(':').map(part => parseInt(part, 16));
  if (bytes.length !== 32 || bytes.some(byte => !(byte >= 0 && byte <= 255))) throw new CodeError('Malformed fingerprint.');
  const candidates: SessionCandidate[] = [];
  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) continue;
    const parts = line.slice('a=candidate:'.length).trim().split(/\s+/);
    const [, component, transport, , address, port, typ, type] = parts;
    if (component !== '1' || transport.toLowerCase() !== 'udp' || typ !== 'typ') continue;
    if (!CANDIDATE_TYPES.includes(type as CandidateType)) continue;
    const key = `${address} ${port}`;
    if (candidates.some(candidate => `${candidate.address} ${candidate.port}` === key)) continue;
    candidates.push({ type: type as CandidateType, address, port: Number(port) });
  }
  if (!candidates.length) throw new CodeError('No network addresses were found for this connection.');
  return { ufrag, pwd, fingerprint: new Uint8Array(bytes), setup, mid, candidates };
}

/** The session's candidates as the lines a browser's `addIceCandidate` takes (no `a=`). */
export function candidateLines(session: CompactSession): string[] {
  return session.candidates.map((candidate, index) => {
    const priority = TYPE_PREFERENCE[candidate.type] * 2 ** 24 + (65535 - index) * 2 ** 8 + 255;
    return `candidate:${index + 1} 1 udp ${priority} ${candidate.address} ${candidate.port} typ ${candidate.type}`;
  });
}

/**
 * The minimal SDP a browser accepts for one data-channel section. With `candidates: false` it names no addresses and does not say
 * the list is complete, so the browser has nothing to try and waits (it is not failing) until `addIceCandidate` supplies them.
 */
export function buildSdp(session: CompactSession, options: { candidates?: boolean } = {}): string {
  const withCandidates = options.candidates !== false;
  const hex = [...session.fingerprint].map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const lines = [
    'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
    `a=group:BUNDLE ${session.mid}`, 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${session.ufrag}`, `a=ice-pwd:${session.pwd}`, 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${hex}`, `a=setup:${session.setup}`, `a=mid:${session.mid}`,
    'a=sctp-port:5000', 'a=max-message-size:262144',
    ...(withCandidates ? [...candidateLines(session).map(line => `a=${line}`), 'a=end-of-candidates'] : []),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

class Writer {
  private readonly bytes: number[] = [];
  byte(value: number): void { this.bytes.push(value & 255); }
  short(value: number): void { this.byte(value >> 8); this.byte(value); }
  raw(values: ArrayLike<number>): void { for (let i = 0; i < values.length; i++) this.byte(values[i]); }
  text(value: string): void {
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > 255) throw new CodeError('A connection detail is too long for a code.');
    this.byte(encoded.length); this.raw(encoded);
  }
  done(): Uint8Array { return new Uint8Array(this.bytes); }
}
class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  byte(): number {
    if (this.offset >= this.bytes.length) throw new CodeError('This code is incomplete. Copy the whole code and try again.');
    return this.bytes[this.offset++];
  }
  short(): number { return (this.byte() << 8) | this.byte(); }
  raw(length: number): Uint8Array { return Uint8Array.from({ length }, () => this.byte()); }
  text(): string { return new TextDecoder().decode(this.raw(this.byte())); }
  finished(): boolean { return this.offset === this.bytes.length; }
}

function writeAddress(writer: Writer, address: string): number {
  const v4 = IPV4.exec(address);
  if (v4) { writer.raw(v4.slice(1).map(Number)); return 0; }
  const mdns = MDNS.exec(address);
  if (mdns) { const hex = mdns.slice(1).join(''); writer.raw(Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))); return 2; }
  const v6 = parseIpv6(address);
  if (v6) { writer.raw(v6); return 1; }
  writer.text(address); return 3;
}
function readAddress(reader: Reader, kind: number): string {
  if (kind === 0) return [...reader.raw(4)].join('.');
  if (kind === 1) {
    const bytes = reader.raw(16);
    return Array.from({ length: 8 }, (_, i) => ((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16)).join(':');
  }
  if (kind === 2) {
    const hex = [...reader.raw(16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  }
  return reader.text();
}
function parseIpv6(address: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(address) || !address.includes(':')) return null;
  const [head, tail = ''] = address.split('::');
  if (address.split('::').length > 2) return null;
  const headParts = head ? head.split(':') : [], tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0 || (!address.includes('::') && missing !== 0)) return null;
  const groups = [...headParts, ...Array(missing).fill('0'), ...tailParts].map(part => parseInt(part, 16));
  if (groups.some(group => !(group >= 0 && group <= 0xffff))) return null;
  return groups.flatMap(group => [group >> 8, group & 255]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try { binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4)); } catch { throw new CodeError('That is not a Zombonz code.'); }
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function encodeSession(kind: CodeKind, session: CompactSession): string {
  const writer = new Writer();
  writer.byte(SETUPS.indexOf(session.setup));
  writer.text(session.mid); writer.text(session.ufrag); writer.text(session.pwd);
  writer.raw(session.fingerprint);
  writer.byte(session.candidates.length);
  for (const candidate of session.candidates) {
    // Type in the low two bits and address kind in the next two, ahead of the address itself.
    const address = new Writer();
    const addressKind = writeAddress(address, candidate.address);
    writer.byte(CANDIDATE_TYPES.indexOf(candidate.type) | (addressKind << 2));
    writer.raw(address.done()); writer.short(candidate.port);
  }
  if (kind === 'reply') {
    if (session.start === undefined || !Number.isSafeInteger(session.start) || session.start < 0) throw new CodeError('A reply code needs a start time.');
    // Six bytes hold a time in milliseconds for thousands of years.
    writer.short(Math.floor(session.start / 2 ** 32)); writer.short(Math.floor(session.start / 2 ** 16) & 0xffff); writer.short(session.start & 0xffff);
  }
  const bytes = writer.done();
  // A one-byte checksum catches a code that lost or changed characters in copying.
  let sum = 0;
  for (const byte of bytes) sum = (sum * 31 + byte) & 255;
  return PREFIX[kind] + toBase64Url(Uint8Array.from([...bytes, sum]));
}

export function decodeSession(expected: CodeKind, code: string): CompactSession {
  const text = code.replace(/\s+/g, '');
  const kind = (Object.keys(PREFIX) as CodeKind[]).find(key => text.startsWith(PREFIX[key]));
  if (!kind) throw new CodeError('That is not a Zombonz code.');
  if (kind !== expected) {
    throw new CodeError(expected === 'invite' ? 'That is a reply code. Paste the invite code from the host.'
      : 'That is an invite code. Paste the reply code your friend sent back.');
  }
  const all = fromBase64Url(text.slice(PREFIX[kind].length));
  if (all.length < 2) throw new CodeError('This code is incomplete. Copy the whole code and try again.');
  const bytes = all.slice(0, -1);
  let sum = 0;
  for (const byte of bytes) sum = (sum * 31 + byte) & 255;
  if (sum !== all[all.length - 1]) throw new CodeError('This code was changed or cut short. Copy the whole code and try again.');
  const reader = new Reader(bytes);
  const setup = SETUPS[reader.byte()];
  if (!setup) throw new CodeError('That is not a Zombonz code.');
  const mid = reader.text(), ufrag = reader.text(), pwd = reader.text();
  const fingerprint = reader.raw(32);
  const candidates: SessionCandidate[] = [];
  for (let count = reader.byte(); count > 0; count--) {
    const flags = reader.byte();
    const address = readAddress(reader, flags >> 2 & 3);
    candidates.push({ type: CANDIDATE_TYPES[flags & 3], address, port: reader.short() });
  }
  let start: number | undefined;
  if (kind === 'reply') start = reader.short() * 2 ** 32 + reader.short() * 2 ** 16 + reader.short();
  if (!reader.finished()) throw new CodeError('That is not a Zombonz code.');
  return { ufrag, pwd, fingerprint, setup, mid, candidates, ...(start === undefined ? {} : { start }) };
}
