/**
 * Validazioni.gs
 *
 * Il foglio Controlli e' sempre vivo: le formule ricalcolano da sole. Questa
 * funzione serve solo a leggerlo e a mostrarne l'esito in una finestra, per
 * chi non ha voglia di andarci a guardare.
 */

function verificaIntegrita() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.CONTROLLI);
  if (!sh || sh.getLastRow() < 2) {
    ui.alert('Il foglio Controlli non esiste ancora. Lancia "Ricostruisci struttura".');
    return;
  }

  SpreadsheetApp.flush();
  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var problemi = [];
  var illeggibili = [];

  for (var i = 0; i < valori.length; i++) {
    var descrizione = String(valori[i][0]).trim();
    if (!descrizione) continue;
    var n = Number(valori[i][1]);
    if (!isFinite(n)) { illeggibili.push(descrizione); continue; }
    if (n > 0) problemi.push('- ' + descrizione + ': ' + n);
  }

  var testo = '';
  if (!problemi.length && !illeggibili.length) {
    testo = 'Nessuna anomalia. Quote e pagamenti pareggiano, i saldi sono coerenti.';
  } else {
    if (problemi.length) {
      testo += 'Anomalie rilevate:\n\n' + problemi.join('\n') +
        '\n\nNel foglio Controlli, a destra, trovi l\'elenco delle spese che non pareggiano.';
    }
    if (illeggibili.length) {
      testo += (testo ? '\n\n' : '') +
        'Controlli in errore (formula non calcolabile):\n- ' + illeggibili.join('\n- ');
    }
  }

  ui.alert('Verifica integrita', testo, ui.ButtonSet.OK);
}

/* ------------------------------------------------------------------ */
/* Autotest della logica di ripartizione                               */
/* ------------------------------------------------------------------ */

/**
 * Da lanciare dall'editor di Apps Script dopo aver toccato Ripartizione.gs.
 * Non tocca il foglio: verifica solo il calcolo delle quote.
 */
function testRipartizione() {
  var errori = [];

  function verifica(nome, atteso, ottenuto) {
    var a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
    if (a !== o) errori.push(nome + '\n  atteso:   ' + a + '\n  ottenuto: ' + o);
  }

  function importi(r) {
    return r.quote.map(function (q) { return q.importo; });
  }

  // Divisione esatta.
  verifica('90 tra 3', [30, 30, 30],
    importi(calcolaQuote_(90, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Resto di un euro al socio configurato.
  verifica('100 tra 3', [34, 33, 33],
    importi(calcolaQuote_(100, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Parte decimale interamente al socio configurato.
  verifica('100,50 tra 3', [34.5, 33, 33],
    importi(calcolaQuote_(100.50, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Il socio di arrotondamento non e' il primo dell'elenco.
  verifica('100 tra 3, resto a Socio2', [33, 34, 33],
    importi(calcolaQuote_(100, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio2')));

  // Selezione parziale.
  verifica('101 tra 2', [51, 50],
    importi(calcolaQuote_(101, 'UGUALE_SELEZIONE', ['Socio1', 'Socio3'], {}, 'Socio1')));

  // Il socio di arrotondamento non partecipa: ripiego sul primo, con avviso.
  var r = calcolaQuote_(101, 'UGUALE_SELEZIONE', ['Socio2', 'Socio3'], {}, 'Socio1');
  verifica('ripiego arrotondamento', [51, 50], importi(r));
  if (!r.avvisi.length) errori.push('ripiego arrotondamento: manca l\'avviso');

  // Importo inferiore al numero di partecipanti: base zero, tutto al resto.
  verifica('2 tra 3', [2, 0, 0],
    importi(calcolaQuote_(2, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Manuale che pareggia.
  verifica('manuale ok', [60, 40.5],
    importi(calcolaQuote_(100.50, 'MANUALE', ['Socio1', 'Socio2'],
      { Socio1: 60, Socio2: 40.5 }, 'Socio1')));

  // Manuale che non pareggia: deve fallire.
  try {
    calcolaQuote_(100, 'MANUALE', ['Socio1', 'Socio2'], { Socio1: 60, Socio2: 30 }, 'Socio1');
    errori.push('manuale sbilanciato: doveva fallire');
  } catch (e) { /* atteso */ }

  // Importo non positivo: deve fallire.
  try {
    calcolaQuote_(0, 'UGUALE_TUTTI', ['Socio1'], {}, 'Socio1');
    errori.push('importo zero: doveva fallire');
  } catch (e) { /* atteso */ }

  // Pagamenti che non pareggiano: deve fallire.
  try {
    validaPagamenti_(100, [{ pagante: 'Socio1', importo: 90 }]);
    errori.push('pagamenti sbilanciati: doveva fallire');
  } catch (e) { /* atteso */ }

  // Pagamenti multipli corretti.
  var p = validaPagamenti_(100.50, [
    { pagante: 'CASSA', importo: 60 },
    { pagante: 'Socio2', importo: 40.5 }
  ]);
  verifica('pagamenti multipli', [60, 40.5], p.map(function (x) { return x.importo; }));

  var esito = errori.length
    ? errori.length + ' test falliti:\n\n' + errori.join('\n\n')
    : 'Tutti i test passati.';
  Logger.log(esito);
  return esito;
}
