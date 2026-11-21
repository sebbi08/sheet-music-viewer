# Alle `.data`-Markierungen beim Start in die PDFs übernehmen

Stand: 2026-11-16 · Status: Entwurf · Baut auf: `2026-11-15-markup-in-pdf-design.md` ·
Teilweise ersetzt durch `2026-11-20-strict-markup-migration-design.md`

## Warum

Seit dem Merge von `feat/markup-in-pdf` (noch nicht released) stehen Markierungen in der PDF. Alte
`.<name>.data`-Dateien werden aber erst migriert, wenn man die PDF in der App öffnet. Sebastian will,
dass **alle Dateien sofort ohne `.data` teilbar sind**, nicht erst nach und nach. Der Notenordner liegt
in einem geteilten Nextcloud-Ordner.

## Ziele

- Beim Start der App (und nach dem Wechsel des Notenordners) werden alle `.data`-Dateien im Notenordner
  in ihre PDFs übernommen, mit sichtbarem Fortschritt.
- **Vorher** wird von jeder betroffenen PDF und `.data` eine Sicherung angelegt: eine ZIP-Datei im
  Notenordner (wird also über Nextcloud mitgeteilt), die in der App nicht auftaucht.
- Die Prüfung läuft bei **jedem** Start: später dazugekommene `.data`-Dateien (z. B. von jemandem, der
  noch die alte Version nutzt, über Nextcloud hereinsynchronisiert) werden ebenfalls eingesammelt.
- Das Ergebnis jeder migrierten PDF ist dasselbe wie beim Migrieren durch Öffnen (gleiche Positionen,
  gleiche Bilder, gleiche Prüfungen aus den visuellen Tests).

## Nicht-Ziele

- Wiederherstellen aus der ZIP in der App (geht von Hand: ZIP entpacken).
- Alte Backup-ZIPs automatisch aufräumen.
- Dateien außerhalb des Notenordners.
- Weiterarbeiten in der App, während die Migration läuft.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Eine Markierung geht verloren oder wird unsichtbar (z. B. `.data` gelöscht, ohne dass die PDF
  nachweislich die Markierungen enthält).
- Es wird migriert, obwohl die Sicherung unvollständig oder nicht geprüft ist.
- Backup-ZIPs (oder andere Nicht-PDF-Dateien) erscheinen in der Notenliste oder in der Suche.
- Eine Datei, die aus einem bleibenden Grund nicht migriert werden kann, wird bei **jedem** Start erneut
  gemeldet oder erneut in eine ZIP gepackt.
- Die Migration macht eine Netzwerkanfrage, oder ein Schließen des Fensters während der Migration
  blockiert die App.

## Randbedingungen

- Läuft nur auf Windows; Notenordner typischerweise in einem Nextcloud-Sync-Ordner (Dateien können kurz
  gesperrt sein).
- Offline: alle Bibliotheken gebündelt; neue Abhängigkeiten exakt gepinnt, Lizenz MIT/Apache/BSD/ISC.
- Bestehende Regeln aus der Markup-in-PDF-Spezifikation gelten unverändert: atomares Schreiben mit
  Read-back, Sidecar-Fallback nur für PDFs ohne eingebettete Daten, `.data` wird erst nach erfolgreichem
  Read-back gelöscht (`deleteLegacySidecar: true`), „eingebettete Daten gewinnen“.
- Alle GUI-Tests headless; `Noten/` wird nie direkt geöffnet (nur Kopien).

## Ansätze

1. **Gewählt: Oberfläche migriert, Hauptprogramm sucht und sichert.** Das Hauptprogramm sucht die
   Kandidaten, schreibt und prüft die ZIP und speichert wie heute (`saveMarkup`). Die Oberfläche zeigt
   das Fortschrittsfenster und migriert jede Datei mit **demselben Code** wie das Öffnen eines Blatts
   (pdf.js für Seitengrößen, `legacyToPayload`, `renderMarkupPng` mit fabric). Vorteil: genau dieser
   Weg ist durch die visuellen Tests abgesichert.
2. Alles im Hauptprogramm (pdf.js + fabric in Node mit nativer Canvas-Bibliothek): zweiter Zeichenweg
   neben dem getesteten, Risiko abweichender Bilder, schwierigere Paketierung. Verworfen.
3. Unsichtbares Hintergrundfenster: lohnt nur, wenn man währenddessen weiterarbeiten könnte; die App
   ist ohnehin gesperrt. Verworfen.

## Design

### 1. Auslöser

- Nach dem App-Start, sobald ein Notenordner gesetzt ist, und nach jeder Auswahl eines Notenordners
  (`FolderSetup`).
- Findet die Suche keine Kandidaten, merkt der Nutzer nichts (kein Fenster, kein Hinweis).
- Läuft höchstens eine Migration gleichzeitig.
- Auslöser und Fenster gehören zu `App.vue`. Die Migration startet, bevor ein Blatt geöffnet werden
  kann: ist beim Auslösen eine Notenseite (`SheetViewer`) offen, wechselt die App vorher in die
  Notenliste, sodass Migration und Anzeige nie gleichzeitig dieselbe PDF anfassen.

### 2. Kandidaten finden (Hauptprogramm)

- Rekursiv alle PDFs unter dem Notenordner (Endung `.pdf` ohne Beachtung der Groß-/Kleinschreibung);
  Ordner, deren Name mit `.` beginnt, werden übersprungen; symbolische Links/Junctions werden nicht
  verfolgt.
- Kandidat ist eine PDF, deren Begleitdatei laut `getSidecarPath` existiert. Das schließt alte Dateien
  (legacy) **und** v1-Sidecars (Fallback für nicht beschreibbare PDFs) ein.
- Ausgenommen sind Kandidaten, die bereits aus einem **bleibenden** Grund gescheitert sind und sich seit
  dem nicht verändert haben (siehe 6).
- Ergebnis: Liste relativer Pfade (für Anzeige und ZIP) plus absolute Pfade.
- Es gibt keine Vorprüfung, ob eine Datei scheitern wird: auch eine später bleibend scheiternde Datei
  wird beim ersten Auftauchen einmal gesichert (Entscheidung Builder-Check; eine Sicherung zu viel
  schadet nicht, eine doppelte Prüflogik schon).

### 3. Sicherung als ZIP (Hauptprogramm)

- Datei `Markierungen-Backup YYYY-MM-DD HH-MM.zip` im Hauptordner des Notenordners (bei Namenskollision
  ` (2)`, ` (3)` …).
- Inhalt: für jeden Kandidaten die PDF und die Begleitdatei, mit ihrem relativen Pfad (Trennzeichen `/`,
  Dateinamen UTF-8), byte-genau. PDFs werden nur gespeichert (keine Kompression), Begleitdateien dürfen
  komprimiert werden. ZIP64, falls nötig.
- Bibliothek: `yazl` (MIT, ohne Abhängigkeiten) zum Schreiben.
- Ablauf: in eine temporäre Datei im selben Ordner schreiben, dann **prüfen** (Datei erneut lesen: jeder
  Eintrag vorhanden, Größe und CRC-32 stimmen mit der Quelle überein), dann auf den endgültigen Namen
  umbenennen. Schlägt irgendetwas fehl (Platte voll, Datei gesperrt, Prüfung), wird die temporäre Datei
  gelöscht, **nichts migriert** und der Nutzer bekommt eine Meldung mit dem Grund. Beim nächsten Start
  wird es erneut versucht.
- Eine Datei, die sich beim Packen nicht lesen lässt (z. B. gesperrt), wird nicht in die ZIP
  aufgenommen und in diesem Lauf nicht migriert (vorübergehender Fehler, siehe 6); der Rest läuft weiter.
  Beim Lesen für die ZIP gibt es **keine** Sperr-Wiederholungen (sonst kann ein gesperrter Nextcloud-Ordner
  den Start um Minuten verzögern); das Speichern in die PDF behält die bestehenden ~3 s Wiederholungen.

### 4. Migration je Datei (Oberfläche)

- Nacheinander, in der Reihenfolge der relativen Pfade. Für jede Datei:
  1. PDF mit pdf.js laden (gleiche `getDocument`-Optionen wie `SheetViewer`), `loadMarkup` aufrufen.
  2. Dieselbe Umwandlung wie heute beim Öffnen: legacy `.data` → Payload in Punkten
     (`migrateLegacyOverlayData`/`toLegacyPayload`), v1-Sidecar → Payload in aktueller Seitendrehung
     (`rotatePayload`). Diese Logik wird aus `SheetViewer.vue` in ein gemeinsames Modul gezogen, das
     beide Wege benutzen; das Verhalten beim Öffnen bleibt unverändert.
  3. PNGs rendern (`renderMarkupPng`), `saveMarkup` mit allen Seiten und `deleteLegacySidecar: true`.
  4. pdf.js-Dokument freigeben, bevor die nächste Datei geladen wird.
- Enthält die alte `.data` keine Markierungen (leer, nur Leerzeichen, `[]`, oder alle Seiten mit leeren
  `objects` – das alte Programm hat solche Dateien geschrieben): die PDF wird **nicht** angefasst
  (bleibt byte-gleich, keine OCG, keine Katalog-Metadaten), die `.data` wird gelöscht (sie liegt in der
  ZIP); zählt als übernommen.
- Ist die alte `.data` ganz oder teilweise unlesbar: nichts schreiben, `.data` bleibt (bleibender Fehler
  „Alte Markierungsdatei ist beschädigt“). Abweichend vom Öffnen werden hier auch lesbare Teile nicht
  geschrieben, damit die Datei vollständig von Hand geprüft werden kann.
- Enthält die PDF bereits eingebettete Markierungen **und** hat eine `.data`: nichts schreiben, `.data`
  bleibt (bleibender Fehler „PDF enthält bereits Markierungen; alte Datei bleibt liegen“). Laut Sebastian
  nutzt niemand sonst die alte Version mit diesem Ordner (bzw. alle aktualisieren vorher); der Fall ist
  nur ein Sicherheitsnetz, kein Zusammenführen.
- Ergebnis `status: "sidecar"` (PDF nicht beschreibbar): zählt als nicht migriert, Grund „PDF kann nicht
  beschrieben werden“ (bleibend).
- Ergebnis `status: "error"` wegen Sperre (andere Anwendung, Nextcloud): Grund „Datei ist in einem
  anderen Programm geöffnet“ (vorübergehend).
- Damit die Migration vorübergehende und bleibende Fehler unterscheiden kann, bekommen `SaveMarkupResult`
  und `LoadMarkupResult` einen maschinenlesbaren Grund (z. B. `locked`, `readOnly`, `encrypted`,
  `unparseable`, `other`). Bestehende Aufrufer werten nur `status` aus und ändern ihr Verhalten nicht.
  Unbekannte Gründe (`other`) gelten als vorübergehend.
- Die Migration läuft am `markupSaves`-Speicher vorbei (direkte `saveMarkup`-Aufrufe). Hat der Speicher
  für eine Kandidaten-PDF noch ungespeicherte Änderungen (Ordnerwechsel während einer Sitzung), wird
  diese Datei in diesem Lauf übersprungen.

### 5. Fortschrittsfenster

Ein Fenster über der App, das die Bedienung sperrt (persistenter Dialog, kein Schließen per Klick
daneben oder Escape):

```
┌──────────────────────────────────────────┐
│ Markierungen werden in die PDFs übernommen │
│                                          │
│ ███████████░░░░░░░░░░░  12 von 23        │
│ Weihnachten/Amen.pdf                     │
│                                          │
│                          [ Abbrechen ]   │
└──────────────────────────────────────────┘
```

- Während der ZIP-Erstellung: „Sicherung wird erstellt …“ mit eigenem Fortschritt (Bytes oder Dateien).
- „Abbrechen“: die aktuelle Datei wird fertig migriert, dann Schluss; der Rest folgt beim nächsten
  Start. Abbrechen während der ZIP-Erstellung verwirft die ZIP und migriert nichts.
- **Zusammenfassung** am Ende (ersetzt den Fortschritt im selben Fenster, Knopf „OK“):
  „21 Dateien übernommen. Sicherung: Markierungen-Backup 2026-11-16 10-15.zip“ und, falls vorhanden, die
  Liste der nicht übernommenen Dateien mit Grund. Bei Abbruch steht dabei, wie viele noch offen sind.
- Schließen des Fensters bzw. Beenden der App während der Migration wirkt wie „Abbrechen“ und darf nie
  blockieren: der bestehende Close-Guard gilt; das Fenster schließt spätestens, wenn die aktuelle Datei
  fertig ist. Ein Update-Neustart (`restartForUpdate`) bricht die Migration genauso ab, bevor er
  `prepareToClose` aufruft.

### 6. Fehler, die bleiben, und Fehler, die vergehen

- **Vorübergehend** (gesperrt, nicht lesbar beim Packen, Abbruch): wird beim nächsten Start erneut
  versucht und erneut gesichert.
- **Bleibend** (beschädigte `.data`, PDF nicht beschreibbar/verschlüsselt/nicht lesbar, PDF hat schon
  eingebettete Markierungen): wird **einmal** in der Zusammenfassung gemeldet und danach nicht mehr
  versucht und nicht mehr gesichert, solange sich weder PDF noch Begleitdatei ändern (Merkmal: Pfad,
  Größe und Änderungszeit beider Dateien). Ändert sich eine davon, ist die Datei wieder Kandidat.
- Wo das gespeichert wird, entscheidet der Builder (lokal, nicht im Notenordner).

### 7. Notenliste und Suche

- Die Notenliste (`loadFilesAndFolder`) zeigt nur noch Ordner und PDFs (Endung `.pdf`, beliebige
  Schreibweise); Einträge mit führendem `.` bleiben wie bisher ausgeblendet.
- Die Suche (`searchForSheet`) liefert nur noch PDFs.

### 8. Tests

- Unit-Tests (vitest, ohne Electron):
  - Kandidatensuche: Unterordner, `.pdf` in beliebiger Schreibweise, Punkt-Ordner übersprungen,
    legacy- und v1-Begleitdateien, PDFs ohne Begleitdatei ignoriert, bleibende Fehler mit unverändertem
    Merkmal ausgenommen, mit geändertem Merkmal wieder dabei.
  - ZIP: Inhalt byte-gleich mit den Quellen (inklusive Umlaute in Pfaden), PDFs unkomprimiert; Prüfung
    erkennt eine beschädigte ZIP; bei Schreibfehler keine ZIP und keine temporäre Datei übrig;
    Namenskollision.
  - Notenliste/Suche: ZIP und andere Nicht-PDFs werden nicht geliefert.
  - Gemeinsames Umwandlungsmodul: dieselben Ergebnisse wie bisher für die bestehenden Testfälle.
- Visuell/e2e (headless, auf einer Kopie des Korpus):
  - Die Sammelmigration läuft über den kompletten Korpus; danach erfüllt jede migrierte PDF dieselben
    Prüfungen wie beim Migrieren durch Öffnen (A, B, Ar, C, D, E, Er gegen die Referenz der alten App).
  - Keine `.data`-Datei bleibt übrig (außer bei bewusst präparierten Fehlerfällen), genau eine ZIP
    liegt im Hauptordner, ihr Inhalt ist byte-gleich mit den Dateien vor der Migration.
  - Ein zweiter Start findet nichts und zeigt kein Fenster.
  - Keine Netzwerkanfrage.

## Dem Builder überlassen

- Lesen/Prüfen der ZIP (eigener Central-Directory-Leser oder eine zweite kleine Bibliothek wie
  `yauzl`).
- Wie Fortschritt vom Hauptprogramm zur Oberfläche kommt (tRPC-Subscription oder Polling).
- Aufteilung des gemeinsamen Umwandlungsmoduls und der Vue-Komponente.
- Speicherort und Format der „bleibenden Fehler“ (lokal).
- Exakte Texte außer den oben genannten, solange sie deutsch und knapp sind.
