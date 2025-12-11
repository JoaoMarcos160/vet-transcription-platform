import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';

@Module({
  controllers: [UsersController],
  providers: [UsersService, FirebaseAdapter],
  exports: [UsersService],
})
export class UsersModule {}
