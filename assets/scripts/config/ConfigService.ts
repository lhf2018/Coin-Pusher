import { AppConfig, DEFAULT_APP_CONFIG } from "./AppConfig";

export class ConfigService {
  private readonly config: AppConfig;

  public constructor(config: AppConfig = DEFAULT_APP_CONFIG) {
    this.config = config;
  }

  public getConfig(): AppConfig {
    return this.config;
  }
}
