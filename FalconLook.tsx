import falconLook from "../assets/falcon-look.png";

/**
 * 獵鷹外觀：X5 獵鷹裝甲的精靈圖節選。
 * 來源是 x5sheet1falcon.gif 第 14 排的 12 個連續影格，已切成底部對齊的透明精靈圖（falcon-look.png）。
 * X4 光碟沒有這組圖像，所以只在 X5 的獵鷹卡片中顯示。
 */
const FRAMES = 12;
const CELL_W = 46;
const CELL_H = 58;
const SCALE = 2;

export default function FalconLook() {
  return (
    <figure className="falcon-look">
      <div className="falcon-grid" role="img" aria-label="獵鷹裝甲外觀，共 12 個姿勢">
        {Array.from({ length: FRAMES }, (_, i) => (
          <span
            key={i}
            className="falcon-cell"
            style={{
              width: CELL_W * SCALE,
              height: CELL_H * SCALE,
              backgroundImage: `url(${falconLook})`,
              backgroundSize: `${CELL_W * FRAMES * SCALE}px ${CELL_H * SCALE}px`,
              backgroundPosition: `${-i * CELL_W * SCALE}px 0`,
            }}
          />
        ))}
      </div>
      <figcaption className="falcon-caption">
        <strong>獵鷹外觀</strong>（X5 原版精靈圖，節選 12 個姿勢）。X4 光碟沒有這組圖像，
        無法在 X4 上顯示；X4 的外型仍只能在第四／究極之間選擇。
      </figcaption>
    </figure>
  );
}
