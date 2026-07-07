import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { ClaudeProvider } from "./providers/ClaudeProvider.js";

/**
 * Manual verification script (npm run ai:test-claude): spawns the real
 * `claude` CLI headlessly, then resumes the same session to confirm
 * --resume actually carries context forward.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const provider = new ClaudeProvider();

  const first = await provider.complete(
    "이 프로젝트의 package.json에서 name 필드 값이 뭐야? 값만 대답해.",
    { cwd: process.cwd() },
  );
  logger.info("First call result", { ...first });

  if (!first.sessionId) {
    throw new Error("Expected a sessionId from the first call");
  }

  const second = await provider.complete(
    "방금 답한 값의 글자 수는 몇 글자야? 숫자만 대답해.",
    { sessionId: first.sessionId, cwd: process.cwd() },
  );
  logger.info("Resumed call result", { ...second });
}

main().catch((error: unknown) => {
  console.error("ClaudeProvider test failed:", error);
  process.exitCode = 1;
});
