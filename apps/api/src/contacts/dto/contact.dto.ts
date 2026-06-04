import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator'

export class UpsertContactDto {
  /** Chat whose client is being saved as a contact. */
  @IsUUID()
  chatId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string

  /** Optional override — used when TDLib hasn't told us the number (client's
   *  privacy excludes our CRM account). On save we write it to clients.phone
   *  and pass it to TDLib addContact so the contact lands in the CRM-account's
   *  Telegram too. Loose validation: any non-empty string with at least 5 digits.
   *
   *  `ValidateIf` skips ALL the checks below when the field is empty/missing —
   *  `@IsOptional()` alone still runs `@Matches` on the empty string and fails. */
  @ValidateIf((o) => o.phone !== undefined && o.phone !== null && o.phone !== '')
  @IsString()
  @MaxLength(32)
  @Matches(/\+?[0-9 ()-]{5,}/, { message: 'phone must look like a phone number' })
  phone?: string
}
