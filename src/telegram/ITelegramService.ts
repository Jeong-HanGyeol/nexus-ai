export interface ITelegramService {
  sendMessage(text: string): Promise<void>;
}
