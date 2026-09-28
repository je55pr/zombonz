import { CodeError, buildSdp, decodeSession, encodeSession, parseSdp } from './codes.ts';
import { Listeners, type PeerLink } from './link.ts';
import type { DeliveryClass, TransportPayload } from './transport.ts';

/**
 * Browser-to-browser links set up by copy-paste codes, with no server of our own. Public STUN servers
 * tell each browser its internet-facing address; players on one home network don't even need those.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const GATHER_TIMEOUT_MS = 4000;

/** The host's side of one invitation: a code to send, and the reply code to paste back. */
export interface PendingInvite {
  readonly code: string;
  /** Connects using the friend's reply code; resolves once the link is open. */
  accept(replyCode: string, timeoutMs?: number): Promise<PeerLink>;
  cancel(): void;
}
/** A joiner's side: the reply code to send back, and the link once the host has pasted it. */
export interface PendingJoin {
  readonly reply: string;
  readonly connected: Promise<PeerLink>;
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

function linkWhenOpen(pc: RTCPeerConnection, channels: ReturnType<typeof openChannels>, timeoutMs: number): Promise<PeerLink> {
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
    const timer = setTimeout(() => { close('Timed out'); reject(new CodeError('Could not connect. Check both codes and try again.')); }, timeoutMs);
    const opened = () => {
      if (reliable.readyState !== 'open' || fast.readyState !== 'open') return;
      clearTimeout(timer); resolve(link);
    };
    reliable.addEventListener('open', opened); fast.addEventListener('open', opened);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new CodeError('Could not connect directly. One of the networks may be blocking it.'));
      }
    });
    opened();
  });
}

export async function createInvite(): Promise<PendingInvite> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channels = openChannels(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gatherCandidates(pc);
  const code = encodeSession('invite', parseSdp(pc.localDescription!.sdp));
  let used = false;
  return {
    code,
    async accept(replyCode, timeoutMs = 20000) {
      if (used) throw new CodeError('This invite was already used. Make a new invite for each player.');
      const session = decodeSession('reply', replyCode);
      used = true;
      const opened = linkWhenOpen(pc, channels, timeoutMs);
      opened.catch(() => {}); // Reported through the returned promise.
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(session) });
      } catch {
        pc.close();
        throw new CodeError('That reply code could not be used. Ask your friend to send it again.');
      }
      return opened;
    },
    cancel: () => pc.close(),
  };
}

export async function answerInvite(inviteCode: string, timeoutMs = 5 * 60 * 1000): Promise<PendingJoin> {
  const session = decodeSession('invite', inviteCode);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channels = openChannels(pc);
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(session) });
  } catch {
    pc.close();
    throw new CodeError('That invite code could not be used. Ask the host for a new one.');
  }
  await pc.setLocalDescription(await pc.createAnswer());
  await gatherCandidates(pc);
  const reply = encodeSession('reply', parseSdp(pc.localDescription!.sdp));
  return { reply, connected: linkWhenOpen(pc, channels, timeoutMs), cancel: () => pc.close() };
}
