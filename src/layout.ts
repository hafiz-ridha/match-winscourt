/**
 * Mode tampilan:
 *  - Otomatis (bawaan): HP posisi tegak → tampilan HP seperti biasa; HP diputar landscape, tablet,
 *    laptop → tata letak lebar (2 kolom), tanpa perlu klik.
 *  - Tombol di topbar memaksa salah satu mode (diingat di perangkat ini). Memilih mode yang sama
 *    dengan hasil otomatis mengembalikan ke Otomatis, jadi memutar layar tetap berpengaruh.
 *  - "Desktop" dipaksa di HP posisi tegak: halaman ditampilkan seperti situs desktop (lebar 1024 px,
 *    diperkecil), sama seperti "Situs desktop" di browser.
 */
type Pref = 'auto' | 'wide' | 'phone';
const KEY = 'mwc.layout';
const EVT = 'mwc-layout';
const VP_PHONE = 'width=device-width, initial-scale=1, viewport-fit=cover';
const VP_DESKTOP = 'width=1024, viewport-fit=cover';
/** Layar cukup lebar untuk tata letak 2 kolom: ≥720 px, atau landscape ≥600 px (HP diputar). */
const WIDE_SCREEN = 600;
const WIDE_ANY = 720;

function pref(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'wide' || v === 'phone' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Lebar layar perangkat (px CSS) sesuai orientasi saat ini, tidak terpengaruh meta viewport. */
function deviceWidth() {
  const landscape = window.matchMedia?.('(orientation: landscape)').matches;
  const a = screen.width || window.innerWidth;
  const b = screen.height || window.innerHeight;
  return landscape ? Math.max(a, b) : Math.min(a, b);
}

/** Hasil mode otomatis untuk layar saat ini. */
function autoWide() {
  const landscape = window.matchMedia?.('(orientation: landscape)').matches ?? window.innerWidth > window.innerHeight;
  const w = Math.min(window.innerWidth, deviceWidth() || window.innerWidth);
  return w >= WIDE_ANY || (landscape && w >= WIDE_SCREEN);
}

export function isWide(): boolean {
  const p = pref();
  return p === 'wide' || (p === 'auto' && autoWide());
}

export function applyLayout() {
  const p = pref();
  const wide = p === 'wide' || (p === 'auto' && autoWide());
  const root = document.documentElement;
  const prev = root.dataset.layout;
  root.dataset.layout = wide ? 'wide' : 'phone';
  const meta = document.querySelector('meta[name="viewport"]');
  const dw = deviceWidth();
  // Hanya bila pengguna memaksa Desktop di layar sempit. Skala awal eksplisit supaya Safari iPhone &
  // Chrome Android langsung memperkecil halaman 1024 px ke lebar layar.
  const want = p === 'wide' && dw < WIDE_SCREEN ? `${VP_DESKTOP}, initial-scale=${Math.round((dw / 1024) * 1000) / 1000}` : VP_PHONE;
  if (meta && meta.getAttribute('content') !== want) meta.setAttribute('content', want);
  if (prev !== root.dataset.layout) window.dispatchEvent(new Event(EVT));
}

/** Dari tombol: pilih mode. Bila sama dengan hasil otomatis, kembali ke Otomatis. */
export function setWide(wide: boolean) {
  // Hitung hasil otomatis dengan viewport normal (bukan viewport desktop paksaan).
  const meta = document.querySelector('meta[name="viewport"]');
  const forced = meta?.getAttribute('content')?.startsWith('width=1024');
  const auto = forced ? deviceWidth() >= WIDE_ANY : autoWide();
  const next: Pref = wide === auto ? 'auto' : wide ? 'wide' : 'phone';
  try {
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* mode privat: berlaku sampai halaman ditutup */
  }
  applyLayout();
  window.dispatchEvent(new Event(EVT));
  window.scrollTo(0, 0);
}

export function onLayoutChange(fn: () => void) {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}

/** Dipanggil sekali saat aplikasi dimuat. */
export function initLayout() {
  applyLayout();
  // Diputar / ukuran jendela berubah → mode otomatis menyesuaikan.
  let t = 0;
  const later = () => {
    clearTimeout(t);
    t = window.setTimeout(applyLayout, 120);
  };
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.visualViewport?.addEventListener('resize', later);
  window.matchMedia?.('(orientation: landscape)').addEventListener?.('change', later);
}
