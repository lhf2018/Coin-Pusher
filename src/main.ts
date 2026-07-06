import "./styles.css";
import { CoinPusherApp } from "./prototype/CoinPusherApp";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root element.");
}

const app = new CoinPusherApp(root);
app.start();
