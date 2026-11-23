import { ConfigService } from '@nestjs/config';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AiCacheService } from './cache/ai-cache.service';
import { QuotaService } from './quota/quota.service';
import {
  AI_PROMPT_MAX_LENGTH,
  AI_USER_ID_MAX_LENGTH,
  AiRequestDto,
  sanitizeAiPrompt,
  sanitizeAiUserId,
} from './dto/ai-request.dto';
import type { AiProvider } from './ai.provider';
import { AI_FALLBACK_PROVIDER } from './ai.provider';

@Injectable()
export class AiService {
  constructor(
    private readonly quotaService: QuotaService,
    private readonly cache: AiCacheService,
    @Inject(AI_FALLBACK_PROVIDER) private readonly provider: AiProvider,
    private readonly config: ConfigService,
  ) {}

  async handlePrompt(dto: AiRequestDto) {
    const prompt = sanitizeAiPrompt(dto?.prompt);
    const userId = sanitizeAiUserId(dto?.userId);

    if (!prompt) {
      throw new BadRequestException('prompt must not be empty');
    }
    if (prompt.length > AI_PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `prompt must be at most ${AI_PROMPT_MAX_LENGTH} characters`,
      );
    }
    if (
      userId &&
      (userId.length > AI_USER_ID_MAX_LENGTH ||
        !/^[A-Za-z0-9._:@/-]+$/.test(userId))
    ) {
      throw new BadRequestException('userId is invalid');
    }

    if (userId) {
      await this.quotaService.assertQuota(userId);
    }

    const model = this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4';
    const cacheKey = this.cache.buildKey(prompt, `v2:${model}`);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return { response: cached, cached: true };
    }

    try {
      const result = await this.provider.generate(prompt);

      if (
        result.response ===
        'AI service is temporarily unavailable. Please try again later.'
      ) {
        return { response: result.response, degraded: true };
      }

      await this.cache.set(cacheKey, result.response);
      if (userId) {
        await this.quotaService.recordUsage(userId, result.tokensUsed);
      }

      return { response: result.response, cached: false };
    } catch {
      return {
        response: 'AI service is temporarily unavailable. Please try again later.',
        degraded: true,
      };
    }
  }

  async handleBatch(prompts: string[], userId?: string) {
    return Promise.all(
      prompts.map((prompt) => this.handlePrompt({ prompt, userId })),
    );
  }
}