# 本地原型开发说明

当前真正可运行的原型是 `src/` 下的 Vite + Three.js + Rapier 页面，不是 Cocos 工程。

`assets/scripts/` 仍是一套未接入场景的框架草图，说明见 [coin-pusher-local-framework-doc.md](coin-pusher-local-framework-doc.md)。

## 1. 怎么跑

```bash
pnpm install
pnpm dev
```

浏览器打开 `http://127.0.0.1:4173/`。

- 默认物理：Rapier
- 可选实验：`http://127.0.0.1:4173/?physics=taichi`

操作、调试快捷键和预设见 [README.md](README.md)。视觉和模式规划见 [planning-wiki.md](planning-wiki.md)。

## 2. 机台布局

`CoinPusherApp.createTable()` 里的结构可以按这块理解：

- **单层台面**：推盘和硬币都在同一块平整地板上，没有上下双层。
- **后墙开口**：推盘从后方孔径进出，前后往复。
- **侧墙**：覆盖从台面后沿到侧出口线；出口线之后不再封死。
- **左右圆弧滑道**：从台面边缘水平相切，再弯成 90° 四分之一圆向外下落。不要改成斜放方块，否则接缝会重新出现。
- **前方三坑**：台面前沿三个开口洞，中间两块隔板把区域分成「宝箱区 / Bonus / 高价值」。
  - 坑口没有白边框，也没有坑底碰撞体
  - 文案喷涂在坑洞内壁上，不是悬空广告牌
  - 物体掉进洞后继续往下掉，计分后等落到足够低再销毁

相关代码入口：

- 台面 / 侧墙 / 圆弧滑道 / 前方坑洞：`src/prototype/CoinPusherApp.ts`
- 物理刚体：`src/prototype/physics/RapierWorld.ts`
- 数值和预设：`src/prototype/config.ts`

## 3. 结算判定

前方回收在物体越过台面前沿并明显低于台面后触发，按 `x` 坐标分到三个槽。侧沿滑出也会结算。

掉进前方坑洞的物体会先记分，网格继续下落；不要在记分时立刻从场景里拿掉，否则看起来会停在洞口或直接消失。

## 4. 改机台时注意

- 圆弧滑道和地板要用同一套台面材质，并从地板表面相切出去，避免接缝或凸起。
- 前方坑洞不要加回坑底、前挡或顶部白边。
- 三个槽名如果要显示，继续印在坑洞内壁，不要改回 Billboard / Sprite。

## 5. 和 `assets/scripts/` 的关系

那套脚本面向以后的 Cocos 场景挂载，当前：

- 不会被 `pnpm dev` 加载
- 调试键位、状态结构和 Vite 原型不完全一致
- 不要把它当成当前可玩版本的实现说明
