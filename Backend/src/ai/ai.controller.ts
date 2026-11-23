import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AiRequestDto } from './dto/ai-request.dto';
import { AiService } from './ai.service';

class AiBatchRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  prompts: string[];

  @IsString()
  @IsOptional()
  userId?: string;
}

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Throttle({ default: { limit: 5, ttl: 10000 } })
  @Post('prompt')
  async prompt(@Body() dto: AiRequestDto) {
    return this.aiService.handlePrompt(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 10000 } })
  @Post('batch')
  async batch(@Body() dto: AiBatchRequestDto) {
    return { results: await this.aiService.handleBatch(dto.prompts, dto.userId) };
  }
}