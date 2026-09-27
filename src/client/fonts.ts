// Bundled, openly licensed UI fonts (Latin subset only), so every player sees the same type offline.
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/special-elite/latin-400.css';

/** Condensed sans for numbers, labels and prompts. */
export const UI_FONT = `'Oswald', 'Arial Narrow', Arial, sans-serif`;
/** Worn typewriter face for titles and flavour text. */
export const TITLE_FONT = `'Special Elite', 'Courier New', monospace`;

let loaded: Promise<void> | null = null;

/**
 * Resolves once the UI fonts can be drawn on a canvas. Canvas text never waits for web fonts,
 * so canvases draw with the fallbacks first and repaint when this resolves.
 */
export function loadUiFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  loaded ??= Promise.all([
    document.fonts.load(`500 20px ${UI_FONT}`),
    document.fonts.load(`700 20px ${UI_FONT}`),
    document.fonts.load(`400 20px ${TITLE_FONT}`),
  ]).then(() => {}, () => {});
  return loaded;
}
