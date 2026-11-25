# Seitenteiler je Seitenwechsel verschieben

Stand: 2026-11-23 · Status: freigegeben · Ergänzt: `2026-11-22-folder-config-design.md` (neuer Teil `sheets` in
`.config.json`)

## Warum

Der Viewer blättert in zwei Schritten: Der erste Druck auf „weiter“ legt die obere Hälfte der nächsten Seite
über die aktuelle, der zweite zeigt die nächste Seite ganz. Die Grenze dazwischen, der **Seitenteiler**,
liegt fest bei 50 % der Seitenhöhe; zwei kleine rote Marken am Seitenrand zeigen sie an.

Der Teiler legt damit fest, **wann** geblättert werden kann: Der erste Druck muss fallen, während man unter
dem Teiler auf der aktuellen Seite spielt, der zweite, während man über dem Teiler auf der nächsten Seite
spielt. Sebastian: Je nach Blatt gibt es in den unteren 50 % der Seite oder in den oberen 50 % der nächsten
keinen guten Moment zum Blättern. Er will den Teiler deshalb je Seite in der Höhe verschieben können; die
Einstellung soll gespeichert werden, aber **nicht in der PDF**.

## Ziele

- Für jeden Seitenwechsel (Seite n → n+1) eines Blatts lässt sich die Höhe des Teilers einstellen.
- Die Einstellung bleibt erhalten (Neustart, anderer PC mit demselben Notenordner) und steht nicht in der PDF.
- Beim Einstellen sieht man genau das, was beim Spielen nach dem ersten Druck zu sehen ist.
- Ohne Einstellung bleibt alles wie heute (Teiler in der Mitte).

## Nicht-Ziele

- Mehr als ein Teiler je Seitenwechsel (Blättern in drei Schritten). Liegt der einzige gute Moment auf der
  aktuellen Seite höher als der einzige gute Moment auf der nächsten, hilft keine Position; das bleibt so.
- Einstellungen folgen einer umbenannten oder verschobenen PDF. Sie hängen am Pfad im Notenordner; nach dem
  Umbenennen gilt wieder die Mitte. Verwaiste Einträge werden nicht aufgeräumt.
  **Aufgehoben** durch `2026-11-25-favorites-design.md` („Umzug eines Eintrags“): Die Einstellungen eines
  Blatts (Teiler und Favorit) folgen über einen Fingerabdruck der PDF einer verschobenen oder umbenannten PDF.
  Verwaiste Einträge werden weiterhin nicht aufgeräumt.
- Anpassung, wenn ein anderes Programm Seiten der PDF einfügt oder entfernt (die Einträge hängen an der
  Seitennummer).
- Warteschlange, Wiederholung und Rückfrage beim Schließen für nicht gespeicherte Teiler (wie bei den
  Markierungen). Ein gescheitertes Speichern wird gemeldet, mehr nicht.
- Feinjustieren per Tastatur.
- Zusammenführen gleichzeitiger Änderungen zweier PCs (Nextcloud legt wie bei den Setlisten eine
  Konfliktkopie an).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)

- Ein Teiler verschiebt sich beim Spielen versehentlich (Berührung, Klick, Pedal).
- Das Einstellen eines Teilers verändert die PDF (auch nur ein Byte).
- Das Speichern eines Teilers löscht oder verändert Setlisten, `markupMigrated`, unbekannte Felder oder die
  Teiler anderer Blätter und Seiten.
- Eine nicht lesbare `.config.json` wird überschrieben.
- Das Öffnen eines Blatts oder das Betreten und Verlassen des Teiler-Modus ohne Änderung schreibt
  `.config.json` (Nextcloud synchronisiert sonst ständig).
- Der Teiler-Modus zeigt etwas anderes als der erste Blätterschritt beim Spielen.
- Blätter ohne gespeicherten Teiler sehen beim Blättern anders aus als heute.

## Randbedingungen

- Windows, Notenordner in einem geteilten Nextcloud-Ordner; Dateien können kurz gesperrt sein.
- Der Teiler muss auch für PDFs einstellbar sein, in die keine Markierungen gespeichert werden können
  (verschlüsselt, schreibgeschützt): Er hat mit der PDF nichts zu tun.
- Code im Hauptprogramm ohne Electron-Importe, in Node unit-getestet; GUI-Tests headless.
- `src/views/SheetViewer.vue` ist gewachsener Code. Geändert wird nur, was der Teiler braucht; kein Umbau.

## Ansätze

Wie der Teiler eingestellt wird:

1. **Gewählt (Sebastian, 2026-11-23): eigener Teiler-Modus.** Ein Knopf in der App-Leiste neben dem Stift.
   Der Modus zeigt die halb umgeblätterte Ansicht selbst, der Teiler ist eine Linie zum Ziehen. Man sieht
   beide Zeitfenster zugleich (oben: nächste Seite, unten: Rest der aktuellen), und beim Spielen kann sich
   nichts verschieben. Preis: ein Knopf mehr.
2. Die roten Marken in der normalen Ansicht ziehen (verworfen: eine Berührung beim Spielen könnte den Teiler
   verschieben, und man sieht nur die aktuelle Seite, nicht was von der nächsten erscheint).
3. Im Stift-Modus (verworfen: der Stift ist aus, wenn die PDF nicht beschreibbar ist; Ziehen kollidiert mit
   dem Zeichnen; man sieht nur eine Seite).

Wo gespeichert wird *(Entscheidung Claude, Sebastian am 2026-11-23 genannt, kein Einwand)*:

1. **Gewählt: `.config.json` im Notenordner.** Der bestehende Ort für alles, was nicht in der PDF steht;
   wandert mit dem Ordner zu den anderen PCs.
2. Im App-Profil des PCs (verworfen: jeder PC müsste jeden Teiler neu einstellen).
3. Eine Datei neben jeder PDF (verworfen: die `.data`-Dateien wurden gerade abgeschafft).

## Design

### Modell

- Ein Teiler gehört zu einem **Seitenwechsel** n → n+1 (n = 1 … Seitenzahl − 1) *(Entscheidung Claude:
  Sebastian sagte „je Seite“; ein Schnitt bedient immer zwei Seiten zugleich, also ist die Einheit der
  Wechsel)*.
- Sein Wert ist ein Anteil der angezeigten Höhe der **nächsten** Seite (n+1), von oben gemessen; `0.5` ist
  die Mitte und der Standard. Als Anteil gilt er für jede Fenstergröße und jeden Bildschirm.
- Erlaubt sind 0,05 bis 0,95 *(Entscheidung Claude: an den Rändern wäre der erste Schritt sinnlos und die
  Linie kaum zu greifen)*. Beim Loslassen wird auf drei Nachkommastellen gerundet.
- Schlüssel ist die Seite, die man **verlässt** (n): Das ist die Seite, auf der die roten Marken diesen
  Teiler anzeigen *(Entscheidung Claude)*.

### Speichern in `.config.json`

```json
{
  "version": 1,
  "setLists": { "version": 2, "setLists": [ … ] },
  "markupMigrated": { "at": "…" },
  "sheets": {
    "Ordner/Unterordner/Stück.pdf": { "pageDividers": { "2": 0.62, "5": 0.4 } }
  }
}
```

- `sheets` ist neu: Einstellungen je Blatt, Schlüssel ist der Pfad der PDF relativ zum Notenordner mit `/`
  als Trenner (auf jedem Betriebssystem gleich), in der Schreibweise, in der das Blatt geöffnet wurde
  (exakter Vergleich: keine Groß-/Kleinschreibung angleichen, keine Verknüpfungen auflösen; Notenliste,
  Suche und Setlisten ergeben für dieselbe Datei denselben Pfad). Je
  Blatt ein Objekt, darin `pageDividers`: Seite (die man verlässt) → Anteil. `"2": 0.62` heißt: Beim Wechsel
  von Seite 2 auf 3 liegt der Teiler bei 62 % der Höhe von Seite 3 *(Entscheidung Claude: eine Ebene „je
  Blatt“ statt einer Tabelle nur für Teiler, damit spätere Einstellungen je Blatt keinen neuen Aufbau
  brauchen; das Format der geteilten Datei lässt sich später schwer ändern)*.
- Gespeichert werden nur Werte, die von der Mitte abweichen. „Zur Mitte“ entfernt den Eintrag der Seite,
  ebenso ein Loslassen, das gerundet 0,5 ergibt; ein leeres `pageDividers`, ein leeres Blatt-Objekt und ein
  leeres `sheets` werden entfernt.
- `version` bleibt 1. Ältere Versionen der App mit `.config.json` kennen `sheets` nicht und erhalten es beim
  Schreiben wie jedes unbekannte Feld. Unbekannte Felder in einem Blatt-Objekt bleiben ebenfalls erhalten.
- Das Schema prüft den Aufbau (Objekt → Objekt → `pageDividers`-Objekt → Zahlen); `pageDividers` ist im
  Blatt-Objekt optional. Ein falscher Aufbau macht die Datei `unreadable` wie bei den Setlisten. Ein
  Schlüssel in `pageDividers`, der keine ganze Seitenzahl ist, wird wie eine nicht vorhandene Seite ignoriert
  und bleibt beim Schreiben stehen. Der **Wertebereich** wird nicht vom Schema geprüft: Ein Wert
  außerhalb von 0,05 … 0,95 wird beim Anzeigen begrenzt, ein Eintrag für eine Seite, die es nicht gibt (oder
  die letzte), ignoriert *(Entscheidung Claude: ein von Hand vertippter Wert soll nicht die ganze Datei und
  damit Setlisten und Schranke blockieren)*.
- **Schreiben** ändert genau einen Teiler: Blatt, Seite, Wert oder „entfernen“. Wie bei den anderen Teilen
  liest das Hauptprogramm den Stand frisch, ändert nur diesen einen Eintrag, schreibt atomar mit Zurücklesen
  und schreibt nicht, wenn sich nichts ändert. Alles andere bleibt, auch Teiler desselben Blatts, die ein
  anderer PC inzwischen eingespielt hat. Eine Datei, die `unreadable` ist, wird nie geschrieben. Ein Ordner,
  der nur `.set-lists.json` hat, wird dabei wie bei jedem Schreiben zuerst übernommen (R1 der
  Ordner-Spezifikation).
- **Lesen** liefert für ein Blatt seine Teiler oder `unreadable` mit Datei und Meldung (auch „neuere
  Version“), wie beim Laden der Setlisten.
- Ein Blatt, dessen Pfad nicht im aktuellen Notenordner liegt, hat keine Teiler und der Teiler-Modus ist für
  es aus *(Entscheidung Claude; kommt im normalen Ablauf nicht vor)*.

### Blättern (normale Ansicht)

- Der Viewer lädt die Teiler des Blatts einmal beim Öffnen, vor dem ersten Zeichnen; der Teiler-Modus liest
  die Datei nicht erneut (nach einer Reparatur der Datei das Blatt neu öffnen). Schlägt das Laden fehl
  (`unreadable`), gilt überall die Mitte; es gibt dafür keinen eigenen Hinweis beim Öffnen (eine unlesbare
  `.config.json` melden schon die Setlisten und die Schranke).
- Der Schnitt im ersten Blätterschritt liegt am Teiler des Wechsels statt bei 50 %, und zwar an allen drei
  Stellen, die heute die Hälfte fest eingebaut haben: Seitenbild, schwarzer Hintergrund samt dem 5 px
  breiten Trennstreifen darunter, Markierungs-Overlay
  (`copyPageToHalfPageAndBackdrop`, `createOverlay` in `SheetViewer.vue`).
- Die zwei roten Marken am Seitenrand bleiben, wie sie sind, stehen aber auf der Höhe des Teilers für den
  nächsten Wechsel. In der normalen Ansicht lassen sie sich nicht bewegen. Im halben Schritt bleiben sie
  wie heute (dort praktisch unsichtbar).
- Nach einer Größenänderung des Fensters stimmen die Teiler weiter (Anteile).

### Teiler-Modus

```
┌──────────────────────────────┐
│ Oberer Teil von Seite 3      │  ← hier muss der 2. Druck Platz haben
│                              │
◄════════ Linie ziehen ════════►
│ Rest von Seite 2             │  ← hier muss der 1. Druck Platz haben
│                              │
└──────────────────────────────┘
        ‹   Seite 2 → 3   ›   [Zur Mitte]
```

- **Knopf** in der App-Leiste des Viewers neben dem Stift; im Modus wird er wie beim Stift zum „Schließen“,
  und die Leiste wechselt die Farbe, damit der Modus erkennbar ist (nicht das Rot des Stift-Modus).
- Stift-Modus und Teiler-Modus schließen sich aus: Solange einer an ist, ist der Knopf des anderen gesperrt.
- Der Knopf ist gesperrt, solange das Blatt lädt und wenn es nur eine Seite hat. Konnten die Teiler nicht
  geladen werden, bleibt der Knopf bedienbar; ein Druck darauf lässt den Modus aus und zeigt den Grund („Die Seitenteiler können nicht
  verschoben werden: „‹Datei›“ kann nicht gelesen werden: ‹Meldung›“ bzw. bei einer neueren Version „…
  stammt von einer neueren Version der App. Bitte die App aktualisieren.“) *(Entscheidung Claude: wie beim
  Stift nichts einstellen lassen, was sicher nicht gespeichert werden kann)*.
- Der Modus hängt nicht davon ab, ob Markierungen in die PDF gespeichert werden können.
- **Ansicht:** der echte erste Blätterschritt des gewählten Wechsels mit denselben Mitteln wie beim Spielen
  (oben die nächste Seite bis zum Teiler, darunter der Rest der aktuellen, Markierungen eingeschlossen). Der
  Teiler ist eine rote Linie über die ganze Seitenbreite.
- **Einstieg:** Auf einer ganzen Seite n zeigt der Modus den Wechsel n → n+1, auf der letzten Seite den
  letzten Wechsel, in einem halben Schritt dessen Wechsel.
- **Ziehen:** Die Linie lässt sich mit Maus oder Finger nach oben und unten ziehen; die Greiffläche ist
  deutlich höher als die Linie (Finger). Schnitt und Linie folgen beim Ziehen sofort, und zwar relativ zur
  Stelle, an der gegriffen wurde: Die Linie springt nicht zum Zeiger, ein Druck ohne Bewegung ändert nichts.
  Ein Klick oder Tippen neben die Linie tut nichts (kein Blättern, kein Versetzen).
- **Loslassen** speichert den Wert, wenn er sich geändert hat. Scheitert das Speichern, zeigt die App „Der
  Seitenteiler konnte nicht gespeichert werden: ‹Meldung›. Er gilt nur, bis das Blatt geschlossen wird.“;
  der gezogene Wert bleibt für das offene Blatt gültig. Ist die Datei nicht lesbar, ist die ‹Meldung› wie
  bei den Setlisten aufgebaut („‹Datei›“ kann nicht gelesen werden: …).
- **Wechsel wählen:** „‹“ und „›“ sowie die Pfeiltasten links/rechts (und damit das Pedal) gehen zum
  vorherigen/nächsten Wechsel und bleiben am ersten und letzten stehen. Eine Anzeige nennt den Wechsel
  („Seite 2 → 3“).
- **„Zur Mitte“** setzt den Teiler des gezeigten Wechsels auf 50 % und speichert; gesperrt, wenn er dort
  schon steht.
- **Verlassen** (Knopf in der Leiste, Zurück-Pfeil der App) führt zur ganzen Seite n des zuletzt gezeigten
  Wechsels; der Zurück-Pfeil verlässt wie im Stift-Modus zugleich das Blatt.
- Die Bedienelemente folgen dem Muster der runden Knöpfe des Stift-Modus und dürfen die Linie nie
  unerreichbar machen (sie ist über die ganze Seitenbreite greifbar).
- Texte auf Deutsch, wie in den zuletzt gebauten Teilen *(Entscheidung Claude)*.

### Dokumentation

`AGENTS.md` bekommt einen Abschnitt zum Seitenteiler und im Absatz zu `.config.json` den Teil `sheets`; die
Ordner-Spezifikation (`2026-11-22-folder-config-design.md`) einen Verweis auf den neuen Teil.

## Tests

- Unit (Node), Einstellungsdatei: Schreiben eines Teilers erhält Setlisten, `markupMigrated`, unbekannte
  Felder, andere Blätter, andere Seiten desselben Blatts und unbekannte Felder im Blatt-Objekt; Entfernen
  räumt leere Ebenen ab; unveränderter Inhalt schreibt nicht; `unreadable` schreibt nie; Lesen liefert die
  Teiler eines Blatts; falscher Aufbau von `sheets` ist `unreadable`; Schlüssel aus Ordner und PDF-Pfad (`/`
  als Trenner, Pfad außerhalb des Ordners abgelehnt); Übernahme von `.set-lists.json` beim Schreiben.
- Unit, Rechnen: Begrenzen und Runden, Anteil ↔ Pixel, Einträge für nicht vorhandene Seiten ignoriert.
- Headless e2e auf einem künstlichen Ordner unter `test-results/visual/work/` (kein Korpus nötig), mit einer
  mehrseitigen PDF, deren Seiten sich im Bild unterscheiden:
  - ohne Einstellung liegt der Schnitt im ersten Blätterschritt in der Mitte (wie heute);
  - im Teiler-Modus die Linie ziehen: `.config.json` enthält den Wert, die PDF ist Byte für Byte unverändert;
    nach dem Verlassen liegt der Schnitt beim Blättern an der neuen Stelle (über der Linie Seite n+1,
    darunter Seite n), die roten Marken ebenso;
  - nach einem Neustart gilt der Wert weiter; „Zur Mitte“ entfernt den Eintrag;
  - ein Klick neben die Linie und die Pfeiltasten im Modus ändern keinen Teiler;
  - Öffnen eines Blatts und Betreten/Verlassen des Modus ohne Ziehen schreiben `.config.json` nicht;
  - eine PDF, in die keine Markierungen gespeichert werden können: der Teiler lässt sich trotzdem einstellen;
  - kaputte `.config.json`: der Modus bleibt aus, der Hinweis erscheint, die Datei ist unverändert (im
    echten Betrieb scheitert mit so einer Datei schon die Schranke beim Start, der Fall entsteht dort nur,
    wenn die Datei bei laufender App kaputtgeht; der Test nutzt den Schalter des Treibers, der die Schranke
    überspringt, und muss zuerst den Hinweis der Setlisten schließen);
  - einseitige PDF: der Knopf ist gesperrt.
- Bestehende Tests und der visuelle Gesamtlauf bleiben ohne Abweichung.

## Dem Builder überlassen

- Namen und Aufteilung der Module, der tRPC-Aufrufe und des Zustands für den Modus.
- Ob der Schnitt weiter durch Löschen der Pixel entsteht oder per CSS (`clip-path`), solange das Ergebnis
  ohne gespeicherten Teiler dem heutigen gleicht und der Modus dieselben Mittel nutzt wie das Blättern.
- Aussehen von Linie und Griff, Symbol und Farbe in der App-Leiste, genaue Anordnung der Bedienelemente.
- Wie die e2e-Tests die Lage des Schnitts prüfen (Bildzeilen oder Geometrie der Elemente).
