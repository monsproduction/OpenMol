// Demo: Reaktion aus Screenshots/S21.png mit fertiger Ansatztabelle (nur für die Entwicklung).
import { emptyDoc, emptySelection } from '../model/types'
import { commit, getState, replaceDoc, setState } from '../store'
import { createStoichTable, fitView, insertStructureText } from '../tools/actions'

export function buildAnsatz() {
  replaceDoc(emptyDoc(), 'Ansatz S21')
  insertStructureText('Fc1cc2nc3c4cccnc4c4ncccc4c3nc2cc1F', { x: 0, y: 0 })
  insertStructureText('CC(C)(C)c1ccc2[nH]c3ccc(cc3c2c1)C(C)(C)C', { x: 330, y: 0 })
  insertStructureText('C[Si](C)(C)N([Na])[Si](C)(C)C', { x: 600, y: 0 })
  insertStructureText('CC(C)(C)c1ccc2c(c1)c1cc(ccc1n2-c1cc2nc3c4cccnc4c4ncccc4c3nc2cc1-n1c2ccc(cc2c2cc(ccc21)C(C)(C)C)C(C)(C)C)C(C)(C)C', { x: 1150, y: 0 })
  commit((d) => {
    d.arrows.a1 = { id: 'a1', kind: 'reaction', x1: 720, y1: 0, x2: 860, y2: 0, above: 'THF, 80 °C', below: '16 h, N2' }
  })
  setState({ sel: emptySelection() })
  createStoichTable()
  const id = Object.keys(getState().doc.tables)[0]
  commit((d) => {
    const t = d.tables[id]
    Object.assign(t.rows[0], { mass: 0.105, driver: 'mass' })
    Object.assign(t.rows[1], { eq: 2.2, driver: 'eq', name: '3,6-Di-tert-butylcarbazol' })
    Object.assign(t.rows[2], { eq: 2.1, driver: 'eq', name: 'NaHMDS' })
    t.rows[3].volume = 0.005
    t.rows[4].obtained = 0.097
  })
  setState({ sel: { ...emptySelection(), tables: [id] }, tableEditor: id })
  setTimeout(() => fitView(), 300)
}
