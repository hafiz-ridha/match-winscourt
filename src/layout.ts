/**
 * Mode tampilan: "phone" (bawaan — tampilan HP potret seperti biasa) atau "wide" (mode desktop /
 * landscape, dipilih pengguna lewat tombol di samping logo). Pilihan diingat di perangkat ini.
 *
 *  - Mode lebar di layar yang cukup lebar (tablet, HP diputar, laptop): tata letak 2 kolom.
 *  - Mode lebar di HP potret: halaman ditampilkan seperti situs desktop (lebar 1024 px, diperkecil),
 *    sama seperti "Situs desktop" di browser.
 */
const KEY = 'mwc.layout';
const EVT = 'mwc-layout';
const VP_PHONE = 'width=device-width, initial-scale=1, viewport-fit=cover';
const VP_DESKTOP = 'width=1024, viewport-fit=cover';

export function isWide(): boolean {
  try {
    return localStorage.getItem(KEY) === 'wide';
  } catch {
    return false;
  }
}

/** Lebar layar perangkat (px CSS) sesuai orientasi saat ini, tidak terpengaruh meta viewport. */
function deviceWidth() {
  const landscape = window.matchMedia?.('(orientation: landscape)').matches;
  const a = screen.width || window.innerWidth;
  const b = screen.height || window.innerHeight;
  return landscape ? Math.max(a, b) : Math.min(a, b);
}

export function applyLayout() {
  const wide = isWide();
  document.documentElement.dataset.layout = wide ? 'wide' : 'phone';
  const meta = document.querySelector('meta[name="viewport"]');
  const dw = deviceWidth();
  // Skala awal eksplisit: Safari iPhone & Chrome Android langsung memperkecil halaman 1024 px ke lebar layar.
  const want = wide && dw < 720 ? `${VP_DESKTOP}, initial-scale=${Math.round((dw / 1024) * 1000) / 1000}` : VP_PHONE;
  if (meta && meta.getAttribute('content') !== want) meta.setAttribute('content', want);
}

export function setWide(wide: boolean) {
  try {
    localStorage.setItem(KEY, wide ? 'wide' : 'phone');
  } catch {
    /* mode privat: tetap berlaku sampai halaman ditutup */
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
  // HP diputar: HP potret → tampilan desktop, HP landscape → lebar asli layar.
  window.addEventListener('orientationchange', () => setTimeout(applyLayout, 120));
  window.matchMedia?.('(orientation: landscape)').addEventListener?.('change', applyLayout);
}
