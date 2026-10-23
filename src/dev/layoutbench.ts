// Nur Entwicklung: Prüfstand für das automatische 2D-Layout (SMILES-Import + Aufräumen).
// Im Browser: (await import('/src/dev/layoutbench.ts')).runBench() → je Molekül kürzeste/längste Bindung (in L),
// Zahl verlängerter Bindungen und kleinster Abstand nicht verbundener Atome (unter 0,6 L = Überlappung).
import { oclToFragment, parseStructure } from '../model/ocl'
import type { Doc } from '../model/types'

export const BENCH: Record<string, string> = {
  aspirin: 'CC(=O)Oc1ccccc1C(=O)O',
  caffeine: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
  ibuprofen: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O',
  cholesterol: 'CC(C)CCC[C@@H](C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C',
  binap: 'c1ccc(cc1)P(c2ccccc2)c3ccc4ccccc4c3-c5c(ccc6ccccc56)P(c7ccccc7)c8ccccc8',
  hexaphenylbenzene: 'c1ccc(cc1)-c2c(-c3ccccc3)c(-c4ccccc4)c(-c5ccccc5)c(-c6ccccc6)c2-c7ccccc7',
  tetraphenylmethane: 'c1ccc(cc1)C(c2ccccc2)(c3ccccc3)c4ccccc4',
  tbuSi: 'CC(C)(C)[Si](c1ccccc1)(c2ccccc2)OC',
  tBu4: 'CC(C)(C)c1cc(C(C)(C)C)c(C(C)(C)C)cc1C(C)(C)C',
  strychnine: 'O=C7N2c1ccccc1[C@@]64[C@@H]2[C@@H]3[C@@H](OC/C=C5\\[C@@H]3C[C@@H]6N(CC4)C5)C7',
  taxol:
    'CC1=C2[C@@]([C@]([C@H]([C@@H]3[C@]4([C@H](OC4)C[C@@H]([C@]3(C(=O)[C@@H]2OC(=O)C)C)O)OC(=O)C)OC(=O)c5ccccc5)(C[C@@H]1OC(=O)[C@H](O)[C@@H](NC(=O)c6ccccc6)c7ccccc7)O)(C)C',
  mesityl: 'Cc1cc(C)c(c(C)c1)B(c2c(C)cc(C)cc2C)c3c(C)cc(C)cc3C',
  fourCzIPN: 'N#Cc1c(n2c3ccccc3c4ccccc24)c(n5c6ccccc6c7ccccc57)c(C#N)c(n8c9ccccc9c%10ccccc8%10)c1n%11c%12ccccc%12c%13ccccc%11%13',
  peptide: 'CC(C)C[C@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)CN)C(=O)O',
  xphos: 'CC(C)c1cc(C(C)C)c(c(C(C)C)c1)-c2ccccc2P(C3CCCCC3)C4CCCCC4',
  sphos: 'COc1cccc(OC)c1-c2ccccc2P(C3CCCCC3)C4CCCCC4',
  salicyl: 'O=Cc1ccccc1O',
  glucose: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O',
  atp: 'Nc1ncnc2c1ncn2[C@@H]1O[C@H](COP(=O)(O)OP(=O)(O)OP(=O)(O)O)[C@@H](O)[C@H]1O',
  penicillin: 'CC1(C)S[C@@H]2[C@H](NC(=O)Cc3ccccc3)C(=O)N2[C@H]1C(=O)O',
  morphine: 'CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O',
}

export function metric(doc: Doc, ids?: string[]): string {
  const L = doc.style.bondLength
  const set = new Set(ids ?? Object.keys(doc.atoms))
  const at = Object.values(doc.atoms).filter((a) => set.has(a.id))
  const bs = Object.values(doc.bonds).filter((b) => set.has(b.a1))
  const bl = bs.map((b) => Math.hypot(doc.atoms[b.a1].x - doc.atoms[b.a2].x, doc.atoms[b.a1].y - doc.atoms[b.a2].y) / L)
  const bonded = new Set(bs.flatMap((b) => [b.a1 + '|' + b.a2, b.a2 + '|' + b.a1]))
  let dmin = 9
  for (let i = 0; i < at.length; i++)
    for (let j = i + 1; j < at.length; j++) {
      if (bonded.has(at[i].id + '|' + at[j].id)) continue
      dmin = Math.min(dmin, Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) / L)
    }
  return `${Math.min(...bl).toFixed(2)}/${Math.max(...bl).toFixed(2)} lang:${bl.filter((x) => x > 1.05).length} dmin ${dmin.toFixed(2)}`
}

export function runBench(list: Record<string, string> = BENCH): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, smi] of Object.entries(list)) {
    const f = oclToFragment(parseStructure(smi), 40)
    const doc = {
      atoms: Object.fromEntries(f.atoms.map((a) => [a.id, a])),
      bonds: Object.fromEntries(f.bonds.map((b) => [b.id, b])),
      style: { bondLength: 40 },
    } as unknown as Doc
    out[name] = metric(doc)
  }
  return out
}
