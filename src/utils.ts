import { fabric } from "fabric";
import { Transform } from "fabric/fabric-impl";
import { ICONS } from "@/Enums";

export function enhanceFabricPrototype(): void {
  fabric.Object.prototype.transparentCorners = false;
  fabric.Object.prototype.cornerColor = "blue";
  fabric.Object.prototype.cornerStyle = "circle";
  fabric.Object.prototype.lockRotation = true;
  fabric.Object.prototype.lockRotation = true;
  fabric.Object.prototype.padding = 20;
  fabric.Object.NUM_FRACTION_DIGITS = 99;

  const deleteImg = document.createElement("img");
  deleteImg.src = ICONS.deleteIcon;

  const cloneImg = document.createElement("img");
  cloneImg.src = ICONS.cloneIcon;

  fabric.Object.prototype.controls.deleteControl = new fabric.Control({
    x: 0.5,
    y: -0.5,
    offsetY: -16,
    offsetX: 16,
    cursorStyle: "pointer",
    mouseUpHandler: deleteObject,
    render: renderIcon(deleteImg),
    // cornerSize: 24,
  });

  fabric.Object.prototype.controls.clone = new fabric.Control({
    x: -0.5,
    y: -0.5,
    offsetY: -16,
    offsetX: -16,
    cursorStyle: "pointer",
    mouseUpHandler: cloneObject,
    render: renderIcon(cloneImg),
    // cornerSize: 24,
  });
}

function renderIcon(icon: HTMLImageElement) {
  return function renderIcon(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    styleOverride: any,
    fabricObject: fabric.Object
  ) {
    const size = 24;
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0));
    ctx.drawImage(icon, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
}

function deleteObject(eventData: MouseEvent, transform: Transform): boolean {
  const target = transform.target;
  const canvas = target.canvas;
  canvas?.remove(target);
  canvas?.requestRenderAll();
  return true;
}

function cloneObject(eventData: MouseEvent, transform: Transform): boolean {
  const target = transform.target;
  const canvas = target.canvas;
  target.clone(function (cloned: fabric.Object) {
    if (cloned.left && cloned.top) {
      cloned.left += 10;
      cloned.top += 10;
    }
    canvas?.add(cloned);
    cloned.canvas?.setActiveObject(cloned);
  });
  return true;
}
