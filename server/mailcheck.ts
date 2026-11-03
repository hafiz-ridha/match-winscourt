/**
 * Cek domain email benar-benar bisa menerima email (punya MX, atau A/AAAA sebagai cadangan).
 * Gangguan DNS sementara tidak menggagalkan pendaftaran (fail-open); hanya domain yang pasti
 * tidak ada / tidak punya server email yang ditolak.
 */
import { promises as dns } from 'node:dns';

type Verdict = 'ok' | 'none' | 'unknown';
const cache = new Map<string, { v: Verdict; at: number }>();
const TTL = 6 * 3600_000;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms))]);

const missing = (e: unknown) => ['ENOTFOUND', 'ENODATA', 'ESERVFAIL_NX'].includes((e as { code?: string }).code ?? '');

export async function emailDomainVerdict(domain: string): Promise<Verdict> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Verdict;
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 4000);
    v = mx.some((r) => r.exchange && r.exchange !== '.') ? 'ok' : 'none';
  } catch (e) {
    if (!missing(e)) v = 'unknown';
    else {
      // Tanpa MX: domain dengan alamat IP masih bisa menerima email (jarang, tapi sah).
      try {
        const a = await withTimeout(dns.resolve4(domain), 3000);
        v = a.length ? 'ok' : 'none';
      } catch (e2) {
        v = missing(e2) ? 'none' : 'unknown';
      }
    }
  }
  cache.set(domain, { v, at: Date.now() });
  return v;
}
