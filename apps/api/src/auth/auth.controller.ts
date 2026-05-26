import {
  Controller, Post, Get, Body, Req, Res, Param,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { CurrentUser } from './decorators/current-user.decorator'
import { LoginDto } from './dto/login.dto'
import type { User } from '../db/schema'

const COOKIE_NAME = 'refresh_token'
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() _dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.login(
      req.user as User,
      { userAgent: req.headers['user-agent'], ip: req.ip },
    )
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTIONS)
    return { accessToken, user: this.sanitize(user) }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE_NAME]
    if (!token) {
      res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token' })
      return
    }
    const { accessToken, refreshToken, user } = await this.authService.refresh(token, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    })
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTIONS)
    return { accessToken, user: this.sanitize(user) }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE_NAME]
    if (token) await this.authService.logout(token)
    res.clearCookie(COOKIE_NAME, { path: '/' })
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { id: string; role: string }) {
    return user
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async sessions(@CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.authService.listSessions(user.id, req.cookies?.[COOKIE_NAME])
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    await this.authService.revokeSession(user.id, id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOtherSessions(@CurrentUser() user: { id: string }, @Req() req: Request) {
    await this.authService.revokeOtherSessions(user.id, req.cookies?.[COOKIE_NAME])
  }

  private sanitize(user: User) {
    const { passwordHash: _, ...rest } = user
    return rest
  }
}
