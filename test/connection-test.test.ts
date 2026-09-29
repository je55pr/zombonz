import { describe, expect, it } from 'vitest';
import { encodeSession, type CompactSession } from '../src/network/codes.ts';
import {
  TEST_STUN_URLS, describeBrowser, formatReport, judge, parseCandidate, runConnectionTest, summariseAddresses,
  type ConnectionReport, type ParsedCandidate, type TestEnvironment,
} from '../src/network/diagnostics.ts';
import { Listeners, type PeerLink } from '../src/network/link.ts';
import type { DeliveryClass, TransportPayload } from '../src/network/transport.ts';

const candidate = (type: string, address: string, port = 50000, protocol = 'udp'): ParsedCandidate => ({ protocol, address, port, type });
const MDNS = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8.local';

describe('reading candidates', () => {
  it('takes the address, port and kind out of a browser candidate line', () => {
    expect(parseCandidate('candidate:842163049 1 udp 1677729535 203.0.113.9 58937 typ srflx raddr 0.0.0.0 rport 0 generation 0'))
      .toEqual({ protocol: 'udp', address: '203.0.113.9', port: 58937, type: 'srflx' });
    expect(parseCandidate('a=candidate:1 1 UDP 2113937151 ' + MDNS + ' 51000 typ host generation 0'))
      .toEqual({ protocol: 'udp', address: MDNS, port: 51000, type: 'host' });
    expect(parseCandidate('candidate:3 1 udp 1 2001:db8::1 50002 typ srflx')?.address).toBe('2001:db8::1');
    expect(parseCandidate('')).toBeNull();
    expect(parseCandidate(undefined)).toBeNull();
    expect(parseCandidate('candidate: not a candidate')).toBeNull();
  });
});

describe('what the candidates say about a network', () => {
  it('sees one public port for every server as a router that keeps your port', () => {
    const summary = summariseAddresses([candidate('host', MDNS), candidate('srflx', '203.0.113.9', 58937), candidate('srflx', '2001:db8::1', 58938)], 3);
    expect(summary).toMatchObject({ publicV4: 1, publicV6: true, localHidden: true, localShown: 0, relay: 0, mapping: 'same' });
  });

  it('sees a new public port per server as a router that changes port by destination', () => {
    const summary = summariseAddresses([candidate('host', MDNS), candidate('srflx', '203.0.113.9', 41000), candidate('srflx', '203.0.113.9', 41007),
      candidate('srflx', '203.0.113.9', 41013)], 3);
    expect(summary).toMatchObject({ publicV4: 3, mapping: 'differs' });
    // The same address on two ports counts as two, but the same address and port twice is one.
    expect(summariseAddresses([candidate('srflx', '203.0.113.9', 41000), candidate('srflx', '203.0.113.9', 41000)], 3).mapping).toBe('same');
  });

  it('will not call the ports the same when fewer than two servers answered', () => {
    expect(summariseAddresses([candidate('srflx', '203.0.113.9', 41000)], 1).mapping).toBe('unknown');
    expect(summariseAddresses([candidate('srflx', '203.0.113.9', 41000)], 0).mapping).toBe('unknown');
  });

  it('finds no public address when nothing came back from a server, and ignores TCP', () => {
    expect(summariseAddresses([candidate('host', MDNS)], 0)).toMatchObject({ publicV4: 0, publicV6: false, mapping: 'none' });
    expect(summariseAddresses([candidate('srflx', '203.0.113.9', 9, 'tcp')], 3).mapping).toBe('none');
  });

  it('notices local addresses the browser shows, and relay addresses', () => {
    expect(summariseAddresses([candidate('host', '192.168.1.20'), candidate('relay', '198.51.100.4', 3478)], 0))
      .toMatchObject({ localHidden: false, localShown: 1, relay: 1 });
  });
});

const goodSelf = { ok: true, ms: 300, inviteMs: 130, connectMs: 170, reliable: true, fast: true, codeLength: 173, codeAddresses: { host: 2, public: 2, relay: 0 } };
const stun = (ok = true) => TEST_STUN_URLS.map(url => ({ url, ok, ms: 40, families: { v4: ok, v6: ok }, problem: ok ? undefined : 'error 701, the server could not be reached' }));
const network = (overrides: Partial<ReturnType<typeof summariseAddresses>> = {}) => ({
  publicV4: 1, publicV6: true, localHidden: true, localShown: 0, relay: 0, mapping: 'same' as const, ...overrides,
});
const report = (overrides: Partial<ConnectionReport> = {}): ConnectionReport => ({
  build: 'abc1234', protocol: 8, browser: 'Chrome 141 on Windows', at: '2026-09-29T21:30:12.000Z', online: true, stun: stun(),
  addresses: network(), self: goodSelf, durationMs: 4200, ...overrides,
});

describe('the verdict', () => {
  it('is good for a router that keeps your port', () => {
    expect(judge(report())).toMatchObject({ level: 'good' });
    expect(judge(report({ addresses: network({ publicV6: false }) }))).toMatchObject({ level: 'good' });
  });

  it('is a problem for a router that changes port by destination, unless IPv6 is there to fall back on', () => {
    const noV6 = judge(report({ addresses: network({ publicV4: 3, publicV6: false, mapping: 'differs' }) }));
    expect(noV6.level).toBe('bad');
    expect(noV6.detail).toContain('symmetric NAT');
    expect(noV6.detail).toContain('relay');
    expect(judge(report({ addresses: network({ publicV4: 3, mapping: 'differs' }) })).level).toBe('warn');
  });

  it('is a problem when no server could be reached', () => {
    const blocked = judge(report({ stun: stun(false), addresses: network({ publicV4: 0, publicV6: false, mapping: 'none' }) }));
    expect(blocked.level).toBe('bad');
    expect(blocked.detail).toMatch(/work|school|VPN/);
  });

  it('warns when only IPv6 or only one server answered', () => {
    expect(judge(report({ addresses: network({ publicV4: 0, mapping: 'none' }) })).level).toBe('warn');
    expect(judge(report({ addresses: network({ mapping: 'unknown' }) })).level).toBe('warn');
  });

  it('says so when the browser is offline or cannot connect to itself, whatever else it found', () => {
    expect(judge(report({ online: false })).headline).toMatch(/offline/i);
    const stuck = judge(report({ self: { ok: false, ms: 12000, problem: 'did not connect within 12.0 s' } }));
    expect(stuck.level).toBe('bad');
    expect(stuck.detail).toContain('did not connect within 12.0 s');
  });
});

describe('the text a friend sends back', () => {
  it('states the result first, then the details, and never an IP address', () => {
    const text = formatReport(report());
    expect(text.split('\n')[0]).toBe('ZOMBONZ CONNECTION TEST');
    expect(text.split('\n')[1]).toMatch(/^Result: GOOD - /);
    expect(text).toContain('Build abc1234 (protocol 8) - Chrome 141 on Windows - 2026-09-29 21:30 UTC');
    expect(text).toContain('stun.l.google.com:19302 - answered in 40 ms (IPv4 and IPv6)');
    expect(text).toContain('Public IPv4: same public port for every server');
    expect(text).toContain('Public IPv6: found');
    expect(text).toContain('Relay (TURN): none');
    expect(text).toContain('reliable channel ok, fast channel ok (invite made in 0.1 s, connected in 0.2 s)');
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(text).not.toMatch(/[0-9a-f]{1,4}(:[0-9a-f]{1,4}){3,}/i);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it('marks what failed in capitals, so it stands out in a chat', () => {
    const text = formatReport(report({
      stun: [...stun().slice(0, 2), { url: 'stun:stun.cloudflare.com:3478', ok: false, ms: 5000, families: { v4: false, v6: false }, problem: 'no reply in 5 s' }],
      addresses: network({ publicV4: 3, publicV6: false, mapping: 'differs' }),
      self: { ok: false, ms: 12000, problem: 'did not connect within 12.0 s' },
    }));
    expect(text).toContain('stun.cloudflare.com:3478 - NO ANSWER (no reply in 5 s)');
    expect(text).toContain('3 different public ports');
    expect(text).toContain('FAILED after 12.0 s: did not connect within 12.0 s');
    expect(text.split('\n')[1]).toMatch(/^Result: PROBLEM - /);
  });

  it('names the browser and system briefly', () => {
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'))
      .toBe('Chrome 141 on Windows');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'))
      .toBe('Edge 141 on Windows');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox 130 on Windows');
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'))
      .toBe('Safari 17 on macOS');
    expect(describeBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'))
      .toBe('Chrome 141 on Android');
    expect(describeBrowser('curl/8')).toBe('Unknown browser on unknown system');
  });
});

/** A browser's peer connection, gathering whatever the scenario says each set of servers returns. */
type Gathered = { candidates: string[]; errors?: number[] };
function fakeBrowser(gather: (urls: string[]) => Gathered, options: { invite?: 'ok' | 'fail' | 'unlinked' } = {}): TestEnvironment {
  class FakeConnection extends EventTarget {
    iceGatheringState = 'new';
    constructor(private readonly configuration: RTCConfiguration) { super(); }
    createDataChannel() { return {}; }
    async createOffer() { return { type: 'offer', sdp: '' }; }
    async setLocalDescription() {
      setTimeout(() => {
        const urls = (this.configuration.iceServers ?? []).flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]);
        const { candidates, errors = [] } = gather(urls);
        for (const line of candidates) this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: { candidate: line } }));
        for (const errorCode of errors) this.dispatchEvent(Object.assign(new Event('icecandidateerror'), { errorCode }));
        this.iceGatheringState = 'complete';
        this.dispatchEvent(new Event('icegatheringstatechange'));
      }, 0);
    }
    close() { /* nothing to release */ }
  }
  // Two links that hand each message across on the next turn, as a real connection would.
  const pair = (): [PeerLink, PeerLink] => {
    const sides = [new Listeners<[DeliveryClass, TransportPayload]>(), new Listeners<[DeliveryClass, TransportPayload]>()];
    const end = (me: 0 | 1): PeerLink => ({
      sendReliable: payload => { setTimeout(() => sides[1 - me].emit(['reliable', payload]), 0); },
      sendUnreliable: payload => { setTimeout(() => sides[1 - me].emit(['unreliable', payload]), 0); },
      onMessage: listener => sides[me].add(([delivery, payload]) => listener(delivery, payload)),
      onClose: () => () => {}, close: () => {},
    });
    return [end(0), end(1)];
  };
  const session: CompactSession = { ufrag: 'abcd', pwd: 'p'.repeat(22), fingerprint: new Uint8Array(32).fill(7), setup: 'actpass', mid: '0',
    candidates: [{ type: 'host', address: MDNS, port: 51000 }, { type: 'host', address: MDNS.replace('0b', '1b'), port: 51001 },
      { type: 'srflx', address: '203.0.113.9', port: 51000 }, { type: 'srflx', address: '2001:db8::1', port: 51001 }] };
  // The host's link and the joiner's are the two ends of one pair, unless the scenario says they never join up.
  const [hostLink, joinLink] = options.invite === 'unlinked' ? [pair()[0], pair()[1]] : pair();
  return {
    createConnection: configuration => new FakeConnection(configuration) as unknown as RTCPeerConnection,
    createInvite: async () => {
      if (options.invite === 'fail') throw new Error('This browser has no WebRTC.');
      return { code: encodeSession('invite', session), cancel: () => {}, log: () => '', accept: async () => hostLink };
    },
    answerInvite: async () => ({ reply: 'ZBR2-x', startsAt: Date.now(), cancel: () => {}, log: () => '', connected: Promise.resolve(joinLink) }),
    now: () => performance.now(), userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36',
    online: true, build: 'abc1234', protocol: 8,
  };
}
const line = (type: string, address: string, port: number) => `candidate:1 1 udp 1 ${address} ${port} typ ${type}`;

describe('running the test', () => {
  it('reports a good network, with every server answering and one public port', async () => {
    const env = fakeBrowser(() => ({ candidates: [line('host', MDNS, 51000), line('srflx', '203.0.113.9', 51000), line('srflx', '2001:db8::1', 51001)] }));
    const steps: string[] = [];
    const result = await runConnectionTest(env, step => steps.push(step));
    expect(steps.length).toBeGreaterThan(0);
    expect(result.stun).toHaveLength(TEST_STUN_URLS.length);
    expect(result.stun.every(answer => answer.ok && answer.families.v4 && answer.families.v6)).toBe(true);
    expect(result.addresses).toMatchObject({ publicV4: 1, publicV6: true, mapping: 'same' });
    expect(result.browser).toBe('Chrome 141 on Windows');
    expect(result.self).toMatchObject({ ok: true, reliable: true, fast: true });
    expect(judge(result).level).toBe('good');
    expect(formatReport(result).split('\n')[1]).toMatch(/^Result: GOOD - /);
  });

  it('asks the game\'s own two servers and one more, from one socket for the port comparison', async () => {
    const asked: string[][] = [];
    const env = fakeBrowser(urls => { asked.push(urls); return { candidates: [line('srflx', '203.0.113.9', 50000)] }; });
    await runConnectionTest(env);
    expect(TEST_STUN_URLS).toEqual(expect.arrayContaining(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478']));
    expect(asked.filter(urls => urls.length === 1).map(urls => urls[0]).sort()).toEqual([...TEST_STUN_URLS].sort());
    expect(asked.filter(urls => urls.length > 1)).toEqual([[...TEST_STUN_URLS]]);
  });

  it('connects to itself with the game\'s codes, and says which channel is at fault when a message does not arrive', async () => {
    const env = fakeBrowser(() => ({ candidates: [line('srflx', '203.0.113.9', 50000)] }), { invite: 'unlinked' });
    const result = await runConnectionTest(env);
    expect(result.self.ok).toBe(false);
    expect(result.self.problem).toMatch(/channel carried nothing/);
    expect(result.self.codeLength).toBeGreaterThan(50);
    expect(result.self.codeAddresses).toEqual({ host: 2, public: 2, relay: 0 });
  });

  it('makes the self-connection only after every address lookup has finished, so the two do not slow each other', async () => {
    const order: string[] = [];
    const env = fakeBrowser(() => { order.push('lookup'); return { candidates: [line('srflx', '203.0.113.9', 50000)] }; });
    await runConnectionTest({ ...env, createInvite: async () => { order.push('invite'); return env.createInvite(); } });
    expect(order.filter(step => step === 'lookup')).toHaveLength(TEST_STUN_URLS.length + 1);
    expect(order.indexOf('invite')).toBe(TEST_STUN_URLS.length + 1);
    expect(order.at(-1)).toBe('invite');
  });

  it('reports how long the invite took to make and to connect', async () => {
    const env = fakeBrowser(() => ({ candidates: [line('srflx', '203.0.113.9', 50000)] }));
    const result = await runConnectionTest(env);
    expect(result.self.inviteMs).toBeGreaterThanOrEqual(0);
    expect(result.self.connectMs).toBeGreaterThanOrEqual(0);
    expect(formatReport(result)).toMatch(/\(invite made in \d+\.\d s, connected in \d+\.\d s\)/);
  });

  it('spots a router that changes port by destination', async () => {
    let port = 40000;
    const env = fakeBrowser(urls => urls.length > 1
      ? { candidates: urls.map(() => line('srflx', '203.0.113.9', port += 7)) }
      : { candidates: [line('srflx', '203.0.113.9', port += 7)] });
    const result = await runConnectionTest(env);
    expect(result.addresses.mapping).toBe('differs');
    expect(result.addresses.publicV4).toBe(TEST_STUN_URLS.length);
    expect(judge(result).level).toMatch(/bad|warn/);
  });

  it('spots a network that blocks the address lookup, and says why each server failed', async () => {
    const env = fakeBrowser(() => ({ candidates: [line('host', MDNS, 51000)], errors: [701, 701] }));
    const result = await runConnectionTest(env);
    expect(result.stun.every(answer => !answer.ok && answer.problem === 'error 701, the server could not be reached')).toBe(true);
    expect(result.addresses).toMatchObject({ publicV4: 0, publicV6: false, mapping: 'none' });
    expect(formatReport(result)).toContain('NO ANSWER (error 701, the server could not be reached)');
  });

  it('reports a browser with no WebRTC rather than throwing', async () => {
    const env = fakeBrowser(() => ({ candidates: [] }), { invite: 'fail' });
    const result = await runConnectionTest({ ...env, createConnection: () => { throw new Error('This browser has no WebRTC.'); } });
    expect(result.self).toMatchObject({ ok: false, problem: 'This browser has no WebRTC.' });
    expect(result.stun.every(answer => !answer.ok && answer.problem === 'This browser has no WebRTC.')).toBe(true);
    expect(judge(result).level).toBe('bad');
  });
});
