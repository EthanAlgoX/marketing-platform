import { Body, Controller, Get, HttpException, HttpStatus, Post } from "@nestjs/common";
import { CreateUserDto } from "./users.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() body: CreateUserDto) {
    if (!body?.email) {
      throw new HttpException("email is required", HttpStatus.BAD_REQUEST);
    }
    return this.usersService.create(body);
  }

  @Get()
  list() {
    return this.usersService.findAll();
  }
}
