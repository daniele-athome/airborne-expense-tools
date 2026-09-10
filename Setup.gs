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
 * NOTA SUL SEPARATORE DELLE FORMULE
 * Google Sheets non normalizza le formule scritte via script: vanno espresse
 * nella notazione del locale del foglio. Nei locali che usano la virgola come
 * separatore decimale (it_IT e molti altri) il separatore di argomenti e' il
 * punto e virgola, non la virgola.
 *
 * Per non dipendere dal locale, tutte le formule qui dentro usano il
 * segnaposto ~ al posto del separatore di argomenti, e passano da f_() prima
 * di essere scritte. Il separatore giusto non viene dedotto da una tabella di
 * locali ma chiesto a Sheets stesso, con una formula sonda.
 *
 * Per lo stesso motivo qui non si usano array letterali {a,b,c}: anche il loro
 * separatore di colonna cambia col locale.
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
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Spese aereo')
    .addItem('Nuova spesa...', 'apriSidebarNuova')
    .addItem('Modifica spesa selezionata...', 'apriSidebarModifica')
    .addItem('Annulla spesa selezionata', 'annullaSpesaSelezionata')
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

/**
 * Restituisce il foglio, creandolo se manca. Se esiste, il contenuto resta.
 * Le intestazioni vengono comunque riscritte e formattate.
 */
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

/** Rimuove tutte le convalide dati da una colonna, per non accumularle. */
function pulisciConvalide_(sh, colonna) {
  sh.getRange(2, colonna, Math.max(sh.getMaxRows() - 1, 1), 1).clearDataValidations();
}

/** Convalida: il valore deve essere un id_socio esistente in Anagrafica. */
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

/** Convalida: il valore deve stare in una lista chiusa. */
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

/** Protezione con solo avviso: non blocca, ma segnala una modifica manuale. */
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

/**
 * Il foglio Metadati puo' gia' esistere e contenere chiavi estranee a questo
 * progetto. Aggiungiamo in coda solo le chiavi mancanti, senza toccare nulla
 * di preesistente (intestazione compresa).
 */
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
      // data_min va scritta come data vera: i controlli la confrontano
      // numericamente con le date di Spese e Giroconti.
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

function costruisciSpese_(ss) {
  var sh = assicuraFoglio_(ss, FOGLI.SPESE, INTESTAZIONI.SPESE);
  var righe = Math.max(sh.getMaxRows() - 1, 1);

  sh.getRange(2, COL.SPESE.DATA, righe, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, COL.SPESE.IMPORTO, righe, 1).setNumberFormat('#,##0.00');
  convalidaLista_(sh, COL.SPESE.CRITERIO, CRITERI, 'Criterio di ripartizione.');
  convalidaLista_(sh, COL.SPESE.STATO, STATI,
    'ANNULLATA esclude la spesa dai saldi senza cancellarla.');

  sh.setColumnWidth(COL.SPESE.ID, 80);
  sh.setColumnWidth(COL.SPESE.DESCRIZIONE, 300);
  sh.setColumnWidth(COL.SPESE.CRITERIO, 150);
  sh.setColumnWidth(COL.SPESE.NOTE, 250);
}

/* ------------------------------------------------------------------ */
/* Quote e Pagamenti                                                   */
/* ------------------------------------------------------------------ */

/**
 * La colonna "valida" vale 1 se la spesa di riferimento esiste ed e' in stato
 * OK. E' l'unico filtro usato dai Saldi: annullare una spesa la esclude
 * automaticamente da tutti i calcoli, senza cancellare righe.
 *
 * Si usa VLOOKUP e non COUNTIFS perche' COUNTIFS non si espande dentro
 * ARRAYFORMULA: ignora il criterio ad array e restituisce un valore unico,
 * replicato identico su tutte le righe.
 */
function formulaValida_() {
  return f_('=ARRAYFORMULA(IF($A$2:$A=""~""~' +
            'N(IFERROR(VLOOKUP($A$2:$A~' + FOGLI.SPESE + '!$A$2:$F~' +
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

  var A = FOGLI.ANAGRAFICA, Q = FOGLI.QUOTE, P = FOGLI.PAGAMENTI, G = FOGLI.GIROCONTI;

  sh.getRange('A2').setFormula(
    f_('=FILTER(' + A + '!$A$2:$A~' + A + '!$A$2:$A<>"")'));

  // Le colonne B-G sono formule riga per riga, non ARRAYFORMULA.
  // SUMIFS e COUNTIFS non si espandono dentro ARRAYFORMULA: ignorano il
  // criterio ad array e restituiscono un valore unico, replicato identico su
  // tutte le righe. Qui servono due criteri (il socio e la validita' della
  // spesa), quindi la strada e' la formula per riga.
  var righe = [];
  for (var r = 2; r <= 2 + RIGHE_SALDI - 1; r++) {
    righe.push([
      f_('=IF($A' + r + '=""~""~IFERROR(VLOOKUP($A' + r + '~' + A + '!$A:$B~2~FALSE)~"?"))'),
      f_('=IF($A' + r + '=""~""~SUMIFS(' + P + '!$C$2:$C~' +
         P + '!$B$2:$B~$A' + r + '~' + P + '!$D$2:$D~1))'),
      f_('=IF($A' + r + '=""~""~SUMIFS(' + Q + '!$C$2:$C~' +
         Q + '!$B$2:$B~$A' + r + '~' + Q + '!$D$2:$D~1))'),
      f_('=IF($A' + r + '=""~""~SUMIF(' + G + '!$B$2:$B~$A' + r + '~' + G + '!$D$2:$D))'),
      f_('=IF($A' + r + '=""~""~SUMIF(' + G + '!$C$2:$C~$A' + r + '~' + G + '!$D$2:$D))'),
      f_('=IF($A' + r + '=""~""~$C' + r + '-$D' + r + '+$E' + r + '-$F' + r + ')')
    ]);
  }
  sh.getRange(2, 2, righe.length, 6).setFormulas(righe);

  // Riquadro di sintesi.
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

  var regole = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0).setFontColor('#1b5e20')
      .setRanges([sh.getRange('G2:G')]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0).setFontColor('#b71c1c')
      .setRanges([sh.getRange('G2:G')]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberNotEqualTo(0).setBackground('#ffcdd2')
      .setRanges([sh.getRange('J4')]).build()
  ];
  sh.setConditionalFormatRules(regole);

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

  var controlli = [
    // Sentinella sulla causa. La formula vive in D2: cancellare la riga 2 se
    // la porta via senza lasciare traccia, e una colonna `valida` vuota
    // esclude dai saldi quote e pagamenti insieme, in modo simmetrico. Tutti
    // gli altri controlli restano verdi. Si ripara dal menu, con Ripristina
    // colonne calcolate.
    ['Formula della colonna valida assente o in errore in Quote o Pagamenti',
     '=IF(ISFORMULA(' + Q + '!$D$2)~0~1)+IF(ISERROR(' + Q + '!$D$2)~1~0)' +
     '+IF(ISFORMULA(' + P + '!$D$2)~0~1)+IF(ISERROR(' + P + '!$D$2)~1~0)'],

    // Sentinella sull'effetto. Per una spesa attiva, il numero di righe
    // figlie valide deve coincidere col numero di righe figlie: `valida` e'
    // 1 o 0, quindi SUMIF sulla colonna conta le valide e COUNTIF le conta
    // tutte. Se non coincidono, quella spesa e' fuori dai saldi in tutto o
    // in parte pur risultando attiva.
    ['Spese attive con quote o pagamenti esclusi dai saldi',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(' + S + '!$F$2:$F="OK")*(((' +
     'SUMIF(' + Q + '!$A$2:$A~' + S + '!$A$2:$A~' + Q + '!$D$2:$D)<>' +
     'COUNTIF(' + Q + '!$A$2:$A~' + S + '!$A$2:$A))+(' +
     'SUMIF(' + P + '!$A$2:$A~' + S + '!$A$2:$A~' + P + '!$D$2:$D)<>' +
     'COUNTIF(' + P + '!$A$2:$A~' + S + '!$A$2:$A)))>0))'],

    ['Spese attive in cui la somma delle quote non pareggia l\'importo',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(' + S + '!$F$2:$F="OK")*(' +
     'ROUND(SUMIF(' + Q + '!$A$2:$A~' + S + '!$A$2:$A~' + Q + '!$C$2:$C)~2)<>' +
     'ROUND(N(' + S + '!$D$2:$D)~2)))'],

    ['Spese attive in cui la somma dei pagamenti non pareggia l\'importo',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(' + S + '!$F$2:$F="OK")*(' +
     'ROUND(SUMIF(' + P + '!$A$2:$A~' + S + '!$A$2:$A~' + P + '!$C$2:$C)~2)<>' +
     'ROUND(N(' + S + '!$D$2:$D)~2)))'],

    ['Spese attive senza quote o senza pagamenti',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(' + S + '!$F$2:$F="OK")*(((' +
     'COUNTIF(' + Q + '!$A$2:$A~' + S + '!$A$2:$A)=0)+(' +
     'COUNTIF(' + P + '!$A$2:$A~' + S + '!$A$2:$A)=0))>0))'],

    ['Righe di Quote o Pagamenti orfane (id_spesa inesistente)',
     '=SUMPRODUCT((' + Q + '!$A$2:$A<>"")*(COUNTIF(' + S + '!$A$2:$A~' +
     Q + '!$A$2:$A)=0))+SUMPRODUCT((' + P + '!$A$2:$A<>"")*(COUNTIF(' +
     S + '!$A$2:$A~' + P + '!$A$2:$A)=0))'],

    ['id_spesa duplicati',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(COUNTIF(' + S + '!$A$2:$A~' +
     S + '!$A$2:$A)>1))'],

    ['Soci citati in Quote o Pagamenti ma assenti in Anagrafica',
     '=SUMPRODUCT((' + Q + '!$A$2:$A<>"")*(COUNTIF(' + A + '!$A$2:$A~' +
     Q + '!$B$2:$B)=0))+SUMPRODUCT((' + P + '!$A$2:$A<>"")*(COUNTIF(' +
     A + '!$A$2:$A~' + P + '!$B$2:$B)=0))'],

    ['Giroconti con soggetti inesistenti o con mittente uguale a destinatario',
     '=SUMPRODUCT((' + G + '!$A$2:$A<>"")*(((COUNTIF(' + A + '!$A$2:$A~' +
     G + '!$B$2:$B)=0)+(COUNTIF(' + A + '!$A$2:$A~' + G + '!$C$2:$C)=0)+(' +
     G + '!$B$2:$B=' + G + '!$C$2:$C))>0))'],

    ['Importi nulli o negativi in Spese o Giroconti',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(N(' + S + '!$D$2:$D)<=0))' +
     '+SUMPRODUCT((' + G + '!$A$2:$A<>"")*(N(' + G + '!$D$2:$D)<=0))'],

    ['Date fuori intervallo (prima di data_min o nel futuro)',
     '=SUMPRODUCT((' + S + '!$A$2:$A<>"")*(((N(' + S + '!$B$2:$B)<N(' +
     riferimentoMeta_(META.DATA_MIN) + '))+(N(' + S + '!$B$2:$B)>N(TODAY())))>0))' +
     '+SUMPRODUCT((' + G + '!$A$2:$A<>"")*(((N(' + G + '!$A$2:$A)<N(' +
     riferimentoMeta_(META.DATA_MIN) + '))+(N(' + G + '!$A$2:$A)>N(TODAY())))>0))'],

    ['Soci di riferimento non presenti: socio_arrotondamento o nome_cassa',
     '=IF(COUNTIF(' + A + '!$A$2:$A~' + riferimentoMeta_(META.SOCIO_ARROTONDAMENTO) +
     ')=0~1~0)+IF(COUNTIF(' + A + '!$A$2:$A~' + riferimentoMeta_(META.NOME_CASSA) +
     ')=0~1~0)'],

    ['Sbilancio complessivo: la somma di tutti i saldi non e\' zero',
     '=IF(ROUND(SUM(' + SA + '!$G$2:$G)~2)=0~0~1)'],

    ['Giacenza di cassa negativa',
     '=IF(' + SA + '!$J$2<-0.005~1~0)']
  ];

  sh.getRange(1, 1, 1, 3).setValues([['controllo', 'anomalie', 'esito']])
    .setFontWeight('bold').setBackground('#eceff1');
  sh.setFrozenRows(1);

  for (var i = 0; i < controlli.length; i++) {
    sh.getRange(i + 2, 1).setValue(controlli[i][0]);
    sh.getRange(i + 2, 2).setFormula(f_(controlli[i][1]));
    sh.getRange(i + 2, 3).setFormula(f_('=IF(N($B' + (i + 2) + ')=0~"ok"~"da correggere")'));
  }

  // Drill-down: elenco delle spese che non pareggiano.
  // Quattro FILTER separati invece di un array letterale {a,b,c}: anche il
  // separatore di colonna degli array cambia col locale del foglio.
  var cond =
    S + '!$A$2:$A<>""~' + S + '!$F$2:$F="OK"~((' +
    'ROUND(SUMIF(' + Q + '!$A$2:$A~' + S + '!$A$2:$A~' + Q + '!$C$2:$C)~2)<>' +
    'ROUND(N(' + S + '!$D$2:$D)~2))+(' +
    'ROUND(SUMIF(' + P + '!$A$2:$A~' + S + '!$A$2:$A~' + P + '!$C$2:$C)~2)<>' +
    'ROUND(N(' + S + '!$D$2:$D)~2)))>0';

  sh.getRange('E1:H1').setValues([[
    'id_spesa', 'importo', 'somma_quote', 'somma_pagamenti'
  ]]).setFontWeight('bold').setBackground('#eceff1');

  sh.getRange('E2').setFormula(f_(
    '=IFERROR(FILTER(' + S + '!$A$2:$A~' + cond + ')~"nessuna anomalia")'));
  sh.getRange('F2').setFormula(f_(
    '=IFERROR(FILTER(' + S + '!$D$2:$D~' + cond + ')~"")'));
  sh.getRange('G2').setFormula(f_(
    '=IFERROR(FILTER(SUMIF(' + Q + '!$A$2:$A~' + S + '!$A$2:$A~' + Q + '!$C$2:$C)~' +
    cond + ')~"")'));
  sh.getRange('H2').setFormula(f_(
    '=IFERROR(FILTER(SUMIF(' + P + '!$A$2:$A~' + S + '!$A$2:$A~' + P + '!$C$2:$C)~' +
    cond + ')~"")'));

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
