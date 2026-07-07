import { loadEnv } from "../config/env.js";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { OpenAiProvider } from "./providers/OpenAiProvider.js";
import { REPORT_SUMMARY_SYSTEM_PROMPT } from "./prompts.js";

const SAMPLE_REPORT = `# 2026-07-07 로그인 기능 작업

- JWT 기반 로그인 API 구현
- 비밀번호 해싱에 bcrypt 적용
- 테스트 3개 작성, 전부 통과
- TODO: 리프레시 토큰 만료 정책 아직 미정
`;

/**
 * Manual verification script (npm run ai:test-openai): calls the real
 * OpenAI API through OpenAiProvider with a sample report and prints the
 * summary.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const env = loadEnv();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env");
  }

  const provider = new OpenAiProvider({ apiKey: env.OPENAI_API_KEY });
  const result = await provider.complete(SAMPLE_REPORT, {
    systemPrompt: REPORT_SUMMARY_SYSTEM_PROMPT,
  });

  logger.info("OpenAiProvider result", { text: result.text });
}

main().catch((error: unknown) => {
  console.error("OpenAiProvider test failed:", error);
  process.exitCode = 1;
});
