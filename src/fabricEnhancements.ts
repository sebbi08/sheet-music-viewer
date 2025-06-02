import * as fabric from "fabric";
import {
  type ControlActionHandler,
  FabricObject,
  type Transform,
} from "fabric";
import { ACTION_ICONS } from "./Enums";

export function enhanceFabricPrototype(): void {
  fabric.Group.prototype.lockMovementX = true;
  fabric.Group.prototype.lockMovementY = true;
  fabric.InteractiveFabricObject.ownDefaults = {
    ...fabric.InteractiveFabricObject.ownDefaults,
    transparentCorners: false,
    cornerColor: "blue",
    cornerStyle: "circle",
    lockRotation: true,
    cornerSize: 25,
    padding: 0,
  };

  fabric.Textbox.prototype.lockMovementX = true;
  fabric.Textbox.prototype.lockMovementY = true;

  // enhanceCustomControlsOnPrototype(fabric.FabricObject.prototype);
  // enhanceCustomControlsOnPrototype(fabric.Textbox.prototype);
}

export function setDefaultPropsOnFabricObject(
  object: FabricObject,
  customHandler: ControlActionHandler,
  isGroup = false
): void {
  removeStretchControls(object);

  const deleteImg = document.createElement("img");
  deleteImg.src = ACTION_ICONS.deleteIcon;

  object.controls.deleteControl = new fabric.Control({
    x: 0.5,
    y: -0.5,
    offsetY: -50,
    offsetX: 50,
    cursorStyle: "pointer",
    mouseUpHandler: deleteObject,
    render: renderIcon(deleteImg),
  });

  if (!isGroup) {
    const cloneImg = document.createElement("img");
    cloneImg.src = ACTION_ICONS.cloneIcon;

    object.controls.clone = new fabric.Control({
      x: -0.5,
      y: -0.5,
      offsetY: -50,
      offsetX: -50,
      cursorStyle: "pointer",
      mouseUpHandler: cloneObject,
      render: renderIcon(cloneImg),
    });

    object.controls.customMove = new fabric.Control({
      x: 0,
      y: 0.5,
      offsetY: 40,
      cursorStyle: "pointer",
      render: fabric.controlsUtils.renderCircleControl,
      actionHandler: function (event, transform, x, y): boolean {
        const target = transform.target;
        const lockState = target.lockMovementX;

        target.lockMovementX = false;
        target.lockMovementY = false;
        const res = fabric.controlsUtils.dragHandler(event, transform, x, y);

        target.lockMovementX = lockState;
        target.lockMovementY = lockState;
        return res;
      },

      actionName: "drag",
    });
  }

  object.controls.tl.offsetX = -24;
  object.controls.tl.offsetY = -24;
  object.controls.tr.offsetX = 24;
  object.controls.tr.offsetY = -24;
  object.controls.bl.offsetX = -24;
  object.controls.bl.offsetY = 24;
  object.controls.br.offsetX = 24;
  object.controls.br.offsetY = 24;

  if (object.get("__isText")) {
    const editImg = document.createElement("img");
    editImg.src = ACTION_ICONS.editIcon;
    object.controls.editControl = new fabric.Control({
      x: 0,
      y: -0.5,
      offsetY: -50,
      offsetX: 0,
      cursorStyle: "pointer",
      mouseUpHandler: customHandler,
      render: renderIcon(editImg),
    });
  }
}

export function removeStretchControls(object: FabricObject) {
  object.controls = Object.assign({}, object.controls, {
    mr: new fabric.Control({ visible: false }),
    mt: new fabric.Control({ visible: false }),
    ml: new fabric.Control({ visible: false }),
    mb: new fabric.Control({ visible: false }),
    tlr: new fabric.Control({ visible: false }),
    mtr: new fabric.Control({ visible: false }),
  });
}

function renderIcon(icon: HTMLImageElement) {
  return function renderIcon(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    styleOverride: unknown,
    fabricObject: fabric.InteractiveFabricObject
  ) {
    const size = 24;
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0));
    ctx.drawImage(icon, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
}

function deleteObject(
  eventData: fabric.TPointerEvent,
  transform: Transform
): boolean {
  const target = transform.target;
  const canvas = target.canvas;

  let toDelete;
  if (target.type === "activeselection") {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-expect-error
    toDelete = target.getObjects();
  } else {
    toDelete = [target];
  }

  canvas?.remove(...toDelete);

  canvas?.discardActiveObject();
  canvas?.renderAll();
  return true;
}

async function cloneObject(
  eventData: fabric.TPointerEvent,
  transform: Transform
): Promise<boolean> {
  try {
    const target = transform.target;
    const canvas = target.canvas;
    const clone = await target.clone(["__isText"]);
    if (clone.left && clone.top) {
      clone.left += 10;
      clone.top += 10;
    }
    canvas?.add(clone);
    clone.canvas?.setActiveObject(clone);
  } catch (e) {
    console.log(e)
    return false;
  }

  return true;
}
