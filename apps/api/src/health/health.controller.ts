import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      service: "marketing-platform-api",
      timestamp: new Date().toISOString(),
    };
  }
}
