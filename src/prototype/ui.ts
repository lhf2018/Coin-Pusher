export interface UIRefs {
  viewport: HTMLDivElement;
  coinCard: HTMLDivElement;
  diamondCard: HTMLDivElement;
  fragmentCard: HTMLDivElement;
  coins: HTMLSpanElement;
  diamonds: HTMLSpanElement;
  fragments: HTMLSpanElement;
  drops: HTMLSpanElement;
  activeBodies: HTMLSpanElement;
  fps: HTMLSpanElement;
  bonusLabel: HTMLSpanElement;
  bonusBarFill: HTMLDivElement;
  feverPill: HTMLDivElement;
  messageFeed: HTMLUListElement;
  taskList: HTMLDivElement;
  debugPanel: HTMLDivElement;
  debugPresetBar: HTMLDivElement;
  debugToggleButton: HTMLButtonElement;
  overlay: HTMLDivElement;
  economyHint: HTMLDivElement;
  dropButton: HTMLButtonElement;
  autoDropButton: HTMLButtonElement;
  coinUpgradeButton: HTMLButtonElement;
  speedUpgradeButton: HTMLButtonElement;
  autoUpgradeButton: HTMLButtonElement;
}

function createMetric(title: string, className: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = `metric ${className}`;

  const label = document.createElement("div");
  label.className = "metric-label";
  label.textContent = title;

  const value = document.createElement("div");
  value.className = "metric-value";
  value.dataset.metricValue = className;
  value.textContent = "0";

  wrapper.append(label, value);
  return wrapper;
}

function createPanelButton(text: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

export function createUI(root: HTMLElement): UIRefs {
  root.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "shell";

  const overlay = document.createElement("div");
  overlay.className = "overlay";

  const viewport = document.createElement("div");
  viewport.className = "viewport";

  const topBar = document.createElement("div");
  topBar.className = "top-bar";

  const resources = document.createElement("div");
  resources.className = "resource-strip";

  const coins = document.createElement("span");
  coins.className = "resource-value";
  coins.textContent = "0";

  const diamonds = document.createElement("span");
  diamonds.className = "resource-value";
  diamonds.textContent = "0";

  const fragments = document.createElement("span");
  fragments.className = "resource-value";
  fragments.textContent = "0";

  resources.innerHTML = `
    <div class="resource"><span class="resource-label">金币</span></div>
    <div class="resource"><span class="resource-label">钻石</span></div>
    <div class="resource"><span class="resource-label">碎片</span></div>
  `;
  const resourceRows = [...resources.querySelectorAll<HTMLDivElement>(".resource")];
  resourceRows[0].dataset.resource = "coins";
  resourceRows[1].dataset.resource = "diamonds";
  resourceRows[2].dataset.resource = "fragments";
  resourceRows[0].append(coins);
  resourceRows[1].append(diamonds);
  resourceRows[2].append(fragments);

  const statsStrip = document.createElement("div");
  statsStrip.className = "stats-strip";
  const dropMetric = createMetric("投币数", "drops");
  const bodyMetric = createMetric("活跃物体", "bodies");
  const fpsMetric = createMetric("FPS", "fps");
  statsStrip.append(dropMetric, bodyMetric, fpsMetric);

  const bonusCard = document.createElement("div");
  bonusCard.className = "bonus-card";
  bonusCard.innerHTML = `
    <div class="bonus-head">
      <span>Bonus 能量</span>
      <span class="bonus-label">待机</span>
    </div>
    <div class="bonus-bar">
      <div class="bonus-fill"></div>
    </div>
  `;

  const feverPill = document.createElement("div");
  feverPill.className = "fever-pill hidden";
  feverPill.textContent = "FEVER x2";

  const sidebar = document.createElement("div");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <section class="panel">
      <div class="panel-title">主控</div>
      <div class="button-stack button-stack-main"></div>
    </section>
    <section class="panel">
      <div class="panel-title">升级</div>
      <div class="button-stack button-stack-upgrades"></div>
      <div class="economy-hint"></div>
    </section>
    <section class="panel">
      <div class="panel-title">会话任务</div>
      <div class="task-list"></div>
    </section>
    <section class="panel">
      <div class="panel-title">现场消息</div>
      <ul class="message-feed"></ul>
    </section>
  `;

  const debugPresetBar = document.createElement("div");
  debugPresetBar.className = "debug-preset-bar";

  const debugToggleButton = document.createElement("button");
  debugToggleButton.type = "button";
  debugToggleButton.className = "ghost-button debug-toggle-button";
  debugToggleButton.textContent = "开发调试";

  const debugPanel = document.createElement("div");
  debugPanel.className = "debug-panel";

  topBar.append(resources, statsStrip, bonusCard);

  const mainButtons = sidebar.querySelector<HTMLDivElement>(".button-stack-main");
  const upgradeButtons = sidebar.querySelector<HTMLDivElement>(".button-stack-upgrades");
  const taskList = sidebar.querySelector<HTMLDivElement>(".task-list");
  const messageFeed = sidebar.querySelector<HTMLUListElement>(".message-feed");
  const economyHint = sidebar.querySelector<HTMLDivElement>(".economy-hint");

  if (!mainButtons || !upgradeButtons || !taskList || !messageFeed || !economyHint) {
    throw new Error("Failed to create control panels.");
  }

  const dropButton = createPanelButton("投币", "action-button action-button-primary");
  const autoDropButton = createPanelButton("自动投币：关", "action-button");
  const coinUpgradeButton = createPanelButton("升级金币收益", "action-button");
  const speedUpgradeButton = createPanelButton("升级推盘速度", "action-button");
  const autoUpgradeButton = createPanelButton("升级自动投币", "action-button");

  mainButtons.append(dropButton, autoDropButton);
  upgradeButtons.append(coinUpgradeButton, speedUpgradeButton, autoUpgradeButton);

  overlay.append(topBar, feverPill, debugPresetBar, debugToggleButton);
  shell.append(viewport, overlay, sidebar, debugPanel);
  root.append(shell);

  return {
    viewport,
    coinCard: resourceRows[0] as HTMLDivElement,
    diamondCard: resourceRows[1] as HTMLDivElement,
    fragmentCard: resourceRows[2] as HTMLDivElement,
    coins,
    diamonds,
    fragments,
    drops: dropMetric.querySelector<HTMLDivElement>("[data-metric-value='drops']")!,
    activeBodies: bodyMetric.querySelector<HTMLDivElement>("[data-metric-value='bodies']")!,
    fps: fpsMetric.querySelector<HTMLDivElement>("[data-metric-value='fps']")!,
    bonusLabel: bonusCard.querySelector<HTMLSpanElement>(".bonus-label")!,
    bonusBarFill: bonusCard.querySelector<HTMLDivElement>(".bonus-fill")!,
    feverPill,
    messageFeed,
    taskList,
    debugPanel,
    debugPresetBar,
    debugToggleButton,
    overlay,
    economyHint,
    dropButton,
    autoDropButton,
    coinUpgradeButton,
    speedUpgradeButton,
    autoUpgradeButton,
  };
}
