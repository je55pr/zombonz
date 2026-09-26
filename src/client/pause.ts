/** Presentation-owned solo pause: no simulation tick or wall-clock timer runs while paused. */
export class SoloPauseController {
  paused = false;

  constructor(
    private readonly surface: HTMLElement,
    private readonly target: Window = window,
    private readonly page: Document = document,
    private readonly onChange: (paused: boolean) => void = () => {},
    private readonly autoPauseOnPointerUnlock = true,
    private readonly canPause: () => boolean = () => true,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('blur', this.onBlur);
    page.addEventListener('visibilitychange', this.onVisibilityChange);
    page.addEventListener('pointerlockchange', this.onPointerLockChange);
    surface.addEventListener('pointerdown', this.onPointerDown);
  }

  private setPaused(value: boolean): void {
    if (value && !this.canPause()) return;
    if (this.paused === value) return;
    this.paused = value;
    this.onChange(value);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && !event.repeat) this.setPaused(true);
  };
  private onBlur = () => this.setPaused(true);
  private onVisibilityChange = () => { if (this.page.hidden) this.setPaused(true); };
  private onPointerLockChange = () => {
    if (this.autoPauseOnPointerUnlock && this.page.pointerLockElement !== this.surface) this.setPaused(true);
  };
  private onPointerDown = () => {
    if (!this.page.hidden) this.setPaused(false);
  };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('blur', this.onBlur);
    this.page.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.page.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
  }
}
