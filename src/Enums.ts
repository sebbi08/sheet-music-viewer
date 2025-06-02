import { type Color } from "./models/types";

export enum RouteNames {
  "SheetSelection" = "SheetSelection",
  "FolderSetup" = "FolderSetup",
  "Overview" = "Overview",
  "SheetViewer" = "SheetViewer",
  SetListList = "SetListList",
  SetList = "SetList",
}

export class BRUSH_COLORS {
  static readonly RED = new BRUSH_COLORS({ r: 255, g: 0, b: 0 });
  static readonly GREEN = new BRUSH_COLORS({ r: 0, g: 255, b: 0 });
  static readonly BLUE = new BRUSH_COLORS({ r: 0, g: 0, b: 255 });
  static readonly BLACK = new BRUSH_COLORS({ r: 0, g: 0, b: 0 });
  static readonly WHITE = new BRUSH_COLORS({ r: 255, g: 255, b: 255 });

  // private to disallow creating other instances of this type
  private constructor(private readonly color: Color) {}

  getColor(): Color {
    return this.color;
  }

  equals(color: Color): boolean {
    return (
      color.b === this.color.b &&
      color.r === this.color.r &&
      color.g === this.color.g
    );
  }
}

export class ACTION_ICONS {
  static readonly deleteIcon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' style='width:24px;height:24px' viewBox='0 0 24 24'%3E%3Cpath fill='red' d='M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z' /%3E%3C/svg%3E";
  static readonly cloneIcon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' style='width:24px;height:24px' viewBox='0 0 24 24'%3E%3Cpath fill='green' d='M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z' /%3E%3C/svg%3E";
  static readonly editIcon =
    "data:image/svg+xml,%3Csvg fill='blue' height='24px' width='24px' version='1.1' id='Capa_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 31.982 31.982' xml:space='preserve'%3E%3Cg id='SVGRepo_bgCarrier' stroke-width='0'%3E%3C/g%3E%3Cg id='SVGRepo_tracerCarrier' stroke-linecap='round' stroke-linejoin='round'%3E%3C/g%3E%3Cg id='SVGRepo_iconCarrier'%3E%3Cg%3E%3Cpath d='M3.952,23.15L0,31.955l8.767-3.992l0.018,0.019L3.938,23.13L3.952,23.15z M4.602,22.463L24.634,2.432l4.849,4.848 L9.45,27.312L4.602,22.463z M30.883,0.941c-2.104-1.963-4.488-0.156-4.488-0.156l4.851,4.843 C31.244,5.627,33.124,3.375,30.883,0.941z'%3E%3C/path%3E%3C/g%3E%3C/g%3E%3C/svg%3E"
  }



export interface Icon {
  name: string;
  code: string;
}

export interface Svg {
  name: string;
  file: string;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

export class MDI_ICONS {
  static readonly GLASSES: string = "\u{F02AA}";
  static readonly NEXT_PAGE: string = "\u{F15D6}";
  static readonly ALL_ICONS: Icon[] = [
    { name: "GLASSES", code: MDI_ICONS.GLASSES },
    { name: "NEXT_PAGE", code: MDI_ICONS.NEXT_PAGE }
  ];

}

export class MUSIC_ICONS {
  static readonly FLAT: string = "\u{266D}";
  static readonly NATURAL: string = "\u{266E}";
  static readonly SHARP: string = "\u{266F}";
  static readonly REPEAT_START: string = "\u{01D106}";
  static readonly REPEAT_END: string = "\u{01D107}";
  static readonly FERMATA: string = "\u{01D110}";
  static readonly BREATH_MARK: string = "\u{01D112}";
  static readonly ACCENT: string = "\u{01D17B}";
  static readonly STACCATO: string = "\u{01D17C}";
  static readonly TENUTO: string = "\u{01D17D}";
  static readonly PIANO: string = "\u{01D18F}";
  static readonly MEZO: string = "\u{01D190}";
  static readonly FORTE: string = "\u{01D191}";
  static readonly MEZO_FORTE: string = "\u{01D190}\u{01D191}";
  static readonly MEZO_PIANO: string = "\u{01D190}\u{01D18F}";
  static readonly S_F_Z: string = "\u{01D18D}\u{01D191}\u{01D18E}";
  static readonly REST: string = "𝄽";
  static readonly Q_REST: string = "𝄾";
  static readonly FULL_NOTE: string = "𝅗";
  static readonly HALF_NOTE: string = "𝅗𝅥";
  static readonly QUATER_NOTE: string = "𝅘𝅥";
  static readonly EIGTH_NOTE: string = "𝅘𝅥𝅮";
  static readonly SIXTH_NOTE: string = "𝅘𝅥𝅯";
  static readonly CIS: string = "CIS";
  static readonly C: string = "C";
  static readonly CES: string = "CES";
  static readonly DIS: string = "DIS";
  static readonly D: string = "D";
  static readonly DES: string = "DES";
  static readonly EIS: string = "EIS";
  static readonly E: string = "E";
  static readonly ES: string = "ES";
  static readonly FIS: string = "FIS";
  static readonly F: string = "F";
  static readonly FES: string = "FES";
  static readonly GIS: string = "GIS";
  static readonly G: string = "G";
  static readonly GES: string = "GES";
  static readonly AIS: string = "AIS";
  static readonly A: string = "A";
  static readonly AS: string = "AS";
  static readonly HIS: string = "HIS";
  static readonly H: string = "H";
  static readonly B: string = "B";
  static readonly ALL_ICONS: Icon[] = [
    { name: "NATURAL", code: MUSIC_ICONS.NATURAL },
    { name: "FLAT", code: MUSIC_ICONS.FLAT },
    { name: "SHARP", code: MUSIC_ICONS.SHARP },
    { name: "REPEAT_START", code: MUSIC_ICONS.REPEAT_START },
    { name: "REPEAT_END", code: MUSIC_ICONS.REPEAT_END },
    { name: "FERMATA", code: MUSIC_ICONS.FERMATA },
    { name: "BREATH_MARK", code: MUSIC_ICONS.BREATH_MARK },
    { name: "ACCENT", code: MUSIC_ICONS.ACCENT },
    { name: "STACCATO", code: MUSIC_ICONS.STACCATO },
    { name: "TENUTO", code: MUSIC_ICONS.TENUTO },
    { name: "PIANO", code: MUSIC_ICONS.PIANO },
    { name: "MEZO", code: MUSIC_ICONS.MEZO },
    { name: "FORTE", code: MUSIC_ICONS.FORTE },
    { name: "MEZO_FORTE", code: MUSIC_ICONS.MEZO_FORTE },
    { name: "MEZO_PIANO", code: MUSIC_ICONS.MEZO_PIANO },
    { name: "S_F_Z", code: MUSIC_ICONS.S_F_Z },
    { name: "REST", code: MUSIC_ICONS.REST },
    { name: "Q_REST", code: MUSIC_ICONS.Q_REST },
    { name: "FULL_NOTE", code: MUSIC_ICONS.FULL_NOTE },
    { name: "HALF_NOTE", code: MUSIC_ICONS.HALF_NOTE },
    { name: "QUATER_NOTE", code: MUSIC_ICONS.QUATER_NOTE },
    { name: "EIGTH_NOTE", code: MUSIC_ICONS.EIGTH_NOTE },
    { name: "SIXTH_NOTE", code: MUSIC_ICONS.SIXTH_NOTE },
  ];
  static readonly NOTES: Icon[] = [
    { name: "CIS", code: MUSIC_ICONS.CIS },
    { name: "C", code: MUSIC_ICONS.C },
    { name: "CES", code: MUSIC_ICONS.CES },
    { name: "DIS", code: MUSIC_ICONS.DIS },
    { name: "D", code: MUSIC_ICONS.D },
    { name: "DES", code: MUSIC_ICONS.DES },
    { name: "EIS", code: MUSIC_ICONS.EIS },
    { name: "E", code: MUSIC_ICONS.E },
    { name: "ES", code: MUSIC_ICONS.ES },
    { name: "FIS", code: MUSIC_ICONS.FIS },
    { name: "F", code: MUSIC_ICONS.F },
    { name: "FES", code: MUSIC_ICONS.FES },
    { name: "GIS", code: MUSIC_ICONS.GIS },
    { name: "G", code: MUSIC_ICONS.G },
    { name: "GES", code: MUSIC_ICONS.GES },
    { name: "AIS", code: MUSIC_ICONS.AIS },
    { name: "A", code: MUSIC_ICONS.A },
    { name: "AS", code: MUSIC_ICONS.AS },
    { name: "HIS", code: MUSIC_ICONS.HIS },
    { name: "H", code: MUSIC_ICONS.H },
    { name: "B", code: MUSIC_ICONS.B },
  ];
}

export class MUSIC_SVG {
  static readonly STAFF: string = "Staff.svg";
  static readonly DOWN_BOW: string = "Down Bow.svg";
  static readonly QUARTER_NOTE: string = "Quarter Note.svg";
  static readonly NATURAL: string = "Natural.svg";
  static readonly TURN: string = "Turn.svg";
  static readonly REPEAT_SIGN: string = "Repeat Sign.svg";
  static readonly EIGHTH_NOTES: string = "Eighth Notes.svg";
  static readonly EIGHTH_NOTE: string = "Eighth Note.svg";
  static readonly FLAT: string = "Flat.svg";
  static readonly MORDENT: string = "Mordent.svg";
  static readonly SEGNO: string = "Segno.svg";
  static readonly WHOLE_REST: string = "Whole Rest.svg";
  static readonly COMMON_TIME: string = "Common Time.svg";
  static readonly FORTE: string = "Forte.svg";
  static readonly TREMOLO: string = "Tremolo.svg";
  static readonly DOUBLE_FLAT: string = "Double Flat.svg";
  static readonly FERMATA: string = "Fermata.svg";
  static readonly DOTTED_HALF_NOTE: string = "Dotted Half Note.svg";
  static readonly SHARP: string = "Sharp.svg";
  static readonly DOUBLE_SHARP: string = "Double Sharp.svg";
  static readonly WHOLE_NOTE: string = "Whole Note.svg";
  static readonly UP_BOW: string = "Up Bow.svg";
  static readonly RELEASE_PEDAL: string = "Release Pedal.svg";
  static readonly MARCATO: string = "Marcato.svg";
  static readonly SIXTEENTH_NOTE: string = "Sixteenth Note.svg";
  static readonly G_CLEF: string = "G Clef.svg";
  static readonly GLISSANDO: string = "Glissando.svg";
  static readonly HALF_REST: string = "Half Rest.svg";
  static readonly MEZZO_FORTE: string = "Mezzo Forte.svg";
  static readonly ENGAGE_PEDAL: string = "Engage Pedal.svg";
  static readonly PIANISSIMO: string = "Pianissimo.svg";
  static readonly QUARTER_REST: string = "Quarter Rest.svg";
  static readonly F_CLEF: string = "F Clef.svg";
  static readonly SIXTEENTH_REST: string = "Sixteenth Rest.svg";
  static readonly MEZZO_PIANO: string = "Mezzo Piano.svg";
  static readonly EIGHTH_REST: string = "Eighth Rest.svg";
  static readonly DIMINUENDO: string = "Diminuendo.svg";
  static readonly DOTTED_QUARTER_NOTE: string = "Dotted Quarter Note.svg";
  static readonly TRIPLETS: string = "Triplets.svg";
  static readonly PIANO: string = "Piano.svg";
  static readonly HALF_NOTE: string = "Half Note.svg";
  static readonly CUT_TIME: string = "Cut Time.svg";
  static readonly CAESURA: string = "Caesura.svg";
  static readonly THIRTY_SECOND_NOTE: string = "Thirty second note.svg";
  static readonly GRAND_STAFF: string = "Grand Staff.svg";
  static readonly FORTISSIMO: string = "Fortissimo.svg";
  static readonly C_CLEF: string = "C Clef.svg";
  static readonly SIXTEENTH_NOTES: string = "Sixteenth Notes.svg";
  static readonly CODA: string = "Coda.svg";
  static readonly CRESCENDO: string = "Crescendo.svg";
  static readonly DE_CRESCENDO: string = "De Crescendo.svg";
  static readonly ALL_SGVS: Svg[] = [
    // { name: "STAFF", file: MUSIC_SVG.STAFF },
    // { name: "DOWN_BOW", file: MUSIC_SVG.DOWN_BOW },
    // { name: "QUARTER_NOTE", file: MUSIC_SVG.QUARTER_NOTE },
    // { name: "NATURAL", file: MUSIC_SVG.NATURAL },
    // { name: "TURN", file: MUSIC_SVG.TURN },
    // { name: "REPEAT_SIGN", file: MUSIC_SVG.REPEAT_SIGN },
    // { name: "EIGHTH_NOTES", file: MUSIC_SVG.EIGHTH_NOTES },
    // { name: "EIGHTH_NOTE", file: MUSIC_SVG.EIGHTH_NOTE },
    // { name: "FLAT", file: MUSIC_SVG.FLAT },
    // { name: "MORDENT", file: MUSIC_SVG.MORDENT },
    // { name: "SEGNO", file: MUSIC_SVG.SEGNO },
    // { name: "WHOLE_REST", file: MUSIC_SVG.WHOLE_REST },
    // { name: "COMMON_TIME", file: MUSIC_SVG.COMMON_TIME },
    // { name: "FORTE", file: MUSIC_SVG.FORTE },
    // { name: "TREMOLO", file: MUSIC_SVG.TREMOLO },
    // { name: "DOUBLE_FLAT", file: MUSIC_SVG.DOUBLE_FLAT },
    // { name: "FERMATA", file: MUSIC_SVG.FERMATA },
    // { name: "DOTTED_HALF_NOTE", file: MUSIC_SVG.DOTTED_HALF_NOTE },
    // { name: "SHARP", file: MUSIC_SVG.SHARP },
    // { name: "DOUBLE_SHARP", file: MUSIC_SVG.DOUBLE_SHARP },
    // { name: "WHOLE_NOTE", file: MUSIC_SVG.WHOLE_NOTE },
    // { name: "UP_BOW", file: MUSIC_SVG.UP_BOW },
    // { name: "RELEASE_PEDAL", file: MUSIC_SVG.RELEASE_PEDAL },
    // { name: "MARCATO", file: MUSIC_SVG.MARCATO },
    // { name: "SIXTEENTH_NOTE", file: MUSIC_SVG.SIXTEENTH_NOTE },
    // { name: "G_CLEF", file: MUSIC_SVG.G_CLEF },
    // { name: "GLISSANDO", file: MUSIC_SVG.GLISSANDO },
    // { name: "HALF_REST", file: MUSIC_SVG.HALF_REST },
    // { name: "CRESCENDO", file: MUSIC_SVG.CRESCENDO },
    // { name: "MEZZO_FORTE", file: MUSIC_SVG.MEZZO_FORTE },
    // { name: "ENGAGE_PEDAL", file: MUSIC_SVG.ENGAGE_PEDAL },
    // { name: "PIANISSIMO", file: MUSIC_SVG.PIANISSIMO },
    // { name: "QUARTER_REST", file: MUSIC_SVG.QUARTER_REST,
    // scaleY: 0.75,
    // scaleX: 0.75,
    // width: 250,
    // height: 70, },
    // { name: "F_CLEF", file: MUSIC_SVG.F_CLEF },
    // { name: "SIXTEENTH_REST", file: MUSIC_SVG.SIXTEENTH_REST },
    // { name: "MEZZO_PIANO", file: MUSIC_SVG.MEZZO_PIANO },
    // { name: "EIGHTH_REST", file: MUSIC_SVG.EIGHTH_REST },
    // { name: "DIMINUENDO", file: MUSIC_SVG.DIMINUENDO },
    // { name: "DOTTED_QUARTER_NOTE", file: MUSIC_SVG.DOTTED_QUARTER_NOTE },
    // { name: "TRIPLETS", file: MUSIC_SVG.TRIPLETS },
    // { name: "PIANO", file: MUSIC_SVG.PIANO },
    // { name: "HALF_NOTE", file: MUSIC_SVG.HALF_NOTE },
    // { name: "CUT_TIME", file: MUSIC_SVG.CUT_TIME },
    // { name: "CAESURA", file: MUSIC_SVG.CAESURA },
    // { name: "THIRTY_SECOND_NOTE", file: MUSIC_SVG.THIRTY_SECOND_NOTE },
    // { name: "GRAND_STAFF", file: MUSIC_SVG.GRAND_STAFF },
    // { name: "FORTISSIMO", file: MUSIC_SVG.FORTISSIMO },
    // { name: "C_CLEF", file: MUSIC_SVG.C_CLEF },
    // { name: "SIXTEENTH_NOTES", file: MUSIC_SVG.SIXTEENTH_NOTES },
    // { name: "CODA", file: MUSIC_SVG.CODA },
    // {
    //   name: "CRESCENDO",
    //   file: MUSIC_SVG.CRESCENDO,
    //   scaleY: 0.75,
    //   scaleX: 0.75,
    //   width: 250,
    //   height: 70,
    // },
    // {
    //   name: "DE_CRESCENDO",
    //   file: MUSIC_SVG.DE_CRESCENDO,
    //   scaleY: 0.75,
    //   scaleX: 0.75,
    //   width: 250,
    //   height: 70,
    // },
  ];
}
