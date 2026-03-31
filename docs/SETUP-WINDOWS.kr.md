# Windows 셋업 가이드

Windows에서 Claude Code Discord Bot을 설치하고 실행하는 전체 과정입니다.

> **[English version](SETUP-WINDOWS.md)** | **[macOS / Linux 셋업](../SETUP.md)**

---

## 0. 간편 설치 (권장)

```
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord
./install.bat
```

`install.bat`이 자동으로 처리하는 것들:
- Node.js 설치 (winget 또는 수동 다운로드)
- Claude Code CLI 설치
- npm 패키지 설치
- 프로젝트 빌드 (`npm run build`)
- 바탕화면 바로가기 생성
- 완료 후 봇 + 트레이 앱 자동 실행

설치 완료 후 **시스템 트레이 앱**이 자동으로 시작됩니다. `.env`가 설정되지 않은 경우 **설정** 창이 열려서 Discord 봇 정보를 입력할 수 있습니다.

> `better-sqlite3` 설치 실패 시 Visual Studio Build Tools가 필요합니다:
> ```powershell
> winget install Microsoft.VisualStudio.2022.BuildTools
> ```
> 설치 후 "Desktop development with C++" 워크로드를 선택하세요.

---

## 0-W. WSL 대안

Windows에서 Linux 환경을 선호하는 경우 WSL을 사용할 수 있습니다.

### WSL 설치

PowerShell을 **관리자 권한**으로 실행 후:

```powershell
wsl --install
```

설치 완료 후 재부팅 → Ubuntu가 자동 설치됩니다.
시작 메뉴에서 **Ubuntu**를 열면 리눅스 터미널이 실행됩니다.

### WSL 안에서 Node.js 설치

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x.x 확인
```

### WSL 안에서 Claude Code 설치

```bash
npm install -g @anthropic-ai/claude-code
claude   # 최초 로그인
```

### WSL 안에서 Git 설정

```bash
sudo apt-get install -y git
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### 주의사항

- WSL에서의 프로젝트 경로는 `/home/username/projects/...` 형태입니다
- Windows 파일시스템(`/mnt/c/...`)도 접근 가능하지만 성능이 떨어지므로, WSL 내부 경로 사용을 권장합니다
- VSCode 사용 시 **Remote - WSL** 확장 설치 후 WSL 안에서 `code .`으로 열 수 있습니다

> **세션 공유 주의:** VSCode를 Windows 네이티브로 사용하는 경우(대부분의 경우), 봇도 **Windows 네이티브**로 실행해야 합니다.
> WSL에서 봇을 실행하면 프로젝트 경로가 `/home/...`이 되어 VSCode의 `C:\Users\...` 경로와 달라지므로, VSCode에서 만든 Claude Code 세션을 Discord에서 이어갈 수 없습니다.

> WSL을 사용하는 경우 **[macOS / Linux 셋업 가이드](../SETUP.md)**를 참고하세요.

---

## 1. 수동 설치 (자동 설치 실패 시)

### Node.js

Node.js 20 이상이 필요합니다.

```
node -v   # v20.x.x 이상이면 OK
```

설치되어 있지 않다면: `winget install OpenJS.NodeJS.LTS` 또는 [nodejs.org](https://nodejs.org)에서 다운로드

### Claude Code

```
npm install -g @anthropic-ai/claude-code
claude   # 최초 로그인 (브라우저 열림)
```

> **중요:** 봇을 실행하기 전에 반드시 터미널에서 `claude`를 실행하여 로그인하세요.
> 로그인 상태 확인: `claude` 실행 시 바로 대화가 시작되면 로그인된 상태입니다.

> Claude Code는 Anthropic API 키가 아닌 **OAuth 인증**으로 동작합니다.
> 별도의 `ANTHROPIC_API_KEY` 환경변수는 필요 없습니다.

### 클론 및 빌드

```
git clone https://github.com/chadingTV/claudecode-discord.git
cd claudecode-discord
npm install
npm run build
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
- (가장 하단에 generated URL 이 생기고 오른쪽끝에 복사 버튼)
4. 초대할 서버 선택 → **Authorize**

---

## 3. Discord 서버 ID 확인

1. Discord 앱 → **사용자 설정** (톱니바퀴)
2. **앱 설정 > 고급** → **개발자 모드** 활성화
3. 서버 이름 우클릭 → **"서버 ID 복사"**
   - 이 값이 `DISCORD_GUILD_ID`

   ![서버 ID 복사](copy-server-id-kr.png)

## 4. 사용자 ID 확인

1. 개발자 모드가 활성화된 상태에서
2. 자신의 프로필 클릭 → **"사용자 ID 복사"**
   - 이 값이 `ALLOWED_USER_IDS`
   - 여러 명이면 쉼표로 구분: `123456789,987654321`

   ![사용자 ID 복사](copy-user-id-kr.png)

---

## 5. 설정

### 방법 A: GUI 설정 (권장)

`win-start.bat`을 실행하거나 **바탕화면 바로가기**를 더블클릭하세요. 트레이 앱이 실행되고, `.env`가 없으면 자동으로 **설정** 창이 열립니다.

<p align="center">
  <img src="windows-settings.png" alt="Windows 설정 다이얼로그" width="450">
</p>

항목을 채워주세요:
- **Discord Bot Token** — 2-2단계에서 복사한 토큰
- **Discord Guild ID** — 3단계에서 복사한 서버 ID
- **Allowed User IDs** — 4단계에서 복사한 사용자 ID
- **Base Project Directory** — 프로젝트들이 있는 상위 폴더 (Browse 버튼 사용)
- **Rate Limit Per Minute** — 기본 10
- **Show Cost** — `true` 또는 `false` (Max 플랜 사용자: `false` 권장)

**Save** 클릭. 봇이 자동으로 시작됩니다.

### 방법 B: .env 파일 직접 편집

```
copy .env.example .env
notepad .env
```

`.env` 편집:

```env
DISCORD_BOT_TOKEN=여기에_봇_토큰_붙여넣기
DISCORD_GUILD_ID=여기에_서버_ID_붙여넣기
ALLOWED_USER_IDS=여기에_사용자_ID_붙여넣기
BASE_PROJECT_DIR=C:\Users\yourname\projects
RATE_LIMIT_PER_MINUTE=10
SHOW_COST=true
```

| 변수 | 설명 | 예시 |
|---|---|---|
| `DISCORD_BOT_TOKEN` | 2-2단계에서 복사한 봇 토큰 | `MTQ3MDc...` |
| `DISCORD_GUILD_ID` | 3단계에서 복사한 서버 ID | `1470730378955456578` |
| `ALLOWED_USER_IDS` | 4단계에서 복사한 사용자 ID | `942037337519575091` |
| `BASE_PROJECT_DIR` | 프로젝트들이 있는 상위 디렉토리 | `C:\Users\you\projects` |
| `RATE_LIMIT_PER_MINUTE` | 분당 메시지 제한 (기본 10) | `10` |
| `SHOW_COST` | 결과에 예상 API 비용 표시 (기본 true) | `false` |

---

## 6. 실행

### 바탕화면 바로가기 (권장)

바탕화면의 **"Claude Discord Bot"**을 더블클릭하세요. 트레이 앱과 컨트롤 패널이 자동으로 열립니다.

### 명령줄

```
win-start.bat          :: 시작 (백그라운드 + 트레이 앱 + 컨트롤 패널)
win-start.bat --stop   :: 중지
win-start.bat --status :: 상태 확인
win-start.bat --fg     :: 포그라운드 모드 (디버깅용)
```

---

## 7. 시스템 트레이 앱

봇은 **시스템 트레이 아이콘** (작업표시줄 오른쪽 하단)과 함께 백그라운드에서 실행됩니다.

### 트레이 아이콘 색상

| 색상 | 상태 |
|------|------|
| 🟢 초록 | 봇 실행 중 |
| 🔴 빨강 | 봇 중지됨 |
| 🟠 주황 | 설정 필요 (.env 미설정) |

### 왼쪽 클릭: 컨트롤 패널

트레이 아이콘을 클릭하면 **컨트롤 패널** 창이 열립니다:

- **시작 / 중지 / 재시작** 봇 제어
- **설정** — GUI 설정 편집기 열기
- **로그 보기** — 메모장으로 bot.log 열기
- **폴더 열기** — 탐색기로 봇 디렉토리 열기
- **시작 시 자동 실행** — Windows 로그인 시 자동 시작 토글 (레지스트리)
- **업데이트** — 새 버전 있으면 원클릭 업데이트
- **EN / KR** — 언어 전환 (영어 / 한국어, 설정 기억됨)

### 오른쪽 클릭: 빠른 메뉴

트레이 아이콘을 오른쪽 클릭하면 동일한 기능의 빠른 메뉴가 표시됩니다.

### 자동 시작

컨트롤 패널이나 오른쪽 클릭 메뉴에서 **"시작 시 자동 실행"**을 체크하세요. Windows 로그인 시 트레이 앱이 자동으로 실행됩니다 (Windows 레지스트리 `HKCU\Run` 사용).

### 자동 업데이트

업데이트가 있으면 컨트롤 패널에 **"업데이트 가능"** 버튼이 표시됩니다. 클릭하면:

1. 봇 중지 (실행 중인 경우)
2. git에서 최신 코드 다운로드
3. 프로젝트 재빌드
4. 트레이 앱(.exe) 재컴파일
5. 모든 것 자동으로 재시작

---

## 8. 사용법

### 채널에 프로젝트 등록

Discord에서 원하는 채널로 이동 후:
```
/register path:my-project-folder
```

**경로 입력 방법:**

| 입력 방식 | 입력 예시 | 실제 경로 (`BASE_PROJECT_DIR=C:\Users\you\projects` 기준) |
|---|---|---|
| 폴더 이름만 | `my-app` | `C:\Users\you\projects\my-app` |
| 하위 경로 | `work\my-app` | `C:\Users\you\projects\work\my-app` |
| 절대 경로 | `C:\Users\you\other\project` | `C:\Users\you\other\project` (그대로 사용) |

### Claude에게 메시지 보내기

등록된 채널에서 일반 메시지를 보내면 Claude Code가 응답합니다.
이미지, 문서, 코드 파일 등을 첨부하면 Claude가 읽고 분석할 수 있습니다.

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

## 9. 여러 PC에서 사용하기

각 PC마다 별도의 Discord 봇을 만들어서 같은 Discord 서버에 초대하면 됩니다.

1. PC별로 Discord Developer Portal에서 **새 봇 생성** (2단계 반복)
2. 같은 Discord 서버에 각 봇 초대
3. 각 PC에서 이 레포를 클론하고 해당 PC의 봇 토큰으로 설정
4. 각 봇은 서로 다른 채널에 `/register`로 프로젝트 등록

---

## 10. 보안

- Discord 서버는 기본적으로 **비공개**입니다 (초대 링크 없이는 접근 불가)
- `ALLOWED_USER_IDS`에 등록된 사용자만 봇과 대화할 수 있습니다
- 봇 토큰은 절대 외부에 노출하지 마세요. 노출된 경우 Discord Developer Portal에서 즉시 **Reset Token**
- 파일 첨부: 실행 파일(.exe, .bat 등) 차단, 25MB 크기 제한

---

## 11. 트러블슈팅

### 봇이 메시지에 반응하지 않음
- MESSAGE CONTENT INTENT가 활성화되어 있는지 확인 (2-2단계)
- `ALLOWED_USER_IDS`에 본인 ID가 포함되어 있는지 확인

### 트레이 앱이 안 뜸
- `tray\ClaudeBotTray.exe` 파일이 있는지 확인. 없으면 삭제 후 `win-start.bat` 다시 실행하면 자동 컴파일
- .NET Framework 필요 (최신 Windows에 기본 포함)

### "Unknown interaction" 에러
- 봇이 3초 내에 응답하지 못한 경우 발생 → 보통 자동으로 해결됨

### 슬래시 명령어가 안 보임
- 봇을 서버에 초대할 때 `applications.commands` 스코프를 체크했는지 확인
- 봇 재시작 후 최대 1시간 소요될 수 있음 (Discord 캐시)

### Claude Code 관련
- `claude --version`으로 설치 확인
- `claude`를 실행해서 로그인 상태 확인
- 로그인이 안 되어 있으면 `claude`를 실행하여 재로그인
