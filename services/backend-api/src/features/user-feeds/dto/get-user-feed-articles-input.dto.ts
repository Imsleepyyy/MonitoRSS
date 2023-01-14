import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { GetFeedArticlesFilterReturnType } from "../types";

class FiltersDto {
  @IsEnum(GetFeedArticlesFilterReturnType)
  returnType: GetFeedArticlesFilterReturnType;

  @IsObject()
  @IsOptional()
  expression?: Record<string, unknown>;
}

export class GetUserFeedArticlesInputDto {
  @IsInt()
  @Max(50)
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  limit = 25;

  @IsInt()
  @Max(1000)
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  skip = 0;

  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  random?: boolean;

  /**
   * Properties of each article to send back in the response
   */
  @IsString({ each: true })
  @IsOptional()
  selectProperties?: string[];

  @Type(() => FiltersDto)
  @IsOptional()
  @IsObject()
  filters?: FiltersDto;
}