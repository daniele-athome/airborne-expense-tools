# Spese collettive — gruppo comproprietari aereo

Progetto Apps Script che costruisce e gestisce un foglio Google Sheets per le
spese condivise di un gruppo di comproprietari.

## Installazione

1. Crea un nuovo foglio Google Sheets (o aprine uno che contenga già il foglio
   `Metadati`).
2. Estensioni → Apps Script.
3. Crea un file per ciascuno di questi, con lo stesso nome, e incolla il
   contenuto:

   | File nell'editor | Tipo |
   |---|---|
   | `Costanti.gs` | script |
   | `Dati.gs` | script |
   | `Ripartizione.gs` | script |
   | `Setup.gs` | script |
   | `Sidebar.gs` | script |
   | `Sidebar.html` | HTML |
   | `Conguaglio.gs` | script |
   | `Conguaglio.html` | HTML |
   | `Validazioni.gs` | script |

   Puoi eliminare il `Codice.gs` creato in automatico.

4. Seleziona la funzione `setup` e premi Esegui. Alla prima esecuzione Google
   chiede l'autorizzazione: serve perché lo script legge e scrive il foglio e
   mostra finestre di dialogo.
5. Ricarica il foglio. Compare il menu **Spese aereo**.

Se preferisci lavorare da locale con git, `clasp clone <scriptId>` e poi
`clasp push`; i nomi dei file restano gli stessi, con estensione `.js` invece
di `.gs`.

`setup` è idempotente: puoi rilanciarlo quando vuoi (menu → Ricostruisci
struttura). Crea i fogli mancanti, riscrive intestazioni, convalide e formule
derivate, e non tocca mai i dati già inseriti. Su `Metadati` aggiunge in coda
solo le chiavi che mancano.

## Configurazione

Nel foglio `Metadati`, colonna A la chiave, colonna B il valore:

| chiave | default | significato |
|---|---|---|
| `socio_arrotondamento` | `Socio1` | riceve il resto di ogni divisione |
| `nome_cassa` | `CASSA` | `id_socio` del fondo comune in Anagrafica |
| `data_min` | 2026-01-01 | data più antica accettata |

In `Anagrafica` rinomina i soci nella colonna `nome`: la colonna `id_socio` è
la chiave usata da tutte le altre tabelle, quindi conviene lasciarla stabile e
cambiare solo il nome visualizzato.

## Uso quotidiano

**Registrare una spesa.** Menu → Nuova spesa. Compili importo, criterio,
partecipanti e paganti; in basso la striscia di quadratura mostra se quote e
pagamenti pareggiano il totale. Il pulsante di salvataggio resta spento finché
non quadra tutto.

**Correggere.** Seleziona la riga nel foglio `Spese`, menu → Modifica spesa
selezionata. Quote e pagamenti vengono cancellati e riscritti da capo.

**Annullare.** Seleziona la riga, menu → Annulla spesa selezionata. Lo stato
passa a `ANNULLATA`: la spesa esce dai saldi ma resta leggibile e il
progressivo non si buca. Dallo stesso comando la si può riattivare.

**Versamenti e rimborsi.** Si inseriscono a mano nel foglio `Giroconti`, con le
tendine sui soci. Un versamento in cassa è `Socio → CASSA`; un rimborso
diretto è `Socio → Socio`.

**Chiudere i conti.** Menu → Calcola conguaglio. Propone il minor numero di
bonifici che azzera tutti i saldi e, se vuoi, li scrive in `Giroconti`.

**Verificare.** Il foglio `Controlli` è sempre aggiornato. Il comando Verifica
integrità legge lo stesso foglio e ne riassume l'esito in una finestra.

## Se entra un socio nuovo

Aggiungi una riga in `Anagrafica` con un `id_socio` nuovo, il nome e la spunta
`attivo`. Non serve altro: non c'è schema da modificare, non c'è nessun
`setup` da rilanciare, e non c'è niente da ricalcolare.

Funziona da solo perché tutto punta all'anagrafica in modo dinamico. Le tendine
di `Quote`, `Pagamenti` e `Giroconti` leggono `Anagrafica!A2:A`, quindi il nuovo
socio compare subito. Il foglio `Saldi` prende le righe da un `FILTER` sulla
stessa colonna, quindi si allunga da sé, e le formule delle colonne B–G sono già
predisposte fino a `RIGHE_SALDI`. La sidebar rilegge l'anagrafica a ogni
apertura: chiudila e riaprila se era già aperta.

**Le spese passate non si toccano.** Il nuovo socio parte da saldo zero e non
entra in nulla di ciò che è già stato registrato. È il motivo per cui le quote
sono righe scritte e non formule: se fossero calcolate, l'ingresso in
anagrafica ricalcolerebbe all'indietro anni di ripartizioni.

**Il fondo comune non si diluisce.** La giacenza di cassa non è un pentolone
indiviso: i saldi individuali dicono già quanto di quel denaro spetta a
ciascuno. Un socio che entra con saldo zero non intacca i crediti degli altri.
Se il gruppo decide che debba portarsi in pari con gli altri, è un versamento
normale, cioè un giroconto `SocioNuovo → CASSA`.

**Il prezzo della quota di proprietà resta fuori.** Il denaro che il nuovo
socio paga a chi gli cede la quota è una compravendita tra persone, non una
spesa del gruppo: non va né in `Spese` né in `Giroconti`. Registrarla
sbilancerebbe i saldi senza motivo.

Da quel momento `UGUALE_TUTTI` comprende anche lui. Se una spesa era già stata
registrata prima del suo ingresso ma va divisa anche con lui, riaprila in
modifica: quote e pagamenti vengono riscritti da capo.

### Se un socio esce

L'ordine conta:

1. Conguaglia, così il suo saldo va a zero (menu → Calcola conguaglio).
2. Verifica in `Saldi` che sia effettivamente a zero.
3. Togli la spunta `attivo`. **Non cancellare la riga**: il suo `id_socio` è
   citato in tutte le quote e i pagamenti storici, e senza la riga in anagrafica
   i `Controlli` segnalerebbero soci inesistenti e il suo saldo sparirebbe dal
   totale.

Un socio disattivato sparisce dalle tendine della sidebar ma resta in `Saldi` e
nel conguaglio: è voluto, finché ha un saldo diverso da zero deve restare
visibile.

**Non riusare mai un `id_socio`.** Se entra qualcuno al posto di chi è uscito,
dagli un id nuovo. Riciclare l'id vecchio gli attribuirebbe le spese del
predecessore. La colonna `nome`, invece, si può cambiare liberamente: è solo
l'etichetta mostrata, e nessuna tabella la referenzia.

Se il socio uscente era quello indicato in `socio_arrotondamento`, aggiorna la
chiave in `Metadati`, altrimenti il resto delle divisioni finirà al primo
partecipante di ogni spesa con un avviso giallo nella sidebar.

## Come è fatto

Tre concetti tenuti separati: quanto costa (`Spese`), chi lo deve (`Quote`),
chi ha tirato fuori i soldi (`Pagamenti`). I rimborsi non sono un concetto a
sé, emergono come differenza.

La cassa comune è un socio virtuale: non ha logica dedicata e non ha quote a
suo carico, può solo pagare e ricevere.

Lo script scrive **fatti**, una volta sola, al momento dell'inserimento.
Le formule derivano **tutto il resto**, sempre vive: la colonna `valida`, i
saldi, i controlli. Nessuno script scrive un numero che una formula potrebbe
calcolare.

Le quote sono l'eccezione apparente: sembrano derivabili da importo e criterio,
ma vanno congelate al momento della decisione. Se fossero formule, una modifica
successiva all'anagrafica riscriverebbe in silenzio la ripartizione di spese
già conguagliate.

Le scritture avvengono sotto `LockService`, nell'ordine figli-poi-testata: se
lo script si interrompe a metà restano righe orfane che i controlli segnalano,
invece di una spesa con quote incomplete che falserebbe i saldi senza
accorgersene nessuno.

### Segno dei saldi

    saldo = pagato − dovuto + versato − ricevuto

Positivo significa a credito verso il gruppo. Versare denaro aumenta il
credito, riceverlo lo riduce.

La cassa non ha quote dovute, quindi il suo saldo è l'opposto della giacenza:
se il fondo detiene 300, il suo saldo è −300. In `Saldi`, il riquadro di
sintesi mostra la giacenza già col segno leggibile.

L'invariante da guardare è **Sbilancio = 0**: la somma di tutti i saldi, cassa
compresa, deve fare zero. Se non lo fa, da qualche parte quote o pagamenti non
pareggiano l'importo della loro spesa.

### Arrotondamento

Le quote sono in euro interi. La quota base è l'importo diviso i partecipanti,
troncato all'intero inferiore; tutto il resto, decimali compresi, va al socio
indicato da `socio_arrotondamento`.

    100,50 tra tre soci  →  33 / 33 / 34,50

`MANUALE` è l'eccezione: lì i decimali sono liberi, purché la somma pareggi
esattamente il totale.

**Caso limite da conoscere.** Con `UGUALE_SELEZIONE` il socio di arrotondamento
può non partecipare alla spesa. In quel caso il resto va al primo partecipante
in ordine di `Anagrafica`, e la sidebar lo segnala con un avviso giallo. È
l'unica regola del sistema che non discende dalla configurazione: se preferisci
un comportamento diverso (rifiutare la spesa, o chiedere a chi assegnarlo), si
cambia in `calcolaQuote_`.

## Test

`testRipartizione()` in `Validazioni.gs` verifica la logica di calcolo delle
quote senza toccare il foglio. Lanciala dall'editor dopo ogni modifica a
`Ripartizione.gs`; il risultato finisce nel log di esecuzione.

## Avvertenze

**Separatore delle formule.** Google Sheets non normalizza le formule scritte
via script: vanno espresse nella notazione del locale del foglio. Nei locali
che usano la virgola come separatore decimale — `it_IT` fra questi — il
separatore di argomenti è il punto e virgola.

Lo script non dipende dal locale. Tutte le formule sono scritte con il
segnaposto `~` al posto del separatore e passano da `f_()` prima di essere
scritte. Il separatore giusto non è dedotto da una tabella di locali ma chiesto
a Sheets: `separatoreArgomenti_()` scrive `=SUM(1,2)` in un foglio di appoggio
temporaneo e guarda il risultato. Dove la virgola separa gli argomenti ottiene
3; dove invece è il separatore decimale la formula vale `SUM(1.2)` e restituisce
1,2. Il foglio di appoggio viene rimosso subito, e il separatore rilevato
finisce nel `Log` a ogni `setup`.

Per lo stesso motivo nel codice non compaiono array letterali `{a,b,c}`: anche
il loro separatore di colonna cambia col locale. Il drill-down dei `Controlli`
usa quattro `FILTER` separati.

Se aggiungi formule, usa `~` e passa da `f_()`. Una virgola letterale funziona
finché il foglio resta nel locale in cui l'hai provata.

**Puoi cambiare il locale del foglio quando vuoi**, ma dopo averlo fatto
rilancia `setup`: le formule già scritte restano nella notazione precedente e
smettono di calcolare.

**Perché `Saldi` non usa ARRAYFORMULA.** `SUMIFS` e `COUNTIFS` non si espandono
dentro `ARRAYFORMULA`: ignorano il criterio ad array e restituiscono un valore
unico, replicato identico su ogni riga. Le varianti a criterio singolo (`SUMIF`,
`COUNTIF`) invece si espandono. Le colonne B–G di `Saldi` servono due criteri
(il socio e la validità della spesa), quindi sono formule riga per riga, scritte
in un blocco fisso di `RIGHE_SALDI` righe (100 di default, in `Costanti.gs`). Se
un giorno l'anagrafica superasse quel numero, alza la costante e rilancia
`setup`.

Stessa trappola nella colonna `valida`, che per questo usa `VLOOKUP` e non
`COUNTIFS`. Se modifichi quelle formule, la regola da ricordare è: dentro
`ARRAYFORMULA` vanno bene `SUMIF`, `COUNTIF`, `VLOOKUP`, `SUMPRODUCT`; non vanno
bene le varianti con la S finale.

**`getLastRow()` è inaffidabile su `Quote` e `Pagamenti`.** L'`ARRAYFORMULA`
della colonna `valida` si espande su tutta la colonna restituendo stringhe
vuote, e `getLastRow()` le conta come contenuto: restituisce il fondo del
foglio, non l'ultima riga vera. Per questo lo script usa `ultimaRigaDati_()`,
che guarda solo la colonna chiave. Se aggiungi codice che scrive su questi
fogli, usa quella.

Per lo stesso motivo le righe figlie vengono scritte su tre colonne soltanto:
la quarta appartiene alla formula, e scriverci dentro un valore letterale la
manderebbe in `#REF!`.

**Righe finite in fondo al foglio.** Se in `Quote` o `Pagamenti` premi
`Ctrl+Fine` e il cursore salta a una riga molto più in basso dei dati visibili,
lancia menu → Compatta Quote e Pagamenti. Le righe vengono riportate sotto
l'intestazione senza perdere nulla; i saldi non cambiano, perché sommano per
`id_spesa` e non dipendono dalla posizione.

**Non cancellare la riga 2 di `Quote` e `Pagamenti`.** L'`ARRAYFORMULA` della
colonna `valida` vive in D2: cancellare quella riga se la porta via senza
lasciare traccia — nessun `#REF!`, solo una colonna vuota che sembra sempre
essere stata così. Da quel momento la spesa esce interamente dai saldi, e in
modo simmetrico: quote e pagamenti spariscono insieme, quindi `Sbilancio`
resta a zero e i controlli di pareggio restano verdi. Per rimuovere una riga
figlia usa la modifica della spesa dalla sidebar, che le riscrive tutte.

Due controlli sorvegliano questo caso: uno verifica che la formula sia al suo
posto, l'altro che per ogni spesa attiva il numero di righe figlie valide
coincida col numero di righe figlie. Il rimedio è menu → Ripristina colonne
calcolate, che riscrive le due formule senza toccare i dati.

**Modifiche manuali alle colonne calcolate.** Le colonne `valida` e i fogli
`Saldi` e `Controlli` sono protetti con solo avviso: Google chiede conferma ma
non blocca. Se qualcuno le sovrascrive, `ripristinaColonneCalcolate()` (o un
nuovo `setup`) le rimette a posto.

**Cancellare righe a mano.** Non farlo su `Spese`: usa l'annullamento. Se
cancelli una testata lasciando quote e pagamenti, i controlli segnalano righe
orfane ma i saldi restano corretti, perché `valida` diventa 0.

**Soci disattivati.** Togliere la spunta `attivo` li nasconde dalla sidebar ma
li lascia nei saldi e nel conguaglio, che è il comportamento giusto finché
hanno un saldo diverso da zero.
