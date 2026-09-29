import type { GameAction } from '../core/input.ts';
import { BINDABLE_ACTIONS, DEFAULT_KEY_BINDINGS, keyLabel, loadBindings, normalizeBindings, rebindKey,
  saveBindings, type KeyBindings } from './bindings.ts';

/** Shared keyboard editor used by the main menu and pause menu. */
export class BindingEditor {
  readonly element = document.createElement('div');
  private bindings: KeyBindings = loadBindings();
  private capturing: GameAction | null = null;

  constructor(private readonly onChange: (bindings: KeyBindings) => void,
    private readonly onClose: () => void, host: HTMLElement = document.body) {
    this.element.className = 'binding-editor';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Controls');
    this.element.innerHTML = '<div class="binding-panel"><h1>CONTROLS</h1>'
      + '<p>Choose an action, then press a key. Mouse buttons and wheel remain available.</p>'
      + '<div class="binding-rows"></div><div class="binding-footer">'
      + '<button type="button" data-command="reset">Reset defaults</button>'
      + '<button type="button" data-command="close">Back</button></div></div>';
    host.append(this.element);
    this.element.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.render();
    this.element.querySelector<HTMLButtonElement>('[data-action]')?.focus();
  }

  private render(): void {
    const rows = this.element.querySelector<HTMLElement>('.binding-rows')!;
    rows.replaceChildren();
    for (const { action, label } of BINDABLE_ACTIONS) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const name = document.createElement('span'); name.textContent = label;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action;
      button.textContent = this.capturing === action ? 'PRESS A KEY…'
        : (this.bindings[action]?.map(keyLabel).join(' / ') || 'UNBOUND');
      row.append(name, button); rows.append(row);
    }
  }

  private readonly onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.element.contains(button)) return;
    if (button.dataset.command === 'close') { this.close(); return; }
    if (button.dataset.command === 'reset') {
      this.bindings = normalizeBindings(DEFAULT_KEY_BINDINGS);
      saveBindings(this.bindings); this.onChange(this.bindings); this.capturing = null; this.render(); return;
    }
    if (button.dataset.action) {
      this.capturing = button.dataset.action as GameAction; this.render();
      this.element.querySelector<HTMLButtonElement>(`[data-action="${this.capturing}"]`)?.focus();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    event.stopImmediatePropagation();
    if (!this.capturing && (event.code === 'Tab' || event.code === 'Enter' || event.code === 'Space')) return;
    event.preventDefault();
    if (event.code === 'Escape') {
      if (this.capturing) { this.capturing = null; this.render(); } else this.close();
      return;
    }
    if (!this.capturing) return;
    this.bindings = rebindKey(this.bindings, this.capturing, event.code);
    saveBindings(this.bindings); this.onChange(this.bindings);
    this.capturing = null; this.render();
  };

  close(): void { this.dispose(); this.onClose(); }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.element.removeEventListener('click', this.onClick);
    this.element.remove();
  }
}
