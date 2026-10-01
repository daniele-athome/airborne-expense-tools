/**
 * Web.gs
 *
 * Interfaccia web per il telefono. L'app Google Sheets per Android non
 * esegue menu personalizzati, sidebar ne' dialog: il browser si'.
 *
 * Tre pagine, scelte dai parametri dell'URL:
 *
 *   /exec            elenco dei movimenti attivi (Elenco-page)
 *   /exec?id=17      modulo in modifica         (Sidebar-page)
 *   /exec?nuovo=1    modulo vuoto               (Sidebar-page)
 *
 * Pagine separate e non una pagina unica: il modulo della sidebar si riusa
 * senza toccarlo (si costruisce una volta sola e non sa reinizializzarsi su
 * un altro movimento), e il tasto indietro di Android funziona da solo.
 *
 * Il modulo e' lo stesso template della sidebar, cosi' anteprima delle quote
 * e chiamate al server restano una copia sola. Il salvataggio passa da
 * salvaSpesa(), con le stesse validazioni e lo stesso blocco sui movimenti
 * non modificabili (motivoBloccoModifica_).
 *
 * Il deployment esegue come l'utente che accede (appsscript.json, sezione
 * webapp): ogni socio scrive con i propri permessi sul foglio, e il Log
 * registra la sua email. Chi ha il link ma non il foglio condiviso in
 * modifica non riesce a leggere ne' a scrivere nulla.
 *
 * SpreadsheetApp.getActive() funziona anche qui: il binding dello script al
 * foglio e' statico e non dipende da un documento aperto. Niente openById():
 * farebbe decadere lo scope spreadsheets.currentonly.
 *
 * Nulla di cio' che parte da qui deve passare da SpreadsheetApp.getUi() o
 * da separatoreArgomenti_(): la prima non esiste fuori dal foglio, la
 * seconda crea e cancella un foglio di appoggio.
 */

function doGet(e) {
  var par = (e && e.parameter) || {};

  // La pagina gira in un iframe su un altro dominio: un link relativo non
  // tornerebbe alla web app. Serve l'URL completo del deployment.
  var url = ScriptApp.getService().getUrl();

  if (par.id) {
    var id = Number(par.id);
    if (!isFinite(id) || !trovaRigaSpesa_(id)) {
      return paginaElenco_(url, 'Movimento ' + par.id + ' non trovato.');
    }
    return paginaModulo_(url, id);
  }
  if (par.nuovo !== undefined) return paginaModulo_(url, null);
  return paginaElenco_(url, '');
}

function paginaModulo_(url, id) {
  var t = HtmlService.createTemplateFromFile('Sidebar-page');
  t.idSpesa = id ? String(id) : '';
  t.web = true;
  t.urlBase = url;
  return paginaWeb_(t, id ? 'Movimento ' + id : 'Nuovo movimento');
}

function paginaElenco_(url, avviso) {
  // 'Elenco-page': vedi la nota in Sidebar.gs sui nomi dei file.
  var t = HtmlService.createTemplateFromFile('Elenco-page');
  t.movimenti = elencoMovimenti_(url);
  t.urlNuovo = url + '?nuovo=1';
  t.avviso = avviso || '';
  return paginaWeb_(t, 'Movimenti');
}

function paginaWeb_(template, titolo) {
  return template.evaluate()
    .setTitle('Spese aereo - ' + titolo)
    // I meta tag scritti nel template vengono ignorati da HtmlService: il
    // viewport va dichiarato qui, altrimenti il telefono mostra la pagina
    // rimpicciolita come su uno schermo da desktop.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Movimenti attivi, dal piu' recente: per data, a parita' di data per id.
 * Gli annullati restano fuori per scelta: dal telefono non si riattivano, e
 * aprirli porterebbe solo a un modulo bloccato.
 *
 * Gli importi sono gia' formattati e sempre positivi: il segno delle ENTRATE
 * e' un dettaglio interno, nell'elenco lo dice `entrata`.
 *
 * @param {string} url  URL del deployment, per i link alle singole righe
 * @return {Array<{id: number, data: string, descrizione: string,
 *                 importo: string, entrata: boolean, link: string}>}
 */
function elencoMovimenti_(url) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(FOGLI.SPESE);
  var ultima = ultimaRigaDati_(sh, COL.SPESE.ID);
  if (ultima < 2) return [];

  var fuso = ss.getSpreadsheetTimeZone();
  var valori = sh.getRange(2, 1, ultima - 1, INTESTAZIONI.SPESE.length).getValues();
  var out = [];

  for (var i = 0; i < valori.length; i++) {
    var v = valori[i];
    var id = Number(v[COL.SPESE.ID - 1]);
    if (!v[COL.SPESE.ID - 1] || !isFinite(id)) continue;
    if (String(v[COL.SPESE.STATO - 1]) !== 'OK') continue;

    var d = v[COL.SPESE.DATA - 1];
    out.push({
      id: id,
      ordine: (d instanceof Date) ? d.getTime() : 0,
      data: (d instanceof Date) ? Utilities.formatDate(d, fuso, 'dd/MM/yyyy') : String(d || ''),
      descrizione: String(v[COL.SPESE.DESCRIZIONE - 1] || ''),
      importo: formattaEuro_(Math.abs(Number(v[COL.SPESE.IMPORTO - 1]) || 0)),
      entrata: String(v[COL.SPESE.TIPO - 1]) === 'ENTRATA',
      link: url + '?id=' + id
    });
  }

  out.sort(function (a, b) { return (b.ordine - a.ordine) || (b.id - a.id); });
  return out;
}

/** 1234.5 -> "1.234,50", indipendentemente dal locale del server. */
function formattaEuro_(n) {
  return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
