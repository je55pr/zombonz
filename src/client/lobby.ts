import type { MapId } from '../maps/catalog.ts';
import { MAP_CATALOG } from '../maps/catalog.ts';
import { NetClient, type StartInfo } from '../net/client.ts';
import { NetHost } from '../net/host.ts';
import { MAX_PLAYERS, cleanName, type LobbyPlayer } from '../net/protocol.ts';
import { LinkHostTransport, linkClientTransport } from '../network/link.ts';
import { answerInvite, createInvite, type PendingInvite, type PendingJoin } from '../network/webrtc.ts';

export interface LobbyCallbacks {
  hostStarted(host: NetHost, players: LobbyPlayer[], seed: number, map: MapId): void;
  clientStarted(client: NetClient, start: StartInfo): void;
  back(): void;
  /** Opens "Test my connection" over the lobby. */
  testConnection(): void;
  /** Asks for the copy-and-paste lobby in place of the room lobby (the room lobby's way out when a network will not reach the game server). */
  useCodes?(): void;
}

const NAME_KEY = 'zombonz.playerName';
function savedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
}
const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';

/**
 * The co-op lobby, over the start menu. Hosting: make an invite code per friend, paste back their reply,
 * then start once everyone has joined. Joining: paste the host's invite, send back the reply code, and
 * wait for the host to start.
 */
export class LobbyView {
  readonly element = document.createElement('div');
  private host: NetHost | null = null;
  private transport: LinkHostTransport | null = null;
  private client: NetClient | null = null;
  private invite: PendingInvite | null = null;
  private join: PendingJoin | null = null;
  private peers = 0;
  private done = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** The connection log of the latest invite or reply, for the Copy log button. */
  private logSource: (() => string) | null = null;

  constructor(private readonly mode: { kind: 'host'; map: MapId } | { kind: 'join' }, private readonly callbacks: LobbyCallbacks,
    parent: HTMLElement = document.body) {
    this.element.className = 'lobby';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    const hosting = mode.kind === 'host';
    const mapName = hosting ? MAP_CATALOG.find(entry => entry.id === mode.map)?.name ?? mode.map : '';
    this.element.innerHTML = `<div class="lobby-panel">
      <h1>${hosting ? 'Host Game' : 'Join Game'}</h1><div class="pause-rule"></div>
      ${hosting ? `<p class="lobby-map">${escape(mapName)}</p>` : ''}
      <label class="lobby-name">Your name <input data-name maxlength="16" autocomplete="off" spellcheck="false"></label>
      ${hosting ? `
        <h2>Players <span data-count></span></h2><ol class="lobby-players" data-players></ol>
        <section class="lobby-step">
          <button type="button" data-action="invite">Invite a player</button>
          <div data-invite-steps hidden>
            <p>1. Send this invite code to your friend:</p>
            <div class="lobby-code"><textarea data-invite-code readonly rows="3"></textarea>
              <button type="button" data-action="copy-invite">Copy</button></div>
            <p>2. Paste the reply code they send back, and press Connect before the countdown on their screen ends:</p>
            <textarea data-reply rows="3" placeholder="ZBR2-…" spellcheck="false"></textarea>
            <button type="button" data-action="connect">Connect</button>
          </div>
        </section>` : `
        <section class="lobby-step">
          <p>1. Paste the invite code from the host:</p>
          <textarea data-invite-in rows="3" placeholder="ZBI1-…" spellcheck="false"></textarea>
          <button type="button" data-action="answer">Make my reply code</button>
          <div data-reply-steps hidden>
            <p>2. Send this reply code back to the host. You both start connecting when the countdown ends:</p>
            <div class="lobby-code"><textarea data-reply-code readonly rows="3"></textarea>
              <button type="button" data-action="copy-reply">Copy</button></div>
          </div>
        </section>
        <h2 data-players-title hidden>Players</h2><ol class="lobby-players" data-players hidden></ol>`}
      <p class="lobby-status" data-status role="status"></p>
      <div class="lobby-actions">
        ${hosting ? '<button type="button" data-action="start" disabled>Start game</button>' : ''}
        <button type="button" data-action="test">Test connection</button>
        <button type="button" data-action="log" hidden>Copy log</button>
        <button type="button" data-action="back">Back</button>
      </div>
      <textarea data-log-box class="lobby-log" readonly rows="7" spellcheck="false" aria-label="Connection log" hidden></textarea>
      <p class="lobby-hint">Everyone needs this same version of the game. Connections go straight between players' browsers.</p>
    </div>`;
    parent.append(this.element);
    const name = this.find<HTMLInputElement>('[data-name]');
    name.value = savedName() || (hosting ? 'Player 1' : '');
    name.addEventListener('input', () => {
      saveName(name.value.trim());
      this.host?.setHostName(name.value);
    });
    this.element.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) void this.act(action);
    });
    this.element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') this.back();
    });
    if (hosting) {
      this.transport = new LinkHostTransport();
      this.host = new NetHost(this.transport, cleanName(name.value, 'Player 1'), mode.map);
      this.host.changed.add(() => this.renderPlayers());
      this.host.notices.add(notice => this.status(`${notice.name} ${notice.kind === 'joined' ? 'joined.' : 'left.'}`));
      this.renderPlayers();
    }
    name.focus();
  }

  private find<T extends HTMLElement>(selector: string): T { return this.element.querySelector<T>(selector)!; }
  private status(text: string, error = false): void {
    const status = this.find<HTMLElement>('[data-status]');
    status.textContent = text; status.classList.toggle('lobby-error', error);
  }
  /** Counts down to `at` in the status line, then shows `after`. */
  private countdown(at: number, text: (seconds: number) => string, after: string): void {
    this.stopCountdown();
    const show = () => {
      const left = Math.ceil((at - Date.now()) / 1000);
      if (left <= 0) { this.stopCountdown(); this.status(after); } else this.status(text(left));
    };
    show();
    this.ticker = setInterval(show, 250);
  }
  private stopCountdown(): void { if (this.ticker) clearInterval(this.ticker); this.ticker = null; }
  private offerLog(source: () => string): void {
    this.logSource = source;
    this.find<HTMLButtonElement>('[data-action="log"]').hidden = false;
  }

  private busy<T>(button: string, work: () => Promise<T>): Promise<T | undefined> {
    const element = this.find<HTMLButtonElement>(`[data-action="${button}"]`);
    element.disabled = true;
    return work().catch(error => { this.status(message(error), true); return undefined; })
      .finally(() => { element.disabled = false; });
  }

  private renderPlayers(players: LobbyPlayer[] = this.host?.lobby() ?? this.client?.players ?? []): void {
    const list = this.find<HTMLOListElement>('[data-players]');
    list.innerHTML = players.map(player => `<li>${escape(player.name)}${player.slot === 0 ? ' <span>host</span>' : ''}</li>`).join('');
    const count = this.element.querySelector<HTMLElement>('[data-count]');
    if (count) count.textContent = `${players.length}/${MAX_PLAYERS}`;
    const start = this.element.querySelector<HTMLButtonElement>('[data-action="start"]');
    if (start) start.disabled = players.length < 2;
    const invite = this.element.querySelector<HTMLButtonElement>('[data-action="invite"]');
    if (invite) invite.hidden = players.length >= MAX_PLAYERS;
  }

  private async act(action: string): Promise<void> {
    switch (action) {
      case 'invite': {
        this.invite?.cancel();
        this.status('Making an invite code…');
        const invite = await this.busy('invite', () => createInvite());
        if (!invite || this.done) { invite?.cancel(); return; }
        this.invite = invite;
        this.offerLog(() => invite.log());
        this.find<HTMLElement>('[data-invite-steps]').hidden = false;
        this.find<HTMLTextAreaElement>('[data-invite-code]').value = invite.code;
        this.find<HTMLTextAreaElement>('[data-reply]').value = '';
        this.find<HTMLButtonElement>('[data-action="invite"]').textContent = 'Make a new invite';
        this.status('Send the invite code, then paste their reply code below.');
        break;
      }
      case 'copy-invite': case 'copy-reply': {
        const box = this.find<HTMLTextAreaElement>(action === 'copy-invite' ? '[data-invite-code]' : '[data-reply-code]');
        try { await navigator.clipboard.writeText(box.value); this.status('Copied.'); } catch {
          box.select(); this.status('Press Ctrl+C to copy the selected code.');
        }
        break;
      }
      case 'connect': {
        const invite = this.invite;
        if (!invite || !this.transport) return;
        this.status('Connecting…');
        const link = await this.busy('connect', () => invite.accept(this.find<HTMLTextAreaElement>('[data-reply]').value, {
          scheduled: at => this.countdown(at, seconds => `Connecting in ${seconds} s. Keep this window open.`, 'Connecting…'),
        }));
        this.stopCountdown();
        if (!link || this.done) { link?.close(); return; }
        this.invite = null;
        this.transport.addPeer(`peer-${++this.peers}`, link);
        this.find<HTMLElement>('[data-invite-steps]').hidden = true;
        this.find<HTMLButtonElement>('[data-action="invite"]').textContent = 'Invite another player';
        this.status('Connected. Waiting for them to join…');
        break;
      }
      case 'answer': {
        this.join?.cancel();
        this.status('Making your reply code…');
        const join = await this.busy('answer', () => answerInvite(this.find<HTMLTextAreaElement>('[data-invite-in]').value));
        if (!join || this.done) { join?.cancel(); return; }
        this.join = join;
        this.offerLog(() => join.log());
        this.find<HTMLElement>('[data-reply-steps]').hidden = false;
        this.find<HTMLTextAreaElement>('[data-reply-code]').value = join.reply;
        this.countdown(join.startsAt, seconds => `Send the reply code to the host now. You both start connecting in ${seconds} s: they have to paste it and press Connect before then.`, 'Connecting…');
        join.connected.then(link => {
          this.stopCountdown();
          if (this.done || this.join !== join) { link.close(); return; }
          const name = cleanName(this.find<HTMLInputElement>('[data-name]').value, 'Player');
          const client = new NetClient(linkClientTransport(link), name);
          this.client = client;
          client.changed.add(() => {
            if (client.phase === 'lobby') {
              this.find<HTMLElement>('[data-players-title]').hidden = false;
              this.find<HTMLElement>('[data-players]').hidden = false;
              this.renderPlayers(client.players);
              this.status('Connected. Waiting for the host to start the game…');
            }
          });
          client.closed.add(reason => { if (!this.done) this.status(reason, true); });
          client.started.add(start => { this.finish(); this.callbacks.clientStarted(client, start); });
          this.status('Connected. Joining…');
        }, error => { this.stopCountdown(); if (!this.done && this.join === join) this.status(message(error), true); });
        break;
      }
      case 'start': {
        if (!this.host || (this.host.lobby().length < 2)) return;
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const players = this.host.start(seed);
        const host = this.host;
        this.finish();
        this.callbacks.hostStarted(host, players, seed, (this.mode as { map: MapId }).map);
        break;
      }
      case 'test': this.callbacks.testConnection(); break;
      case 'log': {
        const build = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';
        const text = `ZOMBONZ CONNECTION LOG
Build ${build} - ${this.mode.kind === 'host' ? 'hosting' : 'joining'} - ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
${this.logSource?.() ?? ''}`;
        try { await navigator.clipboard.writeText(text); this.status('Log copied. Paste it into a message.'); } catch {
          // The browser would not copy for us: show the log, selected, to copy by hand.
          const box = this.find<HTMLTextAreaElement>('[data-log-box]');
          box.value = text; box.hidden = false; box.select();
          this.status('Press Ctrl+C to copy the selected log, and paste it into a message.');
        }
        break;
      }
      case 'back': this.back(); break;
    }
  }

  /** Hands the session on to the game, keeping its connections open. */
  private finish(): void {
    this.done = true;
    this.stopCountdown();
    this.invite?.cancel(); this.invite = null;
    this.element.remove();
  }
  private back(): void {
    if (this.done) return;
    this.finish();
    this.join?.cancel();
    this.host?.close('The host closed the lobby.');
    this.client?.leave();
    this.callbacks.back();
  }
  dispose(): void { this.back(); }
}
