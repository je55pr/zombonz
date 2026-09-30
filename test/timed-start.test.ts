import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeError, buildSdp, decodeSession, encodeSession, type CompactSession } from '../src/network/codes.ts';
import { START_DELAY_MS, answerInvite, createInvite, estimateClock, timeUntilStart } from '../src/network/webrtc.ts';

const MDNS = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8.local';
/** The host's session, as its browser would offer it. */
const hostOffer: CompactSession = {
  ufrag: 'hostU', pwd: 'h'.repeat(22), fingerprint: new Uint8Array(32).fill(3), setup: 'actpass', mid: '0',
  candidates: [{ type: 'host', address: MDNS, port: 51000 }, { type: 'srflx', address: '203.0.113.9', port: 51000 }],
};
/** The joiner's own session: an offer too, since neither side has a remote end until the start time. */
const joinerOffer: CompactSession = {
  ufrag: 'joinU', pwd: 'j'.repeat(22), fingerprint: new Uint8Array(32).fill(9), setup: 'actpass', mid: '0',
  candidates: [{ type: 'host', address: MDNS.replace('0b', '1b'), port: 52000 }, { type: 'srflx', address: '198.51.100.7', port: 52000 }],
};

describe('the start time in a reply code', () => {
  it('goes into a reply code and comes back exactly', () => {
    for (const start of [1_790_000_000_123, 0, 1, 65_535, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 12345]) {
      const back = decodeSession('reply', encodeSession('reply', { ...joinerOffer, start }));
      expect(back.start, String(start)).toBe(start);
      expect(back.candidates).toEqual(joinerOffer.candidates);
    }
  });

  it('is not in an invite, and a reply must have one', () => {
    expect(decodeSession('invite', encodeSession('invite', hostOffer)).start).toBeUndefined();
    expect(() => encodeSession('reply', joinerOffer)).toThrow(/start time/);
    expect(() => encodeSession('reply', { ...joinerOffer, start: -1 })).toThrow(CodeError);
    expect(() => encodeSession('reply', { ...joinerOffer, start: 1.5 })).toThrow(CodeError);
  });

  it('makes replies from the version without one unusable, with a plain message', () => {
    const code = encodeSession('reply', { ...joinerOffer, start: 1_790_000_000_000 });
    expect(code.startsWith('ZBR2-')).toBe(true);
    expect(code.length).toBeLessThan(200);
    expect(() => decodeSession('reply', 'ZBR1-' + code.slice(5))).toThrow(/not a Zombonz code/);
  });
});

describe('when to start', () => {
  const now = 1_790_000_000_000;

  it('waits until the start time, by the server\'s clock rather than this computer\'s', () => {
    expect(timeUntilStart(now + 30_000, 0, now)).toBe(30_000);
    // This computer is 5 s behind the server, so 10 s ahead by the server is 5 s ahead by this clock.
    expect(timeUntilStart(now + 10_000, 5_000, now)).toBe(5_000);
    // And one running 5 s ahead has 15 s to go.
    expect(timeUntilStart(now + 10_000, -5_000, now)).toBe(15_000);
  });

  it('starts at once at the moment itself, or a moment after it', () => {
    expect(timeUntilStart(now, 0, now)).toBe(0);
    expect(timeUntilStart(now - 3_000, 0, now)).toBe(0);
  });

  it('refuses a code that has expired, and says what to do', () => {
    expect(() => timeUntilStart(now - 5_000, 0, now)).toThrow(CodeError);
    expect(() => timeUntilStart(now - 30_000, 0, now)).toThrow(/expired.*new reply code/s);
  });

  it('refuses a start time so far ahead that the clocks must disagree', () => {
    expect(timeUntilStart(now + 100_000, 0, now)).toBe(100_000);
    expect(() => timeUntilStart(now + 10 * 60_000, 0, now)).toThrow(/clocks disagree/);
  });
});

/** Enough of a browser connection to see what is given to it and when. `ownOffer` is what its browser offers. */
class FakeConnection extends EventTarget {
  static all: FakeConnection[] = [];
  iceGatheringState = 'complete'; iceConnectionState = 'new'; connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remote: Array<{ type: string; sdp: string }> = [];
  closed = false;
  static failRemote = false;
  constructor(private readonly ownOffer: CompactSession) { super(); FakeConnection.all.push(this); }
  createDataChannel() { return Object.assign(new EventTarget(), { readyState: 'connecting', binaryType: '' }); }
  async createOffer() { return { type: 'offer', sdp: buildSdp(this.ownOffer) }; }
  async setLocalDescription(description: { type: string; sdp: string }) { this.localDescription = description; }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    if (FakeConnection.failRemote) throw new Error('Failed to parse SessionDescription');
    this.remote.push(description);
  }
  async getStats() { return new Map(); }
  close() { this.closed = true; }
}

function stubBrowser(ownOffer: CompactSession): void {
  FakeConnection.all = []; FakeConnection.failRemote = false;
  vi.useFakeTimers({ now: 1_790_000_000_000 });
  vi.stubGlobal('RTCPeerConnection', class extends FakeConnection { constructor() { super(ownOffer); } });
}
const restore = () => { vi.useRealTimers(); vi.unstubAllGlobals(); };

describe('the joiner', () => {
  beforeEach(() => stubBrowser(joinerOffer));
  afterEach(restore);

  it('makes an offer of its own, and applies the host\'s invite only at the start time, as the answer to it', async () => {
    const join = await answerInvite(encodeSession('invite', hostOffer));
    const [pc] = FakeConnection.all;
    // Its reply describes its own offer and names the start time, which it knows too.
    expect(pc.localDescription?.type).toBe('offer');
    expect(join.startsAt).toBe(Date.now() + START_DELAY_MS);
    const reply = decodeSession('reply', join.reply);
    expect(reply.start).toBe(join.startsAt);
    expect(reply.candidates).toEqual(joinerOffer.candidates);
    expect(reply.ufrag).toBe('joinU');
    // Until then it has no remote end: nothing to try, and so nothing to give up on.
    await vi.advanceTimersByTimeAsync(START_DELAY_MS - 1);
    expect(pc.remote).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(pc.remote).toHaveLength(1);
    const [answer] = pc.remote;
    expect(answer.type).toBe('answer');
    // The host's own details, every address of its, and the joiner as the DTLS client.
    expect(answer.sdp).toContain('a=ice-ufrag:hostU');
    expect(answer.sdp).toContain('a=candidate:1 1 udp');
    expect(answer.sdp).toContain('203.0.113.9 51000 typ srflx');
    expect(answer.sdp).toContain('a=end-of-candidates');
    expect(answer.sdp).toContain('a=setup:passive');
    join.cancel();
  });

  it('can start at once, for the connection test', async () => {
    const join = await answerInvite(encodeSession('invite', hostOffer), { startDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeConnection.all[0].remote).toHaveLength(1);
    join.cancel();
  });

  it('says so straight away if the browser cannot use the host\'s invite', async () => {
    const join = await answerInvite(encodeSession('invite', hostOffer), { startDelayMs: 1000 });
    FakeConnection.failRemote = true;
    const outcome = expect(join.connected).rejects.toThrow(/invite code could not be used/);
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
    expect(FakeConnection.all[0].closed).toBe(true);
  });

  it('gives up with a clear message twenty seconds after the start if the host never came, not five minutes later', async () => {
    const join = await answerInvite(encodeSession('invite', hostOffer));
    const outcome = expect(join.connected).rejects.toThrow(/host has to paste your reply and press Connect before your countdown ends/);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 19_999);
    expect(FakeConnection.all[0].closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(FakeConnection.all[0].closed).toBe(true);
  });

  it('logs what it did, with no addresses in it', async () => {
    const join = await answerInvite(encodeSession('invite', hostOffer));
    await vi.advanceTimersByTimeAsync(START_DELAY_MS);
    const log = join.log();
    // Times are by the server's clock (here the computer's own, as it cannot be checked), so two players' logs can be laid side by side.
    const start = new Date(join.startsAt).toISOString().slice(11, 21);
    expect(log).toContain(`reply made: host, srflx; start set for ${start} server time; clock not checked; starting in 45 s`);
    expect(log).toContain(`+45.0 s  starting at ${start} server time`);
    expect(log).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(log).not.toContain('.local');
    join.cancel();
  });
});

describe('the host', () => {
  beforeEach(() => stubBrowser(hostOffer));
  afterEach(restore);

  const reply = (secondsAhead: number) => encodeSession('reply', { ...joinerOffer, start: Date.now() + secondsAhead * 1000 });

  it('waits for the start time before it tries anything, and says when that is', async () => {
    const invite = await createInvite();
    const pc = FakeConnection.all[0];
    const scheduled = vi.fn();
    const accepted = invite.accept(reply(30), { scheduled });
    accepted.catch(() => {});
    await vi.advanceTimersByTimeAsync(29_999);
    expect(scheduled).toHaveBeenCalledWith(Date.now() - 29_999 + 30_000);
    expect(pc.remote).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(pc.remote).toHaveLength(1);
    // The joiner's own details and addresses go in as the answer, with the host as the DTLS server.
    const [answer] = pc.remote;
    expect(answer.type).toBe('answer');
    expect(answer.sdp).toContain('a=ice-ufrag:joinU');
    expect(answer.sdp).toContain('198.51.100.7 52000 typ srflx');
    expect(answer.sdp).toContain('a=end-of-candidates');
    expect(answer.sdp).toContain('a=setup:active');
    invite.cancel();
  });

  it('starts at once for a reply made a moment ago', async () => {
    const invite = await createInvite();
    const accepted = invite.accept(reply(0));
    accepted.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeConnection.all[0].remote).toHaveLength(1);
    invite.cancel();
  });

  it('refuses an expired reply without using up the invite, so a fresh one still works', async () => {
    const invite = await createInvite();
    await expect(invite.accept(reply(-30))).rejects.toThrow(/expired/);
    expect(FakeConnection.all[0].remote).toEqual([]);
    const accepted = invite.accept(reply(1));
    accepted.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeConnection.all[0].remote).toHaveLength(1);
    // Once one has been used, another is refused.
    await expect(invite.accept(reply(1))).rejects.toThrow(/already used/);
    invite.cancel();
  });

  it('stops waiting, and tries nothing, if it is cancelled first', async () => {
    const invite = await createInvite();
    const accepted = invite.accept(reply(30));
    const outcome = expect(accepted).rejects.toThrow(/Cancelled/);
    await vi.advanceTimersByTimeAsync(5000);
    invite.cancel();
    await outcome;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeConnection.all[0].remote).toEqual([]);
  });

  it('logs its clock and how long it waited, with no addresses in it', async () => {
    const invite = await createInvite();
    const accepted = invite.accept(reply(10));
    accepted.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    const log = invite.log();
    expect(log).toMatch(/invite made: host, srflx/);
    const start = new Date(1_790_000_010_000).toISOString().slice(11, 21);
    expect(log).toContain(`reply read: host, srflx; start set for ${start} server time; clock not checked; starting in 10.0 s`);
    expect(log).toContain(`+10.0 s  starting at ${start} server time`);
    expect(log).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    invite.cancel();
  });
});

describe('the clock estimate', () => {
  /** What a server whose clock runs `offset` ms ahead of this computer's would answer to a request sent at `sent`: a date cut to the second. */
  const sample = (offset: number, sent: number, rtt = 100) => ({ date: Math.floor((sent + rtt / 2 + offset) / 1000) * 1000, sent, received: sent + rtt });

  it('has nothing to say without samples', () => {
    expect(estimateClock([])).toBeNull();
  });

  it('knows a second-long range from one sample, and narrows it with more, whatever the phase of the second', () => {
    const one = estimateClock([sample(5300, 10_000)])!;
    expect(one.uncertainty).toBeGreaterThan(400);
    for (const [offset, start] of [[5300, 10_000], [-1200, 10_437], [162_000, 3_951], [0, 999_913], [700, 12_345_678]]) {
      const samples = Array.from({ length: 8 }, (_, i) => sample(offset, start + i * 220));
      const reading = estimateClock(samples)!;
      // The true offset is inside what it claims, and the claim is a few hundred milliseconds wide at most.
      expect(Math.abs(reading.offset - offset), `${offset} from ${start}`).toBeLessThanOrEqual(reading.uncertainty + 1e-6);
      expect(reading.uncertainty).toBeLessThan(400);
      expect(reading.samples).toBe(8);
    }
  });

  it('cannot be misled by a request that stalled for seconds: it only adds a wide range of its own', () => {
    const good = Array.from({ length: 8 }, (_, i) => sample(5300, 20_000 + i * 220));
    const stalled = { date: Math.floor((20_000 + 5000 + 5300) / 1000) * 1000, sent: 20_000, received: 30_165 };
    const withStall = estimateClock([stalled, ...good])!, without = estimateClock(good)!;
    expect(withStall.offset).toBe(without.offset);
    expect(withStall.uncertainty).toBe(without.uncertainty);
  });

  it('falls back to the middle of the middles, and claims no precision, when the ranges cannot all be true', () => {
    const reading = estimateClock([sample(5000, 10_000), sample(5000, 10_200), sample(9000, 10_400)])!;
    expect(reading.uncertainty).toBe(1000);
    expect(Math.abs(reading.offset - 5000)).toBeLessThan(1000);
  });
});

describe('the clock measurement', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  /** Measures a clock that is `offset` ms ahead of this computer's, through a fake `fetch` that answers as a server would, from a page at `localNow`. */
  async function measure(offset: number, localNow: number, extra: Record<string, string> = {}, requests?: string[]): Promise<{ offset: number; uncertainty: number; samples: number } | null> {
    vi.resetModules();
    vi.useFakeTimers({ now: localNow });
    vi.stubGlobal('location', { href: 'https://example.test/zombonz/index.html' });
    vi.stubGlobal('fetch', async (url: URL, init: { method: string }) => {
      requests?.push(`${init.method} ${url.pathname}`);
      await new Promise(resolve => setTimeout(resolve, 50));
      return { headers: new Headers({ date: new Date(Math.floor((Date.now() + offset) / 1000) * 1000).toUTCString(), ...extra }) };
    });
    const module = await import('../src/network/webrtc.ts');
    const reading = module.clockMeasurement();
    await vi.advanceTimersByTimeAsync(5000);
    return reading;
  }

  it('finds how far behind the server this computer is, to within a few hundred milliseconds', async () => {
    for (const [offset, start] of [[5300, 1_790_000_000_000], [-1200, 1_790_000_000_437], [162_000, 1_790_000_000_951], [0, 1_790_000_000_777]]) {
      const reading = (await measure(offset, start))!;
      expect(Math.abs(reading.offset - offset), String(offset)).toBeLessThanOrEqual(reading.uncertainty + 1);
      expect(reading.uncertainty).toBeLessThan(400);
      expect(reading.samples).toBe(8);
    }
  });

  it('asks for pages that do not exist, one after another and never twice for the same one, next to the page itself', async () => {
    const requests: string[] = [];
    await measure(0, 1_790_000_000_000, {}, requests);
    expect(requests).toHaveLength(8);
    expect(new Set(requests).size).toBe(8);
    expect(requests.every(request => /^HEAD \/zombonz\/__clock_\d+_\d$/.test(request))).toBe(true);
  });

  it('does not add the Age header, which put two computers 160 seconds out in a real test', async () => {
    const plain = (await measure(5300, 1_790_000_000_000))!;
    const aged = (await measure(5300, 1_790_000_000_000, { age: '160' }))!;
    expect(aged.offset).toBe(plain.offset);
  });

  it('is measured once', async () => {
    const requests: string[] = [];
    vi.resetModules();
    vi.useFakeTimers({ now: 1_790_000_000_000 });
    vi.stubGlobal('location', { href: 'https://example.test/' });
    vi.stubGlobal('fetch', async (url: URL) => { requests.push(url.pathname); return { headers: new Headers({ date: new Date().toUTCString() }) }; });
    const module = await import('../src/network/webrtc.ts');
    const first = module.clockMeasurement(), second = module.clockMeasurement();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await first).toBe(await second);
    expect(requests).toHaveLength(8);
    expect(await module.clockOffset()).toBe((await first)!.offset);
  });

  it('is null, and offset zero, when the server gives no date or cannot be reached, without waiting around', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { href: 'https://example.test/' });
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const offline = await import('../src/network/webrtc.ts');
    expect(await offline.clockMeasurement()).toBeNull();
    expect(await offline.clockOffset()).toBe(0);
    vi.resetModules();
    vi.stubGlobal('fetch', async () => ({ headers: new Headers({}) }));
    vi.useFakeTimers({ now: 1_790_000_000_000 });
    const silent = await import('../src/network/webrtc.ts');
    const reading = silent.clockMeasurement();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await reading).toBeNull();
  });
});
