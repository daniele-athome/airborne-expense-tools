# CLAUDE.md

Istruzioni di progetto per Claude Code. Il `README.md` descrive il foglio dal
punto di vista di chi lo usa; questo file raccoglie ciò che serve per
*modificarlo* senza reintrodurre bug già pagati.

Il codice e i commenti di questo progetto sono in italiano.

## Cos'è

Progetto Google Apps Script **container-bound** a un Google Sheets che gestisce
le spese condivise di un gruppo di comproprietari di un aereo (4-6 soci,
composizione stabile). Le spese si regolano in modo misto: cassa comune più
anticipi personali da rimborsare, e la ripartizione viene decisa caso per caso,
non con un criterio fisso.

Non c'è build e non ci sono dipendenze a runtime (in `package.json` solo
`clasp` e i tipi di Apps Script, come devDependencies): i sorgenti si copiano
nell'editor Apps Script o si sincronizzano con `clasp`. A parte
`testRipartizione()` (vedi sotto), l'unico collaudo possibile è sul foglio
reale.

## Struttura dei sorgenti

Tutto il codice sta in `src/`, che è la `rootDir` di `clasp` (`.clasp.json`).
`npm run push` equivale a `clasp push` e sovrascrive il progetto remoto: lo
`scriptId` in `.clasp.json` è quello di **produzione**, non esiste un ambiente
di prova separato.

| File                   | Ruolo                                                                                                                                                                                                                                                     |
|------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Costanti.gs`          | `FOGLI`, `INTESTAZIONI`, `COL` (indici 1-based), chiavi e default di `Metadati`, `CRITERI`, `TIPI`, `STATI`, `RIGHE_SALDI`, `LOCK_MS`. Aggiungere una colonna significa toccare `INTESTAZIONI` e `COL` insieme.                                           |
| `Setup.gs`             | `onOpen()` (menu *Spese aereo*), `setup()` idempotente, costruzione di ogni foglio, formule di `valida`, `Saldi` e `Controlli`; alla fine rigenera anche il `Prospetto`. Contiene gli helper di formula `f_()`, `separatoreArgomenti_()`, `lettera_()`, `colonna_()`, `cella_()`, `riferimentoMeta_()`, `proteggiConAvviso_()` e la migrazione `migraSpeseTipo_()`. |
| `Prospetto.gs`         | `aggiornaProspetto()` (menu), `rigeneraProspetto_()` e il wrapper `rigeneraProspettoSicuro_()`: riscrive da zero la vista denormalizzata (una riga per movimento, colonne `quota`/`pagato` per socio, solo `pagato` per la cassa), il timbro in riga 1 e la formattazione. `PROSPETTO_INTESTAZIONI` = 2 righe di intestazione; `COL_TIMBRO` dà le colonne del timbro, lette anche dal controllo in `Setup.gs`. |
| `Dati.gs`              | Accesso ai fogli: lettura di `Metadati` e `Anagrafica`, `prossimoIdSpesa_()`, lettura/cancellazione/accodamento delle righe figlie, `ultimaRigaDati_()`, `scriviLog_()`, conversione date.                                                                  |
| `Ripartizione.gs`      | Logica **pura** (nessun accesso al foglio): `calcolaQuote_()`, `quoteManuali_()`, `validaPagamenti_()`, conversioni `inCentesimi_()`/`inEuro_()`.                                                                                                            |
| `Sidebar.gs`           | Lato server della sidebar: apertura, `getDatiIniziali()`, `salvaSpesa()`, `normalizzaPayload_()`, annullamento/riattivazione, `ripristinaColonneCalcolate()`.                                                                                             |
| `Sidebar-page.html`    | Template HTML della sidebar di inserimento e modifica. `quoteLocali()` è una **copia** in JS client della ripartizione, usata solo per l'anteprima.                                                                                                        |
| `Conguaglio.gs`        | Calcolo greedy del minor numero di bonifici (`calcolaConguaglio_()`, in centesimi) e scrittura in `Giroconti`.                                                                                                                                             |
| `Conguaglio-page.html` | Dialog modale del conguaglio, template con scriptlet `<? ?>`.                                                                                                                                                                                             |
| `Validazioni.gs`       | `verificaIntegrita()` (riassume il foglio `Controlli`), `compattaTabelle()`, e `testRipartizione()`.                                                                                                                                                      |
| `appsscript.json`      | Manifest: fuso `Europe/Rome`, runtime V8, scope OAuth dichiarati esplicitamente.                                                                                                                                                                          |

Il manuale d'uso è il `README.md` alla radice, fuori da `src/` e quindi non
spinto da `clasp`. Quando si aggiunge un file sorgente va aggiunto anche alla
tabella di installazione del README.

I nomi dei file HTML hanno il suffisso `-page` perché Apps Script non ammette
due file con lo stesso nome base (`Sidebar.gs` e `Sidebar.html` collidono), e
`createTemplateFromFile()` li cerca per nome esatto.

Le funzioni con `_` finale sono private per Apps Script (non invocabili da
`google.script.run` né elencate nell'editor). Le funzioni chiamate dal client
(`getDatiIniziali`, `salvaSpesa`, `inserisciConguaglioInGiroconti`) e quelle
agganciate al menu **non** devono avere il suffisso.

## Test

L'unico test automatico è `testRipartizione()` in `Validazioni.gs`: copre solo
`Ripartizione.gs`, non tocca il foglio, si lancia dall'editor e scrive l'esito
nel log di esecuzione. Va rilanciato dopo ogni modifica alla ripartizione, e
include la verifica di `quote(-X) = -quote(X)` su più importi. Tutto il resto
(formule, controlli, scritture) si collauda solo sul foglio reale.

## Modello dati

Tabelle normalizzate: `Anagrafica`, `Spese`, `Quote`, `Pagamenti`, `Giroconti`,
`Log`, `Metadati`. Fogli interamente derivati e rigenerati da zero: `Saldi`,
`Controlli`, `Prospetto`.

La **cassa è un socio virtuale** (nome configurabile in `Metadati`), e
l'invariante del modello è che la somma di tutti i saldi, cassa inclusa, faccia
zero. Qualunque modifica che tocchi la contabilità va verificata contro questa
proprietà prima di ogni altra cosa.

Criteri di ripartizione: `UGUALE_TUTTI`, `UGUALE_SELEZIONE`, `MANUALE`.
L'arrotondamento è all'euro e il residuo va al socio indicato da
`socio_arrotondamento`. Il tipo `ENTRATA` ha semantica di segno negativo, e
l'arrotondamento è sign-aware — troncamento verso zero — per preservare
`quote(-X) = -quote(X)`.

Convenzione di segno dei saldi (positivo = a credito verso il gruppo):

    saldo = pagato - dovuto + versato - ricevuto

La cassa non ha quote dovute, quindi il suo saldo è l'opposto della giacenza.
Le chiavi di `Metadati` sono `socio_arrotondamento`, `nome_cassa` e `data_min`
(default in `META_DEFAULT`); `setup` aggiunge solo quelle mancanti.

Regole di scrittura che reggono la contabilità:

- **Le quote sono righe scritte, non formule**: vanno congelate al momento
  della decisione, altrimenti un cambio di `Anagrafica` riscriverebbe la
  ripartizione di spese già conguagliate.
- **Ordine figli-poi-testata, sotto `LockService.getDocumentLock()`.** Uno
  script interrotto lascia righe orfane (segnalate dai controlli e fuori dai
  saldi) invece di una spesa con quote incomplete.
- **In modifica si cancellano e riscrivono tutte le righe figlie**, mai patch
  riga per riga.
- **Annullare è `stato = ANNULLATA`, mai cancellare righe.** La colonna
  `valida` esclude il movimento dai saldi; l'`id_spesa` è `MAX + 1` e non deve
  avere buchi né essere riusato. Lo stesso vale per gli `id_socio`.
- **Il server non si fida del client.** `normalizzaPayload_()` ricontrolla
  tutto, applica il segno in base al `tipo` (dalla sidebar l'importo arriva
  sempre positivo) e riordina i partecipanti secondo `Anagrafica`, così il
  ripiego dell'arrotondamento è deterministico. `salvaSpesa()` e il conguaglio
  ricalcolano gli importi lato server.
- **`quoteLocali()` in `Sidebar-page.html` deve restare speculare a
  `calcolaQuote_()`**: ogni modifica alla regola di arrotondamento va fatta in
  entrambi i punti, altrimenti l'anteprima mente.
- `scriviLog_()` ingoia le eccezioni: il log non deve mai far fallire
  un'operazione contabile.
- **Ogni funzione che scrive in `Spese`, `Quote` o `Pagamenti` deve
  rigenerare il prospetto** dopo la scrittura, passando da
  `rigeneraProspettoSicuro_()`: a scrittura avvenuta un'eccezione arriverebbe
  al client come salvataggio fallito e inviterebbe a registrare il movimento
  due volte. Il wrapper scrive l'errore nel `Log` e restituisce un avviso da
  mostrare. Oggi lo usano `salvaSpesa()`, `impostaStatoSpesa_()`
  (annullamento e riattivazione) e `compattaTabelle()`; `setup()` chiama
  invece `rigeneraProspetto_()` diretto, perché lì un errore deve emergere. Un nuovo punto di scrittura che se ne dimentica lascia il
  prospetto vecchio, e il controllo sul timbro se ne accorge solo se cambiano
  il numero di movimenti o il totale degli importi.

## Aritmetica: le due regole da non violare

Sheets usa doppia precisione IEEE 754 e **i residui sopravvivono ai confronti**:
la pulizia a quindici cifre significative è cosmetica, agisce sulla
visualizzazione e non sulla semantica degli operatori. Verificato sul foglio:
`=(2^53+1)=2^53` dà `TRUE`, `=(1/10+2/10-3/10)=0` dà `FALSE`, e su diecimila
addizioni di 0,01 l'errore accumulato arriva a 1,4e-11.

1. **Tutti i confronti dei controlli passano da `ROUND(...; 2)`.** Non è
   uniformità stilistica: un `<0` o un `=0` secco farebbe scattare il controllo
   sulla giacenza su una cassa perfettamente vuota.
2. **Il calcolo delle quote avviene in centesimi interi**, e divide per 100 solo
   alla fine. I valori scritti in `Quote` e `Pagamenti` sono quindi puliti per
   costruzione. Resta scoperto solo ciò che si digita a mano — i giroconti — e
   per quello c'è il controllo sugli importi con più di due decimali.

Se una di queste due sembra una cautela superflua, rileggere i numeri sopra
prima di toglierla.

## Formule: due vincoli non negoziabili

**Locale.** Sheets non normalizza le formule scritte via script: vanno espresse
nella notazione del **locale del foglio**. Nei locali con la virgola decimale
(`it_IT` fra questi) il separatore di argomenti è il punto e virgola. Le
formule nel codice usano quindi il placeholder `~` come separatore e passano
da `f_()`, che lo sostituisce col separatore rilevato da
`separatoreArgomenti_()`: una formula sonda `=SUM(1,2)` in un foglio di
appoggio temporaneo, che restituisce 3 oppure 1,2. Il separatore rilevato
finisce nel `Log` a ogni `setup`. **Mai scrivere una virgola o un punto e
virgola letterale dentro una formula generata**, comprese le formule delle
regole di formattazione condizionale (`whenFormulaSatisfied`).

**Riferimenti di colonna.** Vanno derivati con gli helper `colonna_()` e
`cella_()`, mai con lettere scritte a mano. L'aggiunta della colonna `tipo` ha
mostrato quanto siano fragili i riferimenti letterali.

## Trappole già incontrate

Sono tutti bug realmente capitati in esercizio, non ipotesi.

- **`SUMIFS`/`COUNTIFS` non si espandono dentro `ARRAYFORMULA`.** Il sintomo è
  subdolo: tutti i saldi mostrano lo stesso valore.
- **`getLastRow()` viene gonfiato dall'`ARRAYFORMULA` sulla colonna `valida`**,
  e le righe figlie finiscono scritte molto sotto i dati reali.
- **Scrivere le righe figlie con 4 colonne invece di 3** sovrascrive la colonna
  calcolata `valida`.
- **Cancellare la riga 2 di `Quote` o `Pagamenti` distrugge silenziosamente
  l'`ARRAYFORMULA`**: le spese coinvolte spariscono dai saldi mentre lo
  sbilancio resta a zero. Due controlli dedicati lo intercettano; il rimedio è
  menu → Ripristina colonne calcolate.
- **Il `Prospetto` contiene valori statici**, quindi può essere obsoleto. La
  difesa è un timbro in riga 1 (data, numero movimenti, totale importi
  all'ultima rigenerazione) più un controllo che lo confronta con `Spese`. Non è
  un checksum: uno scambio di importi fra due movimenti passerebbe, e così una
  modifica a mano di `Quote`, `Pagamenti`, `stato` o `descrizione`, che non
  cambia né il numero di movimenti né il loro totale.
- **Le righe di `Quote` o `Pagamenti` che citano un socio assente da
  `Anagrafica`** non hanno una colonna dove finire e restano invisibili nel
  prospetto. Esiste un controllo dedicato.

## Convenzioni

`Setup.gs` è **idempotente** e va mantenuto tale: può essere rilanciato in
qualunque momento, crea i fogli dati se mancano ma non ne tocca mai il
contenuto, e riscrive sempre intestazioni, convalide, formattazione e formule
derivate.

Quando si aggiunge un controllo, aggiornare il numero atteso di controlli dove
è citato (README e messaggi all'utente): è il modo in cui ci si accorge che la
ricostruzione è andata a buon fine. Oggi l'array `controlli` in
`costruisciControlli_()` ne contiene **17** (l'ultimo aggiunto è "Prospetto
non aggiornato"). Il README al momento non cita il numero.

Su `Quote` e `Pagamenti` non usare mai `getLastRow()` per trovare la fine dei
dati: usare `ultimaRigaDati_()`, e scrivere con `accodaRighe_()`.

`Saldi` usa formule riga per riga in un blocco fisso di `RIGHE_SALDI` righe
(100): è il tetto di soggetti in `Anagrafica`, cassa compresa. Niente array
letterali `{a,b,c}` nelle formule: anche il loro separatore dipende dal locale.

Dopo un cambio di locale del foglio va rilanciato `setup`: le formule già
scritte restano nella notazione precedente.

Le motivazioni non ovvie vanno nel commento **accanto al codice**, non nel
messaggio di commit e non in una conversazione. Il criterio: se qualcuno fra sei
mesi potrebbe "semplificare" quella riga, serve il commento.

## Lavoro in corso: accesso da mobile

L'app Google Sheets per Android non esegue menu personalizzati, sidebar né
dialog di Apps Script. La direzione scelta è esporre l'interfaccia come **web
app** (`doGet()` che serve gli stessi template HTML della sidebar), raggiungibile
dal browser del telefono.

Due punti già chiariti, da non rimettere in discussione:

- `SpreadsheetApp.getActive()` **funziona** nel `doGet()` di uno script bound: il
  binding è statico e non dipende dal documento aperto. Non serve `openById()`.
- Lo scope giusto è `https://www.googleapis.com/auth/spreadsheets.currentonly`,
  dichiarato esplicitamente in `appsscript.json` e non lasciato dedurre
  all'annotazione `@OnlyCurrentDoc`. Attenzione: vale per l'intero progetto, e
  basta un uso di `DriveApp`, `openById()` o del servizio avanzato Sheets per
  farlo decadere.

Stato attuale del codice rispetto a questo obiettivo (nessun `doGet()` esiste
ancora). Punti che un `doGet()` dovrà aggirare:

- `appsscript.json` dichiara già `spreadsheets.currentonly`, più
  `script.container.ui` (sidebar, dialog, menu) e `userinfo.email`
  (`Session.getActiveUser()` in `scriviLog_()`).
- `SpreadsheetApp.getUi()` non è disponibile fuori dal contesto del foglio:
  lo usano `mostraSidebar_()`, `idSpesaSelezionata_()`,
  `annullaSpesaSelezionata()`, `mostraConguaglio()`, `verificaIntegrita()`,
  `compattaTabelle()`.
- Modifica e annullamento ricavano l'`id_spesa` dalla **riga selezionata** nel
  foglio `Spese` o `Prospetto` (`idSpesaSelezionata_()`); in una web app l'id
  dovrà arrivare come parametro.
- I template chiamano `google.script.host.close()`, che esiste solo in sidebar
  e dialog.
- Il percorso di salvataggio (`salvaSpesa()` → `rigeneraProspetto_()`) non
  invoca `separatoreArgomenti_()`: la regola condizionale delle entrate è
  scritta come prodotto di booleani apposta per non avere argomenti multipli.
  Va mantenuto così: la sonda crea e cancella un foglio e cambia il foglio
  attivo, cosa da evitare a ogni salvataggio e a maggior ragione nella web app.
