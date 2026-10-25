// Selbst signiertes Zertifikat nur für localhost/127.0.0.1, ohne openssl (Windows hat keins) – mit Node erzeugt.
// Inhalt wie das Mac-Zertifikat aus electron/wordAddin.mjs: keine Zertifizierungsstelle (kann nichts anderes
// beglaubigen), nur Webserver, RSA 2048 / SHA-256. Geprüft mit openssl x509 und einem HTTPS-Abruf (siehe WINDOWS.md).
import crypto from 'node:crypto'

// ---------- DER (die Binärform von ASN.1) ----------

function len(n) {
  if (n < 0x80) return Buffer.from([n])
  const b = []
  for (; n > 0; n >>= 8) b.unshift(n & 0xff)
  return Buffer.from([0x80 | b.length, ...b])
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), len(body.length), body])
}
const seq = (...p) => tlv(0x30, ...p)
const set = (...p) => tlv(0x31, ...p)
const octets = (b) => tlv(0x04, b)
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'))
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]))
const explicit = (n, ...p) => tlv(0xa0 + n, ...p)
function int(b) {
  // positiv halten: führendes Null-Byte, wenn das höchste Bit gesetzt ist
  return tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b)
}
function oid(s) {
  const [a, b, ...rest] = s.split('.').map(Number)
  const out = [40 * a + b]
  for (const v of rest) {
    const enc = [v & 0x7f]
    for (let x = v >> 7; x > 0; x >>= 7) enc.unshift(0x80 | (x & 0x7f))
    out.push(...enc)
  }
  return tlv(0x06, Buffer.from(out))
}
/** UTCTime (gilt bis 2049 – reicht für 825 Tage ab heute) */
function time(d) {
  const p = (n) => String(n).padStart(2, '0')
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(s, 'ascii'))
}
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value))

/**
 * Zertifikat und Schlüssel erzeugen. Rückgabe: { certPem, keyPem, der } – der = Zertifikat in DER (für die
 * Windows-Zertifikatsverwaltung als .cer)
 */
export function makeSelfSignedCert({ commonName = 'OpenMol localhost', days = 825 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const sha256Rsa = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05))
  const name = seq(set(seq(oid('2.5.4.3'), utf8(commonName))))
  const serial = crypto.randomBytes(16)
  serial[0] &= 0x7f
  const from = new Date(Date.now() - 60e3)
  const to = new Date(from.getTime() + days * 86400e3)
  // Kennung des Schlüssels: SHA-1 des öffentlichen Schlüssels (der BIT STRING am Ende der spki-Struktur)
  const keyId = crypto.createHash('sha1').update(crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ type: 'pkcs1', format: 'der' })).digest()
  const extensions = seq(
    // subjectAltName: DNS localhost, IP 127.0.0.1
    ext('2.5.29.17', false, seq(tlv(0x82, Buffer.from('localhost')), tlv(0x87, Buffer.from([127, 0, 0, 1])))),
    // basicConstraints: keine Zertifizierungsstelle
    ext('2.5.29.19', true, seq()),
    // keyUsage: digitalSignature, keyEncipherment
    ext('2.5.29.15', true, tlv(0x03, Buffer.from([0x05, 0xa0]))),
    // extendedKeyUsage: nur Webserver
    ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
    ext('2.5.29.14', false, octets(keyId)),
  )
  const tbs = seq(explicit(0, int(Buffer.from([2]))), int(serial), sha256Rsa, name, seq(time(from), time(to)), name, spki, explicit(3, extensions))
  const sig = crypto.sign('sha256', tbs, privateKey)
  const der = seq(tbs, sha256Rsa, tlv(0x03, Buffer.from([0]), sig))
  const b64 = der.toString('base64').replace(/.{64}/g, '$&\n')
  return {
    certPem: `-----BEGIN CERTIFICATE-----\n${b64}${b64.endsWith('\n') ? '' : '\n'}-----END CERTIFICATE-----\n`,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    der,
  }
}

/** Fingerabdruck (SHA-1, Großbuchstaben) – so benennt Windows Zertifikate im Speicher */
export const thumbprint = (der) => crypto.createHash('sha1').update(der).digest('hex').toUpperCase()
