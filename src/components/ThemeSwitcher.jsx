import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useThemeMode } from '@/lib/useThemeMode';

/**
 * ACACIA portfolio theme switcher — shared, byte-identical across every app in
 * the portfolio. Keep it that way: if this file needs to change, change it in
 * `jospabloh/acacia-app-standard` first and copy it out, so an operator who
 * runs two ACACIA apps finds the same control in the same corner of both.
 *
 * Shape: a small circle pinned to a screen corner showing the mode currently in
 * force. Pressing it grows the circle sideways into a three-slot track with an
 * indicator that slides to the chosen slot. Three states get three physical
 * positions, so the control's shape states its own model — which a two-state
 * sun/moon button structurally cannot do once "follow the device" is an option.
 *
 * Placement is a CSS variable, not a prop, so an app whose mobile layout has a
 * bottom nav or a floating action button can lift the control out of the way
 * from its own stylesheet without touching this file:
 *
 *   :root { --theme-switcher-bottom: 1rem; --theme-switcher-right: 1rem; }
 *   @media (max-width: 767px) { :root { --theme-switcher-bottom: 5.5rem; } }
 *
 * Every colour here is one of the app's own semantic tokens, so the control
 * inherits each app's palette instead of importing a look of its own. Brand
 * colour appears in exactly one place: the sliding indicator.
 */

const MODES = [
  { value: 'light', label: 'Claro', hint: 'Tema claro' },
  { value: 'dark', label: 'Oscuro', hint: 'Tema oscuro' },
  { value: 'system', label: 'Sistema', hint: 'Seguir al dispositivo' },
];

const SLOT = 34; // px — one slot in the expanded track
const PAD = 3; // px — track padding around the slots

// The capsule's easing curve, applied through inline styles rather than a
// Tailwind arbitrary value: Tailwind reads the commas inside an arbitrary
// timing function as ambiguous and warns about it on every build.
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

function Glyph({ mode }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  };

  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1.3v1.4M8 13.3v1.4M14.7 8h-1.4M2.7 8H1.3M12.74 3.26l-.99.99M4.25 11.75l-.99.99M12.74 12.74l-.99-.99M4.25 4.25l-.99-.99" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M13.6 9.62A5.9 5.9 0 0 1 6.38 2.4a5.9 5.9 0 1 0 7.22 7.22Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.6" />
      <path d="M6 14.4h4M8 11.2v3.2" />
    </svg>
  );
}

export default function ThemeSwitcher() {
  const { mode, setMode } = useThemeMode();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef(null);
  const bubbleRef = useRef(null);
  const slotRefs = useRef([]);
  const collapseTimer = useRef(null);
  const groupId = useId();

  // The stored preference is only known on the client. Rendering nothing until
  // mount keeps the resting glyph from flashing the wrong mode for a frame.
  useEffect(() => setMounted(true), []);

  useEffect(() => () => clearTimeout(collapseTimer.current), []);

  const close = useCallback((restoreFocus) => {
    clearTimeout(collapseTimer.current);
    setOpen(false);
    if (restoreFocus) bubbleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // Move focus onto the active slot as the track opens, so the keyboard path is
  // the same as the pointer one: open, then pick.
  useEffect(() => {
    if (!open) return;
    const index = MODES.findIndex((m) => m.value === mode);
    slotRefs.current[index < 0 ? 0 : index]?.focus();
  }, [open, mode]);

  if (!mounted) return null;

  const activeIndex = Math.max(0, MODES.findIndex((m) => m.value === mode));
  const active = MODES[activeIndex];

  // Picking with the pointer closes the track once the indicator has finished
  // sliding, so the corner goes quiet again on its own. Picking with the
  // keyboard (`detail === 0`) leaves it open — collapsing under a focused
  // element would drop the caret somewhere the user never asked to go.
  const onSelect = (event, value) => {
    setMode(value);
    clearTimeout(collapseTimer.current);
    if (event.detail > 0) {
      collapseTimer.current = setTimeout(() => setOpen(false), 1100);
    }
  };

  const onSlotKeyDown = (event) => {
    clearTimeout(collapseTimer.current);
    const last = MODES.length - 1;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = activeIndex === last ? 0 : activeIndex + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = activeIndex === 0 ? last : activeIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    setMode(MODES[next].value);
    slotRefs.current[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      data-theme-switcher=""
      className="fixed z-50 print:hidden"
      style={{
        bottom: 'calc(var(--theme-switcher-bottom, 1rem) + env(safe-area-inset-bottom, 0px))',
        right: 'calc(var(--theme-switcher-right, 1rem) + env(safe-area-inset-right, 0px))',
      }}
    >
      <div
        className={[
          'relative flex h-10 items-center overflow-hidden rounded-full border border-border',
          'bg-card/80 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-12px_rgba(0,0,0,0.35)]',
          'backdrop-blur-md supports-[backdrop-filter]:bg-card/70',
          'transition-[width,opacity] duration-300',
          'motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-70 hover:opacity-100 focus-within:opacity-100',
        ].join(' ')}
        style={{ width: open ? MODES.length * SLOT + PAD * 2 : 40, transitionTimingFunction: EASE }}
      >
        {/* Collapsed: one button showing the mode in force. */}
        <button
          ref={bubbleRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls={groupId}
          aria-label={`Tema: ${active.label}. Abrir selector de tema`}
          title={`Tema: ${active.label}`}
          tabIndex={open ? -1 : 0}
          className={[
            'absolute inset-0 flex items-center justify-center rounded-full text-muted-foreground',
            'transition-opacity duration-200 ease-out motion-reduce:transition-none',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            open ? 'pointer-events-none opacity-0' : 'opacity-100',
          ].join(' ')}
        >
          <Glyph mode={active.value} />
        </button>

        {/* Expanded: the three-slot track. */}
        <div
          id={groupId}
          role="radiogroup"
          aria-label="Tema de la aplicación"
          aria-hidden={!open}
          className={[
            'relative flex items-center transition-opacity duration-200 ease-out motion-reduce:transition-none',
            open ? 'opacity-100 delay-75' : 'pointer-events-none opacity-0',
          ].join(' ')}
          style={{ padding: PAD }}
        >
          <span
            aria-hidden="true"
            className="absolute rounded-full bg-primary/15 transition-transform duration-300 motion-reduce:transition-none"
            style={{
              width: SLOT,
              height: SLOT,
              left: PAD,
              transform: `translateX(${activeIndex * SLOT}px)`,
              transitionTimingFunction: EASE,
            }}
          />
          {MODES.map((option, index) => {
            const isActive = option.value === active.value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  slotRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={option.hint}
                title={option.label}
                tabIndex={open && isActive ? 0 : -1}
                onClick={(event) => onSelect(event, option.value)}
                onKeyDown={onSlotKeyDown}
                className={[
                  'relative flex items-center justify-center rounded-full',
                  'transition-colors duration-200 motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
                style={{ width: SLOT, height: SLOT }}
              >
                <Glyph mode={option.value} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
