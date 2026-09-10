/**
 * Dati.gs
 *
 * Unico strato di accesso ai fogli. Tutto cio' che legge o scrive celle
 * passa da qui, cosi' la logica di ripartizione resta pura e testabile.
 */

/* ------------------------------------------------------------------ */
/* Metadati                                                            */
/* ------------------------------------------------------------------ */

/** Legge il valore associato a una chiave in Metadati. */
function leggiMeta_(chiave) {
  var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.METADATI);
  if (!sh || sh.getLastRow() < 2) return '';
  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < valori.length; i++) {
    if (String(valori[i][0]).trim() === chiave) return valori[i][1];
  }
  return '';
}

/** Configurazione usata dalla sidebar, letta una volta sola. */
function leggiConfigurazione_() {
  return {
    socioArrotondamento: String(leggiMeta_(META.SOCIO_ARROTONDAMENTO)).trim(),
    nomeCassa: String(leggiMeta_(META.NOME_CASSA)).trim(),
    dataMin: leggiMeta_(META.DATA_MIN)
  };
}

/* ------------------------------------------------------------------ */
/* Anagrafica                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {boolean} soloAttivi
 * @return {Array<{id: string, nome: string, attivo: boolean}>}
 */
function leggiSoci_(soloAttivi) {
  var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.ANAGRAFICA);
  if (!sh || sh.getLastRow() < 2) return [];
  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  var out = [];
  for (var i = 0; i < valori.length; i++) {
    var id = String(valori[i][0]).trim();
    if (!id) continue;
    var attivo = valori[i][2] === true || String(valori[i][2]).toUpperCase() === 'VERO' ||
                 String(valori[i][2]).toUpperCase() === 'TRUE';
    if (soloAttivi && !attivo) continue;
    out.push({ id: id, nome: String(valori[i][1]).trim() || id, attivo: attivo });
  }
  return out;
}

/** Insieme degli id socio validi, per le validazioni server side. */
function insiemeSoci_(soloAttivi) {
  var mappa = {};
  leggiSoci_(soloAttivi).forEach(function (s) { mappa[s.id] = s.nome; });
  return mappa;
}

/* ------------------------------------------------------------------ */
/* Spese                                                               */
/* ------------------------------------------------------------------ */

/**
 * Progressivo intero: MAX(id) + 1. Autoriparante, non lascia buchi se una
 * scrittura fallisce. Va invocato sotto lock.
 */
function prossimoIdSpesa_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.SPESE);
  if (sh.getLastRow() < 2) return 1;
  var valori = sh.getRange(2, COL.SPESE.ID, sh.getLastRow() - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < valori.length; i++) {
    var n = Number(valori[i][0]);
    if (isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Numero di riga della spesa, oppure 0 se non esiste. */
function trovaRigaSpesa_(id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.SPESE);
  if (sh.getLastRow() < 2) return 0;
  var valori = sh.getRange(2, COL.SPESE.ID, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < valori.length; i++) {
    if (Number(valori[i][0]) === Number(id)) return i + 2;
  }
  return 0;
}

/** Legge una spesa completa, con quote e pagamenti. */
function leggiSpesa_(id) {
  var ss = SpreadsheetApp.getActive();
  var riga = trovaRigaSpesa_(id);
  if (!riga) throw new Error('Spesa ' + id + ' non trovata.');

  var sh = ss.getSheetByName(FOGLI.SPESE);
  var v = sh.getRange(riga, 1, 1, INTESTAZIONI.SPESE.length).getValues()[0];

  return {
    id: Number(v[COL.SPESE.ID - 1]),
    data: formattaData_(v[COL.SPESE.DATA - 1]),
    descrizione: String(v[COL.SPESE.DESCRIZIONE - 1]),
    importo: Number(v[COL.SPESE.IMPORTO - 1]),
    criterio: String(v[COL.SPESE.CRITERIO - 1]),
    stato: String(v[COL.SPESE.STATO - 1]),
    note: String(v[COL.SPESE.NOTE - 1]),
    quote: leggiRigheFiglie_(FOGLI.QUOTE, id).map(function (r) {
      return { socio: String(r[COL.QUOTE.SOCIO - 1]), importo: Number(r[COL.QUOTE.IMPORTO - 1]) };
    }),
    pagamenti: leggiRigheFiglie_(FOGLI.PAGAMENTI, id).map(function (r) {
      return { pagante: String(r[COL.PAGAMENTI.PAGANTE - 1]), importo: Number(r[COL.PAGAMENTI.IMPORTO - 1]) };
    })
  };
}

/* ------------------------------------------------------------------ */
/* Righe figlie (Quote, Pagamenti)                                     */
/* ------------------------------------------------------------------ */

function leggiRigheFiglie_(nomeFoglio, id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(nomeFoglio);
  if (sh.getLastRow() < 2) return [];
  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  var out = [];
  for (var i = 0; i < valori.length; i++) {
    if (Number(valori[i][0]) === Number(id)) out.push(valori[i]);
  }
  return out;
}

/**
 * Cancella tutte le righe figlie di una spesa. In modifica si cancella e si
 * riscrive: applicare patch riga per riga lascerebbe quote fantasma quando
 * cambia l'insieme dei partecipanti.
 */
function eliminaRigheFiglie_(nomeFoglio, id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(nomeFoglio);
  if (sh.getLastRow() < 2) return 0;
  var valori = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var daEliminare = [];
  for (var i = 0; i < valori.length; i++) {
    if (Number(valori[i][0]) === Number(id)) daEliminare.push(i + 2);
  }
  // Dal basso verso l'alto, altrimenti gli indici scalano.
  for (var j = daEliminare.length - 1; j >= 0; j--) {
    sh.deleteRow(daEliminare[j]);
  }
  return daEliminare.length;
}

/** Accoda righe in fondo a un foglio, in un'unica scrittura. */
function accodaRighe_(nomeFoglio, righe) {
  if (!righe.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(nomeFoglio);
  var partenza = sh.getLastRow() + 1;
  sh.getRange(partenza, 1, righe.length, righe[0].length).setValues(righe);
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

function scriviLog_(azione, idSpesa, dettaglio) {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(FOGLI.LOG);
    if (!sh) return;
    var utente = '';
    try { utente = Session.getActiveUser().getEmail() || ''; } catch (e) { utente = ''; }
    sh.appendRow([new Date(), utente, azione, idSpesa || '', dettaglio || '']);
  } catch (e) {
    // Il log non deve mai far fallire un'operazione contabile.
  }
}

/* ------------------------------------------------------------------ */
/* Utilita'                                                            */
/* ------------------------------------------------------------------ */

/** Da valore di cella a stringa yyyy-mm-dd, per i campi date della sidebar. */
function formattaData_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '');
}

/** Da stringa yyyy-mm-dd a Date locale, senza slittamenti di fuso. */
function parsaData_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error('Data non valida: ' + s + ' (formato atteso aaaa-mm-gg).');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
