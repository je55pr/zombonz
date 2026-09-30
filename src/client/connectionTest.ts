import { PROTOCOL_VERSION } from '../net/protocol.ts';
import { browserEnvironment, formatReport, judge, runConnectionTest, type ConnectionReport } from '../network/diagnostics.ts';

/**
 * "Test my connection", over the menu or the lobby: runs the checks in `network/diagnostics.ts` and shows the report as text
 * with one button to copy it, so a player who can't connect can paste the result into a message.
 */
export class ConnectionTestView {
  readonly element = document.createElement('div');
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private run = 0;
  private disposed = false;

  constructor(private readonly build: string, private readonly onClose: () => void, parent: HTMLElement = document.body) {
    this.element.className = 'lobby connection-test';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Test my connection');
    this.element.innerHTML = `<div class="lobby-panel">
      <h1>Test connection</h1><div class="pause-rule"></div>
      <p class="test-verdict" data-verdict role="status">Testing…</p>
      <textarea data-report readonly rows="17" spellcheck="false" aria-label="Test results" placeholder="Testing your connection…"></textarea>
      <div class="lobby-actions">
        <button type="button" data-action="copy" disabled>Copy results</button>
        <button type="button" data-action="again" disabled>Test again</button>
        <button type="button" data-action="back">Back</button>
      </div>
      <p class="lobby-status" data-status role="status"></p>
      <p class="lobby-hint">Can't connect to a friend? Run this on both computers and send the results to each other. It takes a few seconds,
        uses the game's configured connection servers plus public address lookups, and leaves your IP address out of the results.</p>
    </div>`;
    parent.append(this.element);
    this.element.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'copy') void this.copy();
      if (action === 'again') void this.start();
      if (action === 'back') this.dispose();
    });
    // Keys stay in this dialog: the menu behind listens on the window and would otherwise act on Enter and Escape.
    this.element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') this.dispose();
    });
    void this.start();
    this.button('back').focus();
  }

  private find<T extends HTMLElement>(selector: string): T { return this.element.querySelector<T>(selector)!; }
  private button(action: string): HTMLButtonElement { return this.find<HTMLButtonElement>(`[data-action="${action}"]`); }
  private status(text: string): void { this.find<HTMLElement>('[data-status]').textContent = text; }

  private async start(): Promise<void> {
    const run = ++this.run;
    const verdict = this.find<HTMLElement>('[data-verdict]'), report = this.find<HTMLTextAreaElement>('[data-report]');
    this.button('copy').disabled = true; this.button('again').disabled = true;
    verdict.className = 'test-verdict'; verdict.textContent = 'Testing…';
    report.value = ''; this.status('');
    let result: ConnectionReport | null = null, failure = '';
    try {
      result = await runConnectionTest(browserEnvironment(this.build, PROTOCOL_VERSION), step => { if (run === this.run) this.status(step); });
    } catch (error) {
      failure = error instanceof Error ? error.message : 'unknown error';
    }
    if (this.disposed || run !== this.run) return;
    this.status('');
    this.button('again').disabled = false;
    if (!result) {
      verdict.classList.add('test-bad');
      verdict.textContent = 'The test could not run.';
      report.value = `ZOMBONZ CONNECTION TEST\nThe test could not run: ${failure}\nBuild ${this.build} (protocol ${PROTOCOL_VERSION}) - ${navigator.userAgent}`;
    } else {
      const outcome = judge(result);
      verdict.classList.add(`test-${outcome.level}`);
      verdict.textContent = outcome.headline;
      report.value = formatReport(result);
    }
    this.button('copy').disabled = false;
  }

  /** Copies the report to the clipboard; if the browser refuses, selects it so Ctrl+C works. */
  private async copy(): Promise<void> {
    const report = this.find<HTMLTextAreaElement>('[data-report]');
    try {
      await navigator.clipboard.writeText(report.value);
      this.status('Copied. Paste it into your message.');
    } catch {
      report.focus(); report.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* falls through to the message below */ }
      this.status(copied ? 'Copied. Paste it into your message.' : 'Select the text and press Ctrl+C to copy it.');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.remove();
    if (this.opener?.isConnected) this.opener.focus();
    this.onClose();
  }
}
