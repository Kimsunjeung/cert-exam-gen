"use client"

import { useMemo, useState } from "react"
import {
  Upload,
  FileText,
  Loader2,
  ChevronRight,
  AlertCircle,
  Download,
  Clock,
  X,
  Badge as BadgeIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Step = "upload" | "analyzing" | "select-type" | "generating" | "generated"
type QuestionType = "mixed" | "multiple-choice" | "true-false" | "essay"
type Difficulty = "easy" | "medium" | "medium-high" | "high"

interface Question {
  id: number
  type?: string
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
  numQuestions: number
  difficulty: Difficulty
  questions: Question[]
  qualityScores: QualityScores | null
  fileName: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

const questionTypeLabels: Record<QuestionType, string> = {
  mixed: "혼합",
  "multiple-choice": "객관식",
  "true-false": "참/거짓",
  essay: "서술형",
}

const difficultyLabels: Record<Difficulty, string> = {
  easy: "쉬움",
  medium: "중간",
  "medium-high": "중상",
  high: "어려움",
}

/** 보기 접두(①, A), 1) 등) 제거 */
const stripChoicePrefix = (s: string) =>
  String(s ?? "")
    .replace(/^\s*[A-D]\s*[\)\.\s]\s*/i, "")
    .replace(/^\s*[①-⑳]\s*/, "")
    .replace(/^\s*\(?\d{1,2}\)?[\.\)]?\s+/, "")
    .trim()

/** 문제 본문 블록화 (라인형 + 괄호형 인라인) */
function formatQuestionText(text: string): JSX.Element {
  if (!text) return <></>

  const lines = text.split(/\r?\n/)
  const codeStart = /(public\s+class|static\s+void|int\s+main|\{|\};?|\);?)/i
  const blockRegex = /^(연산|조건|예시|설명|참고)\s*[:：]\s*(.*)$/
  const inlineOps = /(?:연산|다음\s*연산)\s*\(([^)]+)\)/gi

  const renderInline = (s: string, key: number) => {
    const parts: JSX.Element[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = inlineOps.exec(s)) !== null) {
      const [full, inside] = m
      const start = m.index
      if (start > last) parts.push(<span key={`${key}-txt-${start}`}>{s.slice(last, start)}</span>)
      parts.push(
        <span
          key={`${key}-op-${start}`}
          className="mx-1 px-2 py-0.5 rounded bg-gray-100 border border-gray-200 font-mono text-[0.95em]"
        >
          연산: {inside}
        </span>
      )
      last = start + full.length
    }
    if (last < s.length) parts.push(<span key={`${key}-end`}>{s.slice(last)}</span>)
    return <>{parts}</>
  }

  const elements: JSX.Element[] = []
  let codeBuffer: string[] = []

  const flushCode = (key: string) => {
    if (codeBuffer.length > 0) {
      elements.push(
        <pre
          key={`code-${key}`}
          className="bg-gray-50 border border-gray-200 rounded-md p-3 font-mono text-sm whitespace-pre-wrap overflow-x-auto my-2"
        >
          <code>{codeBuffer.join("\n")}</code>
        </pre>
      )
      codeBuffer = []
    }
  }

  lines.forEach((line, idx) => {
    const blk = line.match(blockRegex)
    if (blk) {
      flushCode(`blk-${idx}`)
      elements.push(
        <div
          key={`blk-${idx}`}
          className={blk[1] === "연산"
            ? "my-2 p-3 rounded-md border bg-gray-100 border-gray-200 font-mono text-sm"
            : "my-2 p-3 rounded-md border bg-blue-50 border-blue-200"}
        >
          <span className="font-semibold">{blk[1]}:</span> {blk[2]}
        </div>
      )
    } else if (codeStart.test(line.trim())) {
      codeBuffer.push(line)
    } else {
      flushCode(`txt-${idx}`)
      if (line.trim() !== "") {
        elements.push(
          <p key={`ln-${idx}`} className="my-1 text-gray-900 leading-relaxed">
            {renderInline(line, idx)}
          </p>
        )
      }
    }
  })

  flushCode("end")
  return <>{elements}</>
}

export default function ExamGenerator() {
  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [filePath, setFilePath] = useState<string>("")

  const [questionType, setQuestionType] = useState<QuestionType>("mixed")
  const [difficulty, setDifficulty] = useState<Difficulty>("medium-high")
  const [questionCount, setQuestionCount] = useState<number>(30)

  const [questions, setQuestions] = useState<Question[]>([])
  const [qualityScores, setQualityScores] = useState<QualityScores | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string>("")

  const [questionHistory, setQuestionHistory] = useState<QuestionSet[]>([])
  const [currentSetId, setCurrentSetId] = useState<string | null>(null)

  const avgScore = useMemo(() => {
    if (!qualityScores) return null
    const { faithfulness, answer_relevancy, context_precision, context_recall } = qualityScores
    return (faithfulness + answer_relevancy + context_precision + context_recall) / 4
  }, [qualityScores])

  /** 파일 업로드 (선택 & 드래그 모두 사용) */
  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile)
    setStep("analyzing")
    setError("")

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)

      const resp = await fetch(`${API_URL}/api/upload`, { method: "POST", body: formData })
      if (!resp.ok) throw new Error(`서버 오류: ${resp.status}`)

      const contentType = resp.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) throw new Error("서버 응답 형식 오류")

      const data = await resp.json()
      if (data.success) {
        setFilePath(data.file_path)
        setStep("select-type")
      } else {
        throw new Error(data.error || "파일 업로드 실패")
      }
    } catch (e: any) {
      setError(e?.message ?? "파일 업로드 중 오류가 발생했습니다")
      setStep("upload")
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFileSelect(f)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }

  /** 문제 생성 */
  const generateQuestions = async () => {
    setStep("generating")
    setError("")

    try {
      const form = new FormData()
      form.append("file_path", filePath)
      form.append("question_type", questionType)
      form.append("num_questions", String(Math.max(5, Math.min(50, questionCount))))
      form.append("difficulty", difficulty)

      const resp = await fetch(`${API_URL}/api/generate-questions`, { method: "POST", body: form })
      if (!resp.ok) throw new Error(`서버 오류: ${resp.status}`)

      const contentType = resp.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) throw new Error("서버 응답 형식 오류")

      const data = await resp.json()
      if (!data.success) throw new Error(data.error || "문제 생성 실패")

      // 보기 접두 정리(중복 방지)
      const normalized = (data.questions as any[]).map((q) => ({
        ...q,
        options: Array.isArray(q.options) ? q.options.map(stripChoicePrefix) : q.options,
        showAnswer: false,
      }))

      const newSetId = `set-${Date.now()}`
      const set: QuestionSet = {
        id: newSetId,
        timestamp: new Date(),
        questionType,
        numQuestions: Math.max(5, Math.min(50, questionCount)),
        difficulty,
        questions: normalized,
        qualityScores: data.quality_scores,
        fileName: file?.name || "문제집",
      }

      setQuestionHistory((prev) => [set, ...prev])
      setCurrentSetId(newSetId)
      setQuestions(normalized)
      setQualityScores(data.quality_scores || null)
      setStep("generated")
    } catch (e: any) {
      setError(e?.message ?? "문제 생성 중 오류가 발생했습니다")
      setStep("select-type")
    }
  }

  /** 정답 토글 */
  const toggleAnswer = (id: number) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, showAnswer: !q.showAnswer } : q)))
  }

  /** 세트 전환/삭제 */
  const switchToSet = (setId: string) => {
    const set = questionHistory.find((s) => s.id === setId)
    if (!set) return
    setCurrentSetId(setId)
    setQuestions(set.questions)
    setQualityScores(set.qualityScores)
    setQuestionType(set.questionType)
    setQuestionCount(set.numQuestions)
    setDifficulty(set.difficulty)
    setStep("generated")
  }

  const deleteSet = (setId: string) => {
    setQuestionHistory((prev) => prev.filter((s) => s.id !== setId))
    if (currentSetId === setId) {
      const left = questionHistory.filter((s) => s.id !== setId)
      if (left[0]) switchToSet(left[0].id)
      else {
        setQuestions([])
        setQualityScores(null)
        setCurrentSetId(null)
        setStep("select-type")
      }
    }
  }

  /** 다운로드(JSON) */
  const handleDownload = () => {
    if (questions.length === 0) return
    const payload = {
      fileName: file?.name || "문제집",
      questionType: questionTypeLabels[questionType],
      difficulty: difficultyLabels[difficulty],
      generatedAt: new Date().toISOString(),
      qualityScores: qualityScores
        ? {
            faithfulness: `${(qualityScores.faithfulness * 100).toFixed(1)}%`,
            answer_relevancy: `${(qualityScores.answer_relevancy * 100).toFixed(1)}%`,
            context_precision: `${(qualityScores.context_precision * 100).toFixed(1)}%`,
            context_recall: `${(qualityScores.context_recall * 100).toFixed(1)}%`,
            average: avgScore ? `${(avgScore * 100).toFixed(1)}%` : null,
          }
        : null,
      questions: questions.map((q) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        options: q.options || [],
        answer: q.answer,
        explanation: q.explanation || "",
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${questionTypeLabels[questionType]}_${difficultyLabels[difficulty]}_${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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

        {/* 업로드 */}
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
                    className={cn(
                      "w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                      isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white",
                    )}
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

        {/* 분석 대기 */}
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

        {/* 유형/난이도/문항 선택 */}
        {step === "select-type" && (
          <div className="grid lg:grid-cols-[1fr,420px] gap-6">
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
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <h2 className="text-lg font-bold text-gray-900">문항 옵션</h2>
                </div>

                {/* 문제 유형 */}
                <div className="mb-6">
                  <p className="text-sm text-gray-600 mb-2">문제 유형</p>
                  <RadioGroup value={questionType} onValueChange={(v) => setQuestionType(v as QuestionType)}>
                    <div className="space-y-2">
                      {(["mixed", "multiple-choice", "true-false", "essay"] as QuestionType[]).map((k) => (
                        <div
                          key={k}
                          className="flex items-center space-x-3 p-3 rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-colors cursor-pointer"
                        >
                          <RadioGroupItem value={k} id={`type-${k}`} />
                          <Label htmlFor={`type-${k}`} className="flex-1 cursor-pointer font-medium">
                            {questionTypeLabels[k]} {k === "mixed" && <span className="text-xs text-blue-600">(권장)</span>}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                </div>

                {/* 난이도 */}
                <div className="mb-6">
                  <p className="text-sm text-gray-600 mb-2">난이도</p>
                  <RadioGroup value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                    <div className="grid grid-cols-2 gap-2">
                      {(["easy", "medium", "medium-high", "high"] as Difficulty[]).map((d) => (
                        <div
                          key={d}
                          className="flex items-center space-x-3 p-3 rounded-lg border-2 border-gray-200 hover:border-blue-300 transition-colors cursor-pointer"
                        >
                          <RadioGroupItem value={d} id={`diff-${d}`} />
                          <Label htmlFor={`diff-${d}`} className="flex-1 cursor-pointer font-medium">
                            {difficultyLabels[d]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                </div>

                {/* 문항 수 */}
                <div className="mb-2">
                  <p className="text-sm text-gray-600 mb-2">문항 수 (5~50)</p>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={5}
                      max={50}
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Number(e.target.value))}
                      className="w-28"
                    />
                    <span className="text-sm text-gray-500">기본값 30</span>
                  </div>
                </div>

                <Button className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white" size="lg" onClick={generateQuestions}>
                  문제 생성하기
                  <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </Card>
            </div>
          </div>
        )}

        {/* 생성 중 */}
        {step === "generating" && (
          <div className="max-w-2xl mx-auto">
            <Card className="p-12">
              <div className="flex flex-col items-center gap-6">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                </div>

                <div className="text-center space-y-2">
                  <h3 className="text-xl font-bold text-gray-900">문제 생성 중...</h3>
                  <p className="text-gray-600">
                    유형: {questionTypeLabels[questionType]} / 난이도: {difficultyLabels[difficulty]} / 문항: {questionCount}
                  </p>
                  <p className="text-sm text-gray-500">RAGAS 품질 평가 진행 중</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* 결과 */}
        {step === "generated" && (
          <div className="space-y-6">
            {questionHistory.length > 1 && (
              <Card className="p-4 bg-white border-2 border-blue-100">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-gray-900">생성 히스토리 ({questionHistory.length}개)</h3>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {questionHistory.map((set) => (
                    <div
                      key={set.id}
                      className={cn(
                        "flex-shrink-0 p-3 rounded-lg border-2 cursor-pointer transition-all",
                        currentSetId === set.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300 bg-white",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-[220px]" onClick={() => switchToSet(set.id)}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-blue-600">{questionTypeLabels[set.questionType]}</span>
                            <span className="text-xs text-gray-500">{set.numQuestions}문항</span>
                            <span className="text-xs text-gray-500">/ {difficultyLabels[set.difficulty]}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{set.fileName}</p>
                          <p className="text-xs text-gray-500">
                            {set.timestamp.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">충실도</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {(qualityScores.faithfulness * 100).toFixed(0)}%
                    </p>
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
                  <div className="bg-white p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">평균</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {avgScore !== null ? (avgScore * 100).toFixed(0) : "0"}%
                    </p>
                  </div>
                </div>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-gray-900">
                  {questionTypeLabels[questionType]} 문제 ({questions.length}개)
                </h2>
                <div className="hidden md:flex items-center gap-1 text-sm text-gray-500">
                  <BadgeIcon className="w-4 h-4" />
                  <span>
                    난이도 {difficultyLabels[difficulty]} / 문항 {questionCount}
                  </span>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleDownload} className="flex items-center gap-2 bg-transparent">
                <Download className="w-4 h-4" />
                다운로드
              </Button>
            </div>

            <div className="grid gap-4">
              {questions.map((q, idx) => (
                <Card key={q.id} className="p-6 bg-white border-2 border-gray-100 hover:border-blue-200 transition-colors">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </span>
                      <div className="flex-1 text-gray-900 font-medium leading-relaxed">
                        {formatQuestionText(q.question)}
                      </div>
                      {q.type && (
                        <span className="ml-2 text-xs px-2 py-1 rounded bg-gray-50 border text-gray-600">{q.type}</span>
                      )}
                    </div>

                    {Array.isArray(q.options) && q.options.length > 0 && (
                      <div className="ml-11 space-y-2">
                        {q.options.map((opt, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-gray-600 font-medium">{`(${i + 1})`}</span>
                            <span className="text-gray-700">{opt}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="ml-11 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleAnswer(q.id)}
                        className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        {q.showAnswer ? "정답 숨기기" : "정답 보기"}
                      </Button>

                      {q.showAnswer && (
                        <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
                          <p className="text-green-800 font-medium">정답: {q.answer}</p>
                          {q.explanation && <p className="text-green-700 text-sm">{q.explanation}</p>}
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
