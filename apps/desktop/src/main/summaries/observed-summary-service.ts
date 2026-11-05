import { SummaryService, type GenerateOutcome, type GenerateRequest } from '@vozella/core';

/**
 * A summary run is what makes a meeting busy in the Library list, and the core service has no way
 * to say one started or ended. Both moments reach the list through `onBusyChanged`.
 */
export class ObservedSummaryService extends SummaryService {
  constructor(
    deps: ConstructorParameters<typeof SummaryService>[0],
    private readonly onBusyChanged: () => void,
  ) {
    super(deps);
  }

  override generate(request: GenerateRequest): Promise<GenerateOutcome> {
    const alreadyRunning = this.isGenerating(request.meetingId);
    const outcome = super.generate(request);
    // `generate` marks the run before its first await, so this reads the state it just set.
    if (alreadyRunning || !this.isGenerating(request.meetingId)) return outcome;
    this.onBusyChanged();
    return outcome.finally(() => {
      this.onBusyChanged();
    });
  }
}
