/**
 * Web.gs
 *
 * Interfaccia web per il telefono. L'app Google Sheets per Android non
 * esegue menu personalizzati, sidebar ne' dialog: il browser si'.
 *
 * Serve lo stesso template della sidebar (Sidebar-page), cosi' modulo,
 * anteprima delle quote e chiamate al server restano una copia sola. Il
 * salvataggio passa da salvaSpesa(), con le stesse validazioni lato server.
 *
 * Solo inserimento di movimenti nuovi: modifica e annullamento restano nel
 * foglio, dove si selezionano con la riga. Per questo doGet() ignora ogni
 * parametro, e in particolare non accetta un id_spesa.
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

function doGet() {
  var t = HtmlService.createTemplateFromFile('Sidebar-page');
  t.idSpesa = '';
  t.web = true;
  return t.evaluate()
    .setTitle('Spese aereo - nuovo movimento')
    // I meta tag scritti nel template vengono ignorati da HtmlService: il
    // viewport va dichiarato qui, altrimenti il telefono mostra la pagina
    // rimpicciolita come su uno schermo da desktop.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
