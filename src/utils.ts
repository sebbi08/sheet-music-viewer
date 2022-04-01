import { fabric } from "fabric";
import { Transform } from "fabric/fabric-impl";
import { ACTION_ICONS } from "@/Enums";

export function enhanceFabricPrototype(): void {
  fabric.Object.prototype.transparentCorners = false;
  fabric.Object.prototype.cornerColor = "blue";
  fabric.Object.prototype.cornerStyle = "circle";
  fabric.Object.prototype.lockRotation = true;
  fabric.Object.prototype.cornerSize = 30;
  fabric.Object.prototype.padding = 0;

  fabric.Object.NUM_FRACTION_DIGITS = 99;

  enhanceCustomControlsOnPrototype(fabric.Object.prototype);
  enhanceCustomControlsOnPrototype(fabric.Textbox.prototype);
}

function enhanceCustomControlsOnPrototype(proto: any) {
  proto.controls.tlr = new fabric.Control({ visible: false });
  proto.controls.mtr = new fabric.Control({ visible: false });

  const deleteImg = document.createElement("img");
  deleteImg.src = ACTION_ICONS.deleteIcon;

  const cloneImg = document.createElement("img");
  cloneImg.src = ACTION_ICONS.cloneIcon;

  proto.controls.deleteControl = new fabric.Control({
    x: 0.5,
    y: -0.5,
    offsetY: -50,
    offsetX: 50,
    cursorStyle: "pointer",
    mouseUpHandler: deleteObject,
    render: renderIcon(deleteImg),
  });

  proto.controls.clone = new fabric.Control({
    x: -0.5,
    y: -0.5,
    offsetY: -50,
    offsetX: -50,
    cursorStyle: "pointer",
    mouseUpHandler: cloneObject,
    render: renderIcon(cloneImg),
  });

  proto.controls.customMove = new fabric.Control({
    x: 0,
    y: 0.5,
    offsetY: 40,
    cursorStyle: "pointer",
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    render: fabric.controlsUtils.renderCircleControl,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    actionHandler: fabric.controlsUtils.dragHandler,
    actionName: "drag",
  });

  proto.controls.tl.offsetX = -24;
  proto.controls.tl.offsetY = -24;
  proto.controls.tr.offsetX = 24;
  proto.controls.tr.offsetY = -24;
  proto.controls.bl.offsetX = -24;
  proto.controls.bl.offsetY = 24;
  proto.controls.br.offsetX = 24;
  proto.controls.br.offsetY = 24;
  proto.controls.mr = new fabric.Control({ visible: false });
  proto.controls.mt = new fabric.Control({ visible: false });
  proto.controls.ml = new fabric.Control({ visible: false });
  proto.controls.mb = new fabric.Control({ visible: false });
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
  const target = transform.target as any;
  const canvas = target.canvas;

  let toDelete;
  if (target.type === "activeSelection") {
    toDelete = target.getObjects();
  } else {
    toDelete = [target];
  }

  canvas?.remove(...toDelete);
  canvas?.requestRenderAll();
  canvas.selection = false;
  setTimeout(() => {
    canvas.selection = true;
  });
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
