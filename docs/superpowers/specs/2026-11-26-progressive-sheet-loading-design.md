# Blätter Seite für Seite laden, Schreibprüfung merken

Stand: 2026-11-26 · Status: zur Freigabe · Ergänzt: `2026-11-15-markup-in-pdf-design.md`,
`2026-11-20-strict-markup-migration-design.md` (Prüfung beim Öffnen)

## Warum

Große Blätter brauchen merklich länger, bis überhaupt etwas zu sehen ist (Beispiel: „Symphonic war-ups for
band“, 9,2 MB, 18 Seiten). Heute wartet der Viewer, bis

1. das Hauptprogramm die PDF gelesen und zerlegt **und** die Schreibprüfung gemacht hat (Probefassung bauen
   und zurücklesen; auf dem Entwicklungsrechner 0,13 s Zerlegen + 0,27 s Prüfung, auf dem Windows-Gerät
   ein Mehrfaches),
2. pdf.js die Datei geladen hat,
3. **alle** Seiten gezeichnet sind: alle gleichzeitig gestartet, jede in 4-facher Auflösung, jede außer der
   ersten zusätzlich als Kopie für den halben Schritt (bei 18 Seiten grob 1 GB Bildspeicher).

Bis dahin liegt ein grauer Schleier mit Prozent-Kreis über allem; die Markierungen kommen erst nach der
letzten Seite.

## Ziele

- Seite 1 so früh wie möglich sehen; die übrigen Seiten erscheinen der Reihe nach, während man schon liest.
- Die Ladeanzeige sitzt in der oberen Leiste, nicht als Schleier über den Noten.
- Der Stift (Bearbeiten) geht erst, wenn alle Seiten da sind und feststeht, ob gespeichert werden kann.
- Die Schreibprüfung läuft für denselben Dateiinhalt auf einem PC nur einmal.

## Nicht-Ziele

- Geringere Auflösung, unscharfe Vorschau oder Zeichnen nur sichtbarer Seiten (Speicherbedarf an sich).
- Schnelleres Zerlegen der PDF im Hauptprogramm (es bleibt nötig, um die Markierungen zu lesen).
- Änderungen an Speichern, Migration, Teiler-Modus oder Zoom im Bearbeiten.
- Das Ergebnis der Prüfung zwischen PCs teilen.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Markierungen, die nicht gelesen werden konnten, werden durch Bearbeiten überschrieben, oder der Stift geht
  bei einer PDF, in die nicht gespeichert werden kann.
- Unsere Stempel erscheinen doppelt (Stempel aus der PDF und die fabric-Ebene) oder fehlen, wo die App die
  Markierungen nicht lesen kann.
- Ein gemerktes Prüfergebnis gilt für einen anderen Dateiinhalt (eine geänderte PDF wird nicht neu geprüft).
- `.config.json` im Notenordner wird für die Prüfung geschrieben.
- Seiten erscheinen in falscher Reihenfolge oder bleiben nach dem Verlassen des Blatts im Hintergrund am
  Zeichnen.

## Randbedingungen

- pdf.js lädt die ganze Datei (`disableRange`/`disableStream`/`disableAutoFetch` bleiben: Speichern ersetzt
  die Datei).
- `src/pdfMarkup/` bleibt ohne Electron-Imports; der Speicherort im Profil wird von außen hereingegeben.
- Die Prüfung beim Öffnen (AGENTS.md „Check on open“) bleibt inhaltlich gleich: verschlüsselt, nicht lesbar,
  schreibgeschützt (inkl. Probedatei im Ordner), Probefassung. Der Hinweis-Dialog erscheint weiter bei jedem
  Öffnen, wenn nicht gespeichert werden kann.
- GUI-Tests nur headless; `Noten*/` wird nie geöffnet oder verändert.

## Ansätze

Wo das Ergebnis der Probefassung gemerkt wird:

- **A: in `.config.json` im Notenordner.** Jeder PC profitiert sofort. Aber die Datei würde beim ersten
  Öffnen jedes Blatts und nach jedem Speichern von Markierungen geschrieben und über Nextcloud ständig neu
  abgeglichen; bisher schreibt bloßes Öffnen sie nie.
- **B: im App-Profil des PCs (gewählt).** Gleiche Wirkung ab dem zweiten Öffnen, der Notenordner bleibt
  ruhig; jeder PC prüft jedes Blatt einmal selbst.
- **C: nichts merken, nur in den Hintergrund.** Seiten gleich schnell, aber der Stift wartet bei jedem Öffnen
  und der Rechner arbeitet jedes Mal.

Der Nutzer hat **B** gewählt.

Reihenfolge des Zeichnens *(Entscheidung Claude, vom Nutzer bestätigt)*: eine Seite nach der anderen ab
Seite 1. Mehrere gleichzeitig bringen nichts, weil pdf.js sie in seinem Worker ohnehin nacheinander
abarbeitet, und verzögern Seite 1.

## Design

### Hauptprogramm: Laden und Prüfen getrennt

- `loadMarkup` (tRPC, `loadMarkupFromFile`) liest und zerlegt die PDF und liefert die Markierungen **ohne**
  Probefassung und ohne Prüfung auf Schreibschutz. `writeBlock` enthält dort nur noch, was das Zerlegen
  ohnehin ergibt: `encrypted` oder `unparseable` (dann konnten die Markierungen nicht gelesen werden, die
  Stempel bleiben sichtbar), sonst `null`.
- Die übrige Prüfung (Schreibschutz, Probefassung) läuft als eigener Aufruf (`checkMarkupWritable`, gibt es
  schon; Ergebnis `WriteBlock | null`), den der Viewer gleich nach `loadMarkup` im Hintergrund startet –
  **nur** wenn `loadMarkup` keine Sperre meldete. Meldet `loadMarkup` schon `encrypted`/`unparseable`, zeigt
  der Viewer den Hinweis sofort und prüft nicht weiter; schlägt der Aufruf `loadMarkup` fehl, gibt es keine
  Prüfung, Stift aus, Meldung wie heute *(Entscheidung Claude: kein zweites Zerlegen für ein Ergebnis, das
  schon feststeht)*.
- Die Prüfung liest die Datei selbst und bildet den Schlüssel aus genau diesen Bytes; kein geteiltes Lesen
  mit `loadMarkup` *(Entscheidung Claude: sonst könnte der Schlüssel zu einem anderen Inhalt gehören, wenn die
  Datei dazwischen geändert wurde)*.
- Das Reparieren verwaister Stempel (heute in `loadNow`, nur ohne Schreibsperre) wandert mit in die Prüfung:
  erst wenn feststeht, dass geschrieben werden kann. pdf.js hat die Datei dann schon ganz im Speicher und
  zeichnet weiter aus diesen Bytes; die Reparatur ersetzt die Datei atomar und ändert nichts Sichtbares (sie
  benennt nur verwaiste Stempel um und schreibt unsere Metadaten), daher lädt der Viewer danach nichts neu
  *(Entscheidung Claude)*.
- Beide laufen wie heute pro Datei nacheinander (`serialized`).

### Gemerkte Prüfung (Profil)

- Datei `markup-write-check.json` im Profil (`app.getPath("userData")`), Format
  `{ "version": 1, "entries": { "<sha256>:<länge>": { "ok": true } | { "ok": false, "message": "…" } } }`.
  Schlüssel ist der **Inhalt der ganzen Datei** (SHA-256 hex klein + Länge der aktuell gelesenen Bytes),
  nicht der Pfad: eine verschobene, aber gleiche PDF trifft, jede Änderung verfehlt.
- Gemerkt wird nur das Ergebnis der Probefassung (`structure` oder ok). `encrypted`/`unparseable` ergeben
  sich aus dem Zerlegen ohnehin, `readOnly` wird bei jedem Öffnen frisch geprüft.
- Treffer: keine Probefassung. Kein Treffer: Probefassung bauen, Ergebnis eintragen.
- Nach einem erfolgreichen eigenen Speichern (und nach einer Reparatur) wird für die geschriebenen Bytes
  `ok` eingetragen: das Speichern hat ein Update gebaut und zurückgelesen *(Entscheidung Claude: das
  Speichern prüft die echten Seiten statt der Probe auf Seite 1; die Struktur, um die es geht, ist die der
  Datei)*.
- Höchstens 1000 Einträge; beim Eintragen fallen die ältesten weg *(Entscheidung Claude)*.
- Der Hash wird jedes Mal über die ganzen Bytes gebildet (SHA-256 über 9 MB: wenige Millisekunden); der
  Fingerabdruck-Cache der Favoriten (`src/pdfFingerprint.ts`, nur Originalbytes) wird dafür nicht benutzt.
- Die gemerkte Meldung eines `structure`-Ergebnisses (pdf-lib-Text, ohne Pfad) wird wie heute im Hinweis
  gezeigt.
- Nicht lesbare oder kaputte Datei: gilt als leer und wird beim nächsten Eintrag ersetzt (es ist nur ein
  Zwischenspeicher). Geschrieben wird atomar; ein Fehler beim Schreiben wird protokolliert, die Prüfung gilt
  trotzdem.

### Viewer: Ablauf beim Öffnen (`src/views/SheetViewer.vue`)

1. Gleichzeitig starten: `loadMarkup`, das Laden der PDF in pdf.js, `loadSheetSettings` (Teiler, Favorit).
2. Sobald PDF und Markierungen da sind: Stempel ausblenden, wenn die Markierungen gelesen werden konnten
   (wie heute), dann die Seiten **der Reihe nach** zeichnen. Pro Seite: zeichnen, Kopie für den halben
   Schritt, Schnitt nach dem Teiler, die Markierungen dieser Seite (und ihres halben Schritts) darüber; dann
   gilt die Seite als fertig und wird sichtbar; dann die nächste.
3. Parallel: `checkMarkupWritable`. Ergibt sie eine Sperre: Hinweis-Dialog wie heute, Stift bleibt aus.
   Verlässt man das Blatt vorher, läuft die Prüfung im Hauptprogramm zu Ende (ihr Ergebnis wird gemerkt),
   der Viewer wertet sie aber nicht mehr aus: kein Dialog, kein Stift-Zustand für das nächste Blatt.
4. Teiler aus `loadSheetSettings`: kommen sie erst nach einigen Seiten, werden die Schnitte der fertigen
   Seiten nachgezogen.

Konnten die Markierungen nicht geladen werden (Fehler beim Aufruf): Seiten werden trotzdem gezeichnet, mit
sichtbaren Stempeln, Stift aus, Meldung wie heute.

### Ladeanzeige in der oberen Leiste (`src/App.vue`)

```
┌─────────────────────────────────────────────────────────┐
│ ←  Symphonic war-ups for band      ⇅  ✎(grau)  ♡  +     │
│▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ← 7/18 Seiten
└─────────────────────────────────────────────────────────┘
```

- Ein dünner Fortschrittsbalken am unteren Rand der Leiste, Anteil fertiger Seiten. Sind alle Seiten fertig,
  die Prüfung aber noch nicht, läuft er unbestimmt weiter, bis der Stift bereit ist *(Entscheidung Claude:
  sonst wäre der graue Stift ohne Grund sichtbar)*. Danach verschwindet er.
- Kreis und Schleier in der Mitte entfallen.
- Zustand im Store (z. B. geladene/gesamte Seiten und „Prüfung läuft“), damit die Leiste ihn zeigen kann;
  beim Verlassen des Blatts zurückgesetzt.

### Stift, Teiler, Umblättern

- Stift-Knopf ausgegraut, bis alle Seiten fertig sind **und** die Prüfung ohne Sperre zurück ist (zusätzlich
  zu den heutigen Gründen: Sperre, Teiler-Modus).
- Teiler-Knopf wie heute erst, wenn alle Seiten fertig sind.
- Umblättern geht während des Ladens; eine noch nicht fertige Seite zeigt nichts (weiß), bis sie erscheint.
- Der Schleier hat bisher nur Klicks auf die Noten abgefangen; die Knöpfe der Leiste haben schon eigene
  Bedingungen (Herz: bis der Favorit geladen ist; Teiler und Stift: siehe oben). Zoomen gibt es nur im
  Bearbeiten. Weitere Sperren braucht es nicht.

### Fenstergröße ändern

- Wie heute werden alle Seiten neu gezeichnet, jetzt ebenfalls der Reihe nach mit Balken. Ein neuer Durchgang
  bricht einen laufenden ab; beim Verlassen des Blatts wird keine weitere Seite gezeichnet.
- Ein offener Bearbeiten-Modus bleibt dabei offen (wie heute).

### Dokumentation

AGENTS.md: „Check on open“ (Prüfung im Hintergrund, gemerkt im Profil), ein Abschnitt zum Laden des
Blatts (Reihenfolge, Leiste, Stift), Testliste.

## Tests

- Unit (Node): gemerkte Prüfung (Treffer ohne Probefassung, geänderte Bytes = neu prüfen, Ergebnis
  `structure` wird gemerkt, kaputte Datei = leer, ältester Eintrag fällt bei mehr als 1000, Speichern trägt
  `ok` für die geschriebenen Bytes ein, `readOnly` wird trotz Treffer erkannt); `loadMarkup` liefert ohne
  Probefassung, `encrypted`/`unparseable` als nicht lesbar; Reparatur verwaister Stempel jetzt in der Prüfung.
- Visuell (headless, synthetische Ordner, neue Datei z. B. `tests/visual/sheetLoading.visual.ts`): eine PDF
  mit vielen schweren Seiten – Seite 1 ist sichtbar (mit ihren Markierungen), bevor die letzte fertig ist;
  der Balken steht in der Leiste und wächst; der Stift ist ausgegraut und wird nach dem Laden bereit; die
  Seiten werden in Reihenfolge fertig; zweites Öffnen trifft die gemerkte Prüfung; eine schreibgeschützte
  PDF zeigt den Hinweis und der Stift bleibt aus; Verlassen während des Ladens. Die bestehenden Tests warten
  heute auf das Verschwinden des Schleiers (`#sheetViewerWrapper .overlay` in `tests/visual/electronDriver.ts`
  und `favorites.visual.ts`); sie warten künftig auf ein Merkmal „fertig geladen“ (alle Seiten, Markierungen,
  Prüfung).

## Dem Builder überlassen

- Form des Merkmals „fertig geladen“ für die Tests (z. B. ein `data-`-Attribut am Viewer) und eines
  Merkmals je fertiger Seite.
- Wie ein Durchgang abgebrochen wird (z. B. Zähler je Durchgang).
- Wie die Testhilfe erkennt, dass die gemerkte Prüfung getroffen wurde (z. B. Inhalt der Profildatei vor und
  nach dem zweiten Öffnen).
- Aussehen des Balkens im Detail (Farbe, Höhe), passend zur Leiste in allen drei Farben (normal, Bearbeiten
  rot, Teiler türkis).
