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
/* Compattazione delle tabelle figlie                                  */
/* ------------------------------------------------------------------ */

/**
 * Riporta sotto l'intestazione le righe di Quote e Pagamenti finite lontano
 * nel foglio, e chiude i buchi lasciati dalle cancellazioni.
 *
 * Serviva a rimediare a un difetto di accodaRighe_, che calcolava il punto di
 * inserimento con getLastRow(): su questi due fogli l'ARRAYFORMULA della
 * colonna `valida` lo gonfiava fino al fondo. Il difetto e' corretto, ma il
 * comando resta utile come manutenzione.
 *
 * Tocca solo le colonne A-C: la colonna calcolata resta dov'e'.
 * L'ordine delle righe e' irrilevante per i saldi, che sommano per id.
 */
function compattaTabelle() {
  var ui = SpreadsheetApp.getUi();
  var risposta = ui.alert('Compattare Quote e Pagamenti?',
    'Le righe vengono riscritte una sotto l\'altra a partire dalla riga 2.\n' +
    'Nessun dato viene perso: cambia solo la posizione delle righe.',
    ui.ButtonSet.YES_NO);
  if (risposta !== ui.Button.YES) return;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(LOCK_MS)) {
    ui.alert('Un\'altra scrittura e\' in corso. Riprova tra qualche secondo.');
    return;
  }

  try {
    var ss = SpreadsheetApp.getActive();
    var esito = [];

    [FOGLI.QUOTE, FOGLI.PAGAMENTI].forEach(function (nome) {
      var sh = ss.getSheetByName(nome);
      if (!sh || sh.getMaxRows() < 2) return;

      var altezza = sh.getMaxRows() - 1;
      var valori = sh.getRange(2, 1, altezza, 3).getValues();
      var buone = valori.filter(function (r) { return String(r[0]).trim() !== ''; });

      sh.getRange(2, 1, altezza, 3).clearContent();
      if (buone.length) sh.getRange(2, 1, buone.length, 3).setValues(buone);

      esito.push(nome + ': ' + buone.length + ' righe');
    });

    SpreadsheetApp.flush();
    var avviso = rigeneraProspettoSicuro_(ss);
    scriviLog_('COMPATTAZIONE', '', esito.join(' | '));
    ui.alert('Compattazione eseguita', esito.join('\n') +
      '\n\nControlla il foglio Saldi: i totali non devono essere cambiati.' +
      (avviso ? '\n\n' + avviso : ''),
      ui.ButtonSet.OK);

  } finally {
    lock.releaseLock();
  }
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

  /* --- ENTRATE: importi negativi --- */

  var tre = ['Socio1', 'Socio2', 'Socio3'];

  // Troncamento verso lo zero, non verso il basso.
  verifica('-100 tra 3', [-34, -33, -33],
    importi(calcolaQuote_(-100, 'UGUALE_TUTTI', tre, {}, 'Socio1')));

  verifica('-100,50 tra 3', [-34.5, -33, -33],
    importi(calcolaQuote_(-100.50, 'UGUALE_TUTTI', tre, {}, 'Socio1')));

  // La proprieta' che giustifica il troncamento verso lo zero:
  // un rimborso integrale deve annullare esattamente la spesa originaria.
  [100, 100.50, 2, 1234.56, 7, 999.99].forEach(function (v) {
    var pos = importi(calcolaQuote_(v, 'UGUALE_TUTTI', tre, {}, 'Socio1'));
    var neg = importi(calcolaQuote_(-v, 'UGUALE_TUTTI', tre, {}, 'Socio1'));
    var somme = pos.map(function (x, i) { return Math.round((x + neg[i]) * 100) / 100; });
    verifica('rimborso integrale di ' + v + ' azzera le quote', [0, 0, 0], somme);
  });

  // Entrata manuale che pareggia.
  verifica('entrata manuale', [-60, -40.5],
    importi(calcolaQuote_(-100.50, 'MANUALE', ['Socio1', 'Socio2'],
      { Socio1: -60, Socio2: -40.5 }, 'Socio1')));

  // Quota con segno opposto all'importo: deve fallire.
  try {
    calcolaQuote_(-100, 'MANUALE', ['Socio1', 'Socio2'],
      { Socio1: -150, Socio2: 50 }, 'Socio1');
    errori.push('quota di segno opposto: doveva fallire');
  } catch (e) { /* atteso */ }

  // Importo zero: deve fallire.
  try {
    calcolaQuote_(0, 'UGUALE_TUTTI', tre, {}, 'Socio1');
    errori.push('importo zero: doveva fallire');
  } catch (e) { /* atteso */ }

  // Incasso da un solo socio su un'entrata.
  var e1 = validaPagamenti_(-300, [{ pagante: 'Socio2', importo: -300 }]);
  verifica('incasso singolo', [-300], e1.map(function (x) { return x.importo; }));

  // Pagamento di segno opposto: deve fallire.
  try {
    validaPagamenti_(-300, [{ pagante: 'Socio2', importo: 300 }]);
    errori.push('pagamento di segno opposto: doveva fallire');
  } catch (e) { /* atteso */ }

  var esito = errori.length
    ? errori.length + ' test falliti:\n\n' + errori.join('\n\n')
    : 'Tutti i test passati.';
  Logger.log(esito);
  return esito;
}
