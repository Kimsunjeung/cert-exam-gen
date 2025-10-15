"use client"

import type React from "react"

import { useState } from "react"
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

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile)
    setStep("analyzing")
    setError("")

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)

      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 0) {
          throw new Error("백엔드 서버에 연결할 수 없습니다. Python 서버가 실행 중인지 확인하세요.")
        }
        throw new Error(`서버 오류: ${response.status}`)
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("서버에서 올바른 응답을 받지 못했습니다. 백엔드 서버를 확인하세요.")
      }

      const data = await response.json()

      if (data.success) {
        setFilePath(data.file_path)
        setStep("select-type")
      } else {
        throw new Error(data.error || "파일 업로드 실패")
      }
    } catch (err) {
      console.error("[v0] Upload error:", err)
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("백엔드 서버에 연결할 수 없습니다. Python FastAPI 서버가 실행 중인지 확인하세요. (포트 8000)")
      } else {
        setError(err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다")
      }
      setStep("upload")
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      handleFileSelect(selectedFile)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      handleFileSelect(droppedFile)
    }
  }

  const generateQuestions = async () => {
    setStep("generating")
    setError("")

    try {
      const formData = new FormData()
      formData.append("file_path", filePath)
      formData.append("question_type", questionType)
      formData.append("num_questions", "30")

      const response = await fetch(`${API_URL}/api/generate-questions`, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 0) {
          throw new Error("백엔드 서버에 연결할 수 없습니다. Python 서버가 실행 중인지 확인하세요.")
        }
        throw new Error(`서버 오류: ${response.status}`)
      }

      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("서버에서 올바른 응답을 받지 못했습니다. 백엔드 서버를 확인하세요.")
      }

      const data = await response.json()

      if (data.success) {
        const formattedQuestions = data.questions.map((q: any) => ({
          ...q,
          showAnswer: false,
        }))

        const newSetId = `set-${Date.now()}`
        const newSet: QuestionSet = {
          id: newSetId,
          timestamp: new Date(),
          questionType: questionType,
          questions: formattedQuestions,
          qualityScores: data.quality_scores,
          fileName: file?.name || "문제집",
        }

        setQuestionHistory((prev) => [newSet, ...prev])
        setCurrentSetId(newSetId)
        setQuestions(formattedQuestions)
        setQualityScores(data.quality_scores)
        setStep("generated")
      } else {
        throw new Error(data.error || "문제 생성 실패")
      }
    } catch (err) {
      console.error("[v0] Generate questions error:", err)
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("백엔드 서버에 연결할 수 없습니다. Python FastAPI 서버가 실행 중인지 확인하세요. (포트 8000)")
      } else {
        setError(err instanceof Error ? err.message : "문제 생성 중 오류가 발생했습니다")
      }
      setStep("select-type")
    }
  }

  const toggleAnswer = (id: number) => {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, showAnswer: !q.showAnswer } : q)))
  }

  const getQualityGrade = (score: number) => {
    if (score >= 0.9) return { text: "매우 우수", color: "text-green-700 bg-green-50" }
    if (score >= 0.8) return { text: "우수", color: "text-blue-700 bg-blue-50" }
    if (score >= 0.7) return { text: "양호", color: "text-yellow-700 bg-yellow-50" }
    if (score >= 0.6) return { text: "보통", color: "text-orange-700 bg-orange-50" }
    return { text: "개선 필요", color: "text-red-700 bg-red-50" }
  }

  const questionTypeLabels = {
    "multiple-choice": "객관식",
    "true-false": "참/거짓",
    essay: "서술형",
  }

  const handleDownload = () => {
    if (questions.length === 0) return

    const content = {
      fileName: file?.name || "문제집",
      questionType: questionTypeLabels[questionType],
      generatedDate: new Date().toLocaleDateString("ko-KR"),
      qualityScores: qualityScores
        ? {
            충실도: `${(qualityScores.faithfulness * 100).toFixed(1)}%`,
            관련성: `${(qualityScores.answer_relevancy * 100).toFixed(1)}%`,
            정밀도: `${(qualityScores.context_precision * 100).toFixed(1)}%`,
            재현율: `${(qualityScores.context_recall * 100).toFixed(1)}%`,
            평균점수: `${(
              ((qualityScores.faithfulness +
                qualityScores.answer_relevancy +
                qualityScores.context_precision +
                qualityScores.context_recall) /
                4) *
                100
            ).toFixed(1)}%`,
          }
        : null,
      questions: questions.map((q, idx) => ({
        번호: idx + 1,
        문제: q.question,
        선택지: q.options || [],
        정답: q.answer,
        해설: q.explanation || "",
      })),
    }

    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${questionTypeLabels[questionType]}_문제_${new Date().getTime()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const switchToSet = (setId: string) => {
    const set = questionHistory.find((s) => s.id === setId)
    if (set) {
      setCurrentSetId(setId)
      setQuestions(set.questions)
      setQualityScores(set.qualityScores)
      setQuestionType(set.questionType)
    }
  }

  const deleteSet = (setId: string) => {
    setQuestionHistory((prev) => prev.filter((s) => s.id !== setId))
    if (currentSetId === setId && questionHistory.length > 1) {
      const remainingSets = questionHistory.filter((s) => s.id !== setId)
      if (remainingSets.length > 0) {
        switchToSet(remainingSets[0].id)
      }
    } else if (questionHistory.length === 1) {
      setStep("select-type")
      setQuestions([])
      setQualityScores(null)
      setCurrentSetId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-400 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">문제 생성하기</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6 max-w-4xl mx-auto">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Upload Step */}
        {step === "upload" && (
          <div className="max-w-4xl mx-auto">
            <Card className="border-2 border-dashed border-blue-200 bg-blue-50/30 p-12">
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
                  <Upload className="w-10 h-10 text-blue-600" />
                </div>

                <div className="text-center">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">파일 선택</h2>
                  <p className="text-gray-600 mb-6">PDF, 이미지, Word, Excel, PowerPoint 파일 추가</p>
                </div>

                <div className="flex flex-col items-center gap-4 w-full max-w-md">
                  <label htmlFor="file-upload">
                    <Button
                      size="lg"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-8"
                      onClick={() => document.getElementById("file-upload")?.click()}
                    >
                      <Upload className="w-5 h-5 mr-2" />
                      파일 선택
                    </Button>
                  </label>
                  <input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"
                    onChange={handleFileChange}
                  />

                  <div
                    className={`w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <p className="text-gray-600">또는 파일을 여기로 드래그하세요</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 justify-center">
                  <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">PDF</span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">DOC</span>
                  <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">XLS</span>
                  <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">PPT</span>
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">PNG</span>
                  <span className="px-3 py-1 bg-pink-100 text-pink-700 rounded-full text-sm font-medium">JPG</span>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Analyzing Step */}
        {step === "analyzing" && (
          <div className="max-w-2xl mx-auto">
            <Card className="p-12">
              <div className="flex flex-col items-center gap-6">
                <div className="w-32 h-32 bg-gray-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-16 h-16 text-gray-400" />
                </div>

                <div className="text-center">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{file?.name}</h3>
                  <p className="text-sm text-gray-500 mb-4">({((file?.size || 0) / 1024).toFixed(0)}KB)</p>
                </div>

                <div className="flex items-center gap-3 text-blue-600">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-lg font-medium">AI로 분석 중...</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Select Question Type Step */}
        {step === "select-type" && (
          <div className="grid lg:grid-cols-[1fr,400px] gap-6">
            <Card className="p-6 bg-white">
              <div className="flex items-center gap-4 p-6 bg-gray-50 rounded-lg">
                <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-8 h-8 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{file?.name}</h3>
                  <p className="text-sm text-gray-500">분석 완료</p>
                </div>
              </div>
            </Card>

            <div className="space-y-6">
              <Card className="p-6 bg-white border-2 border-blue-100">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <h2 className="text-lg font-bold text-gray-900">문제 유형 선택:</h2>
                </div>

                <RadioGroup value={questionType} onValueChange={(value) => setQuestionType(value as QuestionType)}>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3 p-4 rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-colors cursor-pointer">
                      <RadioGroupItem value="multiple-choice" id="multiple-choice" />
                      <Label htmlFor="multiple-choice" className="flex-1 cursor-pointer font-medium">
                        객관식 문제
                      </Label>
                    </div>

                    <div className="flex items-center space-x-3 p-4 rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-colors cursor-pointer">
                      <RadioGroupItem value="true-false" id="true-false" />
                      <Label htmlFor="true-false" className="flex-1 cursor-pointer font-medium">
                        참/거짓 문제
                      </Label>
                    </div>

                    <div className="flex items-center space-x-3 p-4 rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-colors cursor-pointer">
                      <RadioGroupItem value="essay" id="essay" />
                      <Label htmlFor="essay" className="flex-1 cursor-pointer font-medium">
                        서술형 문제
                      </Label>
                    </div>
                  </div>
                </RadioGroup>

                <Button
                  className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white"
                  size="lg"
                  onClick={generateQuestions}
                >
                  문제 생성하기
                  <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </Card>
            </div>
          </div>
        )}

        {step === "generating" && (
          <div className="max-w-2xl mx-auto">
            <Card className="p-12">
              <div className="flex flex-col items-center gap-6">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                </div>

                <div className="text-center space-y-2">
                  <h3 className="text-xl font-bold text-gray-900">GPT-4o-mini로 문제 생성 중...</h3>
                  <p className="text-gray-600">난이도: 중상</p>
                  <p className="text-sm text-gray-500">RAGAS 품질 평가 진행 중</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Generated Questions Step */}
        {step === "generated" && (
          <div className="space-y-6">
            {questionHistory.length > 1 && (
              <Card className="p-4 bg-white border-2 border-blue-100">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-gray-900">생성 히스토리 ({questionHistory.length}개)</h3>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {questionHistory.map((set, index) => (
                    <div
                      key={set.id}
                      className={`flex-shrink-0 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        currentSetId === set.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-blue-300 bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-[200px]" onClick={() => switchToSet(set.id)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-blue-600">
                              {questionTypeLabels[set.questionType]}
                            </span>
                            <span className="text-xs text-gray-500">{set.questions.length}문항</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{set.fileName}</p>
                          <p className="text-xs text-gray-500">
                            {set.timestamp.toLocaleTimeString("ko-KR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 hover:bg-red-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteSet(set.id)
                          }}
                        >
                          <X className="w-4 h-4 text-gray-400 hover:text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {qualityScores && (
              <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">RAGAS 품질 평가 결과</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">충실도</p>
                    <p className="text-2xl font-bold text-blue-600">{(qualityScores.faithfulness * 100).toFixed(0)}%</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">관련성</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {(qualityScores.answer_relevancy * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">정밀도</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {(qualityScores.context_precision * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">재현율</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {(qualityScores.context_recall * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {questionTypeLabels[questionType]} 문제 ({questions.length}개)
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="flex items-center gap-2 bg-transparent"
              >
                <Download className="w-4 h-4" />
                다운로드
              </Button>
            </div>

            <div className="grid gap-4">
              {questions.map((question, index) => (
                <Card
                  key={question.id}
                  className="p-6 bg-white border-2 border-gray-100 hover:border-blue-200 transition-colors"
                >
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                        {index + 1}
                      </span>
                      <p className="flex-1 text-gray-900 font-medium leading-relaxed">{question.question}</p>
                    </div>

                    {question.options && (
                      <div className="ml-11 space-y-2">
                        {question.options.map((option, optIndex) => (
                          <div key={optIndex} className="flex items-start gap-2">
                            <span className="text-gray-600 font-medium">{String.fromCharCode(65 + optIndex)})</span>
                            <span className="text-gray-700">{option}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="ml-11 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleAnswer(question.id)}
                        className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        {question.showAnswer ? "정답 숨기기" : "정답 보기"}
                      </Button>

                      {question.showAnswer && (
                        <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
                          <p className="text-green-800 font-medium">정답: {question.answer}</p>
                          {question.explanation && <p className="text-green-700 text-sm">{question.explanation}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200">
              <div className="text-center space-y-3">
                <p className="text-gray-700 font-medium">더 많은 문제가 필요하신가요?</p>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={generateQuestions}>
                  추가 문제 생성하기
                </Button>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
