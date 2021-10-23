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
