import { useTheme } from 'next-themes';

/**
 * Adapter between next-themes and the portfolio's shared <ThemeSwitcher />.
 *
 * `mode` is the operator's stored *preference* — 'light' | 'dark' | 'system' —
 * not the resolved colour scheme. That distinction is the whole point: a
 * switcher that reported `resolvedTheme` would show "Oscuro" to someone who
 * picked "Sistema" at night, and their choice would silently disappear.
 */
export function useThemeMode() {
  const { theme, setTheme } = useTheme();
  return { mode: theme || 'system', setMode: setTheme };
}
