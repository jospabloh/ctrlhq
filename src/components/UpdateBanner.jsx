import { useNewVersion } from '@/lib/useNewVersion';

/**
 * ACACIA portfolio "new version" notice — shared, byte-identical across every
 * app (Module 30 of `jospabloh/acacia-app-standard`). Change it there first and
 * copy it out.
 *
 * Mount it once in `App.jsx`, next to `<ThemeSwitcher />`, outside any layout:
 * a tab sitting on the login screen is just as stale as one on a dashboard.
 *
 * It never reloads on its own. Whoever is mid-way through a form decides when;
 * the notice says so. Top-centre, because the bottom-right corner belongs to
 * the theme control (Module 12) and the left to the shell (Module 29). On a
 * phone the card spans the width, so an app with a top bar lowers it beneath
 * the bar from its stylesheet:
 *
 *   @media (max-width: 1023px) { :root { --update-banner-top: 4rem; } }
 *
 * An app whose navigation is a full-height side menu (no top bar to sit under)
 * shifts it right of the menu instead: `--update-banner-left: <menu width>`.
 *
 * Below 640px the buttons drop to their own full-width row under the text:
 * squeezed beside two buttons, the sentence wrapped almost word by word and the
 * card grew taller than it was wide.
 *
 * Colours are the app's own semantic tokens, like the theme control.
 */
export default function UpdateBanner() {
  const { available, dismiss, reload } = useNewVersion();
  if (!available) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-0 z-50 flex justify-center px-4 pointer-events-none print:hidden"
      style={{ top: 'var(--update-banner-top, 0.75rem)', left: 'var(--update-banner-left, 0px)' }}
    >
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <p className="min-w-0 sm:flex-1">
          <span className="font-semibold">Hay una versión nueva.</span>{' '}
          <span className="text-muted-foreground">Guarda lo que estés capturando y actualiza.</span>
        </p>
        <div className="flex gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={dismiss}
            className="min-h-[44px] flex-1 rounded-lg px-3 text-muted-foreground sm:flex-none hover:text-foreground"
          >
            Más tarde
          </button>
          <button
            type="button"
            onClick={reload}
            className="min-h-[44px] flex-1 rounded-lg bg-primary px-4 sm:flex-none font-semibold text-primary-foreground hover:opacity-90"
          >
            Actualizar
          </button>
        </div>
      </div>
    </div>
  );
}
