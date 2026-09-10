/**
 * Conguaglio.gs
 *
 * Dato l'elenco dei saldi, propone il minor numero di bonifici che li azzera
 * tutti. Con n soggetti servono al massimo n-1 movimenti, invece dei bonifici
 * incrociati che nascono se ognuno rimborsa ognuno.
 *
 * La cassa entra nel calcolo come tutti gli altri. Se il fondo comune ha
 * giacenza, il suo saldo e' negativo per pari importo: risulta quindi a
 * debito e il conguaglio la fa pagare i soci a credito, che e' esattamente
 * il comportamento voluto.
 */

function mostraConguaglio() {
  var dati = calcolaConguaglio_();
  var t = HtmlService.createTemplateFromFile('Conguaglio-page');
  t.dati = dati;
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(520).setHeight(520), 'Conguaglio');
}

/**
 * @return {{righe: Array, bonifici: Array, sbilancio: number, totale: number}}
 */
function calcolaConguaglio_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.SALDI);
  if (!sh || sh.getLastRow() < 2) {
    return { righe: [], bonifici: [], sbilancio: 0, totale: 0 };
  }

  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  var righe = [];
  for (var i = 0; i < valori.length; i++) {
    var id = String(valori[i][0]).trim();
    if (!id) continue;
    righe.push({
      id: id,
      nome: String(valori[i][1]).trim() || id,
      saldo: Math.round(Number(valori[i][6]) * 100)   // centesimi
    });
  }

  var sbilancio = righe.reduce(function (a, r) { return a + r.saldo; }, 0);

  // Copie ordinate: creditori e debitori, dal piu' grande al piu' piccolo.
  var creditori = righe.filter(function (r) { return r.saldo > 0; })
    .map(function (r) { return { id: r.id, nome: r.nome, resto: r.saldo }; })
    .sort(function (a, b) { return b.resto - a.resto; });

  var debitori = righe.filter(function (r) { return r.saldo < 0; })
    .map(function (r) { return { id: r.id, nome: r.nome, resto: -r.saldo }; })
    .sort(function (a, b) { return b.resto - a.resto; });

  var bonifici = [];
  var totale = 0;

  if (sbilancio === 0) {
    var ic = 0, id_ = 0;
    var guardia = 0;
    while (ic < creditori.length && id_ < debitori.length && guardia++ < 1000) {
      var c = creditori[ic], d = debitori[id_];
      var quanto = Math.min(c.resto, d.resto);
      if (quanto > 0) {
        bonifici.push({
          da: d.id, daNome: d.nome,
          a: c.id, aNome: c.nome,
          importo: quanto / 100
        });
        totale += quanto;
        c.resto -= quanto;
        d.resto -= quanto;
      }
      if (c.resto === 0) ic++;
      if (d.resto === 0) id_++;
    }
  }

  return {
    righe: righe.map(function (r) {
      return { id: r.id, nome: r.nome, saldo: r.saldo / 100 };
    }),
    bonifici: bonifici,
    sbilancio: sbilancio / 100,
    totale: totale / 100
  };
}

/**
 * Scrive i bonifici proposti nel foglio Giroconti. Ricalcola il conguaglio
 * lato server: i dati arrivati dal browser servono solo a confermare
 * l'intenzione, non a decidere gli importi.
 */
function inserisciConguaglioInGiroconti(causale) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_MS)) {
    throw new Error('Un\'altra scrittura e\' in corso. Riprova tra qualche secondo.');
  }
  try {
    var dati = calcolaConguaglio_();
    if (dati.sbilancio !== 0) {
      throw new Error('I saldi non sono in pari (sbilancio ' +
        dati.sbilancio.toFixed(2) + '). Sistema i Controlli prima di conguagliare.');
    }
    if (!dati.bonifici.length) {
      throw new Error('Non c\'e\' nulla da conguagliare: i saldi sono gia\' a zero.');
    }

    var oggi = new Date();
    var testo = String(causale || 'Conguaglio').trim() || 'Conguaglio';

    accodaRighe_(FOGLI.GIROCONTI, dati.bonifici.map(function (b) {
      return [oggi, b.da, b.a, b.importo, testo];
    }));

    scriviLog_('CONGUAGLIO', '', dati.bonifici.length + ' bonifici, totale ' +
      dati.totale.toFixed(2));

    return { inseriti: dati.bonifici.length, totale: dati.totale };
  } finally {
    lock.releaseLock();
  }
}
