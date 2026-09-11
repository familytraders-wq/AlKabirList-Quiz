import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileCheck2,
  Home,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Moon,
  PenLine,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";

type View = "home" | "audience" | "question" | "feedback" | "results" | "admin";
type Audience = "Myself" | "Our family" | "Our classroom";

const audienceCopy: Record<Audience, { detail: string; icon: typeof UsersRound }> = {
  Myself: { detail: "A quiet moment of learning, at your own pace.", icon: BookOpen },
  "Our family": { detail: "A gentle conversation starter for everyone.", icon: UsersRound },
  "Our classroom": { detail: "A ready-to-share prompt for your learners.", icon: LayoutDashboard },
};

const options = ["Al-Fatihah", "Al-Baqarah", "An-Nas", "Yasin"];

export function WarmSand() {
  const [view, setView] = useState<View>("home");
  const [audience, setAudience] = useState<Audience>("Myself");
  const [selected, setSelected] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (next: View) => {
    setMenuOpen(false);
    setView(next);
  };

  const reset = () => {
    setSelected(null);
    go("home");
  };

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#f5efe3] text-[#2a2925] selection:bg-[#b7654a]/25">
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:radial-gradient(#708267_0.7px,transparent_0.7px)] [background-size:28px_28px]" />
      <div className="relative mx-auto min-h-[100dvh] max-w-[1440px] border-x border-[#6e5b4520] bg-[#f8f3e9]/95 shadow-[0_0_100px_#8e79531c]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#6e5b4518] px-5 sm:px-10">
          <button onClick={reset} aria-label="Go to AlKabirList home" className="group flex items-center gap-3 text-left">
            <span className="grid size-10 place-items-center rounded-xl border border-[#b7654a60] bg-[#b7654a12] text-[#a9573f] transition group-hover:bg-[#b7654a25]">
              <Moon size={20} strokeWidth={1.7} />
            </span>
            <span>
              <span className="block font-[Outfit,sans-serif] text-[17px] font-semibold tracking-[-.02em]">AlKabir<span className="text-[#708267]">List</span></span>
              <span className="hidden text-[10px] uppercase tracking-[.22em] text-[#7a776c] sm:block">Community, connected</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => go("admin")} className="hidden rounded-lg px-3 py-2 text-xs text-[#716f65] transition hover:bg-[#6e5b450d] hover:text-[#2a2925] sm:block">Review studio</button>
            <button onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} className="rounded-lg p-2 text-[#65675c] hover:bg-[#6e5b4510] md:hidden">
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
            <button onClick={() => go("audience")} className="hidden items-center gap-2 rounded-lg border border-[#70826770] bg-[#70826713] px-3.5 py-2 text-xs font-semibold text-[#53664b] transition hover:bg-[#70826722] md:flex">
              Daily challenge <ArrowRight size={14} />
            </button>
          </div>
        </header>
        <AnimatePresence>
          {menuOpen && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="absolute right-4 top-[68px] z-10 w-48 rounded-xl border border-[#6e5b4526] bg-[#eee4d4] p-2 shadow-2xl md:hidden">
            <button onClick={() => go("admin")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-[#494940] hover:bg-[#6e5b450d]"><ShieldCheck size={16} /> Review studio</button>
            <button onClick={() => go("audience")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-[#494940] hover:bg-[#6e5b450d]"><Sparkles size={16} /> Daily challenge</button>
          </motion.div>}
        </AnimatePresence>

        <div className="min-h-[calc(100dvh-76px)]">
          <AnimatePresence mode="wait">
            {view === "home" && <HomeView key="home" onStart={() => go("audience")} onAdmin={() => go("admin")} />}
            {view === "audience" && <AudienceView key="audience" audience={audience} setAudience={setAudience} onBack={() => go("home")} onStart={() => go("question")} />}
            {view === "question" && <QuestionView key="question" selected={selected} setSelected={setSelected} onBack={() => go("audience")} onSubmit={() => selected && go("feedback")} />}
            {view === "feedback" && <FeedbackView key="feedback" selected={selected} onNext={() => go("results")} />}
            {view === "results" && <ResultsView key="results" audience={audience} onAgain={() => { setSelected(null); go("question"); }} onHome={reset} />}
            {view === "admin" && <AdminView key="admin" onBack={() => go("home")} />}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

function Frame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: .28, ease: "easeOut" }} className={`mx-auto max-w-6xl px-5 py-12 sm:px-10 sm:py-16 ${className}`}>{children}</motion.section>;
}

function HomeView({ onStart, onAdmin }: { onStart: () => void; onAdmin: () => void }) {
  return <Frame className="flex min-h-[calc(100dvh-76px)] flex-col justify-center">
    <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_.9fr]">
      <div>
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#b7654a45] bg-[#b7654a0e] px-3 py-1.5 text-xs text-[#98523d]"><Sparkles size={14} /> A daily pause for the whole community</div>
        <h1 className="max-w-3xl font-[Outfit,sans-serif] text-5xl font-semibold leading-[.98] tracking-[-.055em] text-[#2a2925] sm:text-7xl">Learn something<br /><span className="text-[#708267]">worth carrying.</span></h1>
        <p className="mt-7 max-w-lg text-base leading-7 text-[#69685f] sm:text-lg">The AlKabir Islamic Challenge brings one thoughtful question to your day — for curious minds, families, and classrooms.</p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <button onClick={onStart} className="group inline-flex items-center gap-3 rounded-xl bg-[#b7654a] px-5 py-3.5 text-sm font-bold text-[#fff8ed] shadow-[0_8px_28px_#b7654a25] transition hover:-translate-y-0.5 hover:bg-[#a4563f]">Begin today’s challenge <ArrowRight size={17} className="transition group-hover:translate-x-1" /></button>
          <button onClick={onAdmin} className="rounded-xl px-4 py-3 text-sm text-[#747268] hover:bg-[#6e5b450d] hover:text-[#3f4039]">For educators <ChevronRight className="ml-1 inline" size={15} /></button>
        </div>
        <div className="mt-12 flex items-center gap-5 text-xs text-[#7b7d70]"><span className="flex items-center gap-2"><LockKeyhole size={14} className="text-[#b7654a]" /> No leaderboard pressure</span><span className="h-3 w-px bg-[#6e5b4525]" /><span>2 min to reflect</span></div>
      </div>
      <div className="relative mx-auto w-full max-w-[420px]">
        <div className="absolute -inset-8 rounded-full bg-[#70826715] blur-3xl" />
        <div className="relative overflow-hidden rounded-[28px] border border-[#6e5b4530] bg-[#e9dfcf] p-7 shadow-2xl sm:p-9">
          <div className="absolute right-0 top-0 h-32 w-32 rounded-bl-full border-b border-l border-[#b7654a35] bg-[#b7654a0a]" />
          <div className="relative flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[.2em] text-[#708267]">Today · 14 Shaʿbān</span><BookOpen size={18} className="text-[#b7654a]" /></div>
          <div className="relative mt-16"><div className="mb-4 text-5xl text-[#b7654a]">“</div><p className="font-[Outfit,sans-serif] text-3xl font-medium leading-tight tracking-[-.035em] text-[#2a2925]">A little knowledge, held with sincerity, can brighten a whole home.</p><div className="mt-8 h-px bg-[#6e5b4525]" /><p className="mt-4 text-sm leading-6 text-[#69685f]">A gentle question awaits.<br />Bring your curiosity.</p></div>
        </div>
      </div>
    </div>
  </Frame>;
}

function StepHeader({ step, title, onBack }: { step: string; title: string; onBack: () => void }) {
  return <div className="mb-12 flex items-start justify-between gap-4"><button onClick={onBack} className="mt-1 rounded-lg p-2 text-[#77776c] hover:bg-[#6e5b450d] hover:text-[#34352f]" aria-label="Go back"><ArrowLeft size={19} /></button><div className="text-center"><div className="text-[10px] font-bold uppercase tracking-[.24em] text-[#708267]">{step}</div><h2 className="mt-3 font-[Outfit,sans-serif] text-3xl font-semibold tracking-[-.04em] text-[#2a2925] sm:text-4xl">{title}</h2></div><div className="w-9" /></div>;
}

function AudienceView({ audience, setAudience, onBack, onStart }: { audience: Audience; setAudience: (a: Audience) => void; onBack: () => void; onStart: () => void }) {
  return <Frame><div className="mx-auto max-w-2xl"><StepHeader step="01 · Make it yours" title="Who’s learning today?" onBack={onBack} /><p className="mx-auto mb-9 max-w-md text-center text-sm leading-6 text-[#6e6f64]">Choose a lens for this challenge. There’s no score to chase — just a moment to share or keep.</p><div className="space-y-3">{(Object.keys(audienceCopy) as Audience[]).map((item) => { const Icon = audienceCopy[item].icon; return <button key={item} onClick={() => setAudience(item)} className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${audience === item ? "border-[#708267] bg-[#70826712] shadow-[inset_3px_0_0_#708267]" : "border-[#6e5b4528] bg-[#ffffff55] hover:border-[#6e5b4560]"}`}><span className={`grid size-11 shrink-0 place-items-center rounded-xl ${audience === item ? "bg-[#70826725] text-[#53664b]" : "bg-[#6e5b450c] text-[#777b6c]"}`}><Icon size={20} /></span><span className="flex-1"><span className="block font-[Outfit,sans-serif] text-lg font-medium text-[#383832]">{item}</span><span className="mt-0.5 block text-sm text-[#77776d]">{audienceCopy[item].detail}</span></span>{audience === item && <Check size={19} className="text-[#708267]" />}</button>; })}</div><button onClick={onStart} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7654a] py-3.5 text-sm font-bold text-[#fff8ed] transition hover:bg-[#a4563f]">Let’s begin <ArrowRight size={17} /></button><p className="mt-5 flex justify-center gap-2 text-center text-xs text-[#858578]"><Info size={14} /> You can change this anytime.</p></div></Frame>;
}

function QuestionView({ selected, setSelected, onBack, onSubmit }: { selected: string | null; setSelected: (s: string) => void; onBack: () => void; onSubmit: () => void }) {
  return <Frame><div className="mx-auto max-w-2xl"><StepHeader step="02 · Today’s question" title="A beginning worth knowing" onBack={onBack} /><div className="rounded-2xl border border-[#6e5b4530] bg-[#e9dfcf] p-6 sm:p-9"><div className="mb-8 flex items-center justify-between text-xs text-[#77786d]"><span className="flex items-center gap-2"><Clock3 size={15} className="text-[#b7654a]" /> About 2 minutes</span><span>Question 1 of 1</span></div><h3 className="font-[Outfit,sans-serif] text-2xl font-medium leading-snug tracking-[-.025em] text-[#2a2925] sm:text-3xl">Which Surah opens the Qur’an?</h3><p className="mt-3 text-sm leading-6 text-[#6c6d63]">Take a breath, then choose the answer that comes to mind.</p><div className="mt-8 grid gap-3 sm:grid-cols-2">{options.map((option, i) => <button key={option} onClick={() => setSelected(option)} className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm transition ${selected === option ? "border-[#708267] bg-[#70826718] text-[#3c4c38]" : "border-[#6e5b4528] bg-[#ffffff55] text-[#5e6258] hover:border-[#6e5b4565] hover:bg-[#ffffff88]"}`}><span className={`grid size-7 place-items-center rounded-full border text-xs ${selected === option ? "border-[#708267] bg-[#708267] font-bold text-[#fffaf0]" : "border-[#6e5b4550] text-[#858779]"}`}>{String.fromCharCode(65 + i)}</span>{option}</button>)}</div><button disabled={!selected} onClick={onSubmit} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7654a] py-3.5 text-sm font-bold text-[#fff8ed] transition hover:bg-[#a4563f] disabled:cursor-not-allowed disabled:opacity-40">Check my answer <ArrowRight size={17} /></button></div><p className="mt-6 text-center text-xs text-[#858578]">A considered answer is always a good answer.</p></div></Frame>;
}

function FeedbackView({ selected, onNext }: { selected: string | null; onNext: () => void }) {
  const correct = selected === "Al-Fatihah";
  return <Frame><div className="mx-auto max-w-2xl"><div className={`mb-8 flex items-center gap-3 rounded-2xl border p-4 ${correct ? "border-[#70826770] bg-[#70826714]" : "border-[#b7654a70] bg-[#b7654a10]"}`}><span className={`grid size-10 place-items-center rounded-full ${correct ? "bg-[#708267] text-[#fffaf0]" : "bg-[#b7654a] text-[#fffaf0]"}`}>{correct ? <Check size={21} /> : <Info size={21} />}</span><div><p className="font-[Outfit,sans-serif] font-semibold text-[#383932]">{correct ? "That’s right." : "A thoughtful try."}</p><p className="text-sm text-[#6f7165]">{correct ? "You found the opening." : "The answer is Al-Fatihah."}</p></div></div><div className="rounded-2xl border border-[#6e5b4530] bg-[#e9dfcf] p-6 sm:p-9"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#708267]"><BookOpen size={15} /> Why it matters</div><h2 className="mt-5 font-[Outfit,sans-serif] text-3xl font-semibold tracking-[-.04em] text-[#2a2925]">The opening chapter</h2><p className="mt-5 text-base leading-7 text-[#5f6157]">Al-Fatihah is the first Surah of the Qur’an. Its name means “The Opening,” and it is recited in every unit of the daily prayer — a beginning we return to again and again.</p><div className="mt-7 border-l-2 border-[#b7654a] pl-4"><p className="text-sm font-medium text-[#98523d]">Source</p><p className="mt-1 text-sm text-[#6c6d62]">Qur’an — Surah Al-Fatihah</p></div></div><button onClick={onNext} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7654a] py-3.5 text-sm font-bold text-[#fff8ed] transition hover:bg-[#a4563f]">See my reflection <ArrowRight size={17} /></button></div></Frame>;
}

function ResultsView({ audience, onAgain, onHome }: { audience: Audience; onAgain: () => void; onHome: () => void }) {
  return <Frame><div className="mx-auto max-w-2xl text-center"><div className="mx-auto grid size-16 place-items-center rounded-full border border-[#b7654a70] bg-[#b7654a18] text-[#a9573f]"><Sparkles size={27} /></div><div className="mt-7 text-[10px] font-bold uppercase tracking-[.24em] text-[#708267]">Challenge complete</div><h2 className="mt-3 font-[Outfit,sans-serif] text-4xl font-semibold tracking-[-.05em] text-[#2a2925] sm:text-5xl">Keep the light moving.</h2><p className="mx-auto mt-5 max-w-md text-sm leading-6 text-[#6d6e63]">You made space for learning today, {audience.toLowerCase()}. That’s a small practice with a long reach.</p><div className="my-10 grid grid-cols-2 gap-3 text-left"><div className="rounded-2xl border border-[#6e5b4530] bg-[#e9dfcf] p-5"><div className="text-3xl font-[Outfit,sans-serif] text-[#708267]">1</div><div className="mt-1 text-xs text-[#77786c]">question explored</div></div><div className="rounded-2xl border border-[#6e5b4530] bg-[#e9dfcf] p-5"><div className="text-3xl font-[Outfit,sans-serif] text-[#b7654a]">2m</div><div className="mt-1 text-xs text-[#77786c]">time well spent</div></div></div><div className="flex flex-col gap-3 sm:flex-row"><button onClick={onAgain} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#70826770] bg-[#70826713] py-3.5 text-sm font-semibold text-[#53664b] hover:bg-[#70826722]"><BookOpen size={17} /> Explore again</button><button onClick={onHome} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#b7654a] py-3.5 text-sm font-bold text-[#fff8ed] hover:bg-[#a4563f]"><Home size={17} /> Return home</button></div><p className="mt-8 text-xs text-[#858578]">Tomorrow, another door opens.</p></div></Frame>;
}

function AdminView({ onBack }: { onBack: () => void }) {
  const [approved, setApproved] = useState(false);
  return <Frame><div className="mx-auto max-w-5xl"><div className="mb-10 flex items-center justify-between"><div><button onClick={onBack} className="mb-5 flex items-center gap-2 text-xs text-[#74766b] hover:text-[#34352f]"><ArrowLeft size={15} /> Back to challenge</button><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#b7654a18] text-[#a9573f]"><ShieldCheck size={21} /></span><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#708267]">Admin workspace</div><h2 className="mt-1 font-[Outfit,sans-serif] text-3xl font-semibold tracking-[-.04em] text-[#2a2925]">Review studio</h2></div></div></div><span className="rounded-full border border-[#b7654a55] bg-[#b7654a0f] px-3 py-1.5 text-xs text-[#98523d]">3 pending</span></div><div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-[#6e5b4530] bg-[#e9dfcf] p-6 sm:p-8"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#708267]"><CircleHelp size={15} /> AI suggestion</span><span className="text-xs text-[#858578]">Just now</span></div><h3 className="mt-7 font-[Outfit,sans-serif] text-2xl font-medium leading-snug text-[#2a2925]">Which Surah opens the Qur’an?</h3><div className="mt-6 space-y-2">{options.slice(0, 3).map((o, i) => <div key={o} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${i === 0 ? "border-[#70826770] bg-[#70826712] text-[#53664b]" : "border-[#6e5b4526] text-[#77786d]"}`}><span>{o}</span>{i === 0 && <Check size={15} />}</div>)}</div><div className="mt-7 rounded-xl border border-[#b7654a45] bg-[#b7654a0c] p-4"><div className="flex gap-2 text-xs font-semibold text-[#98523d]"><Info size={14} className="mt-0.5 shrink-0" /> Suggested source</div><p className="mt-2 text-sm text-[#68695f]">Qur’an — Surah Al-Fatihah</p></div><div className="mt-7 flex gap-3"><button onClick={() => setApproved(true)} disabled={approved} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#b7654a] py-3 text-sm font-bold text-[#fff8ed] hover:bg-[#a4563f] disabled:opacity-50">{approved ? <><Check size={16} /> Approved</> : <><FileCheck2 size={16} /> Approve question</>}</button><button onClick={() => setApproved(false)} className="rounded-xl border border-[#6e5b4535] px-4 text-[#77786d] hover:bg-[#6e5b450d]" aria-label="Edit question"><PenLine size={17} /></button></div></div><aside className="space-y-3"><div className="rounded-2xl border border-[#6e5b4526] bg-[#ffffff55] p-6"><div className="text-xs font-bold uppercase tracking-[.18em] text-[#74786c]">Review checklist</div><div className="mt-5 space-y-4 text-sm text-[#66695e]"><div className="flex gap-3"><Check size={17} className="text-[#708267]" /> Factually grounded</div><div className="flex gap-3"><Check size={17} className="text-[#708267]" /> Family-friendly language</div><div className="flex gap-3"><Check size={17} className="text-[#708267]" /> Source attached</div><div className="flex gap-3 text-[#85877b]"><Clock3 size={17} /> Awaiting human review</div></div></div><div className="rounded-2xl border border-[#6e5b4526] bg-[#ffffff55] p-6"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#74786c]"><UsersRound size={15} /> Community care</div><p className="mt-4 text-sm leading-6 text-[#73756a]">AI can suggest. A trusted reviewer decides what reaches the community.</p></div></aside></div></div></Frame>;
}

export default WarmSand;