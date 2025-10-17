# main.py
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
from pathlib import Path
from dotenv import load_dotenv
from question_generator import QuestionGenerator
from quality_evaluator import QualityEvaluator
from file_handler import FileHandler
import logging
import time

load_dotenv()

# ---------------------------
# 로깅 설정
# ---------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("exam-gen")

app = FastAPI(title="자격증 문제 생성기 API")

# CORS (Next.js 개발용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("NEXT_PUBLIC_WEB_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# downloads 디렉터리
DOWNLOADS_DIR = Path("downloads")
DOWNLOADS_DIR.mkdir(exist_ok=True)

# 초기화
file_handler = FileHandler(DOWNLOADS_DIR)
question_generator = QuestionGenerator()
quality_evaluator = QualityEvaluator()


@app.get("/")
async def root():
    return {"message": "자격증 문제 생성기 API가 실행 중입니다"}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """파일 업로드 및 텍스트 추출"""
    try:
        t0 = time.perf_counter()

        # 파일 저장
        file_path = await file_handler.save_file(file)

        # 텍스트 추출
        extracted_text = await file_handler.extract_text(file_path)

        dt = time.perf_counter() - t0
        logger.info(
            f"[UPLOAD] name={file.filename} | path={file_path} | "
            f"text_len={len(extracted_text)} | took={dt:.2f}s"
        )

        return JSONResponse({
            "success": True,
            "filename": file.filename,
            "file_path": str(file_path),
            "text_length": len(extracted_text),
            "preview": extracted_text[:500]
        })
    except Exception as e:
        logger.exception("[UPLOAD] 실패")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )


@app.post("/api/generate-questions")
async def generate_questions(
    file_path: str = Form(...),
    question_type: str = Form(...),         # "mixed" 권장
    num_questions: int = Form(20),          # 기본 20
    difficulty: str = Form("medium-high"),  # 기본 중상
):
    """문제 생성 + RAGAS 평가 (로깅 포함)"""
    try:
        # Guard
        num_questions = max(5, min(50, int(num_questions)))

        # 파일에서 텍스트 재추출 (캐시 용도)
        extracted_text = await file_handler.extract_text(Path(file_path))

        logger.info(
            f"[GEN] start | file={file_path} | type={question_type} | "
            f"n={num_questions} | diff={difficulty} | text_len={len(extracted_text)}"
        )

        # 혼합 유형일 때 사전 분석/분배 로깅
        if question_type == "mixed":
            try:
                ratios = question_generator.analyze_question_types(extracted_text)
                dist = question_generator.distribute_questions(num_questions, ratios)
                logger.info(f"[GEN] analyzed type ratios={ratios}")
                logger.info(f"[GEN] planned distribution={dist}")
            except Exception:
                logger.warning("[GEN] pre-analysis logging 실패 (계속 진행)")

        # 생성
        t0 = time.perf_counter()
        questions = await question_generator.generate_questions(
            text=extracted_text,
            question_type=question_type,
            num_questions=num_questions,
            difficulty=difficulty
        )
        gen_dt = time.perf_counter() - t0

        # 생성 결과 유형 통계 로깅
        try:
            stats = question_generator.get_question_type_stats(questions)
            logger.info(f"[GEN] generated {len(questions)} questions | stats={stats} | took={gen_dt:.2f}s")
        except Exception:
            logger.info(f"[GEN] generated {len(questions)} questions | took={gen_dt:.2f}s")

        # 품질 평가
        try:
            t1 = time.perf_counter()
            quality_scores = await quality_evaluator.evaluate_questions(
                questions=questions,
                context=extracted_text
            )
            eval_dt = time.perf_counter() - t1

            numeric_scores = {
                k: float(v) for k, v in (quality_scores or {}).items()
                if isinstance(v, (int, float))
            }
            average_score = (
                sum(numeric_scores.values()) / len(numeric_scores)
                if numeric_scores else 0.0
            )

            logger.info(
                f"[EVAL] scores={quality_scores} | avg={average_score:.3f} | took={eval_dt:.2f}s"
            )
        except Exception as eval_error:
            logger.exception("[EVAL] 평가 실패 (계속 진행)")
            quality_scores = {
                "faithfulness": 0.0,
                "answer_relevancy": 0.0,
                "context_precision": 0.0,
                "context_recall": 0.0
            }
            average_score = 0.0

        return JSONResponse({
            "success": True,
            "questions": questions,
            "quality_scores": quality_scores,
            "average_score": float(average_score)
        })
    except Exception as e:
        logger.exception("[GEN] 문제 생성 실패")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )


@app.get("/api/files")
async def list_files():
    """저장된 파일 목록 조회"""
    files = list(DOWNLOADS_DIR.glob("*"))
    logger.info(f"[FILES] list {len(files)} files")
    return JSONResponse({
        "success": True,
        "files": [
            {
                "name": f.name,
                "path": str(f),
                "size": f.stat().st_size
            }
            for f in files if f.is_file()
        ]
    })


if __name__ == "__main__":
    import uvicorn
    logger.info("🚀 서버 시작: http://localhost:8000")
    logger.info(f"📁 파일 저장 위치: {DOWNLOADS_DIR.absolute()}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
