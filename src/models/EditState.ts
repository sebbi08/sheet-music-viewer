export interface EditState {
  drawingMode?: boolean;
  interactiveMode?: boolean;
  pencilMode?: boolean;
  color?: Color;
  thickness?: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
}
