# NEXUS

**N**eural **E**xpert for **X**perience and **U**tilization of **S**ystems (넥서스) - Claude Code를
위한 AI Development Manager. `reports/`에 새 Markdown 리포트가 생기면 감지해서 GPT로 요약하고,
Telegram으로 전달하며, 모든 이벤트를 Turso(Drizzle ORM)에 기록하는 중앙 관리 시스템.

NEXUS는 개발을 수행하지 않는다. Claude Code와는 느슨하게 결합되어 있으며, Claude Code는
`reports/`에 Markdown 리포트만 남기면 된다.

(프로젝트 디렉터리/npm 패키지명은 과거 이름인 `sentinel`/`projectButler`가 일부 남아있을 수 있음 -
표시 이름/AI 페르소나는 NEXUS로 통일됨)

## 아키텍처

### 리포트 파이프라인 (Claude Code -> Telegram)

```
Report Watcher (chokidar, reports/ 감시)
  -> REPORT_CREATED
  -> GptSummaryListener       (IAIProvider: OpenAiProvider, 캐싱+예산 적용, stateless)
  -> GPT_SUMMARY
  -> ReportSaveListener       (Turso: reports, project/agent 연결)
  -> DATABASE_SAVE
  -> TelegramSummaryListener
  -> TELEGRAM_SEND
  -> TelegramHistoryListener  (Turso: telegram_history)
```

### 명령 파이프라인 (Telegram -> Claude Code)

```
TelegramPoller (long-polling, 설정된 chatId만 처리)
  -> TELEGRAM_COMMAND_RECEIVED
  -> ClaudeCommandListener
       1. matchProjectFromText로 등록된 프로젝트 중 매칭 (Sentinel 자신은 제외)
       2. IAIProvider: ClaudeProvider - headless `claude -p --output-format json`,
          프로젝트별 저장된 sessionId로 --resume (없으면 새 세션)
       3. OpenAiProvider로 결과를 Telegram 메시지로 가공 (AI 역할 분리)
  -> TELEGRAM_SEND
```

모든 이벤트는 EventLogListener가 event_logs 테이블에 자동 기록한다.
어떤 리스너든 재시도(backoff) 후에도 실패하면 SENTINEL_ERROR 이벤트가 발행되고,
TelegramErrorListener가 오류 알림을 보낸다 (Claude 명령 라우팅은 재시도로 인한
중복 실행을 막기 위해 에러를 내부에서 처리하고 재발행하지 않음).

AGENT_STARTED/AGENT_STOPPED 이벤트로 "Agent 시작/종료" Telegram 알림을 보낸다
(AgentLifecycle이 hostname 기준으로 agents 테이블에 자기 자신을 등록하고 30초마다
heartbeat를 보낸다).

AI 실행부는 IAIProvider 인터페이스로 추상화되어 있다:
  - OpenAiProvider: "운영/관리 AI" (요약, 명령 결과 가공) - 항상 Stateless
  - ClaudeProvider: "개발 전용 AI" - headless Claude CLI, 세션 재개 가능
  - UsageTrackingAIProvider / BudgetLimitedAIProvider / CachedAIProvider로 감싸서
    토큰/비용 기록, 월간 예산 제한, 리포트 요약 캐싱을 투명하게 적용

프로젝트는 설정 파일 없이 자동 식별된다 (ProjectIdentifierService: package.json
name / git origin / 폴더명 교차검증) - WorkspaceScanner로 워크스페이스 전체를 스캔해
`projects` 테이블에 경로 기준으로 등록해둘 수 있다.

```
src/
  agent/        프로젝트 자동 식별/워크스페이스 스캔/Agent 등록+Heartbeat
  ai/            IAIProvider 인터페이스 + OpenAiProvider / ClaudeProvider + 데코레이터 3종
  dispatcher/    Event Dispatcher (EventDispatcher, retry, 이벤트 계약)
  watcher/       Report Watcher (파일 감시)
  telegram/      Telegram Bot 연동 (송신 TelegramBotService, 수신 TelegramPoller)
  database/      Drizzle schema + Turso client
  repository/    Repository Pattern (interfaces + Turso 구현체)
  services/      이벤트 리스너 (요약, DB 저장, Telegram 송수신/기록, Claude 라우팅, Agent 알림, 이벤트 로깅)
  logger/        로깅 추상화
  config/        환경 변수 검증
database/migrations/  drizzle-kit이 생성하는 마이그레이션 SQL
reports/               Claude Code가 남기는 Markdown 리포트
archive/                처리 완료된 리포트 보관 (예정)
logs/                   pm2 런타임 로그
```

## 구현 현황

- [x] 프로젝트 골격 + Drizzle/Turso 연결
- [x] Report Watcher (파일 감시, 저장 완료 확인, Markdown 읽기)
- [x] Event Dispatcher (재시도 정책, 에러 이벤트, 전체 이벤트 로깅)
- [x] GPT 연동 (Stateless 요약)
- [x] Telegram 연동 (요약 전송, 오류 알림, 전송 이력 저장)
- [x] 배포 (pm2 + Windows 부팅 자동 시작)
- [x] AIProvider 추상화 (OpenAiProvider / ClaudeProvider, headless Claude 세션 재개 확인됨)
- [x] 프로젝트 자동 식별 (package.json/git origin/폴더명 교차검증, `projects` 테이블에 path 기준 자동 upsert)
- [x] Workspace 자동 탐색 (하위 프로젝트 스캔, 이름이 같아도 경로가 다르면 별도 프로젝트로 등록)
- [x] Telegram Inbound (long-polling, 재시작 시 오프라인 중 쌓인 메시지는 건너뜀, 설정된 chatId만 처리)
- [x] Claude 프로세스 관리 (명령에서 프로젝트 매칭 -> headless Claude 실행/세션 재개 -> OpenAI가 결과를 텔레그램 메시지로 가공)
- [x] OpenAI 사용량 추적 / 캐싱 / 월간 예산 (동일 리포트 재요약 캐싱, 토큰/비용 DB 기록, 예산 초과시 요약 차단+Telegram 알림)
- [x] Agent 등록 / Heartbeat (hostname 기준 재사용, 30초 heartbeat, Agent 시작/종료 Telegram 알림)
- [x] Database Save (report를 project/agent에 연결해 `reports` 테이블에 영속화, 파이프라인이 스펙 순서대로 GPT_SUMMARY -> DATABASE_SAVE -> TELEGRAM_SEND로 동작)
- [x] 프로젝트 매칭 정밀화 (부분 문자열이 아닌 단어 경계 매칭) + 프로젝트 미매칭시 일반 대화(OpenAI) 응답
- [x] Jira 일일 백로그 리포트 (평일 오전 9시 KST, 담당 이슈 조회 -> OpenAI가 우선순위 리포트 작성 -> Telegram 전송)

Sentinel V1 로드맵은 여기까지 완료. 향후(V2+) 후보: Telegram 명령어(`/status`, `/today`,
`/weekly`), Git Diff 분석, TODO 자동 생성, 여러 Agent/프로젝트 간 자연어 라우팅 고도화,
Web Dashboard.

## 시작하기

```bash
npm install
cp .env.example .env   # 아래 환경 변수 전부 채우기
npm run db:push        # 스키마를 Turso에 반영
npm run db:test         # Turso 연결 확인
npm run ai:test-openai   # OpenAI(관리 AI) 연결 확인
npm run ai:test-claude   # Claude(개발 AI) headless 실행 확인 (claude CLI 필요)
npm run telegram:test    # Telegram 연결 확인
npm run dev              # 전체 파이프라인 개발 모드로 실행 (Ctrl+C로 종료)
```

## 환경 변수 (`.env`)

| 변수 | 용도 | 발급처 |
|---|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | 프로젝트 DB | https://turso.tech 대시보드 → Database 생성 → Connect 탭 |
| `OPENAI_API_KEY` | GPT 요약 | https://platform.openai.com/api-keys (Billing에 결제 수단/크레딧 필요) |
| `TELEGRAM_BOT_TOKEN` | Telegram 봇 | 텔레그램 [@BotFather](https://t.me/BotFather) → `/newbot` |
| `TELEGRAM_CHAT_ID` | 알림 받을 채팅 | 봇과 대화 시작 후 `https://api.telegram.org/bot<TOKEN>/getUpdates` 에서 `chat.id` 확인 |
| `OPENAI_MONTHLY_BUDGET_USD` (선택) | 월간 OpenAI 예산 상한 (USD) | 미설정 시 무제한. 초과하면 요약 기능이 차단되고 Telegram으로 오류 알림 |
| `AGENT_NAME` (선택) | 이 PC의 Agent 표시 이름 | 미설정 시 `"<platform> Agent"` 자동 생성 (예: "windows Agent") |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` / `JIRA_PROJECT_KEY` (선택, 4개 모두 있어야 활성화) | 일일 백로그 리포트 | https://id.atlassian.com/manage-profile/security/api-tokens 에서 토큰 발급. `JIRA_PROJECT_KEY`는 Jira 이슈 키 접두어 (예: URL이 `/projects/IP/boards/2`면 "IP") |

## npm 스크립트

| 스크립트 | 설명 |
|---|---|
| `npm run dev` | 전체 파이프라인 개발 모드 실행 (tsx, 파일 변경 감지) |
| `npm run build` | `dist/`로 TypeScript 컴파일 |
| `npm start` | 컴파일된 `dist/index.js` 실행 (pm2 없이 단발 실행) |
| `npm run typecheck` | 타입만 검사 |
| `npm run db:push` / `db:generate` / `db:studio` | Drizzle 스키마를 Turso에 반영 / 마이그레이션 생성 / Studio 실행 |
| `npm run db:test` | Turso 연결 + 테이블 목록 확인 |
| `npm run watch:test` | Report Watcher 단독 테스트 (`reports/`에 `.md` 생성해서 확인) |
| `npm run dispatcher:test` | Event Dispatcher 재시도/에러 이벤트 경로 테스트 |
| `npm run ai:test-openai` | OpenAiProvider 요약 단독 테스트 |
| `npm run ai:test-claude` | ClaudeProvider headless 실행 + 세션 재개 단독 테스트 |
| `npm run telegram:test` | Telegram 전송 단독 테스트 |
| `npm run jira:test-report` | Jira 일일 백로그 리포트를 즉시 실행 (스케줄(평일 9시 KST) 기다리지 않고 확인) |
| `npm run deploy` | 빌드 후 pm2로 기동 |
| `npm run pm2:start` / `pm2:stop` / `pm2:restart` / `pm2:delete` | pm2 프로세스 제어 |
| `npm run pm2:status` / `pm2:logs` | pm2 상태 / 로그 확인 |

## 배포 (Windows, pm2)

Sentinel은 PC에서 계속 떠있어야 하는 백그라운드 프로세스다. 수동으로 터미널에서
`npm run dev`를 백그라운드로 띄우면 종료가 깔끔하지 않아 좀비 프로세스가 남을 수 있으므로,
운영 시에는 반드시 pm2로 관리한다.

### 최초 배포

```bash
npm run deploy           # build + pm2 start
npx pm2 save              # 현재 프로세스 목록 저장 (재부팅/재로그인 복원용)
```

### 일상적인 운영

```bash
npm run pm2:status   # 상태 확인
npm run pm2:logs      # 로그 확인
npm run pm2:restart   # 코드 수정 후 재빌드 -> 재시작
npm run pm2:stop      # 중지
```

### Windows 부팅 시 자동 시작

pm2는 Linux/macOS의 `pm2 startup`과 달리 Windows에서는 `pm2-windows-startup` 패키지로
로그온 시 자동 복구를 설정한다. 이미 이 프로젝트 PC에는 설정이 완료되어 있다 (Registry
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\PM2` 등록, 로그온 시 `pm2 resurrect` 실행).

새 PC에 처음 설정할 때:

```bash
npm install -g pm2 pm2-windows-startup
pm2-startup install
cd <project-dir>
npm run deploy
npx pm2 save
```

이후 코드를 변경하면 `npm run build && npm run pm2:restart`로 반영하고, 다시 `pm2 save`할
필요는 없다 (프로세스 이름/스크립트 경로가 그대로면 저장된 목록이 계속 유효함).

## 알려진 제약사항 (Windows)

pm2가 Windows에서 프로세스를 `stop`/`restart`할 때 SIGINT/SIGTERM을 안정적으로 전달하지
않는 것으로 확인됐다 (POSIX 시그널이 없는 Windows의 근본적인 제약 - 코드에서 두 시그널을
모두 처리하도록 해뒀지만, pm2가 애초에 신호를 보내지 않고 강제 종료하는 경우가 있다).
그 결과 "Agent 종료" Telegram 알림과 `agents.status = offline` 처리가 항상 발생하지는
않는다. 그래서 Agent의 온라인 여부는 `status` 값보다 **`last_heartbeat`가 최근인지
(30초 간격보다 충분히 오래됐으면 오프라인으로 간주)** 로 판단하는 것이 더 신뢰할 수 있다.
향후 `/status` 같은 Telegram 명령을 만들 때 이 기준을 사용할 것.

## Turso 데이터베이스 준비

1. https://turso.tech 대시보드에서 계정 생성 후 새 Database 생성
2. Database 페이지에서 URL과 Auth Token 발급
3. `.env`에 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`으로 채우기
