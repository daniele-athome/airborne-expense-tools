/**
 * Sidebar.gs
 *
 * Lato server della sidebar di inserimento spese.
 *
 * L'anteprima mostrata nel pannello e' calcolata nel browser solo per far
 * vedere il risultato mentre si compila. Al salvataggio il server ricalcola
 * tutto da zero a partire dai parametri grezzi e ignora i numeri arrivati
 * dal client.
 */

function apriSidebarNuova() {
  mostraSidebar_(null);
}

function apriSidebarModifica() {
  var id = idSpesaSelezionata_();
  if (!id) return;
  mostraSidebar_(id);
}

function mostraSidebar_(idSpesa) {
  // 'Sidebar-page' e non 'Sidebar': Apps Script non ammette due file con lo
  // stesso nome, nemmeno di estensione diversa, quindi Sidebar.gs e
  // Sidebar.html non potrebbero coesistere.
  var t = HtmlService.createTemplateFromFile('Sidebar-page');
  t.idSpesa = idSpesa || '';
  t.web = false;          // il template lo legge: una variabile assente lo farebbe fallire
  var html = t.evaluate()
    .setTitle(idSpesa ? 'Modifica spesa ' + idSpesa : 'Nuova spesa')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Ricava l'id_spesa dalla riga selezionata nel foglio Spese. */
function idSpesaSelezionata_() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getActiveSheet();
  var nome = sh.getName();
  if (nome !== FOGLI.SPESE && nome !== FOGLI.PROSPETTO) {
    ui.alert('Seleziona prima una riga nel foglio ' + FOGLI.PROSPETTO +
             ' o ' + FOGLI.SPESE + '.');
    return null;
  }
  // Nel Prospetto le intestazioni sono due righe, non una.
  var primaRiga = (nome === FOGLI.PROSPETTO) ? PROSPETTO_INTESTAZIONI + 1 : 2;
  var riga = sh.getActiveRange().getRow();
  if (riga < primaRiga) {
    ui.alert('Seleziona la riga del movimento, non l\'intestazione.');
    return null;
  }
  var id = sh.getRange(riga, COL.SPESE.ID).getValue();   // id_spesa in colonna A in entrambi
  if (!id) {
    ui.alert('La riga selezionata non contiene un id_spesa.');
    return null;
  }
  return Number(id);
}

/* ------------------------------------------------------------------ */
/* Chiamate dal client                                                 */
/* ------------------------------------------------------------------ */

/** Dati necessari a popolare il pannello. */
function getDatiIniziali(idSpesa) {
  var cfg = leggiConfigurazione_();
  var soci = leggiSoci_(true);

  var partecipabili = soci.filter(function (s) { return s.id !== cfg.nomeCassa; });

  var out = {
    criteri: CRITERI,
    tipi: TIPI,
    socioArrotondamento: cfg.socioArrotondamento,
    nomeCassa: cfg.nomeCassa,
    oggi: formattaData_(new Date()),
    soci: partecipabili,          // possono avere quote
    paganti: soci,                // possono pagare, cassa compresa
    spesa: null
  };

  if (idSpesa) out.spesa = leggiSpesa_(Number(idSpesa));
  return out;
}

/**
 * Scrive una spesa completa: quote, pagamenti e testata.
 *
 * Ordine di scrittura per una spesa nuova: prima le righe figlie, la testata
 * per ultima. Se lo script si interrompe a meta', restano righe orfane che i
 * Controlli segnalano e che non entrano nei saldi. L'ordine inverso
 * produrrebbe una spesa con quote incomplete: saldi sbagliati in silenzio.
 */
function salvaSpesa(payload) {
  var lock = lockScritture_();
  if (!lock.tryLock(LOCK_MS)) {
    throw new Error('Un\'altra scrittura e\' in corso. Riprova tra qualche secondo.');
  }

  try {
    var cfg = leggiConfigurazione_();
    var p = normalizzaPayload_(payload, cfg);

    var risultato = calcolaQuote_(p.importo, p.criterio, p.partecipanti,
                                  p.manuali, cfg.socioArrotondamento);
    var quote = risultato.quote;
    var pagamenti = validaPagamenti_(p.importo, p.pagamenti);

    var ss = SpreadsheetApp.getActive();
    var shSpese = ss.getSheetByName(FOGLI.SPESE);
    var modifica = !!p.id;
    var id, rigaTestata;

    if (modifica) {
      rigaTestata = trovaRigaSpesa_(p.id);
      if (!rigaTestata) throw new Error('Spesa ' + p.id + ' non trovata.');
      id = p.id;
      eliminaRigheFiglie_(FOGLI.QUOTE, id);
      eliminaRigheFiglie_(FOGLI.PAGAMENTI, id);
    } else {
      id = prossimoIdSpesa_();
    }

    // Tre colonne soltanto: la quarta, `valida`, appartiene all'ARRAYFORMULA.
    accodaRighe_(FOGLI.QUOTE, quote.map(function (q) {
      return [id, q.socio, q.importo];
    }));
    accodaRighe_(FOGLI.PAGAMENTI, pagamenti.map(function (x) {
      return [id, x.pagante, x.importo];
    }));

    var testata = [id, parsaData_(p.data), p.tipo, p.descrizione, p.importo,
                   p.criterio, 'OK', p.note];

    if (modifica) {
      shSpese.getRange(rigaTestata, 1, 1, testata.length).setValues([testata]);
    } else {
      var riga = ultimaRigaDati_(shSpese, COL.SPESE.ID) + 1;
      if (riga > shSpese.getMaxRows()) {
        shSpese.insertRowsAfter(shSpese.getMaxRows(), 1);
      }
      shSpese.getRange(riga, 1, 1, testata.length).setValues([testata]);
    }

    var avvisoProspetto = rigeneraProspettoSicuro_(ss);

    scriviLog_(modifica ? 'MODIFICA' : 'INSERIMENTO', id,
      p.descrizione + ' | ' + p.importo.toFixed(2) + ' | ' + p.criterio +
      ' | quote: ' + quote.length + ' | paganti: ' + pagamenti.length);

    return {
      id: id,
      modifica: modifica,
      quote: quote,
      avvisi: risultato.avvisi.concat(avvisoProspetto ? [avvisoProspetto] : [])
    };

  } finally {
    lock.releaseLock();
  }
}

/** Ripristina le colonne calcolate se qualcuno le ha sovrascritte a mano. */
function ripristinaColonneCalcolate() {
  var ss = SpreadsheetApp.getActive();
  costruisciQuote_(ss);
  costruisciPagamenti_(ss);
  ss.toast('Colonne "valida" ripristinate.', 'Spese aereo', 5);
}

/* ------------------------------------------------------------------ */
/* Annullamento                                                        */
/* ------------------------------------------------------------------ */

/**
 * Annullare significa mettere stato = ANNULLATA, mai cancellare righe.
 * La colonna calcolata "valida" esclude subito quote e pagamenti dai saldi,
 * ma la spesa resta leggibile e il progressivo non si buca.
 */
function annullaSpesaSelezionata() {
  var id = idSpesaSelezionata_();
  if (!id) return;

  var ui = SpreadsheetApp.getUi();
  var spesa = leggiSpesa_(id);

  if (spesa.stato === 'ANNULLATA') {
    var ripristina = ui.alert('La spesa ' + id + ' e\' gia\' annullata. Vuoi riattivarla?',
      ui.ButtonSet.YES_NO);
    if (ripristina !== ui.Button.YES) return;
    var avvisoR = impostaStatoSpesa_(id, 'OK');
    scriviLog_('RIATTIVAZIONE', id, spesa.descrizione);
    SpreadsheetApp.getActive().toast('Spesa ' + id + ' riattivata.' +
      (avvisoR ? ' ' + avvisoR : ''), 'Spese aereo', avvisoR ? 15 : 5);
    return;
  }

  var risposta = ui.alert('Annullare la spesa ' + id + '?',
    spesa.descrizione + '\nImporto: ' + Number(spesa.importo).toFixed(2) +
    '\n\nLe righe non vengono cancellate: la spesa esce dai saldi e resta a storico.',
    ui.ButtonSet.YES_NO);
  if (risposta !== ui.Button.YES) return;

  var avvisoA = impostaStatoSpesa_(id, 'ANNULLATA');
  scriviLog_('ANNULLAMENTO', id, spesa.descrizione);
  SpreadsheetApp.getActive().toast('Spesa ' + id + ' annullata.' +
    (avvisoA ? ' ' + avvisoA : ''), 'Spese aereo', avvisoA ? 15 : 5);
}

/** @return {string} avviso sul prospetto, '' se rigenerato senza errori */
function impostaStatoSpesa_(id, stato) {
  var riga = trovaRigaSpesa_(id);
  if (!riga) throw new Error('Movimento ' + id + ' non trovato.');
  SpreadsheetApp.getActive().getSheetByName(FOGLI.SPESE)
    .getRange(riga, COL.SPESE.STATO).setValue(stato);
  return rigeneraProspettoSicuro_();
}

/* ------------------------------------------------------------------ */
/* Normalizzazione e validazione del payload                           */
/* ------------------------------------------------------------------ */

/**
 * Non ci si fida mai di cio' che arriva dal browser: qui si ricontrolla
 * tutto e si riordinano i partecipanti secondo l'ordine di Anagrafica, cosi'
 * il destinatario di ripiego dell'arrotondamento e' deterministico.
 */
function normalizzaPayload_(payload, cfg) {
  if (!payload) throw new Error('Nessun dato ricevuto.');

  var attivi = insiemeSoci_(true);
  var ordine = leggiSoci_(true).map(function (s) { return s.id; });

  var tipo = String(payload.tipo || 'SPESA');
  if (TIPI.indexOf(tipo) === -1) throw new Error('Tipo non valido: ' + tipo);

  // Dalla sidebar l'importo arriva sempre positivo: il segno lo determina il
  // tipo. Memorizzare le ENTRATE in negativo e' cio' che permette a quote e
  // pagamenti di usare la stessa aritmetica delle spese, e a un rimborso
  // integrale di annullare esattamente la spesa che rimborsa.
  var digitato = Number(payload.importo);
  if (!isFinite(digitato) || digitato <= 0) {
    throw new Error('Inserisci un importo maggiore di zero.');
  }
  var segno = (tipo === 'ENTRATA') ? -1 : 1;
  var importo = segno * digitato;

  var descrizione = String(payload.descrizione || '').trim();
  if (!descrizione) throw new Error('Inserisci una descrizione.');

  var data = parsaData_(payload.data);
  if (cfg.dataMin instanceof Date && data < cfg.dataMin) {
    throw new Error('La data e\' precedente a data_min (' +
      formattaData_(cfg.dataMin) + ').');
  }

  var criterio = String(payload.criterio || '');
  if (CRITERI.indexOf(criterio) === -1) {
    throw new Error('Criterio non valido.');
  }

  var partecipanti = (payload.partecipanti || []).map(String);
  partecipanti.forEach(function (s) {
    if (!attivi[s]) throw new Error('Socio inesistente o non attivo: ' + s);
    if (s === cfg.nomeCassa) {
      throw new Error('La cassa non puo\' avere quote a suo carico: puo\' solo pagare o incassare.');
    }
  });
  // Riordino secondo Anagrafica.
  partecipanti = ordine.filter(function (id) { return partecipanti.indexOf(id) !== -1; });
  if (!partecipanti.length) throw new Error('Seleziona almeno un partecipante.');

  var pagamenti = (payload.pagamenti || [])
    .filter(function (p) { return p && p.pagante; })
    .map(function (p) {
      if (!attivi[p.pagante]) {
        throw new Error('Pagante inesistente o non attivo: ' + p.pagante);
      }
      return { pagante: String(p.pagante), importo: segno * Number(p.importo) };
    });

  var manuali = {};
  var grezzi = payload.manuali || {};
  for (var k in grezzi) {
    if (grezzi[k] === '' || grezzi[k] === null || grezzi[k] === undefined) continue;
    manuali[k] = segno * Number(grezzi[k]);
  }

  return {
    id: payload.id ? Number(payload.id) : null,
    data: payload.data,
    tipo: tipo,
    descrizione: descrizione,
    importo: importo,
    criterio: criterio,
    note: String(payload.note || '').trim(),
    partecipanti: partecipanti,
    manuali: manuali,
    pagamenti: pagamenti
  };
}
