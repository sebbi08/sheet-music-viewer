import { type SheetFile } from "./SheetFile";

export interface SetList {
  id: number;
  name: string;
  sheets: SheetFile[];
}
