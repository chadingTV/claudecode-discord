# macOS / Linux 셋업 가이드

macOS와 Linux에서 Claude Code Discord Bot을 설치하고 실행하는 전체 과정입니다.

> **[English version](../SETUP.md)** | **[Windows 셋업](SETUP-WINDOWS.kr.md)**

---

## 0. 자동 설치 (권장)

클론 후 설치 스크립트를 실행하면 Node.js, Claude Code CLI, npm 패키지를 자동으로 확인하고 설치합니다.

```bash
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord
./install.sh
```

스크립트가 의존성 설치와 빌드를 자동으로 처리합니다. **macOS**에서는 Xcode Command Line Tools 설치(Swift 메뉴바 앱에 필요)와 Xcode 라이센스 동의도 자동 진행됩니다 — 비밀번호 입력이 요청될 수 있습니다.

자동 설치가 안 되는 경우 아래 수동 설치 과정을 참고하세요.

---

## 0-M. 수동 설치 - 사전 준비

### Node.js 설치

Node.js 20 이상이 필요합니다.

```bash
node -v   # v20.x.x 이상이면 OK
```

설치되어 있지 않다면:

- **macOS**: `brew install node` 또는 [nodejs.org](https://nodejs.org)에서 다운로드
- **Linux**:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```

### Claude Code 설치

이 봇은 **Claude Code CLI**가 설치되어 있고 로그인된 상태여야 합니다.

```bash
claude --version   # 설치 확인
```

설치되어 있지 않다면:

```bash
npm install -g @anthropic-ai/claude-code
```

설치 후 최초 1회 로그인:

```bash
claude
# 브라우저가 열리면서 Anthropic 계정 로그인 진행
# 로그인 완료 후 터미널에서 사용 가능
```

> **중요: 봇을 실행하기 전에 반드시 터미널에서 `claude` 명령어를 한 번 실행하여 로그인하세요.**
> 로그인하지 않은 상태에서 봇을 실행하면 Claude Code 세션이 생성되지 않습니다.
> 로그인 상태 확인: `claude` 실행 시 바로 대화가 시작되면 로그인된 상태입니다.

> Claude Code는 Anthropic API 키가 아닌 **OAuth 인증**으로 동작합니다.
> 별도의 `ANTHROPIC_API_KEY` 환경변수는 필요 없습니다.

---

## 1. 레포지토리 클론 및 설치

```bash
git clone git@github.com:chadingTV/claudecode-discord.git
cd claudecode-discord
npm install
```

> HTTPS로 클론하는 경우:
> ```bash
> git clone https://github.com/chadingTV/claudecode-discord.git
> ```

### 빌드 확인 (선택사항)

```bash
npm run build   # 타입 에러 없이 빌드되는지 확인
```

---

## 2. Discord 봇 생성

### 2-1. Discord Application 생성

1. https://discord.com/developers/applications 접속
2. **"New Application"** 클릭
3. 이름 입력 (예: "My Claude Code") → **Create**

### 2-2. Bot 설정

1. 왼쪽 메뉴 **"Bot"** 클릭
2. **"Reset Token"** 클릭 → 토큰 복사 (이 토큰은 한 번만 표시됨!)
   - 이 값이 `DISCORD_BOT_TOKEN`
3. 아래로 스크롤하여 **Privileged Gateway Intents** 섹션:
   - **MESSAGE CONTENT INTENT** → 활성화 (필수!)
   - Save Changes

   ![Message Content Intent](message-content-intent.png)

### 2-3. 봇을 서버에 초대

1. 왼쪽 메뉴 **"OAuth2"** 클릭
2. **"OAuth2 URL Generator"** 섹션에서:
   - **SCOPES**: `bot`, `applications.commands` 체크

   <p align="center">
     <img src="discord-scopes.png" alt="Discord OAuth2 Scopes" width="500">
   </p>

   - **BOT PERMISSIONS**: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands` 체크

   <p align="center">
     <img src="discord-bot-permissions.png" alt="Discord Bot Permissions" width="500">
   </p>

3. 생성된 URL을 복사하여 브라우저에 붙여넣기
  - (가장 하단에 generated URL 이 생기고 오른쪽 끝에 복사 버튼)

4. 초대할 서버 선택 → **Authorize**

---

## 3. Discord 서버 ID 확인

1. Discord 앱 (데스크톱/모바일) → **사용자 설정** (톱니바퀴)
2. **앱 설정 > 고급** → **개발자 모드** 활성화
3. 서버 이름 우클릭(데스크톱) 또는 길게 누르기(모바일) → **"서버 ID 복사"**
   - 이 값이 `DISCORD_GUILD_ID`

   ![서버 ID 복사](copy-server-id-kr.png)

## 4. 사용자 ID 확인

1. 개발자 모드가 활성화된 상태에서
2. 자신의 프로필 클릭 → **"사용자 ID 복사"**
   - 이 값이 `ALLOWED_USER_IDS`
   - 여러 명이면 쉼표로 구분: `123456789,987654321`

   ![사용자 ID 복사](copy-user-id-kr.png)

---

## 5. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어서 값을 입력:

```env
DISCORD_BOT_TOKEN=여기에_봇_토큰_붙여넣기
DISCORD_GUILD_ID=여기에_서버_ID_붙여넣기
ALLOWED_USER_IDS=여기에_사용자_ID_붙여넣기
BASE_PROJECT_DIR=/Users/yourname/projects
RATE_LIMIT_PER_MINUTE=10
SHOW_COST=true
```

| 변수 | 설명 | 예시 |
|---|---|---|
| `DISCORD_BOT_TOKEN` | 2-2단계에서 복사한 봇 토큰 | `MTQ3MDc...` |
| `DISCORD_GUILD_ID` | 3단계에서 복사한 서버 ID | `1470730378955456578` |
| `ALLOWED_USER_IDS` | 4단계에서 복사한 사용자 ID | `942037337519575091` |
| `BASE_PROJECT_DIR` | 프로젝트들이 있는 상위 디렉토리 | `/Users/you/projects` |
| `RATE_LIMIT_PER_MINUTE` | 분당 메시지 제한 (기본 10) | `10` |
| `SHOW_COST` | 결과에 예상 API 비용 표시 (기본 true) | `false` |

`BASE_PROJECT_DIR`은 `/register` 명령에서 폴더 이름만 입력할 때 기준 경로가 됩니다.
예: `BASE_PROJECT_DIR=/Users/you/projects`이면 `/register my-app` → `/Users/you/projects/my-app`

---

## 6. 실행

### macOS (백그라운드 + 메뉴바)

```bash
./mac-start.sh          # 시작 (백그라운드 + 메뉴바 아이콘)
./mac-start.sh --stop   # 중지
./mac-start.sh --status # 상태 확인
./mac-start.sh --fg     # 포그라운드 모드 (디버깅용)
```

<p align="center">
  <img src="mac-tray.png" alt="macOS 컨트롤 패널" width="400">
</p>

- **컨트롤 패널 GUI**: 메뉴바 아이콘 왼쪽 클릭으로 컨트롤 패널 열기 (오른쪽 클릭은 드롭다운 메뉴)
- **EN / KR 언어 전환** (설정 영구 저장)
- 첫 실행 시 컨트롤 패널 자동 표시; `.env` 미설정 시 설정 다이얼로그도 함께 표시
- 메뉴바 아이콘: 🟢 실행 중 / 🔴 중지됨 / ⚙️ 설정 필요
- **Claude Code 사용량 대시보드**: 세션(5시간) / 주간(7일) / 주간 Sonnet 사용량을 색상별 프로그레스 바로 표시 — 5분마다 자동 갱신, `~/.claude/.usage-cache.json`에 캐시, 클릭 시 [claude.ai/settings/usage](https://claude.ai/settings/usage) 열기
- GUI 설정 다이얼로그 — 수동 `.env` 편집 불필요:

<p align="center">
  <img src="mac-settings.png" alt="macOS 설정 다이얼로그" width="400">
</p>

- 원클릭 자동 업데이트: 코드 풀, 봇 + 메뉴바 앱 재빌드
- 크래시 시 자동 재시작, 부팅 시 자동 실행 (launchd)

### Linux (백그라운드 + 시스템 트레이 + 컨트롤 패널)

```bash
./linux-start.sh          # 시작 (systemd + 트레이 아이콘)
./linux-start.sh --stop   # 중지
./linux-start.sh --status # 상태 확인
./linux-start.sh --fg     # 포그라운드 모드 (디버깅용)
```

- **EN / KR 언어 전환** (설정 영구 저장)
- **컨트롤 패널 GUI**: 트레이 아이콘 왼쪽 클릭으로 GTK3 컨트롤 패널 열기 (오른쪽 클릭은 드롭다운 메뉴)
- 시스템 트레이: 초록(실행 중) / 빨강(중지됨) / 주황(설정 필요)
- **Claude Code 사용량 대시보드**: 세션(5시간) / 주간(7일) / 주간 Sonnet 사용량을 색상별 프로그레스 바로 표시 — 5분마다 자동 갱신, 클릭 시 사용량 페이지 열기
- GUI 설정 다이얼로그 (GTK3) — 수동 `.env` 편집 불필요 (폴더 선택기 포함)
- 크래시 시 자동 재시작, 부팅 시 자동 실행 (systemd)
- 트레이는 `pip3 install pystray Pillow` 필요 (첫 실행 시 자동 설치)
- GUI 없는 서버에서도 동작 (트레이만 생략)

### 개발 모드

```bash
npm run dev          # 개발 실행 (tsx로 hot reload)
npm run build        # 프로덕션 빌드
npm start            # 빌드된 파일 실행
```

---

## 7. 사용법

### 채널에 프로젝트 등록

Discord에서 원하는 채널로 이동 후:
```
/register path:my-project-folder
```

**경로 입력 방법:**

| 입력 방식 | 입력 예시 | 실제 경로 (`BASE_PROJECT_DIR=/Users/you/projects` 기준) |
|---|---|---|
| 폴더 이름만 | `my-app` | `/Users/you/projects/my-app` |
| 하위 경로 | `work/my-app` | `/Users/you/projects/work/my-app` |
| 절대 경로 | `/Users/you/other/project` | `/Users/you/other/project` (그대로 사용) |

> **팁:** 터미널에서 프로젝트 디렉토리로 이동 후 `pwd` 명령어를 실행하면 절대 경로를 확인할 수 있습니다.

### Claude에게 메시지 보내기

등록된 채널에서 일반 메시지를 보내면 Claude Code가 응답합니다.
이미지, 문서, 코드 파일 등을 첨부하면 Claude가 읽고 분석할 수 있습니다.

### 진행 중 제어

- 작업 진행 중 메시지에 표시되는 **⏹️ Stop** 버튼으로 즉시 중지
- 이전 작업 진행 중 새 메시지를 보내면 "이전 작업이 진행 중입니다" 안내
- `/stop` 슬래시 명령어로도 중지 가능

### 도구 승인

Claude가 파일 수정/생성/명령 실행 등을 요청하면 버튼이 표시됩니다:
- **Approve** — 이번 한 번만 승인
- **Deny** — 거부
- **Auto-approve All** — 이 채널에서 앞으로 자동 승인

### 세션 관리

- `/sessions` — 기존 세션 목록에서 **재개(Resume)** 또는 **삭제(Delete)** 선택
- `/clear-sessions` — 해당 프로젝트의 모든 세션 파일 일괄 삭제

### 슬래시 명령어

| 명령어 | 설명 |
|---|---|
| `/register path:<폴더명>` | 현재 채널에 프로젝트 등록 |
| `/unregister` | 프로젝트 등록 해제 |
| `/status` | 전체 프로젝트/세션 상태 확인 |
| `/stop` | 현재 채널의 Claude 세션 중지 |
| `/auto-approve mode:on\|off` | 자동 승인 토글 |
| `/sessions` | 기존 세션 목록 조회, 재개 또는 삭제 |
| `/clear-sessions` | 해당 프로젝트의 모든 세션 일괄 삭제 |

---

## 8. 여러 PC에서 사용하기

각 PC마다 별도의 Discord 봇을 만들어서 같은 Discord 서버(길드)에 초대하면 됩니다.

1. PC별로 Discord Developer Portal에서 **새 봇 생성** (2단계 반복)
2. 같은 Discord 서버에 각 봇 초대
3. 각 PC에서 이 레포를 클론하고 `.env`에 해당 PC의 봇 토큰 입력
4. 각 봇은 서로 다른 채널에 `/register`로 프로젝트 등록

같은 길드에 여러 봇이 있어도 슬래시 명령어 실행 시 봇 이름이 표시되므로 구분 가능합니다.

---

## 9. 보안

- Discord 서버는 기본적으로 **비공개**입니다 (초대 링크 없이는 접근 불가)
- `ALLOWED_USER_IDS`에 등록된 사용자만 봇과 대화할 수 있습니다
- 봇 토큰은 절대 외부에 노출하지 마세요. 노출된 경우 Discord Developer Portal에서 즉시 **Reset Token**
- 파일 첨부: 실행 파일(.exe, .bat 등) 차단, 25MB 크기 제한

---

## 10. 트러블슈팅

### 봇이 메시지에 반응하지 않음
- MESSAGE CONTENT INTENT가 활성화되어 있는지 확인 (2-2단계)
- `ALLOWED_USER_IDS`에 본인 ID가 포함되어 있는지 확인

### "Unknown interaction" 에러
- 봇이 3초 내에 응답하지 못한 경우 발생 → 보통 자동으로 해결됨

### 슬래시 명령어가 안 보임
- 봇을 서버에 초대할 때 `applications.commands` 스코프를 체크했는지 확인
- 봇 재시작 후 최대 1시간 소요될 수 있음 (Discord 캐시)

### 세션 이어하기
- 봇을 재시작해도 이전 세션을 이어갈 수 있습니다 (session ID가 DB에 저장됨)
- `/stop` 후에도 세션 기록은 유지됩니다 (다음 메시지 시 자동 재개)
- `/sessions`로 이전 세션 목록을 보고 재개 또는 삭제할 수 있습니다
- `/clear-sessions`로 모든 세션을 일괄 삭제할 수 있습니다
- `/unregister`를 하면 DB의 세션 매핑이 삭제됩니다

### 수동 업데이트
트레이 업데이트 버튼이 작동하지 않을 경우, 봇 폴더에서 터미널을 열고 아래 명령어를 실행하세요:
```bash
git fetch origin main --tags && git reset --hard origin/main && npm install && npm rebuild better-sqlite3 && npm run build
```
이후 봇을 재시작하세요. 이 작업은 한 번만 하면 되며, 이후 트레이 업데이트가 정상 작동합니다.

### Claude Code 관련
- `claude --version`으로 설치 확인
- `claude`를 실행해서 로그인 상태 확인
- 로그인이 안 되어 있으면 `claude`를 실행하여 재로그인
