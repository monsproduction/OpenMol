// Knopf „Über OpenMol“: wechselndes Symbol und wechselnder Satz – beide im selben zufälligen Takt (4–10 s), damit
// Knopf und Fenster zusammenpassen. Ein gemeinsamer Zeitgeber für alle Anzeigen (useSupportTick).
import { useSyncExternalStore } from 'react'

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

let state = { icon: Math.floor(Math.random() * SUPPORT_ICONS.length), sentence: Math.floor(Math.random() * 1000) }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

/** anderer Index als bisher (bei mehr als einem Eintrag) */
const another = (cur: number, n: number) => (n < 2 ? 0 : (cur + 1 + Math.floor(Math.random() * (n - 1))) % n)

function schedule() {
  // zufälliger Abstand 4–10 s
  timer = setTimeout(
    () => {
      state = { icon: another(state.icon, SUPPORT_ICONS.length), sentence: another(state.sentence % 1000, 1000) }
      for (const l of listeners) l()
      schedule()
    },
    4000 + Math.random() * 6000,
  )
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (!timer) schedule()
  return () => {
    listeners.delete(l)
    if (!listeners.size && timer) {
      clearTimeout(timer)
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
