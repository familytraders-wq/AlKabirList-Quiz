type UmamiTrack = (eventName: string, eventData?: Record<string, unknown>) => void;

declare global {
  interface Window {
    umami?: { track: UmamiTrack };
  }
}

function safeTrack(eventName: string, eventData?: Record<string, unknown>) {
  try {
    if (typeof window !== "undefined" && window.umami) {
      window.umami.track(eventName, eventData);
    }
  } catch (e) {
    // no-op on error
  }
}

export const analytics = {
  feedbackSubmitted: (kind: string) => safeTrack("feedback_submitted", { kind }),
  questionReported: () => safeTrack("question_reported"),
  feedbackModerated: (status: string) => safeTrack("feedback_moderated", { status }),
  onboardingCompleted: () => safeTrack("onboarding_completed"),
  quizStarted: () => safeTrack("quiz_started"),
  quizCompleted: () => safeTrack("quiz_completed"),
};
