"use client"

import React, { useState } from "react"
import { Upload, FileText, Loader2, ChevronRight, AlertCircle, Download, Clock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

type Step = "upload" | "analyzing" | "select-type" | "generating" | "generated"
type QuestionType = "multiple-choice" | "true-false" | "essay"

interface Question {
  id: number
  question: string
  options?: string[]
  answer: string
  explanation?: string
  showAnswer: boolean
}

interface QualityScores {
  faithfulness: number
  answer_relevancy: number
  context_precision: number
  context_recall: number
}

interface QuestionSet {
  id: string
  timestamp: Date
  questionType: QuestionType
  questions: Question[]
  qualityScores: QualityScores | null
  fileName: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export default function ExamGenerator() {
  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [filePath, setFilePath] = useState<string>("")
  const [questionType, setQuestionType] = useState<QuestionType>("multiple-choice")
  const [questions, setQuestions] = useState<Question[]>([])
  const [qualityScores, setQualityScores] = useState<QualityScores | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string>("")
  const [questionHistory, setQuestionHistory] = useState<QuestionSet[]>([])
  const [currentSetId, setCurrentSetId] = useState<string | null>(null)

  // 🧠 보기 문자열 정제
  function cleanOptionText(text: string): string {
    return text.replace(/^[A-D]\)|[A-D]\.|^[A-D]\s/, "").trim()
  }

  // 📊 RAGAS 점수 표시 함수
  function formatScore(value: number): string {
    if (!value && value !== 0) return "0%"
    const score = value <= 1 ? value * 100 : value
    return `${score.toFixed(1)}%`
  }

  // 🧾 정답 토글
  const toggleAnswer = (id: number) => {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, showAnswer: !q.showAnswer } : q)))
  }

  // 📁 파일 업로드 로직 (생략 – 기존 코드 유지)
  // 🧠 문제 생성 로직 (생략 – 기존 코드 유지)
  // … 기존 코드와 동일하게 유지 …

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-400 rounded-lg flex items-center justify-center">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">문제 생성하기</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* 오류 표시 */}
        {error && (
          <Alert variant="destructive" className="mb-6 max-w-4xl mx-auto">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ✅ 문제 생성 결과 */}
        {step === "generated" && (
          <div className="space-y-8">
            {qualityScores && (
              <Card className="p-6 bg-blue-50 border border-blue-200 rounded-2xl shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-4">RAGAS 품질 평가 결과</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    ["충실도", qualityScores.faithfulness],
                    ["관련성", qualityScores.answer_relevancy],
                    ["정밀도", qualityScores.context_precision],
                    ["재현율", qualityScores.context_recall],
                  ].map(([label, score], i) => (
                    <div key={i} className="bg-white rounded-xl p-4 text-center card-hover">
                      <p className="text-gray-600 font-medium mb-1">{label}</p>
                      <p className="text-blue-600 font-bold text-xl">{formatScore(score as number)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 객관식 문제 */}
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-gray-900">
                객관식 문제 ({questions.length}개)
              </h2>
              {questions.map((q, index) => (
                <Card key={q.id} className="p-6 bg-white border border-gray-200 rounded-xl card-hover">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-700 font-bold rounded-full">
                        {index + 1}
                      </span>
                      <p className="text-gray-900 leading-relaxed font-medium">{q.question}</p>
                    </div>

                    {q.options && (
                      <ul className="ml-12 space-y-1">
                        {q.options.map((opt, i) => (
                          <li key={i} className="choice-item">
                            <span className="choice-label">{`(${i + 1})`}</span>
                            <span className="choice-text">{cleanOptionText(opt)}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="ml-12 pt-3">
                      <Button variant="outline" size="sm" onClick={() => toggleAnswer(q.id)} className="answer-toggle">
                        {q.showAnswer ? "정답 숨기기" : "정답 보기"}
                      </Button>
                      {q.showAnswer && (
                        <div className="answer-box">
                          <p className="text-green-800 font-semibold">정답: {q.answer}</p>
                          {q.explanation && <p className="text-green-700 text-sm">{q.explanation}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
