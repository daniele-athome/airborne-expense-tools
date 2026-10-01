/**
 * Setup.gs
 *
 * Costruisce l'intera struttura del foglio. E' idempotente: puo' essere
 * rilanciato in qualunque momento. I fogli di dati vengono creati se mancano,
 * ma il loro contenuto non viene mai toccato; intestazioni, convalide,
 * formattazione e formule derivate vengono sempre riscritte.
 *
 * I fogli interamente derivati (Saldi, Controlli) vengono rigenerati da zero.
 *
 * SEPARATORE DELLE FORMULE
 * Google Sheets non normalizza le formule scritte via script: vanno espresse
 * nella notazione del locale del foglio. Nei locali che usano la virgola come
 * separatore decimale (it_IT fra questi) il separatore di argomenti e' il
 * punto e virgola.
 *
 * Tutte le formule qui dentro usano il segnaposto ~ al posto del separatore e
 * passano da f_() prima di essere scritte. Il separatore non viene dedotto da
 * una tabella di locali ma chiesto a Sheets, con una formula sonda.
 *
 * Per lo stesso motivo qui non si usano array letterali {a,b,c}: anche il loro
 * separatore di colonna cambia col locale.
 *
 * RIFERIMENTI DI COLONNA
 * Le formule non contengono lettere di colonna scritte a mano: si ricavano da
 * COL con colonna_(). Aggiungere una colonna a una tabella e' successo una
 * volta (tipo in Spese) e ha toccato una dozzina di formule sparse; cosi' ne
 * tocca zero.
 */

/* ------------------------------------------------------------------ */
/* Separatore di argomenti                                             */
/* ------------------------------------------------------------------ */

/** Cache per l'esecuzione corrente. Null finche' non e' stato determinato. */
var SEPARATORE = null;

/**
 * Chiede a Sheets quale separatore accetta, invece di dedurlo dal locale.
 *
 * Scrive =SUM(1,2) in un foglio di appoggio: dove la virgola separa gli
 * argomenti il risultato e' 3, dove invece e' il separatore decimale la
 * formula vale SUM(1.2) e restituisce 1,2. Il foglio di appoggio viene
 * rimosso subito.
 */
function separatoreArgomenti_() {
  if (SEPARATORE) return SEPARATORE;

  var ss = SpreadsheetApp.getActive();
  var nome = '__sonda_separatore__';
  var vecchio = ss.getSheetByName(nome);
  if (vecchio) ss.deleteSheet(vecchio);

  var attivo = ss.getActiveSheet();
  var sonda = ss.insertSheet(nome);
  try {
    sonda.getRange(1, 1).setFormula('=SUM(1,2)');
    SpreadsheetApp.flush();
    SEPARATORE = (sonda.getRange(1, 1).getValue() === 3) ? ',' : ';';
  } finally {
    ss.deleteSheet(sonda);
    if (attivo) ss.setActiveSheet(attivo);
  }
  return SEPARATORE;
}

/** Traduce il segnaposto ~ nel separatore di argomenti del foglio. */
function f_(formula) {
  return formula.split('~').join(separatoreArgomenti_());
}

/* ------------------------------------------------------------------ */
/* Riferimenti di colonna                                              */
/* ------------------------------------------------------------------ */

/** Indice di colonna 1-based -> lettera A1 (1 -> A, 27 -> AA). */
function lettera_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
}

/** Riferimento assoluto alla colonna dati di un foglio: Spese!$E$2:$E */
function colonna_(foglio, indice) {
  var L = lettera_(indice);
  return foglio + '!$' + L + '$2:$' + L;
}

/** Riferimento assoluto a una cella: Quote!$D$2 */
function cella_(foglio, indice, riga) {
  return foglio + '!$' + lettera_(indice) + '$' + riga;
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Spese aereo')
    .addItem('Nuovo movimento...', 'apriSidebarNuova')
    .addItem('Modifica movimento selezionato...', 'apriSidebarModifica')
    .addItem('Annulla movimento selezionato', 'annullaSpesaSelezionata')
    .addSeparator()
    .addItem('Calcola conguaglio...', 'mostraConguaglio')
    .addItem('Verifica integrita', 'verificaIntegrita')
    .addItem('Ripristina colonne calcolate', 'ripristinaColonneCalcolate')
    .addItem('Compatta Quote e Pagamenti', 'compattaTabelle')
    .addSeparator()
    .addItem('Ricostruisci struttura', 'setup')
    .addToUi();
}

/** Punto di ingresso: costruisce o aggiorna tutta la struttura. */
function setup() {
  var ss = SpreadsheetApp.getActive();

  SEPARATORE = null;                 // rileva di nuovo: il locale puo' essere cambiato
  var sep = separatoreArgomenti_();

  costruisciMetadati_(ss);
  costruisciAnagrafica_(ss);
  costruisciSpese_(ss);
  costruisciQuote_(ss);
  costruisciPagamenti_(ss);
  costruisciGiroconti_(ss);
  costruisciSaldi_(ss);
  costruisciControlli_(ss);
  costruisciLog_(ss);
  costruisciIntervalliConNome_(ss);
  ordinaFogli_(ss);

  scriviLog_('SETUP', '', 'locale ' + ss.getSpreadsheetLocale() +
    ', separatore di argomenti "' + sep + '"');
  ss.toast('Struttura aggiornata. Separatore rilevato: "' + sep + '"',
    'Spese aereo', 6);
}

/* ------------------------------------------------------------------ */
/* Helper generici                                                     */
/* ------------------------------------------------------------------ */

function assicuraFoglio_(ss, nome, intestazioni) {
  var sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  if (intestazioni) {
    sh.getRange(1, 1, 1, intestazioni.length).setValues([intestazioni]);
    sh.getRange(1, 1, 1, intestazioni.length)
      .setFontWeight('bold')
      .setBackground('#eceff1');
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  }
  return sh;
}

function pulisciConvalide_(sh, colonna) {
  sh.getRange(2, colonna, Math.max(sh.getMaxRows() - 1, 1), 1).clearDataValidations();
}

function convalidaSocio_(ss, sh, colonna) {
  pulisciConvalide_(sh, colonna);
  var soci = ss.getSheetByName(FOGLI.ANAGRAFICA).getRange('A2:A');
  var regola = SpreadsheetApp.newDataValidation()
    .requireValueInRange(soci, true)
    .setAllowInvalid(false)
    .setHelpText('Usa un id_socio presente in Anagrafica.')
    .build();
  sh.getRange(2, colonna, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regola);
}

function convalidaLista_(sh, colonna, valori, aiuto) {
  pulisciConvalide_(sh, colonna);
  var regola = SpreadsheetApp.newDataValidation()
    .requireValueInList(valori, true)
    .setAllowInvalid(false)
    .setHelpText(aiuto || '')
    .build();
  sh.getRange(2, colonna, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regola);
}

/** Frammento di formula che risolve una chiave del foglio Metadati. */
function riferimentoMeta_(chiave) {
  return 'INDEX(' + FOGLI.METADATI + '!$B:$B~MATCH("' + chiave + '"~' +
         FOGLI.METADATI + '!$A:$A~0))';
}

function proteggiConAvviso_(range, descrizione) {
  var esistenti = range.getSheet().getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var i = 0; i < esistenti.length; i++) {
    if (esistenti[i].getDescription() === descrizione) esistenti[i].remove();
  }
  range.protect().setDescription(descrizione).setWarningOnly(true);
}

/* ------------------------------------------------------------------ */
/* Metadati                                                            */
/* ------------------------------------------------------------------ */

function costruisciMetadati_(ss) {
  var sh = ss.getSheetByName(FOGLI.METADATI);
  if (!sh) {
    sh = ss.insertSheet(FOGLI.METADATI);
    sh.getRange(1, 1, 1, 2).setValues([['chiave', 'valore']])
      .setFontWeight('bold').setBackground('#eceff1');
    sh.setFrozenRows(1);
  }

  var ultima = sh.getLastRow();
  var presenti = {};
  if (ultima > 1) {
    var chiavi = sh.getRange(2, 1, ultima - 1, 1).getValues();
    for (var i = 0; i < chiavi.length; i++) {
      presenti[String(chiavi[i][0]).trim()] = true;
    }
  }

  for (var j = 0; j < META_DEFAULT.length; j++) {
    var chiave = META_DEFAULT[j][0];
    if (presenti[chiave]) continue;
    var valore = META_DEFAULT[j][1];
    var riga = sh.getLastRow() + 1;
    sh.getRange(riga, 1).setValue(chiave);
    if (chiave === META.DATA_MIN) {
      var parti = String(valore).split('-');
      sh.getRange(riga, 2)
        .setValue(new Date(Number(parti[0]), Number(parti[1]) - 1, Number(parti[2])))
        .setNumberFormat('yyyy-mm-dd');
    } else {
      sh.getRange(riga, 2).setValue(valore);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Anagrafica                                                          */
/* ------------------------------------------------------------------ */

function costruisciAnagrafica_(ss) {
  var sh = assicuraFoglio_(ss, FOGLI.ANAGRAFICA, INTESTAZIONI.ANAGRAFICA);

  if (sh.getLastRow() < 2) {
    var righe = [];
    for (var i = 1; i <= N_SOCI_INIZIALI; i++) {
      righe.push(['Socio' + i, 'Socio' + i, true, '', '']);
    }
    righe.push([leggiMeta_(META.NOME_CASSA), 'Cassa comune', true, '', '']);
    sh.getRange(2, 1, righe.length, INTESTAZIONI.ANAGRAFICA.length).setValues(righe);
  }

  var regolaCheck = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  pulisciConvalide_(sh, COL.ANAGRAFICA.ATTIVO);
  sh.getRange(2, COL.ANAGRAFICA.ATTIVO, Math.max(sh.getMaxRows() - 1, 1), 1)
    .setDataValidation(regolaCheck);

  sh.setColumnWidth(COL.ANAGRAFICA.ID, 110);
  sh.setColumnWidth(COL.ANAGRAFICA.NOME, 180);
  sh.setColumnWidth(COL.ANAGRAFICA.IBAN, 240);
  sh.setColumnWidth(COL.ANAGRAFICA.EMAIL, 220);
}

/* ------------------------------------------------------------------ */
/* Spese                                                               */
/* ------------------------------------------------------------------ */

/**
 * Inserisce la colonna `tipo` in un foglio Spese che non ce l'ha, e marca
 * tutto lo storico come SPESA.
 *
 * Si usa insertColumnBefore, che sposta i dati a destra senza perderli e fa
 * riadattare a Sheets i riferimenti nelle formule esistenti. Deve girare
 * PRIMA che assicuraFoglio_ riscriva le intestazioni, altrimenti il segnale
 * che distingue lo schema vecchio da quello nuovo sparisce.
 */
function migraSpeseTipo_(ss) {
  var sh = ss.getSheetByName(FOGLI.SPESE);
  if (!sh) return;                                  // sara' creato gia' nuovo

  var larghezza = Math.max(sh.getLastColumn(), 1);
  var intestazioni = sh.getRange(1, 1, 1, larghezza).getValues()[0]
    .map(function (v) { return String(v).trim(); });

  if (intestazioni.indexOf('tipo') !== -1) return;        // gia' migrato
  if (intestazioni.indexOf('id_spesa') === -1) return;    // foglio ancora vuoto

  sh.insertColumnBefore(COL.SPESE.TIPO);
  sh.getRange(1, COL.SPESE.TIPO).setValue('tipo');

  var ultima = ultimaRigaDati_(sh, COL.SPESE.ID);
  if (ultima >= 2) {
    var n = ultima - 1;
    var valori = [];
    for (var i = 0; i < n; i++) valori.push(['SPESA']);
    sh.getRange(2, COL.SPESE.TIPO, n, 1).setValues(valori);
    scriviLog_('MIGRAZIONE', '',
      'colonna tipo aggiunta a Spese, ' + n + ' righe storiche marcate SPESA');
  }
}

function costruisciSpese_(ss) {
  migraSpeseTipo_(ss);

  var sh = assicuraFoglio_(ss, FOGLI.SPESE, INTESTAZIONI.SPESE);
  var righe = Math.max(sh.getMaxRows() - 1, 1);

  sh.getRange(2, COL.SPESE.DATA, righe, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, COL.SPESE.IMPORTO, righe, 1).setNumberFormat('#,##0.00');
  convalidaLista_(sh, COL.SPESE.TIPO, TIPI,
    'SPESA: importo positivo. ENTRATA: importo negativo.');
  convalidaLista_(sh, COL.SPESE.CRITERIO, CRITERI, 'Criterio di ripartizione.');
  convalidaLista_(sh, COL.SPESE.STATO, STATI,
    'ANNULLATA esclude il movimento dai saldi senza cancellarlo.');

  sh.setColumnWidth(COL.SPESE.ID, 80);
  sh.setColumnWidth(COL.SPESE.TIPO, 90);
  sh.setColumnWidth(COL.SPESE.DESCRIZIONE, 300);
  sh.setColumnWidth(COL.SPESE.CRITERIO, 150);
  sh.setColumnWidth(COL.SPESE.NOTE, 250);

  // Le entrate si leggono a colpo d'occhio senza cercare il segno meno.
  sh.clearConditionalFormatRules();
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('ENTRATA').setFontColor('#1b5e20')
      .setRanges([sh.getRange(2, COL.SPESE.TIPO, righe, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('ANNULLATA').setFontColor('#8a8f96')
      .setRanges([sh.getRange(2, COL.SPESE.STATO, righe, 1)]).build()
  ]);
}

/* ------------------------------------------------------------------ */
/* Quote e Pagamenti                                                   */
/* ------------------------------------------------------------------ */

/**
 * La colonna "valida" vale 1 se il movimento di riferimento esiste ed e' in
 * stato OK. E' l'unico filtro usato dai Saldi: annullare un movimento lo
 * esclude da tutti i calcoli, senza cancellare righe.
 *
 * Si usa VLOOKUP e non COUNTIFS perche' COUNTIFS non si espande dentro
 * ARRAYFORMULA: ignora il criterio ad array e restituisce un valore unico,
 * replicato identico su tutte le righe.
 */
function formulaValida_() {
  var finoAStato = FOGLI.SPESE + '!$A$2:$' + lettera_(COL.SPESE.STATO);
  return f_('=ARRAYFORMULA(IF($A$2:$A=""~""~' +
            'N(IFERROR(VLOOKUP($A$2:$A~' + finoAStato + '~' +
            COL.SPESE.STATO + '~FALSE)~"")="OK")))');
}

function costruisciQuote_(ss) {
  var sh = assicuraFoglio_(ss, FOGLI.QUOTE, INTESTAZIONI.QUOTE);
  var righe = Math.max(sh.getMaxRows() - 1, 1);

  sh.getRange(2, COL.QUOTE.IMPORTO, righe, 1).setNumberFormat('#,##0.00');
  convalidaSocio_(ss, sh, COL.QUOTE.SOCIO);

  sh.getRange(2, COL.QUOTE.VALIDA, righe, 1).clearContent();
  sh.getRange(2, COL.QUOTE.VALIDA).setFormula(formulaValida_());
  proteggiConAvviso_(sh.getRange(1, COL.QUOTE.VALIDA, sh.getMaxRows(), 1),
    'Colonna calcolata: non modificare');
}

function costruisciPagamenti_(ss) {
  var sh = assicuraFoglio_(ss, FOGLI.PAGAMENTI, INTESTAZIONI.PAGAMENTI);
  var righe = Math.max(sh.getMaxRows() - 1, 1);

  sh.getRange(2, COL.PAGAMENTI.IMPORTO, righe, 1).setNumberFormat('#,##0.00');
  convalidaSocio_(ss, sh, COL.PAGAMENTI.PAGANTE);

  sh.getRange(2, COL.PAGAMENTI.VALIDA, righe, 1).clearContent();
  sh.getRange(2, COL.PAGAMENTI.VALIDA).setFormula(formulaValida_());
  proteggiConAvviso_(sh.getRange(1, COL.PAGAMENTI.VALIDA, sh.getMaxRows(), 1),
    'Colonna calcolata: non modificare');
}

/* ------------------------------------------------------------------ */
/* Giroconti                                                           */
/* ------------------------------------------------------------------ */

function costruisciGiroconti_(ss) {
  var sh = assicuraFoglio_(ss, FOGLI.GIROCONTI, INTESTAZIONI.GIROCONTI);
  var righe = Math.max(sh.getMaxRows() - 1, 1);

  sh.getRange(2, COL.GIROCONTI.DATA, righe, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, COL.GIROCONTI.IMPORTO, righe, 1).setNumberFormat('#,##0.00');
  convalidaSocio_(ss, sh, COL.GIROCONTI.DA);
  convalidaSocio_(ss, sh, COL.GIROCONTI.A);

  sh.setColumnWidth(COL.GIROCONTI.CAUSALE, 300);
}

/* ------------------------------------------------------------------ */
/* Saldi                                                               */
/* ------------------------------------------------------------------ */

/**
 * Saldo positivo = il socio e' a credito verso il gruppo.
 *
 *   saldo = pagato - dovuto + versato - ricevuto
 *
 * Versare denaro (giroconto in uscita) aumenta il credito; riceverlo lo
 * riduce. Per la cassa, che non ha quote dovute, il saldo e' l'opposto della
 * giacenza: se la cassa detiene 300, il suo saldo e' -300.
 *
 * Le entrate hanno importi negativi, quindi chi incassa vede il proprio
 * `pagato` scendere: tiene in mano denaro del gruppo, ed e' a debito.
 */
function costruisciSaldi_(ss) {
  var sh = ss.getSheetByName(FOGLI.SALDI) || ss.insertSheet(FOGLI.SALDI);
  sh.clear();
  sh.clearConditionalFormatRules();
  if (sh.getMaxRows() < RIGHE_SALDI + 1) {
    sh.insertRowsAfter(sh.getMaxRows(), RIGHE_SALDI + 1 - sh.getMaxRows());
  }

  sh.getRange(1, 1, 1, 7).setValues([[
    'id_socio', 'nome', 'pagato', 'dovuto', 'versato', 'ricevuto', 'saldo'
  ]]).setFontWeight('bold').setBackground('#eceff1');
  sh.setFrozenRows(1);

  var A = FOGLI.ANAGRAFICA;
  var aID      = colonna_(A, COL.ANAGRAFICA.ID);
  var qSocio   = colonna_(FOGLI.QUOTE, COL.QUOTE.SOCIO);
  var qImporto = colonna_(FOGLI.QUOTE, COL.QUOTE.IMPORTO);
  var qValida  = colonna_(FOGLI.QUOTE, COL.QUOTE.VALIDA);
  var pChi     = colonna_(FOGLI.PAGAMENTI, COL.PAGAMENTI.PAGANTE);
  var pImporto = colonna_(FOGLI.PAGAMENTI, COL.PAGAMENTI.IMPORTO);
  var pValida  = colonna_(FOGLI.PAGAMENTI, COL.PAGAMENTI.VALIDA);
  var gDa      = colonna_(FOGLI.GIROCONTI, COL.GIROCONTI.DA);
  var gA       = colonna_(FOGLI.GIROCONTI, COL.GIROCONTI.A);
  var gImporto = colonna_(FOGLI.GIROCONTI, COL.GIROCONTI.IMPORTO);

  sh.getRange('A2').setFormula(f_('=FILTER(' + aID + '~' + aID + '<>"")'));

  // Le colonne B-G sono formule riga per riga, non ARRAYFORMULA.
  // SUMIFS e COUNTIFS non si espandono dentro ARRAYFORMULA: ignorano il
  // criterio ad array e restituiscono un valore unico, replicato identico su
  // tutte le righe. Qui servono due criteri (il socio e la validita' del
  // movimento), quindi la strada e' la formula per riga.
  var righe = [];
  for (var r = 2; r <= 2 + RIGHE_SALDI - 1; r++) {
    righe.push([
      f_('=IF($A' + r + '=""~""~IFERROR(VLOOKUP($A' + r + '~' +
         A + '!$A:$B~2~FALSE)~"?"))'),
      f_('=IF($A' + r + '=""~""~SUMIFS(' + pImporto + '~' + pChi + '~$A' + r +
         '~' + pValida + '~1))'),
      f_('=IF($A' + r + '=""~""~SUMIFS(' + qImporto + '~' + qSocio + '~$A' + r +
         '~' + qValida + '~1))'),
      f_('=IF($A' + r + '=""~""~SUMIF(' + gDa + '~$A' + r + '~' + gImporto + '))'),
      f_('=IF($A' + r + '=""~""~SUMIF(' + gA + '~$A' + r + '~' + gImporto + '))'),
      f_('=IF($A' + r + '=""~""~$C' + r + '-$D' + r + '+$E' + r + '-$F' + r + ')')
    ]);
  }
  sh.getRange(2, 2, righe.length, 6).setFormulas(righe);

  sh.getRange('I1').setValue('Sintesi').setFontWeight('bold');
  sh.getRange('I2').setValue('Giacenza cassa');
  sh.getRange('J2').setFormula(
    f_('=-IFERROR(SUMIF($A$2:$A~' + riferimentoMeta_(META.NOME_CASSA) + '~$G$2:$G)~0)'));
  sh.getRange('I3').setValue('Somma saldi soci');
  sh.getRange('J3').setFormula(
    f_('=SUM($G$2:$G)-IFERROR(SUMIF($A$2:$A~' +
       riferimentoMeta_(META.NOME_CASSA) + '~$G$2:$G)~0)'));
  sh.getRange('I4').setValue('Sbilancio (deve essere 0)');
  sh.getRange('J4').setFormula(f_('=ROUND(SUM($G$2:$G)~2)'));
  sh.getRange('I5').setValue('Totale a credito');
  sh.getRange('J5').setFormula(f_('=SUMIF($G$2:$G~">0")'));
  sh.getRange('I6').setValue('Totale a debito');
  sh.getRange('J6').setFormula(f_('=-SUMIF($G$2:$G~"<0")'));

  sh.getRange('C2:G').setNumberFormat('#,##0.00');
  sh.getRange('J2:J6').setNumberFormat('#,##0.00');
  sh.setColumnWidth(2, 180);
  sh.setColumnWidth(9, 200);

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0).setFontColor('#1b5e20')
      .setRanges([sh.getRange('G2:G')]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0).setFontColor('#b71c1c')
      .setRanges([sh.getRange('G2:G')]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberNotEqualTo(0).setBackground('#ffcdd2')
      .setRanges([sh.getRange('J4')]).build()
  ]);

  proteggiConAvviso_(sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()),
    'Foglio calcolato: non modificare');
}

/* ------------------------------------------------------------------ */
/* Controlli                                                           */
/* ------------------------------------------------------------------ */

function costruisciControlli_(ss) {
  var sh = ss.getSheetByName(FOGLI.CONTROLLI) || ss.insertSheet(FOGLI.CONTROLLI);
  sh.clear();
  sh.clearConditionalFormatRules();

  var S = FOGLI.SPESE, Q = FOGLI.QUOTE, P = FOGLI.PAGAMENTI,
      G = FOGLI.GIROCONTI, A = FOGLI.ANAGRAFICA, SA = FOGLI.SALDI;

  var sID      = colonna_(S, COL.SPESE.ID);
  var sData    = colonna_(S, COL.SPESE.DATA);
  var sTipo    = colonna_(S, COL.SPESE.TIPO);
  var sImporto = colonna_(S, COL.SPESE.IMPORTO);
  var sStato   = colonna_(S, COL.SPESE.STATO);

  var qID      = colonna_(Q, COL.QUOTE.ID);
  var qSocio   = colonna_(Q, COL.QUOTE.SOCIO);
  var qImporto = colonna_(Q, COL.QUOTE.IMPORTO);
  var qValida  = colonna_(Q, COL.QUOTE.VALIDA);
  var qValidaD = cella_(Q, COL.QUOTE.VALIDA, 2);

  var pID      = colonna_(P, COL.PAGAMENTI.ID);
  var pChi     = colonna_(P, COL.PAGAMENTI.PAGANTE);
  var pImporto = colonna_(P, COL.PAGAMENTI.IMPORTO);
  var pValida  = colonna_(P, COL.PAGAMENTI.VALIDA);
  var pValidaD = cella_(P, COL.PAGAMENTI.VALIDA, 2);

  var gData    = colonna_(G, COL.GIROCONTI.DATA);
  var gDa      = colonna_(G, COL.GIROCONTI.DA);
  var gA       = colonna_(G, COL.GIROCONTI.A);
  var gImporto = colonna_(G, COL.GIROCONTI.IMPORTO);

  var aID      = colonna_(A, COL.ANAGRAFICA.ID);

  var attivo = '(' + sID + '<>"")*(' + sStato + '="OK")';

  var controlli = [
    // Sentinella sulla causa. La formula vive in D2: cancellare la riga 2 se
    // la porta via senza lasciare traccia, e una colonna `valida` vuota
    // esclude dai saldi quote e pagamenti insieme, in modo simmetrico. Tutti
    // gli altri controlli restano verdi.
    ['Formula della colonna valida assente o in errore in Quote o Pagamenti',
     '=IF(ISFORMULA(' + qValidaD + ')~0~1)+IF(ISERROR(' + qValidaD + ')~1~0)' +
     '+IF(ISFORMULA(' + pValidaD + ')~0~1)+IF(ISERROR(' + pValidaD + ')~1~0)'],

    // Sentinella sull'effetto. `valida` e' 1 o 0, quindi SUMIF sulla colonna
    // conta le righe valide e COUNTIF le conta tutte: se non coincidono, quel
    // movimento e' fuori dai saldi pur risultando attivo.
    ['Movimenti attivi con quote o pagamenti esclusi dai saldi',
     '=SUMPRODUCT(' + attivo + '*(((' +
     'SUMIF(' + qID + '~' + sID + '~' + qValida + ')<>COUNTIF(' + qID + '~' + sID + '))+(' +
     'SUMIF(' + pID + '~' + sID + '~' + pValida + ')<>COUNTIF(' + pID + '~' + sID + ')))>0))'],

    // Il segno e' la rappresentazione interna del tipo: se divergono, i saldi
    // sono corretti nell'aritmetica ma dicono il contrario di quel che si
    // legge nella colonna tipo.
    ['Tipo e segno dell\'importo discordi, o tipo non valido',
     '=SUMPRODUCT((' + sID + '<>"")*(((' + sTipo + '="SPESA")*(N(' + sImporto + ')<=0))+((' +
     sTipo + '="ENTRATA")*(N(' + sImporto + ')>=0))+(1-(' + sTipo + '="SPESA")-(' +
     sTipo + '="ENTRATA"))>0))'],

    ['Movimenti attivi in cui la somma delle quote non pareggia l\'importo',
     '=SUMPRODUCT(' + attivo + '*(' +
     'ROUND(SUMIF(' + qID + '~' + sID + '~' + qImporto + ')~2)<>ROUND(N(' + sImporto + ')~2)))'],

    ['Movimenti attivi in cui la somma dei pagamenti non pareggia l\'importo',
     '=SUMPRODUCT(' + attivo + '*(' +
     'ROUND(SUMIF(' + pID + '~' + sID + '~' + pImporto + ')~2)<>ROUND(N(' + sImporto + ')~2)))'],

    ['Movimenti attivi senza quote o senza pagamenti',
     '=SUMPRODUCT(' + attivo + '*(((COUNTIF(' + qID + '~' + sID + ')=0)+(' +
     'COUNTIF(' + pID + '~' + sID + ')=0))>0))'],

    ['Righe di Quote o Pagamenti orfane (id_spesa inesistente)',
     '=SUMPRODUCT((' + qID + '<>"")*(COUNTIF(' + sID + '~' + qID + ')=0))' +
     '+SUMPRODUCT((' + pID + '<>"")*(COUNTIF(' + sID + '~' + pID + ')=0))'],

    ['id_spesa duplicati',
     '=SUMPRODUCT((' + sID + '<>"")*(COUNTIF(' + sID + '~' + sID + ')>1))'],

    ['Soci citati in Quote o Pagamenti ma assenti in Anagrafica',
     '=SUMPRODUCT((' + qID + '<>"")*(COUNTIF(' + aID + '~' + qSocio + ')=0))' +
     '+SUMPRODUCT((' + pID + '<>"")*(COUNTIF(' + aID + '~' + pChi + ')=0))'],

    ['Giroconti con soggetti inesistenti o con mittente uguale a destinatario',
     '=SUMPRODUCT((' + gData + '<>"")*(((COUNTIF(' + aID + '~' + gDa + ')=0)+(' +
     'COUNTIF(' + aID + '~' + gA + ')=0)+(' + gDa + '=' + gA + '))>0))'],

    // Un movimento a zero non e' un errore aritmetico ma non ha significato.
    // Nei giroconti il verso e' dato dalle colonne da/a, quindi li' un importo
    // negativo resta un errore.
    ['Importi nulli in Spese, o nulli/negativi in Giroconti',
     '=SUMPRODUCT((' + sID + '<>"")*(N(' + sImporto + ')=0))' +
     '+SUMPRODUCT((' + gData + '<>"")*(N(' + gImporto + ')<=0))'],

    ['Date fuori intervallo (prima di data_min o nel futuro)',
     '=SUMPRODUCT((' + sID + '<>"")*(((N(' + sData + ')<N(' +
     riferimentoMeta_(META.DATA_MIN) + '))+(N(' + sData + ')>N(TODAY())))>0))' +
     '+SUMPRODUCT((' + gData + '<>"")*(((N(' + gData + ')<N(' +
     riferimentoMeta_(META.DATA_MIN) + '))+(N(' + gData + ')>N(TODAY())))>0))'],

    ['Soci di riferimento non presenti: socio_arrotondamento o nome_cassa',
     '=IF(COUNTIF(' + aID + '~' + riferimentoMeta_(META.SOCIO_ARROTONDAMENTO) +
     ')=0~1~0)+IF(COUNTIF(' + aID + '~' + riferimentoMeta_(META.NOME_CASSA) + ')=0~1~0)'],

    ['Sbilancio complessivo: la somma di tutti i saldi non e\' zero',
     '=IF(ROUND(SUM(' + SA + '!$G$2:$G)~2)=0~0~1)'],

    // Il confronto passa da ROUND(...~2) come tutti gli altri, non da una soglia
    // esplicita. Non e' solo uniformita': senza arrotondamento il controllo
    // scatterebbe su una cassa perfettamente vuota. Verificato sul foglio:
    // Sheets usa doppia precisione IEEE 754 ((2^53+1)=2^53 da' TRUE) e i
    // residui sopravvivono al confronto diretto (1/10+2/10-3/10=0 da' FALSE).
    // Su 10.000 addizioni di 0,01 l'errore accumulato arriva a 1,4e-11: lontano
    // dal centesimo, ma abbastanza da far fallire un <0 secco.
    ['Giacenza di cassa negativa',
     '=IF(ROUND(' + SA + '!$J$2~2)<0~1~0)'],

    // I valori scritti dallo script sono puliti per costruzione: la
    // ripartizione lavora in centesimi interi e divide per 100 solo alla fine.
    // I giroconti pero' si digitano a mano, ed e' l'unico punto in cui un
    // importo con piu' di due decimali entra dalla porta principale.
    ['Importi con piu\' di due decimali',
     '=SUMPRODUCT((' + sID + '<>"")*(ROUND(N(' + sImporto + ')~2)<>N(' + sImporto + ')))' +
     '+SUMPRODUCT((' + gData + '<>"")*(ROUND(N(' + gImporto + ')~2)<>N(' + gImporto + ')))' +
     '+SUMPRODUCT((' + qID + '<>"")*(ROUND(N(' + qImporto + ')~2)<>N(' + qImporto + ')))' +
     '+SUMPRODUCT((' + pID + '<>"")*(ROUND(N(' + pImporto + ')~2)<>N(' + pImporto + ')))']
  ];

  sh.getRange(1, 1, 1, 3).setValues([['controllo', 'anomalie', 'esito']])
    .setFontWeight('bold').setBackground('#eceff1');
  sh.setFrozenRows(1);

  for (var i = 0; i < controlli.length; i++) {
    sh.getRange(i + 2, 1).setValue(controlli[i][0]);
    sh.getRange(i + 2, 2).setFormula(f_(controlli[i][1]));
    sh.getRange(i + 2, 3).setFormula(f_('=IF(N($B' + (i + 2) + ')=0~"ok"~"da correggere")'));
  }

  // Drill-down: elenco dei movimenti che non pareggiano.
  // Quattro FILTER separati invece di un array letterale {a,b,c}: anche il
  // separatore di colonna degli array cambia col locale del foglio.
  var cond =
    sID + '<>""~' + sStato + '="OK"~((' +
    'ROUND(SUMIF(' + qID + '~' + sID + '~' + qImporto + ')~2)<>ROUND(N(' + sImporto + ')~2))+(' +
    'ROUND(SUMIF(' + pID + '~' + sID + '~' + pImporto + ')~2)<>ROUND(N(' + sImporto + ')~2)))>0';

  sh.getRange('E1:H1').setValues([[
    'id_spesa', 'importo', 'somma_quote', 'somma_pagamenti'
  ]]).setFontWeight('bold').setBackground('#eceff1');

  sh.getRange('E2').setFormula(f_(
    '=IFERROR(FILTER(' + sID + '~' + cond + ')~"nessuna anomalia")'));
  sh.getRange('F2').setFormula(f_(
    '=IFERROR(FILTER(' + sImporto + '~' + cond + ')~"")'));
  sh.getRange('G2').setFormula(f_(
    '=IFERROR(FILTER(SUMIF(' + qID + '~' + sID + '~' + qImporto + ')~' + cond + ')~"")'));
  sh.getRange('H2').setFormula(f_(
    '=IFERROR(FILTER(SUMIF(' + pID + '~' + sID + '~' + pImporto + ')~' + cond + ')~"")'));

  sh.setColumnWidth(1, 480);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 130);
  sh.getRange('F2:H').setNumberFormat('#,##0.00');

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0).setBackground('#ffcdd2')
      .setRanges([sh.getRange(2, 2, controlli.length, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('ok').setFontColor('#1b5e20')
      .setRanges([sh.getRange(2, 3, controlli.length, 1)]).build()
  ]);

  proteggiConAvviso_(sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()),
    'Foglio calcolato: non modificare');
}

/* ------------------------------------------------------------------ */
/* Log e rifiniture                                                    */
/* ------------------------------------------------------------------ */

function costruisciLog_(ss) {
  var sh = assicuraFoglio_(ss, FOGLI.LOG, INTESTAZIONI.LOG);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(2, 220);
  sh.setColumnWidth(5, 420);
}

function costruisciIntervalliConNome_(ss) {
  var da_definire = [
    ['SOCI_ID',   FOGLI.ANAGRAFICA + '!$A$2:$A'],
    ['SOCI_NOME', FOGLI.ANAGRAFICA + '!$B$2:$B'],
    ['SALDI_ID',  FOGLI.SALDI + '!$A$2:$A'],
    ['SALDI_VAL', FOGLI.SALDI + '!$G$2:$G']
  ];
  var esistenti = ss.getNamedRanges();
  for (var i = 0; i < esistenti.length; i++) {
    for (var j = 0; j < da_definire.length; j++) {
      if (esistenti[i].getName() === da_definire[j][0]) esistenti[i].remove();
    }
  }
  for (var k = 0; k < da_definire.length; k++) {
    ss.setNamedRange(da_definire[k][0], ss.getRange(da_definire[k][1]));
  }
}

function ordinaFogli_(ss) {
  var ordine = [FOGLI.SPESE, FOGLI.QUOTE, FOGLI.PAGAMENTI, FOGLI.GIROCONTI,
                FOGLI.SALDI, FOGLI.CONTROLLI, FOGLI.ANAGRAFICA,
                FOGLI.METADATI, FOGLI.LOG];
  for (var i = 0; i < ordine.length; i++) {
    var sh = ss.getSheetByName(ordine[i]);
    if (!sh) continue;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  }
  ss.setActiveSheet(ss.getSheetByName(FOGLI.SPESE));
}
