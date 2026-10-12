/**
 * Composizione.gs
 *
 * Da dove viene il debito di ciascuno. E' il motore della pagina web
 * Debiti-page: i bonifici che il conguaglio propone piu', per ogni socio a
 * debito, il dettaglio dei movimenti che lo hanno portato li'.
 *
 * Due funzioni separate di proposito:
 *
 *   composizioneDebiti_()  legge i fogli e normalizza le date
 *   aggregaDebiti_()       logica pura: numeri dentro, numeri fuori
 *
 * La seconda non tocca il foglio e non usa nessun servizio Apps Script,
 * quindi gira anche sotto Node (scripts/test.js). La prima e' l'unico punto
 * che legge, e consegna alla seconda le date gia' ridotte a stringhe
 * 'aaaa-mm-gg' nel fuso del foglio: cosi' confrontare due date e' confrontare
 * due stringhe, ordinabile e collaudabile fuori dal foglio.
 *
 * COSA MOSTRA, E PERCHE' COSI'
 *
 * - Solo i soci a debito. Chi e' a credito compare come destinatario di un
 *   bonifico e non ha una voce propria: la pagina serve a chi deve pagare.
 * - La cassa resta fuori dall'elenco, perche' non ha quote a suo carico e non
 *   ci sarebbe un dovuto da scomporre, ma resta nei bonifici: il prelievo dal
 *   fondo comune e' un movimento vero.
 * - I totali (dovuto, pagato, giroconti) sono di sempre, gli stessi delle
 *   colonne del foglio Saldi, non di un periodo. L'elenco delle quote viene
 *   invece ripiegato all'ultimo giroconto del socio, solo per accorciarlo:
 *   quella data non entra in nessun calcolo. Se e' quella sbagliata la pagina
 *   resta corretta, e' solo ripiegata in un punto strano. Non tornare a
 *   calcolare un riporto per periodo: era la prima versione del disegno, e
 *   obbligava a far quadrare due aritmetiche invece di una.
 * - Lo stato del movimento si legge da Spese e non dalla colonna calcolata
 *   `valida` di Quote e Pagamenti: quell'ARRAYFORMULA puo' essere stata
 *   distrutta cancellando la riga 2 (trappola nota), e in quel caso i Saldi
 *   perdono dei movimenti mentre questa pagina no. La differenza la
 *   intercetta la controprova socio per socio, invece di restare silenziosa.
 *
 * La formattazione degli importi passa da formattaEuro_() (Web.gs).
 */

/* ------------------------------------------------------------------ */
/* Lettura                                                             */
/* ------------------------------------------------------------------ */

/**
 * Raccoglie tutto quello che serve alla pagina.
 *
 * Riusa calcolaConguaglio_() per saldi e bonifici, e leggiMovimenti_() e
 * indicizzaFiglie_() di Prospetto.gs per le tabelle: sono esattamente le
 * letture che servono, e indicizzaFiglie_() somma gia' i doppioni dello
 * stesso socio sullo stesso movimento invece di farne sparire uno. E' una
 * dipendenza fra due file che dai nomi non si vede: se quelle funzioni
 * cambiano firma, questa va dietro.
 *
 * @param {Spreadsheet=} ss
 * @return {Object} vedi aggregaDebiti_()
 */
function composizioneDebiti_(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var fuso = ss.getSpreadsheetTimeZone();

  var conguaglio = calcolaConguaglio_();
  var shSpese = ss.getSheetByName(FOGLI.SPESE);

  var movimenti = (shSpese ? leggiMovimenti_(shSpese) : []).map(function (m) {
    var v = m.valori;
    return {
      id: m.id,
      giorno: giorno_(v[COL.SPESE.DATA - 1], fuso),
      tipo: String(v[COL.SPESE.TIPO - 1] || 'SPESA'),
      descrizione: String(v[COL.SPESE.DESCRIZIONE - 1] || ''),
      importo: m.importo,
      criterio: String(v[COL.SPESE.CRITERIO - 1] || ''),
      stato: String(v[COL.SPESE.STATO - 1] || '')
    };
  });

  var giroconti = leggiGiroconti_().map(function (g) {
    return {
      giorno: giorno_(g.data, fuso),
      da: g.da,
      a: g.a,
      importo: g.importo,
      causale: g.causale
    };
  });

  var out = aggregaDebiti_({
    cassa: String(leggiMeta_(META.NOME_CASSA)).trim(),
    saldi: conguaglio.righe,
    bonifici: conguaglio.bonifici,
    sbilancio: conguaglio.sbilancio,
    totale: conguaglio.totale,
    movimenti: movimenti,
    quote: indicizzaFiglie_(ss, FOGLI.QUOTE, COL.QUOTE.SOCIO, COL.QUOTE.IMPORTO),
    pagamenti: indicizzaFiglie_(ss, FOGLI.PAGAMENTI,
                                COL.PAGAMENTI.PAGANTE, COL.PAGAMENTI.IMPORTO),
    giroconti: giroconti
  });

  out.aggiornato = Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy, HH:mm');
  return out;
}

/**
 * Da valore di cella a 'aaaa-mm-gg' nel fuso del foglio.
 *
 * Si scende al giorno e si buttano le ore per una ragione precisa: i giroconti
 * scritti da inserisciConguaglioInGiroconti() portano l'ora (new Date()),
 * mentre le date di Spese sono mezzanotte. Confrontando istanti, una spesa
 * datata lo stesso giorno di un giroconto finirebbe dalla parte sbagliata
 * della piega.
 */
function giorno_(v, fuso) {
  if (v instanceof Date) return Utilities.formatDate(v, fuso, 'yyyy-MM-dd');
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim());
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

/* ------------------------------------------------------------------ */
/* Logica pura                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} dati  come lo prepara composizioneDebiti_()
 * @return {{bonifici: Array, totale: number, sbilancio: number,
 *           debitori: Array}}
 */
function aggregaDebiti_(dati) {
  var cassa = String(dati.cassa || '').trim();
  var saldi = dati.saldi || [];
  var movimenti = dati.movimenti || [];
  var quote = dati.quote || {};
  var pagamenti = dati.pagamenti || {};
  var giroconti = dati.giroconti || [];

  var nomi = {};
  saldi.forEach(function (r) { nomi[r.id] = r.nome || r.id; });

  var debitori = [];

  saldi.forEach(function (r) {
    if (r.id === cassa) return;

    // Si arrotonda a centesimi prima di decidere il segno: un saldo
    // matematicamente nullo vale -1,4e-11 e con un `< 0` secco porterebbe in
    // pagina un socio con un debito di 0,00. E' la stessa ragione per cui
    // tutti i controlli del foglio passano da ROUND(...; 2).
    var saldoCent = centesimi_(r.saldo);
    if (saldoCent >= 0) return;

    var piega = ultimoGiroconto_(giroconti, r.id);

    var recenti = [], precedenti = [], righePagati = [];
    var dovutoCent = 0, pagatoCent = 0;

    movimenti.forEach(function (m) {
      if (m.stato !== 'OK') return;

      var q = (quote[m.id] || {})[r.id];
      if (q !== undefined) {
        var qc = centesimi_(q);
        dovutoCent += qc;
        // Le quote a zero restano in elenco: sono legittime (2 euro fra tre
        // soci ne lascia due a zero) e nasconderle farebbe sparire la
        // partecipazione a quel movimento.
        var riga = rigaQuota_(m, inEuro_(qc));
        if (piega && m.giorno && m.giorno < piega) precedenti.push(riga);
        else recenti.push(riga);
      }

      var p = (pagamenti[m.id] || {})[r.id];
      if (p !== undefined) {
        var pc = centesimi_(p);
        pagatoCent += pc;
        righePagati.push(rigaPagato_(m, inEuro_(pc)));
      }
    });

    var movGiroconti = [], girocontiCent = 0;
    giroconti.forEach(function (g) {
      // Versare aumenta il credito, ricevere lo riduce: e' la convenzione dei
      // saldi (versato - ricevuto). Un giroconto da un socio a se stesso non
      // ha senso e qui si annullerebbe da solo.
      var segno = (g.da === r.id ? 1 : 0) - (g.a === r.id ? 1 : 0);
      if (!segno) return;
      var gc = segno * centesimi_(g.importo);
      girocontiCent += gc;
      movGiroconti.push({
        giorno: g.giorno,
        data: dataItaliana_(g.giorno),
        versato: gc > 0,
        controparte: nomi[gc > 0 ? g.a : g.da] || (gc > 0 ? g.a : g.da),
        versoCassa: (gc > 0 ? g.a : g.da) === cassa,
        importo: inEuro_(gc),
        causale: g.causale || ''
      });
    });

    recenti.reverse();
    precedenti.reverse();
    righePagati.reverse();
    movGiroconti.reverse();

    debitori.push({
      id: r.id,
      nome: r.nome || r.id,
      saldo: inEuro_(saldoCent),
      piega: piega,
      piegaData: dataItaliana_(piega),
      dovuto: inEuro_(dovutoCent),
      pagato: inEuro_(pagatoCent),
      giroconti: inEuro_(girocontiCent),
      quoteRecenti: recenti,
      quotePrecedenti: precedenti,
      nQuote: recenti.length + precedenti.length,
      pagamenti: righePagati,
      movGiroconti: movGiroconti,
      bonifici: (dati.bonifici || []).filter(function (b) { return b.da === r.id; })
        .map(function (b) { return { aNome: b.aNome, importo: b.importo }; }),
      // Controprova: le tre voci devono fare il saldo del foglio. Tutto in
      // centesimi interi, quindi il confronto e' esatto e non ha tolleranze.
      quadra: (pagatoCent - dovutoCent + girocontiCent) === saldoCent
    });
  });

  // Chi deve di piu' in cima.
  debitori.sort(function (a, b) {
    return centesimi_(a.saldo) - centesimi_(b.saldo) || (a.nome < b.nome ? -1 : 1);
  });

  return {
    bonifici: dati.bonifici || [],
    totale: dati.totale || 0,
    sbilancio: dati.sbilancio || 0,
    debitori: debitori
  };
}

/**
 * Data piu' recente in cui il socio compare in Giroconti, in qualunque ruolo.
 *
 * Entrambi i ruoli e non solo quello di pagatore: in un conguaglio il debitore
 * compare come `da` e il creditore come `a`, e per entrambi quel movimento e'
 * l'ultima volta che hanno mosso denaro. Guardando solo `da`, un socio sempre
 * a credito non avrebbe mai una piega e si ritroverebbe in pagina tutto lo
 * storico.
 *
 * @return {string} 'aaaa-mm-gg', o '' se il socio non ha giroconti
 */
function ultimoGiroconto_(giroconti, socio) {
  var max = '';
  for (var i = 0; i < giroconti.length; i++) {
    var g = giroconti[i];
    if (g.da !== socio && g.a !== socio) continue;
    if (g.giorno && g.giorno > max) max = g.giorno;
  }
  return max;
}

function rigaQuota_(m, quota) {
  return {
    giorno: m.giorno,
    data: dataItaliana_(m.giorno),
    descrizione: m.descrizione,
    entrata: m.tipo === 'ENTRATA',
    importoMovimento: Math.abs(m.importo),
    criterio: criterioInChiaro_(m.criterio),
    quota: quota
  };
}

function rigaPagato_(m, importo) {
  return {
    giorno: m.giorno,
    data: dataItaliana_(m.giorno),
    descrizione: m.descrizione,
    entrata: m.tipo === 'ENTRATA',
    importoMovimento: Math.abs(m.importo),
    // Se ha messo (o incassato) tutto, la pagina lo dice a parole invece di
    // far confrontare due numeri uguali.
    intero: centesimi_(Math.abs(importo)) === centesimi_(Math.abs(m.importo)),
    importo: importo
  };
}

/** Da 'aaaa-mm-gg' a 'gg/mm/aaaa'. Stringhe, nessun fuso di mezzo. */
function dataItaliana_(giorno) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(giorno || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}

function criterioInChiaro_(criterio) {
  if (criterio === 'UGUALE_TUTTI') return 'uguale fra tutti';
  if (criterio === 'UGUALE_SELEZIONE') return 'uguale fra i partecipanti';
  if (criterio === 'MANUALE') return 'quote decise a mano';
  return String(criterio || '');
}

/**
 * Importo in centesimi interi, tollerante.
 *
 * Non si usa inCentesimi_() di Ripartizione.gs, che su un valore non numerico
 * solleva: qui i valori arrivano da celle che qualcuno puo' aver sporcato, e
 * una pagina che muore e' peggio di una pagina che segnala che i conti non
 * tornano. Ci pensa la controprova.
 */
function centesimi_(v) {
  var n = Number(v);
  return isFinite(n) ? Math.round(n * 100) : 0;
}

/** 'a', 'a e b', 'a, b e c'. */
function elenco_(pezzi) {
  if (!pezzi.length) return '';
  if (pezzi.length === 1) return pezzi[0];
  return pezzi.slice(0, -1).join(', ') + ' e ' + pezzi[pezzi.length - 1];
}

/* ------------------------------------------------------------------ */
/* Formattazione per la pagina                                         */
/* ------------------------------------------------------------------ */

/**
 * Importo col segno meno tipografico (U+2212), che negli importi incolonnati
 * sta alla pari con le cifre. Scritto come escape per tenere i sorgenti in
 * ASCII, come il resto del progetto.
 */
function euro_(v) {
  var n = Number(v) || 0;
  return (n < 0 ? '−' : '') + formattaEuro_(Math.abs(n));
}

/** Come euro_(), ma il segno c'e' sempre: serve dove conta la direzione. */
function euroSegno_(v) {
  var n = Number(v) || 0;
  if (!centesimi_(n)) return formattaEuro_(0);
  return (n < 0 ? '−' : '+') + formattaEuro_(Math.abs(n));
}
