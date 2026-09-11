import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { 
  BookOpen, 
  Sprout, 
  Users, 
  Heart, 
  CalendarDays,
  ArrowRight,
  TrendingUp,
  GraduationCap,
  User,
} from "lucide-react";
import heroArch from "@assets/generated_images/hero_arch.jpg";
import topicQuran from "@assets/generated_images/topic_quran.jpg";
import topicSeerah from "@assets/generated_images/topic_seerah.jpg";
import topicProphets from "@assets/generated_images/topic_prophets.jpg";
import topicHistory from "@assets/generated_images/topic_history.jpg";

export function Home() {
  const [, setLocation] = useLocation();
  const [activeLevel, setActiveLevel] = useState<string>("Adult");

  const levels = [
    { id: "k2", name: "K - 2", desc: "Ages 5-7", icon: Sprout, color: "bg-[#E6F4EA] text-[#2E6B47]" },
    { id: "g35", name: "Grades 3-5", desc: "Ages 8-10", icon: BookOpen, color: "bg-[#FDF0D5] text-[#8C6D31]" },
    { id: "g68", name: "Grades 6-8", desc: "Ages 11-13", icon: TrendingUp, color: "bg-[#E2F1ED] text-[#297061]" },
    { id: "g912", name: "Grades 9-12", desc: "Ages 14-18", icon: GraduationCap, color: "bg-[#EAE4F2] text-[#4A3B69]" },
    { id: "Adult", name: "Adult", desc: "Lifelong learner", icon: User, color: "bg-[#FBE9E7] text-[#8A4A43]" },
    { id: "Family", name: "Family", desc: "Learn together", icon: Users, color: "bg-[#E3EAF4] text-[#365486]" },
  ];

  const topics = [
    { id: "quran", title: "Qur'an", desc: "Guidance for life", image: topicQuran },
    { id: "seerah", title: "Seerah", desc: "Lessons from a noble life", image: topicSeerah },
    { id: "prophets", title: "Prophets", desc: "Stories of faith and perseverance", image: topicProphets },
    { id: "history", title: "Islamic History", desc: "People, places and lasting lessons", image: topicHistory },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Navbar />
      
      <main className="flex-1 w-full pb-20">
        {/* Hero Section */}
        <div className="w-full bg-primary text-primary-foreground relative pt-12 pb-32 md:pb-40 px-6 overflow-hidden">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-12 lg:gap-24 items-center">
            
            {/* Left Content */}
            <div className="flex-1 space-y-6 md:pr-10 z-10">
              <p className="text-accent text-xs font-bold tracking-[0.2em] uppercase">
                AlKabir Islamic Challenge
              </p>
              
              <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl leading-[1.1] text-white">
                A little knowledge.<br />
                <span className="text-secondary/90">A daily connection.</span>
              </h1>
              
              <p className="text-lg md:text-xl text-primary-foreground/80 max-w-md font-sans">
                Discover, learn, and grow together.<br />
                One challenge at a time.
              </p>
              
              {/* Feature Icons */}
              <div className="flex flex-wrap gap-8 pt-6 border-t border-white/10 mt-8">
                <div className="flex flex-col gap-2 text-white/90">
                  <BookOpen className="w-6 h-6 text-accent" />
                  <div className="text-xs uppercase tracking-wider font-semibold">Learn</div>
                  <div className="text-xs text-white/60">Something new</div>
                </div>
                <div className="flex flex-col gap-2 text-white/90">
                  <Sprout className="w-6 h-6 text-accent" />
                  <div className="text-xs uppercase tracking-wider font-semibold">Grow</div>
                  <div className="text-xs text-white/60">In faith</div>
                </div>
                <div className="flex flex-col gap-2 text-white/90">
                  <Users className="w-6 h-6 text-accent" />
                  <div className="text-xs uppercase tracking-wider font-semibold">Together</div>
                  <div className="text-xs text-white/60">As a community</div>
                </div>
                <div className="flex flex-col gap-2 text-white/90">
                  <Heart className="w-6 h-6 text-accent" />
                  <div className="text-xs uppercase tracking-wider font-semibold">A Brighter</div>
                  <div className="text-xs text-white/60">Tomorrow</div>
                </div>
              </div>
            </div>
            
            {/* Right Image */}
            <div className="flex-1 w-full relative z-10 aspect-[4/3] md:aspect-[4/5] lg:aspect-[3/4] max-h-[600px] rounded-t-full overflow-hidden shadow-2xl shadow-black/40 border-8 border-white/5">
              <img 
                src={heroArch} 
                alt="Luminous Islamic archway" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent opacity-60" />
            </div>

            {/* Decorative Background Elements */}
            <div className="absolute top-0 right-0 w-full h-full pointer-events-none opacity-5">
              {/* Abstract subtle geometric texture could go here if needed */}
            </div>
          </div>
        </div>

        {/* Overlapping Challenge Card */}
        <div className="max-w-6xl mx-auto px-6 -mt-24 md:-mt-32 relative z-20">
          <div className="bg-card rounded-2xl shadow-xl border border-border p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
            <div className="flex gap-5 items-start">
              <div className="bg-secondary/50 w-14 h-14 rounded-xl flex items-center justify-center shrink-0">
                <CalendarDays className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="font-serif text-2xl font-semibold text-foreground">Today's Islamic Challenge</h2>
                <p className="text-sm font-medium text-muted-foreground">5 questions &bull; About 2 minutes</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-md hidden md:block leading-relaxed">
                  A new set of questions each day to help you learn, reflect, and stay connected.
                </p>
              </div>
            </div>
            
            <div className="flex flex-col items-center gap-3 w-full md:w-auto">
              <button 
                onClick={() => setLocation("/quiz")}
                className="bg-primary hover:bg-primary/90 text-primary-foreground w-full md:w-auto px-8 py-3.5 rounded-full font-medium flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-95"
                data-testid="button-start-challenge"
              >
                Start Today's Challenge <ArrowRight className="w-4 h-4" />
              </button>
              <button 
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors"
                onClick={() => setLocation("/quiz")}
                data-testid="button-play-guest"
              >
                Play as a guest
              </button>
            </div>
            
            <div className="hidden lg:flex flex-col items-end border-l border-border/60 pl-8 ml-4 shrink-0">
              <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase text-right leading-relaxed">
                Same<br/>Curiosity<br/>A Brighter<br/>You
              </p>
            </div>
          </div>
        </div>

        {/* Who is learning? */}
        <div className="max-w-7xl mx-auto px-6 mt-20">
          <div className="mb-6">
            <h3 className="font-serif text-2xl font-semibold text-foreground">Who is learning?</h3>
            <p className="text-muted-foreground">Choose a level to get questions that fit your journey.</p>
          </div>
          
          <div className="flex overflow-x-auto pb-4 -mx-6 px-6 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible gap-3 no-scrollbar scroll-smooth">
            {levels.map((level) => {
              const Icon = level.icon;
              const isActive = activeLevel === level.id;
              
              return (
                <button
                  key={level.id}
                  onClick={() => setActiveLevel(level.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    isActive 
                      ? 'border-primary shadow-sm bg-white' 
                      : 'border-transparent bg-secondary/30 hover:bg-secondary/60 opacity-80 hover:opacity-100'
                  } whitespace-nowrap shrink-0`}
                  data-testid={`button-level-${level.id}`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${level.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="text-left flex flex-col justify-center">
                    <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-foreground' : 'text-foreground/80'}`}>
                      {level.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {level.desc}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Explore by topic */}
        <div className="max-w-7xl mx-auto px-6 mt-16">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h3 className="font-serif text-2xl font-semibold text-foreground">Explore by topic</h3>
              <p className="text-muted-foreground">Timeless subjects. Meaningful knowledge.</p>
            </div>
            <button className="hidden md:flex text-sm font-medium text-foreground hover:text-primary items-center gap-1">
              View all topics <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topics.map((topic) => (
              <button 
                key={topic.id}
                className="group relative h-40 rounded-xl overflow-hidden border border-border text-left hover:shadow-md transition-all active:scale-[0.98]"
                data-testid={`card-topic-${topic.id}`}
              >
                {/* Background Image */}
                <img 
                  src={topic.image} 
                  alt={topic.title}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                
                {/* Gradient overlay for readability */}
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-transparent w-4/5" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent" />
                
                {/* Content */}
                <div className="absolute inset-0 p-5 flex flex-col justify-between z-10">
                  <div className="space-y-1">
                    <h4 className="font-serif text-lg font-semibold text-foreground">
                      {topic.title}
                    </h4>
                    <p className="text-xs text-muted-foreground font-medium pr-8">
                      {topic.desc}
                    </p>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-white/50 backdrop-blur flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors border border-border/50">
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer / Community Banner */}
        <div id="community" className="max-w-7xl mx-auto px-6 mt-16 scroll-mt-24">
          <div className="bg-primary text-primary-foreground rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
            {/* Subtle overlay pattern */}
            <div className="absolute top-0 right-0 w-1/2 h-full opacity-10 rotate-12 scale-150 pointer-events-none">
               <svg viewBox="0 0 100 100" fill="currentColor">
                 <polygon points="50,0 100,50 50,100 0,50" />
                 <circle cx="50" cy="50" r="20" />
               </svg>
            </div>
            
            <div className="flex gap-4 items-start z-10">
              <div className="bg-white/10 w-12 h-12 rounded-xl flex items-center justify-center shrink-0">
                <Users className="w-6 h-6 text-accent" />
              </div>
              <div>
                <h3 className="font-serif text-xl font-semibold">Connected through community</h3>
                <p className="text-sm text-primary-foreground/80 mt-1 max-w-md">
                  Explore masjids, Islamic schools, businesses and more in your area.
                </p>
              </div>
            </div>
            
            <button className="z-10 text-sm font-medium text-accent hover:text-white flex items-center gap-2 underline underline-offset-4 decoration-accent/30 hover:decoration-white transition-all">
              Explore community listings <ArrowRight className="w-4 h-4" />
            </button>
            
            <div className="hidden lg:block z-10 border-l border-white/20 pl-6 text-[10px] font-bold tracking-[0.15em] uppercase text-white/60 text-right leading-tight">
              Stronger<br/>People<br/>Brighter Days
            </div>
          </div>
        </div>
        
        <div id="about" className="mt-16 text-center text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase flex items-center justify-center gap-4">
          <span>Same Knowledge</span>
          <span className="w-1 h-1 rounded-full bg-border" />
          <span>Stronger Communities</span>
          <span className="w-1 h-1 rounded-full bg-border" />
          <span>A Kinder Tomorrow</span>
        </div>
      </main>
    </div>
  );
}
