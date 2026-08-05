import type { Skill as GeneratedSkill } from '@/shared/api/generated/model';

export interface SkillVersion {
  readonly id?: string | number;
  readonly name: string;
  readonly instructions: string;
  readonly tags: readonly string[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface SkillRecord extends GeneratedSkill {
  readonly versions?: readonly SkillVersion[];
  readonly version_details?: SkillVersion;
}

export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly tags: readonly string[];
}

export interface SkillListPage {
  readonly items: readonly SkillRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface SkillWriteInput {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly tags: readonly string[];
}

export interface SkillTestTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface SkillTestRequest {
  readonly sid: string;
  readonly messageId: string;
  readonly streamId: string;
  readonly instructions: string;
  readonly userInput: string;
  readonly chatHistory: readonly SkillTestTurn[];
  readonly modelName: string;
  readonly modelProjectId?: string;
  readonly temperature: number;
  readonly maxTokens: number;
}
