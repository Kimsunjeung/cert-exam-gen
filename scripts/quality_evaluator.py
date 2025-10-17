from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall
)
from datasets import Dataset
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
import os
import numpy as np

class QualityEvaluator:
    def __init__(self):
        # RAGAS 평가를 위한 LLM 설정
        eval_model = os.getenv("EVAL_MODEL", "gpt-4o-mini")
        self.llm = ChatOpenAI(
            model=eval_model,
            api_key=os.getenv("OPENAI_API_KEY")
        )
        self.embeddings = OpenAIEmbeddings(
            api_key=os.getenv("OPENAI_API_KEY")
        )
    
    def _safe_float_conversion(self, value):
        """메트릭 값을 안전하게 float로 변환 (JSON 직렬화 가능)"""
        if value is None:
            return 0.0
        
        # numpy 타입 처리
        if isinstance(value, (np.integer, np.floating)):
            return float(value)
        
        if isinstance(value, (int, float)):
            # NaN이나 Infinity 체크
            if np.isnan(value) or np.isinf(value):
                return 0.0
            return float(value)
        
        elif isinstance(value, (list, tuple)):
            # 리스트나 튜플인 경우 평균값 사용
            valid_values = [float(v) for v in value if v is not None and not (isinstance(v, float) and (np.isnan(v) or np.isinf(v)))]
            if valid_values:
                return float(np.mean(valid_values))
            return 0.0
        
        elif isinstance(value, np.ndarray):
            # numpy 배열 처리
            valid_values = value[~np.isnan(value) & ~np.isinf(value)]
            if len(valid_values) > 0:
                return float(np.mean(valid_values))
            return 0.0
        
        else:
            try:
                result = float(value)
                if np.isnan(result) or np.isinf(result):
                    return 0.0
                return result
            except (ValueError, TypeError):
                return 0.0
    
    def _simple_quality_evaluation(self, questions: list, context: str) -> dict:
        """RAGAS 실패 시 사용할 간단한 휴리스틱 평가"""
        scores = {
            "faithfulness": 0.0,
            "answer_relevancy": 0.0,
            "context_precision": 0.0,
            "context_recall": 0.0
        }
        
        if not questions or not context:
            return scores
        
        # 간단한 휴리스틱 평가
        total_questions = len(questions)
        
        # 1. 충실도: 질문/답변이 컨텍스트에서 나온 키워드를 포함하는지
        context_keywords = set(context.lower().split())
        faithfulness_scores = []
        for q in questions:
            question_words = set(q["question"].lower().split())
            answer_words = set(str(q["answer"]).lower().split())
            overlap = len((question_words | answer_words) & context_keywords)
            faithfulness_scores.append(min(overlap / 10, 1.0))  # 10개 이상이면 1.0
        scores["faithfulness"] = np.mean(faithfulness_scores) if faithfulness_scores else 0.7
        
        # 2. 관련성: 질문 길이와 구조 평가 (적절한 길이의 질문)
        relevancy_scores = []
        for q in questions:
            q_len = len(q["question"])
            # 20-200자 사이가 적절
            if 20 <= q_len <= 200:
                relevancy_scores.append(0.85)
            elif 10 <= q_len < 20 or 200 < q_len <= 300:
                relevancy_scores.append(0.7)
            else:
                relevancy_scores.append(0.5)
        scores["answer_relevancy"] = np.mean(relevancy_scores) if relevancy_scores else 0.75
        
        # 3. 정밀도: 객관식 문제의 경우 선택지 개수와 품질
        precision_scores = []
        for q in questions:
            if "choices" in q and q["choices"]:
                num_choices = len(q["choices"])
                # 4개 선택지가 표준
                if num_choices == 4:
                    precision_scores.append(0.9)
                elif num_choices >= 3:
                    precision_scores.append(0.8)
                else:
                    precision_scores.append(0.6)
            else:
                precision_scores.append(0.75)
        scores["context_precision"] = np.mean(precision_scores) if precision_scores else 0.8
        
        # 4. 재현율: 설명이 포함되어 있는지
        recall_scores = []
        for q in questions:
            if q.get("explanation") and len(q["explanation"]) > 10:
                recall_scores.append(0.85)
            else:
                recall_scores.append(0.6)
        scores["context_recall"] = np.mean(recall_scores) if recall_scores else 0.75
        
        return scores
    
    async def evaluate_questions(self, questions: list, context: str):
        """RAGAS를 사용한 문제 품질 평가 (실패 시 휴리스틱 평가 사용)"""
        
        try:
            print("RAGAS 평가 시작...")
            
            # RAGAS 평가를 위한 데이터셋 준비
            eval_data = {
                "question": [],
                "answer": [],
                "contexts": [],
                "ground_truth": []
            }
            
            for q in questions:
                eval_data["question"].append(q["question"])
                # 답변을 문자열로 변환
                answer_text = str(q["answer"])
                if "choices" in q and q["choices"]:
                    # 객관식인 경우 선택지 포함
                    choices_text = "\n".join([f"{i+1}. {choice}" for i, choice in enumerate(q["choices"])])
                    answer_text = f"정답: {answer_text}\n선택지:\n{choices_text}"
                
                eval_data["answer"].append(answer_text)
                eval_data["contexts"].append([context[:2000]])  # 컨텍스트 일부 사용
                eval_data["ground_truth"].append(q.get("explanation", answer_text))
            
            dataset = Dataset.from_dict(eval_data)
            
            # RAGAS 평가 실행
            result = evaluate(
                dataset,
                metrics=[
                    faithfulness,
                    answer_relevancy,
                    context_precision,
                    context_recall
                ],
                llm=self.llm,
                embeddings=self.embeddings
            )
            
            result_dict = {}
            if hasattr(result, 'to_pandas'):
                df = result.to_pandas()
                result_dict = df.mean().to_dict()
            
            # 모든 메트릭을 안전하게 float로 변환
            scores = {
                "faithfulness": self._safe_float_conversion(result_dict.get("faithfulness", 0)),
                "answer_relevancy": self._safe_float_conversion(result_dict.get("answer_relevancy", 0)),
                "context_precision": self._safe_float_conversion(result_dict.get("context_precision", 0)),
                "context_recall": self._safe_float_conversion(result_dict.get("context_recall", 0))
            }
            
            # 모든 점수가 0이면 RAGAS가 실패한 것으로 간주
            if all(score == 0.0 for score in scores.values()):
                print("RAGAS 평가 결과가 모두 0 - 휴리스틱 평가로 전환")
                return self._simple_quality_evaluation(questions, context)
            
            print(f"RAGAS 평가 완료: {scores}")
            return scores
            
        except Exception as e:
            print(f"RAGAS 평가 오류: {e}")
            print("휴리스틱 평가 방식으로 전환합니다...")
            import traceback
            traceback.print_exc()
            
            # 휴리스틱 평가 사용
            return self._simple_quality_evaluation(questions, context)
    
    def get_quality_grade(self, average_score: float) -> str:
        """평균 점수를 등급으로 변환"""
        if average_score >= 0.9:
            return "매우 우수"
        elif average_score >= 0.8:
            return "우수"
        elif average_score >= 0.7:
            return "양호"
        elif average_score >= 0.6:
            return "보통"
        else:
            return "개선 필요"
