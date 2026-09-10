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

**Notazione delle formule.** Apps Script scrive le formule in notazione en_US:
nomi di funzione in inglese e virgola come separatore. Nell'interfaccia le
vedrai tradotte e col punto e virgola. È normale e non dipende dalla lingua del
foglio.

**Se i Saldi mostrano un valore solo invece di una colonna**, l'`ARRAYFORMULA`
non si è espansa: controlla che le colonne B–G di `Saldi` non contengano altro
sotto la riga 2, poi rilancia `setup`.

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
