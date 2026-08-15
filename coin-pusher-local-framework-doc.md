# 推币机项目本地代码框架说明

## 1. 文档目的

这份文档说明当前项目在本地预留的游戏代码框架，重点回答下面几个问题：

- 框架分了哪些层
- 每一层负责什么
- 运行时数据怎么流转
- 调试能力从哪里进
- 后续接真实场景、真实物理、真实 UI 时应该往哪里补

这份说明对应当前仓库中的 `assets/scripts/` 目录，定位是“本地框架骨架”，不是完整的正式游戏实现。

## 2. 目录结构

当前本地框架按职责拆成了 6 层：

```text
assets/scripts/
├─ config/       配置层
├─ core/         启动层 / 导演层 / 事件层
├─ data/         运行时状态定义与状态仓库
├─ gameplay/     场景驱动组件
├─ systems/      业务系统
└─ debug/        调试体系
```

各目录职责如下：

### `config/`

负责静态配置，不放运行时状态。

- `AppConfig.ts`
  定义整套原型配置，包括：
  - 调试开关
  - 推盘节奏
  - 掉币节奏
  - 经济数值
  - Bonus 数值
- `ConfigService.ts`
  对外提供配置读取入口，后续如果要接远端配置、本地表、AB 参数，都从这里扩展。

### `core/`

负责“把系统串起来”。

- `AppLauncher.ts`
  场景入口组件，负责挂载基础组件。
- `GameDirector.ts`
  全局导演，负责：
  - 初始化配置服务
  - 初始化状态仓库
  - 初始化调试覆盖
  - 初始化升级系统
  - 初始化会话进度系统
  - 对外暴露统一接口
  - 广播运行时事件
- `EventBus.ts`
  统一事件总线。
- `GameEvents.ts`
  统一事件名与事件载荷定义。

### `data/`

负责运行时数据结构与读写入口。

- `RuntimeState.ts`
  定义玩家运行态结构，例如：
  - 钱包
  - 升级
  - Bonus
  - 引导
  - 运行时标记
- `RuntimeStateStore.ts`
  提供：
  - `getState`
  - `update`
  - `reset`
  - `subscribe`
- `SessionStateFactory.ts`
  创建新会话初始状态。
- `StateSelectors.ts`
  提供只读计算函数，例如：
  - 是否能投币
  - 升级价格
  - 奖励预览
  - 推盘速度等级倍率
  - 自动投币节奏倍率

### `gameplay/`

负责挂在场景节点上的“表现驱动组件”。

- `gameplay/drop/CoinDropController.ts`
  负责：
  - 手动投币
  - 自动投币循环
  - 延迟结算模拟
  - 监听掉币请求事件
- `gameplay/machine/PusherController.ts`
  负责：
  - 推盘前推
  - 前端停顿
  - 回收抬升
  - 往复循环

### `systems/`

负责纯业务逻辑，不直接操作场景节点。

- `systems/session/SessionProgressService.ts`
  负责：
  - 加币
  - 扣币
  - 加钻石
  - Bonus 充能
  - 会话重置
  - 运行时开关修改
- `systems/upgrade/UpgradeSystem.ts`
  负责：
  - 金币价值升级
  - 推盘升级
  - 自动投币升级
  - 升级价格与等级效果读取

### `debug/`

负责开发调试能力。

- `DebugPresets.ts`
  定义调试预设。
- `DebugOverrideStore.ts`
  保存运行时调试覆盖值。
- `DebugCommands.ts`
  提供调试动作入口，例如：
  - 加金币
  - 套用预设
  - 强制 Bonus
  - 重置会话
- `DebugPanel.ts`
  当前是本地键盘调试入口。
- `DebugMetrics.ts`
  记录原型调试指标。

## 3. 运行流程

当前框架的主流程如下：

```text
AppLauncher
  -> GameDirector 启动
    -> ConfigService 初始化
    -> RuntimeStateStore 初始化
    -> DebugOverrideStore 初始化
    -> SessionProgressService 初始化
    -> UpgradeSystem 初始化
    -> DebugCommands 初始化
    -> EventBus 绑定事件

玩家输入 / 调试输入
  -> GameDirector 对外接口
    -> Session / Upgrade / Debug 系统处理
      -> RuntimeStateStore 更新
        -> 事件广播
          -> Gameplay 组件响应
```

## 4. 当前核心职责拆分

### 4.1 `GameDirector`

它是这套框架的统一门面，当前主要提供下面几类能力：

- 掉币请求：`requestCoinDrop`
- 奖励结算：`resolvePrototypeReward`
- Bonus 触发：`triggerBonus`
- 自动投币控制：`toggleAutoDrop` / `setAutoDropEnabled`
- 升级购买：`purchaseUpgrade`
- 推盘速度 / 掉币节奏读取：`getResolvedPusherSpeed` 等
- 会话重置：`resetSession`
- 调试摘要：`getDebugSummary`

简单理解：

- `GameDirector` 不应该自己写满细节
- 它负责调度
- 真正的数据修改交给 `SessionProgressService`
- 真正的升级逻辑交给 `UpgradeSystem`
- 真正的调试覆盖交给 `DebugOverrideStore`

### 4.2 `RuntimeStateStore`

这是本地运行时唯一状态源，当前定位类似一个轻量级状态容器。

它的约束是：

- 运行时状态统一从这里取
- 修改状态统一从这里进
- 其他模块尽量不要私自缓存可变数据副本

这样后面不管接：

- UI 层
- 物理层
- 存档层
- 网络同步层

都比较好扩展。

### 4.3 `CoinDropController`

当前它不是物理掉币器，而是“掉币节奏控制器”。

它负责的事：

- 监听空格投币
- 监听自动投币开关
- 按节奏循环调用 `GameDirector.requestCoinDrop()`
- 在原型模式下延迟调用 `resolvePrototypeReward()`

后续如果接真实物理掉币，这个类建议继续保留，但职责改成：

- 发起掉币请求
- 生成掉落物
- 跟踪掉落物生命周期
- 真正掉入结算槽时再调用奖励结算

### 4.4 `PusherController`

当前它是“推盘周期驱动器”，不是物理接触器。

它负责：

- 读取配置
- 读取调试速度倍率
- 读取推盘升级等级倍率
- 按前推 / 停顿 / 回收三段来移动节点

后续接真实 3D 推盘时，建议保留这个组件，但把“位置驱动”换成：

- 动画轨道驱动
- 刚体/关节驱动
- 或时间轴驱动

## 5. 事件流设计

当前事件已经在 `GameEvents.ts` 中集中定义，避免散落字符串。

核心事件包括：

- `COIN_DROP_REQUESTED`
- `REWARD_RESOLVED`
- `BONUS_TRIGGERED`
- `AUTO_DROP_TOGGLED`
- `UPGRADE_PURCHASED`
- `STATE_CHANGED`
- `DEBUG_OVERRIDE_CHANGED`
- `SESSION_RESET`

这样做的好处是：

- 业务层和表现层解耦
- 后续接 UI 时可以直接订阅状态变化
- 后续接埋点时可以直接订阅关键事件
- 后续接测试工具时可以注入模拟事件

## 6. 调试体系设计

当前调试体系分成 3 层：

### 第一层：调试预设

来自 `DebugPresets.ts`，用于快速切换整套倍率。

例如：

- 默认值
- 高速循环
- 富资源
- Bonus 测试
- 压力测试

### 第二层：调试覆盖值

来自 `DebugOverrideStore.ts`，允许直接改：

- 时间倍率
- 推盘速度倍率
- 掉币节奏倍率
- 自动投币倍率
- 金币价值倍率
- 总奖励倍率
- Bonus 充能倍率
- 初始金币数量

### 第三层：调试命令

来自 `DebugCommands.ts` 和 `DebugPanel.ts`。

当前本地快捷键如下：

- `Space`
  手动投币
- `M`
  切换自动投币
- `F1`
  切换调试面板显示标记
- `1` 到 `5`
  切换调试预设
- `G`
  加 100 金币
- `H`
  加 1000 金币
- `J` / `K`
  调整推盘速度倍率
- `U` / `I`
  调整金币价值倍率
- `C`
  购买金币价值升级
- `P`
  购买推盘升级
- `O`
  购买自动投币升级
- `B`
  强制触发 Bonus
- `L`
  重置调试覆盖
- `R`
  重置会话

## 7. 当前已经具备的本地能力

这套框架现在已经能承载下面这些原型级需求：

- 本地会话启动
- 本地无持久化状态
- 手动投币
- 自动投币
- 推盘运动节奏
- 奖励结算
- Bonus 充能与触发
- 调试预设切换
- 调试倍率覆盖
- 基础升级链路

## 8. 当前还没有做的部分

下面这些还属于“留口子，没接正式内容”：

- 真实硬币刚体生成
- 宝箱、稀有物的场景实体
- 推盘与硬币的真实物理接触
- 真实 UI 组件绑定
- 奖励动画与表现
- 本地存档
- 远端配置
- 商业化、广告、活动系统

这也是当前设计里有意控制的范围，因为项目目标是：

- 先把本地原型跑顺
- 先把调试链路打通
- 先把数据结构和导演层稳住

## 9. 后续建议的接入顺序

建议按下面顺序继续落地：

### 第一阶段：接场景

- 给 `AppLauncher` 挂到场景根节点
- 给推盘节点挂 `PusherController`
- 给投币入口节点挂 `CoinDropController`

### 第二阶段：接真实表现

- 给 `CoinDropController` 接掉落物生成
- 给奖励区接真实结算判定
- 给 Bonus 接表现控制器

### 第三阶段：接 UI

- 做一个 `HudPresenter`
- 订阅 `STATE_CHANGED`
- 把金币、Bonus、升级价格、自动投币状态渲染出来

### 第四阶段：接存档

- 给 `RuntimeStateStore` 增加导出快照
- 增加本地恢复逻辑

## 10. 一句话总结

当前本地框架的定位不是“完整游戏代码”，而是：

**先把推币机项目的配置层、状态层、导演层、业务层、场景驱动层、调试层分清楚，并保证后面可以继续往真实项目平滑扩。**

