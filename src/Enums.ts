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
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' style='width:24px;height:24px' viewBox='0 0 24 24'%3E%3Cpath fill='currentColor' d='M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z' /%3E%3C/svg%3E";
  static readonly cloneIcon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' style='width:24px;height:24px' viewBox='0 0 24 24'%3E%3Cpath fill='currentColor' d='M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z' /%3E%3C/svg%3E";
}

export class MUSIC_ICONS {
  static readonly ACCENT = "./musicIcons/Accent.svg";
  static readonly AUFLOESEZEICHEN = "./musicIcons/Auflösezeichen.svg";
  static readonly B = "./musicIcons/B.svg";
  static readonly FERMATA = "./musicIcons/Fermata.svg";
  static readonly KREUZ = "./musicIcons/Kreuz.svg";
  static readonly NUANCEF = "./musicIcons/Nuancef.svg";
  static readonly NUANCEMF = "./musicIcons/Nuancemf.svg";
  static readonly NUANCEMP = "./musicIcons/Nuancemp.svg";
  static readonly NUANCEP = "./musicIcons/Nuancep.svg";
  static readonly ALL_ICONS = [
    MUSIC_ICONS.ACCENT,
    MUSIC_ICONS.AUFLOESEZEICHEN,
    MUSIC_ICONS.B,
    MUSIC_ICONS.FERMATA,
    MUSIC_ICONS.KREUZ,
    MUSIC_ICONS.NUANCEF,
    MUSIC_ICONS.NUANCEMF,
    MUSIC_ICONS.NUANCEMP,
    MUSIC_ICONS.NUANCEP,
  ];
}
