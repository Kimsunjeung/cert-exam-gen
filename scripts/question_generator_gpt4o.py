import os
from openai import OpenAI
import json
import re
from typing import List, Dict, Tuple

class QuestionGenerator:
    def __init__(self):
        # OpenAI API 키 설정 (환경변수에서 가져오기)
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model = "gpt-4o-mini"
        
        # 확장된 문제 유형별 패턴 정의
        self.question_patterns = {
            "multiple_choice": [
                r"다음 중.*옳은 것은\?",
                r"[1-5]번.*정답은\?", 
                r"①.*②.*③.*④",
                r"\(1\).*\(2\).*\(3\).*\(4\)",
                r"다음 중.*틀린 것은\?",
                r"요소.*중.*다음.*관계.*것은\?"
            ],
            "tree_analysis": [
                r"트리.*구조.*나타낸다",
                r"Fan-In.*Fan-Out.*얼마인가",
                r"그래프.*구조.*분석",
                r"노드.*관계.*분석",
                r"트리.*Fan-In.*Fan-Out"
            ],
            "code_execution": [
                r"Java.*프로그램.*실행.*때.*결과는",
                r"다음.*코드.*실행.*결과",
                r"프로그램.*실행.*출력",
                r"public.*class.*main.*결과",
                r"코드.*실행.*결과.*얼마인가"
            ],
            "algorithm_analysis": [
                r"알고리즘.*복잡도.*분석",
                r"시간복잡도.*공간복잡도",
                r"Big-O.*표기법",
                r"성능.*분석"
            ],
            "data_structure": [
                r"자료구조.*특징",
                r"스택.*큐.*트리.*그래프",
                r"배열.*리스트.*분석"
            ],
            "fill_blank": [
                r"다음 빈 칸에.*알맞은.*것은\?",
                r"빈칸에.*들어갈.*말은\?",
                r"\(\s*\)\s*에.*알맞은",
                r"______에.*적절한"
            ],
            "short_answer": [
                r"다음을.*간단히.*서술하시오",
                r".*을\(를\).*쓰시오",
                r".*답하시오\.",
                r".*단답.*서술"
            ],
            "essay": [
                r"다음을.*자세히.*설명하시오",
                r".*논술하시오",
                r".*서술하시오\.",
                r".*기술하시오\."
            ],
            "calculation": [
                r"다음을.*계산하시오",
                r".*값을.*구하시오",
                r".*계산.*과정.*쓰시오",
                r"\d+.*\+.*\d+.*=.*\?"
            ],
            "sequence": [
                r"다음.*순서.*배열",
                r"올바른.*순서는\?",
                r"가.*나.*다.*라.*순서"
            ],
            "diagram_matching": [
                r"다음.*도식.*그림.*연결",
                r"플로차트.*프로세스.*연결",
                r"다이어그램.*흐름.*연결",
                r"\(가\).*\(나\).*\(다\).*연결",
                r"과정을.*표현한.*것.*연결",
                r"인스펙션.*과정.*표현.*것"
            ],
            "flowchart_analysis": [
                r"다음.*흐름도.*분석",
                r"플로차트.*해석",
                r"프로세스.*다이어그램.*분석",
                r"순서도.*단계.*분석"
            ],
            "concept_definition": [
                r"개발.*영역.*결정하는.*요소",
                r"소프트웨어.*개발.*영역",
                r"시스템.*구성요소.*정의",
                r".*정의.*개념.*설명"
            ],
            "matching": [
                r"다음을.*연결하시오",
                r".*과.*를.*짝지으시오",
                r"가.*와.*나.*를.*연결",
                r"\(가\).*-.*ㄱ",
                r"\(나\).*-.*ㄴ"
            ],
            "case_analysis": [
                r"다음.*사례.*분석",
                r"상황.*에서.*해결방안",
                r"문제상황.*대처방안"
            ]
        }
        
        # Few-shot 예시 템플릿
        self.few_shot_examples = {
            "tree_analysis": {
                "question": "다음 어떤 프로그램 구조를 나타낸다. 모듈 F에서의 Fan-In과 Fan-Out의 수는 얼마인가?",
                "options": ["① Fan-In : 1, Fan-Out : 2", "② Fan-In : 2, Fan-Out : 1", "③ Fan-In : 2, Fan-Out : 3", "④ Fan-In : 3, Fan-Out : 2"],
                "answer": "①",
                "explanation": "Fan-In은 모듈로 들어오는 연결의 수, Fan-Out은 모듈에서 나가는 연결의 수입니다."
            },
            "code_execution": {
                "question": "다음 Java 프로그램이 실행되었을 때의 결과는?\n\npublic class Test {\n    public static void main(String[] args) {\n        int x = 7, y = 0;\n        while(x-- > 0) {\n            if (x%3 == 0) continue;\n            y++;\n        }\n        System.out.print(y);\n    }\n}",
                "options": ["① 0", "② 4", "③ 5", "④ 7"],
                "answer": "②",
                "explanation": "반복문을 통해 조건에 따라 y가 증가하여 최종 결과는 4입니다."
            },
            "multiple_choice": {
                "question": "소프트웨어 개발에서 중요한 개념은?",
                "options": ["① 기능", "② 성능", "③ 인터페이스", "④ 모든 것"],
                "answer": "④",
                "explanation": "소프트웨어 개발에서는 모든 요소가 중요합니다."
            }
        }
    
    # 기존 인터페이스와 완전히 호환되는 generate_questions 메소드
    async def generate_questions(
        self,
        text: str,
        question_type: str,
        num_questions: int = 30,
        difficulty: str = "medium-high"
    ):
        """GPT-4o-mini를 사용하여 문제 생성 (배치 방식)"""
        
        # question_type이 'mixed'이거나 새로운 유형들을 지원하도록 확장
        if question_type == "mixed" or question_type not in ["multiple-choice", "true-false", "essay"]:
            # 새로운 방식: 혼합 문제 생성
            return await self.generate_mixed_questions(text, num_questions, difficulty)
        
        # 기존 방식: 단일 유형 문제 생성 (하위 호환성)
        batch_size = 10
        num_batches = (num_questions + batch_size - 1) // batch_size
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
        
        return all_questions[:num_questions]
    
    async def _generate_batch(
        self,
        text: str,
        question_type: str,
        num_questions: int,
        difficulty: str,
        start_id: int
    ):
        """단일 배치 문제 생성 (기존 방식 유지)"""
        
        # 난이도별 프롬프트 설정
        difficulty_prompts = {
            "medium-high": "중상 난이도로, 개념의 깊은 이해와 응용력을 요구하는 문제를 생성하세요."
        }
        
        # 문제 유형별 프롬프트
        type_prompts = {
            "multiple-choice": """
객관식 문제를 생성하세요. 각 문제는:
- 명확한 질문
- 4개의 선택지 (①, ②, ③, ④)
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
주어진 학습 자료를 바탕으로 {difficulty_prompts.get(difficulty, "적절한 난이도의")} 문제를 생성하세요.

{type_prompts.get(question_type, type_prompts['multiple-choice'])}

반드시 JSON 형식으로 응답하세요."""

        user_prompt = f"""
다음 학습 자료를 바탕으로 정확히 {num_questions}개의 {question_type} 문제를 생성하세요.
문제 번호는 {start_id}부터 시작하세요.

학습 자료:
{text[:8000]}

JSON 형식 (정확히 {num_questions}개):
{{
    "questions": [
        {{
            "id": {start_id},
            "question": "질문 내용",
            "options": ["①", "②", "③", "④"],
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
                max_tokens=4000,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            questions = result.get("questions", [])
            
            # ID 재조정
            for i, q in enumerate(questions):
                q["id"] = start_id + i
            
            return questions
            
        except Exception as e:
            print(f"배치 생성 오류: {e}")
            return []

    # 새로운 고급 기능들
    def analyze_question_types(self, text: str) -> Dict[str, float]:
        """PDF 텍스트에서 문제 유형을 분석하여 비율 반환"""
        type_counts = {qtype: 0 for qtype in self.question_patterns.keys()}
        total_matches = 0
        
        for question_type, patterns in self.question_patterns.items():
            for pattern in patterns:
                matches = len(re.findall(pattern, text, re.IGNORECASE))
                type_counts[question_type] += matches
                total_matches += matches
        
        # 특정 키워드 가중치 조정
        special_keywords = {
            "tree_analysis": ["트리", "Fan-In", "Fan-Out", "노드", "그래프"],
            "code_execution": ["Java", "public", "class", "main", "코드", "실행", "결과"],
            "algorithm_analysis": ["알고리즘", "복잡도", "Big-O", "시간복잡도"],
            "data_structure": ["스택", "큐", "배열", "리스트", "자료구조"],
            "diagram_matching": ["그림", "도식", "차트", "흐름도", "플로차트", "다이어그램"]
        }
        
        for qtype, keywords in special_keywords.items():
            for keyword in keywords:
                if keyword in text:
                    type_counts[qtype] += 2
                    total_matches += 2
        
        if total_matches == 0:
            return {"multiple_choice": 0.8, "tree_analysis": 0.1, "code_execution": 0.1}
        
        type_ratios = {qtype: count/total_matches for qtype, count in type_counts.items()}
        
        # 최소 3% 이상은 각 유형이 포함되도록 조정
        adjusted_ratios = {}
        for qtype, ratio in type_ratios.items():
            adjusted_ratios[qtype] = max(ratio, 0.03)
        
        # 총합이 1이 되도록 정규화
        total_ratio = sum(adjusted_ratios.values())
        if total_ratio > 0:
            for qtype in adjusted_ratios:
                adjusted_ratios[qtype] = adjusted_ratios[qtype] / total_ratio
            
        return adjusted_ratios
    
    def distribute_questions(self, num_questions: int, type_ratios: Dict[str, float]) -> Dict[str, int]:
        """문제 개수를 유형별로 분배"""
        distribution = {}
        remaining_questions = num_questions
        
        sorted_types = sorted(type_ratios.items(), key=lambda x: x[1], reverse=True)
        
        for i, (qtype, ratio) in enumerate(sorted_types):
            if i == len(sorted_types) - 1:
                distribution[qtype] = remaining_questions
            else:
                count = max(1, int(num_questions * ratio))
                distribution[qtype] = min(count, remaining_questions - (len(sorted_types) - i - 1))
                remaining_questions -= distribution[qtype]
        
        distribution = {k: v for k, v in distribution.items() if v > 0}
        return distribution
    
    async def generate_mixed_questions(
        self,
        text: str,
        num_questions: int = 30,
        difficulty: str = "medium-high",
        custom_distribution: Dict[str, int] = None
    ) -> List[Dict]:
        """다양한 유형의 문제를 혼합하여 생성"""
        
        if custom_distribution:
            question_distribution = custom_distribution
        else:
            type_ratios = self.analyze_question_types(text)
            question_distribution = self.distribute_questions(num_questions, type_ratios)
        
        print(f"문제 유형별 분배: {question_distribution}")
        
        all_questions = []
        current_id = 1
        
        for question_type, count in question_distribution.items():
            if count > 0:
                print(f"{question_type} 유형 {count}개 생성 중...")
                questions = await self._generate_typed_questions(
                    text, question_type, count, difficulty, current_id
                )
                all_questions.extend(questions)
                current_id += len(questions)
        
        # 문제 순서 섞기
        import random
        random.shuffle(all_questions)
        
        # ID 재정렬
        for i, question in enumerate(all_questions):
            question["id"] = i + 1
            question["type"] = question.get("type", "mixed")
        
        return all_questions[:num_questions]
    
    async def _generate_typed_questions(
        self,
        text: str,
        question_type: str,
        num_questions: int,
        difficulty: str,
        start_id: int
    ) -> List[Dict]:
        """특정 유형의 문제를 생성"""
        
        example = self.few_shot_examples.get(question_type, {})
        
        difficulty_prompts = {
            "easy": "기본적인 개념 이해를 확인하는 쉬운 난이도",
            "medium": "개념의 이해와 기본적인 응용을 요구하는 중간 난이도",
            "medium-high": "개념의 깊은 이해와 응용력을 요구하는 중상 난이도",
            "high": "고도의 분석력과 창의적 사고를 요구하는 높은 난이도"
        }
        
        system_prompt = f"""당신은 자격증 시험 문제 출제 전문가입니다.
{difficulty_prompts[difficulty]}의 {question_type} 유형 문제를 생성하세요.
반드시 JSON 형식으로 응답하세요."""

        user_prompt = f"""
다음 학습 자료를 바탕으로 정확히 {num_questions}개의 {question_type} 유형 문제를 생성하세요.

학습 자료:
{text[:8000]}

JSON 형식:
{{
    "questions": [
        {{
            "id": {start_id},
            "type": "{question_type}",
            "question": "질문 내용",
            "options": ["① 선택지1", "② 선택지2", "③ 선택지3", "④ 선택지4"],
            "answer": "정답",
            "explanation": "해설"
        }}
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
                max_tokens=4000,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            questions = result.get("questions", [])
            
            for i, q in enumerate(questions):
                q["id"] = start_id + i
                q["type"] = question_type
            
            return questions[:num_questions]
            
        except Exception as e:
            print(f"{question_type} 생성 오류: {e}")
            return []

    def format_question_for_display(self, question: dict, question_type: str = None):
        """프론트엔드 표시용 포맷"""
        formatted = {
            "id": question["id"],
            "question": question["question"],
            "answer": question["answer"],
            "explanation": question.get("explanation", ""),
            "showAnswer": False
        }
        
        if "options" in question and question["options"]:
            formatted["options"] = question["options"]
        
        if "type" in question:
            formatted["type"] = question["type"]
        elif question_type:
            formatted["type"] = question_type
        
        return formatted
    
    def get_question_type_stats(self, questions: List[Dict]) -> Dict[str, int]:
        """생성된 문제의 유형별 통계"""
        stats = {}
        for question in questions:
            qtype = question.get("type", "unknown")
            stats[qtype] = stats.get(qtype, 0) + 1
        return stats
