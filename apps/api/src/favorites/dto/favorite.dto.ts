import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateFavoriteDto {
  /** Plain-text note. Forward-via-message-id will land in a sibling field later (#5). */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string

  /** Parent favorite id when this entry is a reply to an earlier one. */
  @IsOptional()
  @IsString()
  replyToId?: string
}

export class UpdateFavoriteDto {
  /** New body — replaces `content.text` for notes, `content.caption` for media. */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string
}

export class ListFavoritesDto {
  @IsOptional()
  @IsString()
  /** ISO timestamp from the oldest currently-loaded entry — fetch older than this. */
  before?: string

  @IsOptional()
  @IsString()
  limit?: string
}
