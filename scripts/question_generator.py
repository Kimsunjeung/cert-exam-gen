import os
from openai import OpenAI
import json

class QuestionGenerator:
    def __init__(self):
        # OpenAI API 키 설정 (환경변수에서 가져오기)
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model = "gpt-4o-mini"
    
    async def generate_questions(
        self,
        text: str,
        question_type: str,
        num_questions: int = 30,
        difficulty: str = "medium-high"
    ):
        """GPT-4o-mini를 사용하여 문제 생성 (배치 방식)"""
        
        batch_size = 10
        num_batches = (num_questions + batch_size - 1) // batch_size  # 올림 나눗셈
        all_questions = []
        
        for batch_num in range(num_batches):
            start_id = batch_num * batch_size + 1
            questions_in_batch = min(batch_size, num_questions - len(all_questions))
            
            print(f"배치 {batch_num + 1}/{num_batches}: {questions_in_batch}개 문제 생성 중...")
            
            batch_questions = await self._generate_batch(
                text, 
                question_type, 
                questions_in_batch, 
                difficulty,
                start_id
            )
            
            all_questions.extend(batch_questions)
            
            if len(all_questions) >= num_questions:
                break
        
        return all_questions[:num_questions]  # 정확히 요청된 개수만 반환
    
    async def _generate_batch(
        self,
        text: str,
        question_type: str,
        num_questions: int,
        difficulty: str,
        start_id: int
    ):
        """단일 배치 문제 생성"""
        
        # 난이도별 프롬프트 설정
        difficulty_prompts = {
            "medium-high": "중상 난이도로, 개념의 깊은 이해와 응용력을 요구하는 문제를 생성하세요. 단순 암기가 아닌 분석과 추론이 필요한 문제여야 합니다."
        }
        
        # 문제 유형별 프롬프트
        type_prompts = {
            "multiple-choice": """
객관식 문제를 생성하세요. 각 문제는:
- 명확한 질문
- 4개의 선택지 (A, B, C, D)
- 정답과 해설
형식으로 구성되어야 합니다.
""",
            "true-false": """
참/거짓 문제를 생성하세요. 각 문제는:
- 명확한 진술문
- 정답 (참 또는 거짓)
- 해설
형식으로 구성되어야 합니다.
""",
            "essay": """
서술형 문제를 생성하세요. 각 문제는:
- 구체적인 질문
- 모범 답안
- 채점 기준
형식으로 구성되어야 합니다.
"""
        }
        
        system_prompt = f"""당신은 자격증 시험 문제 출제 전문가입니다.
주어진 학습 자료를 바탕으로 {difficulty_prompts[difficulty]}
{type_prompts[question_type]}

반드시 JSON 형식으로 응답하세요."""

        user_prompt = f"""
다음 학습 자료를 바탕으로 정확히 {num_questions}개의 {question_type} 문제를 생성하세요.
문제 번호는 {start_id}부터 시작하세요.

중요: 반드시 {num_questions}개의 문제를 모두 생성해야 합니다.

학습 자료:
{text[:8000]}

JSON 형식 (정확히 {num_questions}개):
{{
    "questions": [
        {{
            "id": {start_id},
            "question": "질문 내용",
            "options": ["A", "B", "C", "D"],
            "answer": "정답",
            "explanation": "해설"
        }},
        ... (총 {num_questions}개)
    ]
}}
"""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
                max_tokens=4000,  # 토큰 제한 증가
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            questions = result.get("questions", [])
            
            # ID 재조정 (혹시 모델이 ID를 잘못 생성한 경우)
            for i, q in enumerate(questions):
                q["id"] = start_id + i
            
            return questions
            
        except Exception as e:
            print(f"배치 생성 오류: {e}")
            raise

    def format_question_for_display(self, question: dict, question_type: str):
        """프론트엔드 표시용 포맷"""
        formatted = {
            "id": question["id"],
            "question": question["question"],
            "answer": question["answer"],
            "explanation": question.get("explanation", ""),
            "showAnswer": False
        }
        
        if question_type == "multiple-choice" and "options" in question:
            formatted["options"] = question["options"]
        
        return formatted
