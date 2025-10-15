# 자격증 AI 문제 생성기

GPT-4o-mini와 RAGAS를 활용한 자격증 시험 문제 생성 시스템

## 기능

- 📤 다양한 파일 형식 지원 (PDF, Word, Excel, PowerPoint, 이미지)
- 🤖 GPT-4o-mini를 사용한 고품질 문제 생성 (난이도: 중상)
- 📊 RAGAS를 통한 문제 품질 평가
- 💾 로컬 downloads 디렉터리에 파일 저장
- 🎯 3가지 문제 유형: 객관식, 참/거짓, 서술형

## 설치 및 실행

### WSL Ubuntu 22.04.5에서 실행하기

WSL Ubuntu에서 실행 시 다음 단계를 따르세요:

#### 1. 시스템 패키지 업데이트 및 필수 도구 설치

\`\`\`bash
sudo apt update
sudo apt install python3 python3-pip python3-venv nodejs npm -y
\`\`\`

#### 2. Python 백엔드 설정

\`\`\`bash
# Python 가상환경 생성
python3 -m venv exam-gen

# 가상환경 활성화 (WSL/Linux)
source exam-gen/bin/activate

# 의존성 설치
cd scripts
pip install -r requirements.txt
\`\`\`

#### 3. 환경 변수 설정

`.env` 파일을 생성하고 OpenAI API 키를 추가하세요:

\`\`\`bash
# 프로젝트 루트 디렉터리에서
nano .env
\`\`\`

\`\`\`env
OPENAI_API_KEY=your_openai_api_key_here
\`\`\`

#### 4. 백엔드 서버 실행

\`\`\`bash
cd scripts
python main.py
\`\`\`

서버가 http://localhost:8000 에서 실행됩니다.

#### 5. 프론트엔드 실행

새 터미널을 열고:

\`\`\`bash
# WSL에서 새 터미널 열기
npm install
npm run dev
\`\`\`

프론트엔드가 http://localhost:3000 에서 실행됩니다.

**WSL 팁:**
- WSL에서는 `/mnt/c/` 경로보다 `/home/username/` 경로에서 작업하는 것이 성능상 유리합니다
- Windows 브라우저에서 `http://localhost:3000` 접속 가능합니다
- 파일은 `scripts/downloads/` 디렉터리에 저장되며, Windows 탐색기에서 `\\wsl$\Ubuntu-22.04\home\username\project-path\scripts\downloads\` 경로로 접근할 수 있습니다

### Windows에서 실행하기

#### 1. Python 백엔드 설정

\`\`\`bash
# Python 가상환경 생성
python -m venv venv

# 가상환경 활성화
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# 의존성 설치
cd scripts
pip install -r requirements.txt
\`\`\`

#### 2. 환경 변수 설정

`.env` 파일을 생성하고 OpenAI API 키를 추가하세요:

\`\`\`env
OPENAI_API_KEY=your_openai_api_key_here
\`\`\`

#### 3. 백엔드 서버 실행

\`\`\`bash
cd scripts
python main.py
\`\`\`

서버가 http://localhost:8000 에서 실행됩니다.

#### 4. 프론트엔드 실행

새 터미널을 열고:

\`\`\`bash
npm install
npm run dev
\`\`\`

프론트엔드가 http://localhost:3000 에서 실행됩니다.

## 사용 방법

1. 학습 자료 파일을 업로드합니다
2. 원하는 문제 유형을 선택합니다 (객관식/참거짓/서술형)
3. "문제 생성하기" 버튼을 클릭합니다
4. GPT-4o-mini가 중상 난이도의 문제를 생성합니다
5. RAGAS가 생성된 문제의 품질을 평가합니다
6. 생성된 문제와 품질 점수를 확인합니다

## RAGAS 품질 평가 지표

- **충실도 (Faithfulness)**: 답변이 원본 자료에 기반하는가
- **관련성 (Answer Relevancy)**: 답변이 질문과 관련있는가
- **정밀도 (Context Precision)**: 컨텍스트가 정확한가
- **재현율 (Context Recall)**: 필요한 정보를 포함하는가

## 파일 저장 위치

업로드된 파일은 `scripts/downloads/` 디렉터리에 저장됩니다.

## 기술 스택

### 프론트엔드
- Next.js 15
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

### 백엔드
- Python 3.10+
- FastAPI
- OpenAI GPT-4o-mini
- RAGAS
- LangChain
