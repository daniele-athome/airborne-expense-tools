#!/usr/bin/env node
'use strict';

/**
 * Esegue gli autotest della logica pura sotto Node, senza aprire l'editor
 * Apps Script.
 *
 * Funziona perche' i file caricati non toccano il foglio: Ripartizione.gs e
 * la parte pura di Composizione.gs prendono numeri e restituiscono numeri,
 * Costanti.gs sono sole dichiarazioni. Composizione.gs e Validazioni.gs si
 * caricano per intero: non hanno codice a livello globale, quindi le funzioni
 * che usano SpreadsheetApp o Utilities vengono definite ma mai invocate.
 *
 * Si usa un contesto vm invece di eval incatenate: in un contesto vm le
 * dichiarazioni var e function di primo livello diventano proprieta' del
 * contesto, cosi' i file si vedono fra loro come nell'ambiente Apps Script, e
 * i nomi dei file compaiono negli stack trace.
 *
 * Coperti: Ripartizione.gs e aggregaDebiti_() di Composizione.gs. Formule,
 * controlli, scritture e pagine restano collaudabili solo sul foglio reale.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const FILE = ['Costanti.gs', 'Ripartizione.gs', 'Composizione.gs', 'Validazioni.gs'];

// Ogni test e' una funzione che restituisce una stringa di esito, come nel
// log di esecuzione di Apps Script.
const TEST = ['testRipartizione', 'testComposizione'];

const ambiente = {
  // Apps Script espone Logger come globale; qui basta che non esploda.
  Logger: { log: function () {} },
  console: console
};
vm.createContext(ambiente);

for (const nome of FILE) {
  const percorso = path.join(SRC, nome);
  vm.runInContext(fs.readFileSync(percorso, 'utf8'), ambiente, { filename: percorso });
}

let falliti = 0;

for (const nome of TEST) {
  if (typeof ambiente[nome] !== 'function') {
    console.error(nome + '() non trovata in Validazioni.gs.');
    process.exit(2);
  }
  const esito = ambiente[nome]();
  console.log(nome + ': ' + esito);
  // I test comunicano l'esito con una stringa, perche' in Apps Script la si
  // legge nel log di esecuzione. Se cambi quel messaggio, cambia anche questa
  // riga.
  if (esito.indexOf('Tutti i test passati') !== 0) falliti++;
}

process.exit(falliti ? 1 : 0);
