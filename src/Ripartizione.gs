/**
 * Ripartizione.gs
 *
 * Logica pura di calcolo delle quote. Nessun accesso al foglio: prende
 * numeri, restituisce numeri. E' l'unico punto in cui si decide chi deve
 * quanto, ed e' condiviso tra il salvataggio e l'anteprima della sidebar.
 *
 * Tutti i calcoli avvengono in centesimi interi per non accumulare errori
 * di virgola mobile.
 *
 * Regola di arrotondamento (UGUALE_TUTTI e UGUALE_SELEZIONE):
 *   - la quota base e' l'importo diviso per il numero di partecipanti,
 *     troncato all'euro intero inferiore;
 *   - tutto il resto, decimali compresi, va al socio indicato dalla chiave
 *     socio_arrotondamento in Metadati.
 *
 *   Esempio: 100,50 tra tre soci -> 33 / 33 / 34,50.
 *
 * Se il socio configurato non partecipa alla spesa (caso possibile con
 * UGUALE_SELEZIONE), il resto va al primo partecipante in ordine di
 * Anagrafica e la funzione restituisce un avviso.
 */

/** Converte un importo in centesimi interi. */
function inCentesimi_(v) {
  var n = Number(v);
  if (!isFinite(n)) throw new Error('Importo non numerico: ' + v);
  return Math.round(n * 100);
}

/** Converte centesimi interi in euro. */
function inEuro_(c) {
  return Math.round(c) / 100;
}

/**
 * @param {number} importo         totale della spesa
 * @param {string} criterio        UGUALE_TUTTI | UGUALE_SELEZIONE | MANUALE
 * @param {Array<string>} partecipanti  id_socio, nell'ordine di Anagrafica
 * @param {Object} manuali         mappa id_socio -> importo (solo MANUALE)
 * @param {string} socioArrotondamento  id_socio destinatario del resto
 * @return {{quote: Array<{socio: string, importo: number}>, avvisi: Array<string>}}
 */
function calcolaQuote_(importo, criterio, partecipanti, manuali, socioArrotondamento) {
  var avvisi = [];
  var totale = inCentesimi_(importo);

  if (totale <= 0) {
    throw new Error('L\'importo della spesa deve essere maggiore di zero.');
  }
  if (!partecipanti || !partecipanti.length) {
    throw new Error('Seleziona almeno un partecipante.');
  }
  if (CRITERI.indexOf(criterio) === -1) {
    throw new Error('Criterio non riconosciuto: ' + criterio);
  }

  var doppioni = {};
  for (var d = 0; d < partecipanti.length; d++) {
    if (doppioni[partecipanti[d]]) {
      throw new Error('Il socio ' + partecipanti[d] + ' compare due volte tra i partecipanti.');
    }
    doppioni[partecipanti[d]] = true;
  }

  if (criterio === 'MANUALE') {
    return { quote: quoteManuali_(totale, partecipanti, manuali), avvisi: avvisi };
  }

  var n = partecipanti.length;
  // Quota base in euro interi, espressa in centesimi.
  var base = Math.floor(totale / n / 100) * 100;
  var resto = totale - base * n;

  var destinatario = socioArrotondamento;
  if (partecipanti.indexOf(destinatario) === -1) {
    destinatario = partecipanti[0];
    if (resto > 0) {
      avvisi.push('Il socio di arrotondamento (' + socioArrotondamento +
        ') non partecipa a questa spesa: il resto di ' + inEuro_(resto).toFixed(2) +
        ' va a ' + destinatario + '.');
    }
  }

  var quote = partecipanti.map(function (socio) {
    var c = base + (socio === destinatario ? resto : 0);
    return { socio: socio, importo: inEuro_(c) };
  });

  return { quote: quote, avvisi: avvisi };
}

/**
 * MANUALE: gli importi sono presi come sono, decimali ammessi, ma la somma
 * deve pareggiare esattamente il totale della spesa.
 */
function quoteManuali_(totaleCent, partecipanti, manuali) {
  manuali = manuali || {};
  var somma = 0;
  var quote = partecipanti.map(function (socio) {
    var grezzo = manuali[socio];
    if (grezzo === '' || grezzo === null || grezzo === undefined) {
      throw new Error('Manca l\'importo di ' + socio + '.');
    }
    var c = inCentesimi_(grezzo);
    if (c < 0) throw new Error('La quota di ' + socio + ' non puo\' essere negativa.');
    somma += c;
    return { socio: socio, importo: inEuro_(c) };
  });

  if (somma !== totaleCent) {
    throw new Error('La somma delle quote (' + inEuro_(somma).toFixed(2) +
      ') non pareggia l\'importo della spesa (' + inEuro_(totaleCent).toFixed(2) + ').');
  }
  return quote;
}

/**
 * Verifica che i pagamenti pareggino il totale della spesa.
 * @param {number} importo
 * @param {Array<{pagante: string, importo: number}>} pagamenti
 * @return {Array<{pagante: string, importo: number}>} normalizzati
 */
function validaPagamenti_(importo, pagamenti) {
  if (!pagamenti || !pagamenti.length) {
    throw new Error('Indica almeno un pagante.');
  }
  var totale = inCentesimi_(importo);
  var somma = 0;
  var visti = {};

  var out = pagamenti.map(function (p) {
    if (!p.pagante) throw new Error('Una riga di pagamento non ha il pagante.');
    if (visti[p.pagante]) {
      throw new Error('Il pagante ' + p.pagante + ' compare in due righe: uniscile.');
    }
    visti[p.pagante] = true;
    var c = inCentesimi_(p.importo);
    if (c <= 0) throw new Error('Il pagamento di ' + p.pagante + ' deve essere positivo.');
    somma += c;
    return { pagante: p.pagante, importo: inEuro_(c) };
  });

  if (somma !== totale) {
    throw new Error('La somma dei pagamenti (' + inEuro_(somma).toFixed(2) +
      ') non pareggia l\'importo della spesa (' + inEuro_(totale).toFixed(2) + ').');
  }
  return out;
}
