/**
 * Costanti condivise da tutto il progetto.
 *
 * Gestione spese collettive - gruppo comproprietari aereo.
 * Modello: tabelle normalizzate. La cassa comune e' un socio virtuale.
 */

var FOGLI = {
  METADATI:   'Metadati',
  ANAGRAFICA: 'Anagrafica',
  SPESE:      'Spese',
  QUOTE:      'Quote',
  PAGAMENTI:  'Pagamenti',
  GIROCONTI:  'Giroconti',
  SALDI:      'Saldi',
  CONTROLLI:  'Controlli',
  LOG:        'Log'
};

/** Intestazioni delle tabelle di dati. L'ordine definisce le colonne. */
var INTESTAZIONI = {
  ANAGRAFICA: ['id_socio', 'nome', 'attivo', 'iban', 'email'],
  SPESE:      ['id_spesa', 'data', 'descrizione', 'importo', 'criterio', 'stato', 'note'],
  QUOTE:      ['id_spesa', 'socio', 'importo_dovuto', 'valida'],
  PAGAMENTI:  ['id_spesa', 'pagante', 'importo_pagato', 'valida'],
  GIROCONTI:  ['data', 'da', 'a', 'importo', 'causale'],
  LOG:        ['timestamp', 'utente', 'azione', 'id_spesa', 'dettaglio']
};

/** Indici di colonna 1-based, per non contare le lettere a mano. */
var COL = {
  ANAGRAFICA: { ID: 1, NOME: 2, ATTIVO: 3, IBAN: 4, EMAIL: 5 },
  SPESE:      { ID: 1, DATA: 2, DESCRIZIONE: 3, IMPORTO: 4, CRITERIO: 5, STATO: 6, NOTE: 7 },
  QUOTE:      { ID: 1, SOCIO: 2, IMPORTO: 3, VALIDA: 4 },
  PAGAMENTI:  { ID: 1, PAGANTE: 2, IMPORTO: 3, VALIDA: 4 },
  GIROCONTI:  { DATA: 1, DA: 2, A: 3, IMPORTO: 4, CAUSALE: 5 }
};

/** Chiavi attese nel foglio Metadati (chiave in A, valore in B). */
var META = {
  SOCIO_ARROTONDAMENTO: 'socio_arrotondamento',
  NOME_CASSA:           'nome_cassa',
  DATA_MIN:             'data_min'
};

/** Valori di default scritti in Metadati solo se la chiave manca. */
var META_DEFAULT = [
  [META.SOCIO_ARROTONDAMENTO, 'Socio1'],
  [META.NOME_CASSA,           'CASSA'],
  [META.DATA_MIN,             '2026-01-01']
];

var CRITERI = ['UGUALE_TUTTI', 'UGUALE_SELEZIONE', 'MANUALE'];

var STATI = ['OK', 'ANNULLATA'];

/** Numero di soci placeholder creati al primo setup. */
var N_SOCI_INIZIALI = 3;

/** Timeout del lock sulle scritture, in millisecondi. */
var LOCK_MS = 30000;
