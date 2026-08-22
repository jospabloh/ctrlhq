// Per-app half of the shared smoke suite. smoke.spec.js next to this file is
// byte-identical across the portfolio — the canonical copy lives in
// `jospabloh/acacia-app-standard` → `shared/smoke/`. Change it there and copy
// it out; everything specific to this app belongs here instead.
//
// auth.spec.js alongside it is this app's own extra: the tenant-shell-instead-
// of-login regression it shipped once, which the shared suite does not cover.
export default {
  name: 'CtrlHQ',
  url: 'https://ctrlhq.acaciaco.com.mx',

  // Verbatim from this repo's index.html — proves the deploy served THIS app
  // and not a stale or unrelated one.
  title: /CtrlHQ/,

  theme: {
    // Tailwind's `.dark` on <html>.
    kind: 'class',
    root: '[data-theme-switcher]',
  },
};
