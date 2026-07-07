# NEXUS 프로젝트 심층 분석 보고서

> 작성일: 2026-07-07 (코드베이스 전체를 파일 단위로 직접 읽고 정리한 리서치 문서)

## 1. 프로젝트 정체성

- **패키지명**: `nexus` (v0.1.0) — 과거 코드네임 `sentinel`/`projectButler`가 클래스명·변수명·pm2 프로세스명 등 코드 곳곳에 잔존. 표시 이름/AI 페르소나는 "NEXUS(넥서스)"로 통일.
- **한 줄 요약**: Claude Code로 개발하는 동안 `reports/` 폴더에 남긴 Markdown 리포트를 감지 → GPT로 요약 → Telegram으로 전달하고, 반대로 Telegram 메시지를 받아 headless Claude Code를 원격 실행시키는 **개인용 AI 개발 매니저 / 상시 백그라운드 에이전트**.
- **NEXUS 자신은 개발을 수행하지 않는다.** Claude Code와는 파일 시스템(`reports/` 폴더)을 통해서만 느슨하게 결합되어 있다.
- **런타임 성격**: 여러 PC(Windows/macOS/Linux)에서 각각 하나의 "Agent" 프로세스로 상시 구동되는 것을 전제로 설계됨 (pm2 + Windows 자동 시작 문서화가 특히 상세 — 실제 운영 환경은 Windows PC로 보인다). 여러 Agent/여러 프로젝트가 하나의 공유 Turso DB와 하나의 Telegram 챗을 통해 연결된다.

## 2. 전체 아키텍처

### 2.1 두 개의 독립적인 이벤트 파이프라인

```
[리포트 파이프라인: Claude Code -> Telegram]
ReportWatcher (chokidar, reports/ 감시)
  --REPORT_CREATED-->
GptSummaryListener (IAIProvider: OpenAI, 캐싱+예산 적용)
  --GPT_SUMMARY-->
ReportSaveListener (Turso reports 테이블에 저장)
  --DATABASE_SAVE-->
TelegramSummaryListener (Telegram 전송)
  --TELEGRAM_SEND-->
TelegramHistoryListener (Turso telegram_history 기록)
```

```
[명령 파이프라인: Telegram -> Claude Code]
TelegramPoller (long-polling, 지정된 chatId만 처리)
  --TELEGRAM_COMMAND_RECEIVED-->
ClaudeCommandListener
  1) 대기 중인 승인 응답인지 확인
  2) matchProjectFromText로 프로젝트 매칭 (자기 자신은 기본 제외)
  3) 매칭 실패 시 sticky 프로젝트(최근 5분 내 대화) 후보를 관리AI로 재확인
  4) 매칭 프로젝트도 없으면 일반 대화(OpenAI)로 응답하고 종료
  5) 관리AI로 위험도 분류(SAFE / NEEDS_APPROVAL) — 위험하면 승인 요청 후 대기
  6) headless Claude 실행(세션 재개 or 신규) — "개발 전용 AI"
  7) 관리AI로 결과를 Telegram 메시지로 가공
  --TELEGRAM_SEND-->
```

두 파이프라인 모두 `EventLogListener`가 `onAny`로 모든 이벤트를 `event_logs`에 기록한다. `TELEGRAM_SEND`는 두 파이프라인이 공유하는 합류 지점이라, 발신 채널이 하나로 통합되어 있다(`TelegramHistoryListener`가 어디서 왔든 동일하게 기록).

### 2.2 핵심 설계 원칙 (코드에서 확인됨)

1. **이벤트 기반 + 타입 안전** — `src/dispatcher/events.ts`의 `SentinelEvent` 유니온 타입 하나로 전체 파이프라인의 계약이 정의됨. 리스너는 `dispatcher.on("TYPE", handler)`로 구독하며 핸들러 시그니처가 이벤트 타입에 맞게 자동으로 좁혀진다.
2. **에러가 파이프라인을 죽이지 않음** — `EventDispatcher.on`은 실패한 핸들러를 지수 백오프로 재시도(기본 3회, 500ms → 1000ms)하고, 그래도 실패하면 예외를 삼키고 `SENTINEL_ERROR` 이벤트를 발행한다. 즉 한 리스너의 버그가 프로세스를 크래시시키지 않고 Telegram 알림으로만 나타난다.
3. **Repository 패턴으로 DB 추상화** — 모든 서비스/리스너는 `I*Repository` 인터페이스에만 의존하고, 실제 구현(`Turso*Repository`)은 `RepositoryContainer` 하나가 생성해서 주입한다. Drizzle/Turso를 교체해도 비즈니스 로직은 무영향.
4. **AI Provider 데코레이터 체인** — `IAIProvider` 하나의 인터페이스에 대해 `UsageTrackingAIProvider` → `BudgetLimitedAIProvider` → `CachedAIProvider` 순으로 감싸서 로깅/과금/캐싱을 조합 가능한 책임으로 분리(전형적인 Decorator 패턴).
5. **프로젝트 자동 식별, 설정 파일 없음** — `package.json` name / git origin / 폴더명 3개 신호를 교차검증해서 프로젝트를 식별하고 경로(path) 기준으로 DB에 upsert. 사람이 프로젝트를 등록할 필요가 없다.

## 3. 디렉터리별 상세

```
src/
  index.ts        전체 배선(wiring)이 이루어지는 단일 진입점
  agent/          프로젝트 자동 식별, 워크스페이스 스캔, Agent 등록+Heartbeat, 명령 라우팅 보조 유틸
  ai/             IAIProvider 인터페이스, 프롬프트 템플릿, OpenAiProvider/ClaudeProvider, 3종 데코레이터
  config/         env 변수 검증 (필수: Turso / 선택: OpenAI, Telegram, 예산, Jira)
  database/       Drizzle 스키마 정의 + Turso 클라이언트 팩토리
  dispatcher/     EventDispatcher(재시도+에러이벤트), 이벤트 계약, retry 유틸
  jira/           Jira Cloud REST 클라이언트 + 일일 리포트 Job
  logger/         ILogger 추상화 (현재 구현은 ConsoleLogger 하나)
  repository/     Repository 패턴 (인터페이스 8종 + Turso 구현체 8종 + 컨테이너)
  services/       이벤트 리스너 8종 (파이프라인의 각 단계)
  telegram/       TelegramBotService(송신), TelegramPoller(장기 폴링 수신)
  watcher/        ReportWatcher (chokidar 기반 파일 감시)
```

### 3.1 `src/index.ts` — 배선(composition root)

역할이 뚜렷하게 순서대로 나뉜다:

1. `loadEnv()`로 환경변수 검증 → Turso 클라이언트/DB 생성 → `RepositoryContainer` 생성.
2. `resolveProject()`로 현재 실행 디렉터리(`process.cwd()`) 기준 프로젝트 식별 + `projects` 테이블 upsert.
3. AI Provider 체인 조립:
   - `OpenAiProvider` → `UsageTrackingAIProvider`(항상 적용) → (`OPENAI_MONTHLY_BUDGET_USD` 설정 시) `BudgetLimitedAIProvider` → `CachedAIProvider`("report_summary" kind로 리포트 요약 전용 캐싱).
   - `ClaudeProvider` → `UsageTrackingAIProvider` (캐싱은 적용하지 않음 — 개발 작업은 매번 실제 실행되어야 하므로).
4. `AgentLifecycle.start()`로 이 PC를 `agents` 테이블에 등록(하거나 재사용)하고 30초 heartbeat 시작. **주석에 의하면 이 등록이 리스너 배선보다 먼저 일어나야 하는 이유는 `ReportSaveListener`가 `reports.agent_id` NOT NULL FK를 만족시켜야 하기 때문.**
5. `EventDispatcher` 생성 후 리스너 8개를 순서 상관없이(이벤트 기반이므로) 생성자에서 자가 구독시키는 방식으로 배선.
6. Jira 4개 환경변수가 모두 있으면 `node-cron`으로 평일 09:00(Asia/Seoul)에 `JiraDailyReportJob.run()` 예약.
7. `ReportWatcher.start()`, `TelegramPoller.start()` 실행 후 `AGENT_STARTED` 이벤트 발행.
8. **종료 처리**: `SIGINT`/`SIGTERM` 모두 리스닝(Windows에서 pm2가 SIGINT를 안정적으로 전달하지 않는다는 이유가 코드 주석에 명시됨) → `AGENT_STOPPED` 알림을 `dispatcher.publish()`가 아니라 `agentLifecycleListener.handleStopped()`를 **직접 await**해서 fire-and-forget이 아니게 만듦 → watcher/poller/heartbeat 정리 → 300ms 유예 후 `process.exit(0)`.

### 3.2 `src/dispatcher/` — 이벤트 시스템

- `events.ts`: `SentinelEvent` 유니온에 8개 이벤트 타입(`REPORT_CREATED`, `GPT_SUMMARY`, `DATABASE_SAVE`, `SENTINEL_ERROR`, `TELEGRAM_SEND`, `TELEGRAM_COMMAND_RECEIVED`, `AGENT_STARTED`, `AGENT_STOPPED`)이 정의됨.
- `EventDispatcher`: Node `EventEmitter`를 래핑. `on()`은 타입별 핸들러를 재시도+에러이벤트 발행과 함께 등록하고, `onAny()`는 로깅류(`EventLogListener`)를 위한 재시도 없는 best-effort 훅.
- `retry.ts`: `withRetry(fn, {maxAttempts, delayMs, backoffFactor})` — 표준적인 지수 백오프 구현, 마지막 실패는 rethrow.
- 기본 재시도 정책: `{maxAttempts: 3, delayMs: 500, backoffFactor: 2}` → 500ms, 1000ms 대기 후 3번째 시도, 실패 시 `SENTINEL_ERROR` 발행.

### 3.3 `src/watcher/ReportWatcher.ts`

- chokidar v4+ 는 glob watch path를 지원하지 않아 디렉터리를 통째로 감시하고 `.md` 확장자만 핸들러에서 필터링.
- `awaitWriteFinish: {stabilityThreshold: 1000, pollInterval: 100}` — 파일 크기가 1초간 변하지 않을 때까지 대기해서 쓰다 만 파일을 읽는 것을 방지.
- `ignoreInitial: true` — 시작 시 이미 존재하는 파일은 이벤트를 발행하지 않음(재시작 시 과거 리포트 재처리 방지).

### 3.4 `src/ai/` — AI Provider 추상화

**`IAIProvider`**: `complete(prompt, options?) -> {text, sessionId?, usage?}` 단일 메서드. `options.permissionMode`는 ClaudeProvider 전용이며, 특히 헤드리스 모드에는 인터랙티브 터미널이 없어 기본값을 비워두면 권한 팝업을 무한 대기하게 되므로 명시적으로 `acceptEdits`를 기본값으로 강제한다(주석에 명시).

**`OpenAiProvider`** ("운영/관리 AI"):
- 기본 모델 `gpt-4o-mini`. 매 호출이 stateless(대화 이력 없음).
- OpenAI API가 실제 비용을 반환하지 않으므로 `PRICING_PER_1M_TOKENS` 하드코딩 테이블(gpt-4o-mini/gpt-4o)로 비용을 **추정**해서 `usage.costUsd`에 채운다. 가격 변동 시 수동 갱신 필요 — 이 부분이 유일하게 "실제 청구액과 괴리될 수 있는" 지점.

**`ClaudeProvider`** ("개발 전용 AI"):
- `cross-spawn`으로 `claude -p <prompt> --output-format json --permission-mode <mode> [--resume <sessionId>]` 실행. cross-spawn을 쓰는 이유는 Windows에서 `.cmd` shim 해석과 인자 quoting을 올바르게 처리하기 위함(plain spawn + shell:true는 공백/특수문자 포함 프롬프트를 망가뜨림).
- stdout을 JSON으로 파싱 시도 → 실패하면 첫 `{`부터 마지막 `}`까지 잘라서 재시도 → 그래도 실패하면 원문 텍스트로 폴백(이 경우 sessionId/usage 유실, 다음 호출은 새 세션으로 시작).
- `is_error: true`면 예외 발생.
- 실제 비용(`total_cost_usd`)과 토큰 사용량을 CLI가 직접 반환하므로 OpenAI와 달리 추정이 아니라 실측치.

**3종 데코레이터** (모두 `IAIProvider`를 그대로 구현하는 래퍼):
| 데코레이터 | 역할 | 주의사항 |
|---|---|---|
| `UsageTrackingAIProvider` | 매 호출의 `usage`를 `statistics` 테이블에 `ai_usage_{providerName}` 메트릭으로 기록 | 커맨드가 타겟팅한 하위 프로젝트가 아니라 **이 Agent 자신의 프로젝트 ID**로 기록(지출 추적은 배포 단위) |
| `BudgetLimitedAIProvider` | 이번 달 `statistics`에서 `ai_usage_openai` 합산 → 예산 초과 시 즉시 throw | `UsageTrackingAIProvider`가 쓰는 것과 **같은 metricName**을 읽어야 하므로 반드시 그 바깥을 감싸야 함(안쪽이 아니라) |
| `CachedAIProvider` | `sha256(prompt)` 기반 캐시 키(`{kind}:{hash}`)로 `ai_response_cache` 조회/저장 | **순수 입력결정적 작업에만** 사용해야 함 — 실제로 report_summary 한 곳에만 적용되고 ClaudeProvider(부작용 있는 개발 작업)에는 절대 적용 안 됨 |

- `prompts.ts`: 5개 시스템 프롬프트/프롬프트 빌더. 모두 "당신은 NEXUS(넥서스)"로 시작하는 페르소나 고정. 특히 `buildRiskClassificationPrompt`, `buildContinuationCheckPrompt`는 명령 라우팅 안전장치의 핵심(3.6 참고).
- `truncateForAI.ts`: 8000자 초과 시 앞 70%+뒤 30%만 남기고 중간을 생략 표시. 캐시 해싱 **이전**에 적용되므로 잘린 결과가 같으면 캐시가 히트한다.

### 3.5 `src/telegram/`

- `TelegramBotService` (송신): `fetch`로 `sendMessage` 직접 호출. Markdown 파싱 실패(400 "can't parse entities")를 감지해 parse_mode 없이 평문으로 1회 재전송하는 폴백이 있음 — AI가 생성한 텍스트에 이스케이프되지 않은 Markdown 특수문자가 섞여도 알림 자체가 유실되지 않도록.
- `TelegramPoller` (수신): 봇 API webhook이 아니라 `getUpdates` **long-polling**. 시작 시 `skipPendingBacklog()`로 대기 중이던 update들을 오프셋만 증가시켜 건너뛴다(오프라인 중 쌓인 명령을 재실행하지 않기 위함). `chatId`가 설정값과 다르면 무시. 폴링 실패 시 5초 대기 후 재시도(무한 루프, `AbortController`로 `stop()` 시 중단).

### 3.6 `src/services/` — 리스너 (파이프라인의 실질 로직)

| 리스너 | 구독 이벤트 | 발행 이벤트 | 핵심 로직 |
|---|---|---|---|
| `GptSummaryListener` | REPORT_CREATED | GPT_SUMMARY | 리포트를 truncate 후 OpenAI(캐시/예산 적용됨)로 요약 |
| `ReportSaveListener` | GPT_SUMMARY | DATABASE_SAVE | `reports` 테이블에 원문+요약 영속화 (project/agent FK 연결) |
| `TelegramSummaryListener` | DATABASE_SAVE | TELEGRAM_SEND | "작업 완료" 알림 전송 |
| `TelegramErrorListener` | SENTINEL_ERROR | TELEGRAM_SEND | "오류 발생" 알림 (재시도 소진 후에만 발동) |
| `TelegramHistoryListener` | TELEGRAM_SEND | (없음) | 발신 이력을 `telegram_history`에 기록 |
| `EventLogListener` | (모든 이벤트, onAny) | (없음) | 감사 로그를 `event_logs`에 기록. 자체 실패는 로깅만 하고 삼킴(무한 에러루프 방지) |
| `AgentLifecycleListener` | AGENT_STARTED (구독) / AGENT_STOPPED (직접 호출) | TELEGRAM_SEND | "Agent 시작/종료" 알림. **종료 알림은 이벤트 구독이 아니라 `handleStopped()`를 index.ts가 직접 await** — dispatcher.publish는 fire-and-forget이라 프로세스 종료 전 전송 보장이 안 되기 때문 |
| `ClaudeCommandListener` | TELEGRAM_COMMAND_RECEIVED | TELEGRAM_SEND | 아래 별도 상술 |

#### `ClaudeCommandListener` 상세 — 텔레그램 명령 라우팅의 전체 로직

이 클래스가 "텔레그램으로 기능 만들 때" 실제로 동작하는 핵심부다. 인스턴스 상태(3개)를 들고 있는 **유일한** 리스너:
- `lastActiveProjectId` / `lastActiveAt` — sticky 라우팅용.
- `pendingApproval` — 승인 대기 중인 요청 1건(동시에 1건만 가능, 새 명령이 들어오면 그 명령을 승인 응답으로 우선 해석).

처리 순서 (핸들러 진입 시):

1. **승인 응답 우선 처리** — `pendingApproval`이 있으면 이번 메시지는 새 명령이 아니라 그 승인에 대한 답변으로 간주(`resolvePendingApproval`). `PENDING_APPROVAL_TIMEOUT_MS`(10분) 초과 시 자동 취소. `AFFIRMATIVE_PATTERN`(정규식: 네/예/응/어/ㅇㅋ/오케이/승인/진행/yes/ok/approve로 시작)에 매치되지 않으면 취소 처리.
2. **자기 자신(NEXUS/Sentinel) 타겟팅 여부** — `isSelfModificationRequested()`가 "sentinelai"/"sentinel"이라는 단어(단어 경계 매치)를 찾을 때만 자기 프로젝트를 대상으로 허용. 일상 호칭인 "넥서스"는 트리거되지 않도록 의도적으로 분리된 코드네임을 사용 — 실수로 자기 코드베이스가 수정되는 것을 막기 위한 명시적 opt-in.
3. **프로젝트 매칭** — `matchProjectFromText`가 등록된 프로젝트 이름/슬러그를 텍스트에서 **단어 경계** 매치(부분 문자열 아님, "sentinelAI"가 "sentinel"에 안 걸리는 것과 같은 원리)로 찾고, 여러 개 걸리면 가장 이름이 긴 것을 선택.
4. **Sticky 라우팅 폴백** — 매칭 실패 + 5분 이내 활성 프로젝트가 있으면, 바로 그 프로젝트로 라우팅하지 않고 먼저 관리AI에게 `buildContinuationCheckPrompt`로 "이 메시지가 이전 대화의 연장인가, 새 주제인가"를 물어 CONTINUE일 때만 채택. (설계 의도: "점심 뭐 먹지" 같은 잡담이 직전 프로젝트에 대한 실제 Claude 실행을 유발하지 않도록 하는 저비용 사전 체크.)
5. **매칭 실패 시 일반 대화** — 프로젝트를 못 찾으면 개발 작업이 아니라고 판단하고 `GENERAL_CHAT_SYSTEM_PROMPT`로 관리AI가 그냥 대화 응답. 이때 `[NEXUS 시스템 정보]` 블록(관리 중인 프로젝트 목록, Jira 스케줄)을 프롬프트에 주입해 "자기 설정에 대한 질문"에 정확히 답할 수 있게 한다.
6. **위험도 분류(Risk Gate)** — 프로젝트가 확정되면 실행 전에 반드시 `buildRiskClassificationPrompt`로 SAFE/NEEDS_APPROVAL을 관리AI에게 묻는다. Headless Claude는 자체 권한 프롬프트를 띄울 터미널이 없으므로, 이 게이트가 그 역할을 대신한다. NEEDS_APPROVAL이면 `pendingApproval`을 세팅하고 Telegram으로 승인을 요청한 뒤 **여기서 즉시 리턴**(실행 안 함).
7. **Claude 실행** — SAFE거나 승인된 경우 `runClaudeTask()`: `cwd: project.path`, 기존 `claudeSessionId`가 있으면 `--resume`, 승인 경로는 `permissionMode: "bypassPermissions"`(사람이 이미 명시적으로 승인했으므로), 그 외는 `acceptEdits`. 반환된 `sessionId`를 즉시 `projectRepository.updateClaudeSessionId()`로 저장해 다음 대화가 이어지도록 함.
8. **결과 가공** — Claude의 원문 결과를 `TELEGRAM_RESULT_SYSTEM_PROMPT`로 관리AI(OpenAI)가 다시 다듬어 Telegram 메시지로 변환(AI 역할 분리: 개발 AI의 원시 출력 그대로를 보내지 않음).
9. **에러는 절대 rethrow 안 함** — 최상위 `catch`에서 에러 메시지를 Telegram으로만 보내고 삼킨다. 이유: 만약 dispatcher의 재시도 래퍼가 이 핸들러를 재시도하면 이미 부작용(파일 수정, git 커밋 등)이 발생한 Claude 실행이 **중복 실행**될 위험이 있기 때문(README에도 명시된 설계 이유).

`STICKY_PROJECT_WINDOW_MS = 5분`, `PENDING_APPROVAL_TIMEOUT_MS = 10분` 두 상수가 이 클래스의 시간 기반 상태를 결정한다.

### 3.7 `src/agent/` — 프로젝트 식별 · 워크스페이스 스캔 · Agent 생명주기

- **`ProjectIdentifierService`**: `package.json`의 `name`, `.git/config`의 `[remote "origin"] url`(정규식으로 파싱, 상위 디렉터리로 `.git` 탐색), 폴더명(`path.basename`) 3개 신호를 모두 수집 → 정규화(`normalize`: 소문자+영숫자만)해서 그룹핑 → 2개 이상 신호가 일치하면 confidence "high"(그 중 package_json 값을 우선 채택), 아니면 우선순위(`package_json > git_origin > folder_name`) 순으로 confidence "low"를 반환. 모든 신호가 없으면 "Unknown Project"로 폴백(예외를 던지지 않음 — 식별 실패가 Agent 동작을 막아서는 안 된다는 설계).
- **`resolveProject` / `upsertProject`**: 식별 결과를 `projects` 테이블에 **경로(path) 기준**으로 upsert. 이름이 같아도 경로가 다르면 별도 프로젝트로 등록됨(모노레포에서 동명 하위 프로젝트가 있는 케이스를 명시적으로 지원).
- **`WorkspaceScanner`**: 워크스페이스 루트 하위(기본 depth 1)를 스캔해서 `package.json` 또는 `.git`이 있는 디렉터리를 프로젝트로 인식. `node_modules`/`dist`/`build`/`.next`/`.turbo`/`.cache`/dot-디렉터리는 제외. 프로젝트 마커를 찾으면 그 안으로는 더 안 들어감(중첩 프로젝트 방지).
- **`matchProjectFromText` / `containsWholeWord`**: 정규식 단어 경계 매치. 여러 후보 중 이름이 가장 긴 것을 채택(구체적인 이름이 우선).
- **`selfModificationTrigger.ts`**: 위 3.6의 자기 자신 타겟팅 게이트.
- **`AgentLifecycle`**: hostname으로 기존 등록을 찾아 재사용(재시작해도 같은 Agent row 유지) → 없으면 신규 등록 → 30초 heartbeat(`setInterval` + `.unref()`로 이 타이머가 프로세스 종료를 막지 않게 함) → `stop()` 시 `status: offline`으로 업데이트.
  - **README에 명시된 알려진 한계**: Windows에서 pm2가 stop/restart 시 SIGINT/SIGTERM을 안정적으로 전달하지 않아 `status: offline` 처리와 "Agent 종료" 알림이 항상 발생하지는 않는다. 따라서 Agent의 실제 온라인 여부는 `status` 컬럼보다 **`last_heartbeat`가 최근인지**(30초 간격보다 충분히 지났으면 오프라인 간주)로 판단하는 게 더 신뢰도가 높다고 문서화되어 있음 — 향후 `/status` 명령 구현 시 이 기준을 따라야 함.

### 3.8 `src/database/` & `src/repository/`

**스키마 (9개 테이블, `src/database/schema.ts`, Drizzle sqlite-core / Turso)**:

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `projects` | id, name, slug, **path(unique)**, status, claudeSessionId | path가 진짜 식별자, name/slug는 중복 가능 |
| `agents` | id, name, platform, hostname, version, status, lastHeartbeat | |
| `reports` | id, projectId(FK), agentId(FK, NOT NULL), filePath, rawContent, summary | |
| `tasks` | id, projectId(FK), reportId(FK, optional), title, status | **정의만 되어 있고 리포지토리(interface+구현)는 있으나 어떤 리스너도 아직 사용하지 않음(V2+ 예정 기능으로 추정)** |
| `todos` | id, projectId(FK), content, done | 마찬가지로 스키마+리포지토리는 존재하나 배선에서 미사용 |
| `statistics` | id, projectId(FK), metricName, metricValue(JSON string) | AI 사용량/비용 추적에 사용 중 |
| `telegram_history` | id, projectId(nullable FK), chatId, direction, messageType, content | direction 컬럼이 있지만 코드상 기록되는 것은 항상 "outbound"(inbound 기록 로직은 아직 없음) |
| `event_logs` | id, projectId(nullable), agentId(nullable), eventType, payload(JSON) | agentId는 스키마에 있지만 `EventLogListener`가 항상 `null`로 기록 |
| `ai_response_cache` | id, cacheKey(unique, `{kind}:{sha256}`), responseText | |

**Repository 패턴**: `IProjectRepository`, `IAgentRepository`, `IReportRepository`, `ITaskRepository`, `ITodoRepository`, `IStatisticsRepository`, `ITelegramHistoryRepository`, `IEventLogRepository`, `IAiResponseCacheRepository` — 인터페이스는 9개, `RepositoryContainer`가 각각의 Turso 구현체를 생성해 하나로 묶는다. 모든 Turso 구현체는 거의 동일한 패턴(`randomUUID()`로 id 생성, `createdAt` 기본값 채움, Drizzle `insert/select/update` 호출)이라 상용구가 많다 — 향후 공통 베이스 클래스로 추출할 여지가 있음(현재는 안 되어 있음).

**`database/client.ts`**: `@libsql/client`로 Turso 연결 생성 후 `drizzle-orm/libsql`로 감싼 것. env를 인자로 받아 `process.env` 직접 의존을 피함(테스트 용이성).

### 3.9 `src/jira/`

- `JiraClient`: Jira Cloud REST API v3 `/search/jql` 엔드포인트를 Basic Auth(email:apiToken, base64)로 호출. JQL: `project = "{KEY}" AND assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC`.
- `JiraDailyReportJob`: 이슈 목록 → 포맷팅 → 관리AI(`JIRA_DAILY_REPORT_SYSTEM_PROMPT`)로 우선순위 브리핑 생성 → Telegram 전송 → `TELEGRAM_SEND` 발행. 실패 시에도 에러 메시지를 Telegram으로 보내려 시도(이중 실패는 로깅만).
- index.ts에서 `node-cron`으로 `"0 9 * * 1-5"` (Asia/Seoul) 스케줄, 4개 env 변수가 모두 있어야 활성화.

### 3.10 `src/config/`, `src/logger/`

- `env.ts`: Turso 2개 변수만 필수(`requireEnv`가 없으면 throw), 나머지(OpenAI/Telegram/예산/AgentName/Jira 4종)는 전부 optional — 각 기능이 자기 필요 시점에 검증(`index.ts`에서 OpenAI/Telegram은 사실상 필수처럼 체크됨).
- `ILogger`/`ConsoleLogger`: 매우 단순한 `console.log` 기반 구조화 로깅(`[timestamp] [LEVEL] message {json meta}`). 파일/원격 로깅 등 다른 구현체는 아직 없음.

## 4. 배포/운영 (README 기준 확인, 코드와 정합성 있음)

- 항상 pm2(`ecosystem.config.cjs`, 프로세스명 `sentinel`)로 실행. `dist/index.js`를 대상으로 하므로 코드 변경 후 `npm run build`가 선행되어야 반영됨.
- Windows 부팅 자동 시작은 `pm2-windows-startup` 패키지 + 레지스트리 등록(`HKCU\...\Run\PM2`)으로 구현 — Linux/macOS의 `pm2 startup`과 다른 경로.
- 로그는 `logs/sentinel-out.log` / `logs/sentinel-error.log`로 pm2가 직접 기록.

## 5. 미완성/스텁 상태로 보이는 부분 (코드 근거)

1. **`tasks`, `todos` 테이블 및 그 Repository** — 스키마와 인터페이스/Turso 구현체가 모두 존재하지만, `src/services/*` 어떤 리스너도 이들을 참조하지 않는다. `index.ts`에서도 `RepositoryContainer.tasks`/`.todos`가 어디에도 안 쓰인다. 향후 "Task 자동 생성" 로드맵 항목(README의 V2+ 후보)을 위한 선행 스키마로 추정.
2. **`telegram_history.direction`** — 컬럼은 inbound/outbound 둘 다 표현 가능하지만 실제로 기록하는 `TelegramHistoryListener`는 `TELEGRAM_SEND`(발신)에만 반응하므로 값은 항상 "outbound". 수신 명령(`TELEGRAM_COMMAND_RECEIVED`) 자체를 이력에 남기는 로직은 없음.
3. **`event_logs.agentId`** — 스키마엔 있지만 `EventLogListener`가 항상 `null`로 채움(어느 Agent가 발생시켰는지는 현재 기록되지 않음, projectId만 채워짐).
4. **`archive/`** — README에 "처리 완료된 리포트 보관 (예정)"이라고 명시되어 있고 실제로 `.gitkeep`만 존재 — `ReportWatcher`가 처리 후 파일을 이 폴더로 옮기는 로직은 아직 없음(리포트 원본은 계속 `reports/`에 남는 것으로 보임).
5. **`AgentLifecycleListener`가 구독하는 이벤트는 `AGENT_STARTED`뿐** — `AGENT_STOPPED`는 이벤트 구독이 아니라 `index.ts`가 종료 시 메서드를 직접 호출하는 방식이라, 이 클래스는 사실 "리스너"라기보다 "이벤트 발행도 하는 서비스"에 가깝다(다른 7개 리스너와 패턴이 다름).

## 6. 테스트/검증 스크립트 (npm scripts 기준)

각 모듈에 `test-*.ts`(tsx로 직접 실행하는 수동 확인 스크립트, 자동화된 유닛테스트 프레임워크는 아님)가 대응된다: `db:test`, `watch:test`, `dispatcher:test`, `ai:test-openai`, `ai:test-claude`, `agent:test-project-id`, `agent:test-workspace-scan`, `jira:test-report`, `telegram:test`. 즉 이 프로젝트는 Jest/Vitest 같은 정식 테스트 러너 없이, 실제 외부 서비스(Turso/OpenAI/Claude CLI/Telegram/Jira)에 대고 눈으로 확인하는 통합 스모크 테스트 방식을 택하고 있다.

## 7. 요약: 이 시스템을 한 문장씩으로

- **무엇을 하는가**: Claude Code의 작업 결과를 자동으로 요약해 Telegram으로 보내고, Telegram 메시지로 다시 Claude Code를 원격 조종할 수 있게 하는 상시 백그라운드 에이전트.
- **어떻게 안전한가**: 위험한 명령은 실행 전에 관리AI가 분류해 사람의 명시적 승인을 받고(승인 전엔 `acceptEdits`, 승인 후엔 `bypassPermissions`), 실패는 재시도 후 조용히 에러 이벤트로 전환되어 Telegram 알림 하나로 귀결된다.
- **왜 여러 PC/프로젝트를 지원하는가**: 프로젝트 식별이 파일시스템 신호(패키지명/git origin/폴더명)만으로 자동화되어 있고, 모든 상태가 공유 Turso DB에 있어서 어느 PC에서 Agent를 띄워도 같은 프로젝트 목록/세션을 이어받는다.
- **가장 정교한 단일 클래스**: `ClaudeCommandListener` — 승인 대기 상태 머신, sticky 라우팅, 자기수정 방지, 위험도 게이팅까지 하나의 핸들러 안에 조합되어 있다.
