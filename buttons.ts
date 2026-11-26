/** RetroPad input indices used by EmulatorJS, mapped to PlayStation buttons */
export const BTN = {
  CROSS: 0, // ✕
  SQUARE: 1, // □
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  CIRCLE: 8, // ○
  TRIANGLE: 9, // △
  L1: 10,
  R1: 11,
  L2: 12,
  R2: 13,
  QUICK_SAVE: 24,
  QUICK_LOAD: 25,
} as const;

export type FaceId = "triangle" | "square" | "cross" | "circle";

/** The four action buttons, in the order they sit on a PlayStation controller */
export const FACE_BUTTONS: { index: number; id: FaceId; label: string }[] = [
  { index: BTN.TRIANGLE, id: "triangle", label: "三角" },
  { index: BTN.SQUARE, id: "square", label: "方塊" },
  { index: BTN.CROSS, id: "cross", label: "叉叉" },
  { index: BTN.CIRCLE, id: "circle", label: "圓圈" },
];
