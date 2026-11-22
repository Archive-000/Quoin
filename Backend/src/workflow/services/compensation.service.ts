import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowStep } from '../entities/workflow-step.entity';
import { WorkflowStateMachineService } from './workflow-state-machine.service';
import { WorkflowState } from '../types/workflow-state.enum';
import { StepState } from '../types/step-state.enum';
import { WorkflowContext, WorkflowDefinition } from '../types';

@Injectable()
export class CompensationService {
  private readonly logger = new Logger(CompensationService.name);
  private readonly workflowDefinitions = new Map<string, WorkflowDefinition>();

  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepository: Repository<Workflow>,
    @InjectRepository(WorkflowStep)
    private readonly stepRepository: Repository<WorkflowStep>,
    private readonly stateMachine: WorkflowStateMachineService,
  ) {}

  registerWorkflowDefinition(definition: WorkflowDefinition): void {
    const version = definition.version || 1;
    this.workflowDefinitions.set(`${definition.type}:v${version}`, definition);
  }

  /**
   * Compensate a failed workflow by executing rollback steps
   */
  async compensateWorkflow(workflowId: string): Promise<void> {
    this.logger.log(`Initiating compensation for workflow: ${workflowId}`);

    const workflow = await this.workflowRepository.findOne({
      where: { id: workflowId },
      relations: { steps: true },
    });

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Check if workflow can be compensated
    if (!this.stateMachine.canWorkflowCompensate(workflow.state)) {
      throw new Error(
        `Workflow ${workflowId} cannot be compensated in state: ${workflow.state}`,
      );
    }

    // Transition workflow to compensating state
    const transition = this.stateMachine.transitionWorkflow(
      workflow.state,
      WorkflowState.COMPENSATING,
    );
    if (!transition.success) {
      throw new Error(`Cannot start compensation: ${transition.error}`);
    }

    workflow.state = WorkflowState.COMPENSATING;
    workflow.requiresCompensation = true;
    await this.workflowRepository.save(workflow);

    try {
      const definition = this.workflowDefinitions.get(
        `${workflow.type}:v${workflow.version || 1}`,
      );
      if (!definition) {
        throw new Error(
          `Workflow definition not registered for ${workflow.type} v${workflow.version || 1}`,
        );
      }

      // Execute compensation in reverse order
      const completedSteps = workflow.steps
        .filter(
          (step) =>
            step.state === StepState.COMPLETED && step.requiresCompensation,
        )
        .sort((a, b) => b.stepIndex - a.stepIndex); // Reverse order

      this.logger.log(`Found ${completedSteps.length} steps to compensate`);

      for (const step of completedSteps) {
        await this.compensateStep(workflow, step, definition);
      }

      // Mark workflow as compensated
      workflow.state = WorkflowState.COMPENSATED;
      workflow.isCompensated = true;
      workflow.completedAt = new Date();
      await this.workflowRepository.save(workflow);

      this.logger.log(
        `Workflow compensation completed successfully: ${workflowId}`,
      );
    } catch (error) {
      this.logger.error(`Workflow compensation failed: ${workflowId}`, error);

      workflow.state = WorkflowState.FAILED;
      workflow.failureReason = `Compensation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.workflowRepository.save(workflow);

      throw error;
    }
  }

  /**
   * Compensate a specific step
   */
  private async compensateStep(
    workflow: Workflow,
    step: WorkflowStep,
    definition: WorkflowDefinition,
  ): Promise<void> {
    this.logger.log(
      `Compensating step: ${step.stepName} for workflow: ${workflow.id}`,
    );

    // Transition step to compensating state
    const transition = this.stateMachine.transitionStep(
      step.state,
      StepState.COMPENSATING,
    );
    if (!transition.success) {
      throw new Error(`Cannot start step compensation: ${transition.error}`);
    }

    step.state = StepState.COMPENSATING;
    await this.stepRepository.save(step);

    try {
      const stepDefinition = definition.steps[step.stepIndex];
      if (!stepDefinition?.compensate) {
        throw new Error(`No compensation handler for step: ${step.stepName}`);
      }

      const input = { ...workflow.input };
      workflow.steps
        .filter((previousStep) => previousStep.stepIndex < step.stepIndex)
        .sort((a, b) => a.stepIndex - b.stepIndex)
        .forEach((previousStep) => {
          if (previousStep.output) {
            input[previousStep.stepName] = previousStep.output;
          }
        });
      const context: WorkflowContext = {
        workflowId: workflow.id,
        idempotencyKey: workflow.idempotencyKey,
        userId: workflow.userId,
        walletAddress: workflow.walletAddress,
        type: workflow.type,
        retryCount: step.retryCount,
        stepIndex: step.stepIndex,
        metadata: workflow.context,
        resumableState: step.resumableState,
      };

      await stepDefinition.compensate(input, step.output, context);

      // Mark step as compensated
      step.state = StepState.COMPENSATED;
      step.isCompensated = true;
      step.compensatedAt = new Date();
      await this.stepRepository.save(step);

      this.logger.log(`Step compensation completed: ${step.stepName}`);
    } catch (error) {
      this.logger.error(`Step compensation failed: ${step.stepName}`, error);

      step.state = StepState.FAILED;
      step.failureReason = `Compensation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await this.stepRepository.save(step);

      throw error;
    }
  }

  /**
   * Get compensatable workflows
   */
  async getCompensatableWorkflows(): Promise<Workflow[]> {
    return await this.workflowRepository.find({
      where: [
        {
          state: WorkflowState.FAILED,
          requiresCompensation: true,
          isCompensated: false,
        },
        {
          state: WorkflowState.CANCELLED,
          requiresCompensation: true,
          isCompensated: false,
        },
      ],
      relations: { steps: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Check if a workflow requires compensation
   */
  async requiresCompensation(workflowId: string): Promise<boolean> {
    const workflow = await this.workflowRepository.findOne({
      where: { id: workflowId },
    });

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    return workflow.requiresCompensation && !workflow.isCompensated;
  }

  /**
   * Force compensation regardless of current state (admin function)
   */
  async forceCompensateWorkflow(workflowId: string): Promise<void> {
    this.logger.warn(`Force compensating workflow: ${workflowId}`);

    const workflow = await this.workflowRepository.findOne({
      where: { id: workflowId },
      relations: { steps: true },
    });

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const definition = this.workflowDefinitions.get(
      `${workflow.type}:v${workflow.version || 1}`,
    );
    if (!definition) {
      throw new Error(
        `Workflow definition not registered for ${workflow.type} v${workflow.version || 1}`,
      );
    }

    // Override state machine restrictions for forced compensation
    workflow.state = WorkflowState.COMPENSATING;
    workflow.requiresCompensation = true;
    await this.workflowRepository.save(workflow);

    const completedSteps = workflow.steps
      .filter(
        (step) =>
          step.state === StepState.COMPLETED && step.requiresCompensation,
      )
      .sort((a, b) => b.stepIndex - a.stepIndex);

    for (const step of completedSteps) {
      await this.compensateStep(workflow, step, definition);
    }

    workflow.state = WorkflowState.COMPENSATED;
    workflow.isCompensated = true;
    await this.workflowRepository.save(workflow);

    this.logger.log(`Force compensation completed for workflow: ${workflowId}`);
  }
}
