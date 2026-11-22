// src/voice/voice.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as crypto from 'crypto';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { JobStatus, JobType, VoiceJob } from '../entities/voice-job.entity';

@Injectable()
export class VoiceService {
  constructor(
    @InjectRepository(VoiceJob)
    private voiceJobRepository: Repository<VoiceJob>,
    @InjectQueue('voice-processing')
    private voiceQueue: Queue,
  ) {}

  private generateHash(content: Buffer | string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async processSTT(file: {
    buffer?: Buffer;
    path?: string;
    originalname: string;
  }): Promise<string> {
    let audioHash: string;
    if (file.path) {
      audioHash = await this.generateFileHash(file.path);
    } else if (file.buffer) {
      audioHash = this.generateHash(file.buffer);
    } else {
      throw new Error('Audio upload has no readable content');
    }

    // Check for duplicate
    const existingJob = await this.voiceJobRepository.findOne({
      where: { audioHash, type: JobType.STT, status: JobStatus.COMPLETED },
    });

    if (existingJob) {
      if (file.path) {
        await fs.unlink(file.path);
      }
      return existingJob.id;
    }

    let filePath = file.path;
    if (filePath) {
      const storedFilePath = `${filePath}${path.extname(file.originalname)}`;
      await fs.rename(filePath, storedFilePath);
      filePath = storedFilePath;
    }

    if (!filePath) {
      if (!file.buffer) {
        throw new Error('Audio upload has no readable content');
      }
      const uploadDir = path.join(process.cwd(), 'uploads', 'audio');
      await fs.mkdir(uploadDir, { recursive: true });
      const fileName = `${Date.now()}-${path.basename(file.originalname)}`;
      filePath = path.join(uploadDir, fileName);
      await fs.writeFile(filePath, file.buffer);
    }

    // Create job
    const job = this.voiceJobRepository.create({
      type: JobType.STT,
      audioUrl: filePath,
      audioHash,
      status: JobStatus.PENDING,
    });

    await this.voiceJobRepository.save(job);

    // Queue processing
    await this.voiceQueue.add('process-stt', { jobId: job.id });

    return job.id;
  }

  private async generateFileHash(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(
      filePath,
    ) as AsyncIterable<Buffer>) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  }

  async processTTS(text: string): Promise<string> {
    const audioHash = this.generateHash(text);

    // Check for duplicate
    const existingJob = await this.voiceJobRepository.findOne({
      where: { audioHash, type: JobType.TTS, status: JobStatus.COMPLETED },
    });

    if (existingJob) {
      return existingJob.id;
    }

    // Create job
    const job = this.voiceJobRepository.create({
      type: JobType.TTS,
      inputText: text,
      audioHash,
      status: JobStatus.PENDING,
    });

    await this.voiceJobRepository.save(job);

    // Queue processing
    await this.voiceQueue.add('process-tts', { jobId: job.id });

    return job.id;
  }

  async getJobStatus(id: string) {
    const job = await this.voiceJobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      text: job.inputText || job.transcribedText,
      audioUrl: job.audioUrl,
      resultAudioUrl: job.generatedAudioUrl,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async getJobResult(id: string) {
    const job = await this.voiceJobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== JobStatus.COMPLETED) {
      return {
        status: job.status,
        message: 'Job not completed yet',
      };
    }

    return {
      status: job.status,
      type: job.type,
      text: job.inputText || job.transcribedText,
      resultAudioUrl: job.generatedAudioUrl,
    };
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    updates: Partial<VoiceJob> = {},
  ): Promise<void> {
    await this.voiceJobRepository.update(id, {
      status,
      ...updates,
    });
  }

  async incrementRetry(id: string): Promise<boolean> {
    const job = await this.voiceJobRepository.findOne({ where: { id } });
    if (!job) return false;

    const newRetryCount = job.retryCount + 1;
    await this.voiceJobRepository.update(id, {
      retryCount: newRetryCount,
    });

    return newRetryCount < job.maxRetries;
  }
}
