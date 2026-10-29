// Angaben für „Über OpenMol“: Impressum und Datenschutz. Leere Felder erscheinen in der App als
// gut sichtbarer Platzhalter ⟦…⟧ – bitte ausfüllen (Liste in Notion: Claude Projects ▸ OpenMol ▸ „Infos für Über OpenMol“).
export const LEGAL = {
  /** Vor- und Nachname (bzw. Name des Anbieters) */
  name: 'Alexander Tombrink',
  /** ladungsfähige Anschrift: Straße und Hausnummer (kein Postfach) bzw. c/o-Anschrift eines Impressum-Dienstes */
  street: 'Albert-Einstein-Allee 11',
  /** Postleitzahl und Ort */
  city: '89081 Ulm',
  country: 'Deutschland',
  /** Kontakt für Feedback, Anregungen und Impressum */
  email: 'openmol-support@proton.me',
  /** optional: zweiter schneller Kontaktweg (Telefon oder Kontaktformular) */
  phone: '',
  /** nur falls die Browser-Version im Internet bereitgestellt wird: Hoster (Name, Anschrift) */
  webHoster: '',
  /** Stand der Rechtstexte */
  updated: '2026-10-29',
}

/** Wert oder sichtbarer Platzhalter */
export const fill = (v: string, label: string) => (v.trim() ? v : `⟦${label}⟧`)
