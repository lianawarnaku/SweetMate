export type OnboardingFlow = "create" | "join" | "preferences";
export type OnboardingContext = "first_household" | "additional_household";
export type OnboardingStep = "details" | "home" | "essentials" | "items" | "review" | "join" | "preferences";
export type OnboardingOutcome = "continued" | "skipped" | "browsed";
type FlowProperties = { flow: OnboardingFlow; context: OnboardingContext };
type StepProperties = FlowProperties & { step: OnboardingStep };
type Emitters = {
  started: (properties: FlowProperties & { resumed: boolean }) => void;
  viewed: (properties: StepProperties) => void;
  stepCompleted: (properties: StepProperties & { outcome: OnboardingOutcome }) => void;
  completed: (properties: FlowProperties) => void;
  cancelled: (properties: StepProperties) => void;
};

// Navigation replaces the setup screen after creating a household and after
// Essentials. Keep this small, content-free state across those remounts so one
// flow is not reported as several starts and its original context is retained.
export function createOnboardingAnalyticsTracker(emit: Emitters) {
  type FlowState = {
    lastStep: OnboardingStep | null;
    completedSteps: Set<OnboardingStep>;
    finished: boolean;
  };
  let active: {
    userId: string;
    context: OnboardingContext;
    currentFlow: OnboardingFlow;
    flows: Map<OnboardingFlow, FlowState>;
  } | null = null;

  function properties(flow: OnboardingFlow) {
    return { flow, context: active!.context };
  }
  return {
    view(userId: string, flow: OnboardingFlow, context: OnboardingContext, step: OnboardingStep, resumed: boolean) {
      if (!active || active.userId !== userId || (flow !== "preferences" &&
        (active.currentFlow !== flow || active.flows.get(flow)?.finished))) {
        active = { userId, context, currentFlow: flow, flows: new Map() };
      }
      active.currentFlow = flow;
      let progress = active.flows.get(flow);
      if (!progress) {
        progress = { lastStep: null, completedSteps: new Set(), finished: false };
        active.flows.set(flow, progress);
        emit.started({ ...properties(flow), resumed });
      }
      if (progress.lastStep !== step) {
        progress.lastStep = step;
        emit.viewed({ ...properties(flow), step });
      }
    },
    completeStep(userId: string, flow: OnboardingFlow, step: OnboardingStep, outcome: OnboardingOutcome = "continued") {
      const progress = active?.userId === userId ? active.flows.get(flow) : null;
      if (!progress || progress.finished || progress.completedSteps.has(step)) return;
      progress.completedSteps.add(step);
      emit.stepCompleted({ ...properties(flow), step, outcome });
    },
    complete(userId: string, flow: OnboardingFlow) {
      const progress = active?.userId === userId ? active.flows.get(flow) : null;
      if (!progress || progress.finished) return;
      progress.finished = true;
      emit.completed(properties(flow));
    },
    cancel(userId: string, flow: OnboardingFlow, step: OnboardingStep) {
      const progress = active?.userId === userId ? active.flows.get(flow) : null;
      if (!progress || progress.finished) return;
      emit.cancelled({ ...properties(flow), step });
      active = null;
    },
  };
}
