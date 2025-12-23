/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { Config } from '../config/config.js';
import { ACTIVATE_SKILL_TOOL_NAME } from './tool-names.js';

/**
 * Parameters for the ActivateSkill tool
 */
export interface ActivateSkillToolParams {
  /**
   * The name of the skill to activate
   */
  name: string;
}

class ActivateSkillToolInvocation extends BaseToolInvocation<
  ActivateSkillToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ActivateSkillToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `activating skill "${this.params.name}"`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const skillName = this.params.name;
    const skills = this.config.getSkills();
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      return {
        llmContent: `Error: Skill "${skillName}" not found. Available skills are: ${skills.map((s) => s.name).join(', ')}`,
        returnDisplay: `Skill "${skillName}" not found.`,
      };
    }

    this.config.activateSkill(skillName);

    return {
      llmContent: `Skill "${skillName}" activated successfully. Its detailed instructions are now part of your system prompt for the rest of this session. You do not need to read its SKILL.md file anymore.`,
      returnDisplay: `Skill "${skillName}" activated.`,
    };
  }
}

/**
 * Implementation of the ActivateSkill tool logic
 */
export class ActivateSkillTool extends BaseDeclarativeTool<
  ActivateSkillToolParams,
  ToolResult
> {
  static readonly Name = ACTIVATE_SKILL_TOOL_NAME;

  constructor(
    private config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      ActivateSkillTool.Name,
      'ActivateSkill',
      "Activates a specialized agent skill by name. Once activated, the skill's full instructions and rules are permanently added to your system prompt for the remainder of the session. Use this when you identify a task that matches a skill's description.",
      Kind.Other,
      {
        properties: {
          name: {
            description: 'The name of the skill to activate.',
            type: 'string',
          },
        },
        required: ['name'],
        type: 'object',
      },
      true,
      false,
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: ActivateSkillToolParams,
  ): string | null {
    if (!params.name || params.name.trim() === '') {
      return "The 'name' parameter must be non-empty.";
    }
    return null;
  }

  protected createInvocation(
    params: ActivateSkillToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<ActivateSkillToolParams, ToolResult> {
    return new ActivateSkillToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
