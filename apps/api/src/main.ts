import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Marketing Platform API is running at http://localhost:${port}/api`);
}

void bootstrap();
