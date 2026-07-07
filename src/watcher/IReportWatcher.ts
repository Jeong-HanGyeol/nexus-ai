export interface IReportWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
}
