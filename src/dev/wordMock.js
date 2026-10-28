// Nachgebautes Word/Office + OpenMol-Schnittstelle für die Add-in-Seite (Test im Browser, iframe srcdoc)
;(function () {
  const W = (window.__W = { host: 'Word', lang: 'de-DE', apiLang: 'de', sel: [], doc: [], ccs: [], edits: [], resultAfter: 1, results: {}, pingFail: false, resultFail: false, polls: 0, insertErr: null })
  function mkPic(o) {
    const p = {
      width: o.width,
      altTextTitle: o.altTextTitle ?? '',
      altTextDescription: o.altTextDescription ?? '',
      b64: o.b64,
      lockAspectRatio: false,
      getBase64ImageSrc() {
        return { value: p.b64 }
      },
      insertContentControl() {
        const cc = {
          tag: '',
          appearance: '',
          pic: p,
          inlinePictures: { getFirst: () => cc.pic },
          delete(keep) {
            W.ccs = W.ccs.filter((c) => c !== cc)
            W.ccDeleteKeep = keep
          },
        }
        W.ccs.push(cc)
        return cc
      },
      insertInlinePictureFromBase64(b64, loc) {
        if (W.insertErr) throw new Error(W.insertErr)
        W.insertLoc = loc
        const n = mkPic({ b64, width: 999 })
        const i = W.doc.indexOf(p)
        if (i >= 0) W.doc[i] = n
        else W.doc.push(n)
        const cc = W.ccs.find((c) => c.pic === p)
        if (cc) cc.pic = n
        W.replaced = n
        return n
      },
    }
    return p
  }
  W.mkPic = mkPic
  window.Office = {
    HostType: { Word: 'Word', Excel: 'Excel' },
    context: {
      get displayLanguage() {
        return W.lang
      },
    },
    onReady(cb) {
      W.ready = cb
    },
  }
  window.Word = {
    run: async (f) => {
      const ctx = {
        sync: async () => {},
        document: {
          getSelection: () => ({ inlinePictures: { items: W.sel, load() {} } }),
          contentControls: { getByTag: (t) => ({ items: W.ccs.filter((c) => c.tag === t), load() {} }) },
        },
      }
      return f(ctx)
    },
  }
  window.fetch = async (url, init) => {
    const u = new URL(url, 'https://localhost:5185')
    const J = (code, b) => ({ ok: code < 300, status: code, json: async () => b })
    if (u.pathname === '/api/ping') {
      if (W.pingFail) throw new TypeError('Failed to fetch')
      return J(200, { ok: true, version: '1.4.0', lang: W.apiLang })
    }
    if (u.pathname === '/api/edit') {
      const j = JSON.parse(init.body)
      if (typeof j?.payload !== 'string' || !/^OM1:[A-Za-z0-9_.-]+$/.test(j.payload)) return J(400, { error: 'keine OpenMol-Daten' })
      W.edits.push(j.payload)
      const s = 's' + W.edits.length
      W.results[s] = { left: W.resultAfter, png: null }
      return J(200, { session: s })
    }
    if (u.pathname === '/api/result') {
      if (W.resultFail) throw new TypeError('Failed to fetch')
      const s = u.searchParams.get('s')
      const r = W.results[s]
      if (!r) return J(404, { error: 'unbekannt' })
      W.polls++
      if (r.png && r.left-- <= 0) {
        delete W.results[s]
        return J(200, { ready: true, png: r.png })
      }
      return J(200, { ready: false })
    }
    return J(404, { error: 'nicht gefunden' })
  }
})()
