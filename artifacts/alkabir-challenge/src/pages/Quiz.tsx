import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  challengeQuestions,
  formatChallengeDateUTC,
  formatNextChallengeReset,
  getChallengeDate,
} from "@/data/quiz";
import { Menu, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, XCircle } from "lucide-react";

export function Quiz() {
  const [, setLocation] = useLocation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'answering' | 'feedback' | 'finished'>('answering');
  const [score, setScore] = useState(0);
  const challengeDate = formatChallengeDateUTC(getChallengeDate());
  const nextReset = formatNextChallengeReset();

  const question = challengeQuestions[currentIndex];
  const progressPercent = Math.round(((currentIndex + 1) / challengeQuestions.length) * 100);

  const handleSubmit = () => {
    if (!selectedId || status !== 'answering') return;
    
    const isCorrect = question.options.find(o => o.id === selectedId)?.isCorrect;
    if (isCorrect) setScore(s => s + 1);
    
    setStatus('feedback');
  };

  const handleNext = () => {
    if (currentIndex < challengeQuestions.length - 1) {
      setCurrentIndex(i => i + 1);
      setSelectedId(null);
      setStatus('answering');
    } else {
      setStatus('finished');
    }
  };

  if (status === 'finished') {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <QuizHeader />
        <main className="flex-1 w-full max-w-lg mx-auto px-6 py-12 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-primary" />
          </div>
          <h1 className="font-serif text-3xl font-semibold mb-3">Alhamdulillah</h1>
          <p className="text-muted-foreground mb-8">
            You've completed today's challenge. Every moment spent seeking knowledge is a step toward a brighter tomorrow.
          </p>
          <div className="bg-secondary/40 border border-border/60 rounded-xl p-4 w-full mb-6 text-left">
            <div className="flex items-start gap-3">
              <CalendarClock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground">Challenge date: {challengeDate}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The next challenge opens at midnight UTC. For you, that is {nextReset}.
                </p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6 w-full mb-8 shadow-sm">
            <div className="text-4xl font-serif text-primary mb-1">{score}/{challengeQuestions.length}</div>
            <div className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Correct Answers</div>
          </div>
          <button 
            onClick={() => setLocation("/")}
            className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-medium flex justify-center items-center gap-2 hover:bg-primary/90 transition-colors"
            data-testid="button-return-home"
          >
            Return to Home
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <QuizHeader />
      
      <main className="flex-1 w-full max-w-lg mx-auto px-6 py-6 flex flex-col">
        {/* Back Link */}
        <button 
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 w-fit transition-colors"
          data-testid="button-back-challenge"
        >
          <ArrowLeft className="w-4 h-4" /> Today's challenge
        </button>

        <div className="bg-secondary/40 border border-border/60 rounded-xl p-4 mb-8">
          <div className="flex items-start gap-3">
            <CalendarClock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">{challengeDate}</p>
              <p className="text-xs text-muted-foreground mt-1">
                This challenge is shared worldwide. The next reset is at midnight UTC ({nextReset} for you).
              </p>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-10">
          <div className="flex justify-between text-sm font-medium mb-3">
            <span className="text-muted-foreground">Question {currentIndex + 1} of {challengeQuestions.length}</span>
            <span className="text-foreground">{progressPercent}%</span>
          </div>
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Question Area */}
        <div className="flex-1">
          <h2 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-8 leading-tight">
            {question.text}
          </h2>

          <div className="space-y-3">
            {question.options.map(option => {
              const isSelected = selectedId === option.id;
              
              let stateStyles = "border-border bg-card hover:bg-secondary/30";
              let circleStyles = "border-border";
              
              if (isSelected && status === 'answering') {
                stateStyles = "border-primary bg-primary/5 ring-1 ring-primary/20";
                circleStyles = "border-primary border-[5px]";
              } else if (status === 'feedback') {
                if (option.isCorrect) {
                  stateStyles = "border-emerald-600 bg-emerald-50";
                  circleStyles = "border-emerald-600 bg-emerald-600 text-white";
                } else if (isSelected && !option.isCorrect) {
                  stateStyles = "border-destructive bg-destructive/5 opacity-50";
                  circleStyles = "border-destructive bg-destructive text-white";
                } else {
                  stateStyles = "border-border bg-card opacity-50";
                }
              }

              return (
                <button
                  key={option.id}
                  onClick={() => status === 'answering' && setSelectedId(option.id)}
                  disabled={status !== 'answering'}
                  className={`w-full text-left p-4 rounded-xl border flex items-center gap-4 transition-all ${stateStyles}`}
                  data-testid={`option-${option.id}`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${circleStyles}`}>
                    {status === 'feedback' && option.isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600 bg-white rounded-full" />}
                    {status === 'feedback' && isSelected && !option.isCorrect && <XCircle className="w-4 h-4 text-white" />}
                  </div>
                  <span className="font-medium text-foreground">{option.label}</span>
                </button>
              );
            })}
          </div>

          {status === 'feedback' && (
            <div className="mt-8 p-5 bg-secondary/40 rounded-xl border border-border/50 animate-in fade-in slide-in-from-bottom-2">
              <div className="text-xs font-bold tracking-widest text-primary uppercase mb-2">
                {question.sourceLabel}
              </div>
              <p className="text-sm text-foreground leading-relaxed">
                {question.explanation}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-8 pt-8">
          {status === 'answering' ? (
            <button
              onClick={handleSubmit}
              disabled={!selectedId}
              className={`w-full py-4 rounded-xl font-medium flex justify-center items-center gap-2 transition-all ${
                selectedId 
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md' 
                  : 'bg-secondary text-muted-foreground cursor-not-allowed'
              }`}
              data-testid="button-submit-answer"
            >
              Submit answer <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-medium flex justify-center items-center gap-2 hover:bg-primary/90 shadow-md transition-all"
              data-testid="button-next-question"
            >
              {currentIndex < challengeQuestions.length - 1 ? 'Next question' : 'See results'} <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {status === 'answering' && (
            <p className="text-center text-xs text-muted-foreground mt-6 px-4">
              Take your time.<br className="md:hidden" /> Every question is a chance to learn.
            </p>
          )}
          
          {status === 'feedback' && (
            <p className="text-center text-xs text-muted-foreground uppercase tracking-widest mt-6 px-4">
              Knowledge Builds Brighter Days
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function QuizHeader() {
  const [, setLocation] = useLocation();
  return (
    <header className="w-full bg-white border-b border-border/40">
      <div className="max-w-lg mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2" data-testid="link-quiz-home">
          <div className="w-7 h-7 flex items-center justify-center text-primary relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full">
              <path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" />
              <path d="M12 5.5L13.5 9.5L17.5 11L13.5 12.5L12 16.5L10.5 12.5L6.5 11L10.5 9.5L12 5.5Z" className="opacity-50" />
            </svg>
          </div>
          <span className="font-serif font-semibold text-lg tracking-tight text-foreground">
            AlKabirList
          </span>
        </Link>
        <button className="text-foreground p-2 -mr-2">
          <Menu className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
