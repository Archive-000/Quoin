import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WorkflowState } from '../types/workflow-state.enum';
import { WorkflowType } from '../types/workflow-type.enum';

export class GetWorkflowsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(WorkflowState)
  state?: WorkflowState;

  @IsOptional()
  @IsEnum(WorkflowType)
  type?: WorkflowType;

  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(56)
  walletAddress?: string;
}

export class SearchWorkflowsQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class WorkflowMetricsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  hours?: number;
}
