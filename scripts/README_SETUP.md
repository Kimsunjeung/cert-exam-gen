# 환경 설정 가이드

## 1. .env 파일 생성

scripts 디렉터리에 `.env` 파일을 생성하세요:

\`\`\`bash
cd scripts
cp ../.env.example .env
\`\`\`

## 2. OpenAI API 키 설정

`.env` 파일을 열고 실제 API 키를 입력하세요:

\`\`\`
OPENAI_API_KEY=sk-your-actual-api-key-here
\`\`\`

OpenAI API 키는 https://platform.openai.com/api-keys 에서 발급받을 수 있습니다.

## 3. 백엔드 실행

\`\`\`bash
python3 main.py
\`\`\`

서버가 http://localhost:8000 에서 실행됩니다.

## 문제 해결

### "The api_key client option must be set" 오류
- `.env` 파일이 scripts 디렉터리에 있는지 확인
- `.env` 파일에 `OPENAI_API_KEY=sk-...` 형식으로 키가 입력되어 있는지 확인
- API 키에 따옴표나 공백이 없는지 확인

### 환경 변수 확인
\`\`\`bash
cd scripts
python3 -c "from dotenv import load_dotenv; import os; load_dotenv(); print(os.getenv('OPENAI_API_KEY'))"
