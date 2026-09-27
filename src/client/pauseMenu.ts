import {
  SETTING_LIMITS, formatSetting, normalizeSettings, type GameSettings, type SettingKey,
} from './settings.ts';

export interface PauseMenuActions {
  resume(): void;
  restart(): void;
  quit(): void;
  settings(settings: GameSettings): void;
}

/** Focusable DOM pause dialog, separate from the in-world HUD and simulation clock. */
export class PauseMenuView {
  readonly element: HTMLDivElement;
  private settings: GameSettings;
  private screen: 'main' | 'settings' = 'main';

  constructor(settings: GameSettings, private readonly actions: PauseMenuActions, host: HTMLElement = document.body) {
    this.settings = { ...settings };
    this.element = document.createElement('div');
    this.element.className = 'pause-menu';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Paused game');
    const rows = (Object.keys(SETTING_LIMITS) as SettingKey[]).map(key => {
      const limit = SETTING_LIMITS[key];
      const label = key === 'fov' ? 'Field of view' : key === 'volume' ? 'Volume' : 'Mouse sensitivity';
      return `<label class="pause-setting"><span>${label}</span><output data-value="${key}"></output>
        <input type="range" data-setting="${key}" min="${limit.min}" max="${limit.max}" step="${limit.step}"></label>`;
    }).join('');
    this.element.innerHTML = `<div class="pause-panel">
      <h1>PAUSED</h1><div class="pause-rule"></div>
      <div class="pause-main">
        <button type="button" data-action="resume">Resume</button>
        <button type="button" data-action="restart">Restart</button>
        <button type="button" data-action="settings">Settings</button>
        <button type="button" data-action="quit">Quit to Main Menu</button>
      </div>
      <div class="pause-settings" hidden>
        ${rows}
        <button type="button" data-action="back">Back</button>
      </div>
      <p>ESC TO RESUME · TAB TO NAVIGATE</p>
    </div>`;
    host.append(this.element);
    this.updateSettings(settings);
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('input', this.onInput);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get open(): boolean { return !this.element.hidden; }

  setOpen(open: boolean): void {
    if (!open && this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.element.hidden = !open;
    if (open) this.show('main');
  }

  updateSettings(settings: GameSettings): void {
    this.settings = { ...settings };
    for (const key of Object.keys(SETTING_LIMITS) as SettingKey[]) {
      const slider = this.element.querySelector<HTMLInputElement>(`[data-setting="${key}"]`);
      const value = this.element.querySelector<HTMLOutputElement>(`[data-value="${key}"]`);
      if (slider) slider.value = String(this.settings[key]);
      if (value) value.textContent = formatSetting(key, this.settings[key]);
    }
  }

  private show(screen: 'main' | 'settings'): void {
    this.screen = screen;
    this.element.querySelector<HTMLElement>('.pause-main')!.hidden = screen !== 'main';
    this.element.querySelector<HTMLElement>('.pause-settings')!.hidden = screen !== 'settings';
    this.element.querySelector('p')!.textContent = screen === 'main'
      ? 'ESC TO RESUME · TAB TO NAVIGATE' : 'ESC TO GO BACK · SETTINGS SAVE AUTOMATICALLY';
    if (screen === 'settings') this.element.querySelector<HTMLInputElement>('input')?.focus();
    else this.element.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus();
  }

  private readonly onClick = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'resume') this.actions.resume();
    else if (action === 'restart') this.actions.restart();
    else if (action === 'settings') this.show('settings');
    else if (action === 'back') this.show('main');
    else if (action === 'quit') this.actions.quit();
  };

  private readonly onInput = (event: Event) => {
    const key = (event.target as HTMLInputElement).dataset.setting as SettingKey | undefined;
    if (!key) return;
    this.updateSettings(normalizeSettings({ ...this.settings, [key]: Number((event.target as HTMLInputElement).value) }));
    this.actions.settings(this.settings);
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.open || event.code !== 'Escape' || event.repeat) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.screen === 'settings') this.show('main');
    else this.actions.resume();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.element.removeEventListener('click', this.onClick);
    this.element.removeEventListener('input', this.onInput);
    this.element.remove();
  }
}
