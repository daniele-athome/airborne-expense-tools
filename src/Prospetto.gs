/**
 * Prospetto.gs
 *
 * Vista denormalizzata sui dati normalizzati: una riga per movimento, due
 * colonne per socio (quota e pagato). E' la rappresentazione comoda da
 * leggere, non una seconda fonte di verita': il foglio viene riscritto per
 * intero a ogni rigenerazione e non va mai modificato a mano.
 *
 * La cassa ha una sola colonna, `pagato`: non puo' avere quote a suo carico.
 *
 * Perche' valori statici e non formule: una cella del prospetto e' "quota di
 * Socio2 nel movimento 17", cioe' un SUMIFS a due criteri, e SUMIFS non si
 * espande dentro ARRAYFORMULA. Servirebbe un blocco fisso di migliaia di
 * formule che ricalcolano a ogni tocco. Scrivere valori costa una lettura e
 * una scrittura, e non appesantisce il foglio.
 *
 * Il prezzo e' che la vista puo' invecchiare. Viene rigenerata a ogni
 * salvataggio, annullamento e compattazione, ma nessuna funzione intercetta
 * una modifica fatta a mano in Spese o Quote. Per questo la riga 1 porta un
 * timbro con data, numero di movimenti e totale degli importi, e un controllo
 * in Controlli confronta quei due numeri con i dati reali: se qualcuno edita
 * direttamente le tabelle, la riga diventa rossa.
 */

/** Righe di intestazione: nomi dei soci sopra, quota/pagato sotto. */
var PROSPETTO_INTESTAZIONI = 2;

/**
 * Colonne del timbro in riga 1. Il controllo "Prospetto non aggiornato" in
 * Setup.gs legge MOVIMENTI e TOTALE da qui con cella_(): spostare un valore
 * del timbro senza passare da questa tabella romperebbe il controllo.
 */
var COL_TIMBRO = { ETICHETTA: 1, DATA: 3, MOVIMENTI: 5, TOTALE: 7 };

/** Comando di menu. */
function aggiornaProspetto() {
  var ss = SpreadsheetApp.getActive();
  var n = rigeneraProspetto_(ss);
  ss.toast(n + ' movimenti nel prospetto.', 'Spese aereo', 5);
}

/**
 * Rigenerazione chiamata dopo una scrittura contabile gia' avvenuta.
 *
 * Non deve mai propagare un errore: la spesa a quel punto e' salvata, e
 * un'eccezione arriverebbe al client come salvataggio fallito, invitando a
 * riprovare e a registrare il movimento due volte. Un prospetto rimasto
 * vecchio invece lo segnala gia' il controllo sul timbro.
 *
 * @param {Spreadsheet=} ss
 * @return {string} avviso da mostrare all'utente, '' se tutto bene
 */
function rigeneraProspettoSicuro_(ss) {
  try {
    rigeneraProspetto_(ss);
    return '';
  } catch (e) {
    scriviLog_('ERRORE_PROSPETTO', '', String(e && e.message || e));
    return 'Dati salvati, ma il prospetto non e\' stato aggiornato: ' +
      'lancia "Aggiorna prospetto" dal menu.';
  }
}

/**
 * Riscrive il foglio Prospetto da capo.
 *
 * @param {Spreadsheet=} ss
 * @return {number} movimenti riportati
 */
function rigeneraProspetto_(ss) {
  ss = ss || SpreadsheetApp.getActive();

  var shSpese = ss.getSheetByName(FOGLI.SPESE);
  if (!shSpese) return 0;

  var cassa = String(leggiMeta_(META.NOME_CASSA)).trim();

  // Tutti i soci, anche i disattivati: le loro quote storiche restano nel
  // prospetto, altrimenti le righe vecchie non quadrerebbero piu'.
  var soci = leggiSoci_(false);
  var conQuota = soci.filter(function (s) { return s.id !== cassa; });
  var haCassa = soci.length !== conQuota.length;

  var movimenti = leggiMovimenti_(shSpese);
  var quote = indicizzaFiglie_(ss, FOGLI.QUOTE, COL.QUOTE.SOCIO, COL.QUOTE.IMPORTO);
  var pagamenti = indicizzaFiglie_(ss, FOGLI.PAGAMENTI,
                                   COL.PAGAMENTI.PAGANTE, COL.PAGAMENTI.IMPORTO);

  var fisse = INTESTAZIONI.SPESE.length;
  var larghezza = fisse + conQuota.length * 2 + (haCassa ? 1 : 0);

  var sh = preparaFoglio_(ss, larghezza,
                          movimenti.length + PROSPETTO_INTESTAZIONI);

  scriviIntestazioni_(sh, conQuota, haCassa, cassa, fisse, larghezza);

  var righe = movimenti.map(function (m) {
    var riga = m.valori.slice(0, fisse);
    while (riga.length < fisse) riga.push('');
    var q = quote[m.id] || {};
    var p = pagamenti[m.id] || {};
    conQuota.forEach(function (s) {
      riga.push(s.id in q ? q[s.id] : '');
      riga.push(s.id in p ? p[s.id] : '');
    });
    if (haCassa) riga.push(cassa in p ? p[cassa] : '');
    return riga;
  });

  if (righe.length) {
    sh.getRange(PROSPETTO_INTESTAZIONI + 1, 1, righe.length, larghezza)
      .setValues(righe);
  }

  timbra_(sh, movimenti);
  formatta_(sh, movimenti.length, fisse, larghezza);

  return movimenti.length;
}

/* ------------------------------------------------------------------ */
/* Lettura                                                             */
/* ------------------------------------------------------------------ */

/** Movimenti ordinati per data crescente, a parita' di data per id. */
function leggiMovimenti_(shSpese) {
  var ultima = ultimaRigaDati_(shSpese, COL.SPESE.ID);
  if (ultima < 2) return [];

  var valori = shSpese.getRange(2, 1, ultima - 1, INTESTAZIONI.SPESE.length).getValues();
  var out = [];
  for (var i = 0; i < valori.length; i++) {
    var id = valori[i][COL.SPESE.ID - 1];
    if (id === '' || id === null) continue;
    var d = valori[i][COL.SPESE.DATA - 1];
    out.push({
      id: Number(id),
      ordine: (d instanceof Date) ? d.getTime() : 0,
      importo: Number(valori[i][COL.SPESE.IMPORTO - 1]) || 0,
      valori: valori[i]
    });
  }
  out.sort(function (a, b) {
    return (a.ordine - b.ordine) || (a.id - b.id);
  });
  return out;
}

/**
 * Indicizza una tabella figlia: { id_spesa: { socio: importo } }.
 * Importi dello stesso socio sullo stesso movimento si sommano, cosi' una
 * tabella sporca non fa sparire righe dal prospetto senza accorgersene.
 */
function indicizzaFiglie_(ss, nomeFoglio, colSoggetto, colImporto) {
  var sh = ss.getSheetByName(nomeFoglio);
  var mappa = {};
  if (!sh) return mappa;

  var ultima = ultimaRigaDati_(sh, 1);
  if (ultima < 2) return mappa;

  var valori = sh.getRange(2, 1, ultima - 1, Math.max(colSoggetto, colImporto)).getValues();
  for (var i = 0; i < valori.length; i++) {
    var id = valori[i][0];
    if (id === '' || id === null) continue;
    var soggetto = String(valori[i][colSoggetto - 1]).trim();
    if (!soggetto) continue;
    if (!mappa[id]) mappa[id] = {};
    var v = Number(valori[i][colImporto - 1]) || 0;
    mappa[id][soggetto] = (mappa[id][soggetto] || 0) + v;
  }
  return mappa;
}

/* ------------------------------------------------------------------ */
/* Scrittura                                                           */
/* ------------------------------------------------------------------ */

/** Azzera il foglio e lo dimensiona, unioni comprese. */
function preparaFoglio_(ss, larghezza, altezza) {
  var sh = ss.getSheetByName(FOGLI.PROSPETTO) || ss.insertSheet(FOGLI.PROSPETTO);

  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.clearConditionalFormatRules();

  if (sh.getMaxColumns() < larghezza) {
    sh.insertColumnsAfter(sh.getMaxColumns(), larghezza - sh.getMaxColumns());
  }
  var minimo = Math.max(altezza, PROSPETTO_INTESTAZIONI + 1);
  if (sh.getMaxRows() < minimo) {
    sh.insertRowsAfter(sh.getMaxRows(), minimo - sh.getMaxRows());
  }
  return sh;
}

/** Riga 1: nomi dei soci a cavallo delle due colonne. Riga 2: le etichette. */
function scriviIntestazioni_(sh, conQuota, haCassa, cassa, fisse, larghezza) {
  sh.getRange(2, 1, 1, fisse).setValues([INTESTAZIONI.SPESE]);

  var c = fisse + 1;
  for (var i = 0; i < conQuota.length; i++) {
    sh.getRange(1, c, 1, 2).merge()
      .setValue(conQuota[i].nome)
      .setHorizontalAlignment('center');
    sh.getRange(2, c, 1, 2).setValues([['quota', 'pagato']]);
    c += 2;
  }
  if (haCassa) {
    sh.getRange(1, c).setValue(cassa);
    sh.getRange(2, c).setValue('pagato');
  }

  sh.getRange(1, fisse + 1, 1, larghezza - fisse)
    .setFontWeight('bold').setBackground('#dfe3e8');
  sh.getRange(2, 1, 1, larghezza)
    .setFontWeight('bold').setBackground('#eceff1');
}

/**
 * Timbro di rigenerazione. I due numeri non sono decorativi: il controllo
 * "Prospetto non aggiornato" li confronta con i dati reali di Spese.
 */
function timbra_(sh, movimenti) {
  var totale = movimenti.reduce(function (a, m) { return a + m.importo; }, 0);
  var larghezza = COL_TIMBRO.TOTALE;

  // Ogni valore preceduto dalla sua etichetta, nella cella a sinistra.
  var riga = [];
  for (var i = 0; i < larghezza; i++) riga.push('');
  riga[COL_TIMBRO.ETICHETTA - 1] = 'Prospetto';
  riga[COL_TIMBRO.DATA - 2]      = 'rigenerato il';
  riga[COL_TIMBRO.DATA - 1]      = new Date();
  riga[COL_TIMBRO.MOVIMENTI - 2] = 'movimenti';
  riga[COL_TIMBRO.MOVIMENTI - 1] = movimenti.length;
  riga[COL_TIMBRO.TOTALE - 2]    = 'totale importi';
  riga[COL_TIMBRO.TOTALE - 1]    = Math.round(totale * 100) / 100;

  sh.getRange(1, 1, 1, larghezza).setValues([riga]);
  sh.getRange(1, COL_TIMBRO.DATA).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(1, COL_TIMBRO.TOTALE).setNumberFormat('#,##0.00');
  sh.getRange(1, 1, 1, larghezza).setFontColor('#626d78').setBackground(null);
  sh.getRange(1, COL_TIMBRO.ETICHETTA).setFontWeight('bold').setFontColor('#1c2024');
}

function formatta_(sh, nRighe, fisse, larghezza) {
  var prima = PROSPETTO_INTESTAZIONI + 1;

  sh.setFrozenRows(PROSPETTO_INTESTAZIONI);
  sh.setFrozenColumns(COL.SPESE.DESCRIZIONE);   // id, data, tipo, descrizione

  sh.setColumnWidth(COL.SPESE.ID, 60);
  sh.setColumnWidth(COL.SPESE.DATA, 95);
  sh.setColumnWidth(COL.SPESE.TIPO, 85);
  sh.setColumnWidth(COL.SPESE.DESCRIZIONE, 280);
  sh.setColumnWidth(COL.SPESE.NOTE, 200);
  for (var c = fisse + 1; c <= larghezza; c++) sh.setColumnWidth(c, 85);

  if (!nRighe) return;

  sh.getRange(prima, COL.SPESE.DATA, nRighe, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(prima, COL.SPESE.IMPORTO, nRighe, 1).setNumberFormat('#,##0.00');
  sh.getRange(prima, fisse + 1, nRighe, larghezza - fisse)
    .setNumberFormat('#,##0.00');

  var statoRel = '$' + lettera_(COL.SPESE.STATO) + prima;
  var tipoRel  = '$' + lettera_(COL.SPESE.TIPO) + prima;
  var tutto = sh.getRange(prima, 1, nRighe, larghezza);

  sh.setConditionalFormatRules([
    // Gli annullati restano leggibili ma non rivendicano attenzione.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + statoRel + '="ANNULLATA"')
      .setFontColor('#9aa0a6').setRanges([tutto]).build(),
    // Prodotto di booleani invece di AND(a~b): la formula non ha argomenti
    // multipli e quindi non dipende dal separatore. Non e' un vezzo: questa
    // funzione gira a ogni salvataggio, e passare da f_() vorrebbe dire
    // creare e cancellare il foglio sonda di separatoreArgomenti_() ogni volta.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=(' + tipoRel + '="ENTRATA")*(' +
                            statoRel + '<>"ANNULLATA")=1')
      .setFontColor('#1b5e20').setRanges([tutto]).build()
  ]);

  proteggiConAvviso_(sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()),
    'Foglio calcolato: non modificare');
}
