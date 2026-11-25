# Favoriten, und Einstellungen je Blatt folgen einer verschobenen PDF

Stand: 2026-11-25 · Status: freigegeben · Ergänzt: `2026-11-22-folder-config-design.md`,
`2026-11-23-page-divider-design.md` (Teil `sheets` in `.config.json`; hebt dort das Nicht-Ziel „Einstellungen
folgen einer umbenannten oder verschobenen PDF“ auf)

## Warum

Sebastian will die Blätter, die er oft braucht, direkt von der Startseite öffnen, ohne sich durch die Ordner zu
klicken. Ein Blatt wird dazu als **Favorit** markiert: im Viewer und in der Ordneransicht.

Die Einstellungen eines Blatts (bisher die Seitenteiler, jetzt auch die Favoriten-Markierung) hängen heute am
Pfad der PDF im Notenordner. Wird eine PDF verschoben oder umbenannt, sind sie weg. Sebastian will, dass sie
der PDF folgen.

## Ziele

- Ein Blatt lässt sich als Favorit markieren und wieder entmarkieren: im Viewer (Knopf in der App-Leiste) und
  in der Ordneransicht (Herz auf der Karte, auch in den Suchergebnissen).
- Die Startseite zeigt die Favoriten; ein Klick öffnet das Blatt.
- Favoriten stehen in `.config.json` und gelten damit auf jedem PC, der den Notenordner synchronisiert.
- Verschwindet die PDF eines Favoriten, **bleibt die Markierung** gespeichert; die Startseite zeigt den
  Favoriten nicht, solange die PDF fehlt. Taucht sie unter demselben Pfad wieder auf, ist sie wieder Favorit
  (Sebastian, 2026-11-25).
- Wird eine PDF im Notenordner verschoben oder umbenannt, folgen ihr **alle** Einstellungen des Blatts
  (Favorit und Seitenteiler).

## Nicht-Ziele

- **Setlisten** folgen einer verschobenen PDF nicht: Sie verweisen weiter über den Pfad auf ein Blatt, wie
  heute *(Sebastian, 2026-11-25: Setlisten sind sehr kurzlebig)*.
- Eine eigene Reihenfolge der Favoriten auf der Startseite (sie sind nach Namen sortiert).
- Favoriten für Ordner oder für PDFs außerhalb des Notenordners.
- Einstellungen folgen einer PDF, die ein anderes Programm **vollständig neu gespeichert** hat (nicht nur
  angehängt), und gleichzeitig verschoben wurde. Dann gilt wieder nur der Pfad, wie heute.
- Einstellungen gehen auf eine **Kopie** über. Eine Kopie (die PDF am alten Pfad gibt es noch) beginnt ohne
  Einstellungen.
- Verwaiste Einträge aufräumen (PDF dauerhaft gelöscht): Sie bleiben in `.config.json` stehen.
- Zusammenführen gleichzeitiger Änderungen zweier PCs (Nextcloud legt wie bisher eine Konfliktkopie an).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Eine Markierung oder ein Teiler geht verloren, weil der Notenordner gerade nicht erreichbar ist (Laufwerk
  schläft, Nextcloud noch nicht fertig) oder eine PDF kurz fehlt.
- Einstellungen springen auf eine falsche PDF über (eine Kopie, eine andere Stimme desselben Stücks).
- Favorisieren, Öffnen eines Blatts oder der Startseite verändert eine PDF (auch nur ein Byte).
- Öffnen eines Blatts, der Ordneransicht oder der Startseite **ohne Änderung** schreibt `.config.json`
  (Nextcloud synchronisiert sonst ständig). Geschrieben wird nur beim Markieren/Entmarkieren, beim Speichern
  eines Teilers und wenn ein Eintrag einer verschobenen PDF folgt.
- Ein Klick auf das Herz in der Ordneransicht öffnet das Blatt.
- Eine nicht lesbare `.config.json` wird überschrieben, oder Setlisten, `markupMigrated`, unbekannte Felder
  und die Einstellungen anderer Blätter ändern sich beim Schreiben.
- Startseite oder Ordneransicht werden spürbar langsamer, weil PDFs gelesen werden.

## Randbedingungen

- Windows, Notenordner in einem geteilten Nextcloud-Ordner; Dateien können kurz gesperrt sein.
- `.config.json`: Regeln aus `2026-11-22-folder-config-design.md` (frisch lesen, nur den eigenen Teil ändern,
  atomar schreiben mit Zurücklesen, nicht schreiben ohne echte Änderung, `unreadable` nie überschreiben,
  unbekannte Felder behalten). `version` bleibt 1.
- PDFs mit unseren Markierungen werden bei jedem Speichern hinten verändert (inkrementelles Update); der
  ursprüngliche Teil bleibt byte-gleich vorne, seine Länge steht in `/SMV_Markup /OriginalLength`.
- Code im Hauptprogramm ohne Electron-Importe, in Node unit-getestet; GUI-Tests headless.

## Ansätze

Wo die Favoriten stehen *(Sebastian, 2026-11-25)*:

1. **Gewählt: `.config.json` im Notenordner**, wie Setlisten und Teiler; auf allen PCs gleich.
2. Im App-Profil je PC (verworfen: auf jedem PC neu markieren).

Wie Einstellungen einer verschobenen PDF folgen *(Sebastian, 2026-11-25)*:

1. **Gewählt: Pfad als Schlüssel plus Fingerabdruck der PDF.** Jeder Eintrag speichert zusätzlich eine
   Prüfsumme des ursprünglichen Teils der PDF. Fehlt unter einem Pfad der Eintrag, sucht die App einen Eintrag
   mit gleichem Fingerabdruck, dessen PDF es nicht mehr gibt, und zieht ihn um. Kopien bleiben unabhängig;
   Favorisieren schreibt nie in eine PDF.
2. Einstellungen in der PDF speichern (verworfen: jedes Markieren schreibt die PDF, schreibgeschützte PDFs
   könnten keine Favoriten sein, die Startseite müsste jede PDF öffnen; widerspricht „Teiler nie in der PDF“).
3. Nur der Fingerabdruck als Schlüssel (verworfen: Kopien teilten sich Einstellungen, und jede Ordneransicht
   müsste alle PDFs prüfsummieren, um die Herzen zu zeigen).

Wie der Favorit gespeichert wird *(Entscheidung Claude, folgt aus Ansatz 1: der Eintrag je Blatt zieht als
Ganzes um)*:

1. **Gewählt: Feld `favorite` im Eintrag des Blatts** unter `sheets`, neben `pageDividers`.
2. Eigene Liste `favorites` (verworfen: zweiter Ort mit Pfaden, der beim Umzug mitgepflegt werden müsste; eine
   eigene Reihenfolge ist nicht gewünscht).

## Design

### `.config.json`

```json
{
  "version": 1,
  "sheets": {
    "Pop/Abba Gold.pdf": {
      "favorite": true,
      "pageDividers": { "3": 0.42 },
      "fingerprint": { "sha256": "9f2c…", "length": 1834211 }
    }
  }
}
```

- `favorite`: `true` = Favorit. Nicht markiert = Feld fehlt. Entmarkieren entfernt das Feld.
- `fingerprint`: SHA-256 (hex, klein) und Länge der **Originalbytes** der PDF (siehe unten). Er gehört zu den
  Einstellungen, ist aber selbst keine: Ein Eintrag, der außer `fingerprint` (und unbekannten Feldern) nichts
  mehr enthält, wird entfernt, wie heute ein leerer Eintrag *(Entscheidung Claude: ein reiner Fingerabdruck
  hätte keinen Nutzen)*. Ein Eintrag mit unbekannten Feldern bleibt dagegen stehen (sie gehören einer neueren
  Version).
- Schema: beide Felder optional im Blatt-Objekt (`favorite` boolean, `fingerprint` Objekt mit `sha256`
  String und `length` Zahl, `.loose()`). Ein falscher Typ macht die Datei `unreadable` wie bei den Teilern.
  Ältere App-Versionen kennen die Felder nicht und erhalten sie beim Schreiben.
- **Schreiben eines Eintrags** (Favorit setzen/entfernen, Teiler speichern) berechnet den Fingerabdruck der
  PDF am angegebenen Pfad und speichert ihn mit (auch wenn er sich geändert hat: der Pfad gewinnt; ist er
  gleich – `sha256` und `length` –, bleibt das gespeicherte Objekt samt unbekannter Felder stehen). Kann die
  PDF nicht gelesen werden, wird ohne Fingerabdruck geschrieben (ein vorhandener bleibt stehen) und die
  Änderung trotzdem gespeichert *(Entscheidung Claude: Favorisieren soll nicht an einer gesperrten PDF
  scheitern)*. Bestehende Einträge ohne Fingerabdruck bekommen ihn erst beim nächsten Schreiben, nie beim
  bloßen Öffnen (Anti-Ziel).

### Fingerabdruck

- Originalbytes = die ersten *n* Bytes der Datei, wenn sie unsere Markierungs-Metadaten trägt, sonst die
  ganze Datei. *n* wird **ohne PDF-Parser** bestimmt, durch eine Byte-Suche *(Entscheidung Claude nach dem
  Review: `readMarkup` lädt die ganze PDF mit pdf-lib, für die Suche über den Ordner zu langsam; unser
  Schreiber legt das Metadaten-Objekt unkomprimiert ab)*: der **letzte** Treffer von
  `/OriginalLength <n> … /UpdateStart <m>` (Leerraum dazwischen beliebig) in der Datei, für den gilt
  `isValidSectionEnd(bytes, n)` (vor *n* steht `%%EOF`) und `n ≤ m ≤ Dateilänge`. Ohne solchen Treffer: die
  ganze Datei. Diese Definition ist **fest** (Fingerabdrücke stehen dauerhaft in der geteilten Datei); eine
  spätere Version darf sie nur erweitern, wenn alte Fingerabdrücke weiter passen.
- Folge: Das Speichern unserer Markierungen ändert den Fingerabdruck nicht. Hängt ein anderes Programm ein
  Update an und übernimmt dabei unsere Metadaten unkomprimiert (übliche inkrementelle Speicherung), bleibt er
  ebenfalls gleich; schreibt es sie komprimiert oder speichert es die Datei neu, ändert er sich (dann hilft nur
  der Pfad, siehe Nicht-Ziele).
- Berechnet im Hauptprogramm, ohne die Datei zu verändern (Datei lesen, suchen, SHA-256 der ersten *n* Bytes;
  ob am Stück oder gestreamt, entscheidet der Builder).
- Ein Zwischenspeicher im Hauptprogramm (nur im Speicher) merkt sich je echtem Pfad Größe, Änderungszeit und
  Fingerabdruck, damit dieselbe PDF nicht zweimal gelesen wird.

### Umzug eines Eintrags

Ein Eintrag ist **verwaist**, wenn er einen Fingerabdruck hat und es seine PDF nicht gibt: `stat` meldet
„nicht vorhanden“ (`ENOENT`/`ENOTDIR`). Jeder andere Fehler (Notenordner nicht erreichbar, Zugriff verweigert,
gesperrt) heißt „unbekannt“, und der Eintrag gilt **nicht** als verwaist. Ist der Notenordner selbst nicht
erreichbar, wird gar nichts umgezogen.

Ein Eintrag zieht von Pfad A nach Pfad B um, wenn alles gilt:

- A ist verwaist, B existiert und hat **keinen** eigenen Eintrag,
- der Fingerabdruck von B ist gleich dem von A,
- es gibt **genau einen** verwaisten Eintrag mit diesem Fingerabdruck (sonst mehrdeutig: nichts tun).

Außerdem gilt ein Eintrag als **umbenannt nur in der Schreibweise**, wenn sein Pfad A zwar per `stat`
erreichbar ist, aber auf dieselbe Datei wie B zeigt (gleiche `dev`/`ino`), A und B sich nur in Groß-/
Kleinschreibung unterscheiden und der Name aus A im Ordner nicht mehr so aufgeführt ist (Windows: Datei von
`abba gold.pdf` in `Abba Gold.pdf` umbenannt). Dann zieht er ohne Fingerabdruck-Vergleich nach B um
*(Entscheidung Claude nach dem Review)*. Sonst bleiben Schlüssel exakt der Pfad, wie geschrieben: Erreicht man
dieselbe PDF über eine Verknüpfung unter zwei Pfaden, hat jeder Pfad seinen eigenen Eintrag, und zwischen
solchen Pfaden wird nicht umgezogen (gleiche `dev`/`ino`, aber beide Namen aufgeführt) *(Entscheidung Claude:
wie bei den Teilern; Verknüpfungen innerhalb des Notenordners sind selten)*.

Beim Öffnen und Speichern wird der Schlüssel zuerst auf die Schreibweise auf der Platte gebracht: jeder Teil
des Pfads unterhalb des Notenordners so, wie sein Ordner ihn aufführt (exakt gleich gewinnt, sonst der
einzige Name, der sich nur in Groß-/Kleinschreibung unterscheidet), und nur, wenn beide Schreibweisen dieselbe
Datei erreichen; kein oder mehrere Treffer: der Schlüssel bleibt, wie er ist. So findet ein Blatt aus einer
Setliste mit älterer Schreibweise (Windows) den schon umgezogenen Eintrag, und ein Druck aufs Herz legt
keinen zweiten an *(Entscheidung nach dem Abschluss-Review)*.

Der Umzug ist ein Schreiben wie jedes andere (frisch lesen, prüfen, ob die Bedingungen noch gelten, atomar
schreiben). Der Eintrag bleibt dabei unverändert, nur sein Schlüssel ändert sich.

Wann gesucht wird:

0. **Bei jedem Schreiben** eines Eintrags (Favorit umschalten, Teiler speichern), wenn der Pfad noch keinen
   Eintrag hat: Im selben Schreibschritt werden zuerst die Umzugsregeln mit dem ohnehin berechneten
   Fingerabdruck angewandt, dann die Änderung auf den (umgezogenen) Eintrag *(Entscheidung Claude nach dem
   Review: sonst entstünde ein neuer Eintrag am neuen Pfad, und der alte bliebe für immer verwaist, z. B. nach
   einem Klick auf das leere Herz einer verschobenen PDF in der Ordneransicht)*. Deshalb schickt die
   Oberfläche beim Umschalten den **gewünschten** Zustand (`favorite: true/false`), kein „umschalten“: Wer auf
   das leere Herz einer verschobenen Favoriten-PDF drückt, erhält einen Favoriten, nicht dessen Gegenteil.
1. **Beim Öffnen eines Blatts** ohne eigenen Eintrag: Gibt es verwaiste Einträge, wird der Fingerabdruck des
   geöffneten Blatts berechnet und wie oben verglichen. Gibt es keine verwaisten Einträge, wird die PDF nicht
   gelesen. So erscheinen Teiler und Favorit einer verschobenen PDF beim ersten Öffnen am neuen Ort.
2. **Auf der Startseite**, für Favoriten, deren PDF fehlt: Die App sucht im Notenordner (rekursiv, Links
   gefolgt, jede echte Datei einmal, wie die Suche der Schranke `scanMigrationCandidates`) eine PDF ohne
   eigenen Eintrag mit gleichem Fingerabdruck. Zuerst werden PDFs mit **gleichem Dateinamen** geprüft
   (verschoben), dann PDFs im **gleichen Ordner** (umbenannt), erst dann alle übrigen. Die Suche läuft im
   Hintergrund; gefundene Favoriten erscheinen, sobald ihr Eintrag umgezogen ist. Je Start der App wird für
   einen fehlenden Favoriten höchstens einmal vollständig gesucht *(Entscheidung Claude: ein dauerhaft
   gelöschter Favorit soll nicht bei jedem Besuch der Startseite alle PDFs lesen lassen)*.

Teiler-Einträge ohne Favorit werden nur beim Öffnen umgezogen (Fall 1), nicht von der Startseite gesucht.

### Startseite (`src/views/Overview.vue`)

```
[ 📁 Folder Selection ] [ 🔖 Set Lists ]

Favoriten
[ ♥            ] [ ♥            ] [ ♥            ]
[  Abba Gold   ] [    Amen      ] [  Arsenal     ]
[  Pop         ] [  Konzert/2026] [  (Notenordner)]
```

- Unter den beiden bestehenden Karten eine Überschrift „Favoriten“ und je vorhandenem Favoriten eine Karte im
  Stil der Suchergebnisse: Name ohne `.pdf`, darunter der Ordner relativ zum Notenordner (leer bzw. nichts für
  die oberste Ebene). Ein Klick öffnet das Blatt wie aus der Ordneransicht.
- Auf jeder Karte ein Herz zum Entmarkieren (dasselbe Umschalten wie in der Ordneransicht; die Karte
  verschwindet).
- Sortiert nach Name (deutsche Sortierung, ohne Groß-/Kleinschreibung), bei gleichem Namen nach Ordner.
- Ohne Favoriten: ein kurzer Hinweis „Noch keine Favoriten. Markiere Blätter mit dem Herz.“ *(Entscheidung
  Claude: zeigt, wo es die Funktion gibt)*.
- Favoriten, deren PDF fehlt, bekommen keine Karte (die Markierung bleibt gespeichert); nach der Suche stehen
  sie in der Zeile „nicht gefunden“ (siehe „Nachtrag: nicht gefundene Favoriten“). Ist unklar, ob es
  sie gibt (`stat` meldet einen anderen Fehler als „nicht vorhanden“), wird die Karte gezeigt; das Öffnen
  meldet dann den Fehler wie heute *(Entscheidung Claude)*.
- Unter dem Namen steht der Ordner relativ zum Notenordner; für die oberste Ebene steht dort nichts.
- Scheitert das Schreiben eines Umzugs (gesperrte Datei), bleibt alles wie es war, ohne Meldung; der nächste
  Besuch versucht es wieder *(Entscheidung Claude)*.
- Nicht lesbare `.config.json` (auch neuere Version): statt der Favoriten ein Hinweis mit Grund, wie bei den
  Setlisten; die anderen Karten funktionieren.

### Ordneransicht (`src/views/SheetSelection.vue`)

- Jede PDF-Karte (Ordnerinhalt und Suchergebnisse) bekommt oben rechts einen Herz-Knopf: gefülltes rotes Herz
  (`mdi-heart`) = Favorit, Umriss (`mdi-heart-outline`) = nicht. Ein Klick schaltet um und öffnet das Blatt
  **nicht**. Ordner-Karten haben kein Herz.
- Die Markierungen kommen aus einem Lesen von `.config.json` beim Betreten des Ordners bzw. der Suche
  (kein Lesen von PDFs). Beim bloßen Anzeigen wird nicht umgezogen; die Karte einer verschobenen PDF zeigt bis
  zum ersten Öffnen oder Schreiben (Fall 0/1) ein leeres Herz.
- Nicht lesbare `.config.json`: keine Herzen; ein Druck ist nicht möglich *(Entscheidung Claude: keine
  Meldung je Karte; die Startseite zeigt den Grund)*.

### Viewer (`src/App.vue`, `src/views/SheetViewer.vue`)

- In der App-Leiste ein Herz-Knopf neben „+“ (Setlisten): `mdi-heart` wenn Favorit, sonst
  `mdi-heart-outline`. Ein Druck schaltet um.
- Der Zustand kommt aus demselben Laden wie die Teiler beim Öffnen des Blatts (einschließlich Umzug, Fall 1).
- Blatt außerhalb des Notenordners: Knopf aus. Nicht lesbare `.config.json`: Knopf an, ein Druck schaltet
  nicht um und zeigt den Grund (wie der Teiler-Knopf).

### Umschalten und Fehler

- Umschalten schickt Blatt und neuen Zustand ans Hauptprogramm, das genau `favorite` dieses Blatts setzt oder
  entfernt (plus Fingerabdruck, siehe oben). Die Oberfläche zeigt den neuen Zustand sofort; scheitert das
  Speichern, springt sie zurück und zeigt eine Meldung mit Grund.
- Doppelte Drücke kurz hintereinander werden der Reihe nach gespeichert; es gilt der letzte.

### Dokumentation

AGENTS.md: Abschnitt „Favoriten“ (Speicherort, Fingerabdruck, Umzugsregeln, Tests);
`2026-11-23-page-divider-design.md`: Nicht-Ziel „folgen einer verschobenen PDF“ als aufgehoben markieren.

### Nachtrag: nicht gefundene Favoriten (2026-11-25, freigegeben)

Warum: ein Favorit, dessen PDF für immer gelöscht ist, blieb gespeichert, und die Hintergrundsuche las bei
jedem App-Start alle PDFs mindestens dieser Größe (bei Nextcloud „Dateien bei Bedarf“ lädt das den Ordner
herunter). Der Nutzer soll solche Favoriten sehen und entfernen können.

```
⚠ 2 Favoriten nicht gefunden                 [Anzeigen]
    Gloria – Chor/Alt                        [Entfernen]
    Panis angelicus – Weihnachten            [Entfernen]
                                             [Alle entfernen]
```

- **Nicht gefunden** ist ein Favorit, dessen PDF fehlt (`stat`: nicht vorhanden; hinter einer nicht
  erreichbaren Verknüpfung: unklar, zählt nicht) und der entweder keinen Fingerabdruck hat (er kann nie
  gefunden werden) oder in diesem App-Lauf vollständig gesucht und nicht gefunden wurde. Ein Favorit, dessen
  Suche noch läuft oder unvollständig war, steht nicht in der Zeile; so erscheint ein verschobener Favorit, der
  gleich gefunden wird, nie als „nicht gefunden“.
- Unter den Favoriten-Karten (auch wenn es keine gibt; dann ohne den Hinweis „Noch keine Favoriten“) eine
  Zeile „1 Favorit nicht gefunden“ bzw. „N Favoriten nicht gefunden“, zunächst zugeklappt. „Anzeigen“ klappt
  die Liste auf (Name ohne `.pdf` – alter Ordner, sortiert wie die Karten), „Ausblenden“ zu.
- „Entfernen“ entmarkiert den Favoriten über das bestehende Umschalten (`favorite` fällt weg; Teiler
  bleiben mit dem Fingerabdruck und folgen weiter einer zurückkehrenden PDF; ein Eintrag mit nur noch dem
  Fingerabdruck fällt wie bisher weg). Die Zeile verschwindet sofort;
  scheitert das Speichern, kommt sie zurück mit Meldung. „Alle entfernen“ tut das für jeden Eintrag der Liste.
- Ein nicht entfernter, nicht gefundener Favorit wird wie bisher einmal je App-Lauf gesucht.
- Umsetzung *(Entscheidung Claude)*: `loadFavorites` liefert statt der Anzahl `missing` die Liste `notFound`
  (`FavoriteSheet[]`); `relinkMissingFavorites` meldet zusätzlich, wie viele Favoriten es vollständig ohne
  Treffer gesucht hat, und die Startseite lädt danach neu.

## Tests

- Unit (Node): Fingerabdruck (ganze Datei; mit unserem Markierungs-Abschnitt nur die Originalbytes, gleich vor
  und nach einem Speichern von Markierungen; verschiedene PDFs verschieden); Schreiben von `favorite`
  (setzen, entfernen, Eintrag mit nur Fingerabdruck verschwindet, unbekannte Felder und andere Teile
  bleiben, kein Schreiben ohne Änderung, `unreadable` nie überschrieben); Umzugsregeln (genau ein verwaister
  Eintrag zieht um; mehrdeutig nichts; alte PDF existiert noch = Kopie, nichts; Ziel hat eigenen Eintrag,
  nichts; Ordner nicht erreichbar oder anderer `stat`-Fehler, nichts; Umzug beim Schreiben, gewünschter
  Zustand gewinnt; nur Schreibweise geändert zieht um, Verknüpfung nicht); Fingerabdruck-Definition (letzter
  gültiger Treffer, ungültiges `n` ignoriert, Update eines anderen Programms mit übernommenen Metadaten);
  Sortierung der Startseite.
- Visuell (`tests/visual/favorites.visual.ts`, synthetische Ordner, headless): im Viewer markieren → Herz in
  der Ordneransicht → Karte auf der Startseite öffnet das Blatt; in der Ordneransicht entmarkieren, der Klick
  öffnet das Blatt nicht; PDF verschieben und umbenennen → Startseite zeigt sie am neuen Ort,
  `.config.json` hat den neuen Schlüssel; Teiler folgen einer verschobenen PDF beim Öffnen; fehlende PDF →
  nicht gezeigt, Markierung bleibt, PDF zurück → wieder gezeigt; Kopie bekommt nichts; Öffnen ohne Änderung
  schreibt `.config.json` nicht; nicht lesbare `.config.json` zeigt den Hinweis und schreibt nichts; die PDF
  bleibt byte-gleich.

## Dem Builder überlassen

- Form der tRPC-Aufrufe (z. B. ein Laden der Einstellungen eines Blatts für den Viewer, Favoriten des Ordners
  für Startseite und Ordneransicht, Umschalten, Hintergrundsuche) und ob die Startseite die Hintergrundsuche
  abwartet oder neu lädt.
- Wie der Pfad-Schlüssel in der Ordneransicht gebildet wird (muss `sheetKey` entsprechen).
- Aussehen im Detail (Größe und Lage des Herz-Knopfs, Abstände), solange es zum bestehenden Kartenstil passt.
- Größenfilter bei der Suche (z. B. nur PDFs prüfen, deren Größe mindestens die gespeicherte Länge ist).
