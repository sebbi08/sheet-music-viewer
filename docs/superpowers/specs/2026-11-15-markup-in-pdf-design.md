# Markierungen direkt in der PDF speichern

Stand: 2026-11-15 · Status: Entwurf

## Warum

Heute liegen die Markierungen (fabric.js-JSON) in einer versteckten Begleitdatei
`.<name>.data` neben der PDF (`src/trcpLib.ts`, `saveOverlayData`/`loadOverlayData`).
Das hat zwei Probleme:

1. Verschiebt oder kopiert man eine PDF, muss die `.data`-Datei mit – sonst sind die
   Markierungen weg.
2. Teilt oder druckt man die PDF, sind die Markierungen nicht dabei.

## Ziele

- Markierungen stehen in der PDF-Datei selbst; keine Begleitdatei mehr.
- Andere PDF-Programme (Acrobat, Browser, Handy-Viewer) **zeigen** die Markierungen an
  und **drucken** sie mit.
- In der App bleiben die Markierungen voll bearbeitbar, so wie heute (Striche, Text,
  Symbole einzeln auswählen, verschieben, löschen).
- Die Original-PDF wird nicht angetastet: ihre Bytes bleiben unverändert am Dateianfang
  erhalten, das Original ist jederzeit durch Abschneiden wiederherstellbar.
- Markierungen bleiben bei sauberen Seitenänderungen in anderen Programmen
  (Zuschneiden, Drehen, Seiten umsortieren/löschen) an den Noten.

## Nicht-Ziele

- Bearbeiten der Markierungen in anderen PDF-Programmen. Dort sind sie ein Block pro
  Seite (anzeigen, drucken, ggf. als Ganzes löschen).
- Ein „Original wiederherstellen“-Knopf in der UI (technisch vorbereitet, aber nicht
  Teil dieses Vorhabens).
- Set-Listen, die über Pfade auf PDFs verweisen, beim Verschieben mitführen.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Die Original-Bytes der PDF werden verändert oder neu geschrieben (z. B. komplettes
  Neu-Serialisieren durch pdf-lib).
- Die Datei wächst mit jedem Speichern.
- Eine PDF wird durch Absturz/Abbruch beim Speichern beschädigt.
- Markierungen erscheinen in der App doppelt (einmal von pdf.js gerendert, einmal von
  fabric).
- Änderungen, die ein anderes Programm nach uns an die PDF angehängt hat, gehen beim
  nächsten Speichern verloren.

## Randbedingungen

- Lizenz des Projekts ist MIT → keine AGPL-Bibliotheken (MuPDF.js scheidet aus).
- Beide Beispiel-PDFs in `Noten/` sind PDF 1.7 mit Cross-Reference-**Streams**, eine hat
  bereits ein inkrementelles Update. Der Writer muss damit umgehen.
- Gerendert wird mit `pdfjs-dist` 6.5 im Renderer, Seite für Seite auf Canvas
  (`renderPage` in `src/views/SheetViewer.vue`). Bearbeitet wird mit fabric 7.4.
- Dateizugriff passiert im Main-Prozess über tRPC (`src/trcpRouter.ts`, `src/trcpLib.ts`).
- Die App läuft aktuell nur unter Windows (mit Auto-Update). Ältere App-Versionen, die
  parallel auf dieselben Dateien zugreifen, müssen nicht berücksichtigt werden. Die
  `.data`-Dateien werden nach erfolgreicher Migration gelöscht, eine Übergangsphase mit
  doppeltem Schreiben gibt es nicht. Windows-Besonderheiten beim Ersetzen der Datei
  (Rename schlägt fehl, solange ein anderes Programm sie geöffnet hat) sind deshalb der
  Hauptfall für Schreibfehler.

## Ansätze

| | Ansatz | Abwägung |
|---|---|---|
| **A (gewählt)** | Pro Seite **eine Stempel-Annotation** mit gerendertem, transparentem Bild der Markierung als Appearance; fabric-Daten versteckt an der Annotation | Sieht in jedem Viewer exakt aus wie in der App (Musik-Schrift, Textmarker-Transparenz); überschaubarer Aufwand. In fremden Programmen nur ein Block pro Seite. |
| B | Jede Markierung als eigene native Annotation (Ink/FreeText/Stamp) | Einzeln anfassbar in fremden Programmen, aber viel mehr Aufwand, Darstellung je Viewer unterschiedlich, Konflikte zwischen Annotation und fabric-Daten bei externer Bearbeitung. |
| – | Markierung in den Seiteninhalt einbrennen | Verändert das Original → verworfen. |
| – | fabric-Daten nur als Dateianhang einbetten | Andere Viewer zeigen nichts → verworfen. |

Entschieden von Sebastian: **A**.

## Design

### 1. Speichern als inkrementelles Update, das immer ersetzt wird

- Gespeichert wird als **inkrementelles PDF-Update**: neue/geänderte Objekte, neue
  Cross-Reference-Section und Trailer mit `/Prev` werden ans Dateiende angehängt. Die
  Original-Bytes bleiben unverändert.
- Beim ersten Speichern merkt sich die App die **Original-Länge** der Datei (Byte-Offset
  nach dem letzten `%%EOF` des Originals) in den eigenen Metadaten (siehe 3).
- **Bei jedem weiteren Speichern** wird geprüft, ob unser Update noch das letzte in der
  Datei ist:
  - **Ja** → Datei auf die Original-Länge abschneiden und das neue Update anhängen.
    Ergebnis ist immer „Original + genau ein Update von uns“; die Datei wächst nicht.
  - **Nein** (ein anderes Programm hat danach angehängt) → nicht abschneiden, sondern ein
    weiteres Update obendrauf anhängen, das unsere Objekte ersetzt. Die Original-Länge
    bleibt gespeichert.
- Hat die App noch gar nichts geschrieben, wird einfach angehängt.
- Die Art der Cross-Reference-Section folgt dem letzten Abschnitt der Basisdatei:
  basiert sie auf einem Xref-Stream, schreiben wir einen Xref-Stream, sonst eine
  klassische Xref-Tabelle.
- **Atomar schreiben**: neue Datei als Temp-Datei im selben Ordner erzeugen, dann per
  Rename ersetzen. Nie die PDF direkt in-place kürzen.
- **Verschlüsselte PDFs** (`/Encrypt` im Trailer) und nicht beschreibbare Dateien:
  Markierungen werden wie bisher in der `.data`-Begleitdatei gespeichert (Fallback), mit
  einem einmaligen Hinweis an den Nutzer. *(Entscheidung Claude:)* Der Fallback gilt
  **nur für PDFs, die noch keine eingebetteten Daten haben**. Schlägt das Schreiben einer
  PDF fehl, die schon eingebettete Daten hat (z. B. Datei in Acrobat geöffnet, Rename
  scheitert mit EBUSY/EPERM), gibt es keinen Fallback: Die App zeigt einen Fehler, behält
  die Daten im Speicher und versucht es beim nächsten Speichern erneut. So können nie
  zwei konkurrierende Stände entstehen. Fallback-`.data`-Dateien werden im neuen
  Punkte-Format mit Versionsfeld geschrieben, damit die Migration sie vom alten
  Pixel-Format unterscheiden kann.
- **Von einem anderen Programm komplett neu geschriebene Datei** (Preview, Handy-Apps,
  Acrobat „Speichern unter“) *(Entscheidung Claude)*: Passt `/OriginalLength` nicht mehr
  (an diesem Offset endet kein gültiger Abschnitt mit `%%EOF`), wird die aktuelle Datei
  als neues Original behandelt und nur noch angehängt, nie abgeschnitten.
  `/OriginalLength` wird neu gesetzt. Abschneiden passiert nur, wenn eindeutig erkannt
  wird, dass unser Update das letzte ist.
- **Verwaiste Stempel** *(Entscheidung Claude)*: Hat eine Stempel-Annotation unsere
  Kennung (`/NM` bzw. OCG), aber keine fabric-Daten mehr, wird sie nie automatisch
  gelöscht. Die App blendet sie nicht aus, sondern zeigt sie als nicht bearbeitbares Bild
  (das OCG-Ausblenden muss dafür so gelöst sein, dass es nur Stempel mit Daten betrifft,
  z. B. verwaiste Stempel beim Speichern aus der OCG nehmen). Neue Markierungen auf der
  Seite kommen als eigener Stempel dazu. Sichtbare Markierungen dürfen nie unbemerkt
  verloren gehen.

### 2. Was im Update steht

Pro Seite mit Markierungen:

- **Stempel-Annotation** (`/Subtype /Stamp`) mit
  - `/Rect` = sichtbarer Seitenbereich (CropBox, sonst MediaBox) zum Speicherzeitpunkt,
  - `/F 4` (Print), damit sie mitgedruckt wird,
  - `/AP /N` → Form-XObject, das ein **PNG-Bild** der Markierung (transparent, ca.
    300 dpi bezogen auf die Seitengröße) über den ganzen `/Rect` zeichnet,
  - `/OC` → Verweis auf unsere Optional-Content-Group (siehe 4),
  - `/NM` mit fester Kennung (z. B. `smv-markup-page`), damit wir unsere Annotation
    wiedererkennen,
  - einem Verweis auf den Datenstrom mit den fabric-Daten (siehe 3).
- Das **Seitenobjekt** wird im Update neu geschrieben, mit `/Annots` = bisherige
  Annotationen der Seite (unverändert) plus unsere.
- Die Appearance muss im **ungedrehten** Seiten-Koordinatensystem liegen. Bei Seiten mit
  `/Rotate` wird das Bild über die `/Matrix` des Form-XObjects passend gegengedreht,
  damit es in Viewern, die die Seite drehen, richtig herum über den Noten liegt.
- Seiten ohne Markierungen bekommen keine Annotation; eine vorher vorhandene wird
  entfernt.

### 3. Versteckte Bearbeitungsdaten

- Pro Annotation ein komprimierter Stream (Flate) mit dem fabric-JSON dieser Seite,
  referenziert über einen eigenen Schlüssel an der Annotation (z. B. `/SMV_Data`).
  Fremde Viewer ignorieren unbekannte Schlüssel.
- Im Catalog ein eigenes Dictionary (z. B. `/SMV_Markup`) mit
  - `/Version 1`,
  - `/OriginalLength` (Byte-Länge der Originaldatei),
  - ggf. weiteren Angaben, die der Writer zur Erkennung „unser Update ist das letzte“
    braucht.

### 4. Kein doppeltes Rendern in der App

- Alle unsere Annotationen gehören zu einer **Optional-Content-Group** (z. B.
  „Sheet Music Viewer – Markierungen“), die im Catalog unter `/OCProperties` angelegt
  wird und standardmäßig **an** ist (für Anzeige und Druck).
- In der App rendert pdf.js die Seite mit einer Optional-Content-Konfiguration, in der
  diese Gruppe **aus** ist (`optionalContentConfigPromise` in den Render-Parametern).
  Andere Annotationen der PDF (z. B. aus Acrobat) werden weiter angezeigt.
- Die Markierung in der App kommt wie heute aus den fabric-Daten (Overlay-Canvas bzw.
  Bearbeitungs-Canvas).
- Nebeneffekt: In Acrobat lässt sich die Ebene im Ebenen-Bedienfeld ein-/ausblenden.

### 5. Koordinaten

- Heute speichert die App fabric-Koordinaten in Bildschirmpixeln plus `drawWidth`/
  `drawHeight` und skaliert Breite und Höhe getrennt
  (`createOverlay`/`createFabricCanvas` in `SheetViewer.vue`).
- Neu: fabric-Daten werden in **PDF-Punkten** gespeichert, bezogen auf die Seite so wie
  sie angezeigt wird (pdf.js-Viewport bei `scale: 1`, inkl. Rotation). Beim Laden wird
  **einheitlich** mit `canvasBreite / Seitenbreite_in_Punkten` skaliert.
- Mitgespeichert wird der `/Rect`, gegen den gezeichnet wurde. Weicht der `/Rect` der
  Annotation beim Laden davon ab (ein anderes Programm hat Seite bzw. Annotation
  verschoben/skaliert), gilt der `/Rect` der Annotation: die fabric-Daten werden auf den
  neuen Rect umgerechnet.
- Seitenzuordnung: Die Markierung hängt am **Seitenobjekt**, nicht mehr an einer
  Seitennummer. Werden Seiten in einem anderen Programm umsortiert oder gelöscht,
  wandert die Markierung mit bzw. verschwindet mit.

### 6. Ablauf in der App

- **Öffnen**: Der Main-Prozess liest die PDF, findet unsere Annotationen und gibt pro
  Seite (Seitenindex zum Ladezeitpunkt) die fabric-Daten plus Rect zurück.
- **Speichern** (wie heute beim Verlassen des Bearbeitungsmodus): Der Renderer schickt
  für die geänderte Seite das fabric-JSON und das PNG an den Main-Prozess. Weil das
  Update immer komplett ersetzt wird, muss es alle Seiten enthalten. Für unveränderte
  Seiten übernimmt der Main-Prozess PNG und Daten aus dem bestehenden Update.
- Die geladene pdf.js-Instanz muss nach dem Speichern nicht neu geladen werden, da die
  App die Markierung aus den fabric-Daten zeichnet.

### 7. Migration bestehender `.data`-Dateien

- Beim Öffnen einer PDF: Gibt es eine `.data`-Datei und noch keine eingebetteten Daten,
  werden die alten Daten geladen, von Pixeln (`drawWidth`/`drawHeight`) auf PDF-Punkte
  umgerechnet, für jede Seite wird ein PNG gerendert, und alles wird in die PDF
  geschrieben.
- Erst wenn das Zurücklesen aus der PDF erfolgreich ist, wird die `.data`-Datei gelöscht.
- Gibt es beides (`.data` und eingebettete Daten), gewinnen die eingebetteten Daten und
  die `.data`-Datei bleibt liegen. Das dürfte nur bei Fallback-Fällen vorkommen.

## Dem Builder überlassen

- Bibliothekswahl für das Lesen/Erzeugen der PDF-Objekte. Vorschlag: `pdf-lib` zum
  Parsen und Serialisieren einzelner Objekte; den inkrementellen Writer (Anhängen,
  Xref-Section/-Stream, Trailer mit `/Prev`, `/Size`, `/Root`, `/Info`, `/ID`) selbst
  schreiben, da pdf-lib nicht inkrementell speichert.
- Genaue Namen der eigenen Schlüssel und der OCG.
- Wie das PNG im Renderer erzeugt wird (z. B. fabric `toDataURL` mit `multiplier` auf
  einem Offscreen-Canvas in Seitengröße).
- Wie „unser Update ist das letzte“ robust erkannt wird.
- Aufteilung auf Dateien/Module und tRPC-Prozeduren.
- Tests: Ein Round-Trip-Test (schreiben → lesen → gleiche Daten, Original-Bytes
  unverändert, Datei wächst bei wiederholtem Speichern nicht) mit den beiden Beispiel-PDFs
  ist Pflicht. Dass andere Viewer die Markierung zeigen, wird zusätzlich manuell geprüft
  (z. B. Browser-PDF-Viewer, qpdf `--check`).
