# Zoomen im Bearbeiten-Modus

Stand: 2026-11-23 · Status: freigegeben

## Warum

Sebastian will beim Bearbeiten (Stift-Modus) hineinzoomen können, um Markierungen genauer zu setzen. Heute
liegt die Zeichenfläche genau in Seitengröße über der Seite; zoomen, verschieben oder ein Fingerzoom gibt es
nicht. Gezoomt werden soll mit zwei Fingern (Pinch), und zwar über 2× hinaus; 5× ist ausdrücklich keine
Obergrenze.

Er arbeitet je nach Gerät mit Stift, mit dem Finger oder mit Maus/Trackpad. Alle drei müssen gehen.

## Ziele

- Im Stift-Modus mit zwei Fingern zoomen (Pinch) und den Ausschnitt verschieben (zwei Finger ziehen); mit
  Maus/Trackpad über Strg + Mausrad bzw. Trackpad-Pinch.
- Die Seite bleibt bei jeder Zoomstufe scharf (nach einem kurzen Moment, siehe Design).
- Zeichnen, Symbole setzen und Verschieben funktionieren gezoomt genauso wie ungezoomt; das Ergebnis auf der
  Seite ist dasselbe, als hätte man ungezoomt mit derselben Genauigkeit gearbeitet.
- Ein Weg zurück zur ganzen Seite.

## Nicht-Ziele

- Zoomen in der normalen Ansicht (Spielen) und im Teiler-Modus.
- Umbau des Bearbeiten-Modus oder der Overlays (besprochen und verworfen, siehe Ansätze).
- Handballenerkennung (Hand liegt beim Schreiben mit Stift auf dem Bildschirm).
- Blättern im Stift-Modus (geht heute nicht und bleibt so).
- Merken der Zoomstufe über das Verlassen des Stift-Modus hinaus.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Ein Pinch hinterlässt einen Strich.
- Gespeicherte Markierungen hängen von der Zoomstufe ab (andere Lage oder Größe auf der Seite, je nachdem,
  wie weit beim Zeichnen gezoomt war).
- Das Verlassen des Stift-Modus ohne Änderung speichert, weil sich nur der Zoom geändert hat.
- Die Seite bleibt gezoomt dauerhaft unscharf, oder Zoomen macht den Bearbeiten-Modus spürbar langsamer zu
  öffnen.
- Electron/Chromium zoomt die ganze App mit (Strg + Mausrad, Pinch), statt nur die Seite.
- Normale Ansicht, Halbseiten-Blättern, Teiler oder das Speichern in die PDF verhalten sich anders als heute.

## Randbedingungen

- Windows-Tablets und -Laptops (Touch, Stift, Maus, Trackpad), Electron 45, fabric 7.4, pdf.js 6.5.
- Die Seite wird heute einmal in fester Auflösung gerendert (Faktor 4 auf die Seitengröße in Punkt); auf
  hochauflösenden Bildschirmen wirkt sie ab etwa 1,5× weich.
- `src/views/SheetViewer.vue` ist gewachsener, großer Code; die Zoom-Logik kommt in eigene Dateien und wird
  dort angebunden, ohne Umbau.
- Markierungen werden beim Speichern aus den Koordinaten der Zeichenfläche (Seitengröße auf dem Bildschirm) in
  PDF-Punkte umgerechnet (`payloadFromCanvas`); diese Umrechnung bleibt unverändert.
- Code im Hauptprogramm ohne Electron-Importe, unit-getestet; GUI-Tests headless.

## Ansätze

Wie die Seite beim Zoomen scharf bleibt:

1. **Gewählt (Sebastian, 2026-11-23): sichtbaren Ausschnitt scharf nachzeichnen.** Während der Geste wird das
   vorhandene Seitenbild nur vergrößert (kurz weich, folgt aber sofort); kurz nach dem Ende der Geste zeichnet
   pdf.js genau den sichtbaren Ausschnitt in Bildschirmauflösung. Scharf bei jeder Stufe, gleicher
   Speicherbedarf bei 2× wie bei 20×, Öffnen so schnell wie heute. Preis: kurzer weicher Moment, mehr Code.
2. Ganze Seite beim Öffnen in hoher Auflösung rendern (verworfen: Öffnen spürbar langsamer, viel Speicher,
   Browser-Grenzen für Canvas-Größen auf Tablets; scharf nur bis etwa 3×).
3. Den Viewer von pdf.js mit eigenem Zoom nutzen (verworfen: ersetzt die ganze Seitendarstellung, auf der
   Markierungs-Overlays und Halbseiten-Blättern aufbauen).

Erst den Bearbeiten-Modus umbauen? *(Sebastian, 2026-11-23: nein, Zoom auf den heutigen Modus aufsetzen)*.
Der Zoom berührt nur die Zeichenfläche (deren Ansicht lässt sich zoomen, ohne die Lage der Markierungen zu
ändern) und ein eigenes Bild des sichtbaren Ausschnitts; ein Umbau wäre ein eigenes Projekt mit Risiko für
das gerade abgesicherte Speichern.

## Design

### Bedienung

- **Ein Zeiger zeichnet, zwei Finger zoomen** *(Sebastians Vorschlag angenommen)*: Stift, ein Finger und Maus
  zeichnen bzw. verschieben Symbole wie heute. Zwei Finger auf der Seite zoomen immer (Abstand der Finger)
  und verschieben dabei den Ausschnitt (Mittelpunkt der Finger); der Punkt zwischen den Fingern bleibt unter
  den Fingern. Das gilt im Zeichnen- wie im Hand-Modus.
- **Strich beim Pinch:** Landet der zweite Finger, während der erste schon einen Strich begonnen hat, wird
  dieser Strich verworfen, wenn er weniger als 300 ms alt ist; ist er älter, wird er an der Stelle beendet und
  behalten *(Entscheidung Claude: ein bewusst gezogener Strich soll nicht verschwinden, ein Pinch nie einen
  Strich hinterlassen)*. In beiden Fällen beginnt die Geste. Ein Objekt, das der erste Finger im Hand-Modus
  gerade zieht, springt an seine Ausgangslage zurück, wenn der zweite Finger innerhalb von 300 ms landet,
  sonst bleibt es, wo es ist.
- **Stift und Finger zugleich** *(Entscheidung Claude)*: Als Finger einer Geste zählen nur Touch-Zeiger. Ein
  Stift beginnt nie eine Geste, und ein Stiftstrich wird nie verworfen. Solange der Stift aufliegt, werden
  Finger ignoriert (eine aufliegende Hand verschiebt nichts). Eine Maus zählt nie als Finger.
- **Maus/Trackpad:** Strg + Mausrad zoomt um den Mauszeiger; ein Trackpad-Pinch kommt in Chromium als Strg +
  Rad an und wirkt genauso. Das Mausrad allein verschiebt den Ausschnitt senkrecht, Umschalt + Rad
  waagerecht (Trackpads liefern beim Zwei-Finger-Wischen beide Richtungen direkt). Die App selbst zoomt dabei
  nie mit: im Stift-Modus wird das Standardverhalten von Strg + Rad über der Seite unterbunden. Außerhalb des
  Stift-Modus bleibt alles wie heute, auch die Zoom-Einträge des Electron-Standardmenüs (Strg + Plus/Minus/0)
  *(Entscheidung Claude: die normale Ansicht wird nicht verändert; `src/main.ts` bleibt unberührt)*.
- **Grenzen:** von 1× (ganze Seite, wie heute) bis 20× *(Entscheidung Claude: Sebastian will keine Grenze bei
  5×; 20× nur als Schutz, damit man sich nicht in einer leeren Ecke verliert)*. Kleiner als 1× geht nicht.
  Der Ausschnitt lässt sich nicht über die Seitenränder hinaus schieben.
- **Zurück zur ganzen Seite:** Solange gezoomt ist, zeigt der Stift-Modus einen zusätzlichen runden Knopf
  „ganze Seite“ bei den übrigen Knöpfen. Verlassen des Stift-Modus setzt den Zoom immer zurück; beim nächsten
  Öffnen beginnt er bei 1×.
- **Neue Symbole und Texte** erscheinen in der Mitte des sichtbaren Ausschnitts (heute: Mitte der Seite).
- **Strichstärke:** Die gewählte Stärke gilt für die Seite, nicht für den Bildschirm: gezoomt erscheint der
  Strich entsprechend dicker, auf der Seite ist er so dick wie ungezoomt gezeichnet *(Entscheidung Claude:
  das Ergebnis hängt nicht von der Zoomstufe ab, siehe Anti-Ziele)*. Für feine Striche gibt es weiter die
  dünnste Stärke.
- **Fenstergröße ändern:** Zeichnet die App die Seite wegen einer Größenänderung neu (der bestehende Weg über
  `onResize`/`renderPdf`), geht der Zoom auf 1× zurück *(Entscheidung Claude)*. Eine Bildschirmtastatur, die
  das Fenster nicht verkleinert, ändert nichts. Dass die Zeichenfläche heute bei einer Größenänderung im
  Stift-Modus ihre alte Größe behält, ist ein bestehendes Verhalten und nicht Teil dieser Arbeit.

### Darstellung

- **Markierungen:** Die Zeichenfläche (fabric) behält ihre Größe und ihr Koordinatensystem; gezoomt wird
  über ihre Ansichts-Transformation. Objekte behalten ihre Koordinaten, das Speichern und der Vergleich „hat
  sich etwas geändert“ bleiben unverändert und unabhängig vom Zoom (`toObject` enthält die
  Ansichts-Transformation nicht). Markierungen müssen bei jeder Stufe scharf sein. Achtung: fabric zeichnet
  Objekte standardmäßig über einen Zwischenspeicher pro Objekt, dessen Größe begrenzt ist
  (`perfLimitSizeTotal`, `maxCacheSideLimit`); lange Striche und Symbole werden dadurch ab etwa 5× unscharf.
  Auf der Zeichenfläche des Stift-Modus muss das verhindert werden (z. B. Zwischenspeicher der Objekte dort
  aus, oder nur gezoomt aus); die globale fabric-Konfiguration nicht ändern, weil `src/markup/renderPng.ts`
  sie für die Stempelbilder nutzt. Die Wahl richtet sich nach gemessener Flüssigkeit auf einer Seite mit
  vielen Markierungen.
- **Seite:** Solange gezoomt ist, liegt unter der Zeichenfläche ein eigenes Bild in Größe der Zeichenfläche
  (Bildschirmauflösung × Pixelverhältnis des Geräts), das den sichtbaren Ausschnitt der Seite zeigt. Während
  einer Geste wird das zuletzt gezeichnete Bild (bzw. am Anfang die heutige Seite) passend vergrößert und
  verschoben; etwa 200 ms nach dem Ende der Geste rendert pdf.js genau den sichtbaren Ausschnitt neu, mit
  denselben Einstellungen wie die normale Seite (insbesondere bleiben die eigenen Markierungsstempel
  ausgeblendet). Beginnt eine neue Geste, wird ein laufendes Rendern abgebrochen. Bei 1× zeigt der Stift-Modus
  wie heute die normale Seite.
- Normale Ansicht, Halbseiten, Teiler und deren Canvases bleiben unberührt.

### Aufbau

- Eigene Dateien *(Entscheidung Claude)*: die Rechnung für Zoom und Ausschnitt (Grenzen, Zoomen um einen Punkt,
  Verschieben mit Rand) als reine Funktionen, unit-getestet; die Gestenerkennung (Zeiger zählen, Pinch,
  Strich verwerfen, Rad) als eigenes Modul; das scharfe Nachzeichnen des Ausschnitts als eigenes Modul.
  `SheetViewer.vue` bindet sie beim Öffnen und Schließen des Stift-Modus an.

### Dokumentation

`AGENTS.md` bekommt einen kurzen Abschnitt zum Zoom im Stift-Modus.

## Tests

- Unit: Zoom bleibt zwischen 1× und 20×; Zoomen um einen Punkt fern der Seitenränder lässt diesen Punkt an
  derselben Bildschirmstelle (am Rand verschiebt die Begrenzung den Ausschnitt, das ist richtig); der
  Ausschnitt bleibt innerhalb der Seite; Zurücksetzen ergibt 1× ohne Versatz.
- e2e zusätzlich: gezoomt auf 10× ist ein langer Strich scharf (nicht aus einem verkleinerten
  Zwischenspeicher vergrößert).
- Headless e2e auf einem künstlichen Ordner (kein Korpus nötig), mehrseitige PDF:
  - Strg + Rad zoomt, die App selbst zoomt nicht mit; das Seitenbild ist nach dem Nachzeichnen scharf
    (Auflösung des Ausschnitt-Bilds entspricht der Zeichenfläche);
  - ein Strich gezoomt gezeichnet landet nach dem Verlassen des Stift-Modus an derselben Stelle der Seite wie
    derselbe Strich ungezoomt (gespeicherte Markierung vergleichen);
  - nur zoomen und wieder verlassen speichert nichts (PDF Byte für Byte gleich);
  - Pinch mit zwei Fingern (Touch-Punkte über das DevTools-Protokoll) zoomt und hinterlässt keinen Strich;
  - der Knopf „ganze Seite“ erscheint gezoomt und setzt auf 1× zurück; erneutes Öffnen beginnt bei 1×;
  - ein neues Symbol erscheint gezoomt in der Mitte des sichtbaren Ausschnitts.
- Bestehende Tests und der visuelle Gesamtlauf mit Korpus bleiben ohne Abweichung.

## Dem Builder überlassen

- Namen und Aufteilung der neuen Module; Symbol und genaue Lage des Knopfs „ganze Seite“.
- Wie Eingaben abgefangen werden, damit fabric bei zwei Fingern nicht zeichnet, und wie ein begonnener Strich
  verworfen wird. Hinweis: Die Zeichenfläche setzt `enablePointerEvents` nicht; fabric hört daher heute auf
  Maus- und Touch-Ereignisse (`touchstart`/`touchmove`), nicht auf Pointer-Ereignisse. Wer nur
  Pointer-Ereignisse abfängt, verhindert den Strich des ersten Fingers nicht (Abfangen muss die Touch-Ereignisse
  einschließen, oder fabric wird auf Pointer-Ereignisse umgestellt).
- Zoomschritt pro Radbewegung, genaue Wartezeit vor dem Nachzeichnen (um 200 ms).
- Wie die e2e-Tests Schärfe und Lage prüfen.
