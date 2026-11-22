# Einstellungen im Notenordner: Setlisten und Übernahme-Markierung in `.config.json`

Stand: 2026-11-22 · Status: freigegeben · Ändert: `2026-11-20-strict-markup-migration-design.md` (Abschnitt 1
„Wann ein Ordner als übernommen gilt“)

## Warum

Die Markierung „Markierungen dieses Ordners sind übernommen“ steht heute im lokalen App-Profil
(`markup-migrated-folders.json`), Schlüssel ist nur der Pfad. Wird ein Ordner gelöscht und an derselben
Stelle neu angelegt (z. B. eine frische Kopie des Korpus), gilt er weiter als übernommen und seine
`.data`-Dateien werden still ignoriert. Sebastian will, dass **alle Einstellungen im gewählten Notenordner
liegen** und so **zwischen PCs geteilt** werden (Nextcloud). Die Markierung wandert dann mit dem Ordner:
eine frische Kopie hat keine, eine Kopie eines übernommenen Ordners behält sie.

## Ziele

- Eine Datei `.config.json` im Notenordner enthält die Setlisten und die Übernahme-Markierung.
- Jeder PC, der denselben (synchronisierten) Ordner nutzt, sieht dieselben Setlisten und dieselbe
  Markierung.
- `.set-lists.json` wird in `.config.json` übernommen und danach gelöscht.

## Nicht-Ziele

- Mehrere Notenordner (verworfen).
- Ein Knopf zum Zurücksetzen der Markierung (ausdrücklich nicht gewünscht). Wer die Prüfung erneut will,
  entfernt `markupMigrated` aus `.config.json` von Hand.
- Zusammenführen gleichzeitiger Änderungen zweier PCs: Nextcloud legt wie heute eine Konfliktkopie an.
- Weiterbetrieb der freigegebenen Version mit Setlisten: sie liest nur `.set-lists.json` und sieht nach
  der Übernahme keine Setlisten mehr. Das passt zur Schranke (alle müssen ohnehin aktualisieren).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Eine nicht lesbare `.config.json` oder `.set-lists.json` wird als „leer“ behandelt und überschrieben;
  Setlisten gehen verloren.
- Speichern der Setlisten löscht die Markierung oder umgekehrt.
- Eine Version auf einem anderen PC verliert Felder, die diese Version nicht kennt.
- `.set-lists.json` wird gelöscht, bevor ihr Inhalt nachweislich in `.config.json` steht.
- Die Setlisten eines Ordners landen im Ordner, der danach gewählt wird (bestehender Fehler: beim
  Ordnerwechsel wird gespeichert, bevor die Setlisten des neuen Ordners geladen sind).
- Jeder Start schreibt die Datei neu, obwohl sich nichts geändert hat (Nextcloud synchronisiert sonst
  ständig).

## Randbedingungen

- Windows, Notenordner in einem geteilten Nextcloud-Ordner; Dateien können kurz gesperrt sein.
- Die Regeln der Schranke bleiben unverändert, außer wo die Markierung steht.
- Code im Hauptprogramm ohne Electron-Importe, in Node unit-getestet; GUI-Tests headless.

## Ansätze

1. **Gewählt: eine Datei im Notenordner, das Hauptprogramm verwaltet sie.** Setlisten und Markierung in
   `.config.json`; das Hauptprogramm liest, ändert genau einen Teil und schreibt atomar.
2. Globale Einstellungen im App-Profil, mehrere Notenordner (verworfen: nicht zwischen PCs teilbar).
3. Markierung als eigene Datei neben `.set-lists.json` (verworfen: Sebastian will eine Datei für alles).

## Design

### Datei

- Name `.config.json` im Hauptordner des Notenordners *(Entscheidung Claude: führender Punkt, damit sie
  wie bisher `.set-lists.json` im Explorer und in der Nextcloud-Weboberfläche versteckt ist und in der
  Notenliste nicht erscheint)*.
- Inhalt:

  ```json
  {
    "version": 1,
    "setLists": { "version": 2, "setLists": [ … ] },
    "markupMigrated": { "at": "2026-11-22T10:15:00.000Z" }
  }
  ```

  `setLists` hat genau das bisherige Format von `.set-lists.json` (Version 2). `markupMigrated` fehlt,
  solange der Ordner nicht übernommen ist. Unbekannte Felder (auch innerhalb von `markupMigrated`) bleiben
  beim Schreiben erhalten.

### Lesen und Schreiben (Hauptprogramm)

- Ein Modul verwaltet die Datei, je Ordner nacheinander (wie `serialized` in `markupFile.ts`).
- Lesen liefert eines von: `missing` (keine Datei), `ok` mit Inhalt, `unreadable` mit Meldung (Lesefehler,
  kein gültiges JSON, Schema verletzt). Nur `missing` gilt als leer.
- Schreiben ändert genau einen Teil (`setLists` oder `markupMigrated`), liest dafür den aktuellen Stand
  frisch von der Platte und schreibt atomar (temporäre Datei im selben Ordner, Rename, Wiederholungen bei
  Sperre wie bei den PDFs). Ist der Inhalt danach unverändert, wird nicht geschrieben. Ist die Datei
  `unreadable`, wird nichts geschrieben und der Fehler gemeldet.

### Übernahme von `.set-lists.json`

- Beim ersten Lesen eines Ordners, in dem `.config.json` fehlt und `.set-lists.json` existiert: deren Inhalt
  wie bisher einlesen (inklusive der Umwandlung von Version 1 auf 2), `.config.json` schreiben, zurücklesen,
  erst dann `.set-lists.json` löschen.
- Lässt sich `.set-lists.json` nicht lesen oder umwandeln, bleibt sie liegen und der Ordner gilt als
  `unreadable` (Meldung nennt die Datei).
- Gibt es beide Dateien, gilt `.config.json`; `.set-lists.json` wird nicht angefasst *(Entscheidung Claude:
  kein Zusammenführen; der Fall entsteht nur, wenn eine alte Version nachträglich wieder eine anlegt)*.

### Setlisten (Oberfläche)

- Laden und Speichern laufen über die neue Datei. Ist sie `unreadable`, zeigt die App einen Hinweis mit der
  Meldung, und Setlisten werden nicht gespeichert, bis das Lesen gelingt *(Entscheidung Claude)*.
- Gespeichert wird nur, was nach dem Laden des aktuellen Ordners geändert wurde: der bestehende Fehler beim
  Ordnerwechsel wird behoben, und das Laden selbst löst kein Speichern aus.
- Lässt sich die Datei nicht schreiben (schreibgeschützter Ordner), zeigt die App einen Hinweis.

### Schranke

- „Ordner gilt als übernommen“ heißt: `.config.json` ist lesbar und enthält `markupMigrated`.
- Ein bestandener Durchlauf schreibt `markupMigrated` mit dem aktuellen Zeitpunkt (statt des Eintrags im
  Profil). Scheitert das Schreiben, wird es protokolliert; die Schranke läuft beim nächsten Start erneut
  (wie bisher).
- Ist `.config.json` (bzw. die alte `.set-lists.json`) `unreadable`, ist das ein Fehler in der Liste der
  Schranke: „Die Einstellungsdatei „‹Name›“ kann nicht gelesen werden: ‹Meldung›. Bitte reparieren oder
  löschen; die Setlisten darin gehen beim Löschen verloren.“ *(Entscheidung Claude: im Sinne der harten
  Schranke; sonst würde ein bestandener Durchlauf die Datei überschreiben wollen)*.
- `markup-migrated-folders.json` im Profil wird nicht mehr gelesen und beim Start gelöscht *(Entscheidung
  Claude)*. Ihre Einträge werden **nicht** übernommen, denn genau diese pfadbasierte Markierung hat das
  Problem verursacht. Jeder Ordner durchläuft die Schranke daher einmal neu; ohne `.data`-Dateien besteht er
  sofort.

### Dokumentation

`AGENTS.md` (Abschnitte „Markup storage“ und „Visual tests“) und die Spezifikation der Schranke (Abschnitt 1
und der Hinweis zum Wiederherstellen aus der ZIP) werden angepasst.

## Tests

- Unit (Node): Lesen (`missing`, `ok`, `unreadable` für Lesefehler, kaputtes JSON, falsches Schema);
  Schreiben eines Teils erhält den anderen und unbekannte Felder; unveränderter Inhalt schreibt nicht;
  `unreadable` schreibt nie; Übernahme von `.set-lists.json` (Version 1 und 2) mit Löschen erst nach dem
  Zurücklesen, kaputte alte Datei bleibt liegen, beide Dateien vorhanden.
- Schranke: lesbare Datei mit Markierung → bestanden ohne Suche; ohne Markierung → Durchlauf, danach steht
  die Markierung in der Datei; `unreadable` → Fehler in der Liste, nichts geschrieben.
- Headless e2e: der Fall „Noten copy“ (Ordner nach dem Markieren gelöscht und neu kopiert → die Schranke
  läuft); Setlisten bleiben beim Ordnerwechsel im richtigen Ordner; nach der Übernahme gibt es
  `.config.json` und keine `.set-lists.json`; ein zweiter Start schreibt die Datei nicht neu.
- Visueller Gesamtlauf wie bisher (Vergleich mit der alten App ohne Abweichung).

## Dem Builder überlassen

- Name und Aufteilung des Moduls; wie die Oberfläche den Hinweis für eine nicht lesbare Datei zeigt.
- Wie der Test-Schalter `SMV_DISABLE_BULK_MIGRATION` mit der neuen Markierung zusammenspielt (er soll weiter
  „Ordner gilt als übernommen“ bedeuten, ohne etwas zu schreiben).
