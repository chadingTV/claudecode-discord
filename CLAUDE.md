# CLAUDE.md

이 파일은 Claude Code (claude.ai/code)가 이 레포지토리에서 작업할 때 참고하는 가이드입니다.

## 프로젝트 개요

Discord(데스크톱/웹/모바일)에서 여러 프로젝트의 Claude Code 세션을 관리하는 봇. Discord 채널마다 독립적인 Claude Agent SDK 세션을 프로젝트 디렉토리에 매핑하여 실행. 쓰기 도구(Edit, Write, Bash)는 Discord 버튼으로 승인/거절 처리하고, 읽기 전용 도구는 자동 승인. AskUserQuestion 도구는 Discord 버튼/셀렉트메뉴로 질문 표시 및 답변 수집 (직접 입력도 지원). 파일 첨부(이미지, 문서, 코드 파일) 시 프로젝트 내 `.claude-uploads/`에 다운로드 후 Read 도구로 전달. 위험한 실행 파일(.exe, .bat 등)은 차단, 25MB 크기 제한 적용. macOS, Linux, Windows(네이티브/WSL) 지원.

## 명령어

```bash
npm run dev          # 개발 실행 (tsx)
npm run build        # 프로덕션 빌드 (tsup, ESM)
npm start            # 빌드된 파일 실행
npm test             # 테스트 실행 (vitest)
npm run test:watch   # 테스트 watch 모드
npx tsc --noEmit     # 타입 체크만 수행
./install.sh         # macOS/Linux 자동 설치 (Node.js, Claude Code, npm)
install.bat          # Windows 자동 설치
```

## 아키텍처

```
[Discord] ←→ [Discord Bot (discord.js v14)] ←→ [SessionManager] ←→ [Claude Agent SDK]
                              ↕
                        [SQLite (better-sqlite3)]
```

**핵심 데이터 흐름:** 등록된 채널에 메시지 전송 → `message.ts` 핸들러에서 인증/레이트리밋 검증 → 커스텀 입력 대기 중이면 AskUserQuestion 답변으로 처리 → 동시 세션 체크 (활성 시 거부) → 파일 첨부 다운로드 (이미지 + 문서) → `SessionManager.sendMessage()`가 Agent SDK `query()` 생성/재개 → 스트리밍 응답을 1.5초 간격으로 Discord 메시지 edit → 텍스트 출력 전에는 15초마다 heartbeat로 진행 상황 표시 (도구명, 경과시간, 도구 사용 횟수) → 진행 중 메시지에 Stop 버튼으로 즉시 중지 가능 → tool use 발생 시 `canUseTool` 콜백이 AskUserQuestion이면 질문 UI 전송, 읽기 전용이면 자동 승인, 아니면 Discord 버튼 embed 전송 → 사용자 승인/거절 → promise resolve → 결과 embed(비용/소요시간) 전송.

### 파일 구조

```
claudecode-discord/
├── install.sh              # macOS/Linux 자동 설치 스크립트
├── install.bat             # Windows 자동 설치 스크립트
├── .env.example            # 환경변수 템플릿
├── src/
│   ├── index.ts            # 엔트리포인트
│   ├── bot/
│   │   ├── client.ts       # Discord 봇 초기화 & 이벤트 라우팅
│   │   ├── commands/       # 슬래시 명령어 (10개)
│   │   │   ├── register.ts
│   │   │   ├── unregister.ts
│   │   │   ├── status.ts
│   │   │   ├── stop.ts
│   │   │   ├── auto-approve.ts
│   │   │   ├── sessions.ts
│   │   │   ├── last.ts
│   │   │   ├── usage.ts
│   │   │   └── clear-sessions.ts
│   │   └── handlers/
│   │       ├── message.ts      # 메시지 처리, 파일 다운로드
│   │       └── interaction.ts  # 버튼/셀렉트메뉴 처리
│   ├── claude/
│   │   ├── session-manager.ts  # 세션 생명주기, 진행 상황 표시
│   │   └── output-formatter.ts # Discord 출력 포맷
│   ├── db/
│   │   ├── database.ts     # SQLite 초기화 & 쿼리
│   │   └── types.ts
│   ├── security/
│   │   └── guard.ts        # 인증, rate limit, 경로 검증
│   └── utils/
│       └── config.ts       # 환경변수 검증 (zod v4)
├── SETUP.md / SETUP.kr.md  # 상세 셋업 가이드 (영문/한글)
├── README.md / README.kr.md
├── package.json
└── tsconfig.json
```

### 주요 모듈

- **`src/bot/client.ts`** — Discord.js 클라이언트 초기화, 이벤트 라우팅, 길드별 슬래시 커맨드 등록
- **`src/bot/commands/`** — 슬래시 커맨드 10개: register, unregister, status, stop, auto-approve, sessions, last, usage, queue, clear-sessions
- **`src/bot/handlers/message.ts`** — 채널 메시지를 보안 검증 후 SessionManager로 전달. AskUserQuestion 직접 입력 대기 중이면 답변으로 처리(Claude에 전달하지 않음). 이미지 및 문서 첨부 시 `.claude-uploads/`에 다운로드하여 프롬프트에 파일 경로 추가. 세션 활성 중 동시 메시지 거부. 위험 파일(.exe, .bat 등) 차단, 25MB 크기 제한
- **`src/bot/handlers/interaction.ts`** — 버튼 인터랙션(approve/deny/approve-all/stop/session-resume/session-delete/session-cancel) 및 StringSelectMenu(세션 선택 후 Resume/Delete/Cancel 버튼, 새 세션 만들기) 처리. 세션 선택 시 마지막 대화 미리보기 표시. AskUserQuestion 옵션 버튼(ask-opt), 직접 입력(ask-other), 다중 선택 셀렉트메뉴(ask-select) 처리
- **`src/claude/session-manager.ts`** — 채널별 활성 세션을 관리하는 싱글톤. Agent SDK의 `query()`와 `canUseTool` 콜백으로 승인 워크플로우 구현. requestId 기반 Map으로 pending approval 관리 (5분 타임아웃). AskUserQuestion 도구 감지 시 Discord 버튼/셀렉트메뉴 UI로 질문 표시, 사용자 답변을 `updatedInput.answers`에 주입하여 반환. 직접 입력 모드(pendingCustomInputs)로 자유 텍스트 답변도 지원. 다중 질문은 순차 처리. SDK session ID로 세션 재개 지원. 봇 재시작 시 DB에서 session_id 로드하여 자동 재개. 텍스트 출력 전 heartbeat(15초 간격)로 진행 상황 표시. 진행 중 메시지에 Stop 버튼으로 즉시 중지 가능. finally 블록에서 활성 세션 정리
- **`src/bot/commands/sessions.ts`** — `~/.claude/projects/`의 JSONL 세션 파일을 스캔하여 기존 세션 목록 표시. 빈 세션 필터링 (<512바이트, 사용자 메시지 없음). IDE 주입 태그 제거. 파일 mtime 기준 상대 시간 표시 (N분/시간/일 전). 현재 사용 중인 세션 ▶ 표시. "새 세션 만들기" 옵션 포함. 세션 선택 시 마지막 assistant 대화 미리보기. Discord StringSelectMenu로 세션 선택
- **`src/bot/commands/clear-sessions.ts`** — 등록된 프로젝트의 모든 JSONL 세션 파일 일괄 삭제
- **`src/claude/output-formatter.ts`** — Discord 2000자 제한에 맞춘 메시지 분할 (마크다운 코드 블록 펜스 보존). tool 승인 요청 및 결과 embed 생성. AskUserQuestion 질문 embed + 옵션 버튼/셀렉트메뉴 생성. Stop 버튼 팩토리. 결과 embed에 SHOW_COST 설정 반영
- **`src/db/database.ts`** — SQLite WAL 모드. data.db 자동 생성. 테이블 2개: `projects`(채널→프로젝트 경로 매핑, auto_approve 플래그), `sessions`(세션 상태 추적, SDK session_id 저장)
- **`src/security/guard.ts`** — 유저 화이트리스트(ALLOWED_USER_IDS), 인메모리 슬라이딩 윈도우 레이트리밋, 경로 순회(`..`) 차단
- **`src/utils/config.ts`** — Zod v4 스키마로 환경변수 검증, 싱글톤 패턴

### Tool 승인 로직 (`canUseTool`)

1. AskUserQuestion → Discord 질문 UI(버튼/셀렉트메뉴) 전송, 사용자 답변 수집 후 `updatedInput.answers`에 주입하여 allow 반환 (5분 타임아웃, 미응답 시 거부)
2. 읽기 전용 도구 (Read, Glob, Grep, WebSearch, WebFetch, TodoWrite) → 항상 자동 승인
3. 채널의 `auto_approve`가 활성화된 경우 → 자동 승인
4. 그 외 → Discord 버튼 embed 전송, 사용자 응답 대기 (5분 타임아웃, 미응답 시 거부)

### 세션 상태

- **🟢 online** — Claude가 작업 중
- **🟡 waiting** — tool use 승인 대기
- **⚪ idle** — 작업 완료, 다음 입력 대기
- **🔴 offline** — 세션 없음

### 멀티 PC 지원

PC별로 별도 Discord 봇을 생성하여 같은 길드에 초대. 각 봇은 서로 다른 채널에 프로젝트를 등록하여 독립 운영.

## 개발 원칙 (중요)

이 프로젝트는 **공개 오픈소스**이며, 기술적 배경이 없는 다수의 사용자가 사용한다. 모든 설계와 구현은 반드시 다음 원칙을 따를 것:

- **수동 조치 금지**: "사용자에게 이 명령어를 실행하라고 안내하세요"는 해결책이 아님. 수백 명의 사용자에게 개별 안내는 불가능. 문제가 발생하면 코드로 자동 해결되어야 함
- **자동 업데이트 무결성**: 트레이 앱의 업데이트 기능은 어떤 환경에서든 충돌 없이 동작해야 함. git 충돌, 빌드 실패 등 모든 케이스를 코드에서 처리할 것. 현재 `git fetch` + `git reset --hard`를 사용하여 충돌 불가능하게 구현됨
- **기존 사용자 호환성**: 새 업데이트가 이전 버전 사용자의 업데이트 경로를 막으면 안 됨. 이미 배포된 코드는 원격으로 변경할 수 없으므로, tracked 파일 변경(예: package-lock.json)이 업데이트 충돌을 유발하지 않도록 설계할 것
- **에러 시 사용자 안내**: 에러가 발생하면 원인과 해결 방법을 사용자에게 자동으로 보여줘야 함 (예: 로그인 만료 시 `claude login` 안내 메시지 자동 표시)

## TypeScript 컨벤션

- ESM 모듈 (`"type": "module"`), 로컬 import에 `.js` 확장자 사용
- strict 모드, `noUnusedLocals`와 `noUnusedParameters` 활성화
- Target: ES2022, moduleResolution: bundler
- Zod v4 사용 (v3과 API 다름에 주의)
- 경로 처리 시 `path.join()`, `path.resolve()` 사용 (Windows 호환)
- 파일명 추출 시 `split(/[\\/]/)` 사용 (macOS/Windows 경로 구분자 모두 지원)

## 환경 설정

`.env.example`을 `.env`로 복사 후 값 설정. 필수: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `ALLOWED_USER_IDS`, `BASE_PROJECT_DIR`. 선택: `RATE_LIMIT_PER_MINUTE` (기본값 10), `SHOW_COST` (기본값 true, Max plan 사용자는 false 권장), `SESSION_TURN_WARNING` (기본값 30, 세션 턴 수가 이 값의 배수에 도달하면 새 세션 시작을 권장하는 경고 표시, 0이면 비활성화). data.db는 첫 실행 시 자동 생성.
