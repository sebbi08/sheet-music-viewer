import { SheetFile } from "@/models/SheetFile";

export interface SetList {
  id: number;
  name: string;
  sheets: SheetFile[];
}
