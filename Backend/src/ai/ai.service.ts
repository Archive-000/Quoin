import { ConfigService } from '@nestjs/config';
import { Inject, Injectable } from '@nestjs/common';
import { AiCacheService } from './cache/ai-cache.service';
import { QuotaService } from './quota/quota.service';
import { AiRequestDto } from './dto/ai-request.dto';
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
    if (dto.userId) {
      await this.quotaService.assertQuota(dto.userId);
    }

    const model = this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4';
    const cacheKey = this.cache.buildKey(dto.prompt, `v2:${model}`);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return { response: cached, cached: true };
    }

    try {
      const result = await this.provider.generate(dto.prompt);

      if (result.response === 'AI service is temporarily unavailable. Please try again later.') {
        return { response: result.response, degraded: true };
      }

      await this.cache.set(cacheKey, result.response);
      if (dto.userId) {
        await this.quotaService.recordUsage(dto.userId, result.tokensUsed);
      }

      return { response: result.response, cached: false };
    } catch {
      return {
        response: 'AI service is temporarily unavailable. Please try again later.',
        degraded: true,
      };
    }
  }
}