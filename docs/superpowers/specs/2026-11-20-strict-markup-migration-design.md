# Migration als Schranke: erst alle `.data` übernehmen, danach nur noch die PDF

Stand: 2026-11-20 · Status: freigegeben · Ändert: `2026-11-15-markup-in-pdf-design.md` (Abschnitt 1
„Fallback“, Abschnitt 7) und `2026-11-16-bulk-markup-migration-design.md` (Ziele, Abschnitte 1, 2, 4, 5, 6)

## Warum

Das Review von `v1.15.1..HEAD` (2026-11-20, noch nichts davon released) hat 15 Befunde ergeben. Die
meisten haben dieselbe Wurzel: Markierungen können an **zwei Orten** stehen (in der PDF und in einer
`.data`-Begleitdatei), und drei Mechanismen wechseln dazwischen: der Sidecar-Fallback beim Speichern,
die Migration beim Öffnen und die Sammelmigration mit ihrer Liste bleibender Fehler. In den Übergängen
gehen Markierungen verloren oder werden unsichtbar (unlesbare `.data` gilt als „keine“, eine Teil-PDF
verdeckt die `.data`, alte Markierungen tauchen wieder auf), oder eine PDF lässt sich dauerhaft nicht
mehr bearbeiten.

Sebastian entscheidet deshalb: Die Migration wird eine **Schranke**. Solange nicht alle `.data`-Dateien
des Notenordners übernommen sind, lässt sich die App nicht benutzen. Danach spielen `.data`-Dateien
keine Rolle mehr; Markierungen stehen nur noch in der PDF. PDFs, die sich nicht beschreiben lassen,
muss der Nutzer selbst reparieren. Solche Fälle sind sehr selten.

## Ziele

- **Schranke:** Für einen Notenordner, der noch nicht als übernommen gilt, werden beim Start (und nach
  einem Ordnerwechsel) alle `.data`-Dateien in ihre PDFs übernommen. Gelingt das nicht für alle, zeigt
  die App die Fehler und wird geschlossen. Das wiederholt sich bei jedem Start, bis alles übernommen ist.
- **Alle Fehler auf einmal:** Es wird nicht beim ersten Fehler abgebrochen. Jede Datei wird geprüft, alle
  Fehler stehen in einer Liste, jeder mit der genauen Ursache und dem, was der Nutzer tun muss.
- **Alles oder nichts bei der Prüfung:** Scheitert die Prüfung auch nur einer Datei, bleibt der Ordner
  unverändert (keine PDF beschrieben, keine `.data` gelöscht, keine ZIP).
- **Danach endgültig:** Nach einem fehlerfreien Durchlauf gilt der Ordner als übernommen. Die App liest
  und schreibt dort nie wieder eine `.data`-Datei.
- **Prüfung bei jedem Öffnen:** Kann die App in eine PDF keine Markierungen speichern, sagt sie das bei
  **jedem** Öffnen mit der Ursache. Nach der Bestätigung sind die Noten lesbar, Bearbeiten ist aus.

## Nicht-Ziele

- PDFs in der App reparieren (Kennwortschutz entfernen, neu speichern).
- Eine beschädigte `.data` durch die App löschen: das macht der Nutzer von Hand.
- `.data`-Dateien, die nach der Übernahme in den Ordner kommen (z. B. von jemandem mit der alten
  Version): Sie werden ohne Hinweis ignoriert. Das hebt das Ziel „Prüfung bei jedem Start“ der
  Spezifikation vom 16.11. auf.
- Wiederherstellen aus der ZIP in der App. Wer von Hand aus der ZIP wiederherstellt, muss danach
  `markup-migrated-folders.json` im App-Profil löschen, damit die Schranke erneut läuft.
- Dateien, die die Notenliste des aktuellen Ordners nicht erreicht (z. B. PDFs einer Setliste aus einem
  früheren Ordner): eine `.data` daneben wird nicht gelesen und nicht angefasst.
- Der Schreiber wird nicht toleranter gegenüber ungewöhnlich aufgebauten PDFs. Sie werden jetzt
  gemeldet statt still zu scheitern.
- Die Review-Befunde ohne Bezug zu den zwei Speicherorten bekommen eine eigene Runde: verwaister
  Stempel im eigenen Update wird abgeschnitten (`buildMarkedPdf`), Wettlauf beim erneuten Öffnen
  während eines Speicherns (`applyLoadedMarkup`), eine nicht renderbare Seite blockiert das Speichern
  des ganzen Blatts (`saveQueue`), `realpath` ohne Rückfall.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Eine Markierung geht verloren oder wird unsichtbar. Insbesondere: Ein Ordner wird als übernommen
  gemerkt, obwohl die Suche unvollständig war (Unterordner nicht lesbar, Suche gescheitert) oder noch
  eine `.data` mit Markierungen zu einer vorhandenen PDF daliegt.
- Eine gescheiterte Prüfung verändert eine Datei im Notenordner oder legt eine ZIP an.
- Die App schreibt irgendwo eine `.data`-Datei.
- Ein Blatt lässt sich öffnen, solange der aktuelle Notenordner nicht als übernommen gilt.
- Die Liste endet beim ersten Fehler, oder zeigt „Unbekannter Fehler“ ohne die eigentliche Meldung.
- Der Nutzer ist ausgesperrt, ohne einen anderen Notenordner wählen zu können.
- Die Prüfung beim Öffnen meldet nichts, und das erste Speichern scheitert dann aus einem Grund, den
  sie hätte erkennen können (verschlüsselt, schreibgeschützt, nicht beschreibbarer Aufbau).
- Eine Netzwerkanfrage, oder ein Schließen des Fensters, das blockiert.

## Randbedingungen

- Läuft nur auf Windows; Notenordner typischerweise in einem geteilten Nextcloud-Ordner (Dateien können
  kurz gesperrt sein). Offline; keine neuen Abhängigkeiten nötig.
- Der Sidecar-Fallback (v1-Format) wurde nie released. v1-Begleitdateien gibt es nur aus Testbuilds; die
  Schranke übernimmt sie trotzdem wie bisher.
- Unverändert gelten: inkrementelles Update, das ersetzt wird; atomares Schreiben mit Read-back und
  ~3 s Wiederholungen bei Sperre; Format und Prüfung der Backup-ZIP; ungespeicherte Änderungen im
  `markupSaves`-Speicher mit Wiederholung alle 30 s und Rückfrage beim Schließen; Single-Instance-Lock.
- Alle GUI-Tests headless; `Noten/` wird nie direkt geöffnet (nur Kopien).

## Ansätze

1. **Gewählt: erst alles prüfen, dann übernehmen.** Durchgang 1 wandelt jede Datei um und baut die neue
   PDF im Speicher, ohne zu schreiben. Nur wenn alle Dateien bestehen, folgen Sicherung und Schreiben
   (Durchgang 2). Vorteil: Im üblichen Fehlerfall wurde nichts angefasst, es gibt nichts
   zurückzurollen und genau eine ZIP. Der Probelauf ohne Schreiben ist derselbe Code, den die Prüfung
   beim Öffnen braucht. Preis: Jede Datei wird zweimal umgewandelt, die Migration dauert einmalig etwa
   doppelt so lang.
2. Übernehmen, was geht, den Rest auflisten (ein Durchgang wie heute). Schneller und weniger Code, aber
   nach einem gescheiterten Start ist der Ordner halb übernommen, und jeder weitere gescheiterte Start
   schreibt eine weitere ZIP. Verworfen.
3. Alle neuen PDFs als temporäre Dateien vorbereiten und am Ende austauschen. Spart die doppelte
   Umwandlung, braucht aber den Platz der Bibliothek ein zweites Mal und eine eigene Behandlung für
   Dateien, die sich zwischendurch ändern. Verworfen.

## Design

### 1. Wann ein Ordner als übernommen gilt

- Das Hauptprogramm führt lokal im App-Profil (`userData`), nie im Notenordner, die Datei
  `markup-migrated-folders.json` mit den Notenordnern, die als übernommen gelten. Schlüssel ist der
  aufgelöste Ordnerpfad, unter Windows ohne Beachtung der Groß-/Kleinschreibung (wie heute
  `ReadOnlyFolders`). *(Entscheidung Claude: lokal statt im Ordner, damit ein Rechner, dessen
  Nextcloud-Kopie noch `.data`-Dateien enthält, sie übernimmt statt sie zu ignorieren.)*
- Ein Ordner wird eingetragen, wenn ein Durchlauf der Schranke **ohne einen einzigen Fehler** endet: die
  Suche hat jeden Unterordner vollständig gelesen, und jeder Kandidat ist übernommen. Das gilt auch,
  wenn die Suche keinen Kandidaten findet (neue Installation, schon übernommener Ordner auf einem
  zweiten Rechner).
- Die App trägt einen Ordner nie wieder aus. Fehlt die Datei oder ist sie unlesbar, gilt kein Ordner als
  übernommen. Lässt sie sich nicht schreiben, wird das nur protokolliert; die Schranke läuft dann beim
  nächsten Start erneut.
- Ein Unterordner oder übergeordneter Ordner eines eingetragenen Ordners ist ein eigener Ordner.

### 2. Auslöser und Sperre

- Nach dem App-Start, sobald ein Notenordner gesetzt ist, und nach jeder Auswahl eines Notenordners:
  Gilt der Ordner als übernommen, passiert nichts (auch keine Suche mehr). Sonst läuft die Schranke.
- Von Beginn der Suche an liegt ein sperrendes Fenster über der App (heute erst ab der Sicherung; bis
  dahin wurden Klicks auf ein Blatt still verworfen). Kein Blatt lässt sich öffnen, bevor die Schranke
  für den aktuellen Ordner bestanden ist.
- Vorher wie heute: Ist ein Blatt offen, wechselt die App in die Notenliste. Zusätzlich werden
  ungespeicherte Änderungen gespeichert (`markupSaves`); hat ein Kandidat danach noch ungespeicherte
  Änderungen, ist das ein Fehler dieser Datei (Grund „ungespeicherte Änderungen“).
- Es läuft höchstens eine Schranke gleichzeitig.

### 3. Suche (Hauptprogramm)

- Die Suche erfasst **genau das, was die Notenliste zeigt** (`resolveListedEntry` in
  `src/sheetFiles.ts`): rekursiv alle PDFs mit Endung `.pdf` in beliebiger Schreibweise, Einträge mit
  führendem `.` übersprungen, Cloud-Platzhalter als normale Dateien.
- **Neu** *(Entscheidung Claude nach dem Builder-Check)*: Symbolische Links und Junctions auf Ordner und
  PDFs werden **verfolgt**. Die Notenliste zeigt sie an, die alte App hat dort `.data`-Dateien angelegt,
  und bisher fing die Migration beim Öffnen diese Dateien auf; ohne sie blieben solche Markierungen für
  immer unsichtbar. Jeder Ordner und jede PDF wird über den echten Pfad (`realpath`) nur einmal besucht
  (Schutz vor Schleifen und doppelten Wegen). Die Schranke ändert damit auch PDFs und löscht `.data`,
  die physisch außerhalb des Notenordners liegen: dieselben Dateien, in die die App beim Bearbeiten
  eines solchen Blatts ohnehin schreibt. In der ZIP stehen sie unter ihrem Pfad durch den Link.
- Ein Link, dessen Ziel sich nicht lesen lässt, ist ein Fehler in der Liste (wie ein nicht lesbarer
  Ordner), mit dem Hinweis, den Link zu entfernen oder das Ziel erreichbar zu machen. Sonst könnte ein
  nur vorübergehend nicht erreichbares Ziel übergangen und der Ordner trotzdem eingetragen werden.
- Kandidat ist eine PDF, zu der eine Begleitdatei existiert. Deren Pfad wird mit der **Namensregel der
  alten App** bestimmt: eine genaue Portierung von `getOverlayDataFilePathFromSheetPath` aus
  `src/trcpLib.ts` in `v1.15.1`, einschließlich des zweiten `String.replace` auf dem ganzen Pfad (heute
  weicht `getSidecarPath` bei Dateinamen mit `$$`, `$&`, `` $` `` oder `$'` davon ab). v1-Begleitdateien
  aus Testbuilds mit solchen Namen werden dadurch nicht gefunden; das ist hingenommen.
- **Neu:** Ein Ordner, der sich nicht lesen lässt, ist ein Fehler in der Liste („Ordner kann nicht
  gelesen werden“ mit der Meldung), und eine gescheiterte Suche gilt nie als „nichts gefunden“.
- Es gibt keine Liste bleibender Fehler mehr: Jeder Start prüft alle Kandidaten.
- Eine `.data` ohne PDF ist kein Kandidat; sie bleibt liegen und wird nicht gemeldet.

### 4. Durchgang 1: Prüfen (nichts wird geschrieben)

Nacheinander in der Reihenfolge der relativen Pfade, **jede** Datei, auch nach Fehlern:

1. Das Hauptprogramm liest den Zustand der PDF (lesbar, verschlüsselt, eingebettete Markierungen) und
   die Begleitdatei (alte Daten, v1-Seiten oder Lesefehler mit Meldung). Ein Lesefehler ist ein Fehler
   dieser Datei und nie „keine Begleitdatei“. Ist die Begleitdatei seit der Suche verschwunden, ist die
   Datei kein Kandidat mehr.
2. Die Oberfläche wandelt wie heute um (`convertLegacyOverlayData` bzw. `sidecarPagesToChanges` mit den
   Seitengrößen aus pdf.js) und rendert die PNGs.
3. Sie ruft das Speichern im **Probelauf** auf: Das Hauptprogramm tut alles, was ein echtes Speichern
   tut (PDF lesen, Update bauen, das gebaute Ergebnis mit `verifyPages` prüfen, Schreibbarkeit von Datei
   und Ordner prüfen), ersetzt die PDF aber nicht und fasst die Begleitdatei nicht an. Die
   Schreibbarkeit des Ordners wird wie in `isFolderWritable` mit einer sofort wieder gelöschten
   Probedatei geprüft, weil `access` unter Windows Ordnerrechte ignoriert.

Ergebnis je Datei:

- **in Ordnung:** wird in Durchgang 2 übernommen.
- **leer:** Die Begleitdatei enthält keine Markierungen (Regel wie heute). In Durchgang 2 wird nur die
  Begleitdatei gelöscht, die PDF bleibt byte-gleich.
- **schon übernommen** *(Entscheidung Claude)*: Die PDF enthält bereits genau die Markierungen, die aus
  der Begleitdatei entstehen würden (Abbruch zwischen Schreiben und Löschen). In Durchgang 2 wird nur
  die Begleitdatei gelöscht.
- **Fehler** mit einem maschinenlesbaren Grund:

| Grund | Wann | Was der Nutzer liest (sinngemäß) |
|---|---|---|
| Begleitdatei beschädigt | alte Daten ganz oder teilweise nicht umwandelbar; v1-Seite jenseits der Seitenzahl | „Die alte Markierungsdatei ‚.X.data‘ ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.“ |
| Markierungen nicht zeichenbar | ein PNG lässt sich nicht rendern | „Die Markierungen aus ‚.X.data‘ konnten nicht gezeichnet werden: ‹Meldung›. Bitte erneut prüfen; bleibt der Fehler, die Datei löschen und die Markierungen neu eintragen.“ |
| Begleitdatei nicht lesbar | Lesefehler (gesperrt, Rechte) | „Die Markierungsdatei kann nicht gelesen werden: ‹Meldung›.“ |
| PDF hat andere Markierungen | eingebettete Daten weichen von der Begleitdatei ab | „Die PDF enthält bereits Markierungen. Bitte die Datei ‚.X.data‘ löschen; die Markierungen in der PDF bleiben.“ |
| verschlüsselt | PDF ist verschlüsselt | „Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.“ |
| schreibgeschützt | Datei oder Ordner nicht beschreibbar | „Die PDF oder ihr Ordner ist schreibgeschützt.“ |
| PDF nicht lesbar | weder pdf-lib noch pdf.js können sie öffnen | „Die PDF kann nicht gelesen werden: ‹Meldung›.“ |
| Aufbau nicht beschreibbar | der Probelauf scheitert beim Bauen oder Prüfen | „In diese PDF kann die App nicht schreiben: ‹Meldung›. Bitte mit einem anderen Programm neu speichern.“ |
| gesperrt | Datei in einem anderen Programm geöffnet | „Die Datei ist in einem anderen Programm geöffnet.“ |
| ungespeicherte Änderungen | siehe 2 | „Für diese Datei gibt es ungespeicherte Änderungen.“ |
| Ordner oder Link nicht lesbar | siehe 3 | „Der Ordner kann nicht gelesen werden: ‹Meldung›.“ bzw. „Die Verknüpfung führt zu einem Ziel, das nicht gelesen werden kann. Bitte entfernen oder das Ziel erreichbar machen.“ |
| anderer Fehler | alles Übrige | die Meldung im Wortlaut |

Hat Durchgang 1 mindestens einen Fehler, endet der Durchlauf mit der Fehlerliste (Abschnitt 6): keine
Sicherung, keine Änderung im Ordner, der Ordner wird nicht eingetragen.

### 5. Durchgang 2: Sichern und Übernehmen

Nur nach einem Durchgang 1 ohne Fehler und mit mindestens einem Kandidaten.

- **Sicherung** wie heute (`Markierungen-Backup YYYY-MM-DD HH-MM.zip`, geprüft), mit **allen**
  Kandidaten, auch den leeren und den schon übernommenen. **Neu:** Lässt sich die ZIP nicht anlegen oder
  fehlt darin auch nur ein Kandidat (beim Packen nicht lesbar), wird nichts übernommen; die Fehlerliste
  nennt den Grund. (Heute liefen die übrigen Dateien weiter.)
- **Übernehmen**, jede Datei, auch nach Fehlern: dieselben Schritte wie in Durchgang 1, diesmal echt
  gespeichert (atomar, Read-back). Die Begleitdatei wird erst nach erfolgreichem Read-back gelöscht.
  **Neu:** Lässt sie sich danach nicht löschen (nach den Wiederholungen), ist das ein Fehler dieser Datei;
  beim nächsten Start ist sie „schon übernommen“ und nur das Löschen wird nachgeholt.
- Ein Fehler in Durchgang 2 lässt die betroffene Datei unverändert; die übrigen bleiben übernommen. Der
  Durchlauf endet mit der Fehlerliste, der Ordner wird nicht eingetragen. Der nächste Start prüft den
  Rest erneut und legt für ihn eine neue ZIP an.
- Ohne Fehler: Ordner eintragen, Zusammenfassung wie heute („214 Dateien übernommen. Sicherung: …“,
  Knopf „OK“), danach ist die App benutzbar. Ohne Kandidaten: Ordner eintragen, kein Fenster.

**Abbrechen, Fenster schließen, Update-Neustart:** Während der Suche endet der Durchlauf sofort, in
Durchgang 1 nach der Datei, die gerade geprüft wird (nichts wurde verändert). Während der Sicherung wird
die ZIP verworfen. Während des Übernehmens wird die aktuelle Datei fertig, dann ist Schluss. In jedem
Fall wird der Ordner nicht eingetragen, und „Abbrechen“ schließt die App. Schließen blockiert nie (bestehende Regeln des Close-Guards).

### 6. Fehlerliste

Sperrendes Fenster, kein Weg in die App:

```
┌─ Markierungen konnten nicht übernommen werden ──────────────┐
│ 3 von 214 Dateien haben ein Problem. Es wurde nichts        │
│ verändert. Bitte beheben und erneut prüfen.                 │
│                                                             │
│ Weihnachten/Amen.pdf                                        │
│   Die PDF oder ihr Ordner ist schreibgeschützt.             │
│ Pop/Africa.pdf                                              │
│   Die alte Markierungsdatei „.Africa.data“ ist beschädigt.  │
│   Bitte die Datei löschen und die Markierungen neu          │
│   eintragen.                                                │
│ Pop/Hello.pdf                                               │
│   Die PDF ist verschlüsselt. Bitte den Kennwortschutz       │
│   entfernen.                                                │
│                                                             │
│ [ Erneut prüfen ] [ Anderen Notenordner wählen ] [ Schließen ] │
└─────────────────────────────────────────────────────────────┘
```

- Kopfzeile nach Durchgang 1: Anzahl der Probleme und „Es wurde nichts verändert“. Nach Durchgang 2:
  „211 von 214 Dateien übernommen. Sicherung: ‹ZIP›. 3 Dateien haben ein Problem.“
- Je Eintrag: relativer Pfad, Ursache, was zu tun ist. Die Liste ist scrollbar, der Text lässt sich
  markieren und kopieren.
- **Schließen** schließt die App (normaler Weg, mit dem bestehenden Close-Guard).
- **Anderen Notenordner wählen** *(Entscheidung Claude)* öffnet die Ordnerauswahl wie `FolderSetup`; für
  den gewählten Ordner läuft die Schranke. Wird die Auswahl abgebrochen, bleibt die Liste stehen.
- **Erneut prüfen** *(Entscheidung Claude)* startet die Schranke für denselben Ordner neu, ohne dass die
  App neu gestartet werden muss. So bleibt die Liste sichtbar, während der Nutzer die Dateien behebt.

### 7. Prüfung beim Öffnen eines Blatts

- `loadMarkup` liefert zusätzlich, ob und warum in die PDF nicht gespeichert werden kann. Das wird bei
  jedem Laden neu bestimmt:
  - **nicht lesbar** / **verschlüsselt** aus dem Einlesen;
  - **schreibgeschützt**: Datei nicht beschreibbar oder im Ordner lässt sich keine Datei anlegen
    (Probedatei wie in Abschnitt 4);
  - **Aufbau nicht beschreibbar**: Ein Probelauf scheitert. Er durchläuft denselben Schreibweg wie ein
    echtes Speichern einschließlich der Prüfung des Ergebnisses, im Speicher, mit einer Änderung, die
    den Schreiber tatsächlich laufen lässt (die Wahl überlässt die Spezifikation dem Builder).
  - Eine nur kurz gesperrte Datei wird beim Öffnen nicht gemeldet.
- Liegt ein Grund vor, zeigt die Oberfläche bei **jedem** Öffnen:

```
┌─ Keine Markierungen möglich ────────────────────────────────┐
│ In „Hello.pdf“ können keine Markierungen gespeichert        │
│ werden: Die PDF ist verschlüsselt. Bitte den Kennwortschutz │
│ entfernen.                                                  │
│ Die Noten lassen sich trotzdem anzeigen.                    │
│                                             [ Verstanden ]  │
└─────────────────────────────────────────────────────────────┘
```

  Nach „Verstanden“ ist das Blatt lesbar; der Stift ist für dieses Blatt aus. Es gibt kein „nicht mehr
  anzeigen“. Texte je Grund wie in der Tabelle in Abschnitt 4.
- Markierungen, die schon in der PDF stehen, werden weiter angezeigt. Kann die App ihre Daten nicht
  lesen (verschlüsselt, nicht lesbar), blendet sie die eigene Ebene (OCG) **nicht** aus, damit die
  Stempel als Bild sichtbar bleiben. (Heute wird die Ebene immer ausgeblendet.)
- „Bearbeiten aus“ gehört zum geöffneten Blatt: Ein Blatt, das schon verlassen wurde, darf den Zustand
  des jetzt offenen nicht mehr ändern (Review-Befund: die späte Fortsetzung von `onMounted` setzt heute
  das globale `markupEditDisabled`).
- Die Prüfung gilt für jede PDF, nicht nur für neue. Eine `.data` neben der PDF wird nicht angesehen.

### 8. Speichern nach der Umstellung

- `saveMarkup` schreibt nur noch die PDF. Ergebnis ist „gespeichert“ oder „Fehler“ mit Grund und
  Meldung. Es gibt keinen Fallback mehr: verschlüsselt, nicht lesbar, schreibgeschützt, nicht
  beschreibbarer Aufbau und dauerhaft gesperrt sind Fehler, die PDF bleibt byte-gleich.
- Ein Fehler behandelt die Oberfläche wie heute jeden Speicherfehler: Die Änderungen bleiben im
  `markupSaves`-Speicher, werden alle 30 s erneut versucht, und das Schließen fragt nach.
- Der Probelauf (Abschnitte 4 und 7) legt außer der Probedatei nichts an und ändert nichts.
- Das Löschen der Begleitdatei nach dem Speichern nutzt nur noch die Schranke.

### 9. Was entfällt

- Sidecar-Fallback im Hauptprogramm (`fallback`, `writeSidecar`, `mustStayInSidecar`, Ergebnis
  `sidecar`). Das v1-Format wird nur noch von der Schranke gelesen.
- Migration beim Öffnen in `SheetViewer.vue` (die Zweige für Begleitdatei und alte Daten in
  `applyLoadedMarkup`, `migrateLegacyOverlayData`, der Hinweis `LEGACY_UNREADABLE`). `loadMarkup` liest
  für die Ansicht keine Begleitdatei mehr; die Schranke bekommt dafür einen eigenen Aufruf.
- Im Speicher ungespeicherter Änderungen (`saveQueue.ts`): `sidecarPages`, `allowLegacyDelete` und das
  Mitschicken der Sidecar-Seiten.
- Liste bleibender Fehler (`skipList.ts`, `bulk-migration-skips.json`, `PERMANENT_REASONS`,
  `recordMigrationSkip`) und das einmalige Melden schreibgeschützter Ordner (`ReadOnlyFolders`,
  `bulk-migration-read-only.json`, `checkMigrationFolder`). Die Probe `isFolderWritable` bleibt.
- Die beiden älteren Spezifikationen bekommen oben einen Hinweis auf dieses Dokument.

### 10. Tests

- Unit-Tests (vitest, ohne Electron):
  - Ablauf der Schranke: Fehler in Durchgang 1 → alle Kandidaten geprüft, alle Fehler gemeldet, keine
    Sicherung, kein Speichern, Ordner nicht eingetragen. Ohne Fehler → Sicherung, Speichern, Ordner
    eingetragen. Fehler in Durchgang 2 → die übrigen übernommen, Ordner nicht eingetragen, der nächste
    Lauf behandelt den Rest. Unvollständige Sicherung → nichts übernommen. Abbruch in jeder Phase.
    Keine Kandidaten → eingetragen ohne Fenster. Gescheiterte oder unvollständige Suche → nicht
    eingetragen.
  - Suche: Namensregel der alten App einschließlich `$$`-Namen; nicht lesbarer Unterordner ist ein
    Fehler; verlinkte Ordner und PDFs werden gefunden, eine Schleife und ein doppelter Weg führen zu
    genau einem Besuch je Datei, ein Link mit nicht lesbarem Ziel ist ein Fehler. (Der bestehende Test
    „does not follow symlinks“ ändert sich entsprechend.)
  - Dateischicht: Speichern legt nie eine Begleitdatei an; der Probelauf verändert nichts (Bytes und
    Ordnerinhalt gleich) und meldet dieselben Fehler wie ein echtes Speichern für verschlüsselt,
    schreibgeschützt und die drei im Review nachgestellten Aufbau-Fälle (`startxref` fehlt, falscher
    Offset, mehr als 4096 Bytes vor dem Dateiende); `loadMarkup` meldet für dieselben Fälle den Grund;
    eine nicht lesbare Begleitdatei ist ein Fehler, nie „keine“; „schon übernommen“ löscht nur.
  - Liste der übernommenen Ordner (fehlende und defekte Datei, Groß-/Kleinschreibung).
- Visuell/e2e (headless, auf Kopien):
  - Der komplette Korpus läuft durch die Schranke; jede PDF erfüllt danach dieselben Prüfungen gegen
    die Referenz der alten App wie bisher (A, B, Ar, C, D, E, Er). Keine `.data` bleibt, genau eine
    ZIP, der Ordner ist eingetragen, ein zweiter Start zeigt kein Fenster.
  - Präparierte Fehler (beschädigte `.data`, schreibgeschützte PDF, verschlüsselte PDF) zusammen mit
    gesunden Dateien: Die Liste nennt alle drei, jede Datei im Ordner ist byte-gleich zu vorher, es
    gibt keine ZIP, „Schließen“ beendet die App. Nach dem Beheben läuft der nächste Start durch.
  - Nach der Übernahme: Eine neben eine PDF gelegte `.data` wird nicht angezeigt und nicht verändert;
    Bearbeiten schreibt in die PDF.
  - Öffnen einer verschlüsselten und einer schreibgeschützten PDF: Dialog bei jedem Öffnen, Stift aus,
    Noten sichtbar; nach dem Beheben kein Dialog mehr.
  - Keine Netzwerkanfrage.

### 11. Dokumentation

`AGENTS.md`, Abschnitt „Markup storage“, wird an die neue Regel angepasst (kein Sidecar-Fallback, keine
Migration beim Öffnen, Schranke statt Sammelmigration bei jedem Start).

## Dem Builder überlassen

- Format von `markup-migrated-folders.json`.
- Wie der Probelauf angeboten wird (Schalter an `saveMarkup` oder eigener Aufruf) und mit welcher
  Änderung er beim Öffnen den Schreiber laufen lässt; ob die Ordner-Probe innerhalb eines Durchlaufs
  je Ordner nur einmal läuft.
- Aufbau des Fortschrittsfensters für Suche, Prüfen, Sicherung und Übernehmen; genaue Texte, solange
  sie deutsch und knapp sind, die Ursache nennen und sagen, was zu tun ist.
- Ob das Fenster während einer sehr kurzen Suche verzögert erscheint, damit es nicht aufblitzt.
- Wie die visuellen Tests die Migration erreichen, nachdem es die Migration beim Öffnen nicht mehr
  gibt, und was aus `SMV_DISABLE_BULK_MIGRATION` wird.
- Ob die nicht mehr benutzten Profil-Dateien aus Testbuilds (`bulk-migration-skips.json`,
  `bulk-migration-read-only.json`) gelöscht werden.
