/**
 * Agent Core - Industry-Grade Agentic AI System
 * 
 * Implements ReAct-style reasoning (Reasoning + Acting) pattern:
 * 1. THINK: Plan what to do
 * 2. ACT: Call tools (Ivanti APIs, KB, etc.)
 * 3. OBSERVE: Process results
 * 4. THINK: Refine plan based on observations
 * 5. RESPOND: Generate grounded, validated response
 * 
 * This prevents hallucinations by ensuring all facts come from tools,
 * not from the model's imagination.
 */

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type AgentStepStatus = 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped';

export interface AgentStep {
  id: string;
  label: string;
  status: AgentStepStatus;
  detail?: string;
  error?: string;
  timestamp?: number;
}

export interface AgentContext {
  // What the agent knows from tool calls
  facts: Record<string, any>;
  // What the agent still needs to know
  missingInfo: string[];
  // Any errors encountered
  errors: string[];
  // Thinking steps for UI
  steps: AgentStep[];
}

export interface AgentResult {
  message: string;
  actions: any[];
  thinkingSteps?: AgentStep[];
  context?: AgentContext;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT STEP MANAGER
// ══════════════════════════════════════════════════════════════════════════════

export class AgentStepManager {
  private steps: AgentStep[];

  constructor(initialSteps: Omit<AgentStep, 'status' | 'timestamp'>[]) {
    this.steps = initialSteps.map(s => ({
      ...s,
      status: 'pending' as AgentStepStatus,
      timestamp: Date.now()
    }));
  }

  startStep(stepId: string): void {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'in_progress';
      step.timestamp = Date.now();
      console.log(`[Agent] ▶️ Started step: ${step.label}`);
    }
  }

  completeStep(stepId: string, detail?: string): void {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.detail = detail;
      step.timestamp = Date.now();
      console.log(`[Agent] ✅ Completed step: ${step.label}${detail ? ` (${detail})` : ''}`);
    }
  }

  errorStep(stepId: string, error: string): void {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'error';
      step.error = error;
      step.timestamp = Date.now();
      console.error(`[Agent] ❌ Error in step: ${step.label}: ${error}`);
    }
  }

  skipStep(stepId: string, reason?: string): void {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'skipped';
      step.detail = reason;
      step.timestamp = Date.now();
      console.log(`[Agent] ⏭️ Skipped step: ${step.label}${reason ? ` (${reason})` : ''}`);
    }
  }

  getSteps(): AgentStep[] {
    return [...this.steps];
  }

  hasErrors(): boolean {
    return this.steps.some(s => s.status === 'error');
  }

  getErrorSteps(): AgentStep[] {
    return this.steps.filter(s => s.status === 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER - Builds grounded context from tool results
// ══════════════════════════════════════════════════════════════════════════════

export class AgentContextBuilder {
  private facts: Record<string, any> = {};
  private missingInfo: string[] = [];
  private errors: string[] = [];

  addFact(key: string, value: any): void {
    this.facts[key] = value;
    console.log(`[Agent Context] ✅ Added fact: ${key}`);
  }

  addMissingInfo(info: string): void {
    this.missingInfo.push(info);
    console.log(`[Agent Context] ⚠️ Missing info: ${info}`);
  }

  addError(error: string): void {
    this.errors.push(error);
    console.error(`[Agent Context] ❌ Error: ${error}`);
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasMissingInfo(): boolean {
    return this.missingInfo.length > 0;
  }

  buildContext(): AgentContext {
    return {
      facts: { ...this.facts },
      missingInfo: [...this.missingInfo],
      errors: [...this.errors],
      steps: []
    };
  }

  // Build a grounded system message for Gemini
  buildSystemMessage(): string {
    const sections: string[] = [];

    // Facts section
    if (Object.keys(this.facts).length > 0) {
      sections.push('[GROUNDED FACTS - Use ONLY this information]');
      for (const [key, value] of Object.entries(this.facts)) {
        if (typeof value === 'object') {
          sections.push(`${key}: ${JSON.stringify(value, null, 2)}`);
        } else {
          sections.push(`${key}: ${value}`);
        }
      }
    }

    // Missing info section
    if (this.missingInfo.length > 0) {
      sections.push('\n[MISSING INFORMATION]');
      sections.push(...this.missingInfo.map(info => `- ${info}`));
    }

    // Errors section
    if (this.errors.length > 0) {
      sections.push('\n[ERRORS ENCOUNTERED]');
      sections.push(...this.errors.map(err => `- ${err}`));
    }

    // Instructions
    sections.push('\n[CRITICAL INSTRUCTIONS]');
    sections.push('- NEVER invent or guess data not listed in GROUNDED FACTS above');
    sections.push('- NEVER mention RecIds, emails, or numbers that are not in the facts');
    sections.push('- If missing information exists, ask the user for it clearly and concisely');
    sections.push('- If errors exist, explain them in friendly terms and suggest a solution');

    return sections.join('\n');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION - Post-check AI responses against grounded context
// ══════════════════════════════════════════════════════════════════════════════

export class AgentResponseValidator {
  private context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  validate(aiMessage: string): { valid: boolean; violations: string[]; correctedMessage?: string } {
    const violations: string[] = [];
    let correctedMessage = aiMessage;

    // Check for hallucinated emails
    const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
    const aiEmails = [...aiMessage.matchAll(emailPattern)].map(m => m[0]);
    const contextStr = JSON.stringify(this.context.facts);

    for (const email of aiEmails) {
      if (!contextStr.includes(email)) {
        violations.push(`Hallucinated email: ${email}`);
        // Replace with generic placeholder
        correctedMessage = correctedMessage.replace(email, '[your email on file]');
      }
    }

    // Check for hallucinated RecIds (32-char hex)
    const recIdPattern = /\b[A-F0-9]{32}\b/gi;
    const aiRecIds = [...aiMessage.matchAll(recIdPattern)].map(m => m[0]);
    
    for (const recId of aiRecIds) {
      if (!contextStr.includes(recId)) {
        violations.push(`Hallucinated RecId: ${recId}`);
        // Remove RecIds from message (users don't need to see them)
        correctedMessage = correctedMessage.replace(recId, '[ID]');
      }
    }

    // Check for fake SR/incident numbers
    const srPattern = /(?:Service Request|SR|Incident)\s*#?\s*(\d{4,})/gi;
    const aiNumbers = [...aiMessage.matchAll(srPattern)].map(m => m[1]);
    
    for (const num of aiNumbers) {
      if (!contextStr.includes(num)) {
        violations.push(`Hallucinated SR/Incident number: ${num}`);
        // Remove the number
        correctedMessage = correctedMessage.replace(new RegExp(`(Service Request|SR|Incident)\\s*#?\\s*${num}`, 'gi'), '$1');
      }
    }

    // Check for claims about submission/creation when no confirmation exists
    if (!this.context.facts.draftCreated && !this.context.facts.srCreated) {
      const submissionClaims = [
        /I'?ve?\s+(?:submitted|created)\s+(?:the|your)\s+(?:Service\s+)?Request/i,
        /(?:Service\s+)?Request\s+.*\s+has\s+been\s+(?:submitted|created)/i
      ];

      for (const pattern of submissionClaims) {
        if (pattern.test(aiMessage)) {
          violations.push('Claimed to submit/create SR when no confirmation exists');
          correctedMessage = correctedMessage.replace(pattern, 'I\'ve prepared the Service Request form for you');
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      correctedMessage: violations.length > 0 ? correctedMessage : undefined
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

export function createAgentContext(): AgentContextBuilder {
  return new AgentContextBuilder();
}

export function createStepManager(steps: Omit<AgentStep, 'status' | 'timestamp'>[]): AgentStepManager {
  return new AgentStepManager(steps);
}
