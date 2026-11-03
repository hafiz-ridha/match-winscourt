/**
 * Validasi kontak akun umum (tanpa OTP): menolak nomor HP & email yang jelas asal-asalan.
 * Tidak membuktikan kepemilikan — hanya bentuk yang mungkin aktif.
 */

/** Awalan seluler Indonesia (setelah 0): Telkomsel, Indosat, XL, Axis, Tri, Smartfren, by.U. */
const MOBILE_PREFIXES = [
  '811', '812', '813', '821', '822', '823', '851', '852', '853', // Telkomsel / by.U
  '814', '815', '816', '855', '856', '857', '858', // Indosat
  '817', '818', '819', '859', '877', '878', // XL
  '831', '832', '833', '838', // Axis
  '895', '896', '897', '898', '899', // Tri
  '881', '882', '883', '884', '885', '886', '887', '888', '889', // Smartfren
];

/**
 * @param p62 nomor yang sudah dinormalisasi (628…)
 * @returns pesan kesalahan, atau null bila wajar
 */
export function phoneIssue(p62: string): string | null {
  if (!/^62\d+$/.test(p62)) return 'No. HP hanya boleh berisi angka (contoh: 0812xxxxxxx)';
  const local = '0' + p62.slice(2); // 08…
  if (!local.startsWith('08')) return 'Pakai nomor HP seluler Indonesia (diawali 08)';
  if (local.length < 10 || local.length > 13) return 'No. HP harus 10–13 digit (contoh: 0812 3456 7890)';
  if (!MOBILE_PREFIXES.includes(local.slice(1, 4))) return `Awalan ${local.slice(0, 4)} bukan nomor seluler yang dikenal. Periksa lagi nomornya.`;
  const rest = local.slice(4);
  if (/^(\d)\1+$/.test(rest) || /(\d)\1{6,}/.test(local)) return 'No. HP terlihat tidak asli (angka berulang). Pakai nomor yang aktif.';
  if ('0123456789012345'.includes(rest) || '9876543210987654'.includes(rest)) return 'No. HP terlihat tidak asli (angka berurutan). Pakai nomor yang aktif.';
  return null;
}

/** Layanan email sementara / sekali pakai. */
const DISPOSABLE = new Set([
  'mailinator.com', 'yopmail.com', 'yopmail.net', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempail.com',
  'trashmail.com', 'trashmail.de', 'maildrop.cc', 'getnada.com', 'nada.email', 'dispostable.com', 'fakeinbox.com',
  'throwawaymail.com', 'mohmal.com', 'emailondeck.com', 'mailnesia.com', 'minuteinbox.com', 'mintemail.com',
  'spamgourmet.com', 'mailcatch.com', 'moakt.com', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'burnermail.io',
  'inboxkitten.com', 'mail.tm', 'mailpoof.com', 'fakemail.net', 'emailfake.com', 'generator.email', 'tempr.email',
]);

/** Salah ketik domain yang sering terjadi → domain yang dimaksud. */
const TYPO: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.co.id': 'gmail.com', 'gmail.id': 'gmail.com', 'gmali.com': 'gmail.com', 'gmeil.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'yaho.co.id': 'yahoo.co.id', 'yahoo.co.di': 'yahoo.co.id',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outloo.com': 'outlook.com',
  'icloud.co': 'icloud.com', 'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com',
};

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Saran perbaikan email bila domainnya salah ketik umum (mis. gmial.com → gmail.com). */
export function emailSuggestion(email: string): string | null {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const fix = TYPO[e.slice(at + 1)];
  return fix ? `${e.slice(0, at)}@${fix}` : null;
}

/** Pemeriksaan email tanpa jaringan: format, salah ketik, email sementara. */
export function emailIssue(email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return 'Format email tidak valid (contoh: nama@gmail.com)';
  const sug = emailSuggestion(e);
  if (sug) return `Sepertinya salah ketik. Maksudnya ${sug}?`;
  const domain = e.slice(e.lastIndexOf('@') + 1);
  if (DISPOSABLE.has(domain)) return 'Email sementara/sekali pakai tidak bisa dipakai. Gunakan email pribadi yang aktif.';
  return null;
}

export const emailDomain = (email: string) => email.trim().toLowerCase().slice(email.trim().lastIndexOf('@') + 1);
