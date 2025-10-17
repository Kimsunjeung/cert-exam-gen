from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import shutil
from pathlib import Path
from dotenv import load_dotenv
from question_generator import QuestionGenerator
from quality_evaluator import QualityEvaluator
from file_handler import FileHandler

load_dotenv()

app = FastAPI(title="자격증 문제 생성기 API")

# CORS 설정 - Next.js 프론트엔드와 통신
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# downloads 디렉터리 생성
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
        # 파일 저장
        file_path = await file_handler.save_file(file)
        
        # 텍스트 추출
        extracted_text = await file_handler.extract_text(file_path)
        
        return JSONResponse({
            "success": True,
            "filename": file.filename,
            "file_path": str(file_path),
            "text_length": len(extracted_text),
            "preview": extracted_text[:500]
        })
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )

@app.post("/api/generate-questions")
async def generate_questions(
    file_path: str = Form(...),
    question_type: str = Form(...),
    num_questions: int = Form(5)
):
    """문제 생성 (난이도: 중상)"""
    try:
        # 파일에서 텍스트 추출
        extracted_text = await file_handler.extract_text(Path(file_path))
        
        # GPT-4o-mini로 문제 생성 (난이도: 중상)
        questions = await question_generator.generate_questions(
            text=extracted_text,
            question_type=question_type,
            num_questions=num_questions,
            difficulty="medium-high"
        )
        
        try:
            quality_scores = await quality_evaluator.evaluate_questions(
                questions=questions,
                context=extracted_text
            )
        except Exception as eval_error:
            print(f"품질 평가 오류 (계속 진행): {eval_error}")
            quality_scores = {
                "faithfulness": 0.0,
                "answer_relevancy": 0.0,
                "context_precision": 0.0,
                "context_recall": 0.0
            }
        
        average_score = 0.0
        if quality_scores:
            try:
                # Convert all values to float and calculate average
                numeric_scores = {k: float(v) for k, v in quality_scores.items() if isinstance(v, (int, float))}
                if numeric_scores:
                    average_score = sum(numeric_scores.values()) / len(numeric_scores)
            except Exception as calc_error:
                print(f"평균 점수 계산 오류: {calc_error}")
                average_score = 0.0
        
        return JSONResponse({
            "success": True,
            "questions": questions,
            "quality_scores": quality_scores,
            "average_score": float(average_score)
        })
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"문제 생성 오류:\n{error_detail}")
        
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e), "detail": error_detail}
        )

@app.get("/api/files")
async def list_files():
    """저장된 파일 목록 조회"""
    files = list(DOWNLOADS_DIR.glob("*"))
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
    print("🚀 서버 시작: http://localhost:8000")
    print("📁 파일 저장 위치:", DOWNLOADS_DIR.absolute())
    uvicorn.run(app, host="0.0.0.0", port=8000)
