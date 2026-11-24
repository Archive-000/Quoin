import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';

export const AI_PROMPT_MAX_LENGTH = 4000;
export const AI_USER_ID_MAX_LENGTH = 128;

export function sanitizeAiPrompt(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeAiUserId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const sanitized = value
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .trim();

  return sanitized || undefined;
}

export class AiRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_PROMPT_MAX_LENGTH)
  @Transform(({ value }) => sanitizeAiPrompt(value))
  prompt: string;

  @IsString()
  @IsOptional()
  @MaxLength(AI_USER_ID_MAX_LENGTH)
  @Matches(/^[A-Za-z0-9._:@/-]+$/, {
    message: 'userId contains invalid characters',
  })
  @Transform(({ value }) => sanitizeAiUserId(value))
  userId?: string;
}
