# 本地原型开发说明

## 1. 当前代码状态

当前仓库已落地第一批本地原型代码，重点包括：

- 运行时内存状态层
- 升级与奖励的基础逻辑
- 调试覆盖层与调试预设
- 最小 `GameDirector`
- 本地键盘调试入口

## 2. 在 Cocos Creator 中的最小挂载方式

1. 新建或打开一个场景
2. 在场景根节点挂载 `AppLauncher`
3. 如果有推杆节点，可额外挂载 `PusherController`

`AppLauncher` 会自动补上：

- `GameDirector`
- `DebugPanel`
- `CoinDropController`

## 3. 当前原型键位

- `Space`：投一枚币
- `F1`：打开或关闭调试面板状态
- `1`：应用 `default` 预设
- `2`：应用 `fast_loop` 预设
- `3`：应用 `rich_mode` 预设
- `4`：应用 `bonus_test` 预设
- `5`：应用 `stress_physics` 预设
- `G`：增加 100 金币
- `H`：增加 1000 金币
- `J`：降低推杆速度倍率
- `K`：提高推杆速度倍率
- `U`：降低金币量级倍率
- `I`：提高金币量级倍率
- `B`：强制触发一次 Bonus
- `R`：重置当前会话

## 4. 当前原型说明

- `CoinDropController` 现在是原型模式：按下 `Space` 后会走一次投币扣费，并在短延迟后模拟一次奖励结算
- `PusherController` 当前是简化往复运动，用于先验证节奏和调试倍率
- `DebugPanel` 当前以键盘入口和控制台输出为主，还没有正式 UI 面板

## 5. 下一步建议

优先继续做这 3 块：

1. 真实掉落物生成与对象池
2. 掉落区域判定与结算队列
3. 调试面板可视化 UI
