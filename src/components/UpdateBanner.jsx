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
 * Colours are the app's own semantic tokens, like the theme control.
 */
export default function UpdateBanner() {
  const { available, dismiss, reload } = useNewVersion();
  if (!available) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none print:hidden"
      style={{ top: 'var(--update-banner-top, 0.75rem)' }}
    >
      <div className="pointer-events-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg">
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Hay una versión nueva.</span>{' '}
          <span className="text-muted-foreground">Guarda lo que estés capturando y actualiza.</span>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="min-h-[44px] rounded-lg px-3 text-muted-foreground hover:text-foreground"
          >
            Más tarde
          </button>
          <button
            type="button"
            onClick={reload}
            className="min-h-[44px] rounded-lg bg-primary px-4 font-semibold text-primary-foreground hover:opacity-90"
          >
            Actualizar
          </button>
        </div>
      </div>
    </div>
  );
}
