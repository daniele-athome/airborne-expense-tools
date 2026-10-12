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

  var lock = lockScritture_();
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

  // Resto di un centesimo al socio configurato.
  verifica('100 tra 3', [33.34, 33.33, 33.33],
    importi(calcolaQuote_(100, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Importo con decimali che si divide esatto: nessun resto, quote tutte uguali.
  verifica('100,50 tra 3', [33.5, 33.5, 33.5],
    importi(calcolaQuote_(100.50, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Importo con decimali e resto: solo il centesimo in eccesso si sposta.
  verifica('100,51 tra 3', [33.51, 33.5, 33.5],
    importi(calcolaQuote_(100.51, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

  // Il socio di arrotondamento non e' il primo dell'elenco.
  verifica('100 tra 3, resto a Socio2', [33.33, 33.34, 33.33],
    importi(calcolaQuote_(100, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio2')));

  // Selezione parziale.
  verifica('100,01 tra 2', [50.01, 50],
    importi(calcolaQuote_(100.01, 'UGUALE_SELEZIONE', ['Socio1', 'Socio3'], {}, 'Socio1')));

  // Il socio di arrotondamento non partecipa: ripiego sul primo, con avviso.
  var r = calcolaQuote_(100.01, 'UGUALE_SELEZIONE', ['Socio2', 'Socio3'], {}, 'Socio1');
  verifica('ripiego arrotondamento', [50.01, 50], importi(r));
  if (!r.avvisi.length) errori.push('ripiego arrotondamento: manca l\'avviso');

  // Importo inferiore al numero di partecipanti: base zero, tutto al resto.
  verifica('0,02 tra 3', [0.02, 0, 0],
    importi(calcolaQuote_(0.02, 'UGUALE_TUTTI', ['Socio1', 'Socio2', 'Socio3'], {}, 'Socio1')));

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
  verifica('-100 tra 3', [-33.34, -33.33, -33.33],
    importi(calcolaQuote_(-100, 'UGUALE_TUTTI', tre, {}, 'Socio1')));

  verifica('-100,51 tra 3', [-33.51, -33.5, -33.5],
    importi(calcolaQuote_(-100.51, 'UGUALE_TUTTI', tre, {}, 'Socio1')));

  // La proprieta' che giustifica il troncamento verso lo zero:
  // un rimborso integrale deve annullare esattamente la spesa originaria.
  [100, 100.50, 100.51, 0.02, 2, 1234.56, 7, 999.99].forEach(function (v) {
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

/* ------------------------------------------------------------------ */
/* Autotest della composizione dei debiti                              */
/* ------------------------------------------------------------------ */

/**
 * Da lanciare dall'editor di Apps Script dopo aver toccato Composizione.gs.
 * Non tocca il foglio: aggregaDebiti_() e' logica pura.
 *
 * La proprieta' che conta e' una sola: per ogni socio a debito,
 * pagato - dovuto + giroconti deve fare il saldo che sta nel foglio Saldi.
 * Tutto il resto (chi entra in pagina, dove si piega l'elenco) e' impaginazione.
 */
function testComposizione() {
  var errori = [];

  function verifica(nome, atteso, ottenuto) {
    var a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
    if (a !== o) errori.push(nome + '\n  atteso:   ' + a + '\n  ottenuto: ' + o);
  }

  /*
   * Scenario: quattro soci e la cassa, con un conguaglio chiuso il 25/06 e
   * movimenti successivi. Gli importi sono quelli del mockup, scelti perche'
   * i saldi fanno zero e il greedy produce quattro bonifici.
   *
   *   D +2180   M +414   L -1527   G -859   CASSA -208
   */
  var mov = [
    { id: 1, giorno: '2026-06-20', tipo: 'SPESA',   descrizione: 'Hangar',        importo: 900,  criterio: 'UGUALE_TUTTI', stato: 'OK' },
    { id: 2, giorno: '2026-07-05', tipo: 'SPESA',   descrizione: 'Carburante',    importo: 546,  criterio: 'UGUALE_SELEZIONE', stato: 'OK' },
    { id: 3, giorno: '2026-07-18', tipo: 'SPESA',   descrizione: 'Assicurazione', importo: 2400, criterio: 'UGUALE_TUTTI', stato: 'OK' },
    { id: 4, giorno: '2026-08-02', tipo: 'SPESA',   descrizione: 'Revisione',     importo: 1180, criterio: 'UGUALE_TUTTI', stato: 'OK' },
    { id: 5, giorno: '2026-08-19', tipo: 'SPESA',   descrizione: 'Olio',          importo: 164,  criterio: 'UGUALE_TUTTI', stato: 'OK' },
    { id: 6, giorno: '2026-09-06', tipo: 'ENTRATA', descrizione: 'Rimborso',      importo: -800, criterio: 'UGUALE_TUTTI', stato: 'OK' },
    { id: 7, giorno: '2026-09-21', tipo: 'SPESA',   descrizione: 'Tassa',         importo: 528,  criterio: 'UGUALE_TUTTI', stato: 'OK' },
    { id: 8, giorno: '2026-10-04', tipo: 'SPESA',   descrizione: 'Carburante',    importo: 468,  criterio: 'UGUALE_SELEZIONE', stato: 'OK' },
    // Annullato: non deve comparire ne' entrare nei totali.
    { id: 9, giorno: '2026-10-05', tipo: 'SPESA',   descrizione: 'Annullata',     importo: 400,  criterio: 'UGUALE_TUTTI', stato: 'ANNULLATA' }
  ];
  var quote = {
    1: { D: 225, M: 225, L: 225, G: 225 },
    2: { D: 273, M: 273 },
    3: { D: 600, M: 600, L: 600, G: 600 },
    4: { D: 295, M: 295, L: 295, G: 295 },
    5: { D: 41,  M: 41,  L: 41,  G: 41 },
    6: { D: -200, M: -200, L: -200, G: -200 },
    7: { D: 132, M: 132, L: 132, G: 132 },
    8: { L: 234, G: 234 },
    9: { D: 100, M: 100, L: 100, G: 100 }
  };
  var pagamenti = {
    1: { CASSA: 900 },
    2: { D: 546 },
    3: { D: 2400 },
    4: { M: 1180 },
    5: { CASSA: 164 },
    6: { L: -800 },
    7: { CASSA: 528 },
    8: { G: 468 },
    9: { D: 400 }
  };
  var giroconti = [
    { giorno: '2026-06-25', da: 'D', a: 'CASSA', importo: 600, causale: 'Versamento' },
    { giorno: '2026-06-25', da: 'M', a: 'CASSA', importo: 600, causale: 'Versamento' },
    { giorno: '2026-09-02', da: 'L', a: 'CASSA', importo: 600, causale: 'Versamento' }
  ];
  var saldi = [
    { id: 'D', nome: 'Daniele', saldo: 2180 },
    { id: 'M', nome: 'Marco',   saldo: 414 },
    { id: 'L', nome: 'Luca',    saldo: -1527 },
    { id: 'G', nome: 'Giulia',  saldo: -859 },
    { id: 'CASSA', nome: 'Cassa comune', saldo: -208 }
  ];
  var bonifici = [
    { da: 'L', daNome: 'Luca',   a: 'D', aNome: 'Daniele', importo: 1527 },
    { da: 'G', daNome: 'Giulia', a: 'D', aNome: 'Daniele', importo: 653 },
    { da: 'G', daNome: 'Giulia', a: 'M', aNome: 'Marco',   importo: 206 },
    { da: 'CASSA', daNome: 'Cassa comune', a: 'M', aNome: 'Marco', importo: 208 }
  ];

  var dati = {
    cassa: 'CASSA', saldi: saldi, bonifici: bonifici, sbilancio: 0, totale: 2594,
    movimenti: mov, quote: quote, pagamenti: pagamenti, giroconti: giroconti
  };

  var r = aggregaDebiti_(dati);

  // In pagina solo i soci a debito, dal piu' esposto. La cassa e' a debito
  // (il suo saldo e' l'opposto della giacenza) ma non e' un socio.
  verifica('solo i debitori, in ordine di debito', ['Luca', 'Giulia'],
    r.debitori.map(function (x) { return x.nome; }));

  // La controprova e' la ragione d'essere del test.
  r.debitori.forEach(function (x) {
    verifica('il conto di ' + x.nome + ' fa il saldo', true, x.quadra);
    verifica('somma delle voci di ' + x.nome, x.saldo,
      Math.round((x.pagato - x.dovuto + x.giroconti) * 100) / 100);
  });

  var luca = r.debitori[0], giulia = r.debitori[1];

  verifica('dovuto di Luca', 1327, luca.dovuto);
  verifica('pagato di Luca', -800, luca.pagato);
  verifica('giroconti di Luca', 600, luca.giroconti);
  verifica('dovuto di Giulia', 1327, giulia.dovuto);
  verifica('pagato di Giulia', 468, giulia.pagato);
  verifica('giroconti di Giulia', 0, giulia.giroconti);

  // Il movimento annullato resta fuori da tutto.
  verifica('movimenti nel dovuto di Luca', 7, luca.nQuote);
  verifica('nessuna riga dal movimento annullato', [],
    luca.quoteRecenti.concat(luca.quotePrecedenti)
      .filter(function (q) { return q.descrizione === 'Annullata'; }));

  // La piega: ultimo giroconto del socio, in qualunque ruolo.
  verifica('piega di Luca', '2026-09-02', luca.piega);
  verifica('elenco di Luca dal piu recente',
    ['2026-10-04', '2026-09-21', '2026-09-06'],
    luca.quoteRecenti.map(function (q) { return q.giorno; }));
  verifica('ripiegati di Luca', 4, luca.quotePrecedenti.length);

  // Senza giroconti non c'e' una piega: l'elenco e' tutto aperto.
  verifica('Giulia non ha piega', '', giulia.piega);
  verifica('Giulia non ha movimenti ripiegati', 0, giulia.quotePrecedenti.length);
  verifica('Giulia ha tutto in elenco', 7, giulia.quoteRecenti.length);

  // Una spesa datata il giorno stesso della piega sta sopra la piega, non
  // sotto: altrimenti una spesa registrata il giorno del conguaglio
  // sparirebbe dalla parte in evidenza.
  var conStessoGiorno = {
    cassa: 'CASSA',
    saldi: [{ id: 'A', nome: 'A', saldo: -50 }],
    bonifici: [], sbilancio: 0, totale: 0,
    movimenti: [{ id: 1, giorno: '2026-09-02', tipo: 'SPESA', descrizione: 'Stesso giorno',
                  importo: 50, criterio: 'UGUALE_TUTTI', stato: 'OK' }],
    quote: { 1: { A: 50 } },
    pagamenti: {},
    giroconti: [{ giorno: '2026-09-02', da: 'A', a: 'CASSA', importo: 0, causale: '' }]
  };
  var sg = aggregaDebiti_(conStessoGiorno).debitori[0];
  verifica('spesa dello stesso giorno sopra la piega', 1, sg.quoteRecenti.length);
  verifica('spesa dello stesso giorno non ripiegata', 0, sg.quotePrecedenti.length);

  // Un saldo nullo con residuo di virgola mobile non e' un debito.
  var residuo = aggregaDebiti_({
    cassa: 'CASSA',
    saldi: [{ id: 'A', nome: 'A', saldo: -1.4e-11 }],
    bonifici: [], sbilancio: 0, totale: 0,
    movimenti: [], quote: {}, pagamenti: {}, giroconti: []
  });
  verifica('saldo a zero con residuo non entra in pagina', 0, residuo.debitori.length);

  // I bonifici del socio: sono cosa deve fare, e vengono dal conguaglio.
  verifica('bonifici di Giulia', [['Daniele', 653], ['Marco', 206]],
    giulia.bonifici.map(function (b) { return [b.aNome, b.importo]; }));

  verifica('elenco di uno', 'a', elenco_(['a']));
  verifica('elenco di due', 'a e b', elenco_(['a', 'b']));
  verifica('elenco di tre', 'a, b e c', elenco_(['a', 'b', 'c']));

  verifica('data italiana', '04/10/2026', dataItaliana_('2026-10-04'));
  verifica('data vuota', '', dataItaliana_(''));

  var esito = errori.length
    ? errori.length + ' test falliti:\n\n' + errori.join('\n\n')
    : 'Tutti i test passati.';
  Logger.log(esito);
  return esito;
}
