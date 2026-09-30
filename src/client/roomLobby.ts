import type { MapId } from '../maps/catalog.ts';
import { MAP_CATALOG } from '../maps/catalog.ts';
import { NetClient } from '../net/client.ts';
import { NetHost } from '../net/host.ts';
import { MAX_PLAYERS, cleanName, type LobbyPlayer } from '../net/protocol.ts';
import { LinkHostTransport, linkClientTransport } from '../network/link.ts';
import { hostRoom, joinRoom, type RoomHost, type RoomJoin } from '../network/roomLink.ts';
import { SignalError, normaliseRoomCode } from '../network/signaling.ts';
import type { LobbyCallbacks } from './lobby.ts';

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
 * The co-op lobby for a copy of the game that has a game server (see server/), over the start menu. Hosting shows a short room code;
 * joining is typing that code in. There are no codes to paste and no countdown: the server introduces the browsers, which connect at once.
 * (Without a game server, lobby.ts does the same job with codes to copy and paste.)
 */
export class RoomLobbyView {
  readonly element = document.createElement('div');
  private host: NetHost | null = null;
  private transport: LinkHostTransport | null = null;
  private client: NetClient | null = null;
  private room: RoomHost | null = null;
  private join: RoomJoin | null = null;
  private done = false;

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
        <h2>Room code</h2>
        <div class="room-code" data-room aria-live="polite">…</div>
        <p class="lobby-step-text">Give your friends this code. They choose Multiplayer, then Join Game, and type it in.</p>
        <button type="button" data-action="copy" disabled>Copy code</button>
        <h2>Players <span data-count></span></h2><ol class="lobby-players" data-players></ol>` : `
        <label class="lobby-name">Room code <input data-code maxlength="12" class="room-code-input" placeholder="K7QX2" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        <button type="button" data-action="join">Join</button>
        <h2 data-players-title hidden>Players</h2><ol class="lobby-players" data-players hidden></ol>`}
      <p class="lobby-status" data-status role="status"></p>
      <div class="lobby-actions">
        ${hosting ? '<button type="button" data-action="start" disabled>Start game</button>' : ''}
        <button type="button" data-action="test">Test connection</button>
        <button type="button" data-action="log" hidden>Copy log</button>
        <button type="button" data-action="back">Back</button>
      </div>
      <textarea data-log-box class="lobby-log" readonly rows="7" spellcheck="false" aria-label="Connection log" hidden></textarea>
      <p class="lobby-hint">Everyone needs this same version of the game. Connections go straight between players' browsers.
        <button type="button" class="lobby-link" data-action="codes">Use connection codes instead</button></p>
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
      if (event.key === 'Enter' && (event.target as HTMLElement).matches('[data-code]')) void this.act('join');
    });
    if (mode.kind === 'host') {
      this.transport = new LinkHostTransport();
      this.host = new NetHost(this.transport, cleanName(name.value, 'Player 1'), mode.map);
      this.host.changed.add(() => this.renderPlayers());
      this.host.notices.add(notice => this.status(`${notice.name} ${notice.kind === 'joined' ? 'joined.' : 'left.'}`));
      this.renderPlayers();
      void this.openRoom();
      name.focus();
    } else this.find<HTMLInputElement>('[data-code]').focus();
  }

  private find<T extends HTMLElement>(selector: string): T { return this.element.querySelector<T>(selector)!; }
  private status(text: string, error = false): void {
    const status = this.find<HTMLElement>('[data-status]');
    status.textContent = text; status.classList.toggle('lobby-error', error);
  }
  private offerLog(): void { this.find<HTMLButtonElement>('[data-action="log"]').hidden = false; }

  private renderPlayers(players: LobbyPlayer[] = this.host?.lobby() ?? this.client?.players ?? []): void {
    const list = this.find<HTMLOListElement>('[data-players]');
    list.innerHTML = players.map(player => `<li>${escape(player.name)}${player.slot === 0 ? ' <span>host</span>' : ''}</li>`).join('');
    const count = this.element.querySelector<HTMLElement>('[data-count]');
    if (count) count.textContent = `${players.length}/${MAX_PLAYERS}`;
    const start = this.element.querySelector<HTMLButtonElement>('[data-action="start"]');
    if (start) start.disabled = players.length < 2;
  }

  /** Hosting: makes the room, shows its code, and adds each player as their connection comes up. */
  private async openRoom(): Promise<void> {
    this.status('Making a room…');
    try {
      const room = await hostRoom({
        // Connections are told apart by `serial`, not by the number the room gave: that is used again once its player has left the room.
        onPeer: (link, _id, serial) => { if (this.done) link.close(); else this.transport?.addPeer(`peer-${serial}`, link); },
        onPeerFailed: (_id, reason) => { if (!this.done) this.status(`A player could not connect. ${reason}`, true); },
        onServerLost: () => { if (!this.done) this.status('Lost the connection to the game server. Players already here can still play, but nobody new can join.', true); },
      });
      if (this.done) { room.close(); return; }
      this.room = room;
      this.offerLog();
      this.find<HTMLElement>('[data-room]').textContent = room.room;
      this.find<HTMLButtonElement>('[data-action="copy"]').disabled = false;
      this.status('Waiting for players to join…');
    } catch (error) {
      if (!this.done) this.status(`${message(error)} You can use connection codes instead.`, true);
    }
  }

  private async act(action: string): Promise<void> {
    switch (action) {
      case 'copy': {
        try { await navigator.clipboard.writeText(this.room?.room ?? ''); this.status('Copied. Send it to your friends.'); } catch {
          const range = document.createRange(); range.selectNodeContents(this.find<HTMLElement>('[data-room]'));
          const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
          this.status('Press Ctrl+C to copy the selected code.');
        }
        break;
      }
      case 'join': {
        const input = this.find<HTMLInputElement>('[data-code]');
        const code = normaliseRoomCode(input.value);
        if (!code) { this.status('That is not a room code. It is 5 letters and numbers, like K7QX2.', true); return; }
        const button = this.find<HTMLButtonElement>('[data-action="join"]');
        button.disabled = true; input.disabled = true;
        this.status('Joining…');
        this.join?.cancel();
        let join: RoomJoin;
        try { join = await joinRoom(code); } catch (error) {
          button.disabled = false; input.disabled = false;
          if (!this.done) this.status(error instanceof SignalError ? error.message : `${message(error)} You can use connection codes instead.`, true);
          return;
        }
        if (this.done) { join.cancel(); return; }
        this.join = join;
        this.offerLog();
        this.status('In the room. Connecting to the host…');
        join.connected.then(link => {
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
        }, error => {
          if (this.done || this.join !== join) return;
          button.disabled = false; input.disabled = false;
          this.status(message(error), true);
        });
        break;
      }
      case 'start': {
        if (!this.host || this.host.lobby().length < 2) return;
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const players = this.host.start(seed);
        const host = this.host;
        this.finish();
        this.callbacks.hostStarted(host, players, seed, (this.mode as { map: MapId }).map);
        break;
      }
      case 'test': this.callbacks.testConnection(); break;
      case 'codes': {
        // Changes over to the copy-and-paste lobby, for a network that will not talk to the game server.
        this.finish();
        this.join?.cancel();
        this.host?.close('The host closed the lobby.');
        this.client?.leave();
        this.callbacks.useCodes?.();
        break;
      }
      case 'log': {
        const build = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';
        const text = `ZOMBONZ CONNECTION LOG
Build ${build} - ${this.mode.kind === 'host' ? 'hosting' : 'joining'} - ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
${(this.room?.log() ?? this.join?.log()) ?? ''}`;
        try { await navigator.clipboard.writeText(text); this.status('Log copied. Paste it into a message.'); } catch {
          const box = this.find<HTMLTextAreaElement>('[data-log-box]');
          box.value = text; box.hidden = false; box.select();
          this.status('Press Ctrl+C to copy the selected log, and paste it into a message.');
        }
        break;
      }
      case 'back': this.back(); break;
    }
  }

  /** Hands the session on to the game, keeping the players' connections open. */
  private finish(): void {
    this.done = true;
    this.room?.close();
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
