# question_generator.py
# -----------------------------------------------------
# 서버측 텍스트 정규화(preprocess_text) + 생성결과 postprocess 추가 버전
# - GEN_MODEL: 환경변수로 생성 모델 제어 (기본 gpt-4o-mini)
# - PREPROCESS_ENABLE: "1"이면 업로드 텍스트 정규화 적용 (기본 1)
# - 코드/연산/조건/예시/설명/참고 블록을 명확히 분리
# - 생성 결과의 보기 접두(①, A), 1) 등 제거 + 코드블록 보정
# -----------------------------------------------------

import os
import json
import re
import logging
from typing import List, Dict, Tuple

from openai import OpenAI

logger = logging.getLogger("exam-gen")

CHOICE_PREFIX_RE = re.compile(
    r"^\s*(?:[A-D]\s*[\)\.\s]|[①-⑳]|(?:\(?\d{1,2}\)?[\.\)]))\s*",
    re.IGNORECASE,
)

def strip_choice_prefix(s: str) -> str:
    if not isinstance(s, str):
        return s
    return CHOICE_PREFIX_RE.sub("", s).strip()

def guess_lang(code: str) -> str:
    """간단한 코드 언어 추정 (UI에서 문법강조 안 하더라도 가독성↑)"""
    c = code.lower()
    if "public class" in c or "static void main" in c:
        return "java"
    if re.search(r"create\s+table|select\s+.+\s+from", c, re.IGNORECASE):
        return "sql"
    if re.search(r"\bdef\b|\bimport\b", c):
        return "python"
    if re.search(r"#include\s*<|int\s+main\s*\(", c):
        return "c"
    return ""


class QuestionGenerator:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=api_key)
        self.model = os.getenv("GEN_MODEL", "gpt-4o-mini")

        # 배치 사이즈 (작게 나눠 호출하면 rate limit/timeout 안정적)
        self.batch_size = 5

        # 기존 few-shot/패턴은 생략(필요 시 추가)
        self.few_shot_examples = {}

    # ---------------------------
    # 텍스트 정규화 (서버 측)
    # ---------------------------
    def preprocess_text(self, raw: str) -> str:
        """
        업로드 PDF에서 추출한 텍스트를 LLM이 다루기 쉽고,
        클라이언트가 렌더링하기 좋도록 미리 정규화해 둔다.

        - 줄바꿈/공백 정리
        - '연산/조건/예시/설명/참고' 메타 라인 분리
        - 코드 블록 감지 후 fenced block으로 래핑 (```lang ... ```)
        - 자잘한 하이픈 줄바꿈/강제개행 제거
        """
        if not raw:
            return ""

        # 0) 줄바꿈 통일
        text = raw.replace("\r\n", "\n").replace("\r", "\n")

        # 1) 페이지/머리말/푸터 제거(간단 휴리스틱)
        #   - 페이지 번호 1/30, ... 등
        text = re.sub(r"\n?\s*\d+\s*/\s*\d+\s*\n", "\n", text)
        #   - 너무 긴 공백 줄 축약
        text = re.sub(r"\n{3,}", "\n\n", text)

        # 2) 하이픈 줄바꿈 복원: "compu-\nter" -> "computer"
        text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
        #   - 문장 끝 아닌 곳의 잘못된 줄바꿈 보정: "for\n(" -> "for("
        text = re.sub(r"([A-Za-z0-9_])\n\(", r"\1(", text)

        # 3) 메타 블록(연산/조건/예시/설명/참고) 라인 앞뒤 공백 정리 + 분리
        meta_labels = r"(연산|조건|예시|설명|참고)"
        # "연산 : 내용" -> "연산: 내용"
        text = re.sub(rf"^{meta_labels}\s*[:：]\s*", r"\1: ", text, flags=re.MULTILINE)
        # 문장 중간에 나와버린 경우 개행으로 분리 "…다음 연산: push, pop" → 줄 시작에 배치
        text = re.sub(rf"\s+{meta_labels}:\s*", r"\n\1: ", text)

        # 4) 코드 블록 감지: public class/ static void main/ { / ; 가 잦은 라인
        lines = text.split("\n")
        code_buf: List[str] = []
        out: List[str] = []
        in_code = False

        def flush_code():
            nonlocal code_buf, out
            if code_buf:
                block = "\n".join(code_buf).strip("\n")
                lang = guess_lang(block)
                fence = f"```{lang}\n{block}\n```\n"
                out.append(fence)
                code_buf = []

        code_start_re = re.compile(
            r"(public\s+class|static\s+void\s+main|#include\s*<|^\s*for\s*\(|^\s*if\s*\(|^\s*while\s*\(|;\s*$|\{\s*$)"
        )
        # 코드 줄이라도 지나치게 짧은 설명문은 제외하려고 최소 길이 제한
        for i, ln in enumerate(lines):
            line = ln.rstrip()
            # 코드 시작/연결 판단
            if code_start_re.search(line) or line.strip().endswith("{") or line.strip().endswith("};"):
                in_code = True
                code_buf.append(line)
                continue
            # 이미 코드 중인데 ;나 } 등으로 이어지는 줄
            if in_code and (line.strip().endswith(";") or line.strip().endswith("}") or line.strip().endswith("{")):
                code_buf.append(line)
                # 코드 종료는 빈 줄/메타 블록/완전히 평문 감지 시 flush
                # 여기선 계속 버퍼링만
                continue

            # 메타 블록이면 코드 flush 후 메타 저장
            if re.match(rf"^{meta_labels}:", line):
                flush_code()
                out.append(line)
                in_code = False
                continue

            # 완전 평문
            if in_code:
                # 바로 평문이면 코드 flush
                flush_code()
                in_code = False

            out.append(line)

        flush_code()
        text = "\n".join(out)

        # 5) 여분 공백 정리
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    # ---------------------------
    # 생성 결과 후처리
    # ---------------------------
    def postprocess_questions(self, questions: List[Dict]) -> List[Dict]:
        """
        - 보기 접두(①, A), 1) 등 제거
        - 문제 본문에서 코드블록 누락 시 보정(간단 감지)
        - 공백 정리
        """
        processed: List[Dict] = []

        code_hint = re.compile(
            r"(public\s+class|static\s+void\s+main|\bfor\s*\(|\bif\s*\(|\bwhile\s*\(|#include\s*<)",
            re.IGNORECASE,
        )

        for q in questions:
            qq = dict(q)

            # 보기 접두 제거
            if isinstance(qq.get("options"), list):
                qq["options"] = [strip_choice_prefix(opt) for opt in qq["options"]]

            # 코드블록 보정
            body = str(qq.get("question", "")).replace("\r\n", "\n")
            if code_hint.search(body) and "```" not in body:
                lang = guess_lang(body)
                qq["question"] = f"```{lang}\n{body}\n```"
            else:
                qq["question"] = body

            # 공백 정리
            if "explanation" in qq and isinstance(qq["explanation"], str):
                qq["explanation"] = re.sub(r"\s+\n", "\n", qq["explanation"]).strip()

            processed.append(qq)

        return processed

    # ---------------------------
    # GPT-5용 문제 생성 (혼합 유형 지원)
    # ---------------------------
    async def generate_questions(
        self,
        text: str,
        question_type: str,
        num_questions: int = 30,
        difficulty: str = "medium-high"
    ) -> List[Dict]:
        logger.info(f"[GEN] using model={self.model}")

        # ✅ 서버측 전처리 적용 (환경변수로 on/off)
        if os.getenv("PREPROCESS_ENABLE", "1") == "1":
            text = self.preprocess_text(text)

        # 혼합 유형이면 고급 생성 (타입분석/분배)
        if question_type == "mixed" or question_type not in ["multiple-choice", "true-false", "essay"]:
            questions = await self.generate_mixed_questions(
                text=text,
                num_questions=num_questions,
                difficulty=difficulty
            )
        else:
            questions = await self._generate_simple(
                text=text,
                question_type=question_type,
                num_questions=num_questions,
                difficulty=difficulty
            )

        # ✅ 서버측 후처리
        questions = self.postprocess_questions(questions)
        return questions

    # ---------------------------
    # 단일 유형 (하위 호환)
    # ---------------------------
    async def _generate_simple(
        self,
        text: str,
        question_type: str,
        num_questions: int,
        difficulty: str
    ) -> List[Dict]:
        batch_size = 10
        num_batches = (num_questions + batch_size - 1) // batch_size
        all_questions: List[Dict] = []

        for b in range(num_batches):
            start_id = len(all_questions) + 1
            count = min(batch_size, num_questions - len(all_questions))

            system_prompt = f"""당신은 자격증 시험 문제 출제 전문가입니다.
주어진 학습 자료로 {difficulty} 난이도의 {question_type} 문제를 정확히 {count}개 생성하세요.
각 문제는 4지선다(①~④) 또는 적절한 형식을 따르며 "정답"과 "해설"을 반드시 포함하세요.
문제 본문에 코드가 있으면 원문 개행을 유지하고, 가능하면 코드 블록을 사용하세요.
반드시 JSON으로만 응답하세요.
"""

            user_prompt = f"""학습 자료(전처리됨):
{text[:8000]}

JSON 스키마:
{{
  "questions": [
    {{
      "id": {start_id},
      "type": "{question_type}",
      "question": "질문 내용(필요 시 코드 포함)",
      "options": ["① 보기1", "② 보기2", "③ 보기3", "④ 보기4"],
      "answer": "정답",
      "explanation": "해설"
    }}
  ]
}}"""

            try:
                resp = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    response_format={"type": "json_object"},
                )
                data = json.loads(resp.choices[0].message.content)
                items = data.get("questions", [])
                # id 보정
                for i, q in enumerate(items):
                    q["id"] = start_id + i
                    q.setdefault("type", question_type)
                all_questions.extend(items)
            except Exception as e:
                logger.exception("[_generate_simple] batch 실패")
                continue

            if len(all_questions) >= num_questions:
                break

        return all_questions[:num_questions]

    # ---------------------------
    # 혼합 유형 생성 (분석/분배 → 타입별 호출)
    # ---------------------------
    def analyze_question_types(self, text: str) -> Dict[str, float]:
        # (기존 간단 분석 로직) — 필요 시 고도화 가능
        keys = {
            "tree_analysis": ["트리", "Fan-In", "Fan-Out", "노드", "그래프"],
            "code_execution": ["Java", "public", "class", "main", "코드", "실행", "결과"],
            "algorithm_analysis": ["알고리즘", "복잡도", "Big-O", "시간복잡도"],
            "data_structure": ["스택", "큐", "배열", "리스트", "자료구조"],
            "diagram_matching": ["그림", "도식", "차트", "흐름도", "플로차트", "다이어그램"],
        }
        counts = {k: 0 for k in keys}
        total = 0
        for k, ws in keys.items():
            for w in ws:
                c = text.count(w)
                counts[k] += c
                total += c
        if total == 0:
            return {"multiple_choice": 1.0}
        return {k: max(v / total, 0.05) for k, v in counts.items()}

    def distribute_questions(self, n: int, ratios: Dict[str, float]) -> Dict[str, int]:
        items = sorted(ratios.items(), key=lambda x: x[1], reverse=True)
        left = n
        out: Dict[str, int] = {}
        for i, (t, r) in enumerate(items):
            if i == len(items) - 1:
                out[t] = left
            else:
                cnt = max(1, int(n * r))
                cnt = min(cnt, left - (len(items) - i - 1))
                out[t] = cnt
                left -= cnt
        return {k: v for k, v in out.items() if v > 0}

    async def _generate_typed_questions(
        self,
        text: str,
        question_type: str,
        count: int,
        difficulty: str,
        start_id: int
    ) -> List[Dict]:
        system_prompt = f"""당신은 자격증 시험 문제 출제 전문가입니다.
"{question_type}" 유형의 문제를 {difficulty} 난이도로 정확히 {count}개 생성하세요.
각 문제에 정답과 해설을 반드시 포함하세요. JSON으로만 응답하세요."""
        user_prompt = f"""학습 자료(전처리됨):
{text[:8000]}

JSON 스키마:
{{
  "questions": [
    {{
      "id": {start_id},
      "type": "{question_type}",
      "question": "질문 내용(필요 시 코드 포함)",
      "options": ["① 보기1", "② 보기2", "③ 보기3", "④ 보기4"],
      "answer": "정답",
      "explanation": "해설"
    }}
  ]
}}"""

        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
            )
            data = json.loads(resp.choices[0].message.content)
            items = data.get("questions", [])
            for i, q in enumerate(items):
                q["id"] = start_id + i
                q.setdefault("type", question_type)
            return items[:count]
        except Exception:
            logger.exception("[_generate_typed_questions] 실패")
            return []

    async def generate_mixed_questions(
        self,
        text: str,
        num_questions: int = 30,
        difficulty: str = "medium-high",
        custom_distribution: Dict[str, int] = None
    ) -> List[Dict]:
        if custom_distribution:
            dist = custom_distribution
        else:
            ratios = self.analyze_question_types(text)
            dist = self.distribute_questions(num_questions, ratios)

        logger.info(f"[MIXED] distribution={dist}")

        all_questions: List[Dict] = []
        cursor = 1
        for qtype, cnt in dist.items():
            batch = await self._generate_typed_questions(text, qtype, cnt, difficulty, cursor)
            all_questions.extend(batch)
            cursor += len(batch)

        # 셔플(고유 ID 재정렬은 클라이언트에서 하므로 여기선 유지)
        try:
            import random
            random.shuffle(all_questions)
            for i, q in enumerate(all_questions, 1):
                q["id"] = i
        except Exception:
            pass

        return all_questions[:num_questions]

    # 기존 포맷터 등 필요시 유지
    def get_question_type_stats(self, questions: List[Dict]) -> Dict[str, int]:
        stats: Dict[str, int] = {}
        for q in questions:
            t = q.get("type", "unknown")
            stats[t] = stats.get(t, 0) + 1
        return stats
