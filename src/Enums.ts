import { Color } from "@/models/EditState";

export enum EventNames {
  "SELECT_FOLDER" = "SELECT_FOLDER",
  "FOLDER_SELECTED" = "FOLDER_SELECTED",
  "LOAD_FOLDER" = "LOAD_FOLDER",
  "FOLDER_LOADED" = "FOLDER_LOADED",
  "GET_VERSION" = "GET_VERSION",
  "SEND_VERSION" = "SEND_VERSION",
  "SEARCH_FILES" = "SEARCH_FILES",
  "SEARCH_RESULTS" = "SEARCH_RESULTS",
  "START_LOAD_OVERLAY_DATA" = "START_LOAD_OVERLAY_DATA",
  "LOAD_OVERLAY_DATA" = "LOAD_OVERLAY_DATA",
  "SAVE_OVERLAY_DATA" = "SAVE_OVERLAY_DATA",
}

export enum RouteNames {
  "Root" = "Root",
  "SheetSelection" = "SheetSelection",
  "FolderSetup" = "FolderSetup",
  "SheetViewer" = "SheetViewer",
}

export class BRUSH_COLORS {
  static readonly RED = new BRUSH_COLORS({ r: 255, g: 0, b: 0 });
  static readonly GREEN = new BRUSH_COLORS({ r: 0, g: 255, b: 0 });
  static readonly BLUE = new BRUSH_COLORS({ r: 0, g: 0, b: 255 });
  static readonly BLACK = new BRUSH_COLORS({ r: 0, g: 0, b: 0 });

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
}

export interface Icon {
  name: string;
  code: string;
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
  static readonly S: string = "\u{01D18D}";
  static readonly Z: string = "\u{01D18E}";
  static readonly PIANO: string = "\u{01D18F}";
  static readonly MEZO: string = "\u{01D190}";
  static readonly FORTE: string = "\u{01D191}";
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
    { name: "S", code: MUSIC_ICONS.S },
    { name: "Z", code: MUSIC_ICONS.Z },
    { name: "PIANO", code: MUSIC_ICONS.PIANO },
    { name: "MEZO", code: MUSIC_ICONS.MEZO },
    { name: "FORTE", code: MUSIC_ICONS.FORTE },
  ];
}
