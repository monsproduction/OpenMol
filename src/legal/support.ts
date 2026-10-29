// Knopf „Über OpenMol“: wechselndes Symbol und wechselnder Satz – beide im selben Takt, damit Knopf und Fenster
// zusammenpassen. Gewechselt wird frühestens nach 5 Stunden; Stand und Zeitpunkt werden gespeichert, damit ein Neustart
// nicht sofort ein neues Symbol bringt. Ein gemeinsamer Zeitgeber für alle Anzeigen (useSupportTick).
import { useSyncExternalStore } from 'react'
import { lsGet, lsSet } from '../storage'

/** Symbole des Knopfs (Kaffee, KI-Funke für „Token“, Dollar, Euro, winkende Hand, Händedruck) */
export const SUPPORT_ICONS = ['☕', '✨', '💵', '💶', '👋', '🤝']

export const SUPPORT_SENTENCES: Record<'de' | 'en', string[]> = {
  de: [
    'Gefällt dir OpenMol? Dann spendier mir einen Kaffee, meine Reaktionsgeschwindigkeit hängt stark vom Koffeingehalt ab.',
    'Gefällt dir OpenMol? Dann unterstütze mich gerne, denn Open Source heißt nicht, dass die Stromrechnung auch offen ist.',
    'Gefällt dir OpenMol? Dann bilde eine kovalente Bindung mit meinem PayPal- Button, Elektronen teilen gilt auch für Euro.',
    'OpenMol ist kostenlos, mein Kaffee leider nicht. Spendier mir einen, und ich baue weiter.',
    'Du hast gerade ein Molekül in Sekunden gezeichnet. Das ist einen Keks wert, oder lieber gleich eine Pizza.',
    'Mein Lohn für nächtliche Bugfixes ist bisher ein halbes Lächeln. Mit etwas Rückenwind wird es ein ganzes.',
    'Reaktionen laufen schneller mit Katalysator, Software auch. Sei meiner, bitte mit Euro statt Palladium.',
    'Schon mal bei einer Software gedacht: „Das sollte eigentlich Geld kosten“? Hier darfst du es einfach tun.',
    'Hinter OpenMol steckt kein Konzern, nur ich und viel zu viele Tabs. Eine kleine Aufmerksamkeit hält den Laden am Laufen.',
    'Jede Zeile Code hier kostet Tokens, und mein Abo hat inzwischen mehr Limit-Meldungen als Features. Ein kleiner Betrag entspannt beides.',
    'Mein Claude-Abo und ich führen eine komplizierte Beziehung: Es gibt, ich zahle. Ein bisschen Rückenwind würde die Beziehung entlasten.',
    'Claude sagt „Ich denke kurz nach“, und mein Konto sagt „Ich auch“. Hilf uns beiden aus der Denkpause.',
    'Ohne Unterstützung muss ich bald selbst coden, und das möchte ich weder dir noch dem Compiler zumuten.',
    'OpenMol ist kostenlos. Mein Kaffee, mein Abo und meine Würde sind es nicht. Such dir eins aus.',
  ],
  en: [
    'Enjoying OpenMol? Buy me a coffee. My reaction rate depends heavily on caffeine concentration.',
    'Enjoying OpenMol? Support me, so my bank account doesn’t end up with more zeros than my Molfiles.',
    'Enjoying OpenMol? Be the catalyst for my next version: you lower the activation energy, I deliver the features.',
    'OpenMol is free, my coffee sadly is not. Buy me one, and I’ll keep building.',
    'You just drew a molecule in seconds. That’s worth a cookie, or let’s be bold: a pizza.',
    'My salary for late-night bug fixes is currently half a smile. With a little tailwind, it becomes a whole one.',
    'Reactions run faster with a catalyst, and so does software. Be mine, preferably in euros instead of palladium.',
    'Ever thought about a piece of software: “That should really cost money”? Here you may simply do something about it.',
    'There’s no corporation behind OpenMol, just me and far too many open tabs. A small token keeps the lights on.',
    'OpenMol was built with Claude, and Claude counts in tokens, not in gratitude. Help me settle the bill.',
    'My Claude subscription and I are in a complicated relationship: it gives, I pay. A little tailwind would take some pressure off.',
    'Without support I’ll soon have to code myself, and I wouldn’t do that to you or the compiler.',
    'OpenMol is free. My coffee, my subscription and my dignity are not. Pick one.',
  ],
}

// ---------- gemeinsamer Zeitgeber ----------

/** Mindestdauer, bis Symbol und Satz wechseln */
const MIN_SHOW_MS = 5 * 60 * 60 * 1000
const KEY = 'openmol:support-tick'

/** anderer Index als bisher (bei mehr als einem Eintrag) */
const another = (cur: number, n: number) => (n < 2 ? 0 : (cur + 1 + Math.floor(Math.random() * (n - 1))) % n)

type Tick = { icon: number; sentence: number; t: number }

function load(): Tick | null {
  try {
    const v = JSON.parse(lsGet(KEY) ?? 'null') as Tick | null
    if (v && [v.icon, v.sentence, v.t].every(Number.isFinite) && v.t <= Date.now()) {
      return { icon: Math.abs(Math.trunc(v.icon)) % SUPPORT_ICONS.length, sentence: Math.abs(Math.trunc(v.sentence)) % 1000, t: v.t }
    }
  } catch {
    // kaputter Wert: neu auswürfeln
  }
  return null
}

function next(prev: Tick | null): Tick {
  const t: Tick = prev
    ? { icon: another(prev.icon, SUPPORT_ICONS.length), sentence: another(prev.sentence, 1000), t: Date.now() }
    : { icon: Math.floor(Math.random() * SUPPORT_ICONS.length), sentence: Math.floor(Math.random() * 1000), t: Date.now() }
  lsSet(KEY, JSON.stringify(t))
  return t
}

let state: Tick = (() => {
  const v = load()
  return v && Date.now() - v.t < MIN_SHOW_MS ? v : next(v)
})()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

/** jede Minute nach der Uhr prüfen (übersteht auch Ruhezustand und gedrosselte Zeitgeber) */
function check() {
  if (Date.now() - state.t < MIN_SHOW_MS) return
  state = next(state)
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (!timer) {
    check()
    timer = setInterval(check, 60_000)
  }
  return () => {
    listeners.delete(l)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** aktuelles Symbol und aktueller Satz (wechseln gemeinsam) */
export function useSupportTick(lang: 'de' | 'en') {
  const s = useSyncExternalStore(subscribe, () => state)
  const list = SUPPORT_SENTENCES[lang]
  return { icon: SUPPORT_ICONS[s.icon], sentence: list[s.sentence % list.length] }
}
