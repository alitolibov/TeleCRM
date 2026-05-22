import { IsString, IsNotEmpty, IsIn, MinLength, MaxLength, Matches, IsOptional } from 'class-validator'

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username: только латиница, цифры, . _ -' })
  username: string

  /** Per spec §11: ≥8 chars, at least one digit. */
  @IsString()
  @MinLength(8, { message: 'пароль: минимум 8 символов' })
  @Matches(/\d/, { message: 'пароль: должна быть хотя бы одна цифра' })
  password: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string

  @IsString()
  @IsIn(['admin', 'manager'])
  role: 'admin' | 'manager'
}
