export interface ITelegramPoller {
  start(): Promise<void>;
  stop(): Promise<void>;
}
