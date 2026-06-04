import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  const allowedOrigins = (process.env.WEB_URL ?? 'http://localhost:3005').split(',').map(o => o.trim())
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  })

  const port = Number(process.env.API_PORT ?? 3000)
  await app.listen(port)
  console.log(`[api] listening on http://localhost:${port}`)
}

bootstrap()
