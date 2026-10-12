#!/usr/bin/env node
'use strict';

/**
 * Esegue testRipartizione() sotto Node, senza aprire l'editor Apps Script.
 *
 * Funziona perche' la logica di ripartizione e' pura: Ripartizione.gs non
 * tocca il foglio e Costanti.gs sono sole dichiarazioni. Validazioni.gs si
 * carica per intero: non ha codice a livello globale, quindi le funzioni che
 * usano SpreadsheetApp vengono definite ma mai invocate.
 *
 * Si usa un contesto vm invece di eval incatenate: in un contesto vm le
 * dichiarazioni var e function di primo livello diventano proprieta' del
 * contesto, cosi' i tre file si vedono fra loro come nell'ambiente Apps
 * Script, e i nomi dei file compaiono negli stack trace.
 *
 * Copre solo Ripartizione.gs. Formule, controlli e scritture restano
 * collaudabili unicamente sul foglio reale.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const FILE = ['Costanti.gs', 'Ripartizione.gs', 'Validazioni.gs'];

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

if (typeof ambiente.testRipartizione !== 'function') {
  console.error('testRipartizione() non trovata in Validazioni.gs.');
  process.exit(2);
}

const esito = ambiente.testRipartizione();
console.log(esito);

// testRipartizione() comunica l'esito con una stringa, perche' in Apps Script
// la si legge nel log di esecuzione. Se cambi quel messaggio, cambia anche
// questa riga.
process.exit(esito.indexOf('Tutti i test passati') === 0 ? 0 : 1);
